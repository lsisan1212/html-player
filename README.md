# HTML Player

單頁影片播放器，直接在任何瀏覽器播 **MKV / HEVC / AV1 / HDR**、多音軌、內嵌字幕 —— 唔需要轉檔、唔需要伺服器。

- 拖放或選檔即播
- **暫停時畫面變灰階並放大 10%，繼續播放自動回復彩色與原尺寸**
- 字幕：內嵌軌切換 + 「Add subtitle file…」外掛 `.srt` / `.vtt` / `.ass`
- 鍵盤快捷鍵按 `?` 查看

## 技術

播放引擎是 [Movi Player](https://github.com/MrUjjwalG/movi-player)（Apache-2.0）的 `element.slim` 建置：
WebCodecs 硬解 + FFmpeg WASM 軟解，畫到 canvas；本頁只加了一層外殼（開檔 / 拖放 / 暫停灰階 + 放大）。

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
