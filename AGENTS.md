# HTML5 AI Player - Agent Guidelines

## Overview
This is a standalone HTML5 video player with no build system or external dependencies.

## Project Structure
- **index.html**: Main entry point
- **css/**: Stylesheets (base + 10 themes)
- **js/**: JavaScript modules (player, controls, subtitles, keyboard)

## Commands

### Validation
```bash
make smoke    # Quick file structure check
make check    # Feature validation
make ci       # Full validation + syntax check
```

### Testing
Open `index.html` in a browser to manually test:
1. Drag/drop a video file
2. Test all keyboard shortcuts
3. Switch between 10 themes
4. Load .srt or .vtt subtitle files
5. Adjust volume (0-200%)
6. Change playback speed

## Key Features
- No build step required
- No external dependencies
- Works offline
- Supports video/* formats
- SRT and VTT subtitle parsing

## Code Conventions
- ES6 classes for modularity
- CSS custom properties for theming
- Event-driven architecture
- Console logging for debugging
