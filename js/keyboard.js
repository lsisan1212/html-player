// Keyboard Shortcuts Handler
class KeyboardManager {
    constructor(player, controls) {
        this.player = player;
        this.controls = controls;
        this.seekInterval = 5; // seconds
        this.volumeStep = 10; // percentage
        
        this.init();
    }

    init() {
        document.addEventListener('keydown', (e) => {
            // Ignore if typing in input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            switch (e.key) {
                case ' ':
                case 'k':
                    e.preventDefault();
                    this.player.togglePlay();
                    break;
                    
                case 'ArrowLeft':
                    e.preventDefault();
                    this.player.seek(this.player.video.currentTime - this.seekInterval);
                    this.showOSD(`⏪ -${this.seekInterval}s`);
                    break;
                    
                case 'ArrowRight':
                    e.preventDefault();
                    this.player.seek(this.player.video.currentTime + this.seekInterval);
                    this.showOSD(`⏩ +${this.seekInterval}s`);
                    break;
                    
                case 'ArrowUp':
                    e.preventDefault();
                    const currentVolUp = parseInt(document.getElementById('volume-slider').value);
                    this.player.setVolume(currentVolUp + this.volumeStep);
                    this.showOSD(`🔊 Volume: ${Math.min(100, currentVolUp + this.volumeStep)}%`);
                    break;
                    
                case 'ArrowDown':
                    e.preventDefault();
                    const currentVolDown = parseInt(document.getElementById('volume-slider').value);
                    this.player.setVolume(currentVolDown - this.volumeStep);
                    this.showOSD(`🔉 Volume: ${Math.max(0, currentVolDown - this.volumeStep)}%`);
                    break;
                    
                case 'f':
                case 'F':
                    e.preventDefault();
                    this.player.toggleFullscreen();
                    break;
                    
                case 'm':
                case 'M':
                    e.preventDefault();
                    this.player.toggleMute();
                    break;
                    
                case 'l':
                case 'L':
                    e.preventDefault();
                    this.player.toggleLoop();
                    break;
                    
                case 'p':
                case 'P':
                    e.preventDefault();
                    this.player.togglePictureInPicture();
                    break;
                    
                case 's':
                case 'S':
                    if (!e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        this.player.takeScreenshot();
                        break;
                    }
                    
                case 'Escape':
                    if (document.getElementById('theme-dropdown').classList.contains('hidden') === false) {
                        document.getElementById('theme-dropdown').classList.add('hidden');
                        this.controls.themeDropdownOpen = false;
                    }
                    break;
                    
                case '0':
                case '1':
                case '2':
                case '3':
                case '4':
                case '5':
                case '6':
                case '7':
                case '8':
                case '9':
                    e.preventDefault();
                    const percent = parseInt(e.key) / 10;
                    this.player.seek(this.player.video.duration * percent);
                    break;
                    
                case '>':
                case '.':
                    e.preventDefault();
                    const speedSelect = document.getElementById('speed-select');
                    const currentIndex = speedSelect.selectedIndex;
                    if (currentIndex < speedSelect.options.length - 1) {
                        speedSelect.selectedIndex = currentIndex + 1;
                        this.player.setPlaybackRate(speedSelect.value);
                    }
                    break;
                    
                case '<':
                case ',':
                    e.preventDefault();
                    const speedSelect2 = document.getElementById('speed-select');
                    const currentIndex2 = speedSelect2.selectedIndex;
                    if (currentIndex2 > 0) {
                        speedSelect2.selectedIndex = currentIndex2 - 1;
                        this.player.setPlaybackRate(speedSelect2.value);
                    }
                    break;
                    
                case 'a':
                case 'A':
                    e.preventDefault();
                    // Just click the button to open the menu!
                    const aiBtn = document.getElementById('ai-btn');
                    if (aiBtn) aiBtn.click();
                    break;

                case 'c':
                case 'C':
                    e.preventDefault();
                    this.cycleSubtitleTrack();
                    break;
                    
                case 'v':
                case 'V':
                    e.preventDefault();
                    this.cycleSubtitleTheme();
                    break;
            }
        });

        // Double click to fullscreen
        this.player.video.addEventListener('dblclick', () => {
            this.player.toggleFullscreen();
        });

        // Click to play/pause
        this.player.video.addEventListener('click', () => {
            this.player.togglePlay();
        });
    }

    showOSD(text) {
        // Remove existing OSD
        const existing = document.querySelector('.osd-display');
        if (existing) {
            existing.remove();
        }

        // Create new OSD
        const osd = document.createElement('div');
        osd.className = 'osd-display';
        osd.textContent = text;
        osd.style.cssText = `
            position: absolute;
            top: 12px;
            left: 12px;
            transform: none;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            font-size: 0.9rem;
            font-weight: bold;
            z-index: 100;
            pointer-events: none;
            animation: osdFade 1.5s ease forwards;
        `;

        // Add animation
        if (!document.getElementById('osd-style')) {
            const style = document.createElement('style');
            style.id = 'osd-style';
            style.textContent = `
                @keyframes osdFade {
                    0% { opacity: 1; transform: scale(1); }
                    70% { opacity: 1; transform: scale(1); }
                    100% { opacity: 0; transform: scale(0.9); }
                }
            `;
            document.head.appendChild(style);
        }

        this.player.dropZone.appendChild(osd);

        // Remove after animation
        setTimeout(() => {
            if (osd.parentNode) {
                osd.remove();
            }
        }, 1500);
    }

    cycleSubtitleTrack() {
        const trackSelect = document.getElementById('subtitle-track-select');
        const options = trackSelect.options;
        if (options.length <= 1) {
            this.showOSD('💬 No subtitles');
            return;
        }
        
        // Cycle to next option
        const currentIndex = trackSelect.selectedIndex;
        const nextIndex = (currentIndex + 1) % options.length;
        trackSelect.selectedIndex = nextIndex;
        
        // Trigger change event
        trackSelect.dispatchEvent(new Event('change'));
        
        // Show OSD
        const label = options[nextIndex].textContent;
        this.showOSD(`💬 ${label}`);
    }

    cycleSubtitleTheme() {
        const subText = document.getElementById('subtitle-text');
        if (!subText) return;

        const themes = [
            'sub-theme-default', 'sub-theme-yellow', 'sub-theme-cyan',
            'sub-theme-green', 'sub-theme-pink', 'sub-theme-gold',
            'sub-theme-red', 'sub-theme-ghost', 'sub-theme-retro', 'sub-theme-dark'
        ];

        let currentIndex = 0;
        for (let i = 0; i < themes.length; i++) {
            if (subText.classList.contains(themes[i])) {
                currentIndex = i;
                subText.classList.remove(themes[i]);
                break;
            }
        }

        const nextIndex = (currentIndex + 1) % themes.length;
        subText.classList.add(themes[nextIndex]);

        const themeNames = ['Default', 'Yellow', 'Cyan', 'Matrix Green', 'Neon Pink', 'Cinematic Gold', 'Blood Red', 'Ghost', 'Retro 8-Bit', 'Dark Contrast'];
        this.showOSD(`🎨 Sub: ${themeNames[nextIndex]}`);
    }
}

// Initialize keyboard manager
const keyboard = new KeyboardManager(player, controls);
