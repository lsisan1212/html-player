# HTML5 AI Player - Architecture

## Overview
A standalone HTML5 video player with theme support, subtitle rendering, and keyboard shortcuts. No external dependencies - pure HTML/CSS/JavaScript.

## Component Architecture

```
┌─────────────────────────────────────────┐
│           index.html                     │
│  ┌───────────────────────────────────┐  │
│  │        Video Element              │  │
│  │     + Drop Zone Handler           │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │         Controls Bar              │  │
│  │  - Progress/Seek Bar              │  │
│  │  - Play/Stop/Loop                 │  │
│  │  - Volume (0-200%)                │  │
│  │  - Speed Selector                 │  │
│  │  - Theme Switcher                 │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘

Module Dependencies:
player.js → (core video logic)
   ↑
   ├── controls.js → (UI event handlers)
   ├── subtitles.js → (SRT/VTT parser)
   └── keyboard.js → (shortcut mappings)
```

## Data Flows

### Video Loading
```
User Action (Drop/Click) 
  → File Validation 
  → URL.createObjectURL() 
  → video.src 
  → loadedmetadata event 
  → Show controls
```

### Subtitle Rendering
```
Load .srt/.vtt 
  → Parse to Array<{start, end, text}> 
  → timeupdate event 
  → Find active subtitle 
  → Update DOM
```

### Volume Control (0-100%)
```
Input (Slider/Keyboard) 
  → Clamp to [0, 100] 
  → video.volume = value/100 
  → Update UI display
```

## Theme System

Themes use CSS custom properties (CSS variables) defined in `:root` scope. Each theme class overrides the same set of variables:

| Variable | Purpose |
|----------|---------|
| `--bg-primary` | Page background |
| `--bg-secondary` | Player container |
| `--bg-controls` | Control bar background |
| `--accent` | Primary accent color |
| `--text-primary` | Main text color |
| `--text-secondary` | Secondary text |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space/K | Play/Pause |
| ←/→ | Seek -5s/+5s |
| ↑/↓ | Volume -10%/+10% |
| F | Fullscreen |
| M | Mute |
| L | Loop toggle |
| P | Picture-in-Picture |
| S | Screenshot |
| 0-9 | Jump to 0%-90% |
| </> | Speed down/up |

## File Structure
```
html5 player/
├── index.html           # Main entry
├── css/
│   ├── base.css         # Core styles
│   └── themes.css       # 10 theme definitions
├── js/
│   ├── player.js        # VideoPlayer class
│   ├── controls.js      # ControlsHandler class
│   ├── subtitles.js     # SubtitleManager class
│   └── keyboard.js      # KeyboardManager class
├── PLANS.md             # Implementation plan
├── AGENTS.md            # Agent guidelines
└── docs/
    └── ARCHITECTURE.md  # This file
```
