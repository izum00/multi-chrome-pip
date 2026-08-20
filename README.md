> [!WARNING]
> ## **Videos protected by EME/DRM, such as those on `youtube.com`, are not supported because `captureStream()` cannot be used.**

# Pseudo-PiP Chrome Extension

From the right-click menu, select "Display in Pseudo-PiP." If the right-clicked element itself is a `<video>`, that video will be used; otherwise, a `<video>` inside the element will be detected and its video stream will be relayed in real time to a Chrome popup extension window.

## Installation

1. Open `chrome://extensions/` in Chrome.
2. Turn on "Developer mode."
3. Click "Load unpacked" and select this folder.
4. Right-click a video on a web page, or an element containing a video, and select "Display in Pseudo-PiP."

## How It Works

The extension obtains a MediaStream from the original page's video element using `captureStream()` and relays it to the extension window via WebRTC. This means it may also work with videos using `blob:` URLs whose direct video URLs cannot be copied.

## Limitations

* **Videos protected by EME/DRM, such as those on `youtube.com`, are not supported because `captureStream()` cannot be used.**
* Content scripts cannot be injected into Chrome-protected pages such as `chrome://`.
* The extension window is a normal Chrome popup window.

## Keeping the Pseudo-PiP Window Always on Top

We recommend using [Microsoft PowerToys] to keep the Pseudo-PiP window always on top.

It comes with many other useful features as well, so we highly recommend it. Press `ctrl + win + t` to keep the window always on top.

You can install it with `winget install --id Microsoft.PowerToys --source winget` or from [GitHub](https://github.com/microsoft/PowerToys/releases/).

## How to use
Keyboard Shortcuts

・Rewind 5 seconds: Left arrow key or 'j' key (can be held down)

・Fast-forward 5 seconds: Right arrow key or 'k' key (can be held down)

・Play/Pause: Space key or 'k' key

・Jump to positions dividing the video into 10 segments: Keys 0–9

・Toggle full screen: 'f' key

・Increase volume by 10%: Up arrow key

・Decrease volume by 10%: Down arrow key

・Toggle mute: 'm' key

・Slow down playback speed by 5%: ',' or '<' key

・Speed ​​up playback speed by 5%: '.' or '>' key


> [!WARNING]
> **EME/DRMで保護された `youtube.com` などの動画では `captureStream()` が使えないため非対応です。**
# 疑似PiP Chrome拡張機能

右クリックメニューの「疑似pipで表示」から、右クリックした要素そのものが `<video>` ならその動画を、そうでなければその要素内の `<video>` を検出し、Chromeのポップアップ型拡張機能ウィンドウへリアルタイム中継します。

## インストール

1. Chromeで `chrome://extensions/` を開く。
2. 「デベロッパーモード」をオンにする。
3. 「パッケージ化されていない拡張機能を読み込む」からこのフォルダを選ぶ。
4. Webページ上の動画、または動画を内包する要素を右クリックして「疑似pipで表示」を選ぶ。

## 仕組み

元ページの動画要素から `captureStream()` でMediaStreamを取得し、WebRTCを使って拡張機能ウィンドウへ中継します。

そのため、動画URLを直接コピーできない `blob:` URLの動画でも動作する可能性があります。

## 制限

- **EME/DRMで保護された`youtube.com`などの動画では `captureStream()` が使えないため非対応です。**
- Chromeの保護ページ（`chrome://` など）にはコンテンツスクリプトを注入できません。
- 拡張機能ウィンドウは通常のChromeポップアップウィンドウです。

## 疑似PiPウィンドウを最前面に固定する

最前面に疑似PiPウィンドウを表示するために、[Microsoft PowerToys]の使用を推奨します。

いろいろな機能も一緒に入っているのでお勧めです。`ctrl + win + t`でタブを最前面に固定できます。

インストールは `winget install --id Microsoft.PowerToys --source winget` または[Github](https://github.com/microsoft/PowerToys/releases/)からインストールできます。

## 使い方

キーボードショートカット

・5秒戻る：左矢印キーまたはjキー(長押し可)

・5秒進む：右矢印キーまたはkキー(長押し可)

・再生/一時停止：スペースキーまたはkキー

・開始～終了を10分割した位置に移動：0~9キー

・フルスクリーン切り替え：fキー

・音量を10%上げる：上向き矢印キー

・音量を10%下げる：下向き矢印キー

・ミュートの切り替え：mキー

・再生速度を5%遅くする：,または<キー

・再生速度を5%速くする：.または>キー
