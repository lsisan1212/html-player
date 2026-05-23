# HTML5 AI Player - Implementation Plan

## Overview
Build a feature-rich HTML5 video player with 10 themes, subtitle support, playback speed control, and keyboard shortcuts.

## Features

### Core Requirements
1. **File Input**: Open or drag-and-drop video files
2. **Playback Speed**: 1.0x, 1.5x, 2.0x speed control
3. **Subtitle Support**: Open external subtitle files (SRT, VTT)
4. **10 Themes**: Distinct visual themes for the player
5. **Volume Control**: 0-100% volume range
6. **Seek Bar**: Clickable/draggable timeline
7. **Keyboard Shortcuts**:
   - Left/Right: Skip -5s/+5s
   - Up/Down: Volume -10%/+10%

### Additional Features (Agent Design)
- Fullscreen toggle (F key)
- Play/Pause (Space key)
- Mute toggle (M key)
- Theme switcher UI
- Picture-in-Picture mode
- Loop playback
- Screenshot capture

## Architecture

```
html5 player/
├── index.html          # Main player
├── css/
│   ├── base.css        # Core styles
│   └── themes.css      # 10 theme definitions
├── js/
│   ├── player.js       # Core player logic
│   ├── controls.js     # UI controls
│   ├── subtitles.js    # Subtitle parsing/display
│   └── keyboard.js     # Keyboard shortcuts
└── docs/
    └── ARCHITECTURE.md
```

## Implementation Steps
1. Bootstrap HTML structure and base CSS
2. Implement core player controls
3. Add drag-and-drop file handling
4. Implement playback speed selector
5. Add subtitle parser and renderer
6. Create 10 theme definitions
7. Implement volume control (0-200%)
8. Add seek bar with time display
9. Wire up keyboard shortcuts
10. Polish UI and test

## Validation
- `make smoke`: Open in browser, verify player loads
- `make check`: Test all keyboard shortcuts, theme switching, subtitle loading
