(function() {
	const global = this;
	ccp4r = global.ccp4r || {};
	global.ccp4r = ccp4r;
	ccp4r.config = {};

	/**
	 * Amazon Connect のインスタンス名。
	 * @type {string}
	 */
	const instanceName = '(インスタンス名)';

	/**
	 * ログインに使用する URL。
	 * @type {string}
	 */
	ccp4r.config.loginUrl = 'https://' + instanceName + '.awsapps.com/connect/login?';

	/**
	 * Contact Control Panel の URL。
	 * @type {string}
	 */
	ccp4r.config.ccpUrl = 'https://' + instanceName + '.awsapps.com/connect/ccp-v2#/';

	/**
	 * 音声の受信間隔（ミリ秒）。
	 * @type {number}
	 */
	ccp4r.config.timeslice = 2000;

	/**
	 * Contact Control Panel を表示する div 要素の ID。
	 * @type {string}
	 */
	ccp4r.config.containerDivId = 'container-div';

	/**
	 * ログインボタンの button 要素の ID。
	 * @type {string}
	 */
	ccp4r.config.loginButtonId = 'login-button';

	/**
	 * 通話相手側の音声を録音する audio 要素の ID。
	 * 設定は用意しましたが、この ID は Amazon 製のライブラリが要求しているものなので、変更すると録音できなくなります。
	 * @type {string}
	 */
	ccp4r.config.remoteAudioId = 'remote-audio';

	/**
	 * オペレータ側録音音声の audio 要素の ID。
	 * 存在しなくても録音処理は行なえます。
	 * @type {string}
	 */
	ccp4r.config.localRecordAudioId = 'local-record-audio';

	/**
	 * オペレータ側録音音声の a 要素の ID。
	 * 存在しなくても録音処理は行なえます。
	 * @type {string}
	 */
	ccp4r.config.localRecordDownloadId = 'local-record-download';

	/**
	 * お客様側録音音声の audio 要素の ID。
	 * 存在しなくても録音処理は行なえます。
	 * @type {string}
	 */
	ccp4r.config.remoteRecordAudioId = 'remote-record-audio';

	/**
	 * お客様側録音音声の a 要素の ID。
	 * 存在しなくても録音処理は行なえます。
	 * @type {string}
	 */
	ccp4r.config.remoteRecordDownloadId = 'remote-record-download';	
})();
