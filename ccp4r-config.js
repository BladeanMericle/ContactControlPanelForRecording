(function() {
	const global = this;
	ccp4r = global.ccp4r || {};
	global.ccp4r = ccp4r;
	ccp4r.config = {};

	/**
	 * Amazon Connectのインスタンス名。
	 * @type {string}
	 */
	const instanceName = '(インスタンス名)';

	/**
	 * ログインに使用するURL。
	 * @type {string}
	 */
	ccp4r.config.loginUrl = 'https://' + instanceName + '.awsapps.com/connect/login?';

	/**
	 * Contact Control PanelのURL。
	 * @type {string}
	 */
	ccp4r.config.ccpUrl = 'https://' + instanceName + '.awsapps.com/connect/ccp-v2#/';

	/**
	 * ファイル出力のログレベルです。
	 * "CRITICAL"、"ERROR"、"WARN"、"LOG"、"INFO"、"DEBUG"、"TRACE"、"TEST"のいずれかを設定してください。
	 * @type {string}
	 */
	ccp4r.config.logLevel = 'DEBUG';

	/**
	 * 音声の受信間隔（ミリ秒）。
	 * @type {number}
	 */
	ccp4r.config.timeslice = 2000;

	/**
	 * メディアストリームの取得間隔（ミリ秒）。
	 * @type {number}
	 */
	ccp4r.config.getUserMediaInterval = 5000;

	/**
	 * Contact Control Panelを表示するdiv要素のID。
	 * @type {string}
	 */
	ccp4r.config.containerDivId = 'container-div';

	/**
	 * ログインボタンのbutton要素のID。
	 * @type {string}
	 */
	ccp4r.config.loginButtonId = 'login-button';

	/**
	 * お客様側の音声の取得に使用するaudio要素のID。
	 * 設定は用意しましたが、このIDはAWSのライブラリが要求しているものです。
	 * 変更すると録音できなくなります。
	 * @type {string}
	 */
	ccp4r.config.remoteAudioId = 'remote-audio';

	/**
	 * オペレーター側の録音音声のaudio要素のID。
	 * 存在しなくても録音処理は行なえます。
	 * @type {string}
	 */
	ccp4r.config.localRecordAudioId = 'local-record-audio';

	/**
	 * オペレーター側の録音音声のa要素のID。
	 * 存在しなくても録音処理は行なえます。
	 * @type {string}
	 */
	ccp4r.config.localRecordDownloadId = 'local-record-download';

	/**
	 * オペレーター側の録音音声のcanvas要素のID。
	 * 存在しなくても録音処理は行なえます。
	 * @type {string}
	 */
	ccp4r.config.localRecordCanvasId = 'local-record-canvas';

	/**
	 * オペレーター側の録音音声のcanvas要素の描画色。
	 * @type {string}
	 */
	ccp4r.config.localRecordCanvasColor = '#3CB371';

	/**
	 * お客様側の録音音声のaudio要素のID。
	 * 存在しなくても録音処理は行なえます。
	 * @type {string}
	 */
	ccp4r.config.remoteRecordAudioId = 'remote-record-audio';

	/**
	 * お客様側の録音音声のa要素のID。
	 * 存在しなくても録音処理は行なえます。
	 * @type {string}
	 */
	ccp4r.config.remoteRecordDownloadId = 'remote-record-download';

	/**
	 * お客様側の録音音声のcanvas要素のID。
	 * 存在しなくても録音処理は行なえます。
	 * @type {string}
	 */
	ccp4r.config.remoteRecordCanvasId = 'remote-record-canvas';

	/**
	 * お客様側の録音音声のcanvas要素の描画色。
	 * @type {string}
	 */
	ccp4r.config.remoteRecordCanvasColor = '#FFA07A';	
})();
