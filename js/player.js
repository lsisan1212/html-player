// Core Player Logic
class VideoPlayer {
    constructor() {
        this.video = document.getElementById('video');
        this.dropZone = document.getElementById('drop-zone');
        this.dropOverlay = document.getElementById('drop-overlay');
        this.videoInput = document.getElementById('video-input');
        this.openVideoBtn = document.getElementById('open-video-btn');
        this.controls = document.getElementById('controls');
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.setupMobileTouchEvents();
    }

    setupEventListeners() {
        this.openVideoBtn.addEventListener('click', () => {
            this.videoInput.click();
        });

        this.videoInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.loadVideo(e.target.files[0]);
            }
        });

        this.video.addEventListener('loadedmetadata', () => {
            this.onVideoLoaded();
        });

        this.video.addEventListener('timeupdate', () => {
            this.updateProgress();
        });

        this.video.addEventListener('progress', () => {
            this.updateBuffer();
        });

        this.video.addEventListener('ended', () => {
            this.onVideoEnded();
        });

        this.video.addEventListener('play', () => {
            this.updatePlayButton(true);
            this.video.classList.remove('is-paused');
            this._stopPauseZoom();
        });

        this.video.addEventListener('pause', () => {
            this.updatePlayButton(false);
            this.video.classList.add('is-paused');
            this._startPauseZoom();
        });

        this.video.addEventListener('loadeddata', () => {
            this.onTracksLoaded();
        });
    }

    setupDragAndDrop() {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        this.dropZone.addEventListener('dragenter', () => {
            this.dropZone.classList.add('drag-over');
        });

        this.dropZone.addEventListener('dragover', () => {
            this.dropZone.classList.add('drag-over');
        });

        this.dropZone.addEventListener('dragleave', () => {
            this.dropZone.classList.remove('drag-over');
        });

        this.dropZone.addEventListener('drop', (e) => {
            this.dropZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.loadVideo(files[0]);
            }
        });
    }

    loadVideo(file) {
        const url = URL.createObjectURL(file);

        this.dropOverlay.classList.add('hidden');
        this.video.classList.add('active');
        this.controls.classList.remove('hidden');

        this.videoFile = file;
        this.updateFileInfo(file);

        // Show filename in header
        const fnDisplay = document.getElementById('filename-display');
        if (fnDisplay) fnDisplay.textContent = file.name;

        console.log(`[Player] Loaded: ${file.name}`);

        // Auto-play
        this.video.autoplay = true;
        this.video.src = url;
        this.video.load();
        setTimeout(() => {
            this.video.play().catch(() => {});
        }, 100);

        // If MKV, dispatch event for subtitle extraction
        if (file.name.toLowerCase().endsWith('.mkv')) {
            console.log('[Player] MKV detected, extracting subtitles...');
            document.dispatchEvent(new CustomEvent('mkvfile', { detail: { file } }));
        }
    }

    updateFileInfo(file) {
        const nameEl = document.getElementById('info-filename');
        if (nameEl) nameEl.textContent = file.name;
    }

    onVideoLoaded() {
        console.log(`[Player] Video loaded: ${this.video.duration}s`);
        this.updateDuration();
        
        // Update info panel
        const durationEl = document.getElementById('info-duration');
        if (durationEl) durationEl.textContent = this.formatTime(this.video.duration);
    }

    onTracksLoaded() {
        const tracks = this.video.textTracks;
        console.log(`[Player] Found ${tracks.length} embedded text track(s)`);
        
        if (tracks.length > 0) {
            const event = new CustomEvent('embeddedtracks', { 
                detail: { tracks } 
            });
            document.dispatchEvent(event);
        }
    }

    updateProgress() {
        const progressFill = document.getElementById('progress-fill');
        const progressHandle = document.getElementById('progress-handle');
        const currentTimeEl = document.getElementById('current-time');
        
        const percent = (this.video.currentTime / this.video.duration) * 100;
        progressFill.style.width = `${percent}%`;
        progressHandle.style.left = `${percent}%`;
        currentTimeEl.textContent = this.formatTime(this.video.currentTime);
    }

    updateBuffer() {
        const progressBuffer = document.getElementById('progress-buffer');
        if (this.video.buffered.length > 0) {
            const buffered = (this.video.buffered.end(0) / this.video.duration) * 100;
            progressBuffer.style.width = `${buffered}%`;
        }
    }

    updateDuration() {
        const durationEl = document.getElementById('duration');
        durationEl.textContent = this.formatTime(this.video.duration);
    }

    onVideoEnded() {
        if (!this.video.loop) {
            this.updatePlayButton(false);
        }
    }

    togglePlay() {
        if (this.video.paused) {
            this.video.play();
        } else {
            this.video.pause();
        }
    }

    stop() {
        this.video.pause();
        this.video.currentTime = 0;
        this.updatePlayButton(false);
    }

    /** 暫停時漸進縮放：桌面 2% → 5%，行動版 5% → 10% */
    _startPauseZoom() {
        this._stopPauseZoom();
        const mobile = window.innerWidth <= 768;
        let scale = mobile ? 1.05 : 1.02;
        const target = mobile ? 1.10 : 1.05;
        const increment = mobile ? 0.005 : 0.003;
        this.video.style.transform = `scale(${scale})`;
        this._pauseZoomTimer = setInterval(() => {
            scale = Math.min(scale + increment, target);
            this.video.style.transform = `scale(${scale})`;
            if (scale >= target) clearInterval(this._pauseZoomTimer);
        }, 80);
    }

    _stopPauseZoom() {
        if (this._pauseZoomTimer) {
            clearInterval(this._pauseZoomTimer);
            this._pauseZoomTimer = null;
        }
        this.video.style.transform = '';
    }

    toggleLoop() {
        this.video.loop = !this.video.loop;
        const loopBtn = document.getElementById('loop-btn');
        loopBtn.style.opacity = this.video.loop ? '1' : '0.6';
        console.log(`[Player] Loop: ${this.video.loop}`);
    }

    seek(time) {
        this.video.currentTime = Math.max(0, Math.min(time, this.video.duration));
    }

    setPlaybackRate(rate) {
        this.video.playbackRate = parseFloat(rate);
        console.log(`[Player] Playback rate: ${rate}x`);
    }

    setVolume(volume) {
        const clampedVolume = Math.max(0, Math.min(100, volume));
        this.video.volume = clampedVolume / 100;
        
        const volumeSlider = document.getElementById('volume-slider');
        const volumeValue = document.getElementById('volume-value');
        volumeSlider.value = clampedVolume;
        volumeValue.textContent = `${Math.round(clampedVolume)}%`;
        
        this.updateMuteIcon(clampedVolume);
    }

    toggleMute() {
        this.video.muted = !this.video.muted;
        this.updateMuteIcon(this.video.muted ? 0 : parseFloat(document.getElementById('volume-slider').value));
    }

    updateMuteIcon(volume) {
        const muteBtn = document.getElementById('mute-btn');
        const icon = muteBtn.querySelector('.icon');
        if (volume === 0 || this.video.muted) {
            icon.textContent = '🔇';
        } else if (volume < 50) {
            icon.textContent = '🔉';
        } else {
            icon.textContent = '🔊';
        }
    }

    updatePlayButton(isPlaying) {
        const playBtn = document.getElementById('play-btn');
        const icon = playBtn.querySelector('.icon');
        icon.textContent = isPlaying ? '⏸️' : '▶️';
    }

    toggleFullscreen() {
        const container = document.getElementById('player-container');
        if (!document.fullscreenElement) {
            container.requestFullscreen().catch(err => {
                console.error(`[Player] Fullscreen error: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    }

    async togglePictureInPicture() {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await this.video.requestPictureInPicture();
            }
        } catch (err) {
            console.error(`[Player] PiP error: ${err.message}`);
        }
    }

    takeScreenshot() {
        const canvas = document.createElement('canvas');
        canvas.width = this.video.videoWidth;
        canvas.height = this.video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.video, 0, 0);
        
        const link = document.createElement('a');
        link.download = `screenshot-${Date.now()}.png`;
        link.href = canvas.toDataURL();
        link.click();
        
        console.log('[Player] Screenshot taken');
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // ---- Skip (前進/後退) ----
    skipBackward(s = 5) { this.seek(this.video.currentTime - s); }
    skipForward(s = 5) { this.seek(this.video.currentTime + s); }

    // ---- 行動版雙擊 + 長按 ----
    setupMobileTouchEvents() {
        const video = this.video;
        const zone = this.dropZone;
        let longPressTimer = null, originalRate = 1;
        let lastTap = 0, lastTapX = 0;
        const dB = 300; // double-tap threshold ms

        // 速度疊層
        const speedOv = document.createElement('div');
        speedOv.className = 'speed-overlay';
        speedOv.textContent = '2x';
        zone.appendChild(speedOv);
        this._speedOverlay = speedOv;

        // 點擊回饋
        const tapFb = document.createElement('div');
        tapFb.className = 'tap-feedback';
        zone.appendChild(tapFb);
        this._tapFeedback = tapFb;

        video.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            e.preventDefault(); // 防止 iOS 長按選單
            longPressTimer = setTimeout(() => {
                originalRate = video.playbackRate;
                video.playbackRate = 2.0;
                speedOv.classList.add('visible');
                const ss = document.getElementById('speed-select');
                if (ss) ss.value = '2.0';
            }, 500);
        }, { passive: false });

        const endLongPress = () => {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            if (speedOv.classList.contains('visible')) {
                video.playbackRate = originalRate;
                speedOv.classList.remove('visible');
                const ss = document.getElementById('speed-select');
                if (ss) ss.value = String(originalRate);
            }
        };

        video.addEventListener('touchend', (e) => {
            const wasLP = speedOv.classList.contains('visible');
            endLongPress();
            if (wasLP) return;

            const now = Date.now();
            const touch = e.changedTouches[0];
            const x = touch ? touch.clientX : 0;
            if (now - lastTap < dB && lastTap > 0) {
                const rect = video.getBoundingClientRect();
                const isL = (x - rect.left) < rect.width / 2;
                if (isL) this.skipBackward(5); else this.skipForward(5);
                this._showTapFeedback(isL);
                lastTap = 0;
            } else {
                lastTap = now;
                lastTapX = x;
            }
        });

        video.addEventListener('touchmove', () => endLongPress());
        video.addEventListener('touchcancel', () => endLongPress());
        video.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    _showTapFeedback(isLeft) {
        const fb = this._tapFeedback;
        if (!fb) return;
        fb.textContent = isLeft ? '⏪ -5s' : '⏩ +5s';
        fb.style.left = isLeft ? '20%' : '';
        fb.style.right = isLeft ? '' : '20%';
        fb.classList.add('visible');
        clearTimeout(this._fbTimer);
        this._fbTimer = setTimeout(() => fb.classList.remove('visible'), 600);
    }
}

// Initialize player
const player = new VideoPlayer();
