/**
 * Amazon Connect の通話音声を録音し、聞き返しや保存する機能を追加します。
 *
 * 追記：Firefox のコンソールに"AbortError: The operation was aborted."が出力されるのは多分 Firefox のバグです。
 * https://stackoverflow.com/questions/53039068/aborterror-the-operation-was-aborted-error-when-adjusting-html-5-video-cur
 */
(function() {
	const global = this;
	ccp4r = global.ccp4r || {};
	global.ccp4r = ccp4r;

	/**
	 * 設定。
	 * @type {object}
	 */
	let config;

	/**
	 * 録音可能かどうか。
	 * @type {boolean}
	 */
	let isRecordingEnabled = false;

	/**
	 * 初期化時のコールバック関数の一覧。
	 * @type {Function[]}
	 */
	let initCallbacks = [];

	/**
	 * ログ出力のコールバック関数の一覧。
	 * @type {Function[]}
	 */
	let loggingCallbacks = [];

	/**
	 * ログインウインドウのハンドル。
	 * @type {Window}
	 */
	let loginWindowHandle;

	/**
	 * 録音中の通話ID。
	 * @type {string}
	 */
	let recordingContactId;

	/**
	 * オペレータ側のメディアストリーム。
	 * @type {MediaStream}
	 */
	let localMediaStream;

	/**
	 * オペレータ側のメディア録音。
	 * @type {MediaRecorder}
	 */
	let localRecorder;

	/**
	 * オペレータ側の音声バイナリの一覧。
	 * @type {Blob[]}
	 */
	let localChunks = [];

	/**
	 * オペレータ側の音声の URL。
	 * @type {string}
	 */
	let localBlobUrl;

	/**
	 * カスタマ側のメディア録音。
	 * @type {MediaRecorder}
	 */
	let remoteRecorder;

	/**
	 * カスタマ側の音声バイナリの一覧。
	 * @type {Blob[]}
	 */
	let remoteChunks = [];

	/**
	 * カスタマ側の音声の URL。
	 * @type {string}
	 */
	let remoteBlobUrl;

	/**
	 * 録音可能かどうかを取得します。
	 * @returns {boolean} 録音可能かどうか。
	 */
	ccp4r.isRecordingEnabled = function() {
		return isRecordingEnabled;
	}

	/**
	 * 初期化時のコールバック関数を登録します。
	 * @param {Function} callback ログ出力のコールバック関数。
	 */	
	ccp4r.subscribeInit = function(callback) {
		if (connect === undefined)
		{
			console.warn('Failed to subscribe init. Because not found Amazon Connect Streams.');
			return;
		}

		if (!connect.isFunction(callback)) {
			console.warn('Failed to subscribe init. Because \'callback\' value is not function.');
			return;
		}

		initCallbacks.push(callback);
	}

	/**
	 * 初期化時のコールバック関数の登録をすべて解除します。
	 */
	ccp4r.unsubscribeInit = function() {
		initCallbacks = [];
	}

	/**
	 * ログ出力のコールバック関数を登録します。
	 * @param {Function} callback ログ出力のコールバック関数。
	 */
	ccp4r.subscribeLogging = function(callback) {
		if (connect === undefined)
		{
			console.warn('Failed to subscribe logging. Because not found Amazon Connect Streams.');
			return;
		}

		if (!connect.isFunction(callback)) {
			console.warn('Failed to subscribe logging. Because \'callback\' value is not function.');
			return;
		}

		loggingCallbacks.push(callback);
	}

	/**
	 * ログ出力のコールバック関数の登録をすべて解除します。
	 */
	ccp4r.unsubscribeLoggingAll = function() {
		loggingCallbacks = [];
	}

	/**
	 * 初期化します。
	 * @param {Event} event イベント情報。
	 */
	function initialize(event) {
		if (connect === undefined)
		{
			log('Initialize,Not found Amazon Connect Streams');
			return;
		}

		// 設定の読み込み ※これなら後から設定を読み込んでも動作するはず。
		config = ccp4r.config || {};

		const containerDiv = getValidatedElement(config.containerDivId, 'DIV');
		if (containerDiv == null) {
			return;
		}

		connect.core.initCCP(containerDiv, {
			ccpUrl: config.ccpUrl,
			loginPopup: false,
			softphone: {
				allowFramedSoftphone: false,
				disableRingtone: false,
				ringtoneUrl: null,
			}
		});
		connect.core.initSoftphoneManager({ allowFramedSoftphone: true });

		subscribeLowLevelEvent();

		// エージェント初期化時の処理
		connect.agent(subscribeAgentEvent);

		// 通話初期化時の処理
		connect.contact(subscribeContactEvent);

		// 録音の初期化
		initializeRecording();

		// ログインボタンの初期化
		initializeLoginButton();
	}

	/**
	 * 録音環境を初期化します。
	 */
	function initializeRecording() {
		// https://dev.mozilla.jp/2016/04/record-almost-everything-in-the-browser-with-mediarecorder/
		if(window.MediaRecorder === undefined) {
			log('Initialize,MediaRecorder is not supported');
			return;
		}

		if (!navigator.mediaDevices)
		{
			log('Initialize,navigator.mediaDevices is not supported');
			return;
		}

		// カスタマ側の音声を録音するための要素の確認
		if (getValidatedElement(config.remoteAudioId, 'AUDIO') == null) {
			return;
		}

		tryGetUserMedia();
	}

	/**
	 * オペレータ側のメディアストリームの取得を試行します。
	 */
	function tryGetUserMedia() {
		log('Initialize,Getting local media stream');
		navigator.mediaDevices.getUserMedia({
			audio: true
		}).then((stream) => {
			localMediaStream = stream;
			isRecordingEnabled = true;
			log('Initialize,Local media stream is ready');
		}).catch((error) => {
			isRecordingEnabled = false;
			log('Initialize,Failed to get local media stream,' + error);
			setTimeout(tryGetUserMedia, 5000); // TODO リトライ間隔を設定できるようにします。
		});
	}

	/**
	 * ログインボタンを初期化します。
	 * ログインの処理については、{@link https://dev.classmethod.jp/cloud/aws/amazon-connect-streams-login-button/} を参考にしています。
	 */
	function initializeLoginButton() {
		const loginButton = getValidatedElement(config.loginButtonId, 'BUTTON');
		if (loginButton == null)
		{
			return;
		}

		loginButton.addEventListener('click', () => {
			loginWindowHandle = window.open(config.loginUrl);
		});
	}

	/**
	 * タグ名を検証済みのIDに対応した要素を取得します。
	 * @param {string} id ID。
	 * @param {string} tagName タグ名。
	 * @returns {HTMLElement} IDに対応した要素。
	 */
	function getValidatedElement(id, tagName) {
		const element = document.getElementById(id);
		if (element == null) {
			log('Utility,Not found element,' + JSON.stringify({
				id: id,
			}));
			return null;
		}

		// タグ名が未指定の場合は検証しません。
		if (tagName == null) {
			return element;
		}

		if (element.tagName !== tagName) {
			log('Utility,Not match element tag name,' + JSON.stringify({
				id: id,
				expectedTagName: tagName,
				actualTagName: element.tagName,
			}));
			return null;
		}

		return element;
	}

	/**
	 * 低レベルのイベントを購読します。
	 */
	function subscribeLowLevelEvent() {
		const bus = connect.core.getEventBus();
		bus.subscribe(connect.EventType.TERMINATED, function() {
			// リロードしないと、再ログイン時にイベントが取得できないとのこと。
			location.reload();
		});
		bus.subscribe(connect.AgentEvents.INIT, function() {
			// ログインボタンを隠します。
			const loginButtonId = config.loginButtonId;
			const loginButton = document.getElementById(loginButtonId);
			if (loginButton != null) {
				loginButton.style.display='none';
			}

			// ログインウインドウが開いていれば閉じます。
			if (loginWindowHandle != null)
			{
				loginWindowHandle.close();
				loginWindowHandle = null;
			}

			if (initCallbacks.length === 0) {
				return;
			}
	
			const length = initCallbacks.length;
			for(let i = 0; i < length; ++i) {
				initCallbacks[i]();
			};		
		});
	}

	/**
	 * エージェントイベントを購読します。
	 * @param {Agent} agent エージェントAPI。
	 */
	function subscribeAgentEvent(agent) {
		logAgentEvent(agent, 'Init');

		agent.onContactPending(function(agent) {
			logAgentEvent(agent, 'ContactPending');
		});
		agent.onRefresh(function(agent) {
			logAgentEvent(agent, 'Refresh');
		});
		agent.onRoutable(function(agent) {
			logAgentEvent(agent, 'Routable');
		});
		agent.onNotRoutable(function(agent) {
			logAgentEvent(agent, 'NotRoutable');
		});
		agent.onOffline(function(agent) {
			logAgentEvent(agent, 'Offline');
		});
		agent.onError(function(agent) {
			logAgentEvent(agent, 'Error');
		});
		agent.onSoftphoneError(function(agent) {
			logAgentEvent(agent, 'SoftphoneError');
		});
		agent.onStateChange(function(event) {
			logAgentStateChangeEvent(event);
		});
		agent.onMuteToggle(function(event) {
			logAgentMuteToggleEvent(event);
		});
	}

	/**
	 * エージェントイベントをログに出力します。
	 * @param {Agent} agent エージェントAPI。
	 * @param {string} eventName イベント名。
	 */
	function logAgentEvent(agent, eventName) {
		// 出力先が無い場合は何も処理しません。
		if (loggingCallbacks.length === 0)
		{
			return;
		}

		log('AgentEvent,' + eventName + ',' + JSON.stringify(getAgentData(agent)));
	}

	/**
	 * エージェントの状態変更イベントをログに出力します。
	 * @param {object} event イベントオブジェクト。
	 */
	function logAgentStateChangeEvent(event) {
		// 出力先が無い場合は何も処理しません。
		if (loggingCallbacks.length === 0) {
			return;
		}

		let data;
		if (event == null) {
			data = null;
		} else {
			data = {};
			data['agent'] = getAgentData(event['agent']);
			data['oldState'] = event['oldState'];
			data['newState'] = event['newState'];
		}

		log('AgentEvent,StateChange,' + JSON.stringify(data));
	}

	/**
	 * エージェントのミュート変更イベントをログに出力します。
	 * @param {object} event イベントオブジェクト。
	 */
	function logAgentMuteToggleEvent(event) {
		// 出力先が無い場合は何も処理しません。
		if (loggingCallbacks.length === 0) {
			return;
		}

		log('AgentEvent,MuteToggle,' + JSON.stringify(event));
	}

	/**
	 * エージェントのデータを取得します。
	 * @param {Agent} agent エージェントAPI。
	 * @returns {object} エージェントのデータ。
	 */
	function getAgentData(agent) {
		if (agent == null) {
			return null;
		}

		const state = agent.getState();
		const stateDuration = agent.getStateDuration();
		const permissions = agent.getPermissions(); // = getConfiguration().permissions
		const contacts = getContactsData(agent.getContacts());
		const configuration = agent.getConfiguration();
		const agentStates = agent.getAgentStates(); // = getConfiguration().agentStates
		const routingProfile = agent.getRoutingProfile(); // = getConfiguration().routingProfile
		const name = agent.getName(); // = getConfiguration().name
		const extension = agent.getExtension(); // = getConfiguration().extension
		const dialableCountries = agent.getDialableCountries(); // = getConfiguration().dialableCountries
		const isSoftphoneEnabled = agent.isSoftphoneEnabled(); // = getConfiguration().softphoneEnabled
		return {
			state: state,
			stateDuration: stateDuration,
			permissions: permissions,
			contacts: contacts,
			configuration: configuration,
			agentStates: agentStates,
			routingProfile: routingProfile,
			name: name,
			extension: extension,
			dialableCountries: dialableCountries,
			isSoftphoneEnabled: isSoftphoneEnabled,
		};
	}

	/**
	 * 通話イベントを購読します。
	 * @param {Contact} contact 通話API。
	 */
	function subscribeContactEvent(contact) {
		logContactEvent(contact, 'Init');

		contact.onRefresh(function(contact) {
			logContactEvent(contact, 'Refresh');
		});
		contact.onIncoming(function(contact) {
			logContactEvent(contact, 'Incoming');
		});
		contact.onConnecting(function(contact) {
			logContactEvent(contact, 'Connecting');
		});
		contact.onPending(function(contact) {
			logContactEvent(contact, 'Pending');
		});
		contact.onAccepted(function(contact) {
			logContactEvent(contact, 'Accepted');
		});
		contact.onMissed(function(contact) {
			logContactEvent(contact, 'Missed');
		});
		contact.onEnded(function(contact) {
			logContactEvent(contact, 'Ended(or Destroyed)');
			stopRecording(contact.getContactId());
		});
		contact.onACW(function(contact) {
			logContactEvent(contact, 'ACW');
		});
		contact.onConnected(function(contact) {
			logContactEvent(contact, 'Connected');
			startRecording(contact.getContactId());
		});
	}

	/**
	 * 通話イベントをログに出力します。
	 * @param {Contact} contact 通話API。
	 * @param {string} eventName イベント名。
	 */
	function logContactEvent(contact, eventName) {
		// 出力先が無い場合は何も処理しません。
		if (loggingCallbacks.length === 0) {
			return;
		}

		log('ContactEvent,' + eventName + ',' + JSON.stringify(getContactData(contact)));
	}

	/**
	 * 通話のデータの一覧を取得します。
	 * @param {Contact[]} contacts 通話APIの一覧。
	 * @returns {object[]} 通話のデータの一覧。
	 */
	function getContactsData(contacts) {
		if (contacts == null) {
			return null;
		}

		const contactsDataList = [];
		const length = contacts.length;
		for(let i = 0; i < length; ++i) {
			contactsDataList.push(getContactData(contacts[i]));
		}

		return contactsDataList;
	}

	/**
	 * 通話のデータを取得します。
	 * @param {Contact} contact 通話API。
	 * @returns {object} 通話のデータ。
	 */
	function getContactData(contact) {
		if (contact == null) {
			return null;
		}

		const contactId = contact.getContactId();
		const originalContactId = contact.getOriginalContactId();
		const type = contact.getType();
		const status = contact.getStatus();
		const statusDuration = contact.getStatusDuration();
		const queue = contact.getQueue();
		const queueTimestamp = contact.getQueueTimestamp();
		let connections;
		let initialConnection;
		let activeInitialConnection;
		let thirdPartyConnections;
		let singleActiveThirdPartyConnection;
		let agentConnection;
		const attributes = contact.getAttributes();
		let isSoftphoneCall
		let isInbound;
		const isConnected = contact.isConnected(); // = getStatus().type === 'connected'

		// Destroyed 時は Connection の情報取得時に例外が発生するので、catch して回避しています。
		try {
			connections = getConnectionsData(contact.getConnections());
			initialConnection = getConnectionData(contact.getInitialConnection()); // = connection.isInitialConnection() == true
			activeInitialConnection = getConnectionData(contact.getActiveInitialConnection()); // = connection.isInitialConnection() == true && connection.isActive() == true
			thirdPartyConnections = getConnectionsData(contact.getThirdPartyConnections()); // = connection.isInitialConnection() == false && connection.getType() !== 'agent'
			singleActiveThirdPartyConnection = getConnectionData(contact.getSingleActiveThirdPartyConnection()); // = getThirdPartyConnections() から最初の connection.isActive() == true
			agentConnection = getConnectionData(contact.getAgentConnection()); // = connection.getType() === 'agent' || connection.getType() === 'monitoring'
			isSoftphoneCall = contact.isSoftphoneCall(); // connection.getSoftphoneMediaInfo() != null が 1 個でもある
			isInbound = contact.isInbound(); // = getInitialConnection().connection.getType() === 'inbound'
		} catch (error) {
			// 正常系で発生している例外ですが、一応ログに出しています。
			log('ContactData,Can\'t get connection data,' + error);
		}

		return {
			contactId: contactId,
			originalContactId: originalContactId,
			type: type,
			status: status,
			statusDuration: statusDuration,
			queue: queue,
			queueTimestamp: queueTimestamp,
			connections: connections,
			initialConnection: initialConnection,
			activeInitialConnection: activeInitialConnection,
			thirdPartyConnections: thirdPartyConnections,
			singleActiveThirdPartyConnection: singleActiveThirdPartyConnection,
			agentConnection: agentConnection,
			attributes: attributes,
			isSoftphoneCall: isSoftphoneCall,
			isInbound: isInbound,
			isConnected: isConnected,
		};
	}

	/**
	 * 接続情報のデータの一覧を取得します。
	 * @param {Connection[]} connections 接続情報の一覧。
	 * @returns {object[]} 接続情報のデータの一覧。
	 */
	function getConnectionsData(connections) {
		if (connections == null) {
			return null;
		}

		const connectionDataList = [];
		const length = connections.length;
		for(let i = 0; i < length; ++i) {
			connectionDataList.push(getConnectionData(connections[i]));
		}

		return connectionDataList;
	}

	/**
	 * 接続情報のデータを取得します。
	 * @param {Connection} connection 接続情報。
	 * @returns {object} 接続情報のデータ。
	 */
	function getConnectionData(connection) {
		if (connection == null) {
			return null;
		}

		const contactId = connection.getContactId();
		const connectionId = connection.getConnectionId();
		const endpoint = connection.getEndpoint();
		const status = connection.getStatus();
		const statusDuration = connection.getStatusDuration();
		const type = connection.getType();
		const isInitialConnection = connection.isInitialConnection();
		const isActive = connection.isActive(); // = getStatus().type === 'connecting' || getStatus().type === 'connected' || getStatus().type === 'hold'
		const isConnected = connection.isConnected(); // = getStatus().type === 'connected'
		const isConnecting = connection.isConnecting(); // = getStatus().type === 'connecting'
		const isOnHold = connection.isOnHold(); // = getStatus().type === 'hold'
		const softphoneMediaInfo = connection.getSoftphoneMediaInfo();
		return {
			contactId: contactId,
			connectionId: connectionId,
			endpoint: endpoint,
			status: status,
			statusDuration: statusDuration,
			type: type,
			isInitialConnection: isInitialConnection,
			isActive: isActive,
			isConnected: isConnected,
			isConnecting: isConnecting,
			isOnHold: isOnHold,
			softphoneMediaInfo: softphoneMediaInfo,
		};
	}

	/**
	 * 録音を開始します。
	 */
	function startRecording(contactId) {
		if (!isRecordingEnabled) {
			return;
		}

		if (contactId == null) {
			log('StartRecording,Not found contact ID');
			return;
		}

		if (recordingContactId == null) {
			recordingContactId = contactId;
		} else if (recordingContactId === contactId) {
			log('StartRecording,Already started recording,' + JSON.stringify({
				contactId: contactId,
			}));
			return;
		} else {
			log('StartRecording,Stopping previous recording,' + JSON.stringify({
				contactId: contactId,
			}));
			stopRecording(recordingContactId);
			recordingContactId = contactId;
		}

		startLocalAudioRecording();
		startRemoteAudioRecording();
	}

	/**
	 * 録音を停止します。
	 */
	function stopRecording(contactId) {
		if (!isRecordingEnabled) {
			return;
		}

		if (contactId == null) {
			log('StopRecording,Not found contact ID');
			return;
		}

		// 今録音中の通話ではない場合は、録音を停止しません。
		if (recordingContactId != null && recordingContactId !== contactId) {
			log('StopRecording,Not match contact ID,' + JSON.stringify({
				recordingContactId: recordingContactId,
				stoppingContactId: contactId,
			}));
			return;
		}

		recordingContactId = null;

		stopLocalAudioRecording();
		stopRemoteAudioRecording();
	}

	/**
	 * オペレーター側の録音を開始します。
	 * MediaRecorder の使い方については、{@link https://qiita.com/ru_shalm/items/0930aedad12c4e100446} を参考にしています。
	 */
	function startLocalAudioRecording() {
		localRecorder = new MediaRecorder(localMediaStream);
		localChunks = [];

		// 定期的に録音データが飛んでくるので貯めます
		localRecorder.addEventListener('dataavailable', (e) => {
			/* オペレーターの音声をリアルタイムに扱いたい場合は、ここで処理します。 */
			localChunks.push(e.data);
		});

		localRecorder.addEventListener('start', () => {
			log('LocalAudio,Start');
		});

		// 録音終了時の処理
		localRecorder.addEventListener('stop', () => {
			log('LocalAudio,Stop');

			// 音声の URL の解放
			if (localBlobUrl != null) {
				const localAudio = document.getElementById('local-record-audio');
				if (localAudio != null) {
					localAudio.src = null;
				}

				const localDownload = document.getElementById('local-record-download');
				if (localDownload != null) {
					localDownload.removeAttribute('href');
				}

				window.URL.revokeObjectURL(localBlobUrl);
				log('LocalAudio,Removed audio URL,' + localBlobUrl);
				localBlobUrl = null;
			}

			if (localChunks.length === 0) {
				log('LocalAudio,Audio is empty');
				return;
			}

			// 貯めていたデータをバイナリとしてひと固まりにまとめます。
			const blob = new Blob(localChunks, { type: localChunks[0].type });
			log('LocalAudio,Combined blob,' + JSON.stringify({
				size: blob.size,
				type: blob.type,
			}));

			// 音声の URL を生成します。※どこかで解放する必要があります。
			localBlobUrl = window.URL.createObjectURL(blob);
			log('LocalAudio,Created audio URL,' + localBlobUrl);

			// Audio 要素に URL を設定すれば再生できます。
			const localAudio = document.getElementById(config.localRecordAudioId);
			if (localAudio != null) {
				localAudio.src = localBlobUrl;
			}

			// リンクに URL を設定すればダウンロードできます。
			const localDownload = document.getElementById(config.localRecordDownloadId);
			if (localDownload != null) {
				localDownload.href = localBlobUrl;
			}
		});

		// 録音の開始
		localRecorder.start(config.timeslice);
	}

	/**
	 * オペレーター側の録音を終了します。
	 */
	function stopLocalAudioRecording() {
		if (localRecorder == null) {
			return;
		}

		try {
			localRecorder.stop();
		} catch (error) {
			log('LocalAudio,Can\'t stop because already inactive,' + error);
		} finally {
			localRecorder = null;
		}
	}

	/**
	 * お客様側の録音を開始します。
	 * MediaRecorder の使い方については、{@link https://qiita.com/ru_shalm/items/0930aedad12c4e100446} を参考にしています。
	 */
	function startRemoteAudioRecording() {
		const remoteAudioId = config.remoteAudioId;
		const remoteStream = document.getElementById(remoteAudioId).srcObject;
		remoteRecorder = new MediaRecorder(remoteStream);
		remoteChunks = [];

		// 定期的に録音データが飛んでくるので貯めます
		remoteRecorder.addEventListener('dataavailable', (e) => {
			/* お客様の音声をリアルタイムに扱いたい場合は、ここで処理します。 */
			remoteChunks.push(e.data);
		});

		remoteRecorder.addEventListener('start', () => {
			log('RemoteAudio,Start');
		});

		// 録音終了時の処理
		remoteRecorder.addEventListener('stop', () => {
			log('RemoteAudio,Stop');

			// 音声の URL の解放
			if (remoteBlobUrl != null) {
				const remoteAudio = document.getElementById(config.remoteRecordAudioId);
				if (remoteAudio != null) {
					remoteAudio.src = null;
				}

				const remoteDownload = document.getElementById(config.remoteRecordDownloadId);
				if (remoteDownload != null) {
					remoteDownload.removeAttribute('href');
				}

				window.URL.revokeObjectURL(remoteBlobUrl);
				log('RemoteAudio,Removed audio URL,' + remoteBlobUrl);
				remoteBlobUrl = null;
			}

			if (remoteChunks.length === 0) {
				log('RemoteAudio,Audio is empty');
				return;
			}

			// 貯めていたデータをバイナリとしてひと固まりにまとめます。
			const blob = new Blob(remoteChunks, { type: remoteChunks[0].type });
			log('RemoteAudio,Combined blob,' + JSON.stringify({
				size: blob.size,
				type: blob.type,
			}));

			// 音声の URL を生成します。※どこかで解放する必要があります。
			remoteBlobUrl = window.URL.createObjectURL(blob);
			log('RemoteAudio,Created audio URL,' + remoteBlobUrl);

			// Audio 要素に URL を設定すれば再生できます。
			const remoteAudio = document.getElementById('remote-record-audio');
			if (remoteAudio != null) {
				remoteAudio.src = remoteBlobUrl;
			}

			// リンクに URL を設定すればダウンロードできます。
			const remoteDownload = document.getElementById('remote-record-download');
			if (remoteDownload != null) {
				remoteDownload.href = remoteBlobUrl;
			}
		});

		// 録音の開始
		remoteRecorder.start(config.timeslice);
	}

	/**
	 * お客様側の録音を終了します。
	 */
	function stopRemoteAudioRecording() {
		if (remoteRecorder == null) {
			return;
		}

		try {
			remoteRecorder.stop();
		} catch (error) {
			log('RemoteAudio,Can\'t stop because already inactive,' + error);
		} finally {
			remoteRecorder = null;
		}
	}

	/**
	 * ログを出力します。
	 * @param {string} message ログメッセージ。
	 */
	function log(message)
	{
		if (loggingCallbacks.length === 0) {
			return;
		}

		// (実際に効果はあるかはともかく)負荷軽減のため非同期で実行します。
		const nowString = getNowString();
		setTimeout(() => {
			const length = loggingCallbacks.length;
			for(let i = 0; i < length; ++i) {
				loggingCallbacks[i](nowString + ',' + message);
			};
		}, 0);
	}

	/**
	 * 現在日時の文字列を取得します。
	 * @return {string} 現在日時の文字列。
	 */
	function getNowString()
	{
		const now = new Date();
		return '' + now.getFullYear()
			+ '/'
			+ ('0' + (now.getMonth() + 1)).slice(-2)
			+ '/'
			+ ('0' + now.getDate()).slice(-2)
			+ ' '
			+ ('0' + now.getHours()).slice(-2)
			+ ':'
			+ ('0' + now.getMinutes()).slice(-2)
			+ ':'
			+ ('0' + now.getSeconds()).slice(-2)
			+ '.'
			+ ('00' + now.getMilliseconds()).slice(-3);
	}

	// onload 時に初期化します。
	window.addEventListener('load', initialize, {
		once: true,
		passive: false,
		capture: false,
	});
})();
