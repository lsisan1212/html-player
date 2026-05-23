// Subtitle Handler
class SubtitleManager {
    constructor(player) {
        this.player = player;
        this.subtitles = [];
        this.currentSubtitle = null;
        this.subtitleInput = document.getElementById('subtitle-input');
        this.subtitleText = document.getElementById('subtitle-text');
        this.subtitleContainer = document.getElementById('subtitle-container');
        this.trackSelect = document.getElementById('subtitle-track-select');
        this.activeTrackIndex = -1; // -1 = off, -2 = external file, -3 = MKV
        this.hasExternalSubtitles = false;
        this.mkvTracks = [];
        this.hasMKVSubtitles = false;
        this.currentMKVTrack = null;
        this.currentSubtitleIndex = -1; // Track by index, not object reference
        this._debugCount = 0;
        this._rafId = null; // requestAnimationFrame handle
        
        this.init();
    }

    init() {
        this.subtitleInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.loadSubtitleFile(e.target.files[0]);
            }
        });

        // Use requestAnimationFrame for smooth, reliable subtitle updates
        this._startUpdateLoop();

        // Force re-evaluation on seek
        this.player.video.addEventListener('seeked', () => {
            this.currentSubtitleIndex = -1; // Reset to force fresh lookup
            this.updateSubtitle();
        });

        // Also update when video starts playing
        this.player.video.addEventListener('play', () => {
            this.currentSubtitleIndex = -1;
        });

        // Listen for embedded subtitle tracks
        document.addEventListener('embeddedtracks', (e) => {
            this.populateTrackSelector(e.detail.tracks);
        });

        // Handle track selection
        this.trackSelect.addEventListener('change', (e) => {
            this.selectTrack(parseInt(e.target.value));
        });

        // Listen for MKV file loaded
        document.addEventListener('mkvfile', async (e) => {
            await this.loadMKVSubtitles(e.detail.file);
        });
    }

    async loadMKVSubtitles(file) {
        console.log(`[Subtitles] Loading MKV file: ${file.name}`);
        
        try {
            const tracks = await mkvExtractor.extractSubtitles(file);
            
            if (tracks.length === 0) {
                console.log('[Subtitles] No subtitle tracks found in MKV');
                return;
            }

            // Clear existing options
            this.trackSelect.innerHTML = '<option value="-1">CC Off</option>';
            
            // Add MKV tracks
            tracks.forEach((track, index) => {
                const option = document.createElement('option');
                option.value = `mkv-${index}`;
                const label = track.name || `Track ${index + 1}`;
                const lang = track.language !== 'und' ? ` (${track.language})` : '';
                const count = ` [${track.subtitles.length}]`;
                option.textContent = `MKV: ${label}${lang}${count}`;
                this.trackSelect.appendChild(option);
            });

            // Store MKV subtitle data
            this.mkvTracks = tracks;
            this.hasMKVSubtitles = true;

            // Auto-select first track
            if (tracks.length > 0) {
                this.trackSelect.value = 'mkv-0';
                this.selectTrack('mkv-0');
            }

            console.log(`[Subtitles] Loaded ${tracks.length} MKV subtitle track(s)`);
            
            // Update info panel
            const subEl = document.getElementById('info-subtitles');
            if (subEl) subEl.textContent = `${tracks.length} track(s) (MKV)`;
        } catch (err) {
            console.error(`[Subtitles] MKV extraction failed: ${err.message}`);
        }
    }

    async loadSubtitleFile(file) {
        const text = await file.text();
        const ext = file.name.split('.').pop().toLowerCase();
        
        console.log(`[Subtitles] Loading external: ${file.name} (${ext})`);
        
        if (ext === 'srt') {
            this.parseSRT(text);
        } else if (ext === 'vtt') {
            this.parseVTT(text);
        } else {
            console.error(`[Subtitles] Unsupported format: ${ext}`);
            alert('Unsupported subtitle format. Please use .srt or .vtt files.');
            return;
        }
        
        this.hasExternalSubtitles = true;
        this.activeTrackIndex = -2; // Mark as external
        
        // Switch selector to external
        this.trackSelect.value = '-2';
        
        console.log(`[Subtitles] Loaded ${this.subtitles.length} subtitle entries`);
        
        // Update info panel
        const subEl = document.getElementById('info-subtitles');
        if (subEl) subEl.textContent = `${file.name} (${this.subtitles.length})`;
    }

    populateTrackSelector(tracks) {
        // Clear existing options except "Off"
        this.trackSelect.innerHTML = '<option value="-1">CC Off</option>';
        
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            if (track.kind === 'subtitles' || track.kind === 'captions') {
                const option = document.createElement('option');
                option.value = i;
                const label = track.label || `Track ${i + 1}`;
                const lang = track.language ? ` (${track.language})` : '';
                option.textContent = `${label}${lang}`;
                this.trackSelect.appendChild(option);
            }
        }
        
        console.log(`[Subtitles] Populated selector with ${this.trackSelect.options.length - 1} track(s)`);
    }

    selectTrack(value) {
        const tracks = this.player.video.textTracks;
        
        // Disable all embedded tracks first
        for (let i = 0; i < tracks.length; i++) {
            tracks[i].mode = 'disabled';
        }

        if (value === -1 || value === '-1') {
            // Off
            this.activeTrackIndex = -1;
            this.subtitleText.classList.remove('active');
            this.currentMKVTrack = null;
            console.log('[Subtitles] All tracks disabled');
        } else if (value === -2 || value === '-2') {
            // External file
            this.activeTrackIndex = -2;
            this.currentMKVTrack = null;
        } else if (typeof value === 'string' && value.startsWith('mkv-')) {
            // MKV track
            const trackIndex = parseInt(value.split('-')[1]);
            this.activeTrackIndex = -3; // MKV mode
            this.currentMKVTrack = this.mkvTracks[trackIndex];
            this.subtitleText.classList.remove('active');
            console.log(`[Subtitles] Selected MKV track ${trackIndex}`);
        } else {
            // Embedded track
            this.activeTrackIndex = parseInt(value);
            tracks[this.activeTrackIndex].mode = 'showing';
            this.currentMKVTrack = null;
            this.hasExternalSubtitles = false;
            console.log(`[Subtitles] Selected embedded track ${this.activeTrackIndex}`);
        }
    }

    parseSRT(text) {
        this.subtitles = [];
        const blocks = text.trim().split(/\n\s*\n/);
        
        blocks.forEach(block => {
            const lines = block.trim().split('\n');
            if (lines.length < 3) return;
            
            const timeLine = lines[1];
            const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
            
            if (timeMatch) {
                const startTime = this.timeToSeconds(
                    parseInt(timeMatch[1]),
                    parseInt(timeMatch[2]),
                    parseInt(timeMatch[3]),
                    parseInt(timeMatch[4])
                );
                const endTime = this.timeToSeconds(
                    parseInt(timeMatch[5]),
                    parseInt(timeMatch[6]),
                    parseInt(timeMatch[7]),
                    parseInt(timeMatch[8])
                );
                const text = lines.slice(2).join('\n');
                
                this.subtitles.push({
                    start: startTime,
                    end: endTime,
                    text: this.cleanSRTText(text)
                });
            }
        });
    }

    parseVTT(text) {
        this.subtitles = [];
        const lines = text.trim().split('\n');
        
        // Skip WEBVTT header
        let i = lines[0].startsWith('WEBVTT') ? 1 : 0;
        
        while (i < lines.length) {
            const line = lines[i].trim();
            
            // Skip empty lines and index numbers
            if (!line || /^\d+$/.test(line)) {
                i++;
                continue;
            }
            
            // Parse timestamp line
            const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
            
            if (timeMatch) {
                const startTime = this.timeToSeconds(
                    parseInt(timeMatch[1]),
                    parseInt(timeMatch[2]),
                    parseInt(timeMatch[3]),
                    parseInt(timeMatch[4])
                );
                const endTime = this.timeToSeconds(
                    parseInt(timeMatch[5]),
                    parseInt(timeMatch[6]),
                    parseInt(timeMatch[7]),
                    parseInt(timeMatch[8])
                );
                
                i++;
                const textLines = [];
                while (i < lines.length && lines[i].trim()) {
                    textLines.push(lines[i].trim());
                    i++;
                }
                
                this.subtitles.push({
                    start: startTime,
                    end: endTime,
                    text: textLines.join('\n')
                });
            } else {
                i++;
            }
        }
    }

    timeToSeconds(hours, minutes, seconds, milliseconds) {
        return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
    }

    cleanSRTText(text) {
        // Remove SRT formatting tags
        return text
            .replace(/<[^>]*>/g, '')
            .replace(/\{[^}]*\}/g, '')
            .trim();
    }

    updateSubtitle() {
        // If using embedded tracks, the browser handles display natively
        if (this.activeTrackIndex >= 0) {
            return;
        }
        
        // If using MKV subtitles
        if (this.activeTrackIndex === -3 && this.currentMKVTrack) {
            const currentTime = this.player.video.currentTime;
            const currentTimeMs = currentTime * 1000;
            const subtitles = this.currentMKVTrack.subtitles;
            
            if (subtitles.length === 0) {
                this.clearSubtitleDisplay();
                return;
            }
            
            // Binary search: find the last subtitle with startTime <= currentTime
            let idx = -1;
            let lo = 0, hi = subtitles.length - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (subtitles[mid].startTime <= currentTimeMs) {
                    idx = mid;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }
            
            if (idx !== this.currentSubtitleIndex) {
                this.currentSubtitleIndex = idx;
                
                if (idx >= 0) {
                    this.subtitleText.textContent = subtitles[idx].text;
                    this.subtitleText.classList.add('active');
                } else {
                    this.clearSubtitleDisplay();
                }
            }

            // Auto-hide subtitle if it's been on screen for more than 5 seconds
            if (idx >= 0) {
                const timeOnScreen = currentTimeMs - subtitles[idx].startTime;
                if (timeOnScreen > 5000) {
                    this.subtitleText.classList.remove('active');
                } else if (!this.subtitleText.classList.contains('active')) {
                    this.subtitleText.classList.add('active');
                }
            }
            return;
        }
        
        // If using external subtitles, display manually
        if (this.activeTrackIndex === -2 && this.hasExternalSubtitles) {
            const currentTime = this.player.video.currentTime;
            
            const active = this.subtitles.find(sub => 
                currentTime >= sub.start && currentTime <= sub.end
            );
            
            if (active !== this.currentSubtitle) {
                this.currentSubtitle = active;
                
                if (active) {
                    this.subtitleText.textContent = active.text;
                    this.subtitleText.classList.add('active');
                } else {
                    this.clearSubtitleDisplay();
                }
            }
        }
    }
    
    clearSubtitleDisplay() {
        this.subtitleText.textContent = '';
        this.subtitleText.classList.remove('active');
    }

    clear() {
        this.subtitles = [];
        this.currentSubtitle = null;
        this.subtitleText.textContent = '';
        this.subtitleText.classList.remove('active');
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    _startUpdateLoop() {
        const loop = () => {
            if (!this.player.video.paused && !this.player.video.ended) {
                this.updateSubtitle();
            }
            this._rafId = requestAnimationFrame(loop);
        };
        this._rafId = requestAnimationFrame(loop);
    }
}

// Initialize subtitle manager
const subtitles = new SubtitleManager(player);
