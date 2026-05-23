# HTML5 AI Player

A feature-rich, zero-dependency HTML5 video player with AI commentator, 10 themes, subtitle support, and keyboard shortcuts.

## Features

### Core Features
- 🎬 **Drag & Drop** - Drop video files directly or click to open
- ⚡ **Playback Speed** - 0.5x, 1.0x, 1.5x, 2.0x speed control
- 💬 **Subtitle Support** - Load .srt/.vtt files or extract from MKV containers
- 🎨 **10 Themes** - Default, Dark, Light, Ocean, Forest, Sunset, Purple, Midnight, Neon, Minimal
- 🔊 **Volume Control** - 0-100% volume range
- ⏱️ **Seek Bar** - Click or drag to jump to any point in the video
- ⌨️ **Keyboard Shortcuts** - Full keyboard control

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` / `K` | Play/Pause |
| `←` / `→` | Seek -5s / +5s |
| `↑` / `↓` | Volume -10% / +10% |
| `F` | Toggle Fullscreen |
| `M` | Toggle Mute |
| `L` | Toggle Loop |
| `P` | Picture-in-Picture |
| `S` | Take Screenshot |
| `A` | Open AI Commentator menu |
| `C` | Cycle subtitle tracks |
| `V` | Cycle subtitle theme (or click 🔤) |
| `0-9` | Jump to 0%-90% of video |
| `<` / `>` | Decrease/Increase speed |

### Bonus Features
- 🤖 Multi-lingual AI Commentator (EN/ZH-TW/YUE/JA/KO/TH)
- 📺 Picture-in-Picture mode
- 📸 Screenshot capture
- 🔁 Loop playback
- 🖱️ Mouse wheel volume control
- 🎯 OSD display for keyboard actions

## Usage

1. **Open the player**: Double-click `index.html` in your browser
2. **Load a video**: Drag & drop a video file or click "Open Video"
3. **Add subtitles**: Click the 💬 button and select a .srt or .vtt file
4. **Change theme**: Click the 🎨 button and pick a theme
5. **Control playback**: Use the controls bar or keyboard shortcuts

## Project Structure

```
html5 player/
├── index.html           # Main HTML file
├── css/
│   ├── base.css         # Core styles
│   └── themes.css       # 10 theme definitions
├── js/
│   ├── player.js        # Core video player logic
│   ├── controls.js      # UI controls handler
│   ├── subtitles.js     # SRT/VTT subtitle parser
│   └── keyboard.js      # Keyboard shortcut manager
├── PLANS.md             # Implementation plan
├── AGENTS.md            # Agent guidelines
├── Makefile             # Harness validation
└── docs/
    └── ARCHITECTURE.md  # Architecture documentation
```

## Validation

```bash
make smoke    # Quick validation
make check    # Feature checks
make ci       # Full validation
```

## Browser Support

Works in all modern browsers:
- Chrome/Edge 80+
- Firefox 75+
- Safari 13+

## License

MIT
