# Contact Control Panel for Recording

## 概要

「[AWS音声活用術！Amazon Connect実践入門](https://nextpublishing.jp/book/11777.html)」のサンプルコードです。

Amazon ConnectのContact Control Panelの機能を拡張し、通話の音声を録音できるようにしました。



## 環境構築

### Webサーバー側

1. ソースコードをダウンロードします。
2. "ccp4r-config.js"にあるinstanceNameという変数に、Amazon Connectのインスタンス名を設定します。
3. Webサーバーにhttpsで公開します。

### Amazon Connect側

1. AWSマネジメントコンソールにログインします。
2. Amazon Connectのホーム画面を開き、インスタンスエイリアスのリンクをクリックします。
3. [アプリケーション統合]をクリックします。
4. [オリジンの追加]をクリックします。
5. Webサーバのドメイン名またはポート番号までを入力し、[追加]をクリックします。
   - 最後に"/"があると追加できないのでご注意ください。



## 使用方法

1. ご利用の端末にヘッドセットを接続します。
2. 最新のMozilla FirefoxかGoogle Chromeで、Webサーバーに配置した"index.html"を開きます。
3. Webブラウザからマイクの使用許可を尋ねられた場合は許可します。
4. [ログイン]ボタンをクリックします。
5. タブが追加され、そこにAmazon Connectのログイン画面が表示されます。
   いつも通り[ユーザー名]と[パスワード]を入力し、[サインイン]をクリックします。
6. ログインが成功してから少し待つとタブが削除され、元の画面に戻ります。
7. CCPの画面が表示されているので、いつも通り通話を行います。
8. 通話が完了すると、直前の通話の内容がそのまま再生されます。
   音声のコントローラーを操作すれば、オペレーター側とお客様側で別々に聞くこともできます。
   ダウンロードのリンクから音声をダウンロードすることもできます。



## 開発者向け情報

### ライブラリのバージョン

- Amazon Connect Streams API: 1.4.3
- Amazon Connect connect-rtc-js: 1.1.5

### グローバル変数

- Amazon Connect Streams API: connect
- Contact Control Panel for Recording: ccp4r

### 関数

- ccp4r.clearLog(): Amazon Connect Streams API内に蓄積されているログをすべて削除します。
  通話の動作確認を行う前に実行することを想定していて、余計なログが入り込まないようにすることを目的としています。
- ccp4r.downloadLog(fileName): Amazon Connect Streams API内に蓄積されているログをダウンロードします。
  引数でファイル名を指定しない場合、ファイル名は"ccp4r.json"となります。
  ファイル形式はJSONです。



## 更新履歴

### 0.1.12

- ログのダウンロード時に生成したURLを明示的に開放するように修正しました。

### 0.1.11

- サインインの文言をログインに変更しました。機能的な変更はありません。

### 0.1.1

- チャットの開始・終了で音声の録音が反応しないよう修正しました。
- ログのダウンロードでファイル名を指定できるようにしました。
- ログのダウンロードでログレベルの設定が反映されるようにしました。

### 0.1.0

- ソースコードを全体的に見直しました。
- ログ出力をAmazon Connect Streams APIの機能を使う方式に変更しました。
- 周波数スペクトルをリアルタイムで表示する機能を追加しました。
- マイク機能を単体でテストするためのページを追加しました。

### 0.0.1

- 初期バージョンです。
