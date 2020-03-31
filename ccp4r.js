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
	 * ロガー。
	 * @type {connect.Logger}
	 */
	let logger;

	/**
	 * 録音可能かどうか。
	 * @type {boolean}
	 */
	let isRecordingEnabled = false;

	/**
	 * サインインウインドウのハンドル。
	 * @type {Window}
	 */
	let signinWindowHandle;

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
	 * オペレータ側の音声録音。
	 * @type {AudioRecorder}
	 */
	let localRecorder;

	/**
	 * オペレータ側の音声描画。
	 * @type {AudioPainter}
	 */
	let localPainter;

	/**
	 * お客様側の音声を取得するaudio要素。
	 * @type {HTMLAudioElement}
	 */
	let remoteAudio;

	/**
	 * お客様側の音声録音。
	 * @type {AudioRecorder}
	 */
	let remoteRecorder;

	/**
	 * お客様側の音声描画。
	 * @type {AudioPainter}
	 */
	let remotePainter;

    /**
     * 音声コンテキスト。
     * @type {AudioContext}
     */
    let audioContext;

	/**
	 * ログをクリアします。
	 */
	ccp4r.clearLog = function() {
		if (logger) {
			logger.setLogRollInterval(1800000); // DEFAULT_LOG_ROLL_INTERVALと同じ値の30分
			logger._rolledLogs = []; // クリアする関数はないはず
			logger._logs = []; // クリアする関数はないはず
		} else {
			console.warn('Logger is not active.');
		}
	}

	/**
	 * ログをダウンロードします。
	 */
	ccp4r.downloadLog = function() {
		if (logger) {
			logger.download();
		} else {
			console.warn('Logger is not active.');
		}
	}

	/**
	 * 初期化します。
	 * @param {Event} event イベント情報。
	 */
	function initialize(event) {
		if (connect === undefined)
		{
			console.warn('Not found Amazon Connect Streams.'); // ロガーが使えないので通常の出力
			return;
		}

		// 設定の読み込み
		config = ccp4r.config || {};

		// ロガーの取得
		logger = connect.getLog();

		// ログレベルの設定
		try {
			logger.setLogLevel(config.logLevel);
			logger.setEchoLevel(config.logLevel);
		} catch (error) {
			logger.warn('Invalid log level. (Log level: %s)', config.logLevel).withException(error);	
		}

		const containerDiv = getValidatedElement(config.containerDivId, 'DIV');
		if (!containerDiv) {
			logger.warn('Not found container element. (ID: %s)', config.containerDivId);
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

		// 一見無駄な操作に見えますが、Amazon Connect connect-rtc-js がこの操作を要求しているので従っています
		connect.core.initSoftphoneManager({ allowFramedSoftphone: true });

		subscribeLowLevelEvent();

		// エージェント初期化時の処理
		connect.agent(subscribeAgentEvent);

		// 通話初期化時の処理
		connect.contact(subscribeContactEvent);

		// 録音の初期化
		initializeRecording();

		// サインインボタンの初期化
		initializeSigninButton();
	}

	/**
	 * 録音環境を初期化します。
	 */
	function initializeRecording() {
		// https://dev.mozilla.jp/2016/04/record-almost-everything-in-the-browser-with-mediarecorder/
		if(window.MediaRecorder === undefined) {
			logger.warn('MediaRecorder is not supported.');
			return;
		}

		if (!navigator.mediaDevices) {
			logger.warn('navigator.mediaDevices is not supported.');
			return;
		}

		// お客様側の音声を録音するための要素の確認
		remoteAudio = getValidatedElement(config.remoteAudioId, 'AUDIO');
		if (!remoteAudio) {
			logger.warn('Not found remote audio element. (ID: %s)', config.remoteAudioId);
			return;
		}

		getLocalMediaStream();
	}

	/**
	 * オペレータ側のメディアストリームの取得を試行します。
	 * Google Chrome で画面を開いた直後だと失敗することがあったので、自動リトライするようにしています。
	 */
	async function getLocalMediaStream() {
		try {
			localMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
			isRecordingEnabled = true;
			logger.debug('Got local media stream.');				
		} catch (error) {
			isRecordingEnabled = false;
			logger.warn('Failed to get local media stream.').withException(error);
			setTimeout(tryGetUserMedia, config.getUserMediaInterval);
		}
	}

	/**
	 * サインインボタンを初期化します。
	 * サインインの処理については、{@link https://dev.classmethod.jp/cloud/aws/amazon-connect-streams-login-button/} を参考にしています。
	 */
	function initializeSigninButton() {
		const signinButton = getValidatedElement(config.signinButtonId, 'BUTTON');
		if (!signinButton) {
			logger.warn('Not found signin button element. (ID: %s)', config.signinButtonId);						
			return;
		}

		signinButton.addEventListener('click', () => {
			signinWindowHandle = window.open(config.signinUrl);
		});
	}

	/**
	 * IDに対応した要素を、タグ名も検証してから取得します。
	 * @param {string} id ID。
	 * @param {string} tagName タグ名。
	 * @returns {HTMLElement} タグ名が一致し、IDに対応した要素。
	 */
	function getValidatedElement(id, tagName) {
		const element = document.getElementById(id);
		if (!element) {
			logger.debug('Not found element. (ID: %s)', id);
			return null;
		}

		// タグ名が未指定の場合は検証しません。
		if (!tagName) {
			return element;
		}

		if (element.tagName !== tagName) {
			logger.debug('Not match element tag name. (ID: %s, Expected tag name: %s, Actual tag name: %s)', id, tagName, element.tagName);
			return null;
		}

		return element;
	}

	/**
	 * 低レベルのイベントを購読します。
	 * サインイン処理のために、いくつかのイベントで処理を行っています。
	 */
	function subscribeLowLevelEvent() {
		const bus = connect.core.getEventBus();

		/* CCP全体に関する低レベルのイベント */
		// bus.subscribe(connect.EventType.ACKNOWLEDGE, ()=>{});
		// bus.subscribe(connect.EventType.ACK_TIMEOUT, ()=>{});
		// bus.subscribe(connect.EventType.API_REQUEST, ()=>{});
		// bus.subscribe(connect.EventType.API_RESPONSE, ()=>{});
		// bus.subscribe(connect.EventType.AUTH_FAIL, ()=>{});
		// bus.subscribe(connect.EventType.ACCESS_DENIED, ()=>{});		
		// bus.subscribe(connect.EventType.CLOSE, ()=>{});
		// bus.subscribe(connect.EventType.CONFIGURE, ()=>{});
		// bus.subscribe(connect.EventType.LOG, ()=>{});
		// bus.subscribe(connect.EventType.MASTER_REQUEST, ()=>{});
		// bus.subscribe(connect.EventType.MASTER_RESPONSE, ()=>{});
		// bus.subscribe(connect.EventType.SYNCHRONIZE, ()=>{});
		// bus.subscribe(connect.EventType.TERMINATE, ()=>{});		
		bus.subscribe(connect.EventType.TERMINATED, () => {
			// リロードしないと、サインアウト後の再サインイン時にイベントが取得できないとのこと。
			location.reload();
		});
		// bus.subscribe(connect.EventType.SEND_LOGS, ()=>{});
		// bus.subscribe(connect.EventType.RELOAD_AGENT_CONFIGURATION, ()=>{});
		// bus.subscribe(connect.EventType.BROADCAST,()=>{});
		// bus.subscribe(connect.EventType.API_METRIC, ()=>{});
		// bus.subscribe(connect.EventType.CLIENT_METRIC, ()=>{});
		// bus.subscribe(connect.EventType.MUTE, ()=>{});
		
		/* エージェントに関する低レベルのイベント */
		bus.subscribe(connect.AgentEvents.INIT, () => {
			// サインインボタンを隠します。
			const signinButton = document.getElementById(config.signinButtonId);
			if (signinButton != null) {
				signinButton.style.display = 'none';
			}

			// サインインウインドウが開いていれば閉じます。
			if (signinWindowHandle) {
				signinWindowHandle.close();
				signinWindowHandle = null;
			}
		});
		// bus.subscribe(connect.AgentEvents.UPDATE, ()=>{});
		// bus.subscribe(connect.AgentEvents.REFRESH, ()=>{});
		// bus.subscribe(connect.AgentEvents.ROUTABLE, ()=>{});
		// bus.subscribe(connect.AgentEvents.NOT_ROUTABLE, ()=>{});
		// bus.subscribe(connect.AgentEvents.PENDING, ()=>{});
		// bus.subscribe(connect.AgentEvents.CONTACT_PENDING, ()=>{});
		// bus.subscribe(connect.AgentEvents.OFFLINE, ()=>{});
		// bus.subscribe(connect.AgentEvents.ERROR, ()=>{});
		// bus.subscribe(connect.AgentEvents.SOFTPHONE_ERROR, ()=>{});
		// bus.subscribe(connect.AgentEvents.STATE_CHANGE, ()=>{});
		// bus.subscribe(connect.AgentEvents.ACW, ()=>{});
		// bus.subscribe(connect.AgentEvents.MUTE_TOGGLE, ()=>{});

		/* 問い合わせに関する低レベルのイベント */
		// bus.subscribe(connect.ContactEvents.INIT, ()=>{});
		// bus.subscribe(connect.ContactEvents.REFRESH, ()=>{});
		// bus.subscribe(connect.ContactEvents.DESTROYED, ()=>{});
		// bus.subscribe(connect.ContactEvents.INCOMING, ()=>{});
		// bus.subscribe(connect.ContactEvents.PENDING, ()=>{});
		// bus.subscribe(connect.ContactEvents.CONNECTING, ()=>{});
		// bus.subscribe(connect.ContactEvents.CONNECTED, ()=>{});
		// bus.subscribe(connect.ContactEvents.MISSED, ()=>{});
		// bus.subscribe(connect.ContactEvents.ACW, ()=>{});
		// bus.subscribe(connect.ContactEvents.VIEW, ()=>{});		
		// bus.subscribe(connect.ContactEvents.ENDED, ()=>{});
		// bus.subscribe(connect.ContactEvents.ERROR, ()=>{});
		// bus.subscribe(connect.ContactEvents.ACCEPTED, ()=>{});		
	}

	/**
	 * エージェントイベントを購読します。
	 * @param {connect.Agent} agent エージェント。
	 */
	function subscribeAgentEvent(agent) {
		logger.debug('Agent event. (Event type: Init)').withObject(getAgentData(agent));

		agent.onContactPending((agent) => {
			logger.debug('Agent event. (Event type: ContactPending)').withObject(getAgentData(agent));
		});
		agent.onRefresh((agent) => {
			logger.debug('Agent event. (Event type: Refresh)').withObject(getAgentData(agent));
		});
		agent.onRoutable((agent) => {
			logger.debug('Agent event. (Event type: Routable)').withObject(getAgentData(agent));
		});
		agent.onNotRoutable((agent) => {
			logger.debug('Agent event. (Event type: NotRoutable)').withObject(getAgentData(agent));
		});
		agent.onOffline((agent) => {
			logger.debug('Agent event. (Event type: Offline)').withObject(getAgentData(agent));
		});
		agent.onError((agent) => {
			logger.debug('Agent event. (Event type: Error)').withObject(getAgentData(agent));
		});
		agent.onAfterCallWork((agent) => {
			logger.debug('Agent event. (Event type: AfterCallWork)').withObject(getAgentData(agent));
		});
		agent.onSoftphoneError((agent) => {
			logger.debug('Agent event. (Event type: SoftphoneError)').withObject(getAgentData(agent));
		});
		agent.onStateChange((agentStateChange) => {
			if (agentStateChange) {
				logger.debug('Agent event. (Event type: StateChange)').withObject({
					agent: getAgentData(agentStateChange.agent),
					oldState : agentStateChange.oldState,
					newState : agentStateChange.newState,
				});
			} else {
				logger.debug('Agent event. (Event type: StateChange)');
			}
		});
		agent.onMuteToggle((obj) => {
			logger.debug('Agent event. (Event type: MuteToggle[%s])', obj.muted);
		});
	}

	/**
	 * エージェントのデータを取得します。
	 * @param {connect.Agent} agent エージェント。
	 * @returns {object} エージェントのデータ。
	 */
	function getAgentData(agent) {
		if (agent == null) {
			return null;
		}

		const state = agent.getState();
		const stateDuration = agent.getStateDuration();
		// const permissions = agent.getPermissions(); // getConfiguration().permissions なので必要ありません。
		let contactCount = 0;
		const contacts = agent.getContacts;
		if (contacts) {
			contactCount = contacts.length;
		}
		const configuration = agent.getConfiguration();
		// const agentStates = agent.getAgentStates(); // getConfiguration().agentStates なので必要ありません。
		// const routingProfile = agent.getRoutingProfile(); // getConfiguration().routingProfile なので必要ありません。
		// const name = agent.getName(); // getConfiguration().name なので必要ありません。
		// const extension = agent.getExtension(); // getConfiguration().extension なので必要ありません。
		// const dialableCountries = agent.getDialableCountries(); // getConfiguration().dialableCountries なので必要ありません。
		// const isSoftphoneEnabled = agent.isSoftphoneEnabled(); // getConfiguration().softphoneEnabled なので必要ありません。
		return {
			state: state,
			stateDuration: stateDuration,
			contactCount: contactCount, // 問い合わせのデータは別に出力しているので、件数だけ出力します。
			configuration: configuration,
		};
	}

	/**
	 * 問い合わせイベントを購読します。
	 * @param {connect.Contact} contact 問い合わせ。
	 */
	function subscribeContactEvent(contact) {
		logger.debug('Contact event. (Event type: Init)').withObject(getContactData(contact));

		contact.onRefresh((contact) => {
			logger.debug('Contact event. (Event type: Refresh)').withObject(getContactData(contact));
		});
		contact.onIncoming((contact) => {
			logger.debug('Contact event. (Event type: Incoming)').withObject(getContactData(contact));
		});
		contact.onConnecting((contact) => {
			logger.debug('Contact event. (Event type: Connecting)').withObject(getContactData(contact));
		});
		contact.onPending((contact) => {
			logger.debug('Contact event. (Event type: Pending)').withObject(getContactData(contact));
		});
		contact.onAccepted((contact) => {
			logger.debug('Contact event. (Event type: Accepted)').withObject(getContactData(contact));
		});
		contact.onMissed((contact) => {
			logger.debug('Contact event. (Event type: Missed)').withObject(getContactData(contact));
		});
		contact.onEnded((contact) => {
			logger.debug('Contact event. (Event type: Ended or destroyed)').withObject(getContactData(contact));
			if (contact.getType() === 'voice') {
				stopAudioProcess(contact.getContactId());
			}
		});
		contact.onACW((contact) => {
			logger.debug('Contact event. (Event type: ACW)').withObject(getContactData(contact));
		});
		contact.onConnected((contact) => {
			logger.debug('Contact event. (Event type: Connected)').withObject(getContactData(contact));
			if (contact.getType() === 'voice') {
				startAudioProcess(contact.getContactId());
			}
		});
	}

	/**
	 * 問い合わせのデータを取得します。
	 * @param {connect.Contact} contact 問い合わせ。
	 * @returns {object} 問い合わせのデータ。
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
		let initialConnectionId;
		let activeInitialConnectionId;
		let thirdPartyConnectionIds;
		let singleActiveThirdPartyConnectionId;
		let agentConnectionId;
		const attributes = contact.getAttributes();
		let isSoftphoneCall
		let isInbound;
		// const isConnected = contact.isConnected(); // getStatus().type === 'connected' なので必要ありません。
		let isDestroyed = false;

		// Destroyed 時は Connection の情報取得時に例外が発生するので、catch して回避しています。
		// 今のところ catch 以外に判別する方法が見つかっていません。
		try {
			connections = getConnectionsData(contact.getConnections());
			initialConnectionId = getConnectionId(contact.getInitialConnection()); // = connection.isInitialConnection() == true
			activeInitialConnectionId = getConnectionId(contact.getActiveInitialConnection()); // = connection.isInitialConnection() == true && connection.isActive() == true
			thirdPartyConnectionIds = getConnectionIds(contact.getThirdPartyConnections()); // = connection.isInitialConnection() == false && connection.getType() !== 'agent'
			singleActiveThirdPartyConnectionId = getConnectionId(contact.getSingleActiveThirdPartyConnection()); // = getThirdPartyConnections() から最初の connection.isActive() == true
			agentConnectionId = getConnectionId(contact.getAgentConnection()); // = connection.getType() === 'agent' || connection.getType() === 'monitoring'
			isSoftphoneCall = contact.isSoftphoneCall(); // connection.getSoftphoneMediaInfo() != null が 1 個でもある
			isInbound = contact.isInbound(); // = getInitialConnection().connection.getType() === 'inbound'
		} catch (error) {
			isDestroyed = true;
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
			initialConnectionId: initialConnectionId,
			activeInitialConnectionId: activeInitialConnectionId,
			thirdPartyConnectionIds: thirdPartyConnectionIds,
			singleActiveThirdPartyConnectionId: singleActiveThirdPartyConnectionId,
			agentConnectionId: agentConnectionId,
			attributes: attributes,
			isSoftphoneCall: isSoftphoneCall,
			isInbound: isInbound,
			isDestroyed: isDestroyed,
		};
	}

	/**
	 * コネクションのデータの一覧を取得します。
	 * @param {connect.Connection[]} connections コネクションの一覧。
	 * @returns {object[]} コネクションのデータの一覧。
	 */
	function getConnectionsData(connections) {
		if (!connections) {
			return null;
		}

		const connectionDataList = [];
		connections.forEach((i) => {
			connectionDataList.push(getConnectionData(i));
		});
		return connectionDataList;
	}

	/**
	 * コネクションのデータを取得します。
	 * @param {connect.Connection} connection コネクション。
	 * @returns {object} コネクションのデータ。
	 */
	function getConnectionData(connection) {
		if (!connection) {
			return null;
		}

		const contactId = connection.getContactId();
		const connectionId = connection.getConnectionId();
		const endpoint = connection.getEndpoint();
		const status = connection.getStatus();
		const statusDuration = connection.getStatusDuration();
		const type = connection.getType();
		const isInitialConnection = connection.isInitialConnection();
		// const isActive = connection.isActive(); // getStatus().type === 'connecting' || getStatus().type === 'connected' || getStatus().type === 'hold' なので必要ありません。
		// const isConnected = connection.isConnected(); // getStatus().type === 'connected' なので必要ありません。
		// const isConnecting = connection.isConnecting(); // getStatus().type === 'connecting' なので必要ありません。
		// const isOnHold = connection.isOnHold(); // getStatus().type === 'hold' なので必要ありません。
		// const softphoneMediaInfo = connection.getSoftphoneMediaInfo(); // サイズの割に見ることが少ないので弾いています。
		return {
			contactId: contactId,
			connectionId: connectionId,
			endpoint: endpoint,
			status: status,
			statusDuration: statusDuration,
			type: type,
			isInitialConnection: isInitialConnection,
		};
	}

	/**
	 * コネクションIDの一覧を取得します。
	 * @param {connect.Connection[]} connections コネクションの一覧。
	 * @returns {string[]} コネクションIDの一覧。
	 */
	function getConnectionIds(connections) {
		if (!connections) {
			return null;
		}

		const connectionIdList = [];
		connections.forEach((i) => {
			connectionIdList.push(getConnectionId(i));
		});
		return connectionIdList;
	}

	/**
	 * コネクションIDを取得します。
	 * @param {connect.Connection} connection コネクション。
	 * @returns {string} コネクションID。
	 */
	function getConnectionId(connection) {
		if (!connection) {
			return null;
		}

		return connection.getConnectionId();
	}

	/**
	 * 音声処理を開始します。
	 */
	function startAudioProcess(contactId) {
		if (!isRecordingEnabled) {
			logger.warn('Can\'t start recording because local media stream is disabled.');				
			return;
		}

		if (!contactId) {
			logger.warn('Can\'t start recording because not found contact ID.');
			return;
		}

		if (!recordingContactId) {
			recordingContactId = contactId;
		} else if (recordingContactId !== contactId) {
			logger.debug('Stop previous recording. (Contact ID: %s)', contactId);
			stopAudioProcess(recordingContactId);
			recordingContactId = contactId;
		} else {
			logger.warn('Already started recording. (Contact ID: %s)', contactId);
			return;
		}

		if (!audioContext) {
			audioContext = new AudioContext();
		}

		// 録音の開始
		localRecorder = new AudioRecorder(
			localMediaStream,
			config.localRecordAudioId,
			config.localRecordDownloadId,
			'Local');
		remoteRecorder = new AudioRecorder(
			remoteAudio.srcObject, // 通話が確立してからでないと取得できないはず
			config.remoteRecordAudioId,
			config.remoteRecordDownloadId,
			'Remote');
		localRecorder.start();
		remoteRecorder.start();

		// 描画の開始
		localPainter = new AudioPainter(
			audioContext,
			localMediaStream,
			config.localRecordCanvasId,
			config.localRecordCanvasColor);
		remotePainter = new AudioPainter(
			audioContext,
			remoteAudio.srcObject, // 通話が確立してからでないと取得できないはず
			config.remoteRecordCanvasId,
			config.remoteRecordCanvasColor);
		localPainter.start();
		remotePainter.start();
	}

	/**
	 * 音声処理を停止します。
	 */
	function stopAudioProcess(contactId) {
		if (!isRecordingEnabled) {
			return;
		}

		if (!contactId) {
			logger.warn('Can\'t stop recording because not found contact ID.');
			return;
		}

		// 今録音中の通話ではない場合は、録音を停止しません。
		if (recordingContactId && recordingContactId !== contactId) {
			logger.warn('Can\'t stop recording because not match contact ID. (Current contact ID: %s, Target contact ID: %s)', recordingContactId, contactId);
			return;
		}

		recordingContactId = null;

		if (localPainter) {
			localPainter.stop();
		}

		if (remotePainter) {
			remotePainter.stop();
		}		

		if (localRecorder) {
			localRecorder.stop();
		}

		if (remoteRecorder) {
			remoteRecorder.stop();
		}
	}

	/**
	 * 音声の録音を行うクラスです。
	 * MediaRecorderの使い方については、{@link https://qiita.com/ru_shalm/items/0930aedad12c4e100446} を参考にしています。
	 */
	class AudioRecorder {
		/**
		 * コンストラクタ。
		 * @param {MediaStream} mediaStream メディアストリーム。
		 * @param {string} audioId 音声を再生するaudio要素のID。
		 * @param {string} downloadId ダウンロードするa要素のID。
		 * @param {string} label ログ出力用のラベル。
		 */
		constructor(mediaStream, audioId, downloadId, label) {
			this.mediaRecorder = new MediaRecorder(mediaStream);
			this.chunks = [];
			this.audio = getValidatedElement(audioId, 'AUDIO');
			this.download = getValidatedElement(downloadId, 'A');
			this.label = label;

			// 録音開始時の処理
			this.mediaRecorder.addEventListener('start', () => {
				logger.debug('[%s] Start audio recording.', this.label);
			});

			// 一定時間ごとの録音データの処理
			this.mediaRecorder.addEventListener('dataavailable', (e) => {
				this.chunks.push(e.data);
			});
			
			// 録音終了時の処理
			this.mediaRecorder.addEventListener('stop', () => {
				logger.debug('[%s] Stop audio recording.', this.label);				

				// 音声のURLの解放
				if (this.blobUrl) {
					if (this.audio) {
						this.audio.src = null;
					}

					if (this.download) {
						this.download.removeAttribute('href');
					}

					URL.revokeObjectURL(this.blobUrl);
					logger.debug('[%s] Revoked audio URL. (URL: %s)', this.label, this.blobUrl);
					this.blobUrl = null;
				}

				if (this.chunks.length === 0) {
					logger.debug('[%s] Chunks is empty.', this.label);
					return;
				}

				// 貯めていたデータをひと固まりにまとめます。
				const blob = new Blob(this.chunks, { type: this.chunks[0].type });
				logger.debug('[%s] Combined blob. (Size: %d, Type: %s)', this.label, blob.size, blob.type);

				// 音声のURLを生成します。
				this.blobUrl = URL.createObjectURL(blob);
				logger.debug('[%s] Created audio URL. (URL: %s)', this.label, this.blobUrl);

				// Audio 要素にURLを設定すれば再生できます。
				if (this.audio) {
					this.audio.src = this.blobUrl;
				}

				// リンクにURLを設定すればダウンロードできます。
				if (this.download) {
					this.download.href = this.blobUrl;
				}
			});
		}

		/**
		 * 録音を開始します。
		 * @param {number} timeslice 録音データの処理間隔。
		 */
		start(timeslice) {
			if (this.mediaRecorder) {
				this.mediaRecorder.start(timeslice);
			} else {
				logger.warn('[%s] Can\'t start to record audio because already finished.');
			}
		}

		/**
		 * 録音を停止します。
		 */
		stop() {
			try {
				if (this.mediaRecorder) {
					this.mediaRecorder.stop();
				}
			} catch (error) {
				logger.warn('[%s] Can\'t stop to record audio because already inactive.').withException(error);
			} finally {
				this.mediaRecorder = null;
			}
		}
	}

	/**
	 * 音声の描画を行うクラスです。
	 */
	class AudioPainter {
		/**
		 * コンストラクタ。
		 * @param {AudioContext} audioContext 音声コンテキスト。
		 * @param {MediaStream} mediaStream メディアストリーム。
		 * @param {string} canvasId 周波数の波形を表示するcanvas要素のID。
		 * @param {string} color 描画色。
		 */
		constructor(audioContext, mediaStream, canvasId, color) {
			const canvasElement = getValidatedElement(canvasId, 'CANVAS');			
			
			// 描画先が無ければ何もしません。
			if (!canvasElement) {
				return;
			}

			this.audioSourceNode = audioContext.createMediaStreamSource(mediaStream);
			this.analyserNode = audioContext.createAnalyser();
			this.analyserNode.fftSize = 256;
			this.audioSourceNode.connect(this.analyserNode);

			const bufferLength = this.analyserNode.frequencyBinCount;
			const dataArray = new Uint8Array(bufferLength);			
			const canvasContext = canvasElement.getContext('2d');
			canvasContext.strokeStyle = color;
			canvasContext.fillStyle = color;
			canvasContext.lineWidth = 1;
			const canvasHeight = canvasElement.height;
			const canvasWidth = canvasElement.width;
			this.draw = () => {
				if (this.draw) {
					// 録音中は再描画します。
					requestAnimationFrame(this.draw);
				} else {
					// 録音が停止したらキャンパスをクリアします。
					canvasContext.clearRect(0, 0, canvasWidth, canvasHeight);
					return;
				}

				// 周波数データを配列にコピーする
				this.analyserNode.getByteFrequencyData(dataArray);

				canvasContext.clearRect(0, 0, canvasWidth, canvasHeight);
				canvasContext.beginPath();
				canvasContext.moveTo(0, canvasHeight);
				dataArray.forEach((element, index) => {
					canvasContext.lineTo((index / bufferLength) * canvasWidth, canvasHeight - ((element / 255.0) * canvasHeight));
				});
				canvasContext.lineTo(canvasWidth, canvasHeight);         
				canvasContext.closePath();
				canvasContext.fill();
				canvasContext.stroke();
			};
		}

		/**
		 * 描画を開始します。
		 */
		start() {
			if (this.draw) {
				this.draw();
			}			
		}

		/**
		 * 描画を停止します。
		 */
		stop() {
			this.draw = null;

			if (this.audioSourceNode) {
				this.audioSourceNode.disconnect();
			}

			this.audioSourceNode = null;
			
			if (this.analyserNode) {
				this.analyserNode.disconnect();
			}
			
			this.analyserNode = null;
		}
	}

	// onload 時に初期化します。
	window.addEventListener('load', initialize, {
		once: true,
		passive: false,
		capture: false,
	});
})();
