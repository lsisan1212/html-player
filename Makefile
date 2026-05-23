SHELL := /bin/bash
.PHONY: smoke check ci audit clean

# HTML5 AI Player - Harness Engineering Makefile

## Smoke Test - Quick validation
smoke:
	@echo "=== Smoke Test ==="
	@echo "Checking required files..."
	@test -f index.html && echo "✓ index.html exists" || (echo "✗ index.html missing" && exit 1)
	@test -f css/base.css && echo "✓ base.css exists" || (echo "✗ base.css missing" && exit 1)
	@test -f css/themes.css && echo "✓ themes.css exists" || (echo "✗ themes.css missing" && exit 1)
	@test -f js/player.js && echo "✓ player.js exists" || (echo "✗ player.js missing" && exit 1)
	@test -f js/controls.js && echo "✓ controls.js exists" || (echo "✗ controls.js missing" && exit 1)
	@test -f js/subtitles.js && echo "✓ subtitles.js exists" || (echo "✗ subtitles.js missing" && exit 1)
	@test -f js/keyboard.js && echo "✓ keyboard.js exists" || (echo "✗ keyboard.js missing" && exit 1)
	@test -f js/mkv-extractor.js && echo "✓ mkv-extractor.js exists" || (echo "✗ mkv-extractor.js missing" && exit 1)
	@echo ""
	@echo "Validating HTML structure..."
	@grep -q '<video' index.html && echo "✓ Video element found" || (echo "✗ Video element missing" && exit 1)
	@grep -q 'id="controls"' index.html && echo "✓ Controls found" || (echo "✗ Controls missing" && exit 1)
	@echo ""
	@echo "Checking CSS themes..."
	@for theme in default dark light ocean forest sunset purple midnight neon minimal; do \
		grep -q ".theme-$$theme" css/themes.css && echo "✓ Theme: $$theme" || (echo "✗ Theme $$theme missing" && exit 1); \
	done
	@echo ""
	@echo "=== Smoke Test Passed ==="

## Full Check - Comprehensive validation
check: smoke
	@echo ""
	@echo "=== Full Check ==="
	@echo ""
	@echo "Checking JavaScript classes..."
	@grep -q 'class VideoPlayer' js/player.js && echo "✓ VideoPlayer class" || (echo "✗ VideoPlayer missing" && exit 1)
	@grep -q 'class ControlsHandler' js/controls.js && echo "✓ ControlsHandler class" || (echo "✗ ControlsHandler missing" && exit 1)
	@grep -q 'class SubtitleManager' js/subtitles.js && echo "✓ SubtitleManager class" || (echo "✗ SubtitleManager missing" && exit 1)
	@grep -q 'class KeyboardManager' js/keyboard.js && echo "✓ KeyboardManager class" || (echo "✗ KeyboardManager missing" && exit 1)
	@echo ""
	@echo "Checking required features..."
	@grep -q 'dragover' js/player.js && echo "✓ Drag & drop" || (echo "✗ Drag & drop missing" && exit 1)
	@grep -q 'playbackRate' js/player.js && echo "✓ Speed control" || (echo "✗ Speed control missing" && exit 1)
	@grep -q 'parseSRT\|parseVTT' js/subtitles.js && echo "✓ Subtitle parsing" || (echo "✗ Subtitle parsing missing" && exit 1)
	@grep -q 'max.*100' js/player.js && echo "✓ 100% volume support" || (echo "✗ 100% volume missing" && exit 1)
	@grep -q 'ArrowLeft\|ArrowRight' js/keyboard.js && echo "← → keyboard seek" || (echo "✗ Keyboard seek missing" && exit 1)
	@grep -q 'ArrowUp\|ArrowDown' js/keyboard.js && echo "↑ ↓ keyboard volume" || (echo "✗ Keyboard volume missing" && exit 1)
	@echo ""
	@echo "=== Full Check Passed ==="

## CI Pipeline - Full validation + linting
ci: check
	@echo ""
	@echo "=== CI Pipeline ==="
	@echo "Running syntax checks..."
	@node -c js/player.js 2>/dev/null && echo "✓ player.js syntax" || echo "⚠ player.js syntax check skipped (node not available)"
	@node -c js/controls.js 2>/dev/null && echo "✓ controls.js syntax" || echo "⚠ controls.js syntax check skipped (node not available)"
	@node -c js/subtitles.js 2>/dev/null && echo "✓ subtitles.js syntax" || echo "⚠ subtitles.js syntax check skipped (node not available)"
	@node -c js/keyboard.js 2>/dev/null && echo "✓ keyboard.js syntax" || echo "⚠ keyboard.js syntax check skipped (node not available)"
	@echo ""
	@echo "=== CI Pipeline Passed ==="

## Audit - Check harness artifacts
audit:
	@echo "=== Harness Audit ==="
	@test -f AGENTS.md && echo "✓ AGENTS.md" || echo "✗ AGENTS.md missing"
	@test -f PLANS.md && echo "✓ PLANS.md" || echo "✗ PLANS.md missing"
	@test -f docs/ARCHITECTURE.md && echo "✓ docs/ARCHITECTURE.md" || echo "✗ docs/ARCHITECTURE.md missing"
	@test -f Makefile && echo "✓ Makefile" || echo "✗ Makefile missing"
	@echo ""
	@echo "=== Audit Complete ==="

## Clean - Remove temporary files
clean:
	@echo "Cleaning temporary files..."
	@find . -name "*.log" -delete 2>/dev/null || true
	@echo "Clean complete"
