// Page shell around <movi-player>:
//  - open a local file (picker or drag & drop)
//  - grey the picture out while paused, restore colour on play
(() => {
    const player = document.getElementById('player');
    const stage = document.getElementById('stage');
    const hint = document.getElementById('drop-hint');
    const input = document.getElementById('file-input');
    const openBtn = document.getElementById('open-btn');
    const nameEl = document.getElementById('file-name');

    const GRAY_FILTER = 'grayscale(1) brightness(0.9)';

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

    const paintFilter = (gray) => {
        const els = pictureEls();
        for (const el of els) el.style.filter = gray ? GRAY_FILTER : '';
        return els.length > 0;
    };

    const applyPausedLook = (paused) => {
        if (paintFilter(paused)) return;
        // Element still booting (shadow root / canvas not ready) — retry briefly
        let tries = 0;
        const timer = setInterval(() => {
            tries++;
            if (paintFilter(paused) || tries > 40) clearInterval(timer);
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

    // Safety net: some paths (seek-to-start, source swap) settle paused state
    // without a matching event — poll the property as well.
    let lastPaused = null;
    setInterval(() => {
        const p = player.paused;
        if (typeof p === 'boolean' && p !== lastPaused) {
            lastPaused = p;
            applyPausedLook(p);
        }
    }, 250);

    stage.classList.add('is-empty');
    if (window.customElements) {
        customElements.whenDefined('movi-player')
            .then(() => console.log('[site] movi-player defined'))
            .catch(() => {});
    }
})();
