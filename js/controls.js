// UI Controls Handler
class ControlsHandler {
    constructor(player) {
        this.player = player;
        this.isDragging = false;
        this.themeDropdownOpen = false;
        this.currentTheme = 'default';
        
        this.init();
    }

    init() {
        this.setupPlayControls();
        this.setupProgressControls();
        this.setupVolumeControl();
        this.setupSpeedControl();
        this.setupThemeControl();
        this.setupSubStyleControl();
        this.setupExtraControls();
        this.setupPanelToggle();
    }

    setupPlayControls() {
        document.getElementById('play-btn').addEventListener('click', () => {
            this.player.togglePlay();
        });

        document.getElementById('skip-back-btn').addEventListener('click', () => {
            this.player.skipBackward(5);
        });

        document.getElementById('skip-fwd-btn').addEventListener('click', () => {
            this.player.skipForward(5);
        });

        document.getElementById('stop-btn').addEventListener('click', () => {
            this.player.stop();
        });

        document.getElementById('loop-btn').addEventListener('click', () => {
            this.player.toggleLoop();
        });

        document.getElementById('mute-btn').addEventListener('click', () => {
            this.player.toggleMute();
        });
    }

    setupProgressControls() {
        const progressBar = document.getElementById('progress-bar');
        
        progressBar.addEventListener('click', (e) => {
            const rect = progressBar.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            const time = percent * this.player.video.duration;
            this.player.seek(time);
        });

        progressBar.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.updateProgressFromEvent(e);
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.updateProgressFromEvent(e);
            }
        });

        document.addEventListener('mouseup', () => {
            this.isDragging = false;
        });
    }

    updateProgressFromEvent(e) {
        const progressBar = document.getElementById('progress-bar');
        const rect = progressBar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const time = percent * this.player.video.duration;
        this.player.seek(time);
    }

    setupVolumeControl() {
        const volumeSlider = document.getElementById('volume-slider');
        
        volumeSlider.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value);
            this.player.setVolume(volume);
        });

        // Mouse wheel volume control
        document.getElementById('player-container').addEventListener('wheel', (e) => {
            e.preventDefault();
            const currentVolume = parseInt(volumeSlider.value);
            const delta = e.deltaY > 0 ? -5 : 5;
            this.player.setVolume(currentVolume + delta);
        });
    }

    setupSpeedControl() {
        const speedSelect = document.getElementById('speed-select');
        
        speedSelect.addEventListener('change', (e) => {
            this.player.setPlaybackRate(e.target.value);
        });
    }

    setupThemeControl() {
        const themeBtn = document.getElementById('theme-btn');
        const themeDropdown = document.getElementById('theme-dropdown');
        const themeOptions = document.querySelectorAll('.theme-option');

        themeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.themeDropdownOpen = !this.themeDropdownOpen;
            themeDropdown.classList.toggle('hidden', !this.themeDropdownOpen);
            
            // Update active state when opening
            if (this.themeDropdownOpen) {
                themeOptions.forEach(option => {
                    option.classList.toggle('active', option.dataset.theme === this.currentTheme);
                });
            }
        });

        document.addEventListener('click', (e) => {
            if (this.themeDropdownOpen && !themeDropdown.contains(e.target) && e.target !== themeBtn) {
                this.themeDropdownOpen = false;
                themeDropdown.classList.add('hidden');
            }
        });

        themeOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const theme = option.dataset.theme;
                this.setTheme(theme);
            });
        });
    }

    setTheme(themeName) {
        document.body.className = `theme-${themeName}`;
        this.currentTheme = themeName;

        // Update active state in dropdown
        document.querySelectorAll('.theme-option').forEach(option => {
            option.classList.toggle('active', option.dataset.theme === themeName);
        });

        // Update theme name display
        const themeNameEl = document.getElementById('theme-name');
        if (themeNameEl) {
            themeNameEl.textContent = themeName.charAt(0).toUpperCase() + themeName.slice(1);
        }

        // Close dropdown
        this.themeDropdownOpen = false;
        document.getElementById('theme-dropdown').classList.add('hidden');

        console.log(`[Controls] Theme changed to: ${themeName}`);
    }

    setupExtraControls() {
        document.getElementById('fullscreen-btn').addEventListener('click', () => {
            this.player.toggleFullscreen();
        });

        document.getElementById('pip-btn').addEventListener('click', () => {
            this.player.togglePictureInPicture();
        });

        document.getElementById('screenshot-btn').addEventListener('click', () => {
            this.player.takeScreenshot();
        });

        document.getElementById('subtitle-btn').addEventListener('click', () => {
            document.getElementById('subtitle-input').click();
        });
    }

    setupSubStyleControl() {
        const subStyleBtn = document.getElementById('sub-style-btn');
        const subStyleDropdown = document.getElementById('sub-style-dropdown');
        const styleOptions = document.querySelectorAll('.sub-style-option');
        this.subStyleDropdownOpen = false;

        if (!subStyleBtn || !subStyleDropdown) return;

        subStyleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close the other dropdown if it's open
            if (this.themeDropdownOpen) {
                this.themeDropdownOpen = false;
                document.getElementById('theme-dropdown').classList.add('hidden');
            }
            
            this.subStyleDropdownOpen = !this.subStyleDropdownOpen;
            subStyleDropdown.classList.toggle('hidden', !this.subStyleDropdownOpen);
        });

        document.addEventListener('click', (e) => {
            if (this.subStyleDropdownOpen && !subStyleDropdown.contains(e.target) && e.target !== subStyleBtn) {
                this.subStyleDropdownOpen = false;
                subStyleDropdown.classList.add('hidden');
            }
        });

        styleOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const styleName = option.dataset.style;
                const subText = document.getElementById('subtitle-text');
                
                if (subText) {
                    // Remove old style classes, keep base classes
                    subText.className = 'subtitle-text';
                    // Add new style
                    subText.classList.add(styleName);
                    if (subText.textContent.trim().length > 0) subText.classList.add('active');
                }

                // Update active state in dropdown
                styleOptions.forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');

                // Close dropdown
                this.subStyleDropdownOpen = false;
                subStyleDropdown.classList.add('hidden');
                
                if (typeof keyboard !== 'undefined') {
                    keyboard.showOSD(`🎨 Sub: ${option.textContent}`);
                }
            });
        });
    }

    setupPanelToggle() {
        const toggleBtn = document.getElementById('panel-toggle');
        const panelContent = document.getElementById('panel-content');
        
        if (toggleBtn && panelContent) {
            toggleBtn.addEventListener('click', () => {
                const isCollapsed = panelContent.classList.toggle('collapsed');
                toggleBtn.classList.toggle('open', !isCollapsed);
                toggleBtn.querySelector('.toggle-text').textContent = 
                    isCollapsed ? 'File Info & Shortcuts' : 'Hide Info & Shortcuts';
            });
        }

        // Readme modal
        const readmeBtn = document.getElementById('readme-btn');
        const readmeModal = document.getElementById('readme-modal');
        const readmeClose = document.getElementById('readme-close');

        console.log('[Controls] Readme elements:', { readmeBtn: !!readmeBtn, readmeModal: !!readmeModal, readmeClose: !!readmeClose });

        if (readmeBtn && readmeModal) {
            readmeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[Controls] Opening readme modal');
                readmeModal.classList.remove('hidden');
            });
        }

        if (readmeClose && readmeModal) {
            readmeClose.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                readmeModal.classList.add('hidden');
            });
        }

        // Close modal when clicking outside
        if (readmeModal) {
            readmeModal.addEventListener('click', (e) => {
                if (e.target === readmeModal) {
                    readmeModal.classList.add('hidden');
                }
            });
        }

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && readmeModal && !readmeModal.classList.contains('hidden')) {
                readmeModal.classList.add('hidden');
            }
        });
    }
}

