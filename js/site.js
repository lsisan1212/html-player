// Page shell around <movi-player>:
//  - open a local file (picker or drag & drop)
//  - grey the picture out AND zoom it in 10% while paused; restore on play
(() => {
    const player = document.getElementById('player');
    const stage = document.getElementById('stage');
    const hint = document.getElementById('drop-hint');
    const input = document.getElementById('file-input');
    const openBtn = document.getElementById('open-btn');
    const nameEl = document.getElementById('file-name');

    const GRAY_FILTER = 'grayscale(1) brightness(0.9)';
    const ZOOM = 1.1; // pause = +10% zoom

    const reduceMotion = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const EASE = reduceMotion
        ? 'none'
        : 'transform 220ms cubic-bezier(.2, .8, .2, 1), filter 180ms ease';

    // The picture lives on a canvas (WebCodecs) or a <video> (native/DASH fallback)
    // inside the element's open shadow root — style those, so the controls keep colour.
    const pictureEls = () => {
        const root = player.shadowRoot;
        if (!root) return [];
        const els = Array.from(root.querySelectorAll('canvas'));
        const v = root.querySelector('video');
        if (v) els.push(v);
        return els;
    };

    // Subtitle / poster layers are siblings of the canvas, so they have to be
    // transformed too — otherwise the picture grows but the subtitles stay put.
    const zoomEls = () => {
        const els = pictureEls();
        const root = player.shadowRoot;
        if (root) {
            root.querySelectorAll('.movi-subtitle-overlay, .movi-poster-overlay')
                .forEach((el) => els.push(el));
        }
        return els;
    };

    // The element writes its own inline transform (e.g. `rotate(90deg)` or `none`
    // for the 180° video-rotation button), so our zoom is *composed* with it
    // instead of replacing it: `rotate(90deg) scale(1.1)`.
    const SCALE_RE = /\s*scale\([^)]*\)\s*/g;
    const stripScale = (value) => {
        const kept = String(value || '').replace(SCALE_RE, ' ').trim();
        return kept === 'none' ? '' : kept;
    };
    const withScale = (value) => {
        const base = stripScale(value);
        return base ? `${base} scale(${ZOOM})` : `scale(${ZOOM})`;
    };

    const paintLook = (paused) => {
        const media = pictureEls();
        if (!media.length) return false;
        for (const el of media) {
            el.style.transition = EASE;
            el.style.filter = paused ? GRAY_FILTER : '';
        }
        for (const el of zoomEls()) {
            el.style.transition = EASE;
            el.style.transformOrigin = 'center center';
            el.style.transform = paused ? withScale(el.style.transform) : stripScale(el.style.transform);
        }
        return true;
    };

    const applyPausedLook = (paused) => {
        if (paintLook(paused)) return;
        // Element still booting (shadow root / canvas not ready) — retry briefly
        let tries = 0;
        const timer = setInterval(() => {
            tries++;
            if (paintLook(paused) || tries > 40) clearInterval(timer);
        }, 100);
    };

    let currentSrc = null;
    const loadFile = (file) => {
        if (!file) return;
        if (currentSrc) URL.revokeObjectURL(currentSrc);
        currentSrc = URL.createObjectURL(file);
        player.src = currentSrc;
        nameEl.textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
        hint.classList.add('hidden');
        stage.classList.remove('is-empty');
        document.title = `${file.name} — HTML Player`;
        console.log('[site] loaded', file.name);
    };

    openBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
        e.target.value = '';
    });

    // Drag & drop over the stage (and over the player itself)
    ['dragenter', 'dragover'].forEach((ev) => stage.addEventListener(ev, (e) => {
        e.preventDefault();
        stage.classList.add('drag-over');
    }));
    ['dragleave', 'drop'].forEach((ev) => stage.addEventListener(ev, (e) => {
        e.preventDefault();
        stage.classList.remove('drag-over');
    }));

    const onDrop = (e) => {
        e.preventDefault();
        stage.classList.remove('drag-over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) loadFile(f);
    };
    stage.addEventListener('drop', onDrop);
    player.addEventListener('dragover', (e) => e.preventDefault());
    player.addEventListener('drop', onDrop);

    // ----- Grey while paused -----
    player.addEventListener('play', () => applyPausedLook(false));
    player.addEventListener('playing', () => applyPausedLook(false));
    player.addEventListener('pause', () => applyPausedLook(true));
    player.addEventListener('ended', () => applyPausedLook(true));

    // Safety net: some paths (seek-to-start, source swap, rotation / fit change)
    // settle paused state — or overwrite the inline transform — without a
    // matching event. Poll the property and re-compose the look while paused
    // (paintLook is idempotent, so this costs nothing when nothing changed).
    let lastPaused = null;
    setInterval(() => {
        const p = player.paused;
        if (typeof p !== 'boolean') return;
        if (p !== lastPaused) {
            lastPaused = p;
            applyPausedLook(p);
        } else if (p) {
            paintLook(true);
        }
    }, 250);

    stage.classList.add('is-empty');
    if (window.customElements) {
        customElements.whenDefined('movi-player')
            .then(() => console.log('[site] movi-player defined'))
            .catch(() => {});
    }

    // ----- Keyboard: ←/→ = seek ±5s, ↑/↓ = volume -----
    // The element binds the same keys itself (seek ±10s, volume ±0.1) on the
    // host, in the bubble phase — so we sit on document/capture, which runs
    // first, and swallow the event before it reaches the element.
    const SEEK_STEP = 5;
    const VOLUME_STEP = 0.05;

    const maxVolume = () => {
        const v = typeof player.getMaxVolume === 'function'
            ? Number(player.getMaxVolume()) : 1;
        return Number.isFinite(v) && v > 0 ? v : 1;
    };

    const seekBy = (dir) => {
        if (typeof player.performRelativeSeek === 'function') {
            player.performRelativeSeek(dir, SEEK_STEP); // player draws its own "+ 5s" OSD
            return;
        }
        // fallback if that helper ever goes away
        const dur = Number(player.duration);
        const limit = Number.isFinite(dur) && dur > 0 ? dur : Infinity;
        const target = (Number(player.currentTime) || 0) + (dir === 'left' ? -SEEK_STEP : SEEK_STEP);
        player.currentTime = Math.max(0, Math.min(limit, target));
    };

    const stepVolume = (delta) => {
        const capped = maxVolume();
        // 1.0 = "normal" (the element allows up to 2.0), so report plain percent
        // of the element's own scale — 100% means normal, not 50% of the cap.
        const level = Number(player.volume) || 0;
        const next = Math.round(Math.min(capped, Math.max(0, level + delta)) * 100) / 100;
        if (delta > 0 && player.muted) player.muted = false; // ↑ un-mutes
        player.volume = next;
        const pct = Math.round(next * 100);
        const icon = next === 0 ? '🔇' : next < 0.5 ? '🔉' : '🔊';
        if (typeof player.showOSD === 'function') {
            player.showOSD('', `${icon} ${pct}%`);
        }
    };

    const isTypingTarget = (e) => {
        const t = (e.composedPath && e.composedPath()[0]) || e.target;
        if (!t) return false;
        const tag = (t.tagName || '').toUpperCase();
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
    };

    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
        const k = e.key;
        if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown') return;
        if (isTypingTarget(e)) return; // let sliders / search boxes keep their arrows
        e.preventDefault();            // arrows must not scroll the page
        e.stopPropagation();           // …and must not reach the element's own handler
        if (k === 'ArrowLeft') seekBy('left');
        else if (k === 'ArrowRight') seekBy('right');
        else stepVolume(k === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP);
    }, true);

    // The built-in "?" help panel advertises ±10s — keep it honest.
    const patchShortcutHelp = () => {
        const root = player.shadowRoot;
        if (!root) return;
        const want = `Seek ±${SEEK_STEP}s`;
        root.querySelectorAll('[data-fastseek-keys] span').forEach((el) => {
            if (el.textContent !== want) el.textContent = want;
        });
    };

    let patchQueued = false;
    if (window.MutationObserver) {
        const mo = new MutationObserver(() => {
            if (patchQueued) return;
            patchQueued = true;
            requestAnimationFrame(() => { patchQueued = false; patchShortcutHelp(); });
        });
        const attach = () => {
            const root = player.shadowRoot;
            if (!root) { setTimeout(attach, 300); return; }
            mo.observe(root, { childList: true, subtree: true });
            patchShortcutHelp();
        };
        attach();
    }
})();
