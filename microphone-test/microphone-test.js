/**
 * WebRTC を使ったマイクの録音機能をテストします。
 */
(function() {
	const global = this;
	mtest = global.mtest || {};
	global.mtest = mtest;

    /**
     * 録音音声の canvas 要素の ID。
     * @type {string}
     */
    const recordCanvasId = 'record-canvas';

    /**
     * 録音音声の audio 要素の ID。
     * @type {string}
     */
    const recordAudioId = 'record-audio';

    /**
     * 録音音声の a 要素の ID。
     * @type {string}
     */    
    const recordDownloadId = 'record-download';

	/**
	 * メディアストリーム。
	 * @type {MediaStream}
	 */    
    let userMediaStream;

	/**
	 * メディアレコーダー。
	 * @type {MediaRecorder}
	 */
	let userMediaRecorder;

	/**
	 * 音声バイナリの一覧。
	 * @type {Blob[]}
	 */
	let userMediaChunks;

	/**
	 * 音声の URL。
	 * @type {string}
	 */
	let blobUrl;

    /**
     * 音声コンテキスト。
     * @type {AudioContext}
     */
    let audioContext;

    /**
     * 音声ソースノード。
     * @type {MediaStreamAudioSourceNode}
     */
    let audioSourceNode;

    /**
     * 音声解析ノード。
     * @type {AnalyserNode}
     */
    let analyserNode;

	/**
	 * 録音を開始します。
	 * @returns {string} 録音の開始に成功したかどうか。
	 */
	mtest.startRecording = async function() {
		// https://dev.mozilla.jp/2016/04/record-almost-everything-in-the-browser-with-mediarecorder/
		if (window.MediaRecorder === undefined) {
			console.log('MediaRecorder is not supported.');
			return false;
		}

		if (!navigator.mediaDevices)
		{
			console.log('navigator.mediaDevices is not supported.');
			return false;
		}

        if (!userMediaStream) {
            try {
                userMediaStream = await navigator.mediaDevices.getUserMedia({
                    audio: true
                });
            } catch (error) {
                console.log('Failed to get media stream.', error);
                return false;
            }    
        }

		userMediaRecorder = new MediaRecorder(userMediaStream);
		userMediaChunks = [];

        // キャンバスがあれば音声の波形を描画します。
        // https://www.petitmonte.com/javascript/web_camera_test.html
        const canvasElement = document.getElementById(recordCanvasId);
        if (canvasElement != null) {
            if (!audioContext) {
                audioContext = new AudioContext();
            }

            if (audioSourceNode) {
                audioSourceNode.disconnect();
            }
    
            audioSourceNode = audioContext.createMediaStreamSource(userMediaStream); 
    
            if (analyserNode) {
                analyserNode.disconnect();
            }
    
            analyserNode = audioContext.createAnalyser();
            analyserNode.fftSize = 128;
            const bufferLength = analyserNode.frequencyBinCount;
            console.log('bufferLength', bufferLength);            
            const dataArray = new Uint8Array(bufferLength);
            audioSourceNode.connect(analyserNode);

            const canvasContext = canvasElement.getContext('2d');
            canvasContext.strokeStyle = '#00FF00';
            canvasContext.fillStyle = '#00FF00';
            canvasContext.lineWidth = 1;
            const canvasHeight = canvasElement.height;
            const canvasWidth = canvasElement.width;
            const draw = () => {
                if (!userMediaRecorder) {
                    return;
                }

                requestAnimationFrame(draw);

                // 周波数データを配列にコピーする
                analyserNode.getByteFrequencyData(dataArray);

                canvasContext.clearRect(0, 0, canvasWidth, canvasHeight);
                canvasContext.beginPath();
                canvasContext.moveTo(0, canvasHeight);
                dataArray.forEach((element, index) => {
                    canvasContext.lineTo((index / bufferLength) * canvasWidth, canvasHeight - ((element / 255.0) * canvasHeight));
                });
                canvasContext.lineTo(canvasWidth, canvasHeight)                
                canvasContext.closePath();
                canvasContext.fill();
                canvasContext.stroke();
            };
            draw();
        }

        // 定期的に録音データが飛んでくるので貯めます        
		userMediaRecorder.addEventListener('dataavailable', (e) => {
			userMediaChunks.push(e.data);
		});

		userMediaRecorder.addEventListener('start', () => {
            console.log('Recording start.');        
		});

		// 録音終了時の処理
		userMediaRecorder.addEventListener('stop', () => {
			console.log('Recording stop.');

            const audioElement = document.getElementById(recordAudioId);
            const downloadElement = document.getElementById(recordDownloadId);

			// 音声の URL の解放
			if (blobUrl) {
				if (audioElement != null) {
					audioElement.src = null;
				}

				if (downloadElement != null) {
					downloadElement.removeAttribute('href');
				}

				window.URL.revokeObjectURL(blobUrl);
				console.log('Removed audio URL.', blobUrl);
				blobUrl = null;
			}

			if (userMediaChunks.length === 0) {
				console.log('Audio is empty.');
				return;
			}

			// 貯めていたデータをバイナリとしてひと固まりにまとめます。
			const blob = new Blob(userMediaChunks, { type: userMediaChunks[0].type });
			console.log('Combined blob.', JSON.stringify({
				size: blob.size,
				type: blob.type,
			}));

			// 音声の URL を生成します。※どこかで解放する必要があります。
			blobUrl = window.URL.createObjectURL(blob);
			console.log('Created audio URL.', blobUrl);

			// Audio 要素に URL を設定すれば再生できます。
			if (audioElement != null) {
				audioElement.src = blobUrl;
			}

			// リンクに URL を設定すればダウンロードできます。
			if (downloadElement != null) {
				downloadElement.href = blobUrl;
            }
		});

        try {
            // 録音の開始 (1秒間隔で取得)
            userMediaRecorder.start(1000);
            return true;            
        } catch (error) {
            return false;
        }
	}

	/**
	 * 録音を停止します。
	 */
	mtest.stopRecording = function() {
        if (!userMediaRecorder) {
            return;
        }

        try {
            userMediaRecorder.stop();            
        } catch (error) {
            // TODO ログ
        } finally {
            userMediaRecorder = null;
        }
    }
})();
