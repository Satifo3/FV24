# Frame Viewer 24

アニメーション参考動画を **1秒 = 24コマ** 基準でコマ送りする、GitHub Pages対応の静的Webアプリです。

## 機能

- MP4 / WebM / MOV（ブラウザ対応コーデックのみ）読み込み
- GIF読み込み
- 24fps基準で1Fずつ表示
- 1F / 2F / 3F / 6F送り
- 左右キーでコマ送り
- Spaceで24fps再生 / 停止
- 「秒 + コマ」表示
- 現在フレームをPNG保存
- ドラッグ＆ドロップ
- PC / iPhone / iPad向けレスポンシブUI

## GitHub Pagesで公開する方法

1. GitHubで新しいRepositoryを作成
2. このフォルダ内の `index.html` `style.css` `app.js` をRepository直下へアップロード
3. GitHubの `Settings` → `Pages`
4. `Build and deployment` の Source を `Deploy from a branch`
5. Branchを `main`、Folderを `/(root)` にして Save
6. 数分後に表示されるURLを開く

## 注意点

動画はブラウザの動画デコーダーを利用しているため、MP4でもコーデックによっては読み込めない場合があります。
安定性を優先する場合は H.264 + AAC のMP4、またはWebMがおすすめです。

現在の動画コマ送りは「24fpsの時刻位置へシーク」する方式です。
編集ソフト級の完全なフレーム精度が必要な場合は、将来的にWebCodecs / FFmpeg.wasm版へ拡張できます。

GIF解析には CDN 版 `gifuct-js` を使用しています。そのためGIF利用時はインターネット接続が必要です。


## v1.1 修正

- 動画/GIF読み込み後に「24」「動画またはGIFを読み込んでください」等の初期案内が重ならないよう修正
- フレーム情報HUDは初期状態でOFF
- PNG保存を改善
  - 対応PCブラウザ: 保存先ダイアログからフォルダを選択
  - iPhone/iPad: 共有シートを開き「ファイルに保存」から保存先を選択
  - 非対応環境: 通常ダウンロードへ自動フォールバック

### iPhone/iPadの制約

Safari等のWebアプリは、WebサイトからiPhone内の任意フォルダへ直接書き込むことはできません。
そのため「保存先を選んでPNG保存」→ iOS共有シート →「ファイルに保存」の順で保存先を指定します。
