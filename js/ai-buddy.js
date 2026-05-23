class AICommentator {
    constructor(player) {
        this.player = player;
        this.currentLang = 'off';
        
        this.container = document.getElementById('ai-comments-container');
        this.list = document.getElementById('ai-comments-list');
        this.btn = document.getElementById('ai-btn');
        this.dropdown = document.getElementById('ai-dropdown');
        this.options = document.querySelectorAll('.ai-option');
        this.testBtn = document.getElementById('ai-test-btn');
        
        this.isDropdownOpen = false;
        this.timer = null;

        // Pre-read cache: stores AI responses keyed by subtitle timestamp
        this.commentCache = new Map(); // key: subtitle_text -> { response, displayTime }
        this.lastProcessedSubtitle = '';
        this.preReadInterval = null;

        this.init();
    }

    init() {
        if (!this.btn || !this.container || !this.dropdown) return;

        this.btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        document.addEventListener('click', (e) => {
            if (this.isDropdownOpen && !this.dropdown.contains(e.target) && e.target !== this.btn) {
                this.closeDropdown();
            }
        });

        this.options.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const lang = option.dataset.lang;
                this.setLanguage(lang);
                this.closeDropdown();
            });
        });

        // Model selector: show/hide custom input
        const modelSelect = document.getElementById('ai-model-select');
        const modelInput = document.getElementById('ai-model');
        if (modelSelect && modelInput) {
            modelSelect.addEventListener('change', () => {
                modelInput.style.display = modelSelect.value === 'custom' ? 'block' : 'none';
                if (modelSelect.value !== 'custom') {
                    modelInput.value = '';
                }
            });
        }

        // Test Button Click Listener
        if (this.testBtn) {
            this.testBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.testConnection();
            });
        }

        this.player.video.addEventListener('pause', () => this.stopThinking());
        this.player.video.addEventListener('play', () => {
            if (this.currentLang !== 'off') this.startThinking();
        });
    }

    toggleDropdown() {
        this.isDropdownOpen = !this.isDropdownOpen;
        this.dropdown.classList.toggle('hidden', !this.isDropdownOpen);
    }

    closeDropdown() {
        this.isDropdownOpen = false;
        this.dropdown.classList.add('hidden');
    }

    setLanguage(lang) {
        this.currentLang = lang;
        this.options.forEach(opt => opt.classList.toggle('active', opt.dataset.lang === lang));

        if (lang === 'off') {
            this.turnOff();
        } else {
            this.turnOn();
        }
    }

    turnOn() {
        this.container.classList.remove('hidden');
        this.btn.classList.add('ai-btn-active');
        
        const greetings = {
            'en': "AI Buddy activated! I'll be watching with you.",
            'zh-CN': "AI 伙伴已启动！我会陪你一起看。",
            'zh-TW': "AI 夥伴已啟動！我會陪你一起看。",
            'yue': "AI 夥伴啟動！我會陪你一齊睇。",
            'ja': "AIバディ起動！一緒に見ますよ。",
            'ko': "AI 버디 활성화! 함께 시청할게요.",
            'th': "เปิดใช้งาน AI Buddy! ฉันจะดูเป็นเพื่อนคุณเอง"
        };
        
        this.list.innerHTML = ''; 
        this.addComment(greetings[this.currentLang]);
        
        // Clear pre-read cache
        this.commentCache.clear();
        this.lastProcessedSubtitle = '';
        
        if (!this.player.video.paused) this.startThinking();
        this.startPreReading();
        
        const langName = Array.from(this.options).find(opt => opt.dataset.lang === this.currentLang).textContent;
        if (typeof keyboard !== 'undefined') keyboard.showOSD(`🤖 AI: ${langName}`);
    }

    turnOff() {
        this.container.classList.add('hidden');
        this.btn.classList.remove('ai-btn-active');
        this.stopThinking();
        this.stopPreReading();
        this.commentCache.clear();
        this.list.innerHTML = '';
        if (typeof keyboard !== 'undefined') keyboard.showOSD('🤖 AI Buddy: OFF');
    }

    startThinking() {
        // STRICT CHECK: Don't start thinking if AI is off OR if video is paused
        if (this.currentLang === 'off' || this.player.video.paused) return;
        if (this.timer) clearTimeout(this.timer);

        // Random time between 6 and 20 seconds
        const nextThoughtTime = Math.floor(Math.random() * (20000 - 6000 + 1) + 6000);

        this.timer = setTimeout(() => {
            this.generateComment();
            // Only loop if the video is still playing!
            if (!this.player.video.paused) {
                this.startThinking();
            }
        }, nextThoughtTime);
    }

    stopThinking() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    // Pre-read subtitles ahead of time and cache AI responses
    startPreReading() {
        if (this.preReadInterval) clearInterval(this.preReadInterval);
        
        // Check for new subtitles every 1 second
        this.preReadInterval = setInterval(() => {
            if (this.currentLang === 'off' || this.player.video.paused) return;
            
            const subElement = document.getElementById('subtitle-text');
            const currentSubtitle = subElement && subElement.classList.contains('active') ? subElement.textContent.trim() : '';
            
            // Skip if no subtitle or same as last processed
            if (!currentSubtitle || currentSubtitle === this.lastProcessedSubtitle) return;
            
            // Check if we already have a cached response for this subtitle
            const cacheKey = `${this.currentLang}:${currentSubtitle}`;
            if (this.commentCache.has(cacheKey)) {
                const cached = this.commentCache.get(cacheKey);
                // If it's time to display, show it
                if (Date.now() >= cached.displayTime) {
                    this.addComment(cached.response);
                    this.commentCache.delete(cacheKey);
                }
                return;
            }
            
            // Pre-read: generate AI response and cache it for ~8 seconds later
            this.lastProcessedSubtitle = currentSubtitle;
            this.preGenerateComment(currentSubtitle);
        }, 1000);
    }

    stopPreReading() {
        if (this.preReadInterval) {
            clearInterval(this.preReadInterval);
            this.preReadInterval = null;
        }
    }

    async preGenerateComment(subtitleText) {
        const apiKeyInput = document.getElementById('ai-api-key');
        const baseUrlInput = document.getElementById('ai-base-url');
        const modelSelect = document.getElementById('ai-model-select');
        const modelInput = document.getElementById('ai-model');

        const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
        let baseUrl = (baseUrlInput && baseUrlInput.value.trim()) ? baseUrlInput.value.trim() : 'https://openrouter.ai/api/v1';
        let modelName = modelSelect && modelSelect.value !== 'custom' ? modelSelect.value : (modelInput && modelInput.value.trim());
        if (!modelName) modelName = 'meta-llama/llama-3.2-3b-instruct';

        if (!baseUrl.endsWith('/chat/completions')) {
            baseUrl = baseUrl.replace(/\/$/, '') + '/chat/completions';
        }

        const isLocalhost = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
        if (!apiKey && !isLocalhost) return;

        const langNames = {
            'en': 'English', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese',
            'yue': 'Cantonese', 'ja': 'Japanese', 'ko': 'Korean', 'th': 'Thai'
        };
        const langName = langNames[this.currentLang] || this.currentLang;

        const systemPrompt = `You are watching a movie with me. The current subtitle on screen is: "${subtitleText}".
Give a short, ironic, sarcastic reaction to this line. Be witty, dry, and slightly cynical — like a friend who roasts everything but still loves the movie.
Do not use quotes. Maximum 1 sentence. Respond entirely in ${langName}.`;

        try {
            const response = await fetch(baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey || 'local-key'}`
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: [
                        { role: 'system', content: 'You are an ironic, sarcastic movie-watching buddy. Your comments are dry, witty, and slightly cynical but never mean. Keep responses very short (1 sentence max).' },
                        { role: 'user', content: systemPrompt }
                    ],
                    max_tokens: 60,
                    temperature: 0.9
                })
            });

            if (!response.ok) return;

            const data = await response.json();
            const rawContent = data.choices && data.choices[0]?.message?.content;
            if (!rawContent) return;
            
            const aiResponse = rawContent.trim();
            
            // Cache the response to be displayed ~10 seconds from now
            const cacheKey = `${this.currentLang}:${subtitleText}`;
            this.commentCache.set(cacheKey, {
                response: aiResponse,
                displayTime: Date.now() + 10000 // Display after 10 seconds
            });
        } catch (error) {
            // Silently fail for pre-read
        }
    }

    async testConnection() {
        if (!this.testBtn) return;
        
        const originalText = "Test Connection";
        this.testBtn.textContent = 'Testing... ⏳';
        this.testBtn.style.opacity = '0.7';
        this.testBtn.disabled = true;

        const apiKeyInput = document.getElementById('ai-api-key');
        const baseUrlInput = document.getElementById('ai-base-url');
        const modelSelect = document.getElementById('ai-model-select');
        const modelInput = document.getElementById('ai-model');

        const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
        // Smart Defaults: OpenRouter API + Step 3.5 Flash (Free)
        let baseUrl = (baseUrlInput && baseUrlInput.value.trim()) ? baseUrlInput.value.trim() : 'https://openrouter.ai/api/v1';
        let modelName = modelSelect && modelSelect.value !== 'custom' ? modelSelect.value : (modelInput && modelInput.value.trim());
        if (!modelName) modelName = 'stepfun/step-3.5-flash:free';

        if (!baseUrl.endsWith('/chat/completions')) {
            baseUrl = baseUrl.replace(/\/$/, '') + '/chat/completions';
        }

        try {
            const response = await fetch(baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey || 'local-key'}`
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: [{ role: 'user', content: 'Say "success".' }],
                    max_tokens: 10,
                    temperature: 0.1
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const apiError = errData.error?.message || errData.message || 'Unknown API Error';
                throw new Error(`HTTP ${response.status}: ${apiError}`);
            }

            this.testBtn.textContent = '✅ Connected!';
            this.testBtn.style.background = '#22c55e';
            if (typeof keyboard !== 'undefined') keyboard.showOSD('✅ AI Connection OK');

        } catch (error) {
            console.error('[AI Test Error]', error);
            this.testBtn.textContent = '❌ Error (See OSD)';
            this.testBtn.style.background = '#ef4444';
            if (typeof keyboard !== 'undefined') {
                keyboard.showOSD(`❌ ${error.message}`);
            }
            
        } finally {
            this.testBtn.style.opacity = '1';
            setTimeout(() => {
                this.testBtn.textContent = originalText;
                this.testBtn.style.background = 'var(--accent)';
                this.testBtn.disabled = false;
            }, 4000);
        }
    }

    async generateComment() {
        // STRICT CHECK: Double check the video state before dropping the comment
        if (this.currentLang === 'off' || this.player.video.paused) return;

        // Check cache first for any ready-to-display comments
        for (const [key, cached] of this.commentCache.entries()) {
            if (Date.now() >= cached.displayTime) {
                this.addComment(cached.response);
                this.commentCache.delete(key);
                return;
            }
        }

        // If no cached comment is ready, fall through to real-time generation
        const apiKeyInput = document.getElementById('ai-api-key');
        const baseUrlInput = document.getElementById('ai-base-url');
        const modelSelect = document.getElementById('ai-model-select');
        const modelInput = document.getElementById('ai-model');

        const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
        
        // Smart Defaults: OpenRouter API + Step 3.5 Flash (Free)
        let baseUrl = (baseUrlInput && baseUrlInput.value.trim()) ? baseUrlInput.value.trim() : 'https://openrouter.ai/api/v1';
        let modelName = modelSelect && modelSelect.value !== 'custom' ? modelSelect.value : (modelInput && modelInput.value.trim());
        if (!modelName) modelName = 'stepfun/step-3.5-flash:free';

        // Ensure the base URL ends properly for chat completions
        if (!baseUrl.endsWith('/chat/completions')) {
            baseUrl = baseUrl.replace(/\/$/, '') + '/chat/completions';
        }

        // If no API key is provided (and they aren't using a local server), stay silent
        const isLocalhost = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
        if (!apiKey && !isLocalhost) {
            return; // No API key = no comments
        }

        // Grab whatever subtitle is currently on the screen
        const subElement = document.getElementById('subtitle-text');
        const currentSubtitle = subElement && subElement.classList.contains('active') ? subElement.textContent.trim() : '';

        // If no one is talking, don't waste API credits!
        if (!currentSubtitle) {
            return;
        }

        // Show a typing indicator
        this.addComment('…');

        try {
            // Build the prompt based on the selected language
            const langNames = {
                'en': 'English', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese',
                'yue': 'Cantonese', 'ja': 'Japanese', 'ko': 'Korean', 'th': 'Thai'
            };
            const langName = langNames[this.currentLang] || this.currentLang;

            const systemPrompt = `You are watching a movie with me. The current subtitle on screen is: "${currentSubtitle}".
Give a short, ironic, sarcastic reaction to this line. Be witty, dry, and slightly cynical — like a friend who roasts everything but still loves the movie.
Do not use quotes. Maximum 1 sentence. Respond entirely in ${langName}.`;

            // Call the AI API (OpenAI-compatible endpoint)
            const response = await fetch(baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey || 'local-key'}`
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: [
                        { role: 'system', content: 'You are an ironic, sarcastic movie-watching buddy. Your comments are dry, witty, and slightly cynical but never mean. Keep responses very short (1 sentence max).' },
                        { role: 'user', content: systemPrompt }
                    ],
                    max_tokens: 60,
                    temperature: 0.9
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const apiError = errData.error?.message || errData.message || 'Unknown API Error';
                throw new Error(`HTTP ${response.status}: ${apiError}`);
            }

            const data = await response.json();
            
            // Safely check if content exists before trimming!
            const rawContent = data.choices && data.choices[0]?.message?.content;
            if (!rawContent) {
                throw new Error("API returned an empty or blocked response.");
            }
            
            const realAiReaction = rawContent.trim();

            // Replace the "…" typing indicator with the real comment
            if (this.list.lastChild && this.list.lastChild.textContent.includes('…')) {
                this.list.removeChild(this.list.lastChild);
            }
            this.addComment(realAiReaction);

        } catch (error) {
            console.error('[AI] API Error:', error.message);
            // Remove typing indicator
            if (this.list.lastChild && this.list.lastChild.textContent.includes('…')) {
                this.list.removeChild(this.list.lastChild);
            }
            // Print the exact error code into the chat box so the user can see it!
            this.addComment(`⚠️ API Failed - ${error.message}`);
        }
    }

    addComment(text) {
        const commentEl = document.createElement('div');
        commentEl.className = 'ai-comment';
        commentEl.innerHTML = `<span class="ai-name">AI_Buddy:</span> ${text}`;

        this.list.appendChild(commentEl);

        while (this.list.children.length > 5) {
            this.list.removeChild(this.list.firstChild);
        }

        setTimeout(() => {
            if (commentEl.parentNode === this.list) {
                commentEl.style.opacity = '0';
                commentEl.style.transition = 'opacity 0.5s ease';
                setTimeout(() => {
                    if (commentEl.parentNode === this.list) this.list.removeChild(commentEl);
                }, 500);
            }
        }, 12000);
    }
}

const aiBuddy = new AICommentator(player);
