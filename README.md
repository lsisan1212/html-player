# HTML Player

單頁影片播放器，直接在任何瀏覽器播 **MKV / HEVC / AV1 / HDR**、多音軌、內嵌字幕 —— 唔需要轉檔、唔需要伺服器。

- 拖放或選檔即播
- **暫停時畫面變灰階並放大 10%，繼續播放自動回復彩色與原尺寸**
- 鍵盤：`←` / `→` 後退 / 前進 **5 秒**，`↑` / `↓` 音量 ±5%（靜音時按 `↑` 會自動解除靜音）
- 字幕：內嵌軌切換 + 「Add subtitle file…」外掛 `.srt` / `.vtt` / `.ass`
- 其他快捷鍵按 `?` 查看

## 技術

播放引擎是 [Movi Player](https://github.com/MrUjjwalG/movi-player)（Apache-2.0）的 `element.slim` 建置：
WebCodecs 硬解 + FFmpeg WASM 軟解，畫到 canvas；本頁只加了一層外殼（開檔 / 拖放 / 暫停灰階 + 放大 / 方向鍵）。

方向鍵：播放器自己把方向鍵綁在 **host 的 bubble 階段**（seek ±10s、音量 ±0.1），本頁在
`document` 的 **capture 階段**先一步攔下（`preventDefault` + `stopPropagation`），改成 seek ±5s、
音量 ±0.05，所以唔會兩邊同時觸發。

播放中不再顯示中央 ▶：播放器會在內部復原（frozen / stuck / spinner 切換）時把
`.movi-center-play-pause` 的 `movi-center-visible` 重新加上，畫面中間就會閃一下 ▶。
本頁用 `data-playing` 屬性 + shadow DOM 內的 `style` 在播放時把它壓住，暫停時照常可用。

控制列左下角的 ▶/⏸ 由播放器**內部狀態**驅動（`getState()` / `isPlaybackIntended()`），所以
每次快進／緩衝都會短暫翻成 ▶。本頁把 `updatePlayPauseIcon` 包一層，改用真正的 `paused` 判斷 ——
只要未暫停就一直顯示 ⏸。

外殼用 `player.shadowRoot` 直接改內部的 `canvas`（畫面本體）與 `.movi-subtitle-overlay`（字幕層），
暫停時落 `filter: grayscale(1)` 同 `transform: scale(1.1)`。縮放是**疊加**在播放器自己的 inline
transform 之上（例如 180° 旋轉的 `rotate(90deg) scale(1.1)`），所以旋轉功能不會被蓋掉。

```
vendor/movi/element.slim.global.js   # 預建置 web component（未修改）
vendor/movi/movi.wasm                # FFmpeg 解碼器（5.3MB）
vendor/movi/LICENSE                  # Apache-2.0
css/site.css  js/site.js  index.html # 本頁外殼
```

檔案的識別與播放全部在瀏覽器本機完成，不會上傳任何內容。

## 更新引擎

```bash
npm pack movi-player@latest
tar -xzf movi-player-*.tgz package/dist/element.slim.global.js package/dist/movi.wasm package/LICENSE
cp package/dist/element.slim.global.js package/dist/movi.wasm package/LICENSE vendor/movi/
```
