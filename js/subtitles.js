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
        this.externalSources = [];      // [{name, subs}] — loaded .srt/.vtt files
        this.currentExternal = -1;
        this.panelOpen = false;
        this.subtitleSearch = document.getElementById('subtitle-search');
        this.subtitlePanel = document.getElementById('subtitle-panel');
        this.subtitlePanelList = document.getElementById('subtitle-panel-list');
        this._debugCount = 0;
        this._rafId = null; // requestAnimationFrame handle
        
        this.init();
    }

    init() {
        this.subtitleInput.addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                await this.loadSubtitleFiles([...e.target.files]);
                e.target.value = '';
            }
        });

        // Subtitle picker panel (search by file name / track name)
        const subBtn = document.getElementById('subtitle-btn');
        if (subBtn) {
            subBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePanel();
            });
        }
        const closeBtn = document.getElementById('subtitle-panel-close');
        if (closeBtn) closeBtn.addEventListener('click', () => this.closePanel());
        const loadBtn = document.getElementById('subtitle-load-btn');
        if (loadBtn) loadBtn.addEventListener('click', () => this.subtitleInput.click());
        if (this.subtitleSearch) {
            this.subtitleSearch.addEventListener('input', () => this.renderPanel());
        }
        document.addEventListener('click', (e) => {
            if (!this.panelOpen) return;
            if (this.subtitlePanel && !this.subtitlePanel.contains(e.target) && e.target !== subBtn) {
                this.closePanel();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.panelOpen) this.closePanel();
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
            // Keep the raw value: option values may be numbers, 'mkv-N' or 'ext-N'
            const v = e.target.value;
            this.selectTrack(/^-?\d+$/.test(v) ? parseInt(v, 10) : v);
            this.renderPanel();
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
                this.rebuildExternalOptions();
                this.renderPanel();
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

            // Keep external files selectable, then refresh the search panel
            this.rebuildExternalOptions();
            this.renderPanel();

            // Auto-select a "dialogue"-ish track when present, otherwise the first one
            if (tracks.length > 0) {
                let pick = 0;
                for (let i = 0; i < tracks.length; i++) {
                    if (tracks[i].name && /dialogue|full|main|complete/i.test(tracks[i].name)) { pick = i; break; }
                }
                this.trackSelect.value = `mkv-${pick}`;
                this.selectTrack(`mkv-${pick}`);
            }

            console.log(`[Subtitles] Loaded ${tracks.length} MKV subtitle track(s)`);
            
            // Update info panel
            const subEl = document.getElementById('info-subtitles');
            if (subEl) subEl.textContent = `${tracks.length} track(s) (MKV)`;
        } catch (err) {
            console.error(`[Subtitles] MKV extraction failed: ${err.message}`);
        }
    }

    async loadSubtitleFiles(files) {
        const loaded = [];
        for (const file of files) {
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext !== 'srt' && ext !== 'vtt') {
                console.error(`[Subtitles] Unsupported format: ${ext}`);
                continue;
            }
            const text = await file.text();
            const subs = [];
            if (ext === 'srt') this.parseSRT(text, subs);
            else this.parseVTT(text, subs);
            if (subs.length === 0) continue;
            this.externalSources.push({ name: file.name, subs });
            loaded.push({ name: file.name, count: subs.length });
            console.log(`[Subtitles] Loaded external: ${file.name} (${subs.length} entries)`);
        }

        if (loaded.length === 0) {
            alert('Unsupported subtitle format. Please use .srt or .vtt files.');
            return;
        }

        this.rebuildExternalOptions();
        // Mount the last file that was just added
        const lastIdx = this.externalSources.length - 1;
        this.mountExternal(lastIdx);
        this.renderPanel();

        const subEl = document.getElementById('info-subtitles');
        if (subEl) subEl.textContent = `${loaded[loaded.length - 1].name} (${loaded[loaded.length - 1].count})`;
    }

    // Rebuild the <option> list so external files stay selectable (and C-key cycle-able)
    rebuildExternalOptions() {
        // Drop old external options
        [...this.trackSelect.querySelectorAll('option[data-kind="ext"]')].forEach(o => o.remove());
        this.externalSources.forEach((src, i) => {
            const opt = document.createElement('option');
            opt.value = `ext-${i}`;
            opt.dataset.kind = 'ext';
            opt.textContent = `${src.name} [${src.subs.length}]`;
            this.trackSelect.appendChild(opt);
        });
    }

    mountExternal(index) {
        const src = this.externalSources[index];
        if (!src) return;
        this.currentExternal = index;
        this.subtitles = src.subs;
        this.hasExternalSubtitles = true;
        this.activeTrackIndex = -2;
        this.currentMKVTrack = null;
        this.currentSubtitle = null;
        this.currentSubtitleIndex = -1;
        this.trackSelect.value = `ext-${index}`;
        const subEl = document.getElementById('info-subtitles');
        if (subEl) subEl.textContent = `${src.name} (${src.subs.length})`;
        console.log(`[Subtitles] Mounted external: ${src.name}`);
    }

    // ===== Subtitle picker panel =====
    togglePanel() {
        if (this.panelOpen) { this.closePanel(); return; }
        this.panelOpen = true;
        // Sit just above the control bar, whatever its height is
        const controls = document.getElementById('controls');
        if (this.subtitlePanel && controls && !controls.classList.contains('hidden')) {
            this.subtitlePanel.style.bottom = (controls.offsetHeight + 14) + 'px';
        }
        if (this.subtitlePanel) this.subtitlePanel.classList.remove('hidden');
        this.renderPanel();
        if (this.subtitleSearch) {
            this.subtitleSearch.value = '';
            setTimeout(() => this.subtitleSearch.focus(), 50);
        }
    }

    closePanel() {
        this.panelOpen = false;
        if (this.subtitlePanel) this.subtitlePanel.classList.add('hidden');
    }

    entries() {
        const out = [{ value: '-1', label: 'CC Off', count: 0 }];
        this.mkvTracks.forEach((t, i) => {
            const lang = t.language && t.language !== 'und' ? ` (${t.language})` : '';
            out.push({ value: `mkv-${i}`, label: `MKV: ${t.name || 'Track ' + (i + 1)}${lang}`, count: t.subtitles.length });
        });
        this.externalSources.forEach((src, i) => {
            out.push({ value: `ext-${i}`, label: src.name, count: src.subs.length });
        });
        // Embedded (browser) text tracks
        const tracks = this.player.video.textTracks;
        for (let i = 0; i < tracks.length; i++) {
            if (tracks[i].kind === 'subtitles' || tracks[i].kind === 'captions') {
                out.push({ value: String(i), label: tracks[i].label || `Track ${i + 1}`, count: 0 });
            }
        }
        return out;
    }

    renderPanel() {
        if (!this.subtitlePanelList) return;
        const q = (this.subtitleSearch && this.subtitleSearch.value || '').trim().toLowerCase();
        const items = this.entries().filter(e => !q || e.label.toLowerCase().includes(q));
        this.subtitlePanelList.innerHTML = '';
        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'sub-item-empty';
            empty.textContent = '冇符合嘅字幕';
            this.subtitlePanelList.appendChild(empty);
            return;
        }
        const current = this.trackSelect.value;
        items.forEach(e => {
            const btn = document.createElement('button');
            btn.className = 'sub-item' + (e.value === current ? ' active' : '');
            const name = document.createElement('span');
            name.className = 'sub-item-name';
            name.textContent = e.label;
            btn.appendChild(name);
            if (e.count) {
                const cnt = document.createElement('span');
                cnt.className = 'sub-item-count';
                cnt.textContent = String(e.count);
                btn.appendChild(cnt);
            }
            btn.addEventListener('click', () => {
                this.trackSelect.value = e.value;
                this.selectTrack(/^-?\d+$/.test(e.value) ? parseInt(e.value, 10) : e.value);
                this.renderPanel();
                if (typeof keyboard !== 'undefined' && keyboard.showOSD) keyboard.showOSD(`💬 ${e.label}`);
                this.closePanel();
            });
            this.subtitlePanelList.appendChild(btn);
        });
    }

    loadSubtitleFile(file) {
        return this.loadSubtitleFiles([file]);
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
        this.rebuildExternalOptions();
        this.renderPanel();
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
        } else if (typeof value === 'string' && value.startsWith('ext-')) {
            // External subtitle file
            this.mountExternal(parseInt(value.split('-')[1], 10));
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

        // Keep the info panel in sync with the mounted track
        const subEl = document.getElementById('info-subtitles');
        if (subEl) {
            if (this.activeTrackIndex === -3 && this.currentMKVTrack) {
                subEl.textContent = `${this.currentMKVTrack.name || 'MKV'} (${this.currentMKVTrack.subtitles.length})`;
            } else if (this.activeTrackIndex === -1) {
                subEl.textContent = 'None';
            }
        }
    }

    parseSRT(text, into) {
        const target = into || (this.subtitles = []);
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
                
                target.push({
                    start: startTime,
                    end: endTime,
                    text: this.cleanSRTText(text)
                });
            }
        });
    }

    parseVTT(text, into) {
        const target = into || (this.subtitles = []);
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
                
                target.push({
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