// Resize Handler - drag video edges to resize
class ResizeHandler {
    constructor(wrapper) {
        this.wrapper = wrapper;
        this.isResizing = false;
        this.currentHandle = null;
        this.startX = 0;
        this.startY = 0;
        this.startW = 0;
        this.startH = 0;
        this.minW = 320;
        this.minH = 180;
        this.init();
    }

    init() {
        const handles = this.wrapper.querySelectorAll('.resize-handle');
        handles.forEach(handle => {
            handle.addEventListener('mousedown', (e) => this.startResize(e, handle));
        });
        document.addEventListener('mousemove', (e) => this.resize(e));
        document.addEventListener('mouseup', () => this.stopResize());
    }

    startResize(e, handle) {
        this.isResizing = true;
        this.currentHandle = handle;
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.startW = this.wrapper.offsetWidth;
        this.startH = this.wrapper.offsetHeight;
        this.wrapper.classList.add('is-resizing');
        e.preventDefault();
    }

    resize(e) {
        if (!this.isResizing) return;
        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;
        const dir = [...this.currentHandle.classList].find(c => c.startsWith('resize-handle-')).replace('resize-handle-', '');

        let newW = this.startW, newH = this.startH;
        if (dir.includes('r')) newW = Math.max(this.minW, this.startW + dx);
        if (dir.includes('l')) newW = Math.max(this.minW, this.startW - dx);
        if (dir.includes('b')) newH = Math.max(this.minH, this.startH + dy);
        if (dir.includes('t')) newH = Math.max(this.minH, this.startH - dy);

        this.wrapper.style.width = newW + 'px';
        this.wrapper.style.height = newH + 'px';
    }

    stopResize() {
        if (!this.isResizing) return;
        this.isResizing = false;
        this.currentHandle = null;
        this.wrapper.classList.remove('is-resizing');
    }
}

// Initialize controls after player
const controls = new ControlsHandler(player);

// Initialize resize handler
const resizeHandler = new ResizeHandler(document.getElementById('player-container'));
