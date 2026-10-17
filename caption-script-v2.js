(function initCaptioner2Engine() {
/** Guard: returns true only if img is a fully-loaded, non-broken HTMLImageElement */
function isImageReady(img) {
    if (!img) return false;
    // HTMLVideoElement / HTMLCanvasElement / ImageBitmap are always drawable
    if (img instanceof HTMLVideoElement || img instanceof HTMLCanvasElement) return true;
    if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) return true;
    // OffscreenCanvas
    if (typeof OffscreenCanvas !== "undefined" && img instanceof OffscreenCanvas) return true;
    // HTMLImageElement — must be complete AND have natural size
    if (img instanceof HTMLImageElement) {
        return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
    }
    // Assume anything else (e.g. ImageData) is drawable
    return true;
}

let captionWorker = null;
let transcriber = null; // Keeping as a placeholder for any lingering references
const CAPTION_WORD_LIMIT = 8;
const CAPTION_BOTTOM_OFFSET_PX = 80;
const SHORT_CAPTION_GAP_SECONDS = 0.75;

function normalizeCaptionOutputLanguage(value) {
    return ({ english: 'en', telugu: 'te', hindi: 'hi', en: 'en', te: 'te', hi: 'hi' })[String(value || '').trim().toLowerCase()] || 'en';
}

function getCaptionOutputLanguage() {
    return normalizeCaptionOutputLanguage(document.getElementById('cap2_captionLanguage')?.value);
}

function captionTextScriptLanguage(text) {
    const value = String(text || '');
    if (/[\u0c00-\u0c7f]/u.test(value)) return 'te';
    if (/[\u0900-\u097f]/u.test(value)) return 'hi';
    return '';
}

function captionTranslationTimeoutMs(captions) {
    let chunks = 0, items = 0, characters = 0;
    for (const cue of captions || []) {
        const length = Array.from(String(cue.text || '')).length;
        if (items && (items >= 60 || characters + length > 2000)) { chunks++; items = 0; characters = 0; }
        items++; characters += length;
    }
    if (items) chunks++;
    return Math.min(3600000, Math.max(300000, chunks * 300000) + 30000);
}

async function translateCaptionLanguageBatch(captions, { target = 'en', sourceLanguage = '', timingSource, warnings = [], signal, fetchImpl = fetch } = {}) {
    const targetCode = normalizeCaptionOutputLanguage(target);
    const staged = JSON.parse(JSON.stringify(captions || []));
    const sourceCode = String(sourceLanguage || '').trim().toLowerCase();
    const script = captionTextScriptLanguage(staged.map(cue => cue.text).join(' '));
    // Mixed-script captions can contain words in several languages. A script
    // that contradicts ASR metadata must not become a same-language shortcut.
    const translationSource = script && script !== sourceCode ? 'auto' : sourceCode || 'auto';
    if (signal?.aborted) throw new Error('Caption translation cancelled.');
    if (!staged.length || (sourceCode === targetCode && (!script || script === targetCode))) {
        return { captions: staged, outputLanguage: targetCode, timingSource, warnings: [...warnings], translated: false };
    }
    const response = await fetchImpl('http://127.0.0.1:8434/api/translate/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ texts: staged.map(cue => String(cue.text || '')), target: targetCode, source: translationSource }),
    });
    const data = await response.json();
    if (signal?.aborted) throw new Error('Caption translation cancelled.');
    if (!response.ok) throw new Error(data?.error || `Caption translation failed (HTTP ${response.status}).`);
    if ((data?.target != null && data.target !== targetCode) || !Array.isArray(data?.results) || data.results.length !== staged.length ||
        data.results.some(text => typeof text !== 'string' || !text.trim())) {
        throw new Error('Caption translation returned incomplete captions. The previous captions are preserved.');
    }
    const translated = staged.map((cue, index) => ({ ...cue, text: data.results[index], words: [] }));
    const warning = 'Translated captions retain the original cue start and end times. Word highlighting uses estimated timing; review synchronization.';
    return { captions: translated, outputLanguage: targetCode, timingSource: 'estimated',
        warnings: [...new Set([...warnings, warning])], translated: true };
}

function getCaptionTranscriptionOptions() {
    const selected = document.getElementById('cap2_captionContentMode')?.value || 'speech';
    const selectedEngine = document.getElementById('cap2_captionEngine')?.value;
    const engine = selected === 'song-gemini' ? 'gemini'
        : ['local', 'groq', 'gemini'].includes(selectedEngine) ? selectedEngine : 'local';
    const apiKey = engine === 'groq' ? String(document.getElementById('cap2_captionGroqApiKey')?.value || '').trim() : '';
    const recoveryEl = document.getElementById('cap2_captionGroqLocalRecovery');
    return {
        captionerVersion: 2,
        contentMode: selected.startsWith('song') || engine === 'gemini' ? 'song' : 'speech',
        engine,
        audioMode: document.getElementById('cap2_captionVocalFocus')?.checked ? 'vocal-focus' : 'original',
        transcriptionHints: document.getElementById('cap2_captionVocabularyHints')?.value || '',
        allowLocalRecovery: recoveryEl ? !!recoveryEl.checked : true,
        ...(document.getElementById('cap2_captionAutoRecover') ? { autoRecoverMissingSpeech: !!document.getElementById('cap2_captionAutoRecover').checked } : {}),
        ...(apiKey ? { apiKey } : {}),
    };
}

function getCaptionEngineLabel(options = getCaptionTranscriptionOptions()) {
    return { local: 'Local Whisper', groq: 'Groq API (Fast)', gemini: 'Gemini song accuracy' }[options.engine] || 'Local Whisper';
}

function isSongCaptionMode() {
    return getCaptionTranscriptionOptions().contentMode === 'song';
}

function captionTranscriptionError(result, fallback = 'Electron transcription failed.') {
    const error = new Error(result?.error || fallback);
    for (const key of ['code', 'engine', 'providerHttpStatus', 'retryAfterMs', 'retryAt', 'retryAfterEstimated', 'timingIssue', 'cancelled']) {
        if (result?.[key] !== undefined) error[key] = result[key];
    }
    if (error.code === 'CAPTION_GROQ_TIMING_UNCERTAIN') error.captionTimingFailure = true;
    return error;
}

function captionGroqRetryMessage(error, now = Date.now()) {
    const deadline = Number(error?.retryAt);
    const seconds = Number.isFinite(deadline) && deadline > now ? Math.ceil((deadline - now) / 1000) : 0;
    return 'Groq requests are limited. '
        + (seconds ? `Wait ${seconds} seconds (until ${new Date(deadline).toLocaleTimeString()}) before retrying. ` : 'Check the Groq quota before retrying. ')
        + 'Choose Local or enable Local recovery to continue. Completed exports and remaining videos are preserved.';
}

function validateCaptionTranscriptionCues(result, duration, buildChunks) {
    try {
        const chunks = buildChunks(result, duration || 60);
        captionLocalValidateCues(chunks, duration);
        return chunks;
    } catch (error) {
        error.captionTimingFailure = true;
        throw error;
    }
}

function createCaptionTranscriptionCoordinator({ transcribe, getNow = Date.now, isCancelled = () => false, onRequest = () => {}, onPause = () => {}, validate = () => {} }) {
    let groqCooldown = null;
    const rememberLimit = error => {
        if (error?.code !== 'CAPTION_GROQ_RATE_LIMIT') return;
        const now = getNow();
        const retryAt = Number(error.retryAt);
        const retryAfterMs = Number(error.retryAfterMs);
        error.retryAt = Number.isFinite(retryAt) && retryAt > now ? retryAt
            : now + (Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 32000);
        if (!groqCooldown || error.retryAt > groqCooldown.retryAt) groqCooldown = error;
        onPause(groqCooldown);
    };
    const canRecover = (error, options) => options.engine === 'groq' && options.allowLocalRecovery !== false
        && !isCancelled() && !error?.cancelled
        && (error?.code === 'CAPTION_GROQ_RATE_LIMIT' || error?.code === 'CAPTION_GROQ_TIMING_UNCERTAIN' || error?.captionTimingFailure === true);
    const rememberResultLimit = (result, options) => {
        if (options.engine === 'groq' && result.rateLimit?.code === 'CAPTION_GROQ_RATE_LIMIT') {
            rememberLimit(captionTranscriptionError(result.rateLimit, 'Groq requests are limited.'));
        }
    };
    const request = async options => {
        if (isCancelled()) return { ok: false, cancelled: true };
        const { allowLocalRecovery, ...nativeOptions } = options;
        onRequest(nativeOptions);
        const result = await transcribe(nativeOptions);
        if (result?.cancelled || isCancelled()) return { ok: false, cancelled: true };
        if (!result?.ok) throw captionTranscriptionError(result);
        try { validate(result); }
        catch (error) {
            if (isCancelled()) return { ok: false, cancelled: true };
            rememberResultLimit(result, nativeOptions);
            error.engine = nativeOptions.engine;
            throw error;
        }
        if (isCancelled()) return { ok: false, cancelled: true };
        rememberResultLimit(result, nativeOptions);
        return result;
    };
    return {
        getCooldown: () => groqCooldown && groqCooldown.retryAt > getNow() ? groqCooldown : null,
        async run(options, onPhase = () => {}) {
            let error;
            try {
                if (options.engine === 'groq' && groqCooldown?.retryAt > getNow()) throw groqCooldown;
                return await request(options);
            } catch (failure) { error = failure; }
            rememberLimit(error);
            if (!canRecover(error, options)) throw error;
            onPhase('Local recovery', 'Groq could not verify captions or accept more requests. Transcribing the same audio with Local.');
            const { apiKey, ...localOptions } = options;
            const recovered = await request({ ...localOptions, engine: 'local', allowLocalRecovery: false, captionerVersion: 2 });
            if (recovered?.cancelled || isCancelled()) return { ok: false, cancelled: true };
            return { ...recovered, engine: 'local', recoveredFromEngine: 'groq',
                warnings: [...new Set([...(Array.isArray(recovered.warnings) ? recovered.warnings : []),
                    'Local recovery produced these captions after Groq could not complete transcription. Review words and synchronization.'])] };
        },
    };
}

async function explainCaptionTimingFailure(error, options, api = window.electronAPI) {
    if (!error?.captionTimingFailure || options?.engine !== 'groq' || options?.contentMode !== 'speech'
        || (error.engine && error.engine !== 'groq')
        || typeof api?.transcribeVideo !== 'function') return error;
    let capability;
    try {
        // This diagnostic has no source path or key. Older backends reject it
        // before extraction; current backends answer without an ASR request.
        capability = await api.transcribeVideo({ engine: 'groq', contentMode: 'speech', capabilityProbe: true });
    } catch (_) {}
    if (capability?.ok === true && Number.isFinite(capability.groqSpeechTimingRepairVersion)
        && capability.groqSpeechTimingRepairVersion >= 1) return error;
    const detail = String(error.message || 'Speech timestamps conflict.')
        .replace(/Generate captions again; the previous captions are preserved\.?/i, '').trim();
    const explained = new Error(`${detail} Close and reopen the app to activate the Groq timing fix. Your previous captions are preserved.`);
    explained.cause = error;
    explained.captionTimingFailure = true;
    explained.captionBackendRestartSuggested = true;
    return explained;
}

function spokenPhraseStart(tokens, activeIndex, limit = 8) {
    let start = 0;
    for (let i = 1; i <= activeIndex; i++) {
        const newAlphabetItem = /^[a-z]$/i.test(tokens[i] || '') && /^for\b/i.test(tokens[i + 1] || '');
        if (i - start >= limit || /[,;:.!?]["'’)]?$/.test(tokens[i - 1] || '') || newAlphabetItem) start = i;
    }
    return start;
}

function inspectCaptionQuality(captions, duration, timingSource) {
    const issues = [];
    let previousEnd = null;
    let wordCount = 0;
    for (const cue of captions || []) {
        const start = Number(cue.timestamp?.[0]), end = Number(cue.timestamp?.[1]);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) {
            issues.push('Invalid cue timing'); continue;
        }
        if (previousEnd !== null && start < previousEnd) issues.push(`Overlapping captions near ${start.toFixed(1)}s`);
        if (previousEnd !== null && start - previousEnd >= 2) issues.push(`Check possible missing speech at ${previousEnd.toFixed(1)}–${start.toFixed(1)}s`);
        previousEnd = Math.max(previousEnd ?? 0, end);
        const words = cue.words || [];
        wordCount += words.length || String(cue.text || '').trim().split(/\s+/).filter(Boolean).length;
        let wordEnd = start;
        for (const word of words) {
            const ws = Number(word.timestamp?.[0]), we = Number(word.timestamp?.[1]);
            if (!Number.isFinite(ws) || !Number.isFinite(we) || we <= ws || ws < wordEnd || ws < start || we > end) issues.push(`Uncertain word timing near ${start.toFixed(1)}s`);
            else if (we - ws > 1.5) issues.push(`Review long word timing at ${ws.toFixed(1)}s`);
            wordEnd = we;
        }
    }
    if (captions?.length && timingSource === 'estimated') issues.push('Word highlighting uses estimated timing');
    if (previousEnd !== null && Number.isFinite(duration) && duration - previousEnd >= 3) issues.push(`Check the uncaptioned ending from ${previousEnd.toFixed(1)}s`);
    return { wordCount, issues: [...new Set(issues)] };
}

function normalizeNurseryCaptionText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

const CAPTION_GRAMMAR_ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'jr', 'sr', 'vs', 'etc', 'eg', 'ie', 'fig', 'no', 'vol'
]);

const CAPTION_GRAMMAR_NON_TERMINAL_WORDS = new Set([
    'a', 'an', 'the', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'every', 'each', 'some', 'any',
    'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto', 'upon', 'about', 'between',
    'among', 'through', 'during', 'without', 'within',
    'and', 'or', 'but', 'nor', 'yet', 'so', 'because', 'although', 'though', 'while', 'if', 'unless',
    'until', 'since', 'when', 'where', 'whether', 'than', 'as', 'that', 'which', 'who', 'whom', 'whose',
    'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must'
]);

const CAPTION_GRAMMAR_CLAUSE_CONJUNCTIONS = new Set([
    'and', 'but', 'or', 'so', 'yet', 'because', 'while', 'although', 'though', 'since', 'unless', 'whereas'
]);

const CAPTION_GRAMMAR_COMMA_CONJUNCTIONS = new Set([
    'but', 'yet', 'so', 'although', 'though', 'whereas'
]);

const CAPTION_GRAMMAR_SUBORDINATORS = new Set([
    'if', 'when', 'while', 'because', 'although', 'though', 'after', 'before', 'unless', 'since', 'whenever', 'wherever', 'once'
]);

const CAPTION_GRAMMAR_INTRO_COMMA_WORDS = new Set([
    'yes', 'no', 'well', 'okay', 'ok', 'first', 'second', 'third', 'finally', 'however', 'therefore',
    'meanwhile', 'furthermore', 'moreover', 'instead', 'otherwise', 'actually', 'basically', 'honestly',
    'fortunately', 'unfortunately'
]);

const CAPTION_GRAMMAR_QUESTION_STARTERS = new Set([
    'who', 'what', 'where', 'when', 'why', 'how', 'which', 'whose', 'whom'
]);

const CAPTION_GRAMMAR_SUBJECT_STARTERS = new Set([
    'i', 'im', "i'm", 'ill', "i'll", 'ive', "i've", 'id', "i'd", 'we', 'you', 'he', 'she', 'they', 'it', 'this', 'that', 'there', 'lets', "let's"
]);

const CAPTION_GRAMMAR_LOWERCASE_AFTER_COMMA = new Set([
    ...CAPTION_GRAMMAR_NON_TERMINAL_WORDS,
    'this', 'these', 'those', 'me', 'him', 'us', 'them', 'there', 'here', 'then', 'now', 'very', 'really', 'just', 'also', 'too'
]);

function captionGrammarBaseWord(text) {
    return String(text || '')
        .normalize('NFKC')
        .replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '')
        .toLowerCase();
}

function getCaptionWordTrailingPunct(text) {
    const match = String(text || '').match(/([,.;:!?।॥]+)(["'’”)\]}]*)$/);
    return match ? match[1] : '';
}

function setCaptionWordTrailingPunct(text, punct) {
    const raw = String(text || '').trim();
    if (!raw) return raw;
    const cleaned = raw
        .replace(/\s+([,.;:!?।॥])/g, '$1')
        .replace(/[,.;:!?।॥]+(["'’”)\]}]*)$/, '$1');
    if (!punct) return cleaned.trim() || raw;
    const quoteMatch = cleaned.match(/^(.*?)(["'’”)\]}]+)$/);
    if (quoteMatch && quoteMatch[1].trim()) {
        return `${quoteMatch[1]}${punct}${quoteMatch[2]}`;
    }
    return `${cleaned}${punct}`;
}

function capitalizeCaptionWord(text) {
    return String(text || '').replace(/^([^\p{L}]*)([a-z])/u, (_, prefix, ch) => prefix + ch.toUpperCase());
}

function lowercaseCaptionWordIfFunction(text) {
    const bw = captionGrammarBaseWord(text);
    if (!bw || bw === 'i' || bw.startsWith("i'") || !CAPTION_GRAMMAR_LOWERCASE_AFTER_COMMA.has(bw)) {
        return String(text || '');
    }
    return String(text || '').replace(/^([^\p{L}]*)([A-Z])(?=[a-z']|$)/u, (_, prefix, ch) => prefix + ch.toLowerCase());
}

function normalizeCaptionPronounCasing(text) {
    return String(text || '').replace(/^([^\p{L}]*)i((?:['’](?:m|ll|ve|d))?[^\p{L}\p{M}\p{N}]*)$/iu, (full, prefix, suffix) => {
        const bw = captionGrammarBaseWord(full);
        if (bw === 'i' || bw === "i'm" || bw === "i'll" || bw === "i've" || bw === "i'd" || bw === 'im') {
            if (bw === 'im' && !/['’]/.test(full)) return full;
            return `${prefix}I${suffix.toLowerCase()}`;
        }
        return full;
    });
}

function applyCaptionGrammarPunctuationToWords(words, options = {}) {
    if (!Array.isArray(words) || !words.length || options.songMode) return words;

    for (const word of words) {
        if (!word || typeof word.text !== 'string') continue;
        let t = word.text.replace(/\s+([,.;:!?।॥])/g, '$1');
        // Normalize duplicate commas or periods while keeping ellipsis (...)
        t = t.replace(/,{2,}/g, ',').replace(/,\.|\.,/g, '.').replace(/(?<!\.)\.{2}(?!\.)/g, '.');
        t = normalizeCaptionPronounCasing(t);
        if (t.trim()) word.text = t.trim();
    }

    let sentenceStartIdx = 0;
    let clauseStartIdx = 0;
    let clauseWordCount = 0;

    for (let i = 0; i < words.length; i += 1) {
        const w = words[i];
        if (!w || typeof w.text !== 'string') continue;
        const bw = captionGrammarBaseWord(w.text);
        if (!bw) continue;

        const next = words[i + 1];
        const nextBw = next ? captionGrammarBaseWord(next.text) : '';
        const gap = next && Number.isFinite(next.start) && Number.isFinite(w.end)
            ? Math.max(0, next.start - w.end)
            : 999;
        let punct = getCaptionWordTrailingPunct(w.text);
        if (punct.length > 1 && punct !== '...') {
            punct = /[!?]/.test(punct) ? punct.match(/[!?]/)[0] : /\./.test(punct) ? '.' : punct[0];
            w.text = setCaptionWordTrailingPunct(w.text, punct);
        }

        const sentenceWordCount = i - sentenceStartIdx + 1;
        const sentenceFirstBw = captionGrammarBaseWord(words[sentenceStartIdx]?.text || '');
        const clauseFirstBw = captionGrammarBaseWord(words[clauseStartIdx]?.text || '');
        const atSentenceStart = i === sentenceStartIdx;
        clauseWordCount += 1;

        // 1. Final word of the transcript must end with a terminal period/question/exclamation, never a dangling comma.
        if (!next) {
            if (!punct || punct === ',' || punct === ';' || punct === ':') {
                const isQuestion = CAPTION_GRAMMAR_QUESTION_STARTERS.has(sentenceFirstBw)
                    && !(sentenceFirstBw === 'what' && captionGrammarBaseWord(words[sentenceStartIdx + 1]?.text) === 'a')
                    && !(sentenceFirstBw === 'how' && captionGrammarBaseWord(words[sentenceStartIdx + 1]?.text) === 'to');
                w.text = setCaptionWordTrailingPunct(w.text, isQuestion ? '?' : '.');
            }
            continue;
        }

        // 2. Non-terminal function words (articles, prepositions, auxiliaries, conjunctions) must not carry mid-phrase , or .
        if (CAPTION_GRAMMAR_NON_TERMINAL_WORDS.has(bw) && gap < 0.60) {
            if (punct === ',' || (punct === '.' && !CAPTION_GRAMMAR_ABBREVIATIONS.has(bw) && bw.length > 1)) {
                w.text = setCaptionWordTrailingPunct(w.text, '');
                punct = '';
                if (next) next.text = lowercaseCaptionWordIfFunction(next.text);
            }
        }

        // 3. Repair false mid-sentence periods (. -> , before conjunctions, or remove . in continuous speech)
        if (punct === '.' && !CAPTION_GRAMMAR_ABBREVIATIONS.has(bw) && bw.length > 1) {
            if (CAPTION_GRAMMAR_CLAUSE_CONJUNCTIONS.has(nextBw) && gap < 0.45) {
                w.text = setCaptionWordTrailingPunct(w.text, ',');
                punct = ',';
                clauseWordCount = 0;
                clauseStartIdx = i + 1;
                next.text = lowercaseCaptionWordIfFunction(next.text);
            } else if (gap < 0.18 && (CAPTION_GRAMMAR_NON_TERMINAL_WORDS.has(nextBw) || /^[a-z]/.test(String(next.text || '').replace(/^[^\p{L}]+/u, '')))) {
                w.text = setCaptionWordTrailingPunct(w.text, '');
                punct = '';
                next.text = lowercaseCaptionWordIfFunction(next.text);
            }
        }

        // 4. Repair dangling commas at full sentence pauses (, -> .)
        if (punct === ',') {
            if (gap >= 0.65 && sentenceWordCount >= 3 && !CAPTION_GRAMMAR_SUBORDINATORS.has(clauseFirstBw)) {
                w.text = setCaptionWordTrailingPunct(w.text, '.');
                punct = '.';
            } else if (CAPTION_GRAMMAR_NON_TERMINAL_WORDS.has(bw) && gap < 0.35) {
                w.text = setCaptionWordTrailingPunct(w.text, '');
                punct = '';
            }
        }

        // 5. Insert missing , and . according to grammar and speech pauses
        if (!punct && !CAPTION_GRAMMAR_NON_TERMINAL_WORDS.has(bw)) {
            if (atSentenceStart && CAPTION_GRAMMAR_INTRO_COMMA_WORDS.has(bw) && !['of', 'to', 'all', 'that'].includes(nextBw)) {
                w.text = setCaptionWordTrailingPunct(w.text, ',');
                punct = ',';
                clauseWordCount = 0;
                clauseStartIdx = i + 1;
            } else if (
                i === sentenceStartIdx + 1
                && ['hello', 'hi', 'hey', 'welcome'].includes(sentenceFirstBw)
                && ['everyone', 'friends', 'kids', 'children', 'students', 'class', 'guys', 'all', 'there', 'world'].includes(bw)
            ) {
                const greetPunct = gap >= 0.55 ? '.' : ',';
                w.text = setCaptionWordTrailingPunct(w.text, greetPunct);
                punct = greetPunct;
                clauseWordCount = 0;
                clauseStartIdx = i + 1;
            } else if (gap >= 0.60 && sentenceWordCount >= 2) {
                if (CAPTION_GRAMMAR_SUBORDINATORS.has(clauseFirstBw) && clauseWordCount <= 7 && gap < 0.90) {
                    w.text = setCaptionWordTrailingPunct(w.text, ',');
                    punct = ',';
                    clauseWordCount = 0;
                    clauseStartIdx = i + 1;
                } else {
                    const isQuestion = CAPTION_GRAMMAR_QUESTION_STARTERS.has(sentenceFirstBw)
                        && !(sentenceFirstBw === 'what' && captionGrammarBaseWord(words[sentenceStartIdx + 1]?.text) === 'a')
                        && !(sentenceFirstBw === 'how' && captionGrammarBaseWord(words[sentenceStartIdx + 1]?.text) === 'to');
                    w.text = setCaptionWordTrailingPunct(w.text, isQuestion ? '?' : '.');
                    punct = isQuestion ? '?' : '.';
                }
            } else if (
                CAPTION_GRAMMAR_SUBORDINATORS.has(clauseFirstBw)
                && clauseWordCount >= 3
                && clauseWordCount <= 9
                && clauseStartIdx + clauseWordCount - 1 === i
                && (gap >= 0.22 || CAPTION_GRAMMAR_SUBJECT_STARTERS.has(nextBw))
            ) {
                w.text = setCaptionWordTrailingPunct(w.text, ',');
                punct = ',';
                clauseWordCount = 0;
                clauseStartIdx = i + 1;
            } else if (clauseWordCount >= 3 && CAPTION_GRAMMAR_COMMA_CONJUNCTIONS.has(nextBw) && gap >= 0.10) {
                w.text = setCaptionWordTrailingPunct(w.text, ',');
                punct = ',';
                clauseWordCount = 0;
                clauseStartIdx = i + 1;
            } else if (
                gap >= 0.32
                && clauseWordCount >= 3
                && !['that', 'to', 'of', 'for', 'in', 'on', 'with', 'at', 'by', 'from', 'than', 'as'].includes(nextBw)
            ) {
                w.text = setCaptionWordTrailingPunct(w.text, ',');
                punct = ',';
                clauseWordCount = 0;
                clauseStartIdx = i + 1;
            }
        }

        if (/[.!?।॥]/.test(punct) && !(punct === '.' && CAPTION_GRAMMAR_ABBREVIATIONS.has(bw))) {
            sentenceStartIdx = i + 1;
            clauseStartIdx = i + 1;
            clauseWordCount = 0;
        } else if (/[,;:]/.test(punct)) {
            clauseStartIdx = i + 1;
            clauseWordCount = 0;
            if (next) next.text = lowercaseCaptionWordIfFunction(next.text);
        }
    }

    // 6. Ensure sentence-initial capitalization after . ! ? and at start of transcript
    for (let i = 0; i < words.length; i += 1) {
        const w = words[i];
        if (!w || typeof w.text !== 'string') continue;
        const prev = words[i - 1];
        const prevPunct = prev ? getCaptionWordTrailingPunct(prev.text) : '';
        const prevBw = prev ? captionGrammarBaseWord(prev.text) : '';
        if (i === 0 || (/[.!?।॥]/.test(prevPunct) && !(prevPunct === '.' && CAPTION_GRAMMAR_ABBREVIATIONS.has(prevBw)))) {
            w.text = capitalizeCaptionWord(w.text);
        }
    }

    return words;
}

function applyCaptionGrammarPunctuation(captions, options = {}) {
    if (!Array.isArray(captions) || !captions.length || options.songMode) return captions;
    const flatWords = [];
    const cueMappings = [];
    for (let cueIdx = 0; cueIdx < captions.length; cueIdx += 1) {
        const cue = captions[cueIdx];
        const timestamp = Array.isArray(cue?.timestamp) ? cue.timestamp : [cue?.start, cue?.end];
        const cueStart = Number(timestamp?.[0]) || 0;
        const cueEnd = Number(timestamp?.[1]) || (cueStart + 0.5);
        const sourceTokens = String(cue?.text || '').trim().split(/\s+/).filter(Boolean);
        const hasTimedWords = Array.isArray(cue?.words) && cue.words.length === sourceTokens.length && cue.words.length > 0;
        const indices = [];
        for (let tokenIdx = 0; tokenIdx < sourceTokens.length; tokenIdx += 1) {
            const wObj = hasTimedWords ? cue.words[tokenIdx] : null;
            const wTimes = Array.isArray(wObj?.timestamp) ? wObj.timestamp : [wObj?.start, wObj?.end];
            const start = Number.isFinite(Number(wTimes?.[0]))
                ? Number(wTimes[0])
                : cueStart + (tokenIdx / Math.max(1, sourceTokens.length)) * (cueEnd - cueStart);
            const end = Number.isFinite(Number(wTimes?.[1]))
                ? Number(wTimes[1])
                : cueStart + ((tokenIdx + 1) / Math.max(1, sourceTokens.length)) * (cueEnd - cueStart);
            indices.push(flatWords.length);
            flatWords.push({
                text: String(wObj?.text ?? wObj?.word ?? sourceTokens[tokenIdx]),
                start,
                end
            });
        }
        cueMappings.push({ cue, hasTimedWords, indices });
    }

    applyCaptionGrammarPunctuationToWords(flatWords, options);

    return cueMappings.map(({ cue, hasTimedWords, indices }) => {
        if (!indices.length) return cue;
        const updatedTokens = indices.map(idx => flatWords[idx].text);
        const updatedText = normalizeNurseryCaptionText(updatedTokens.join(' '));
        if (hasTimedWords) {
            const updatedWords = cue.words.map((w, idx) => ({
                ...w,
                text: updatedTokens[idx] || w.text
            }));
            return { ...cue, text: updatedText, words: updatedWords };
        }
        return { ...cue, text: updatedText };
    });
}

function buildSpeechBoundedCaptionChunks(sourceWords, maxWords = CAPTION_WORD_LIMIT, sourceSegments = []) {
    const words = [];
    for (const [, word] of (Array.isArray(sourceWords) ? sourceWords : []).entries()) {
        const text = word?.word ?? word?.text;
        if (typeof text !== 'string' || !text.trim()) continue;
        const rawStart = Number(word?.start ?? (Array.isArray(word?.timestamp) ? word.timestamp[0] : undefined));
        const rawEnd = Number(word?.end ?? (Array.isArray(word?.timestamp) ? word.timestamp[1] : undefined));
        const previous = words[words.length - 1];
        const floor = previous ? previous.end : 0;
        let start = Number.isFinite(rawStart) && rawStart >= 0 ? rawStart : floor;
        let end = Number.isFinite(rawEnd) && rawEnd > 0 ? rawEnd : start + 0.16;
        // Keep recognition order and repair minor overlaps or zero-length timestamps in Captioner 2.
        if (previous && start < previous.end) {
            const prevSpan = previous.end - previous.start;
            if (prevSpan > 0.08 && start > previous.start + 0.04) {
                previous.end = Number(start.toFixed(3));
            } else {
                start = previous.end;
            }
        }
        if (end <= start) {
            end = Number((start + 0.12).toFixed(3));
        }
        words.push({ text: text.trim(), start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) });
    }
    // Local Whisper's segment boundaries carry phrase breaks and punctuation that
    // its flat word list loses. Transfer segment punctuation and phrase starts when aligned.
    const phraseStarts = new Set();
    const normalizeToken = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
    let segmentCursor = 0;
    for (const segment of sourceSegments) {
        const tokens = String(segment?.text || '').trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) continue;
        if (!tokens.every((token, index) => words[segmentCursor + index]
            && normalizeToken(token) === normalizeToken(words[segmentCursor + index].text))) break;
        phraseStarts.add(segmentCursor);
        // Segment punctuation is sometimes absent from individual word text.
        tokens.forEach((token, index) => {
            const targetWord = words[segmentCursor + index];
            const segPunct = getCaptionWordTrailingPunct(token);
            if (targetWord && segPunct && !getCaptionWordTrailingPunct(targetWord.text)) {
                targetWord.text = setCaptionWordTrailingPunct(targetWord.text, segPunct);
            }
            if (/[.!?]["'’)]?$/.test(token)) phraseStarts.add(segmentCursor + index + 1);
        });
        segmentCursor += tokens.length;
    }
    applyCaptionGrammarPunctuationToWords(words, { songMode: isSongCaptionMode() });
    const chunks = [];
    let group = [];
    const flush = () => {
        if (!group.length) return;
        const normalizedText = normalizeNurseryCaptionText(group.map((word) => word.text).join(' '));
        const normalizedTokens = normalizedText.split(/\s+/).filter(Boolean);
        chunks.push({
            text: normalizedText,
            timestamp: [group[0].start, group[group.length - 1].end],
            words: group.map((word, index) => ({
                text: normalizedTokens[index] || word.text,
                timestamp: [word.start, word.end]
            }))
        });
        group = [];
    };
    const commaBreakThreshold = Math.max(4, Math.ceil(Math.max(1, maxWords) / 2));
    for (const [wordIndex, word] of words.entries()) {
        const previous = group[group.length - 1];
        const gap = previous ? word.start - previous.end : 0;
        const previousEndsSentence = previous
            ? /[.!?।॥]["'’”)\]}]*$/.test(previous.text) && !CAPTION_GRAMMAR_ABBREVIATIONS.has(captionGrammarBaseWord(previous.text))
            : false;
        const previousEndsClauseComma = previous
            ? /[,;:]["'’”)\]}]*$/.test(previous.text) && (group.length >= commaBreakThreshold || gap >= 0.22)
            : false;
        if (group.length && (
            group.length >= Math.max(1, maxWords) ||
            // A brief phrase pause must stay blank rather than being covered
            // by a group containing words from both sides of the pause.
            gap >= 0.3 ||
            previousEndsSentence ||
            previousEndsClauseComma ||
            phraseStarts.has(wordIndex)
        )) flush();
        group.push(word);
    }
    flush();
    return chunks;
}

// Canonical, copy-only boundary between the legacy page and its caption workbench.
function applyCaptionSpellingCorrections(captions, rulesText) {
    const normalize = text => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
    const rules = String(rulesText || '').split('\n').map(line => line.split('=')).filter(parts => parts.length === 2)
        .map(([from, to]) => ({ from: from.trim().split(/\s+/).map(normalize), to: to.trim() }))
        .filter(rule => rule.from.every(Boolean) && rule.to && !/\s/.test(rule.to));
    const corrected = captions.map(caption => {
        let text = String(caption.text || '');
        const sourceTokens = text.match(/\S+/g) || [];
        const hasTimedWords = Array.isArray(caption.words) && caption.words.length > 0
            && caption.words.length === sourceTokens.length && caption.words.every((word, index) =>
                normalize(word?.text || '') === normalize(sourceTokens[index])
                && Array.isArray(word?.timestamp) && word.timestamp.length === 2
                && word.timestamp.every(Number.isFinite) && word.timestamp[1] > word.timestamp[0]);
        let words = hasTimedWords ? caption.words.map(word => ({ ...word, timestamp: [...word.timestamp] })) : null;
        for (const rule of rules) {
            const tokens = Array.from(text.matchAll(/\S+/g));
            for (let index = tokens.length - rule.from.length; index >= 0; index--) {
                if (!rule.from.every((token, offset) => normalize(tokens[index + offset][0]) === token)) continue;
                if (words && rule.from.length > 1 && words.slice(index, index + rule.from.length - 1).some((word, offset) =>
                    words[index + offset + 1].timestamp[0] - word.timestamp[1] >= 0.3)) continue;
                const first = tokens[index], last = tokens[index + rule.from.length - 1];
                const prefix = first[0].match(/^[^\p{L}\p{M}\p{N}]+/u)?.[0] || '';
                const suffix = last[0].match(/[^\p{L}\p{M}\p{N}]+$/u)?.[0] || '';
                const replacementText = prefix + rule.to + suffix;
                text = text.slice(0, first.index) + replacementText + text.slice(last.index + last[0].length);
                if (words) {
                    const replacement = { ...words[index], text: replacementText,
                        timestamp: [words[index].timestamp[0], words[index + rule.from.length - 1].timestamp[1]] };
                    words.splice(index, rule.from.length, replacement);
                }
            }
        }
        return { ...caption, text, ...(words ? { words } : Array.isArray(caption.words) && text !== caption.text ? { words: [] } : {}) };
    });
    return applyCaptionGrammarPunctuation(corrected, { songMode: isSongCaptionMode() });
}

function captionHasSpeechAtTime(caption, time) {
    const words = caption?.words;
    if (!Array.isArray(words) || !words.length) return true;
    const firstStart = Number(words[0].timestamp?.[0] ?? words[0].start);
    const lastEnd = Number(words[words.length - 1].timestamp?.[1] ?? words[words.length - 1].end);
    if (time < firstStart || time >= lastEnd) return false;
    for (let index = 0; index < words.length - 1; index += 1) {
        const end = Number(words[index].timestamp?.[1] ?? words[index].end);
        const start = Number(words[index + 1].timestamp?.[0] ?? words[index + 1].start);
        if (start - end >= 0.3 && time >= end && time < start) return false;
    }
    return true;
}

function fitCaptionBlock(height, fontSize, lineHeight, lineCount, positionY) {
    const padding = Math.min(8, height * 0.025);
    const originalHeight = fontSize + Math.max(0, lineCount - 1) * lineHeight;
    const scale = Math.min(1, Math.max(1, height - padding * 2) / Math.max(1, originalHeight));
    const halfHeight = originalHeight * scale / 2;
    const y = Math.max(padding + halfHeight, Math.min(height - padding - halfHeight, height * positionY));
    return { fontSize: fontSize * scale, lineHeight: lineHeight * scale, y, scale };
}

function captionLocalCanonicalCue(cue) {
    const timestamp = Array.isArray(cue?.timestamp) ? cue.timestamp : [cue?.start, cue?.end];
    const result = { start: Number(timestamp[0]), end: Number(timestamp[1]), text: String(cue?.text ?? '') };
    if (typeof cue?.colorOverride === 'string' && /^#[0-9a-f]{6}$/i.test(cue.colorOverride)) result.colorOverride = cue.colorOverride;
    if (Array.isArray(cue?.words)) result.words = cue.words.map(word => {
        const timing = Array.isArray(word.timestamp) ? word.timestamp : [word.start, word.end];
        return { text: String(word.text ?? word.word ?? ''), start: Number(timing[0]), end: Number(timing[1]) };
    });
    return result;
}

function captionLocalLegacyCue(cue) {
    const result = { text: cue.text, timestamp: [cue.start, cue.end] };
    if (typeof cue.colorOverride === 'string' && /^#[0-9a-f]{6}$/i.test(cue.colorOverride)) result.colorOverride = cue.colorOverride;
    if (Array.isArray(cue.words)) result.words = cue.words.map(word => ({ text: word.text, timestamp: [word.start, word.end] }));
    return result;
}

function captionLocalValidateCues(captions, duration) {
    if (!Array.isArray(captions) || captions.length > 20000) throw new Error('Provide a valid caption list with at most 20,000 cues.');
    return captions.map((source, index) => {
        if (!source || typeof source.text !== 'string' || !source.text.trim()) throw new Error(`Caption ${index + 1} needs nonempty text.`);
        const rawTimes = Array.isArray(source.timestamp) ? source.timestamp : [source.start, source.end];
        if (typeof rawTimes[0] !== 'number' || typeof rawTimes[1] !== 'number') throw new Error(`Caption ${index + 1} needs numeric start/end times.`);
        if (source.words !== undefined && !Array.isArray(source.words)) throw new Error(`Caption ${index + 1} needs a valid word list.`);
        for (const word of source.words || []) {
            if (!word || typeof (word.text ?? word.word) !== 'string') throw new Error(`Caption ${index + 1} needs valid word text.`);
            const rawWordTimes = Array.isArray(word?.timestamp) ? word.timestamp : [word?.start, word?.end];
            if (typeof rawWordTimes[0] !== 'number' || typeof rawWordTimes[1] !== 'number') throw new Error(`Caption ${index + 1} needs numeric word times.`);
        }
        const cue = captionLocalCanonicalCue(source);
        if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start
            || (Number.isFinite(duration) && duration > 0 && cue.end > duration)) {
            throw new Error(`Caption ${index + 1} needs valid start/end times within the video.`);
        }
        let previousWordEnd = cue.start;
        for (const word of cue.words || []) {
            if (!word.text.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start
                || word.start < cue.start || word.end > cue.end || word.start < previousWordEnd) {
                throw new Error(`Caption ${index + 1} contains word times outside its cue. Repair or remove those word times first.`);
            }
            previousWordEnd = word.end;
        }
        return cue;
    });
}

function captionLocalReconcileText(cue, text) {
    const next = { ...captionLocalCanonicalCue(cue), text: String(text) };
    const tokens = next.text.trim().split(/\s+/).filter(Boolean);
    const estimated = !next.words?.length || next.words.length !== tokens.length;
    if (estimated) delete next.words;
    else next.words = next.words.map((word, index) => ({ ...word, text: tokens[index] }));
    return { cue: captionLocalLegacyCue(next), estimated };
}

function captionLocalLanguageCode(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text === 'auto' || text === 'und') return '';
    const named = { english: 'en', telugu: 'te', hindi: 'hi', tamil: 'ta', urdu: 'ur', arabic: 'ar' }[text];
    if (named) return named;
    if (/^[a-z]{2}(?:[-_][a-z]{2})?$/.test(text)) return text.slice(0, 2);
    throw new Error('Caption language metadata needs a language name or two-letter code.');
}

function captionLocalEngineMetadata(metadata, state) {
    const fields = metadata || {};
    const explicitEngine = Object.prototype.hasOwnProperty.call(fields, 'engine');
    const explicitRecovery = Object.prototype.hasOwnProperty.call(fields, 'recoveredFromEngine');
    if (explicitEngine && !['local', 'groq', 'gemini'].includes(fields.engine)) {
        throw new Error('Caption engine metadata must be local, groq or gemini.');
    }
    const engine = explicitEngine ? fields.engine : state?.engine;
    if (explicitRecovery && fields.recoveredFromEngine !== undefined
        && (fields.recoveredFromEngine !== 'groq' || engine !== 'local')) {
        throw new Error('Caption recovery metadata must identify Groq recovery produced by Local.');
    }
    return { ...(explicitEngine ? { engine } : {}),
        ...(explicitEngine || explicitRecovery ? { recoveredFromEngine: explicitRecovery ? fields.recoveredFromEngine : undefined } : {}) };
}

function captionLocalEditedQueueItem(item, captions, metadata, preserveLanguage = false) {
    const engineMetadata = captionLocalEngineMetadata(metadata, item);
    const nextLanguage = { sourceLanguage: item.sourceLanguage, outputLanguage: item.outputLanguage, captionLanguage: item.captionLanguage };
    const explicitSource = Object.prototype.hasOwnProperty.call(metadata, 'sourceLanguage') || Object.prototype.hasOwnProperty.call(metadata, 'language');
    const explicitOutput = Object.prototype.hasOwnProperty.call(metadata, 'outputLanguage');
    if (explicitSource) {
        nextLanguage.sourceLanguage = captionLocalLanguageCode(Object.prototype.hasOwnProperty.call(metadata, 'sourceLanguage') ? metadata.sourceLanguage : metadata.language);
        if (!explicitOutput) nextLanguage.outputLanguage = undefined;
    }
    if (explicitOutput) nextLanguage.outputLanguage = captionLocalLanguageCode(metadata.outputLanguage) || undefined;
    const textChanged = JSON.stringify((item.captions || []).map(cue => cue.text)) !== JSON.stringify(captions.map(cue => cue.text));
    const nextScript = captionTextScriptLanguage(captions.map(cue => cue.text).join(' '));
    if (textChanged && !preserveLanguage && !explicitSource && !explicitOutput) {
        const previousScript = captionTextScriptLanguage((item.captions || []).map(cue => cue.text).join(' '));
        const knownLanguage = nextLanguage.outputLanguage || nextLanguage.sourceLanguage;
        const knownScript = ['te', 'hi'].includes(knownLanguage) ? knownLanguage : '';
        if (nextScript !== knownScript && (nextScript || previousScript || knownScript)) {
            nextLanguage.outputLanguage = undefined;
            nextLanguage.sourceLanguage = nextScript;
        }
    }
    if (!preserveLanguage && nextScript && nextLanguage.outputLanguage && nextScript !== nextLanguage.outputLanguage) {
        nextLanguage.outputLanguage = undefined;
    }
    nextLanguage.captionLanguage = { en: 'English', te: 'Telugu', hi: 'Hindi' }[nextLanguage.outputLanguage];
    return { ...item, captions: captions.map(cue => captionLocalLegacyCue(captionLocalCanonicalCue(cue))),
        ...nextLanguage, ...engineMetadata, timingSource: metadata.timingSource, warnings: [...(metadata.warnings || [])],
        status: 'transcribed', progress: 0, message: 'Captions edited. Review and export again.',
        outputPath: undefined, outputFileName: undefined, outputUrl: undefined };
}

function createCaptionLocalWorkbenchBridge(callbacks) {
    const getState = () => {
        const state = callbacks.readState();
        return { ...state, captions: (state.captions || []).map(captionLocalCanonicalCue), warnings: [...(state.warnings || [])] };
    };
    const publish = () => {
        const state = getState();
        callbacks.publish?.(state);
        return state;
    };
    const requireEditable = itemId => {
        const state = getState();
        if (!state.itemId || state.itemId !== itemId) throw new Error('The selected video changed. Reopen its captions and try again.');
        if (state.disabled) throw new Error('Wait for caption generation, translation, or export to finish before editing.');
        return state;
    };
    return {
        getState, publish,
        applyCaptions(itemId, captions, metadata) {
            const state = requireEditable(itemId);
            const canonical = captionLocalValidateCues(captions, state.duration);
            const engineMetadata = captionLocalEngineMetadata(metadata, state);
            const timingSource = !metadata || !Object.prototype.hasOwnProperty.call(metadata, 'timingSource') ? state.timingSource
                : metadata?.timingSource === 'estimated' ? 'estimated' : metadata?.timingSource === 'word' ? 'word' : undefined;
            const warnings = metadata && Object.prototype.hasOwnProperty.call(metadata, 'warnings')
                ? (Array.isArray(metadata.warnings) ? metadata.warnings.map(String) : []) : state.warnings;
            const languageMetadata = {};
            for (const field of ['sourceLanguage', 'language', 'outputLanguage']) {
                if (metadata && Object.prototype.hasOwnProperty.call(metadata, field)) languageMetadata[field] = captionLocalLanguageCode(metadata[field]);
            }
            callbacks.apply(canonical.map(captionLocalLegacyCue), { timingSource, warnings: [...warnings], ...languageMetadata, ...engineMetadata });
            publish();
            return true;
        },
        seek(itemId, time) {
            const state = requireEditable(itemId);
            if (!state.hasVideo || !Number.isFinite(Number(time))) return false;
            callbacks.seek(Number(time));
            return true;
        },
        setPreviewSpeed(speed) {
            const state = getState();
            if (state.disabled || ![0.5, 0.75, 1, 1.25, 1.5].includes(Number(speed))) return false;
            callbacks.setPreviewSpeed(Number(speed));
            publish();
            return true;
        },
        toggleCaptionLoop(itemId) {
            const state = requireEditable(itemId);
            if (!state.hasVideo || !state.captions.length) return false;
            const changed = callbacks.toggleCaptionLoop();
            publish();
            return changed !== false;
        },
        notice(message) { callbacks.notice(String(message || '')); },
    };
}

// Terminal notifications are optional and never block caption processing.
function createCaptionWhatsAppJob(processName) {
    let settled = false;
    const id = 'caption-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    return (status, detail) => {
        if (settled) return;
        const message = String(detail?.message || detail || '');
        if (status === 'cancelled' || detail?.cancelled || detail?.canceled || detail?.name === 'AbortError' || /\b(?:cancelled|canceled|aborted by user)\b/i.test(message)) {
            settled = true;
            return;
        }
        if (status !== 'completed' && status !== 'failed') return;
        settled = true;
        try {
            const report = window.electronAPI?.reportWhatsAppJob;
            if (typeof report === 'function') Promise.resolve(report({ id, status, processName, details: message.slice(0, 700) })).catch(() => {});
        } catch (_) { /* Notifications must not change the job's result. */ }
    };
}

function bootCaptionStudio() {
  const videoInput = document.getElementById('cap2_captionVideoInput');
  if (!videoInput || videoInput.dataset.cap2Bound === 'true') {
    return;
  }
  videoInput.dataset.cap2Bound = 'true';
  window.__presentatorCaptioner2Booted = true;
  try {
    const videoContainer = document.getElementById('cap2_captionVideoContainer');
    const sourceVideo = document.getElementById('cap2_captionSourceVideo');
    const renderCanvas = document.getElementById('cap2_captionRenderCanvas');
    const statusText = document.getElementById('cap2_captionStatusText');
    const actionBtn = document.getElementById('cap2_captionActionBtn');
    const cancelBtn = document.getElementById('cap2_captionCancelBtn');
    const exportBtn = document.getElementById('cap2_captionExportBtn');
    const previewBtn = document.getElementById('cap2_captionPreviewBtn');
    const exportActions = document.getElementById('cap2_captionExportActions');
    const eraseBtn = document.getElementById('cap2_captionEraseBtn');
    const progressBlock = document.getElementById('cap2_captionProgress');
    const queuePanel = document.getElementById('cap2_captionQueuePanel');
    const queueList = document.getElementById('cap2_captionQueueList');
    const spellingCorrections = document.getElementById('cap2_captionSpellingCorrections');
    if (spellingCorrections) {
        try { const saved = localStorage.getItem('caption-spelling-corrections'); if (saved !== null) spellingCorrections.value = saved; } catch (_) {}
        spellingCorrections.addEventListener('input', () => { try { localStorage.setItem('caption-spelling-corrections', spellingCorrections.value); } catch (_) {} });
    }
    const queueStatus = document.getElementById('cap2_captionQueueStatus');
    const queueRunBtn = document.getElementById('cap2_captionQueueRunBtn');
    const queueExportAllBtn = document.getElementById('cap2_captionQueueExportAllBtn');
    const queuePrevBtn = document.getElementById('cap2_captionQueuePrevBtn');
    const queueNextBtn = document.getElementById('cap2_captionQueueNextBtn');
    const QUEUE_EXPORT_FONT_SIZE = 50;
    const CAPTION_PREVIEW_MAX_DIM = 1920;
    
    // Controls
    const playPauseBtn = document.getElementById('cap2_captionPlayPauseBtn');
    const seekSlider = document.getElementById('cap2_captionSeekSlider');
    const timeDisplay = document.getElementById('cap2_captionTimeDisplay');
    const videoControls = document.getElementById('cap2_captionVideoControls');
    
    // Editor UI
    const editorPanel = document.getElementById('cap2_captionEditorPanel');
    const captionList = document.getElementById('cap2_captionList');
    const resetBtn = document.getElementById('cap2_captionResetBtn');
    
    // Style Selector & Layout & Advanced Control
    const styleSelect = document.getElementById('cap2_captionStyleSelect');
    const sizeSlider = document.getElementById('cap2_captionSizeSlider');
    const gapSlider = document.getElementById('cap2_captionGapSlider');
    const widthSlider = document.getElementById('cap2_captionWidthSlider');
    const sizeValue = document.getElementById('cap2_captionSizeValue');
    const gapValue = document.getElementById('cap2_captionGapValue');
    const widthValue = document.getElementById('cap2_captionWidthValue');
    const translateCheck = document.getElementById('cap2_captionTranslateCheck');
    const fontSelect = document.getElementById('cap2_captionFontSelect');
    const strokeSlider = document.getElementById('cap2_captionStrokeSlider');
    const strokeValue = document.getElementById('cap2_captionStrokeValue');
    const heightSlider = document.getElementById('cap2_captionHeightSlider');
    const heightValue = document.getElementById('cap2_captionHeightValue');
    const boldCheck = document.getElementById('cap2_captionBoldCheck');
    const colorPicker = document.getElementById('cap2_captionColorPicker');
    const syncSlider = document.getElementById('cap2_captionSyncSlider');
    const syncValue = document.getElementById('cap2_captionSyncNum');
    
    // Elite Powers DOM
    const emojiCheck = document.getElementById('cap2_captionEmojiCheck');
    const karaokeCheck = document.getElementById('cap2_captionKaraokeCheck');
    const filterSelect = document.getElementById('cap2_captionFilterSelect');

    const brollCheck = document.getElementById('cap2_captionBrollCheck');
    const sfxCheck = document.getElementById('cap2_captionSfxCheck');
    const bgMusicInput = document.getElementById('cap2_bgMusicInput');
    const bgMusicAudio = document.getElementById('cap2_bgMusicAudio');
    const viralShortBtn = document.getElementById('cap2_captionViralShortBtn');

    const progressCheck = document.getElementById('cap2_captionProgressBarCheck');
    const watermarkInput = document.getElementById('cap2_captionWatermarkInput');
    const watermarkCheck = document.getElementById('cap2_captionWatermarkCheck');
    const bgMusicCheck = document.getElementById('cap2_captionBgMusicCheck');
    let sharedWatermarkImage = null;
    let captionFontReady = null;
    const captionEmojiCache = new Map();

    function getCaptionFontFamily(text = '') {
        const selected = fontSelect ? fontSelect.value : 'Nunito, sans-serif';
        if (/[\u0900-\u097f\u0c00-\u0c7f]/u.test(String(text))) return '"Nirmala UI", "Noto Sans Telugu", "Noto Sans Devanagari", sans-serif';
        return selected.startsWith('Nunito') ? '"Pattan Caption Nunito", sans-serif' : selected;
    }

    function getCaptionSourceFontSize(
        width = sourceVideo.videoWidth || renderCanvas.width || CAPTION_PREVIEW_MAX_DIM,
        height = sourceVideo.videoHeight || renderCanvas.height || 1080
    ) {
        const selectedSize = Math.max(12, Math.round(Number(sizeSlider?.value) || QUEUE_EXPORT_FONT_SIZE));
        // Keep the original caption size on the capped preview, then carry that
        // same proportion into the full-resolution video (50 becomes 100 on 4K).
        const sourceScale = Math.max(1, Math.max(width, height) / CAPTION_PREVIEW_MAX_DIM);
        return selectedSize * sourceScale;
    }

    async function ensureCaptionFontReady() {
        if (!String(fontSelect?.value || 'Nunito').startsWith('Nunito')) return;
        if (!captionFontReady) {
            const root = window.location.protocol === 'app:' ? 'app://voice/public/' : '/';
            captionFontReady = Promise.all([['Regular', '400'], ['Black', '900']].map(async ([name, weight]) => {
                const face = new FontFace('Pattan Caption Nunito', `url("${root}caption-fonts/Nunito-${name}.ttf")`, { weight });
                document.fonts.add(await face.load());
            })).catch(error => { captionFontReady = null; throw error; });
        }
        await captionFontReady;
    }

    ensureCaptionFontReady().then(() => {
        if (sourceVideo.src && sourceVideo.paused) renderPreviewNow(sourceVideo.currentTime || 0);
    }).catch(error => console.warn('[Caption] Could not load caption font:', error));

    if (styleSelect) styleSelect.value = 'white-yellow';
    if (progressCheck) progressCheck.checked = false;
    if (sizeSlider) sizeSlider.value = '50';
    if (strokeSlider) strokeSlider.value = '0';

    function sliderPercent(slider) {
        if (!slider) return 0;
        const min = Number(slider.min || 0);
        const max = Number(slider.max || 100);
        const val = Number(slider.value || min);
        if (max <= min) return 0;
        return Math.max(0, Math.min(100, Math.round(((val - min) / (max - min)) * 100)));
    }

    function updateCaptionStyleValueLabels() {
        if (sizeSlider && sizeValue) {
            const selectedSize = Math.round(Number(sizeSlider.value));
            const outputSize = Math.round(getCaptionSourceFontSize());
            sizeValue.textContent = `${sliderPercent(sizeSlider)}% · ${selectedSize}px`
                + (outputSize !== selectedSize ? ` (${outputSize}px in video)` : '');
        }
        if (gapSlider && gapValue) gapValue.textContent = `${sliderPercent(gapSlider)}% · ${Math.round(Number(gapSlider.value))}`;
        if (widthSlider && widthValue) widthValue.textContent = `${Math.round(Number(widthSlider.value))}%`;
        if (strokeSlider && strokeValue) strokeValue.textContent = `${Math.round(Number(strokeSlider.value))}%`;
        if (heightSlider && heightValue) heightValue.textContent = `${Math.round(Number(heightSlider.value))}%`;
        if (syncSlider && syncValue) {
            const seconds = (Number(syncSlider.value || 0) / 1000).toFixed(1);
            syncValue.textContent = `${sliderPercent(syncSlider)}% · ${seconds}s`;
        }
        const sample = document.getElementById('cap2_captionSizePreviewText');
        if (sample) {
            sample.style.fontSize = `${Number(sizeSlider?.value) || 50}px`;
            sample.style.fontFamily = getCaptionFontFamily(sample.textContent);
            sample.style.color = colorPicker?.value || '#ffffff';
        }
    }

    if (watermarkInput) {
        watermarkInput.addEventListener('change', (e) => {
            if(e.target.files[0]) {
                sharedWatermarkImage = new Image();
                sharedWatermarkImage.src = URL.createObjectURL(e.target.files[0]);
            }
        });
    }

    if (bgMusicInput) {
        bgMusicInput.addEventListener('change', (e) => {
            if(e.target.files[0]) {
                bgMusicAudio.src = URL.createObjectURL(e.target.files[0]);
                bgMusicAudio.volume = 0.5;
                bgMusicAudio.play().catch(e => console.log("Audio play deferred", e));
            }
        });
    }

    const sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
    const sfxDest = sfxCtx.createMediaStreamDestination();
    let lastSfxWordIndex = -1;

    function playSfx(type) {
        if (!sfxCheck || !sfxCheck.checked) return;
        const osc = sfxCtx.createOscillator();
        const gain = sfxCtx.createGain();
        osc.connect(gain);
        gain.connect(sfxCtx.destination);
        gain.connect(sfxDest);
        if (type === 'pop') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(800, sfxCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(300, sfxCtx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.5, sfxCtx.currentTime); 
            gain.gain.exponentialRampToValueAtTime(0.01, sfxCtx.currentTime + 0.1);
            osc.start(); osc.stop(sfxCtx.currentTime + 0.1);
        } else if (type === 'whoosh') {
            osc.type = 'triangle'; osc.frequency.setValueAtTime(100, sfxCtx.currentTime);
            gain.gain.setValueAtTime(0.3, sfxCtx.currentTime); 
            gain.gain.linearRampToValueAtTime(0.01, sfxCtx.currentTime + 0.4);
            osc.start(); osc.stop(sfxCtx.currentTime + 0.4);
        }
    }

    const brollUrls = {
        'space': 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1280&q=80',
        'money': 'https://images.unsplash.com/photo-1580519542036-ed474161b51a?w=1280&q=80',
        'nature': 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1280&q=80',
        'tech': 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1280&q=80',
        'car': 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=1280&q=80',
        'animal': 'https://images.unsplash.com/photo-1474511320723-9a56873867b5?w=1280&q=80',
        'city': 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1280&q=80',
        'water': 'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=1280&q=80',
        'school': 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=1280&q=80'
    };
    const loadedBroll = {};
    for (const [k, url] of Object.entries(brollUrls)) {
        const img = new Image(); img.crossOrigin = "anonymous"; img.src = url; loadedBroll[k] = img;
    }
    const brollKeywords = {
        'space': 'space', 'moon': 'space', 'stars': 'space', 'galaxy': 'space', 'earth': 'space',
        'money': 'money', 'cash': 'money', 'dollar': 'money', 'buy': 'money', 'rich': 'money', 'wealth': 'money',
        'nature': 'nature', 'tree': 'nature', 'forest': 'nature', 'sun': 'nature', 'world': 'nature', 'flower': 'nature', 'mountain': 'nature', 'rain': 'water', 'ocean': 'water', 'sea': 'water', 'river': 'water',
        'tech': 'tech', 'computer': 'tech', 'code': 'tech', 'app': 'tech', 'robot': 'tech', 'ai': 'tech', 'phone': 'tech',
        'car': 'car', 'drive': 'car', 'fast': 'car', 'ride': 'car', 'speed': 'car', 'vehicle': 'car',
        'animal': 'animal', 'dog': 'animal', 'cat': 'animal', 'cow': 'animal', 'bird': 'animal', 'fish': 'animal', 'lion': 'animal', 'tiger': 'animal',
        'city': 'city', 'town': 'city', 'building': 'city', 'street': 'city', 'urban': 'city',
        'school': 'school', 'learn': 'school', 'study': 'school', 'student': 'school', 'book': 'school', 'read': 'school', 'write': 'school'
    };
    let lastBrollText = ""; let lastBrollResult = null;
    function getBrollForText(text) {
        if (!brollCheck || !brollCheck.checked || !text) return null;
        if (lastBrollText === text) return lastBrollResult;
        lastBrollText = text; lastBrollResult = null;
        const cleanWords = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ');
        for (let w of cleanWords) { if (brollKeywords[w]) { lastBrollResult = loadedBroll[brollKeywords[w]]; break; } }
        return lastBrollResult;
    }

    const emojiDict = {
        // Finance / Tech / Science
        'money': '💰', 'dollar': '💵', 'cash': '💲', 'buy': '🛍️', 'rich': '🤑', 'sell': '📈', 'business': '🏢',
        'rocket': '🚀', 'space': '🌌', 'sky': '☁️', 'moon': '🌕', 'star': '⭐', 'magic': '✨', 'sparkle': '✨', 'planet': '🪐',
        'computer': '💻', 'tech': '🤖', 'robot': '🤖', 'app': '📱', 'phone': '📱', 'internet': '🌐', 'code': '💻', 'ai': '🧠',

        // Emotions / Reactions
        'happy': '😊', 'smile': '😃', 'love': '❤️', 'heart': '💖', 'good': '👍', 'like': '👍', 'awesome': '😎', 'cool': '😎',
        'sad': '😢', 'cry': '😭', 'tear': '💧', 'bad': '👎', 'angry': '😠', 'mad': '😡', 'scared': '😱', 'shock': '😲',
        'laugh': '😂', 'funny': '🤣', 'lol': '😆', 'joke': '🤡', 'silly': '🤪', 'fun': '🥳',
        'fire': '🔥', 'hot': '🥵', 'burn': '🔥', 'lit': '🔥', 'boom': '💥', 'explosion': '💣', 'crash': '💥',

        // Time / Thinking
        'time': '⏳', 'clock': '🕰️', 'wait': '⌛', 'fast': '⚡', 'slow': '🐢', 'today': '📅', 'tomorrow': '📆', 'now': '⏱️',
        'idea': '💡', 'brain': '🧠', 'mind': '🧠', 'think': '🤔', 'question': '❓', 'why': '🤷', 'how': '🤷', 'know': '🧠', 'smart': '🤓',
        'yes': '✅', 'no': '❌', 'stop': '🛑', 'go': '🚦', 'danger': '⚠️', 'warning': '⚠️',

        // Nursery Rhymes / Stories / Animals
        'dog': '🐶', 'cat': '🐱', 'cow': '🐮', 'sheep': '🐑', 'pig': '🐷', 'horse': '🐴', 'bird': '🐦', 'fish': '🐟', 'animal': '🐾', 'mouse': '🐭', 'lion': '🦁', 'tiger': '🐯', 'bear': '🐻', 'monkey': '🐵', 'duck': '🦆', 'frog': '🐸', 'bug': '🐛', 'spider': '🕷️',
        'baby': '👶', 'boy': '👦', 'girl': '👧', 'man': '👨', 'woman': '👩', 'king': '👑', 'queen': '👑', 'princess': '👸', 'knight': '🤺', 'dragon': '🐉', 'monster': '👹', 'ghost': '👻',
        'house': '🏠', 'home': '🏡', 'castle': '🏰', 'village': '🏘️', 'bed': '🛌', 'sleep': '😴', 'dream': '💭',
        
        // Nature / Elements
        'sun': '☀️', 'day': '🌞', 'light': '☀️', 'morning': '🌅', 'night': '🌙', 'evening': '🌇',
        'tree': '🌳', 'forest': '🌲', 'flower': '🌸', 'rose': '🌹', 'leaf': '🍃', 'plant': '🌿', 'nature': '🏞️',
        'water': '💧', 'rain': '🌧️', 'snow': '❄️', 'cold': '🥶', 'ocean': '🌊', 'sea': '🌊', 'wind': '💨', 'storm': '⛈️',

        // General Speaking / Vlog / Education
        'video': '📹', 'channel': '📺', 'subscribe': '🔔', 'welcome': '👋', 'hello': '👋', 'hi': '👋', 'bye': '👋', 'friends': '👥', 'people': '👥',
        'learn': '📚', 'study': '📖', 'book': '📕', 'school': '🏫', 'teacher': '👩‍🏫', 'student': '🎒', 'math': '➕', 'science': '🔬', 'history': '📜', 'art': '🎨',
        'music': '🎵', 'song': '🎵', 'dance': '💃', 'play': '▶️', 'game': '🎮', 'sport': '⚽', 'ball': '🏀', 'run': '🏃', 'walk': '🚶',

        // Objects / Food
        'world': '🌍', 'earth': '🌍', 'global': '🌐', 'map': '🗺️', 'car': '🚗', 'bus': '🚌', 'train': '🚂', 'boat': '⛵', 'plane': '✈️',
        'food': '🍔', 'eat': '🍽️', 'hungry': '🤤', 'apple': '🍎', 'banana': '🍌', 'pizza': '🍕', 'cake': '🎂', 'cookie': '🍪', 'water': '💧', 'drink': '🥤', 'coffee': '☕',
        'gift': '🎁', 'box': '📦', 'tool': '🧰', 'hammer': '🔨', 'sword': '⚔️', 'shield': '🛡️'
    };

    let lastEmojiText = ""; let lastEmojiResult = null;
    function getEmojiForText(text) {
        if (!text) return null;
        if (lastEmojiText === text) return lastEmojiResult;
        lastEmojiText = text; lastEmojiResult = null;
        const cleanWords = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ');
        for (let w of cleanWords) {
            if (emojiDict[w]) { lastEmojiResult = emojiDict[w]; break; }
        }
        return lastEmojiResult;
    }

    let captionPosX = 0.5;
    let captionPosY = 0.90;
    const positionXControl = document.getElementById('cap2_captionPositionX');
    const positionYControl = document.getElementById('cap2_captionPositionY');
    const positionPresetControl = document.getElementById('cap2_captionPositionPreset');
    const refreshCaptionPosition = () => {
        if (positionXControl) positionXControl.value = String(Math.round(captionPosX * 100));
        if (positionYControl) positionYControl.value = String(Math.round(captionPosY * 100));
        const xLabel = document.getElementById('cap2_captionPositionXValue');
        const yLabel = document.getElementById('cap2_captionPositionYValue');
        if (xLabel) xLabel.textContent = `${Math.round(captionPosX * 100)}%`;
        if (yLabel) yLabel.textContent = `${Math.round(captionPosY * 100)}%`;
        if (sourceVideo.src && sourceVideo.paused) renderPreviewNow(sourceVideo.currentTime || 0);
    };
    positionXControl?.addEventListener('input', () => {
        captionPosX = Number(positionXControl.value) / 100;
        if (positionPresetControl) positionPresetControl.value = 'custom';
        refreshCaptionPosition();
    });
    positionYControl?.addEventListener('input', () => {
        captionPosY = Number(positionYControl.value) / 100;
        if (positionPresetControl) positionPresetControl.value = 'custom';
        refreshCaptionPosition();
    });
    positionPresetControl?.addEventListener('change', () => {
        if (positionPresetControl.value !== 'custom') {
            captionPosX = 0.5;
            captionPosY = positionPresetControl.value === 'top' ? 0.15 : positionPresetControl.value === 'bottom' ? 0.90 : 0.5;
        }
        refreshCaptionPosition();
    });
    let isDraggingCaption = false;

    renderCanvas.addEventListener('pointerdown', () => { if (!captionLocalBusy()) isDraggingCaption = true; });
    renderCanvas.addEventListener('pointermove', (e) => {
        if (!isDraggingCaption || captionLocalBusy()) return;
        const rect = renderCanvas.getBoundingClientRect();
        captionPosX = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
        captionPosY = Math.max(0.05, Math.min(0.95, (e.clientY - rect.top) / rect.height));
        if (positionPresetControl) positionPresetControl.value = 'custom';
        refreshCaptionPosition();
        // refreshCaptionPosition redraws paused frames using the same renderer as export.
    });
    renderCanvas.addEventListener('pointerup', () => isDraggingCaption = false);
    renderCanvas.addEventListener('pointerleave', () => isDraggingCaption = false);

    let videoUrl = null;
    let activeFile = null;
    let audioDataArray = null;
    let generatedCaptions = [];
    let isExtractingText = false;
    let activeCaptionTranscription = null;
    let captionTranscriptionCancelRequested = false;
    let isRecording = false;
    let isErasingCaptions = false;
    let transcriber = null;
    let hasDrawnFirstFrame = false;

    function stripIgnoredIntroCaption(value, startSeconds) {
        // Do not drop a genuinely transcribed introduction or brand name.
        return String(value ?? '');
    }

    function removeIgnoredIntroCaptions(captions) {
        return (captions || []).map(caption => {
            const timestamp = Array.isArray(caption.timestamp) ? caption.timestamp : [caption.start, caption.end];
            const start = Math.max(0, Number(timestamp[0]) || 0);
            const text = stripIgnoredIntroCaption(caption.text, start);
            return text ? { ...caption, text } : null;
        }).filter(Boolean);
    }
    let previewFrameHandle = null;
    let previewFrameMode = null;
    let autoBurnRequested = false;
    let captionVideoQueue = [];
    let captionQueueIndex = 0;
    let captionQueueRunning = false;
    let captionQueueExporting = false;
    let captionQueueMode = '';
    let captionTranslationBusy = false;
    let captionTranslationController = null;
    let captionPreviewSpeed = 1;
    let captionPreviewLoop = null;
    const captionBusyControlStates = new Map();
    let captionGroqRetryTimer = null;
    async function invokeCaptioner2TranscribeVideo(options) {
        if (!window.electronAPI || typeof window.electronAPI.transcribeVideo !== 'function') {
            return { ok: false, error: 'Electron transcription API is unavailable.' };
        }
        const payload = { ...options, captionerVersion: 2 };
        let result = await window.electronAPI.transcribeVideo(payload);
        for (let retry = 0; retry < 10 && !captionTranscriptionCancelRequested && (result?.code === 'CAPTION_TRANSCRIPTION_BUSY' || /another caption transcription is running/i.test(result?.error || '')); retry += 1) {
            if (typeof window.electronAPI.cancelTranscribeVideo === 'function') {
                try { await window.electronAPI.cancelTranscribeVideo({ captionerVersion: 2, waitForRelease: true }); } catch (_) {}
            }
            await new Promise(resolve => setTimeout(resolve, 800));
            if (captionTranscriptionCancelRequested) return { ok: false, cancelled: true, error: 'Transcription cancelled.' };
            result = await window.electronAPI.transcribeVideo(payload);
        }
        return result;
    }

    const captionTranscriptionCoordinator = createCaptionTranscriptionCoordinator({
        transcribe: options => invokeCaptioner2TranscribeVideo(options),
        isCancelled: () => captionTranscriptionCancelRequested,
        onRequest: options => { activeCaptionTranscription = options; },
        validate: result => validateCaptionTranscriptionCues(result,
            sourceVideo.readyState >= 1 ? sourceVideo.duration : undefined, buildCaptionChunksFromTranscription),
        onPause: error => {
            if (captionGroqRetryTimer) clearTimeout(captionGroqRetryTimer);
            captionGroqRetryTimer = setTimeout(() => {
                captionGroqRetryTimer = null;
                renderCaptionQueue();
                publishCaptionLocalState();
            }, Math.min(2147483647, Math.max(1, error.retryAt - Date.now() + 25)));
        },
    });

    function captionGroqWaiting() {
        const options = getCaptionTranscriptionOptions();
        return options.engine === 'groq' && !options.allowLocalRecovery ? captionTranscriptionCoordinator.getCooldown() : null;
    }

    function captionLocalBusy() {
        return isExtractingText || isRecording || isErasingCaptions || captionQueueRunning || captionQueueExporting || captionTranslationBusy;
    }

    function ensureCaptionLocalItemId(item) {
        if (item && !item.id) item.id = 'caption-local-' + (window.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
        return item?.id || '';
    }

    function clearCaptionPreviewLoop() {
        captionPreviewLoop = null;
    }

    function clampCaptionPreviewTime(time) {
        const duration = Number(sourceVideo.duration);
        return Math.max(0, Math.min(Number.isFinite(duration) && duration > 0 ? duration : Number.MAX_SAFE_INTEGER, time));
    }

    function syncCaptionWorkbenchBusy() {
        const disabled = captionLocalBusy();
        if (disabled) clearCaptionPreviewLoop();
        const controls = [...Array.from(editorPanel?.querySelectorAll('button, input, select, textarea') || []),
            resetBtn, previewBtn, seekSlider, playPauseBtn, document.getElementById('cap2_captionAutoRecover'), document.getElementById('cap2_captionGroqLocalRecovery'), spellingCorrections,
            ...[styleSelect, sizeSlider, gapSlider, widthSlider, heightSlider, fontSelect, boldCheck, strokeSlider,
                colorPicker, syncSlider, positionXControl, positionYControl, positionPresetControl,
                emojiCheck, karaokeCheck, filterSelect, progressCheck, watermarkCheck,
                watermarkInput, bgMusicCheck, bgMusicInput, translateCheck, brollCheck, sfxCheck],
            ...['cap2_captionContentMode', 'cap2_captionEngine', 'cap2_captionLanguage', 'cap2_captionTranslateSelectedBtn', 'cap2_captionEraserQuality', 'cap2_captionGroqApiKey', 'cap2_captionRegenerateBtn', 'cap2_captionVocalFocus', 'cap2_captionVocabularyHints', 'cap2_captionUseVoiceTextBtn', 'cap2_aiCapSttBtn',
                'cap2_captionTranslateEnBtn', 'cap2_captionTranslateHiBtn', 'cap2_captionTranslateTeBtn', 'cap2_captionSizePreviewBtn'].map(id => document.getElementById(id))].filter(Boolean);
        if (disabled) {
            controls.forEach(control => {
                if (!captionBusyControlStates.has(control)) captionBusyControlStates.set(control, control.disabled);
                control.disabled = true;
            });
        } else {
            captionBusyControlStates.forEach((previous, control) => { control.disabled = previous; });
            captionBusyControlStates.clear();
            sourceVideo.playbackRate = captionPreviewSpeed;
        }
    }

    function captionMetadataFromTranscription(result) {
        const item = captionVideoQueue[captionQueueIndex];
        if (!item) return;
        item.timingSource = result?.timingSource === 'estimated' || !result?.words?.length ? 'estimated' : 'word';
        item.warnings = Array.isArray(result?.warnings) ? result.warnings.map(String) : [];
        item.engine = result?.engine || activeCaptionTranscription?.engine || getCaptionTranscriptionOptions().engine;
        item.recoveredFromEngine = result?.recoveredFromEngine;
        item.sourceLanguage = normalizeCaptionLanguageCode(result?.language) || inferCaptionLanguageCode(result?.text);
    }

    function commitCaptionLocalEdits(metadata, redraw = true, preserveLanguage = false) {
        clearCaptionPreviewLoop();
        const item = captionVideoQueue[captionQueueIndex];
        if (item) captionVideoQueue[captionQueueIndex] = captionLocalEditedQueueItem(item, generatedCaptions, metadata || {
            timingSource: item.timingSource, warnings: item.warnings || [],
        }, preserveLanguage);
        setCaptionExportActionsVisible(false);
        if (exportActions) exportActions.replaceChildren();
        if (exportBtn) exportBtn.classList.toggle('hidden', !generatedCaptions.length);
        if (previewBtn) previewBtn.classList.toggle('hidden', !generatedCaptions.length);
        if (redraw && sourceVideo.src) renderPreviewNow(sourceVideo.currentTime || 0);
        renderCaptionQueue();
    }

    const localWorkbenchBridge = createCaptionLocalWorkbenchBridge({
        readState: () => {
            const item = captionVideoQueue[captionQueueIndex];
            return { itemId: ensureCaptionLocalItemId(item), videoName: item?.file?.name || activeFile?.name || '',
                captions: generatedCaptions, duration: sourceVideo.readyState >= 1 && Number.isFinite(sourceVideo.duration) ? sourceVideo.duration : undefined,
                disabled: captionLocalBusy(), timingSource: item?.timingSource, warnings: item?.warnings || [],
                engine: item?.engine, recoveredFromEngine: item?.recoveredFromEngine,
                sourceLanguage: item?.sourceLanguage, outputLanguage: item?.outputLanguage,
                hasVideo: !!activeFile && !!sourceVideo.src, previewSpeed: captionPreviewSpeed, looping: !!captionPreviewLoop };
        },
        apply: (captions, metadata) => {
            generatedCaptions = captions;
            commitCaptionLocalEdits(metadata);
            populateEditor();
        },
        seek: time => {
            clearCaptionPreviewLoop();
            sourceVideo.pause();
            sourceVideo.currentTime = clampCaptionPreviewTime(time + getCaptionSyncOffsetSeconds());
            renderPreviewNow(sourceVideo.currentTime);
            updatePlayPauseLabel();
            publishCaptionLocalState();
        },
        setPreviewSpeed: speed => { captionPreviewSpeed = speed; sourceVideo.playbackRate = speed; },
        toggleCaptionLoop: () => {
            if (captionPreviewLoop) { clearCaptionPreviewLoop(); return true; }
            const offset = getCaptionSyncOffsetSeconds();
            const captionTime = sourceVideo.currentTime - offset;
            const cue = generatedCaptions.find(c => captionTime >= c.timestamp[0] && captionTime < c.timestamp[1])
                || generatedCaptions.find(c => c.timestamp[0] >= captionTime) || generatedCaptions[0];
            if (!cue) return false;
            const start = clampCaptionPreviewTime(Number(cue.timestamp[0]) + offset);
            const end = clampCaptionPreviewTime(Number(cue.timestamp[1]) + offset);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
            captionPreviewLoop = { itemId: ensureCaptionLocalItemId(captionVideoQueue[captionQueueIndex]), start, end };
            sourceVideo.currentTime = start;
            sourceVideo.play().catch(() => {});
            return true;
        },
        notice: message => { if (statusText) statusText.textContent = message; },
        publish: state => window.dispatchEvent(new CustomEvent('captioner2-local-state', { detail: state })),
    });
    window.captioner2WorkbenchAPI = localWorkbenchBridge;

    function publishCaptionLocalState() {
        syncCaptionWorkbenchBusy();
        const intelligenceStatus = document.getElementById('cap2_captionIntelligenceStatus');
        if (intelligenceStatus) {
            const item = captionVideoQueue[captionQueueIndex];
            const quality = inspectCaptionQuality(generatedCaptions, Number(sourceVideo.duration), item?.timingSource);
            intelligenceStatus.textContent = captionLocalBusy() ? 'Automatic review will run when the active job finishes.'
                : !generatedCaptions.length ? 'Automatic language detection and caption review are ready. Generate captions to inspect this video.'
                : `${quality.wordCount} words · Detected language: ${item?.sourceLanguage || 'auto'}. `
                    + (quality.issues.length ? quality.issues.join(' · ') : 'No cue overlaps or long internal gaps detected. Review against the audio.');
        }
        if (eraseBtn) {
            eraseBtn.classList.remove('hidden');
            eraseBtn.disabled = captionLocalBusy() || !activeFile;
        }
        const regenerateBtn = document.getElementById('cap2_captionRegenerateBtn');
        if (regenerateBtn) {
            regenerateBtn.disabled = captionLocalBusy() || !activeFile;
            regenerateBtn.classList.toggle('hidden', !generatedCaptions.length);
        }
        if (actionBtn && !captionLocalBusy()) {
            actionBtn.classList.toggle('hidden', generatedCaptions.length > 0 && captionVideoQueue.length <= 1);
            actionBtn.disabled = !activeFile || (captionVideoQueue.length > 0 && captionVideoQueue.every(item => item.status === 'exported')) || !!captionGroqWaiting();
            actionBtn.title = captionGroqWaiting() ? captionGroqRetryMessage(captionGroqWaiting()) : '';
        }
        const translateSelected = document.getElementById('cap2_captionTranslateSelectedBtn');
        if (translateSelected) translateSelected.disabled = captionLocalBusy() || !generatedCaptions.length;
        return localWorkbenchBridge.publish();
    }

    function restartCaptionPreviewLoop() {
        if (!captionPreviewLoop || captionLocalBusy() || captionPreviewLoop.itemId !== ensureCaptionLocalItemId(captionVideoQueue[captionQueueIndex])) return false;
        sourceVideo.currentTime = captionPreviewLoop.start;
        sourceVideo.play().catch(() => {});
        renderPreviewNow(sourceVideo.currentTime);
        return true;
    }

    const modeSelect = document.getElementById('cap2_captionContentMode');
    const engineSelect = document.getElementById('cap2_captionEngine');
    const groqKeyInput = document.getElementById('cap2_captionGroqApiKey');
    if (groqKeyInput) {
        try {
            const savedKey = (window.localStorage && window.localStorage.getItem('cb_groq_key')) || (window.electronAPI && typeof window.electronAPI.getGroqApiKey === 'function' ? window.electronAPI.getGroqApiKey() : '') || '';
            if (savedKey && !groqKeyInput.value) groqKeyInput.value = savedKey;
            groqKeyInput.addEventListener('change', () => {
                const trimmed = groqKeyInput.value.trim();
                if (trimmed && window.localStorage) window.localStorage.setItem('cb_groq_key', trimmed);
            });
        } catch (_) {}
    }
    if (modeSelect) {
        let disclosure = document.getElementById('cap2_captionLocalModeDisclosure');
        if (!disclosure) {
            disclosure = document.createElement('p'); disclosure.id = 'cap2_captionLocalModeDisclosure';
            disclosure.style.cssText = 'font-size:11px;color:#94a3b8;margin:6px 0';
            modeSelect.parentElement?.appendChild(disclosure);
        }
        const disclose = () => {
            const options = getCaptionTranscriptionOptions();
            document.getElementById('cap2_captionGroqKeyField')?.classList.toggle('hidden', options.engine !== 'groq');
            document.getElementById('cap2_captionGroqRecoveryField')?.classList.toggle('hidden', options.engine !== 'groq');
            disclosure.textContent = options.engine === 'gemini'
                ? 'Gemini sends this audio to Google. Lyric and word timing is estimated; review synchronization.'
                : options.engine === 'groq'
                    ? 'Groq sends this audio to the Groq speech service for fast Whisper captions with word timestamps. Review the words and timing before export.'
                    : options.contentMode === 'song' ? 'Local song captions process audio on this computer. Review the lyrics and timing before export.'
                    : engineSelect ? 'Local processes audio on this computer. Review the words and timing before export.'
                    : 'Speech uses local Whisper and may use the configured high-accuracy cloud fallback. Review the words and timing before export.';
        };
        modeSelect.addEventListener('change', () => {
            if (modeSelect.value === 'speech' && engineSelect?.value === 'gemini') engineSelect.value = 'local';
            disclose();
        });
        engineSelect?.addEventListener('change', () => {
            if (engineSelect.value === 'gemini') modeSelect.value = 'song';
            disclose();
            renderCaptionQueue();
            publishCaptionLocalState();
        });
        document.getElementById('cap2_captionGroqLocalRecovery')?.addEventListener('change', () => {
            renderCaptionQueue();
            publishCaptionLocalState();
        });
        disclose();
    }
    document.getElementById('cap2_captionRegenerateBtn')?.addEventListener('click', async () => {
        if (captionLocalBusy() || !activeFile) return;
        await transcribeActiveCaptionVideo();
    });
    publishCaptionLocalState();
    if (window.electronAPI && typeof window.electronAPI.onTranscribeProgress === 'function') {
        window.electronAPI.onTranscribeProgress((rawPct) => {
            if (captionTranslationBusy) return;
            const pct = Math.max(0, Math.min(100, Number(rawPct) || 0));
            const activeIndex = captionVideoQueue.findIndex(item => item.status === 'transcribing');
            if (activeIndex < 0) return;
            const mappedPct = Math.max(5, Math.round(5 + pct * 0.9));
            setQueueItemState(activeIndex, {
                progress: mappedPct,
                message: pct >= 100
                    ? 'Transcription complete. Building captions...'
                    : `${getCaptionEngineLabel(activeCaptionTranscription || getCaptionTranscriptionOptions())} transcription ${pct}%`,
            });
            setCaptionProgressBar(mappedPct);
        });
    }

    if (!document.getElementById('cap2_captionQueueSpinStyle')) {
        const spinStyle = document.createElement('style');
        spinStyle.id = 'cap2_captionQueueSpinStyle';
        spinStyle.textContent = '@keyframes captionQueueSpin{to{transform:rotate(360deg)}}';
        document.head.appendChild(spinStyle);
    }

    function formatTime(seconds) {
        if(isNaN(seconds)) return "00:00";
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    function speakCaptionStudio(message) {
        try {
            if (!('speechSynthesis' in window)) return;
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(String(message || ''));
            utterance.rate = 0.95;
            utterance.pitch = 1;
            utterance.volume = 1;
            window.speechSynthesis.speak(utterance);
        } catch (error) {
            console.warn('[Caption Studio] Spoken alert failed:', error);
        }
    }

    function notifyCaptionStudio(title, body) {
        const existing = document.getElementById('cap2_captionStudioAlertToast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'cap2_captionStudioAlertToast';
        toast.setAttribute('role', 'alert');
        toast.style.cssText = 'position:fixed;right:28px;bottom:28px;z-index:2147483647;max-width:420px;padding:16px 18px;border-radius:14px;border:1px solid rgba(125,211,252,.55);background:#101827;color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.55);font:700 14px/1.45 system-ui,sans-serif;white-space:pre-wrap';
        toast.textContent = `${title}\n${body}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 12000);
        try {
            if (window.electronAPI && typeof window.electronAPI.showNotification === 'function') {
                Promise.resolve(window.electronAPI.showNotification(title, body)).catch((error) => {
                    console.warn('[Caption Studio] System notification failed:', error);
                });
            }
        } catch (error) {
            console.warn('[Caption Studio] Notification failed:', error);
        }
    }

    function setCaptionExportActionsVisible(visible) {
        if (!exportActions) return;
        exportActions.classList.toggle('hidden', !visible);
        exportActions.style.display = visible ? 'flex' : 'none';
    }

    function captionFilePathToUrl(filePath) {
        const normalized = String(filePath || '').trim().replace(/\\/g, '/');
        if (!normalized) return '';
        const encoded = normalized.replace(/^\/+/, '').split('/').map((segment, index) =>
            index === 0 && /^[a-z]:$/i.test(segment) ? segment : encodeURIComponent(segment)
        ).join('/');
        return (normalized.startsWith('//') ? 'file://' : 'file:///') + encoded;
    }

    function renderCaptionExportActions(result, options = {}) {
        if (!exportActions || !result || !result.outputPath) return;
        const fileName = result.fileName || result.outputFileName || 'captioned video';
        const index = Number.isInteger(options.queueIndex) ? options.queueIndex : captionQueueIndex;
        exportActions.innerHTML = '';
        setCaptionExportActionsVisible(true);
        exportActions.style.flexWrap = 'wrap';

        const makeButton = (label, handler, tone = 'default') => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            const palette = tone === 'primary'
                ? 'background:linear-gradient(135deg,#22c55e,#06b6d4);border-color:rgba(34,197,94,.55);color:#fff'
                : tone === 'warning'
                    ? 'background:rgba(250,204,21,.13);border-color:rgba(250,204,21,.45);color:#fde68a'
                    : 'background:rgba(15,23,42,.72);border-color:rgba(148,163,184,.35);color:#dbeafe';
            button.style.cssText = `padding:8px 12px;border-radius:7px;border:1px solid;font-weight:900;cursor:pointer;${palette}`;
            button.addEventListener('click', handler);
            return button;
        };

        exportActions.appendChild(makeButton('Play video', () => {
            if (window.electronAPI && typeof window.electronAPI.openFile === 'function') {
                window.electronAPI.openFile(result.outputPath);
            }
        }, 'primary'));
        exportActions.appendChild(makeButton('Open folder', () => {
            if (window.electronAPI && typeof window.electronAPI.showItemInFolder === 'function') {
                window.electronAPI.showItemInFolder(result.outputPath);
            }
        }));
        exportActions.appendChild(makeButton('Re-export', () => {
            if (captionVideoQueue.length && captionVideoQueue[index] && captionVideoQueue[index].captions && captionVideoQueue[index].captions.length) {
                exportQueuedCaptionVideo(index);
                return;
            }
            if (exportBtn) exportBtn.click();
        }, 'warning'));

        const label = document.createElement('span');
        label.textContent = `Saved: ${fileName}`;
        label.style.cssText = 'align-self:center;color:#a7f3d0;font-weight:800;font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        exportActions.appendChild(label);

        const previewWrap = document.createElement('div');
        previewWrap.style.cssText = 'flex:1 0 100%;margin-top:10px;border:1px solid rgba(148,163,184,.24);border-radius:8px;background:#020617;padding:10px;min-width:0';

        const previewLabel = document.createElement('div');
        previewLabel.textContent = `Preview: ${fileName}`;
        previewLabel.style.cssText = 'margin-bottom:8px;color:#dbeafe;font-weight:900;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        previewWrap.appendChild(previewLabel);

        const previewVideo = document.createElement('video');
        previewVideo.controls = true;
        previewVideo.playsInline = true;
        previewVideo.preload = 'metadata';
        previewVideo.src = captionFilePathToUrl(result.outputPath);
        previewVideo.style.cssText = 'display:block;width:100%;max-height:360px;background:#000;border-radius:7px';
        previewWrap.appendChild(previewVideo);
        exportActions.appendChild(previewWrap);
    }

    function updatePlayPauseLabel() {
        playPauseBtn.textContent = sourceVideo.paused ? '▶️ Play' : '⏸️ Pause';
    }

    function clearPreviewFrameHandle() {
        if (previewFrameHandle === null) return;
        if (previewFrameMode === 'raf') {
            cancelAnimationFrame(previewFrameHandle);
        } else if (previewFrameMode === 'rvfc' && typeof sourceVideo.cancelVideoFrameCallback === 'function') {
            sourceVideo.cancelVideoFrameCallback(previewFrameHandle);
        }
        previewFrameHandle = null;
        previewFrameMode = null;
    }

    function renderPreviewNow(timeOverride = sourceVideo.currentTime) {
        const ctx = renderCanvas.getContext('2d');
        renderCaptionFrame(ctx, renderCanvas.width, renderCanvas.height, timeOverride, { isPreviewSurface: true });
    }

    function schedulePreviewFrame() {
        if (previewFrameHandle !== null || sourceVideo.paused || sourceVideo.ended) return;
        if (typeof sourceVideo.requestVideoFrameCallback === 'function') {
            previewFrameMode = 'rvfc';
            previewFrameHandle = sourceVideo.requestVideoFrameCallback(() => {
                previewFrameHandle = null;
                previewFrameMode = null;
                renderPreviewNow(sourceVideo.currentTime);
                schedulePreviewFrame();
            });
        } else {
            previewFrameMode = 'raf';
            previewFrameHandle = requestAnimationFrame(() => {
                previewFrameHandle = null;
                previewFrameMode = null;
                renderPreviewNow(sourceVideo.currentTime);
                schedulePreviewFrame();
            });
        }
    }

    sourceVideo.addEventListener('timeupdate', () => {
        if (captionPreviewLoop && sourceVideo.currentTime >= captionPreviewLoop.end - 0.015) restartCaptionPreviewLoop();
        if (!seekSlider.isDragging) seekSlider.value = sourceVideo.currentTime;
        seekSlider.max = sourceVideo.duration || 100;
        timeDisplay.textContent = `${formatTime(sourceVideo.currentTime)} / ${formatTime(sourceVideo.duration)}`;
        
        if (isRecording && sourceVideo.duration) {
            let pct = Math.floor((sourceVideo.currentTime / sourceVideo.duration) * 100);
            const remainingPct = Math.max(0, 100 - pct);
            const remainingSec = Math.max(0, sourceVideo.duration - sourceVideo.currentTime);
            statusText.innerHTML = `Rendering high-quality video... ${pct}% complete - ${remainingPct}% remaining - ${remainingSec.toFixed(1)}s left`;
        }
    });

    seekSlider.addEventListener('mousedown', () => seekSlider.isDragging = true);
    seekSlider.addEventListener('mouseup', () => seekSlider.isDragging = false);
    seekSlider.addEventListener('input', () => {
        sourceVideo.currentTime = seekSlider.value;
        if (sourceVideo.paused) renderPreviewNow(sourceVideo.currentTime);
    });

    playPauseBtn.addEventListener('click', async () => {
        if (sourceVideo.paused) {
            try {
                await sourceVideo.play();
            } catch (error) {
                statusText.textContent = 'Preview failed: ' + (error.message || error);
                updatePlayPauseLabel();
            }
        } else {
            sourceVideo.pause();
        }
    });

    [
        styleSelect, sizeSlider, gapSlider, widthSlider, heightSlider, fontSelect, boldCheck,
        strokeSlider, colorPicker, syncSlider, emojiCheck, karaokeCheck,
        filterSelect, progressCheck, watermarkCheck
    ].filter(Boolean).forEach(control => {
        const refreshPreview = () => {
            updateCaptionStyleValueLabels();
            if (sourceVideo.src && sourceVideo.paused) renderPreviewNow(sourceVideo.currentTime || 0);
        };
        control.addEventListener('input', refreshPreview);
        control.addEventListener('change', refreshPreview);
    });
    updateCaptionStyleValueLabels();
    document.getElementById('cap2_captionSizePreviewBtn')?.addEventListener('click', async () => {
        if (isRecording || captionQueueRunning || captionQueueExporting || !generatedCaptions.length) return;
        const offset = getCaptionSyncOffsetSeconds();
        const cap = generatedCaptions.find(c => sourceVideo.currentTime - offset >= c.timestamp[0] && sourceVideo.currentTime - offset < c.timestamp[1]) || generatedCaptions[0];
        sourceVideo.pause();
        await seekCaptionPreviewTo(Math.max(0, Number(cap.timestamp[0]) + offset + 0.01));
        renderPreviewNow(sourceVideo.currentTime);
        renderCanvas.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    
    resetBtn.addEventListener('click', () => {
        if (captionLocalBusy()) return;
        if (window.electronAPI && typeof window.electronAPI.cancelTranscribeVideo === 'function') {
            window.electronAPI.cancelTranscribeVideo({ captionerVersion: 2, waitForRelease: true }).catch(() => {});
        }
        clearCaptionPreviewLoop();
        sourceVideo.pause();
        sourceVideo.removeAttribute('src');
        sourceVideo.load();
        if (videoUrl) {
            URL.revokeObjectURL(videoUrl);
            videoUrl = null;
        }
        activeFile = null;
        generatedCaptions = [];
        audioDataArray = null;
        hasDrawnFirstFrame = false;
        autoBurnRequested = false;
        captionVideoQueue = [];
        captionQueueIndex = 0;
        captionQueueRunning = false;
        captionQueueExporting = false;
        renderCaptionQueue();
        videoContainer.classList.add('hidden');
        actionBtn.disabled = true; actionBtn.classList.remove('hidden');
        exportBtn.classList.add('hidden'); editorPanel.classList.add('hidden');
        if (eraseBtn) eraseBtn.disabled = true;
        if (previewBtn) previewBtn.classList.add('hidden');
        setCaptionExportActionsVisible(false);
        hideSingleCaptionProgress();
        resetBtn.classList.add('hidden'); progressBlock.classList.add('hidden');
        videoInput.value = '';
        delete videoInput.dataset.pattanUploaded;
        delete videoInput.dataset.pattanUploading;
        statusText.innerHTML = 'Select a video to generate captions.';
        publishCaptionLocalState();
    });

    if (eraseBtn) {
        eraseBtn.addEventListener('click', async () => {
            if (captionLocalBusy()) return;
            const videoPath = getCaptionSourcePath();
            if (!videoPath) {
                alert('No video file path available. Please re-upload or select a local video.');
                return;
            }
            
            const api = window.electronAPI;
            if (typeof api?.eraseCaptions !== 'function') {
                statusText.textContent = 'Caption erasing requires the local desktop app.';
                return;
            }
            const queueIndex = captionQueueIndex;
            const originalItem = captionVideoQueue[queueIndex];
            const jobId = 'caption-erase-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
            const controls = [videoInput, actionBtn, resetBtn, previewBtn, exportBtn, eraseBtn, queueRunBtn, queueExportAllBtn, queuePrevBtn, queueNextBtn, viralShortBtn,
                ...Array.from(editorPanel?.querySelectorAll('button, input, select, textarea') || []),
                ...['cap2_captionUseVoiceTextBtn', 'cap2_captionTranslateEnBtn', 'cap2_captionTranslateHiBtn', 'cap2_captionTranslateTeBtn', 'cap2_captionSizePreviewBtn'].map(id => document.getElementById(id))].filter(Boolean);
            const disabledStates = new Map(controls.map(control => [control, control.disabled]));
            let unsubscribe = null;
            let changed = false;
            isErasingCaptions = true;
            publishCaptionLocalState();
            controls.forEach(control => { control.disabled = true; });
            sourceVideo.pause();
            const onProgress = data => {
                if (!isErasingCaptions || (data?.jobId && data.jobId !== jobId) || (data?.filePath && data.filePath !== videoPath)) return;
                const pct = Math.max(0, Math.min(99, Number(data?.pct ?? data?.progress) || 0));
                const phase = data?.phase === 'erasing' || data?.phase === 'rendering' ? 'Erasing detected captions' : 'Detecting previous captions';
                const message = String(data?.message || data?.detail || phase);
                setCaptionProgressBar(pct);
                renderSingleCaptionProgress(pct, phase, message);
                if (originalItem) setQueueItemState(queueIndex, { status: 'erasing', progress: pct, message });
                statusText.textContent = message;
                window.updateTaskProgressUi?.(pct / 100, true, { label: phase });
            };
            try {
                eraseBtn.textContent = '🧹 Detecting captions...';
                if (typeof api.onCaptionEraseProgress === 'function') unsubscribe = api.onCaptionEraseProgress(onProgress);
                onProgress({ pct: 0, message: 'Detecting previous captions throughout the video...' });
                const quality = document.getElementById('cap2_captionEraserQuality')?.value === 'quick' ? 'quick' : 'ai';
                const res = await api.eraseCaptions({ filePath: videoPath, jobId, quality });
                if (!res?.ok) throw new Error(res?.error || 'Caption erasing failed');
                if (res.noCaptionsDetected || res.changed === false) {
                    if (originalItem) captionVideoQueue[queueIndex] = originalItem;
                    setCaptionProgressBar(0);
                    statusText.textContent = 'No previous captions detected. Your source video and edited captions are unchanged.';
                    return;
                }
                if (res.changed !== true || !res.outputPath) throw new Error('The eraser did not return a completed clean video.');
                const fileName = res.fileName || res.outputFileName || String(res.outputPath).split(/[\\/]/).pop() || 'clean-video.mp4';
                const cleanFile = { name: fileName, type: 'video/mp4', path: res.outputPath,
                    previewUrl: api.isMobileRemote ? res.mobileDownloadUrl : undefined };
                const cleanItem = { ...(originalItem || {}), id: undefined, file: cleanFile, status: 'ready', captions: [], progress: 0,
                    timingSource: undefined, warnings: [],
                    message: 'Previous captions erased. Clean video ready for new captions.', outputPath: undefined, outputFileName: undefined };
                if (originalItem) captionVideoQueue[queueIndex] = cleanItem;
                else { captionVideoQueue = [cleanItem]; captionQueueIndex = 0; }
                // Switch source before allowing transcription/export again; stale overlays must not return.
                isErasingCaptions = false;
                loadQueuedCaptionVideo(originalItem ? queueIndex : 0);
                populateEditor();
                setCaptionExportActionsVisible(false);
                hasDrawnFirstFrame = false;
                renderCanvas.getContext('2d').clearRect(0, 0, renderCanvas.width, renderCanvas.height);
                seekSlider.value = 0;
                changed = true;
                setCaptionProgressBar(100);
                statusText.textContent = `Previous captions erased. Clean video loaded: ${fileName}. Generate captions to add new text.`;
                speakCaptionStudio('Previous captions erased. Clean video loaded.');
                notifyCaptionStudio('Caption Eraser', `Clean video loaded: ${fileName}`);
            } catch (err) {
                if (originalItem && !changed) captionVideoQueue[queueIndex] = originalItem;
                setCaptionProgressBar(0);
                console.error('[Caption Eraser] Error:', err);
                statusText.textContent = `Erasing failed: ${err.message}. Your source video and edited captions are unchanged.`;
            } finally {
                if (typeof unsubscribe === 'function') unsubscribe();
                else api.offCaptionEraseProgress?.(onProgress);
                isErasingCaptions = false;
                disabledStates.forEach((disabled, control) => { control.disabled = disabled; });
                if (changed) actionBtn.disabled = false;
                eraseBtn.textContent = 'Caption Eraser';
                hideSingleCaptionProgress();
                renderCaptionQueue();
                window.updateTaskProgressUi?.(0, false);
            }
        });
    }

    videoInput.addEventListener('click', (e) => { e.target.value = null; });

    function renderCaptionQueue() {
        publishCaptionLocalState();
        if (!queuePanel || !queueList) return;
        if (!captionVideoQueue.length) {
            queuePanel.classList.add('hidden');
            queueList.innerHTML = '';
            if (queueStatus) queueStatus.textContent = 'Queue ready.';
            const live = document.getElementById('cap2_captionQueueLiveStatus');
            if (live) live.remove();
            return;
        }
        queuePanel.classList.remove('hidden');
        const completedCount = captionVideoQueue.filter(item => item.captions && item.captions.length).length;
        const exportedCount = captionVideoQueue.filter(item => item.status === 'exported').length;
        const activeItem = captionVideoQueue.find(item => item.status === 'transcribing' || item.status === 'exporting' || item.status === 'erasing');
        const activeIndex = activeItem ? captionVideoQueue.indexOf(activeItem) : -1;
        const activePct = activeItem ? Math.max(0, Math.min(100, Math.round(activeItem.progress || 0))) : 0;
        const queuePct = Math.min(100, Math.round(((exportedCount + (activeItem ? activePct / 100 : 0)) / captionVideoQueue.length) * 100));
        if (queueStatus) {
            queueStatus.textContent = `${queuePct}% queue progress - Video ${captionQueueIndex + 1} of ${captionVideoQueue.length} - Captions ${completedCount}/${captionVideoQueue.length} - Exported ${exportedCount}/${captionVideoQueue.length}`;
        }
        let liveStatus = document.getElementById('cap2_captionQueueLiveStatus');
        if (!liveStatus) {
            liveStatus = document.createElement('div');
            liveStatus.id = 'cap2_captionQueueLiveStatus';
            liveStatus.style.cssText = 'display:none;margin:8px 0 10px;padding:12px;border-radius:10px;border:1px solid rgba(14,165,233,0.30);background:linear-gradient(135deg,rgba(14,165,233,0.18),rgba(99,102,241,0.12));box-shadow:0 10px 28px rgba(2,6,23,0.26);color:#fff';
            queuePanel.insertBefore(liveStatus, queueList);
        }
        if (activeItem || captionQueueRunning || captionQueueExporting) {
            const phase = activeItem?.status === 'erasing' ? 'Detecting and erasing captions' : activeItem && activeItem.status === 'exporting' ? 'Exporting captions' : 'Generating captions';
            const detail = activeItem
                ? (activeItem.message || `${activeIndex + 1}/${captionVideoQueue.length} - ${activeItem.file.name}`)
                : 'Preparing next video...';
            liveStatus.style.display = 'block';
            liveStatus.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                    <div style="display:flex;align-items:center;gap:9px;min-width:0">
                        <span style="width:15px;height:15px;border-radius:999px;border:2px solid ${activeItem && activeItem.status === 'exporting' ? '#fcd34d' : '#7dd3fc'};border-top-color:transparent;display:inline-block;animation:captionQueueSpin 0.9s linear infinite;flex:0 0 auto"></span>
                        <div style="min-width:0">
                            <div style="font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:${activeItem && activeItem.status === 'exporting' ? '#fcd34d' : '#7dd3fc'}">Active now</div>
                            <div style="font-size:11px;font-weight:900;color:#fff;line-height:1.2">${phase}</div>
                            <div style="font-size:9px;font-weight:700;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${activeItem ? `${activeIndex + 1}/${captionVideoQueue.length} - ${activeItem.file.name}` : 'Queue running'}</div>
                        </div>
                    </div>
                    <div style="text-align:right;flex:0 0 auto">
                        <div style="font-size:16px;font-weight:900;color:#fff;line-height:1">${activePct}%</div>
                        <div style="font-size:8px;font-weight:800;color:#94a3b8;margin-top:3px">current video</div>
                    </div>
                </div>
                <div style="font-size:9px;font-weight:700;color:#dbeafe;margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${detail}</div>
                <div style="height:7px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.10);margin-top:8px">
                    <div style="height:100%;width:${activePct}%;border-radius:999px;background:${activeItem && activeItem.status === 'exporting' ? 'linear-gradient(90deg,#f59e0b,#facc15,#a78bfa)' : 'linear-gradient(90deg,#38bdf8,#818cf8,#22d3ee)'};transition:width .25s ease"></div>
                </div>
            `;
        } else {
            liveStatus.style.display = 'none';
        }
        queueList.innerHTML = '';
        captionVideoQueue.forEach((item, index) => {
            const row = document.createElement('div');
            row.style.cssText = [
                'display:grid',
                'grid-template-columns:minmax(0,1fr) auto',
                'gap:8px',
                'align-items:center',
                'text-align:left',
                'padding:8px 10px',
                'border-radius:6px',
                'border:1px solid rgba(255,255,255,0.10)',
                'cursor:pointer',
                'color:#fff',
                index === captionQueueIndex ? 'background:rgba(250,204,21,0.20)' : 'background:rgba(255,255,255,0.05)'
            ].join(';');
            const label = document.createElement('button');
            label.type = 'button';
            label.disabled = captionLocalBusy();
            const pctLabel = (item.status === 'transcribing' || item.status === 'exporting') ? ` - ${Math.round(item.progress || 0)}%` : '';
            label.textContent = `${index + 1}. ${item.file.name} - ${item.status || 'ready'}${pctLabel}`;
            if ((item.status === 'failed' || item.status === 'retrying' || (item.status === 'ready' && captionLocalBusy())) && item.message) {
                label.textContent += ` — ${item.message}`;
                label.title = item.message;
            }
            label.style.cssText = 'min-width:0;text-align:left;background:transparent;border:0;color:#fff;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:normal;cursor:pointer';
            label.addEventListener('click', () => { if (!captionLocalBusy()) loadQueuedCaptionVideo(index); });
            row.addEventListener('click', () => { if (!captionLocalBusy()) loadQueuedCaptionVideo(index); });
            row.appendChild(label);
            if (item.captions && item.captions.length) {
                const exportOne = document.createElement('button');
                exportOne.type = 'button';
                exportOne.disabled = captionLocalBusy();
                exportOne.textContent = item.status === 'exported' ? 'Re-export' : 'Export';
                exportOne.style.cssText = 'padding:6px 10px;border-radius:6px;border:1px solid rgba(250,204,21,0.35);background:rgba(250,204,21,0.14);color:#fde68a;font-weight:900;cursor:pointer';
                exportOne.addEventListener('click', (event) => {
                    event.stopPropagation();
                    exportQueuedCaptionVideo(index);
                });
                row.appendChild(exportOne);
            }
            if (item.status === 'transcribing' || item.status === 'exporting') {
                const bar = document.createElement('div');
                bar.style.cssText = 'grid-column:1 / -1;height:5px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,0.08)';
                const fill = document.createElement('div');
                fill.style.cssText = `height:100%;width:${Math.max(0, Math.min(100, item.progress || 0))}%;border-radius:999px;background:${item.status === 'exporting' ? 'linear-gradient(90deg,#f59e0b,#a78bfa)' : 'linear-gradient(90deg,#38bdf8,#6366f1)'};transition:width .25s ease`;
                bar.appendChild(fill);
                row.appendChild(bar);
            }
            queueList.appendChild(row);
        });
        if (queuePrevBtn) queuePrevBtn.disabled = captionLocalBusy() || captionQueueIndex <= 0;
        if (queueNextBtn) queueNextBtn.disabled = captionLocalBusy() || captionQueueIndex >= captionVideoQueue.length - 1;
        if (queueRunBtn) {
            const remaining = captionVideoQueue.filter(item => item.status !== 'exported').length;
            queueRunBtn.disabled = captionLocalBusy() || remaining === 0;
            queueRunBtn.textContent = captionQueueRunning || captionQueueExporting
                ? `Queue Running ${exportedCount}/${captionVideoQueue.length}`
                : remaining === 0 ? 'Queue Complete' : `Start Queue (${remaining})`;
        }
        if (queueExportAllBtn) {
            const ready = captionVideoQueue.filter(item => item.status !== 'exported' && item.captions && item.captions.length).length;
            queueExportAllBtn.disabled = captionLocalBusy() || ready === 0;
            queueExportAllBtn.textContent = captionQueueExporting ? 'Exporting...' : `Export All (${ready})`;
        }
        if (isErasingCaptions) queueList.querySelectorAll('button').forEach(button => { button.disabled = true; });
    }

    function loadQueuedCaptionVideo(index, queueOwned = false) {
        if (isErasingCaptions || isExtractingText || isRecording || captionTranslationBusy) return;
        if ((captionQueueRunning || captionQueueExporting) && !queueOwned) return;
        if (!captionVideoQueue.length) return;
        captionQueueIndex = Math.max(0, Math.min(index, captionVideoQueue.length - 1));
        const item = captionVideoQueue[captionQueueIndex];
        const file = item && item.file;
        if (!file) return;
        ensureCaptionLocalItemId(item);
        clearCaptionPreviewLoop();

        activeFile = file;
        autoBurnRequested = false;
        generatedCaptions = item.captions ? JSON.parse(JSON.stringify(item.captions)) : [];
        audioDataArray = null;
        hasDrawnFirstFrame = false;
        clearPreviewFrameHandle();
        sourceVideo.pause();
        sourceVideo.removeAttribute('src');
        sourceVideo.load();
        if (videoUrl && videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
        videoUrl = file.previewUrl || (file.path ? captionFilePathToUrl(file.path) : URL.createObjectURL(file));

        videoContainer.classList.remove('hidden');
        actionBtn.disabled = false;
        actionBtn.classList.toggle('hidden', generatedCaptions.length > 0);
        exportBtn.classList.toggle('hidden', generatedCaptions.length === 0);
        if (previewBtn) previewBtn.classList.toggle('hidden', generatedCaptions.length === 0);
        if (generatedCaptions.length && item.outputPath) {
            renderCaptionExportActions({
                outputPath: item.outputPath,
                fileName: item.outputFileName
            }, { queueIndex: captionQueueIndex });
        } else {
            setCaptionExportActionsVisible(false);
        }
        editorPanel.classList.toggle('hidden', generatedCaptions.length === 0);
        editorPanel.style.display = generatedCaptions.length ? 'block' : 'none';
        resetBtn.classList.remove('hidden');
        if (eraseBtn) eraseBtn.classList.remove('hidden');
        actionBtn.textContent = captionVideoQueue.length > 1 ? 'Generate Queue' : 'Generate Captions';
        if (karaokeCheck) karaokeCheck.checked = true;
        if (generatedCaptions.length) populateEditor();

        sourceVideo.addEventListener('loadedmetadata', () => {
            let vw = sourceVideo.videoWidth;
            let vh = sourceVideo.videoHeight;
            if (!vw || !vh || vw === 0 || vh === 0) {
                vw = 1920;
                vh = 1080;
            }
            const maxDim = Math.max(vw, vh);
            if (maxDim > CAPTION_PREVIEW_MAX_DIM && vh > 0) {
                const scale = CAPTION_PREVIEW_MAX_DIM / maxDim;
                vw *= scale;
                vh *= scale;
            }
            renderCanvas.width = Math.floor(vw);
            renderCanvas.height = Math.floor(vh);
        }, { once: true });

        sourceVideo.addEventListener('loadeddata', () => {
            if (!hasDrawnFirstFrame) {
                const ctx = renderCanvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                const filter = filterSelect ? filterSelect.value : 'none';
                if (filter === 'darken') ctx.filter = 'brightness(50%)';
                else if (filter === 'blur') ctx.filter = 'blur(10px)';
                else if (filter === 'grayscale') ctx.filter = 'grayscale(100%)';
                else if (filter === 'sepia') ctx.filter = 'sepia(100%)';
                else if (filter === 'invert') ctx.filter = 'invert(100%) hue-rotate(180deg)';
                else ctx.filter = 'none';
                renderPreviewNow(0);
                hasDrawnFirstFrame = true;
            }
        }, { once: true });

        sourceVideo.src = videoUrl;
        sourceVideo.playbackRate = captionPreviewSpeed;
        progressBlock.classList.remove('hidden');
        statusText.innerHTML = generatedCaptions.length
            ? `Loaded ${captionQueueIndex + 1} of ${captionVideoQueue.length}. Captions ready. Edit, export this video, or Export All.`
            : `Loaded ${captionQueueIndex + 1} of ${captionVideoQueue.length}. Click Generate Queue when you are ready.`;
        renderCaptionQueue();
    }

    if (queuePrevBtn) {
        queuePrevBtn.addEventListener('click', () => loadQueuedCaptionVideo(captionQueueIndex - 1));
    }
    if (queueNextBtn) {
        queueNextBtn.addEventListener('click', () => loadQueuedCaptionVideo(captionQueueIndex + 1));
    }
    
    let autoContinueQueueAfterSingleJob = false;

    function getCaptionVideoFileKey(file) {
        if (!file) return '';
        const filePath = file.path || ((window.electronAPI && typeof window.electronAPI.getPathForFile === 'function')
            ? window.electronAPI.getPathForFile(file)
            : '');
        if (filePath) return String(filePath).trim().toLowerCase();
        return `${String(file.name || '').trim().toLowerCase()}::${Number(file.size) || 0}::${Number(file.lastModified) || 0}`;
    }

    function acceptCaptionVideoFiles(rawFiles, options = {}) {
        const isBusy = captionLocalBusy();
        const shouldAppend = Boolean(options.append || isBusy);
        const shouldAutoStart = Boolean(options.autoStart);
        const files = Array.from(rawFiles || []).filter(file => file && ((file.type && file.type.startsWith('video/')) || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name || '')));
        if (!files.length) {
            if (!isBusy && statusText) {
                statusText.innerHTML = '❌ The selected item is not a supported video. Choose MP4, MOV, M4V, WebM, MKV, or AVI.';
                actionBtn.disabled = true;
                actionBtn.classList.remove('hidden');
            }
            return;
        }

        // Deduplicate within the incoming batch first
        const batchSeen = new Set();
        const dedupedBatch = files.filter(file => {
            const key = getCaptionVideoFileKey(file);
            if (!key || batchSeen.has(key)) return false;
            batchSeen.add(key);
            return true;
        });

        if (shouldAppend && captionVideoQueue.length > 0) {
            const existingKeys = new Set(captionVideoQueue.map(item => getCaptionVideoFileKey(item?.file)).filter(Boolean));
            const uniqueNewFiles = dedupedBatch.filter(file => !existingKeys.has(getCaptionVideoFileKey(file)));
            if (!uniqueNewFiles.length) {
                if (statusText && !isBusy) {
                    statusText.innerHTML = '⚠️ Video is already in the queue — duplicate skipped.';
                } else if (queueStatus) {
                    queueStatus.textContent = `Duplicate skipped — all ${dedupedBatch.length} dropped video(s) are already in the queue.`;
                }
                return;
            }
            const firstNewIndex = captionVideoQueue.length;
            for (const file of uniqueNewFiles) {
                captionVideoQueue.push({
                    file,
                    status: 'ready',
                    captions: [],
                    progress: 0,
                    message: isBusy
                        ? 'Queued — will process automatically after current video...'
                        : 'Queued — ready to process...'
                });
            }
            if (isBusy) {
                autoContinueQueueAfterSingleJob = true;
                renderCaptionQueue();
                if (queuePanel) queuePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return;
            }
            loadQueuedCaptionVideo(firstNewIndex);
            scrollCaptionStudioToWorkSection();
            if (shouldAutoStart) {
                setTimeout(() => {
                    const startIdx = captionVideoQueue.findIndex(item => item && item.status !== 'exported');
                    if (startIdx >= 0) transcribeCaptionQueueFrom(startIdx);
                }, 60);
            }
            return;
        }

        if (syncSlider) syncSlider.value = '0';
        updateCaptionStyleValueLabels();
        captionVideoQueue = dedupedBatch.map(file => ({
            file,
            status: 'ready',
            captions: [],
            progress: 0,
            message: shouldAutoStart ? 'Queued — starting automatic captioning...' : 'Ready in queue.'
        }));
        captionQueueIndex = 0;
        loadQueuedCaptionVideo(0);
        scrollCaptionStudioToWorkSection();
        if (shouldAutoStart) {
            setTimeout(() => {
                transcribeCaptionQueueFrom(0);
            }, 60);
        }
    }

    videoInput.addEventListener('change', (e) => {
        if (videoInput.dataset.pattanCaptionHandled === '1') {
            delete videoInput.dataset.pattanCaptionHandled;
            return;
        }
        const appendWhenBusyOrQueued = captionLocalBusy() || captionVideoQueue.some(item => item && item.status !== 'exported');
        acceptCaptionVideoFiles(e.target.files || [], {
            append: appendWhenBusyOrQueued,
            autoStart: captionLocalBusy()
        });
    });

    window.addEventListener('pattan-mobile-files-ready', (event) => {
        const detail = event && event.detail ? event.detail : {};
        if (detail.inputId !== 'cap2_captionVideoInput') return;
        videoInput.dataset.pattanCaptionHandled = '1';
        acceptCaptionVideoFiles(detail.files || [], {
            append: captionLocalBusy(),
            autoStart: captionLocalBusy()
        });
    });

    // Wire Drag & Drop on #cap2_captionDropZone and #cap2_aiCaptionSection
    const dropZone = document.getElementById('cap2_captionDropZone');
    const captionSection = document.getElementById('cap2_aiCaptionSection');
    const setDropZoneActive = (active) => {
        if (!dropZone) return;
        dropZone.style.borderColor = active ? '#38bdf8' : 'rgba(56, 189, 248, 0.45)';
        dropZone.style.background = active
            ? 'linear-gradient(135deg, rgba(14, 165, 233, 0.28), rgba(99, 102, 241, 0.22))'
            : 'linear-gradient(135deg, rgba(14, 165, 233, 0.10), rgba(99, 102, 241, 0.08))';
        dropZone.style.transform = active ? 'scale(1.01)' : 'scale(1)';
    };
    if (dropZone) {
        dropZone.addEventListener('click', () => {
            if (videoInput) videoInput.click();
        });
        dropZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (videoInput) videoInput.click();
            }
        });
    }
    const hasDraggedFiles = (e) => {
        const types = e?.dataTransfer?.types;
        return Boolean(types && (Array.from(types).includes('Files') || Array.from(types).includes('application/x-moz-file')));
    };
    let dragDepth = 0;
    const dropTarget = captionSection || dropZone;
    if (dropTarget) {
        dropTarget.addEventListener('dragenter', (e) => {
            if (!hasDraggedFiles(e)) return;
            e.preventDefault();
            dragDepth += 1;
            setDropZoneActive(true);
        });
        dropTarget.addEventListener('dragover', (e) => {
            if (!hasDraggedFiles(e)) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            setDropZoneActive(true);
        });
        dropTarget.addEventListener('dragleave', (e) => {
            if (!hasDraggedFiles(e)) return;
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) setDropZoneActive(false);
        });
        dropTarget.addEventListener('drop', (e) => {
            if (!hasDraggedFiles(e)) return;
            e.preventDefault();
            e.stopPropagation();
            dragDepth = 0;
            setDropZoneActive(false);
            const droppedFiles = e.dataTransfer?.files;
            if (droppedFiles && droppedFiles.length > 0) {
                acceptCaptionVideoFiles(droppedFiles, { append: true, autoStart: true });
            }
        });
    }

    function setQueueItemState(index, patch) {
        if (!captionVideoQueue[index]) return;
        const current = captionVideoQueue[index];
        const forceStatus = patch && patch.forceStatus;
        if (current.status === 'exported' && patch && !forceStatus && (patch.status === 'exporting' || patch.status === 'transcribing')) {
            return;
        }
        const cleanPatch = { ...patch };
        delete cleanPatch.forceStatus;
        captionVideoQueue[index] = { ...captionVideoQueue[index], ...cleanPatch };
        renderCaptionQueue();
    }

    function setCaptionProgressBar(pct) {
        const captionProgress = document.getElementById('cap2_captionProgress');
        const pBar = document.getElementById('cap2_captionProgressBarValue');
        if (captionProgress) captionProgress.classList.remove('hidden');
        if (pBar) pBar.style.width = Math.max(0, Math.min(100, Math.round(pct))) + '%';
    }

    function renderSingleCaptionProgress(pct, phase = 'Working', detail = '') {
        const captionProgress = document.getElementById('cap2_captionProgress');
        if (!captionProgress) return;
        let liveStatus = document.getElementById('cap2_captionSingleLiveStatus');
        if (!liveStatus) {
            liveStatus = document.createElement('div');
            liveStatus.id = 'cap2_captionSingleLiveStatus';
            liveStatus.style.cssText = 'display:none;margin:8px 0 10px;padding:12px;border-radius:10px;border:1px solid rgba(14,165,233,0.30);background:linear-gradient(135deg,rgba(14,165,233,0.18),rgba(99,102,241,0.12));box-shadow:0 10px 28px rgba(2,6,23,0.26);color:#fff';
            captionProgress.insertBefore(liveStatus, captionProgress.firstChild);
        }
        const shownPct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
        const isExport = /export|final/i.test(phase);
        liveStatus.style.display = 'block';
        liveStatus.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="display:flex;align-items:center;gap:9px;min-width:0">
                    <span style="width:15px;height:15px;border-radius:999px;border:2px solid ${isExport ? '#fcd34d' : '#7dd3fc'};border-top-color:transparent;display:inline-block;animation:captionQueueSpin 0.9s linear infinite;flex:0 0 auto"></span>
                    <div style="min-width:0">
                        <div style="font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:${isExport ? '#fcd34d' : '#7dd3fc'}">Active now</div>
                        <div style="font-size:11px;font-weight:900;color:#fff;line-height:1.2">${phase}</div>
                        <div style="font-size:9px;font-weight:700;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${detail || (activeFile && activeFile.name) || 'Current video'}</div>
                    </div>
                </div>
                <div style="text-align:right;flex:0 0 auto">
                    <div style="font-size:16px;font-weight:900;color:#fff;line-height:1">${shownPct}%</div>
                    <div style="font-size:8px;font-weight:800;color:#94a3b8;margin-top:3px">current video</div>
                </div>
            </div>
            <div style="height:7px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.10);margin-top:8px">
                <div style="height:100%;width:${shownPct}%;border-radius:999px;background:${isExport ? 'linear-gradient(90deg,#f59e0b,#facc15,#a78bfa)' : 'linear-gradient(90deg,#38bdf8,#818cf8,#22d3ee)'};transition:width .25s ease"></div>
            </div>
        `;
    }

    function hideSingleCaptionProgress() {
        const liveStatus = document.getElementById('cap2_captionSingleLiveStatus');
        if (liveStatus) liveStatus.style.display = 'none';
    }

    function lockCaptionQueueControls(locked) {
        syncCaptionWorkbenchBusy();
        const allDone = captionVideoQueue.length > 0 && captionVideoQueue.every(item => item.status === 'exported');
        if (actionBtn) {
            actionBtn.disabled = locked || allDone;
            actionBtn.textContent = locked
                ? 'Queue Running...'
                : allDone
                    ? 'Queue Complete'
                    : (captionVideoQueue.length > 1 ? 'Generate Queue' : 'Generate Captions');
        }
        if (queueRunBtn) queueRunBtn.disabled = locked || allDone;
        if (queueExportAllBtn) queueExportAllBtn.disabled = locked || allDone;
        if (exportBtn) exportBtn.disabled = locked;
        if (queuePrevBtn) queuePrevBtn.disabled = locked || captionLocalBusy() || captionQueueIndex <= 0;
        if (queueNextBtn) queueNextBtn.disabled = locked || captionLocalBusy() || captionQueueIndex >= captionVideoQueue.length - 1;
        publishCaptionLocalState();
    }

    function startQueueProgressHeartbeat(index, phaseLabel, startPct, maxPct) {
        let shownPct = startPct;
        setCaptionProgressBar(shownPct);
        setQueueItemState(index, {
            status: 'transcribing',
            progress: shownPct,
            message: `${phaseLabel}... ${shownPct}%`
        });
        return setInterval(() => {
            if (captionTranslationBusy || !captionQueueRunning || !captionVideoQueue[index] || captionVideoQueue[index].status !== 'transcribing') return;
            const remaining = maxPct - shownPct;
            if (remaining <= 0.4) return;
            shownPct = Math.min(maxPct, shownPct + Math.max(1, remaining * 0.035));
            const pct = Math.round(shownPct);
            setCaptionProgressBar(pct);
            statusText.innerHTML = `Active now: ${phaseLabel.toLowerCase()} ${index + 1}/${captionVideoQueue.length} - ${pct}% complete - ${100 - pct}% remaining`;
            setQueueItemState(index, {
                status: 'transcribing',
                progress: pct,
                message: `${phaseLabel}... ${pct}%`
            });
        }, 700);
    }

    function forceQueueExportFontSize() {
        // Keep the user's size; queue export used to reset this to 50px.
        updateCaptionStyleValueLabels();
    }

    function selectedQueueFontSize() {
        return getCaptionSourceFontSize();
    }

    function waitForQueueVideoReady() {
        return new Promise(resolve => {
            if (sourceVideo.readyState >= 1) {
                resolve();
                return;
            }
            const done = () => resolve();
            sourceVideo.addEventListener('loadedmetadata', done, { once: true });
            setTimeout(done, 2500);
        });
    }

    function scrollCaptionStudioToWorkSection() {
        setTimeout(() => {
            const target = [queuePanel, progressBlock, videoContainer, editorPanel, statusText]
                .find(element => element && element.getClientRects().length);
            if (!target) return;
            const scrollBody = document.querySelector('#cap2_aiCaptionSection .caption-burner-body');
            const overflow = scrollBody ? window.getComputedStyle(scrollBody).overflowY : '';
            if (scrollBody && /^(auto|scroll)$/.test(overflow) && scrollBody.scrollHeight > scrollBody.clientHeight) {
                const baseTop = scrollBody.getBoundingClientRect().top;
                const targetTop = target.getBoundingClientRect().top;
                scrollBody.scrollTo({
                    top: Math.max(0, scrollBody.scrollTop + targetTop - baseTop - 12),
                    behavior: 'smooth'
                });
                return;
            }
            try {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (_) {
                target.scrollIntoView();
            }
        }, 120);
    }

    async function exportActiveCaptionVideoForQueue(index) {
        if (!await confirmCaptionExportPreview()) throw new Error('Export cancelled after preview. Your captions are preserved.');
        const item = captionVideoQueue[index];
        if (!item || !activeFile || !generatedCaptions.length) {
            throw new Error('No captions are ready for export.');
        }
        forceQueueExportFontSize();
        lockCaptionQueueControls(true);
        setCaptionExportActionsVisible(false);
        setQueueItemState(index, {
            status: 'exporting',
            progress: 2,
            message: `Captions ready. Exporting at ${selectedQueueFontSize()}px...`
        });
        statusText.innerHTML = `Active now: exporting captions ${index + 1}/${captionVideoQueue.length} at ${selectedQueueFontSize()}px...`;
        const pBar = document.getElementById('cap2_captionProgressBarValue');
        setCaptionProgressBar(2);

        const filePath = getCaptionSourcePath();
        if (!filePath) {
            throw new Error('Original source file path is unavailable. Re-upload the source video and try again.');
        }
        if (!window.electronAPI || typeof window.electronAPI.burnCaptions !== 'function') {
            throw new Error('Native caption exporter is not available.');
        }

        const captionsForBurn = getValidatedCaptionBurnList();
        if (!captionsForBurn.length) {
            throw new Error('No valid caption timings are available for export.');
        }

        let burnProgressHandler = null;
        let shownExportPct = 2;
        let finalizingTimer = null;
        const showQueueExportProgress = (pct, messagePrefix = 'Exporting captions') => {
            shownExportPct = Math.max(shownExportPct, Math.max(2, Math.min(99, Math.round(pct))));
            setQueueItemState(index, {
                status: 'exporting',
                progress: shownExportPct,
                message: `${messagePrefix} at ${selectedQueueFontSize()}px... ${shownExportPct}%`
            });
            statusText.innerHTML = `Active now: ${messagePrefix.toLowerCase()} ${index + 1}/${captionVideoQueue.length} - ${shownExportPct}% complete - ${100 - shownExportPct}% remaining`;
            setCaptionProgressBar(shownExportPct);
        };
        finalizingTimer = setInterval(() => {
            if (!captionQueueExporting || shownExportPct < 94 || shownExportPct >= 99) return;
            showQueueExportProgress(shownExportPct + 1, 'Finalizing export');
        }, 1200);
        if (typeof window.electronAPI.onBurnProgress === 'function') {
            burnProgressHandler = data => {
                let pct = 0;
                if (typeof data === 'number') pct = data;
                else if (data && typeof data.pct === 'number') pct = data.pct;
                const isFinalizing = data && typeof data === 'object' && data.phase === 'finalizing';
                showQueueExportProgress(pct, isFinalizing || pct >= 94 ? 'Finalizing export' : 'Exporting captions');
            };
            window.electronAPI.onBurnProgress(burnProgressHandler);
        }

        try {
            await ensureCaptionFontReady();
            const result = await window.electronAPI.burnCaptions({
                videoPath: filePath,
                sourceFileName: item.file && item.file.name ? item.file.name : '',
                captions: captionsForBurn,
                style: styleSelect ? styleSelect.value : 'white-yellow',
                fontSize: selectedQueueFontSize(),
                position: 'bottom',
                ...buildPreviewMatchedExport()
            });
            if (!result || !result.ok) {
                throw new Error((result && result.error) || 'FFmpeg caption export failed.');
            }
            setQueueItemState(index, {
                status: 'exported',
                progress: 100,
                outputPath: result.outputPath,
                outputFileName: result.fileName,
                message: `Saved - ${result.fileName || 'captioned video'}`
            });
            if (index === captionQueueIndex) {
                renderCaptionExportActions(result, { queueIndex: index });
            }
            if (pBar) pBar.style.width = '100%';
            return result;
        } finally {
            if (finalizingTimer) clearInterval(finalizingTimer);
            if (burnProgressHandler && typeof window.electronAPI.offBurnProgress === 'function') {
                window.electronAPI.offBurnProgress(burnProgressHandler);
            }
        }
    }

    function isRetryableCaptionQueueError(error) {
        const message = String(error?.message || error || '');
        const code = String(error?.code || '');
        if (code === 'CAPTION_TRANSCRIPTION_BUSY' || code === 'CAPTION_RESOURCE_BUSY') return true;
        if (/another caption transcription is running/i.test(message)) return true;
        if (/\b(?:cancelled|canceled|aborted by user)\b|no recognizable|no captions|no.*speech|not found|no.*path|unavailable.*path|unsupported|invalid|permission|ENOSPC|no space|not installed|out of memory/i.test(message)) return false;
        return /timeout|timed out|network|fetch|socket|ECONN|EPIPE|busy|temporar|no response|503|502|429|worker.*exit|server.*(closed|unavailable)/i.test(message);
    }

    async function transcribeCaptionQueueFrom(startIndex = 0) {
        if (captionLocalBusy() || !captionVideoQueue.length) return;
        const outputLanguage = getCaptionOutputLanguage();
        const notifyQueue = captionVideoQueue.some(item => item.status !== 'exported')
            ? createCaptionWhatsAppJob('AI Captioning · caption queue') : () => {};
        captionQueueRunning = true;
        captionQueueExporting = true;
        captionQueueMode = 'start';
        captionTranscriptionCancelRequested = false;
        lockCaptionQueueControls(true);
        renderCaptionQueue();
        try {
            const attempts = new Map();
            const ordered = [];
            for (let offset = 0; offset < captionVideoQueue.length; offset += 1) {
                ordered.push((startIndex + offset) % captionVideoQueue.length);
            }
            const queuedIndices = new Set(ordered);
            const syncNewlyAddedQueueItems = () => {
                for (let idx = 0; idx < captionVideoQueue.length; idx += 1) {
                    if (!queuedIndices.has(idx) && captionVideoQueue[idx] && captionVideoQueue[idx].status !== 'exported') {
                        queuedIndices.add(idx);
                        ordered.push(idx);
                    }
                }
            };
            for (const index of ordered) {
                syncNewlyAddedQueueItems();
                if (captionTranscriptionCancelRequested) break;
                const item = captionVideoQueue[index];
                if (!item || item.status === 'exported') continue;
                const previousQueueItem = { ...item, captions: JSON.parse(JSON.stringify(item.captions || [])), warnings: [...(item.warnings || [])] };
                try {
                    captionQueueIndex = index;
                    loadQueuedCaptionVideo(index, true);
                    await waitForQueueVideoReady();
                    lockCaptionQueueControls(true);
                    setQueueItemState(index, {
                        status: item.captions && item.captions.length ? 'transcribed' : 'transcribing',
                        progress: item.captions && item.captions.length ? 100 : 5,
                        message: item.captions && item.captions.length ? 'Captions already ready.' : 'Generating captions...'
                    });
                    if (!(captionVideoQueue[index].captions && captionVideoQueue[index].captions.length)) {
                        statusText.innerHTML = `Active now: generating captions ${index + 1}/${captionVideoQueue.length}...`;
                        const heartbeat = startQueueProgressHeartbeat(index, 'Generating captions', 5, 95);
                        try {
                            const videoPath = item.file.path || ((window.electronAPI && typeof window.electronAPI.getPathForFile === 'function')
                                ? window.electronAPI.getPathForFile(item.file)
                                : '');
                            if (!videoPath || !window.electronAPI || typeof window.electronAPI.transcribeVideo !== 'function') {
                                throw new Error('Electron could not access the local video path for captioning.');
                            }
                            activeCaptionTranscription = { videoPath, languageHint: 'auto', ...getCaptionTranscriptionOptions() };
                            if (cancelBtn) {
                                cancelBtn.disabled = false;
                                cancelBtn.textContent = 'Stop Transcription';
                                cancelBtn.classList.remove('hidden');
                            }
                            let transcription = await invokeCaptioner2TranscribeVideo(activeCaptionTranscription);
                            if (transcription?.cancelled || captionTranscriptionCancelRequested) {
                                captionTranscriptionCancelRequested = true;
                                throw new Error('Caption queue transcription cancelled.');
                            }
                            if ((!transcription || !transcription.ok)
                                && activeCaptionTranscription?.engine === 'groq'
                                && !['CAPTION_RESOURCE_BUSY', 'CAPTION_TRANSCRIPTION_BUSY'].includes(transcription?.code)) {
                                console.warn('[Captioner 2] Queue Groq transcription failed, falling back to Local Whisper:', transcription?.error);
                                statusText.innerHTML = `Groq timing uncertain on queue item ${index + 1}; switching to Local Whisper...`;
                                activeCaptionTranscription = { ...activeCaptionTranscription, engine: 'local', captionerVersion: 2 };
                                transcription = await invokeCaptioner2TranscribeVideo(activeCaptionTranscription);
                                if (transcription?.cancelled || captionTranscriptionCancelRequested) {
                                    captionTranscriptionCancelRequested = true;
                                    throw new Error('Caption queue transcription cancelled.');
                                }
                            }
                            if (!transcription || !transcription.ok) {
                                const err = new Error((transcription && transcription.error) || 'Electron transcription failed.');
                                if (transcription?.code) err.code = transcription.code;
                                throw err;
                            }
                            activeCaptionTranscription = null;
                            if (isSongCaptionMode() && !transcription.words?.length) throw new Error('No timed lyrics detected. Clearer vocals are needed for synchronized song captions.');
                            const directCaptions = applyCaptionSpellingCorrections(buildCaptionChunksFromTranscription(transcription, sourceVideo.duration || 60), spellingCorrections?.value);
                            if (!directCaptions.length) {
                                throw new Error('No recognizable speech or lyrics. Instrumental music and silent video may have no words to caption. Review the audio or select its spoken language.');
                            }
                            captionMetadataFromTranscription(transcription);
                            const output = await prepareCaptionOutput(directCaptions, outputLanguage, {
                                sourceLanguage: normalizeCaptionLanguageCode(transcription.language) || inferCaptionLanguageCode(transcription.text),
                                timingSource: captionVideoQueue[index].timingSource, warnings: captionVideoQueue[index].warnings,
                            });
                            generatedCaptions = output.captions;
                            captionVideoQueue[index].captions = JSON.parse(JSON.stringify(output.captions));
                            applyCaptionOutputMetadata(captionVideoQueue[index], output);
                            captionVideoQueue[index].status = 'transcribed';
                            renderCaptionQueue();
                        } finally {
                            clearInterval(heartbeat);
                            activeCaptionTranscription = null;
                            if (cancelBtn) cancelBtn.classList.add('hidden');
                        }
                    }
                    if (captionVideoQueue[index].outputLanguage !== outputLanguage) {
                        const current = captionVideoQueue[index];
                        const output = await prepareCaptionOutput(current.captions, outputLanguage, {
                            sourceLanguage: current.outputLanguage || current.sourceLanguage,
                            timingSource: current.timingSource, warnings: current.warnings || [],
                        });
                        generatedCaptions = output.captions;
                        captionVideoQueue[index].captions = JSON.parse(JSON.stringify(output.captions));
                        applyCaptionOutputMetadata(captionVideoQueue[index], output);
                        captionVideoQueue[index].outputPath = undefined;
                        captionVideoQueue[index].outputFileName = undefined;
                    }
                    if (!(captionVideoQueue[index].captions && captionVideoQueue[index].captions.length)) {
                        throw new Error(`No captions generated for ${item.file.name}`);
                    }
                    setCaptionProgressBar(100);
                    setQueueItemState(index, {
                        status: 'transcribed',
                        progress: 100,
                        message: 'Captions generated. Starting export...'
                    });
                    generatedCaptions = JSON.parse(JSON.stringify(captionVideoQueue[index].captions));
                    if (isSongCaptionMode()) {
                        setQueueItemState(index, { status: 'transcribed', progress: 100, message: 'Song captions ready. Review lyrics and timing before Export Video.' });
                        continue;
                    }
                    await exportActiveCaptionVideoForQueue(index);
                } catch (itemError) {
                    itemError = await explainCaptionTimingFailure(itemError, getCaptionTranscriptionOptions());
                    if (captionTranscriptionCancelRequested) {
                        setQueueItemState(index, { status: captionVideoQueue[index]?.captions?.length ? 'transcribed' : 'ready',
                            progress: 0, message: 'Queue stopped. Ready to restart.' });
                        break;
                    }
                    if (/cancelled after preview/i.test(String(itemError.message || itemError))) {
                        setQueueItemState(index, { status: 'transcribed', progress: 100, message: 'Ready for review. Export cancelled; captions preserved.' });
                        continue;
                    }
                    if (itemError.captionTranslationFailure && previousQueueItem.captions.length) {
                        captionVideoQueue[index] = previousQueueItem;
                        generatedCaptions = JSON.parse(JSON.stringify(previousQueueItem.captions));
                        setQueueItemState(index, { status: 'transcribed', progress: 100,
                            message: `${itemError.message} Captions retained; no export started.` });
                        continue;
                    }
                    const attempt = attempts.get(index) || 0;
                    if (attempt < 2 && isRetryableCaptionQueueError(itemError)) {
                        attempts.set(index, attempt + 1);
                        setQueueItemState(index, { status: 'retrying', progress: 0, message: `Retry ${attempt + 1}/2: ${String(itemError.message || itemError).slice(0, 120)}` });
                        await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
                        ordered.push(index);
                        continue;
                    }
                    setQueueItemState(index, {
                        status: 'failed',
                        progress: 0,
                        message: (String(itemError.message || itemError)
                            + (itemError.captionTimingFailure ? ' No export started.' : '')).slice(0, 500)
                    });
                    console.error(`[Caption Queue] Video ${index + 1} failed:`, itemError);
                } finally {
                    syncNewlyAddedQueueItems();
                }
            }
            const exportedCount = captionVideoQueue.filter(item => item.status === 'exported').length;
            const failedCount = captionVideoQueue.filter(item => item.status === 'failed').length;
            if (captionTranscriptionCancelRequested) {
                statusText.textContent = `Queue stopped. Exported ${exportedCount}/${captionVideoQueue.length} videos. Remaining videos are ready to restart.`;
                notifyQueue('cancelled', 'Caption queue stopped; remaining videos are ready to restart.');
                return;
            }
            notifyQueue(failedCount ? 'failed' : 'completed', failedCount
                ? `Exported ${exportedCount}/${captionVideoQueue.length}. ${captionVideoQueue.filter(item => item.status === 'failed').map(item => item.message || 'Caption processing failed.').join(' | ')}`
                : `Exported ${exportedCount}/${captionVideoQueue.length} captioned videos. ${captionVideoQueue.filter(item => item.status === 'transcribed').length} ready for review.`);
            statusText.textContent = failedCount
                ? `Queue finished. Exported ${exportedCount}/${captionVideoQueue.length} videos · Failed ${failedCount}. `
                    + captionVideoQueue.filter(item => item.status === 'failed')
                        .map(item => `${item.file?.name || 'Video'}: ${item.message || 'Caption processing failed.'}`).join(' | ')
                : `Queue complete. Exported ${exportedCount}/${captionVideoQueue.length} videos.`;
            speakCaptionStudio('Caption queue complete');
            notifyCaptionStudio(
                'Caption queue complete',
                failedCount ? `Exported ${exportedCount}. Failed ${failedCount}.` : `Exported ${exportedCount}. Remaining captions are available for review.`
            );
        } catch (error) {
            const current = captionVideoQueue[captionQueueIndex];
            if (current) {
                setQueueItemState(captionQueueIndex, {
                    status: 'failed',
                    progress: 0,
                    message: String(error.message || error).slice(0, 100)
                });
            }
            statusText.innerHTML = `Queue stopped: ${error.message || error}`;
            notifyQueue('failed', error);
            console.error('[Caption Queue]', error);
        } finally {
            captionQueueRunning = false;
            captionQueueExporting = false;
            captionQueueMode = '';
            activeCaptionTranscription = null;
            captionTranscriptionCancelRequested = false;
            if (cancelBtn) {
                cancelBtn.classList.add('hidden');
                cancelBtn.disabled = false;
                cancelBtn.textContent = 'Stop Transcription';
            }
            lockCaptionQueueControls(false);
            renderCaptionQueue();
        }
    }

    async function exportQueuedCaptionVideo(index) {
        if (captionLocalBusy() || !captionVideoQueue[index]) return;
        captionQueueExporting = true;
        captionQueueMode = 'single-export';
        lockCaptionQueueControls(true);
        try {
            if (captionVideoQueue[index].status === 'exported') {
                setQueueItemState(index, {
                    status: 'transcribed',
                    progress: 100,
                    message: 'Re-export queued.',
                    forceStatus: true
                });
            }
            loadQueuedCaptionVideo(index, true);
            await waitForQueueVideoReady();
            generatedCaptions = JSON.parse(JSON.stringify(captionVideoQueue[index].captions || []));
            await exportActiveCaptionVideoForQueue(index);
            statusText.innerHTML = `Exported ${index + 1}/${captionVideoQueue.length}: ${captionVideoQueue[index].file.name}`;
        } catch (error) {
            if (/cancelled after preview/i.test(String(error.message || error))) {
                setQueueItemState(index, { status: 'transcribed', progress: 100, message: 'Ready for review. Export cancelled; captions preserved.' });
                return;
            }
            setQueueItemState(index, { status: 'failed', progress: 0, message: String(error.message || error).slice(0, 100) });
            statusText.innerHTML = `Export failed: ${error.message || error}`;
        } finally {
            captionQueueExporting = false;
            captionQueueMode = '';
            lockCaptionQueueControls(false);
            renderCaptionQueue();
        }
    }

    async function exportReadyCaptionQueueFrom(startIndex = 0) {
        if (captionLocalBusy() || !captionVideoQueue.length) return;
        const notifyQueue = captionVideoQueue.some(item => item.status !== 'exported' && item.captions?.length)
            ? createCaptionWhatsAppJob('AI Captioning · ready export queue') : () => {};
        captionQueueExporting = true;
        captionQueueMode = 'export-ready';
        lockCaptionQueueControls(true);
        renderCaptionQueue();
        try {
            const ordered = [];
            for (let offset = 0; offset < captionVideoQueue.length; offset += 1) {
                ordered.push((startIndex + offset) % captionVideoQueue.length);
            }
            for (const index of ordered) {
                if (
                    captionVideoQueue[index].status === 'exported' ||
                    !(captionVideoQueue[index].captions && captionVideoQueue[index].captions.length)
                ) continue;
                for (let attempt = 0; attempt < 3; attempt += 1) {
                    try {
                        loadQueuedCaptionVideo(index, true);
                        await waitForQueueVideoReady();
                        generatedCaptions = JSON.parse(JSON.stringify(captionVideoQueue[index].captions));
                        await exportActiveCaptionVideoForQueue(index);
                        break;
                    } catch (error) {
                        if (/cancelled after preview/i.test(String(error.message || error))) {
                            setQueueItemState(index, { status: 'transcribed', progress: 100, message: 'Ready for review. Export cancelled; captions preserved.' });
                            break;
                        }
                        if (attempt < 2 && isRetryableCaptionQueueError(error)) {
                            setQueueItemState(index, { status: 'retrying', progress: 0, message: `Export retry ${attempt + 1}/2: ${String(error.message || error).slice(0, 100)}` });
                            await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
                            continue;
                        }
                        setQueueItemState(index, { status: 'failed', progress: 0, message: String(error.message || error).slice(0, 140) });
                        break;
                    }
                }
            }
            statusText.innerHTML = `Export ready queue complete. Exported ${captionVideoQueue.filter(item => item.status === 'exported').length}/${captionVideoQueue.length} videos.`;
            const failures = captionVideoQueue.filter(item => item.status === 'failed');
            notifyQueue(failures.length ? 'failed' : 'completed', `Exported ${captionVideoQueue.filter(item => item.status === 'exported').length}/${captionVideoQueue.length} videos. ${failures.length} failed; others may await review.`);
        } catch (error) {
            setQueueItemState(captionQueueIndex, { status: 'failed', progress: 0, message: String(error.message || error).slice(0, 100) });
            statusText.innerHTML = `Export queue stopped: ${error.message || error}`;
            notifyQueue('failed', error);
        } finally {
            captionQueueExporting = false;
            captionQueueMode = '';
            lockCaptionQueueControls(false);
            renderCaptionQueue();
        }
    }

    if (queueRunBtn) {
        queueRunBtn.addEventListener('click', () => transcribeCaptionQueueFrom(captionQueueIndex));
    }
    if (queueExportAllBtn) {
        queueExportAllBtn.addEventListener('click', () => exportReadyCaptionQueueFrom(captionQueueIndex));
    }

    async function extractAudio(fileToProcess) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const isElectron = window && window.process && window.process.type;
        
        statusText.innerHTML = "Fetching audio data...";
        const arrayBuffer = await fileToProcess.arrayBuffer();
        try {
            statusText.innerHTML = "Extracting audio with local FFmpeg server...";
            const mediaBase64 = arrayBufferToBase64(arrayBuffer);
            const response = await fetch('http://127.0.0.1:8430/api/extract-audio-wav', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mediaBase64,
                    inputFileName: fileToProcess.name || 'caption-video.mp4'
                })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error((payload && payload.error) || 'FFmpeg audio extraction failed.');
            }
            const wavArrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(wavArrayBuffer.slice(0));
            return {
                buffer: audioBuffer.getChannelData(0),
                duration: audioBuffer.duration,
                wavBase64: arrayBufferToBase64(wavArrayBuffer)
            };
        } catch (serverError) {
            console.warn("Local FFmpeg audio extraction failed, trying browser decode:", serverError);
        }

        statusText.innerHTML = "Decoding audio data locally...";
        
        let audioBuffer;
        try {
            if (isElectron) {
                const fs = require('fs');
                const path = require('path');
                const { execSync } = require('child_process');
                const projectRoot = (typeof process !== 'undefined' && process.cwd) ? process.cwd() : 'D:\\voice';
                const captionWorkDir = path.join(projectRoot, 'caption-work', 'browser-fallback');
                fs.mkdirSync(captionWorkDir, { recursive: true });

                const tempVid = path.join(captionWorkDir, "presentator_temp_" + Date.now() + ".mp4");
                const tempWav = path.join(captionWorkDir, "presentator_wav_" + Date.now() + ".wav");
                
                fs.writeFileSync(tempVid, Buffer.from(arrayBuffer));
                execSync(`ffmpeg -y -i "${tempVid}" -ac 1 -ar 16000 "${tempWav}"`, { stdio: 'ignore' });
                
                const wavData = fs.readFileSync(tempWav);
                const toArrayBuffer = new Uint8Array(wavData).buffer;
                audioBuffer = await audioContext.decodeAudioData(toArrayBuffer);
                
                try { fs.unlinkSync(tempVid); fs.unlinkSync(tempWav); } catch(e){}
            } else {
                audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            }
        } catch(e) {
            console.error("Advanced offline decode bypassed, falling back:", e);
            audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        }
        
        return {
            buffer: audioBuffer.getChannelData(0),
            duration: audioBuffer.duration
        };
    }

    function arrayBufferToBase64(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    function audioSamplesToWavBase64(samples, sampleRate = 16000) {
        const bytesPerSample = 2;
        const wavBuffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
        const view = new DataView(wavBuffer);
        let offset = 0;
        const writeString = (value) => {
            for (let i = 0; i < value.length; i += 1) {
                view.setUint8(offset, value.charCodeAt(i));
                offset += 1;
            }
        };
        writeString('RIFF');
        view.setUint32(offset, 36 + samples.length * bytesPerSample, true); offset += 4;
        writeString('WAVE');
        writeString('fmt ');
        view.setUint32(offset, 16, true); offset += 4;
        view.setUint16(offset, 1, true); offset += 2;
        view.setUint16(offset, 1, true); offset += 2;
        view.setUint32(offset, sampleRate, true); offset += 4;
        view.setUint32(offset, sampleRate * bytesPerSample, true); offset += 4;
        view.setUint16(offset, bytesPerSample, true); offset += 2;
        view.setUint16(offset, 16, true); offset += 2;
        writeString('data');
        view.setUint32(offset, samples.length * bytesPerSample, true); offset += 4;
        for (let i = 0; i < samples.length; i += 1) {
            const value = Math.max(-1, Math.min(1, samples[i] || 0));
            view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
            offset += 2;
        }
        const bytes = new Uint8Array(wavBuffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    function buildLinearCaptionChunks(text, duration, options) {
        const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        if (!words.length) return [];

        // ── Use ACTUAL narration duration so highlights match the voice ──────────
        // Priority order:
        //  1. state.narration.durationMs  (measured from the real audio blob)
        //  2. Caller-supplied override   (opts.narrationDurationSec)
        //  3. WPM-based estimate         (140 wpm for SC3/pattan)
        //  4. Caller-supplied videoDuration  (last resort – usually wrong)
        const opts = options || {};
        const WPM  = 140;  // SC3 / pattan TTS natural speaking rate
        const wpmEstimateSec = (words.length / WPM) * 60;

        let speechDurationSec = 0;
        if (window.state && window.state.narration && Number(window.state.narration.durationMs) > 500) {
            speechDurationSec = window.state.narration.durationMs / 1000;
        } else if (Number(opts.narrationDurationSec) > 0.5) {
            speechDurationSec = Number(opts.narrationDurationSec);
        } else {
            // Estimate from speech rate — far more accurate than video duration
            speechDurationSec = wpmEstimateSec;
        }

        // Never exceed the video duration, but also don't use video duration
        // as the primary timing reference (video may have long intro/outro)
        const videoDuration = Math.max(1, Number(duration) || 60);
        const safeDuration  = Math.min(speechDurationSec, videoDuration);

        const chunks = [];
        const chunkSize = CAPTION_WORD_LIMIT;
        for (let i = 0; i < words.length; i += chunkSize) {
            const chunkWords = words.slice(i, i + chunkSize);
            const start = (i / words.length) * safeDuration;
            const end   = (Math.min(words.length, i + chunkWords.length) / words.length) * safeDuration;
            chunks.push({
                text:      chunkWords.join(' '),
                timestamp: [start, Math.max(start + 0.35, end)]
            });
        }
        return chunks;
    }

    function inferCaptionLanguageCode(text) {
        const counts = {};
        for (const ch of String(text || '')) {
            const p = ch.codePointAt(0) || 0;
            if (p >= 0x0C00 && p <= 0x0C7F) counts.te = (counts.te || 0) + 1;
            else if (p >= 0x0900 && p <= 0x097F) counts.hi = (counts.hi || 0) + 1;
            else if (p >= 0x0B80 && p <= 0x0BFF) counts.ta = (counts.ta || 0) + 1;
            else if (p >= 0x0600 && p <= 0x06FF) counts.ar = (counts.ar || 0) + 1;
        }
        const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        return best && best[1] > 3 ? best[0] : '';
    }

    function normalizeCaptionLanguageCode(value) {
        const lang = String(value || '').trim().toLowerCase();
        if (!lang) return '';
        if (lang === 'telugu' || lang === 'te') return 'te';
        if (lang === 'hindi' || lang === 'hi') return 'hi';
        if (lang === 'tamil' || lang === 'ta') return 'ta';
        if (lang === 'urdu' || lang === 'ur') return 'ur';
        if (lang === 'arabic' || lang === 'ar') return 'ar';
        if (lang === 'english' || lang === 'en') return 'en';
        return lang.slice(0, 2);
    }

    function isIndicCaptionLanguage(code) {
        return ['te', 'hi', 'ta', 'ur', 'ar'].includes(normalizeCaptionLanguageCode(code));
    }

    function likelyIndicCaptionFileName(file) {
        const name = String((file && file.name) || '').toLowerCase();
        if (/\btelugu\b|తెలుగు/.test(name)) return 'te';
        if (/\bhindi\b|हिंदी/.test(name)) return 'hi';
        if (/\btamil\b|தமிழ்/.test(name)) return 'ta';
        if (/\burdu\b|اردو/.test(name)) return 'ur';
        return '';
    }

    function isCaptionRepetitionLoop(text) {
        const compact = String(text || '').replace(/[\s\W_]+/gu, '');
        if (compact.length >= 30) {
            const counts = {};
            for (const ch of Array.from(compact)) counts[ch] = (counts[ch] || 0) + 1;
            const values = Object.values(counts);
            if (Math.max(...values) / compact.length > 0.45) return true;
            if (values.length <= 4) return true;
        }
        const words = String(text || '').trim().split(/\s+/).filter(Boolean);
        if (words.length < 6) return false;
        const wordCounts = {};
        for (const word of words) wordCounts[word] = (wordCounts[word] || 0) + 1;
        return Math.max(...Object.values(wordCounts)) / words.length > 0.6;
    }

    function buildCaptionChunksFromTranscription(result, duration) {
        const words = Array.isArray(result && result.words) ? result.words : [];
        const segments = Array.isArray(result && result.segments) ? result.segments : [];
        const chunks = [];
        const buildFromSegments = () => applyCaptionGrammarPunctuation(segments.filter(s => s.text && String(s.text).trim()).map(s => ({
            text: String(s.text).trim(),
            timestamp: [Number(s.start || 0), Number(s.end || (Number(s.start || 0) + 0.5))],
            words: String(s.text).trim().split(/\s+/).map((w, i, a) => ({
                text: w,
                timestamp: [
                    Number(s.start || 0) + (i / a.length) * (Number(s.end || 0) - Number(s.start || 0)),
                    Number(s.start || 0) + ((i + 1) / a.length) * (Number(s.end || 0) - Number(s.start || 0))
                ]
            }))
        })), { songMode: isSongCaptionMode() });
        if (words.length > 0) {
            // A decoder can recognize a complete sentence but omit its word
            // timestamps. A partial word list must never silently remove that
            // sentence from the preview or an automatically exported queue.
            const cues = buildSpeechBoundedCaptionChunks(words, CAPTION_WORD_LIMIT, segments);
            const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
            const timedText = normalize(cues.map(cue => cue.text).join(' '));
            const recognizedText = normalize(result?.text) || normalize(segments.map(segment => segment?.text || '').join(' '));
            if (recognizedText && recognizedText !== timedText) {
                const segCues = buildFromSegments();
                if (segCues.length > 0) return segCues;
                if (result && result.text) {
                    return applyCaptionGrammarPunctuation(
                        buildLinearCaptionChunks(String(result.text), duration || 60, { narrationDurationSec: duration || 60 }),
                        { songMode: isSongCaptionMode() }
                    );
                }
            }
            return cues;
        } else if (segments.length > 0) {
            return buildFromSegments();
        } else if (result && result.text) {
            return applyCaptionGrammarPunctuation(
                buildLinearCaptionChunks(String(result.text), duration || 60, { narrationDurationSec: duration || 60 }),
                { songMode: isSongCaptionMode() }
            );
        }
        return chunks;
    }

    async function transcribeVideoWithGroqForIndic(videoPath, languageHint, detail, progressFn) {
        if (!window.electronAPI || typeof window.electronAPI.transcribeVideoGroq !== 'function') {
            throw new Error('High-accuracy Telugu/Hindi caption engine is not available.');
        }
        statusText.innerHTML = `Using high-accuracy Whisper for ${detail || 'Telugu/Hindi'} captions...`;
        const pBar = document.getElementById('cap2_captionProgressBarValue');
        if (pBar) pBar.style.width = '18%';
        if (typeof progressFn === 'function') {
            progressFn(18, 'Generating captions', `High-accuracy Whisper is transcribing ${detail || 'Indic'} audio...`);
        }
        const groq = await window.electronAPI.transcribeVideoGroq({ videoPath, languageHint: languageHint || 'auto', captionerVersion: 2 });
        if (!groq || !groq.ok) {
            throw new Error((groq && groq.error) || 'High-accuracy Whisper failed.');
        }
        const text = String(groq.text || '');
        if (isCaptionRepetitionLoop(text)) {
            throw new Error('High-accuracy Whisper returned a repeated caption loop.');
        }
        return groq;
    }

    async function transcribeWithLocalServer(extractedAudio) {
        const serverUrl = (window.state && window.state.transcribeServerUrl) || 'http://127.0.0.1:8428';
        const audioBase64 = extractedAudio.wavBase64 || audioSamplesToWavBase64(extractedAudio.buffer, 16000);
        const response = await fetch(`${serverUrl}/api/transcribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: 'caption-audio.wav', audioBase64 })
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error((payload && payload.error) || 'Local transcription server failed.');
        }
        const payload = await response.json();
        const text = String((payload && payload.text) || '').trim();
        if (!text) {
            throw new Error('No speech was recognized from the video audio.');
        }

        // ── Use REAL word-level timestamps from Whisper ──────────────────────
        const words    = Array.isArray(payload.words)    ? payload.words    : [];
        const segments = Array.isArray(payload.segments) ? payload.segments : [];
        let chunks = [];

        if (words.length > 0) {
            // Real word timestamps plus pause/sentence-aware grouping prevent
            // future narration from appearing before it is spoken.
            chunks = buildCaptionChunksFromTranscription(payload, extractedAudio.duration);
        } else if (segments.length > 0) {
            // Fall back to segment-level timestamps
            chunks = segments
                .filter(s => s.text && s.text.trim())
                .map(s => ({
                    text: s.text.trim(),
                    timestamp: [s.start, s.end],
                    words: s.text.trim().split(/\s+/).map((w, i, arr) => ({
                        text: w,
                        timestamp: [
                            s.start + (i / arr.length) * (s.end - s.start),
                            s.start + ((i + 1) / arr.length) * (s.end - s.start)
                        ]
                    }))
                }));
        } else {
            // Last resort: linear spread using video duration (NOT narration duration)
            const vidDur = (sourceVideo && sourceVideo.duration) || extractedAudio.duration || 60;
            chunks = buildLinearCaptionChunks(text, vidDur, { narrationDurationSec: vidDur });
        }

        return { text, chunks, timingSource: payload.timingSource === 'estimated' || !words.length ? 'estimated' : 'word',
            words, warnings: Array.isArray(payload.warnings) ? payload.warnings : [] };
    }
    
    function populateEditor() {
        editorPanel.classList.toggle('hidden', !generatedCaptions.length);
        editorPanel.style.display = generatedCaptions.length ? 'block' : 'none';
        const sizeSample = document.getElementById('cap2_captionSizePreviewText');
        if (sizeSample) sizeSample.textContent = generatedCaptions[0]?.text || 'Caption size sample';
        const sizePreviewButton = document.getElementById('cap2_captionSizePreviewBtn');
        if (sizePreviewButton) sizePreviewButton.disabled = !generatedCaptions.length;
        captionList.innerHTML = '';
        generatedCaptions.forEach((chunk, i) => {
            const div = document.createElement('div');
            div.style.cssText = "display: flex; gap: 8px; margin-bottom: 8px; align-items: stretch;";
            div.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:4px; font-family: monospace; background: rgba(0,0,0,0.1); border: 1px solid rgba(255,255,255,0.05); padding: 6px; border-radius: 4px; font-size: 0.75rem; align-items: center; justify-content:center;">
                    <div style="font-size: 0.85rem; font-weight: bold; white-space: nowrap; margin-bottom: 2px;">${formatTime(chunk.timestamp[0])}</div>
                    <div style="display:flex; gap:2px; align-items:center;">
                        <input type="number" step="0.1" title="Start Time (sec)" class="chunk-time-input" data-type="start" data-index="${i}" value="${Number(chunk.timestamp[0]).toFixed(1)}" style="width:50px; text-align:center; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:white; padding:2px; border-radius:2px;">
                        <span style="color:rgba(255,255,255,0.4);">-</span>
                        <input type="number" step="0.1" title="End Time (sec)" class="chunk-time-input" data-type="end" data-index="${i}" value="${Number(chunk.timestamp[1]).toFixed(1)}" style="width:50px; text-align:center; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:white; padding:2px; border-radius:2px;">
                    </div>
                </div>
                <textarea class="chunk-editor" rows="2" style="flex-grow: 1; min-width:0; background: rgba(0,0,0,0.05); border: 1px solid rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; font-family: inherit; font-size: 0.95rem; color: inherit;" data-index="${i}"></textarea>
                <input type="color" class="chunk-color-picker" data-index="${i}" title="Speaker Color Override" style="height:auto; min-height:40px; cursor:pointer; background:none; border:none; padding:0;" value="${/^#[0-9a-f]{6}$/i.test(chunk.colorOverride || '') ? chunk.colorOverride : '#fde047'}">
                <button class="chunk-remove-btn" title="Remove row" style="background:rgba(255,0,0,0.2); border:1px solid rgba(255,0,0,0.4); color:white; padding:0 8px; border-radius:4px; cursor:pointer;" data-index="${i}">✖</button>
            `;
            div.querySelector('.chunk-editor').value = String(chunk.text ?? '');
            captionList.appendChild(div);
        });

        const editorActionRow = document.createElement('div');
        editorActionRow.style.cssText = 'display: flex; gap: 8px; margin-top: 10px;';

        const grammarBtn = document.createElement('button');
        grammarBtn.id = 'cap2_captionGrammarBtn';
        grammarBtn.type = 'button';
        grammarBtn.className = 'ghost-btn';
        grammarBtn.style.cssText = 'flex: 1; padding: 10px; border-radius: 4px; border: 1px solid rgba(56,189,248,0.4); background: rgba(56,189,248,0.12); color: #bae6fd; font-weight: 700; cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 6px;';
        grammarBtn.innerHTML = '<span>✓</span><span>Check , &amp; . Grammar</span>';
        grammarBtn.onclick = () => {
            if (captionLocalBusy() || !generatedCaptions.length) return;
            generatedCaptions = applyCaptionGrammarPunctuation(generatedCaptions, { songMode: false });
            const item = captionVideoQueue[captionQueueIndex];
            commitCaptionLocalEdits({ timingSource: item?.timingSource || 'word', warnings: item?.warnings || [] });
            populateEditor();
            if (statusText) statusText.innerHTML = '✅ Checked and corrected , and . punctuation according to grammar.';
        };
        editorActionRow.appendChild(grammarBtn);

        const addBtn = document.createElement('button');
        addBtn.className = 'primary-btn';
        addBtn.style.cssText = 'flex: 1; padding: 10px; border-radius: 4px; border: 1px dashed rgba(255,255,255,0.3); background: rgba(255,255,255,0.05); color: white; cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 6px;';
        addBtn.innerHTML = '<span>+</span><span>Add Caption Row</span>';
        addBtn.onclick = () => {
            if (captionLocalBusy()) return;
            const lastChunk = generatedCaptions[generatedCaptions.length - 1];
            let start = lastChunk ? parseFloat(lastChunk.timestamp[1]) : 0;
            let end = clampCaptionPreviewTime(start + 2.0);
            if (end <= start) { localWorkbenchBridge.notice('No video time remains for another cue. Adjust the final cue first.'); return; }
            generatedCaptions.push({ text: "New Caption.", timestamp: [start, end], colorOverride: '#fde047' });
            commitCaptionLocalEdits({ timingSource: 'estimated', warnings: captionVideoQueue[captionQueueIndex]?.warnings || [] });
            populateEditor();
        };
        editorActionRow.appendChild(addBtn);
        captionList.appendChild(editorActionRow);

        document.querySelectorAll('#cap2_captionList .chunk-editor').forEach(input => {
            input.addEventListener('input', (e) => {
                if (captionLocalBusy()) return;
                const index = parseInt(e.target.dataset.index);
                const updated = captionLocalReconcileText(generatedCaptions[index], e.target.value);
                generatedCaptions[index] = updated.cue;
                const item = captionVideoQueue[captionQueueIndex];
                commitCaptionLocalEdits({ timingSource: updated.estimated ? 'estimated' : item?.timingSource, warnings: item?.warnings || [] });
            });
        });
        document.querySelectorAll('#cap2_captionList .chunk-color-picker').forEach(input => {
            input.addEventListener('input', (e) => {
                if (captionLocalBusy()) return;
                generatedCaptions[parseInt(e.target.dataset.index)].colorOverride = e.target.value;
                commitCaptionLocalEdits();
            });
        });
        document.querySelectorAll('#cap2_captionList .chunk-time-input').forEach(input => {
            input.addEventListener('input', (e) => {
                if (captionLocalBusy()) return;
                const index = parseInt(e.target.dataset.index);
                const type = e.target.dataset.type;
                const val = e.target.value.trim() ? Number(e.target.value) : NaN;
                const current = captionLocalCanonicalCue(generatedCaptions[index]);
                const next = { ...current, [type]: val }; delete next.words;
                try { captionLocalValidateCues([next], sourceVideo.duration); }
                catch (error) { e.target.setCustomValidity(error.message); localWorkbenchBridge.notice(error.message); return; }
                e.target.setCustomValidity('');
                generatedCaptions[index] = captionLocalLegacyCue(next);
                commitCaptionLocalEdits({ timingSource: 'estimated', warnings: captionVideoQueue[captionQueueIndex]?.warnings || [] });
            });
        });
        document.querySelectorAll('#cap2_captionList .chunk-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (captionLocalBusy()) return;
                const index = parseInt(e.target.dataset.index);
                generatedCaptions.splice(index, 1);
                commitCaptionLocalEdits();
                populateEditor();
            });
        });
        publishCaptionLocalState();
    }

    // ── Multi-language Caption Translator ───────────────────────────────────
    function applyCaptionOutputMetadata(item, output) {
        if (!item) return;
        item.outputLanguage = output.outputLanguage;
        item.captionLanguage = { en: 'English', te: 'Telugu', hi: 'Hindi' }[output.outputLanguage];
        item.timingSource = output.timingSource;
        item.warnings = output.warnings;
    }

    async function prepareCaptionOutput(captions, target, metadata = {}) {
        const expectedId = ensureCaptionLocalItemId(captionVideoQueue[captionQueueIndex]);
        const controller = new AbortController();
        captionTranslationController = controller;
        captionTranslationBusy = true;
        const timeout = setTimeout(() => controller.abort(new Error('Caption translation timed out. The previous captions are preserved.')), captionTranslationTimeoutMs(captions));
        publishCaptionLocalState();
        if (cancelBtn) {
            cancelBtn.disabled = false;
            cancelBtn.textContent = 'Stop Translation';
            cancelBtn.classList.remove('hidden');
        }
        statusText.textContent = `Preparing ${ { en: 'English', te: 'Telugu', hi: 'Hindi' }[target] || 'English'} captions…`;
        try {
            const output = await translateCaptionLanguageBatch(captions, { target, ...metadata, signal: controller.signal });
            if (captionTranscriptionCancelRequested || expectedId !== ensureCaptionLocalItemId(captionVideoQueue[captionQueueIndex])) {
                throw new Error('Caption translation cancelled.');
            }
            return output;
        } catch (error) {
            if (controller.signal.aborted) {
                const reason = controller.signal.reason instanceof Error ? controller.signal.reason : new Error('Caption translation cancelled.');
                reason.captionTranslationFailure = true;
                throw reason;
            }
            const failure = new Error(`Caption translation failed: ${error.message || error}. Check the translation service and retry. The previous captions are preserved.`);
            failure.captionTranslationFailure = true;
            throw failure;
        } finally {
            clearTimeout(timeout);
            if (captionTranslationController === controller) captionTranslationController = null;
            captionTranslationBusy = false;
            if (cancelBtn) { cancelBtn.classList.add('hidden'); cancelBtn.disabled = false; cancelBtn.textContent = 'Stop Transcription'; }
            publishCaptionLocalState();
        }
    }

    async function translateCaptionsTo(targetLang) {
        if (captionLocalBusy()) return;
        if (!generatedCaptions.length) { statusText.textContent = 'Generate or load captions first, then translate.'; return; }
        const target = normalizeCaptionOutputLanguage(targetLang);
        const selector = document.getElementById('cap2_captionLanguage');
        if (selector) selector.value = target;
        const item = captionVideoQueue[captionQueueIndex];
        const notifyTranslation = createCaptionWhatsAppJob('AI Captioning · caption translation');
        captionTranscriptionCancelRequested = false;
        try {
            const output = await prepareCaptionOutput(generatedCaptions, target, {
                sourceLanguage: item?.outputLanguage || item?.sourceLanguage,
                timingSource: item?.timingSource, warnings: item?.warnings || [],
            });
            generatedCaptions = output.captions;
            applyCaptionOutputMetadata(item, output);
            commitCaptionLocalEdits({ timingSource: output.timingSource, warnings: output.warnings }, true, true);
            populateEditor();
            updateCaptionStyleValueLabels();
            statusText.textContent = `${generatedCaptions.length} captions ready in ${item?.captionLanguage || target}. Cue start and end times are unchanged. Review synchronization, then export.`;
            notifyTranslation('completed', `${generatedCaptions.length} captions ready in ${item?.captionLanguage || target}.`);
        } catch (error) {
            statusText.textContent = captionTranscriptionCancelRequested ? 'Translation cancelled. Your previous captions are preserved.' : error.message;
            notifyTranslation(captionTranscriptionCancelRequested ? 'cancelled' : 'failed', error);
        } finally {
            captionTranscriptionCancelRequested = false;
            actionBtn.disabled = false;
            actionBtn.textContent = 'Generate Captions';
            renderCaptionQueue();
        }
    }

    // Wire translation buttons
    const translateEnBtn = document.getElementById('cap2_captionTranslateEnBtn');
    const translateHiBtn = document.getElementById('cap2_captionTranslateHiBtn');
    const translateTeBtn = document.getElementById('cap2_captionTranslateTeBtn');
    if (translateEnBtn) translateEnBtn.addEventListener('click', () => translateCaptionsTo('en'));
    if (translateHiBtn) translateHiBtn.addEventListener('click', () => translateCaptionsTo('hi'));
    if (translateTeBtn) translateTeBtn.addEventListener('click', () => translateCaptionsTo('te'));
    document.getElementById('cap2_captionTranslateSelectedBtn')?.addEventListener('click', () => translateCaptionsTo(getCaptionOutputLanguage()));
    document.getElementById('cap2_captionLanguage')?.addEventListener('change', () => {
        const sample = document.getElementById('cap2_captionSizePreviewText');
        if (sample) sample.textContent = { en: 'Caption size sample', te: 'ఉపశీర్షిక పరిమాణం', hi: 'कैप्शन आकार का नमूना' }[getCaptionOutputLanguage()];
        updateCaptionStyleValueLabels();
    });

    const CAPTION_LANGUAGE_TO_CODE = {
        English: 'en',
        Hindi: 'hi',
        Telugu: 'te'
    };

    async function translateCaptionsForSelectedLanguage(language) {
        const target = CAPTION_LANGUAGE_TO_CODE[language || 'English'] || 'en';
        await translateCaptionsTo(target);
    }

    function openLocalAiVideoCaptioningSection() {
        setTimeout(() => {
            const section = document.getElementById('cap2_aiCaptionSection');
            if (section) {
                section.setAttribute('open', '');
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (videoInput) {
                videoInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 350);
    }

    async function importIntoLocalAiVideoCaptioning(detail) {
        if (captionLocalBusy()) throw new Error('Wait for the active caption job before importing another video.');
        if (isErasingCaptions || isExtractingText) {
            if (statusText) statusText.innerHTML = 'A caption transcription is already running. Please let it finish; a duplicate job was not started.';
            return;
        }
        const pathFiles = Array.from((detail && detail.filePaths) || [])
            .map(filePath => {
                const normalizedPath = String(filePath || '').trim();
                if (!normalizedPath) return null;
                return {
                    name: normalizedPath.split(/[\\/]/).pop() || 'translated-video.mp4',
                    type: 'video/mp4',
                    path: normalizedPath
                };
            })
            .filter(Boolean);
        const files = [
            ...pathFiles,
            ...Array.from((detail && detail.files) || [])
        ].filter(file => file && file.type && file.type.startsWith('video/'));
        if (!files.length) return;
        const selector = document.getElementById('cap2_captionLanguage');
        if (selector) selector.value = normalizeCaptionOutputLanguage(detail.language);
        const readyCaptions = Array.isArray(detail.captions)
            ? detail.captions
                .map(caption => {
                    const timestamp = Array.isArray(caption.timestamp) ? caption.timestamp : [caption.start, caption.end];
                    const start = Math.max(0, Number(timestamp[0]) || 0);
                    const end = Math.max(start + 0.12, Number(timestamp[1]) || 0);
                    const text = String(caption.text ?? '');
                    if (!text.trim()) return null;
                    const words = Array.isArray(caption.words) && caption.words.length
                        ? caption.words
                        : text.split(/\s+/).filter(Boolean).map((word, index, all) => ({
                            text: word,
                            timestamp: [
                                start + (index / Math.max(1, all.length)) * (end - start),
                                start + ((index + 1) / Math.max(1, all.length)) * (end - start)
                            ]
                        }));
                    return captionLocalLegacyCue({ ...captionLocalCanonicalCue({ ...caption, text, words }), start, end });
                })
                .filter(Boolean)
            : [];
        window.__presentatorCaptioner2Handled = true;
        openLocalAiVideoCaptioningSection();
        captionVideoQueue = files.map(file => ({
            file,
            status: readyCaptions.length ? 'transcribed' : 'ready',
            captions: readyCaptions.length ? JSON.parse(JSON.stringify(readyCaptions)) : [],
            timingSource: detail.timingSource === 'word' ? 'word' : 'estimated',
            warnings: Array.isArray(detail.warnings) ? detail.warnings.map(String) : [],
            captionLanguage: detail.language || 'English',
            outputLanguage: readyCaptions.length ? normalizeCaptionOutputLanguage(detail.language) : undefined,
        }));
        captionQueueIndex = 0;
        loadQueuedCaptionVideo(0);
        if (readyCaptions.length) {
            generatedCaptions = JSON.parse(JSON.stringify(readyCaptions));
            if (captionVideoQueue[0]) {
                captionVideoQueue[0].captions = JSON.parse(JSON.stringify(readyCaptions));
                captionVideoQueue[0].status = 'transcribed';
            }
            editorPanel.classList.remove('hidden');
            editorPanel.style.display = 'block';
            actionBtn.classList.add('hidden');
            exportBtn.classList.remove('hidden');
            if (previewBtn) previewBtn.classList.remove('hidden');
            if (eraseBtn) eraseBtn.classList.remove('hidden');
            setCaptionExportActionsVisible(false);
            const pBar = document.getElementById('cap2_captionProgressBarValue');
            if (pBar) pBar.style.width = '100%';
            populateEditor();
            renderCaptionQueue();
        }
        if (statusText) {
            statusText.innerHTML = readyCaptions.length
                ? `Loaded ${readyCaptions.length} transcribed captions from Translate Audio. Caption language: ${detail.language || 'English'}.`
                : `Loaded ${files.length} video${files.length === 1 ? '' : 's'} from Translate Audio. Caption language: ${detail.language || 'English'}.`;
        }
        if (detail.autoStart !== false) {
            if (readyCaptions.length) {
                await translateCaptionsForSelectedLanguage(detail.language || 'English');
                return;
            }
            if (captionVideoQueue.length > 1) {
                await transcribeCaptionQueueFrom(0);
                return;
            }
            await transcribeActiveCaptionVideo();
        }
    }

    window.addEventListener('presentator-open-captioner-2', openLocalAiVideoCaptioningSection);
    window.addEventListener('presentator-captioner-2-import', (event) => {
        importIntoLocalAiVideoCaptioning(event.detail || {}).catch(error => {
            console.error('[Caption] Translate Audio handoff failed:', error);
            if (statusText) statusText.innerHTML = `Caption handoff failed: ${error.message || error}`;
        });
    });
    if (window.__presentatorPendingCaptioner2) {
        importIntoLocalAiVideoCaptioning(window.__presentatorPendingCaptioner2).catch(error => {
            console.error('[Caption] Pending Translate Audio handoff failed:', error);
        });
        window.__presentatorPendingCaptioner2 = null;
    }
    // ── "Use Voice Text as Captions" button ─────────────────────────────────
    const voiceTextBtn = document.getElementById('cap2_captionUseVoiceTextBtn');
    if (voiceTextBtn) {
        voiceTextBtn.addEventListener('click', () => {
            if (captionLocalBusy()) return;
            // Read narration text from state (accumulated across all slides)
            const narText = (
                (window.state && Array.isArray(window.state.allNarrationTexts) && window.state.allNarrationTexts.length
                    ? window.state.allNarrationTexts.join(' ')
                    : window.state && window.state.lastNarrationText) ||
                ''
            ).trim();
            const narVoice = (
                (window.state && window.state.lastNarrationVoice) ||
                localStorage.getItem('pp_last_narration_voice') ||
                'anjali'
            );

            if (!narText) {
                statusText.innerHTML = '⚠️ No voice narration found. Generate narration first, then open caption studio.';
                return;
            }

            const duration = sourceVideo ? (sourceVideo.duration || 60) : 60;
            // Use actual narration duration (state.narration.durationMs) if available
            // so chunk timestamps reflect real speech speed rather than video length.
            const chunks   = buildLinearCaptionChunks(narText, duration);


            if (!chunks.length) {
                statusText.innerHTML = '⚠️ Could not build captions from voice text.';
                return;
            }

            // Convert to caption format with word-level data
            generatedCaptions = chunks.map(c => {
                const words = c.text.split(/\s+/).filter(Boolean);
                const chunkDur = c.timestamp[1] - c.timestamp[0];
                return {
                    text: c.text,
                    timestamp: c.timestamp,
                    words: words.map((w, i) => ({
                        text: w,
                        timestamp: [
                            c.timestamp[0] + (i / words.length) * chunkDur,
                            c.timestamp[0] + ((i + 1) / words.length) * chunkDur
                        ]
                    }))
                };
            });

            const langLabel = {
                'anjali': 'English SC3', 'pattan': 'English Pattan',
                'hindi': 'Hindi', 'telugu': 'Telugu', 'edge': 'Edge TTS'
            }[narVoice] || narVoice;

            statusText.innerHTML = `✅ ${generatedCaptions.length} caption chunks built from ${langLabel} voice text (${narText.length} chars). Edit below if needed.`;

            editorPanel.style.display = 'block';
            editorPanel.classList.remove('hidden');
            actionBtn.classList.add('hidden');
            exportBtn.classList.remove('hidden');
            if (previewBtn) previewBtn.classList.remove('hidden');
            setCaptionExportActionsVisible(false);
            const pBar = document.getElementById('cap2_captionProgressBarValue');
            if (pBar) pBar.style.width = '100%';
            commitCaptionLocalEdits({ timingSource: 'estimated', warnings: ['Voice text uses estimated cue and word timing. Review synchronization.'] });
            populateEditor();
        });
    }

    async function transcribeActiveCaptionVideo() {
        if (captionLocalBusy()) return;
        const transcriptionOptions = getCaptionTranscriptionOptions();
        const outputLanguage = getCaptionOutputLanguage();
        const engineLabel = getCaptionEngineLabel(transcriptionOptions);
        const previousIndex = captionQueueIndex;
        const previousCaptions = generatedCaptions.length ? JSON.parse(JSON.stringify(generatedCaptions)) : null;
        const previousItem = previousCaptions && captionVideoQueue[previousIndex]
            ? { ...captionVideoQueue[previousIndex], captions: JSON.parse(JSON.stringify(previousCaptions)), warnings: [...(captionVideoQueue[previousIndex].warnings || [])] }
            : null;
        let captionsReplaced = false;
        const notifyFallback = createCaptionWhatsAppJob('AI Captioning · fallback transcription');
        let notificationRoute = 'preparation';
        isExtractingText = true;
        publishCaptionLocalState();
        renderCaptionQueue();
        captionTranscriptionCancelRequested = false;
        actionBtn.disabled = false;
        actionBtn.textContent = 'Cancel Transcription';
        actionBtn.classList.remove('hidden');
        if (cancelBtn) cancelBtn.classList.remove('hidden');
        const showSingleProgress = !captionQueueRunning && !captionQueueExporting;
        const updateSingleProgress = (pct, phase, detail) => {
            if (showSingleProgress) renderSingleCaptionProgress(pct, phase, detail);
        };

        // Clear old captions so wrong content never shows
        generatedCaptions = [];
        if (captionVideoQueue[captionQueueIndex]) {
            captionVideoQueue[captionQueueIndex].timingSource = 'estimated';
            captionVideoQueue[captionQueueIndex].warnings = [];
        }
        publishCaptionLocalState();

        const pBar = document.getElementById('cap2_captionProgressBarValue');
        const captionProgress = document.getElementById('cap2_captionProgress');
        if (captionProgress) captionProgress.classList.remove('hidden');
        if (pBar) pBar.style.width = '1%';
        updateSingleProgress(1, 'Preparing captions', (activeFile && activeFile.name) || 'Current video');

        async function finaliseCaptions() {
            generatedCaptions = applyCaptionSpellingCorrections(generatedCaptions, spellingCorrections?.value);
            if (!generatedCaptions.length) {
                if (notificationRoute !== 'native') notifyFallback(captionTranscriptionCancelRequested ? 'cancelled' : 'failed', 'No speech was detected; no captions were generated.');
                autoBurnRequested = false;
                statusText.innerHTML = 'No speech was detected in this video, so there are no captions to burn.';
                actionBtn.textContent = 'Generate Captions';
                actionBtn.classList.remove('hidden');
                exportBtn.classList.add('hidden');
                if (previewBtn) previewBtn.classList.add('hidden');
                setCaptionExportActionsVisible(false);
                hideSingleCaptionProgress();
                return;
            }
            const item = captionVideoQueue[captionQueueIndex];
            const stagedCaptions = generatedCaptions;
            generatedCaptions = previousCaptions || [];
            const output = await prepareCaptionOutput(stagedCaptions, outputLanguage, {
                sourceLanguage: item?.sourceLanguage,
                timingSource: item?.timingSource, warnings: item?.warnings || [],
            });
            generatedCaptions = output.captions;
            applyCaptionOutputMetadata(item, output);
            captionsReplaced = true;
            editorPanel.classList.remove('hidden');
            populateEditor();
            actionBtn.classList.add('hidden');
            exportBtn.classList.remove('hidden');
            if (previewBtn) previewBtn.classList.remove('hidden');
            setCaptionExportActionsVisible(false);
            if (captionVideoQueue[captionQueueIndex]) {
                captionVideoQueue[captionQueueIndex].captions = JSON.parse(JSON.stringify(generatedCaptions));
                captionVideoQueue[captionQueueIndex].status = 'transcribed';
                captionVideoQueue[captionQueueIndex].outputPath = undefined;
                captionVideoQueue[captionQueueIndex].outputFileName = undefined;
                renderCaptionQueue();
            }
            sourceVideo.pause(); sourceVideo.currentTime = 0;
            clearPreviewFrameHandle(); renderPreviewNow(0); updatePlayPauseLabel();
            const sourceName = activeFile && activeFile.name ? activeFile.name : 'video';
            updateSingleProgress(100, 'Captions ready', `${generatedCaptions.length} captions generated`);
            speakCaptionStudio(`Captioning complete. ${sourceName}`);
            notifyCaptionStudio('Captioning complete', sourceName);
            if (notificationRoute === 'fallback') notifyFallback(captionTranscriptionCancelRequested ? 'cancelled' : 'completed', `${generatedCaptions.length} captions ready.`);
            if (autoBurnRequested && isSongCaptionMode()) {
                autoBurnRequested = false;
                statusText.textContent = 'Song captions ready. Review lyrics and timing before Export Video.';
            }
            if (autoBurnRequested) {
                autoBurnRequested = false;
                exportBtn.textContent = 'Burning Karaoke Captions...';
                setTimeout(() => exportBtn.click(), 150);
            }
        }

        function showManualCaptionInput() {
            const existing = document.getElementById('cap2_manualCaptionBox');
            if (existing) existing.remove();
            const dur = sourceVideo ? (sourceVideo.duration || 60) : 60;
            const box = document.createElement('div');
            box.id = 'cap2_manualCaptionBox';
            box.style.margin = '16px 0';
            box.style.padding = '18px';
            box.style.background = 'rgba(20,20,50,0.97)';
            box.style.border = '2px solid rgba(255,200,0,0.6)';
            box.style.borderRadius = '14px';
            const lbl = document.createElement('div');
            lbl.style.cssText = 'font-size:13px;font-weight:800;color:#fde047;margin-bottom:10px';
            lbl.innerHTML = 'No speech found — type captions below (each line = one card):';
            const ta = document.createElement('textarea');
            ta.id = 'cap2_manualCaptionText';
            ta.placeholder = 'Welcome!\nLesson starts here.\nThank you.';
            ta.style.cssText = 'width:100%;min-height:120px;box-sizing:border-box;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:14px;padding:12px;font-family:inherit;resize:vertical;display:block;margin-top:8px';
            const burnBtn = document.createElement('button');
            burnBtn.textContent = 'Burn Captions on Video';
            burnBtn.style.cssText = 'margin-top:10px;padding:11px 24px;border:none;border-radius:10px;background:linear-gradient(135deg,#e53935,#b71c1c);color:#fff;font-size:14px;font-weight:800;cursor:pointer';
                        burnBtn.style.cssText = 'margin-top:10px;padding:11px 24px;border:none;border-radius:10px;background:linear-gradient(135deg,#e53935,#b71c1c);color:#fff;font-size:14px;font-weight:800;cursor:pointer';
                        // Audio file picker button
                        const audioPickBtn = document.createElement('button');
                        audioPickBtn.textContent = 'Pick Narration Audio File & Auto-Caption';
                        audioPickBtn.title = 'Pick a WAV/MP3 narration file — it will be merged into the video and Whisper will transcribe the real voice';
                        audioPickBtn.style.cssText = 'margin-top:10px;padding:11px 22px;border:1px solid rgba(99,179,237,0.7);border-radius:10px;background:rgba(49,130,206,0.25);color:#90cdf4;font-size:13px;font-weight:700;cursor:pointer;display:block';
                        const audioFileInput = document.createElement('input');
                        audioFileInput.type = 'file';
                        audioFileInput.accept = '.wav,.mp3,.ogg,.aac,.m4a';
                        audioFileInput.style.display = 'none';
                        audioPickBtn.onclick = () => audioFileInput.click();
                        audioFileInput.onchange = async () => {
                            const f = audioFileInput.files[0];
                            if (!f) return;
                            const audioPath = window.electronAPI && typeof window.electronAPI.getPathForFile === 'function' ? window.electronAPI.getPathForFile(f) : (f.path || '');
                            if (!audioPath) { alert('Cannot get file path — please use a local file'); return; }
                            if (!videoPath) { alert('Load a video first'); return; }
                            box.remove();
                            statusText.innerHTML = 'Merging narration audio into video...';
                            if (pBar) pBar.style.width = '30%';
                            try {
                                const mergeResult = await window.electronAPI.mergeAudioIntoVideo({ videoPath, audioPath });
                                if (!mergeResult || !mergeResult.ok) throw new Error(mergeResult && mergeResult.error || 'Merge failed');
                                if (pBar) pBar.style.width = '50%';
                                statusText.innerHTML = 'Merged! Transcribing with Whisper...';
                                const ipc2 = await invokeCaptioner2TranscribeVideo({ videoPath: mergeResult.outputPath, ...getCaptionTranscriptionOptions() });
                                if (pBar) pBar.style.width = '100%';
                                if (ipc2 && ipc2.ok && ipc2.text && ipc2.text.trim().length > 3) {
                                    const words2 = Array.isArray(ipc2.words) ? ipc2.words : [];
                                    const segs2 = Array.isArray(ipc2.segments) ? ipc2.segments : [];
                                    if (words2.length > 0) {
                                        generatedCaptions = buildSpeechBoundedCaptionChunks(words2);
                                    } else if (segs2.length > 0) {
                                        generatedCaptions = segs2.map(s => ({ text: s.text.trim(), timestamp: [s.start, s.end], words: [] }));
                                    } else {
                                        generatedCaptions = buildLinearCaptionChunks(ipc2.text, sourceVideo.duration || 60, { narrationDurationSec: sourceVideo.duration || 60 });
                                    }
                                    statusText.innerHTML = generatedCaptions.length + ' captions from narration audio (Whisper)';
                                    captionMetadataFromTranscription(ipc2);
                                    await finaliseCaptions();
                                } else {
                                    statusText.innerHTML = 'Transcription returned no speech — type captions manually';
                                    showManualCaptionInput();
                                }
                            } catch(mergeErr) {
                                mergeErr = await explainCaptionTimingFailure(mergeErr, getCaptionTranscriptionOptions());
                                statusText.innerHTML = 'Error: ' + mergeErr.message;
                                console.error(mergeErr);
                            }
                        };
                        box.appendChild(audioFileInput);
                        box.appendChild(audioPickBtn);
            box.appendChild(lbl); box.appendChild(ta); box.appendChild(burnBtn);
            statusText.parentElement.insertBefore(box, statusText.nextSibling);
            burnBtn.onclick = async () => {
                const rawText = (ta.value || '').trim();
                if (!rawText) { alert('Please type some caption text first.'); return; }
                const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
                const vidDur = sourceVideo ? (sourceVideo.duration || 60) : 60;
                generatedCaptions = lines.map((line, i) => {
                    const start = (i / lines.length) * vidDur;
                    const end = ((i + 1) / lines.length) * vidDur;
                    const wds = line.split(/\s+/);
                    return { text: line, timestamp: [start, end], words: wds.map((w, wi) => ({ text: w, timestamp: [start + (wi/wds.length)*(end-start), start + ((wi+1)/wds.length)*(end-start)] })) };
                });
                box.remove();
                statusText.innerHTML = generatedCaptions.length + ' captions ready';
                const item = captionVideoQueue[captionQueueIndex];
                if (item) item.sourceLanguage = captionTextScriptLanguage(rawText) || 'en';
                try { await finaliseCaptions(); } catch (error) { statusText.textContent = error.message; }
            };
        }

        try {
            // PATH 1: Electron IPC — use the selected caption engine and native audio extraction.
            const hasIpc = window.electronAPI && typeof window.electronAPI.transcribeVideo === 'function';
            const videoPath = activeFile
                ? (activeFile.path || ((window.electronAPI && typeof window.electronAPI.getPathForFile === 'function')
                    ? window.electronAPI.getPathForFile(activeFile)
                    : ''))
                : '';
            if (/\.part\.mp4$/i.test(videoPath)) {
                throw new Error('This is an unfinished .part.mp4 export. Use the original video or a completed MP4, then generate captions again.');
            }

            if (hasIpc && videoPath) {
                const fileLangHint = likelyIndicCaptionFileName(activeFile);
                if (!engineSelect && !isSongCaptionMode() && fileLangHint && window.electronAPI && typeof window.electronAPI.transcribeVideoGroq === 'function') {
                    try {
                        const langName = fileLangHint === 'te' ? 'Telugu' : fileLangHint === 'hi' ? 'Hindi' : 'Auto-Detect';
                        notificationRoute = 'native';
                        const groq = await transcribeVideoWithGroqForIndic(videoPath, fileLangHint || 'auto', langName, updateSingleProgress);
                        captionMetadataFromTranscription(groq);
                        generatedCaptions = buildCaptionChunksFromTranscription(groq, sourceVideo.duration || 60);
                        if (generatedCaptions.length) {
                            if (pBar) pBar.style.width = '100%';
                            updateSingleProgress(100, 'Captions ready', `${generatedCaptions.length} fast Groq captions generated`);
                            statusText.innerHTML = '\u2705 ' + generatedCaptions.length + ` captions generated with Groq API (Fast)`;
                            await finaliseCaptions(); return;
                        }
                        throw new Error('Groq API returned no usable speech captions.');
                    } catch (groqFirstErr) {
                        if (groqFirstErr.captionTranslationFailure || groqFirstErr.captionTimingFailure || captionTranscriptionCancelRequested) throw groqFirstErr;
                        const groqMessage = groqFirstErr && groqFirstErr.message
                            ? groqFirstErr.message
                            : String(groqFirstErr || 'Groq API is unavailable.');
                        console.warn('[Caption] Groq transcription stopped:', groqFirstErr);
                        statusText.innerHTML = `&#9888; Caution: Groq API (Fast) could not generate captions. ${groqMessage}`;
                        updateSingleProgress(0, 'Caption generation stopped', groqMessage);
                        throw new Error(`Caution: Groq API (Fast) is required. ${groqMessage}`);
                    }
                } else if (!engineSelect && !isSongCaptionMode() && fileLangHint) {
                    statusText.innerHTML = '&#9888; Caution: Groq API (Fast) is unavailable. Caption generation was stopped.';
                    updateSingleProgress(0, 'Caption generation stopped', 'Groq API is unavailable.');
                    throw new Error('Caution: Groq API (Fast) is unavailable.');
                }

                statusText.textContent = `Analysing video audio with ${engineLabel}...`;
                if (pBar) pBar.style.width = '8%';
                updateSingleProgress(8, 'Preparing audio', 'Checking video and audio stream...');
                let ipcShownPct = 8;
                const ipcStartedAt = Date.now();
                const ipcHeartbeat = setInterval(() => {
                    if (!isExtractingText) return;
                    ipcShownPct = Math.min(95, ipcShownPct + (ipcShownPct < 20 ? 2 : ipcShownPct < 45 ? 4 : ipcShownPct < 75 ? 2 : 0.15));
                    const elapsedMinutes = Math.max(0, (Date.now() - ipcStartedAt) / 60000);
                    if (pBar) pBar.style.width = ipcShownPct + '%';
                    statusText.textContent = `${engineLabel} is actively transcribing (${elapsedMinutes.toFixed(1)} minutes elapsed). The percentage is estimated; click Cancel Transcription to stop safely.`;
                    updateSingleProgress(ipcShownPct, ipcShownPct < 20 ? 'Preparing audio' : 'Transcribing captions', `${engineLabel} — ${elapsedMinutes.toFixed(1)} min elapsed (estimated progress)`);
                }, 900);
                let ipc = null;
                try {
                    activeCaptionTranscription = { videoPath, languageHint: 'auto', ...transcriptionOptions };
                    notificationRoute = 'native';
                    ipc = await invokeCaptioner2TranscribeVideo(activeCaptionTranscription);
                    if ((!ipc || !ipc.ok)
                        && !ipc?.cancelled
                        && !captionTranscriptionCancelRequested
                        && transcriptionOptions?.engine === 'groq'
                        && !['CAPTION_RESOURCE_BUSY', 'CAPTION_TRANSCRIPTION_BUSY'].includes(ipc?.code)) {
                        console.warn('[Captioner 2] Groq transcription failed, falling back to Local Whisper:', ipc?.error);
                        statusText.textContent = 'Groq timing uncertain — switching automatically to Local Whisper...';
                        updateSingleProgress(25, 'Switching to Local Whisper', 'Groq could not verify word timing; running Local Whisper...');
                        activeCaptionTranscription = { videoPath, languageHint: 'auto', ...transcriptionOptions, engine: 'local', captionerVersion: 2 };
                        ipc = await invokeCaptioner2TranscribeVideo(activeCaptionTranscription);
                    }
                } finally {
                    clearInterval(ipcHeartbeat);
                    activeCaptionTranscription = null;
                }

                if ((ipc && ipc.cancelled) || captionTranscriptionCancelRequested) {
                    statusText.innerHTML = 'Transcription cancelled. The video is still loaded and ready to restart.';
                    updateSingleProgress(0, 'Cancelled', 'No caption export was started');
                    if (captionVideoQueue[captionQueueIndex]) {
                        captionVideoQueue[captionQueueIndex].status = 'ready';
                        captionVideoQueue[captionQueueIndex].progress = 0;
                        renderCaptionQueue();
                    }
                    return;
                }

                if (['CAPTION_RESOURCE_BUSY', 'CAPTION_TRANSCRIPTION_BUSY'].includes(ipc?.code)) {
                    throw new Error(ipc.error || 'Wait for the active job to finish before generating captions.');
                }

                if (ipc && ipc.ok) {
                    captionMetadataFromTranscription(ipc);
                    if (isSongCaptionMode() && !ipc.words?.length) throw new Error('No timed lyrics detected. Clearer vocals are needed for synchronized song captions.');
                    if (pBar) pBar.style.width = '100%';
                    updateSingleProgress(100, 'Captions ready', 'Transcription finished');

                    // No speech/audio detected in this video
                    if (!String(ipc.text || '').trim() && !ipc.words?.length && !ipc.segments?.length) {
                        statusText.innerHTML = 'No speech detected in this video audio. Upload a video with speech to auto-burn synced karaoke captions.';
                        autoBurnRequested = false;
                        actionBtn.textContent = 'Generate Captions';
                        hideSingleCaptionProgress();
                        return;
                    }

                    const localLangCode = normalizeCaptionLanguageCode(ipc.language) || inferCaptionLanguageCode(ipc.text);
                    if (!engineSelect && !isSongCaptionMode() && isIndicCaptionLanguage(localLangCode) && window.electronAPI && typeof window.electronAPI.transcribeVideoGroq === 'function') {
                        try {
                            const langName = localLangCode === 'te' ? 'Telugu' : localLangCode === 'hi' ? 'Hindi' : 'Indic';
                            statusText.innerHTML = `Local Whisper detected ${langName}; switching to high-accuracy captions...`;
                            const groq = await transcribeVideoWithGroqForIndic(videoPath, localLangCode, langName, updateSingleProgress);
                            captionMetadataFromTranscription(groq);
                            generatedCaptions = buildCaptionChunksFromTranscription(groq, sourceVideo.duration || 60);
                            if (generatedCaptions.length) {
                                statusText.innerHTML = '\u2705 ' + generatedCaptions.length + ` ${langName} captions from high-accuracy Whisper`;
                                await finaliseCaptions(); return;
                            }
                        } catch (groqErr) {
                            if (groqErr.captionTranslationFailure || groqErr.captionTimingFailure || captionTranscriptionCancelRequested) throw groqErr;
                            console.warn('[Caption] High-accuracy Indic retry failed, using local result:', groqErr);
                        }
                    }

                    // Real speech found
                    generatedCaptions = buildCaptionChunksFromTranscription(ipc, sourceVideo.duration || 60);
                    statusText.textContent = `${generatedCaptions.length} captions from video audio (${engineLabel})`;
                    await finaliseCaptions(); return;
                }
                // The native route owns any same-engine recovery. Retrying via
                // the old browser path can replace reviewed words with a weaker
                // transcript and bypass timing validation or cancellation.
                throw new Error(ipc?.error || `${engineLabel} could not generate captions. Review the error and retry.`);
            }

            // PATH 2: HTTP transcription server (port 8428)
            if (transcriptionOptions.engine !== 'local') {
                throw new Error(`${engineLabel} captioning requires the desktop app and an accessible video file.`);
            }
            if (isSongCaptionMode()) throw new Error('Song transcription failed. Check the selected song engine and retry.');
            notificationRoute = 'fallback';
            statusText.innerHTML = 'Extracting audio from video...';
            if (pBar) pBar.style.width = '8%';
            updateSingleProgress(8, 'Extracting audio', 'Preparing audio from video...');
            audioDataArray = await extractAudio(activeFile);
            if (pBar) pBar.style.width = '20%';
            updateSingleProgress(20, 'Transcribing captions', 'Sending audio to caption engine...');
            try {
                statusText.innerHTML = 'Sending to Whisper server (port 8428)...';
                const svr = await transcribeWithLocalServer(audioDataArray);
                if (pBar) pBar.style.width = '100%';
                updateSingleProgress(100, 'Captions ready', 'Caption engine finished');
                if (svr && svr.chunks && svr.chunks.length > 0) {
                    captionMetadataFromTranscription(svr);
                    generatedCaptions = svr.chunks;
                    statusText.innerHTML = generatedCaptions.length + ' captions from video audio';
                    await finaliseCaptions(); return;
                }
            } catch (svrErr) {
                if (svrErr.captionTranslationFailure || svrErr.captionTimingFailure || captionTranscriptionCancelRequested) throw svrErr;
                console.warn('[Caption] HTTP server failed:', svrErr.message);
                statusText.innerHTML = 'Server unavailable - using browser AI...';
            }

            // PATH 3: Browser Whisper worker (offline fallback)
            if (!captionWorker) {
                statusText.innerHTML = 'Initializing browser AI engine...';
                const ws = `let p,e,t=null;function s(d){if(!d)return null;try{return JSON.parse(JSON.stringify(d));}catch(x){return{status:d.status,text:d.text||'',timestamp:d.timestamp||null};}}self.onmessage=async(ev)=>{if(ev.data.type==='init'){try{if(!p){const m=await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.16.1');p=m.pipeline;e=m.env;e.allowLocalModels=true;e.allowRemoteModels=false;e.localModelPath=ev.data.modelPath||'http://127.0.0.1:5173/AI_Models/';e.useBrowserCache=true;}if(!t){t=await p('automatic-speech-recognition','Xenova/whisper-tiny.en',{quantized:true,progress_callback:d=>self.postMessage({type:'progress',data:s(d)})});}self.postMessage({type:'init_done'});}catch(er){self.postMessage({type:'error',error:er.message});}}else if(ev.data.type==='transcribe'){try{const r=await t(ev.data.audioDataArray,{...ev.data.options,chunk_callback:c=>self.postMessage({type:'chunk_progress',chunk:s(c),duration:ev.data.duration})});self.postMessage({type:'result',result:s(r)});}catch(er){self.postMessage({type:'error',error:er.message});}}};`;
                const blob = new Blob([ws], { type: 'application/javascript' });
                captionWorker = new Worker(URL.createObjectURL(blob));
                await new Promise((res, rej) => {
                    captionWorker.onerror = ev => rej(new Error('Worker: ' + (ev.message || 'fail')));
                    captionWorker.onmessage = ev => {
                        if (ev.data.type === 'init_done') res();
                        else if (ev.data.type === 'progress' && ev.data.data && ev.data.data.status === 'downloading') {
                            const pct = Math.round(ev.data.data.progress || 0);
                            statusText.innerHTML = 'Downloading AI model: ' + pct + '%';
                            if (pBar) pBar.style.width = (15 + pct * 0.15) + '%';
                            updateSingleProgress(15 + pct * 0.15, 'Generating captions', 'Downloading browser AI model...');
                        } else if (ev.data.type === 'error') rej(new Error(ev.data.error || 'init failed'));
                    };
                    captionWorker.postMessage({ type: 'init', modelPath: window.location.origin + '/AI_Models/' });
                });
            }
            if (pBar) pBar.style.width = '30%';
            updateSingleProgress(30, 'Generating captions', 'Browser AI is transcribing audio...');
            const opts = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: 'word' };
            const workerResult = await new Promise((res, rej) => {
                captionWorker.onerror = ev => rej(new Error('Worker crash: ' + (ev.message || 'unknown')));
                captionWorker.onmessage = ev => {
                    if (ev.data.type === 'chunk_progress' && ev.data.chunk && ev.data.chunk.timestamp && ev.data.chunk.timestamp[1] !== null) {
                        const pct = Math.min(Math.round((ev.data.chunk.timestamp[1] / (ev.data.duration || 60)) * 100), 100);
                        statusText.innerHTML = 'Transcribing... ' + pct + '% complete - ' + Math.max(0, 100 - pct) + '% remaining';
                        if (pBar) pBar.style.width = pct + '%';
                        updateSingleProgress(pct, 'Generating captions', 'Transcribing video audio...');
                    } else if (ev.data.type === 'result') { if (pBar) pBar.style.width = '100%'; res(ev.data.result); }
                    else if (ev.data.type === 'error') rej(new Error(ev.data.error || 'failed'));
                };
                captionWorker.postMessage({ type: 'transcribe', audioDataArray: audioDataArray.buffer, options: opts, duration: sourceVideo.duration || 60 });
            });
            generatedCaptions = buildSpeechBoundedCaptionChunks(
                (workerResult.chunks || []).map((chunk) => {
                    const stamp = Array.isArray(chunk.timestamp) ? chunk.timestamp : [0, 0];
                    const start = stamp[0] == null ? 0 : Number(stamp[0]);
                    const end = stamp[1] == null ? start + 0.5 : Number(stamp[1]);
                    return {
                        text: String(chunk.text || '').replace(/\[.*?\]|\(.*?\)|♪|♫/g, '').trim(),
                        start,
                        end
                    };
                })
            );
            captionMetadataFromTranscription({ words: workerResult.chunks || [], timingSource: 'word', language: 'en' });
            if (generatedCaptions.length === 0 && workerResult.text) {
                const dur = sourceVideo.duration || 60;
                generatedCaptions = buildLinearCaptionChunks(workerResult.text.replace(/\[.*?\]|\(.*?\)|♪|♫/g,'').trim(), dur, { narrationDurationSec: dur });
                captionMetadataFromTranscription({ timingSource: 'estimated', language: 'en' });
            }
            if (!generatedCaptions.length) {
                statusText.innerHTML = 'No speech detected in this video audio. Upload a video with speech to auto-burn synced karaoke captions.';
                notifyFallback(captionTranscriptionCancelRequested ? 'cancelled' : 'failed', 'No speech was detected; no captions were generated.');
                autoBurnRequested = false;
                actionBtn.textContent = 'Generate Captions';
                hideSingleCaptionProgress();
                return;
            }
            statusText.innerHTML = generatedCaptions.length + ' captions from video audio';
            await finaliseCaptions();

        } catch (error) {
            error = await explainCaptionTimingFailure(error, transcriptionOptions);
            statusText.innerHTML = 'Error: ' + (error.message || 'Unknown error');
            if (notificationRoute !== 'native' && !captionTranscriptionCancelRequested) notifyFallback('failed', error);
            console.error('[Caption]', error);
            if (captionVideoQueue[captionQueueIndex]) {
                captionVideoQueue[captionQueueIndex].status = 'failed';
                renderCaptionQueue();
            }
        } finally {
            if (!captionsReplaced && !previousCaptions) generatedCaptions = [];
            if (!captionsReplaced && previousCaptions && captionQueueIndex === previousIndex) {
                generatedCaptions = previousCaptions;
                if (previousItem) captionVideoQueue[previousIndex] = previousItem;
                editorPanel.classList.remove('hidden');
                editorPanel.style.display = 'block';
                populateEditor();
                actionBtn.classList.add('hidden');
                exportBtn.classList.remove('hidden');
                if (previewBtn) previewBtn.classList.remove('hidden');
                renderPreviewNow(sourceVideo.currentTime || 0);
            }
            isExtractingText = false;
            // Queue buttons were rebuilt while transcription was busy. Rebuild
            // them again after unlocking so videos remain selectable on cancel.
            renderCaptionQueue();
            activeCaptionTranscription = null;
            const wasCancelled = captionTranscriptionCancelRequested;
            if (wasCancelled) notifyFallback('cancelled');
            captionTranscriptionCancelRequested = false;
            if (cancelBtn) {
                cancelBtn.classList.add('hidden');
                cancelBtn.disabled = false;
                cancelBtn.textContent = 'Stop Transcription';
            }
            if (!captionQueueRunning && !captionQueueExporting) {
                actionBtn.disabled = false;
                if (!generatedCaptions.length) {
                    actionBtn.textContent = captionVideoQueue.length > 1 ? 'Generate Queue' : 'Generate Captions';
                    actionBtn.classList.remove('hidden');
                }
                if (!wasCancelled && autoContinueQueueAfterSingleJob) {
                    autoContinueQueueAfterSingleJob = false;
                    const nextReadyIdx = captionVideoQueue.findIndex((item, idx) =>
                        item && idx !== previousIndex && item.status === 'ready' && !(item.captions && item.captions.length)
                    );
                    if (nextReadyIdx >= 0) {
                        setTimeout(() => transcribeCaptionQueueFrom(nextReadyIdx), 60);
                    }
                }
            }
        }
    }

    actionBtn.addEventListener('click', async () => {
        if (isErasingCaptions) return;
        if (isExtractingText || captionTranslationBusy) {
            if (captionTranscriptionCancelRequested) return;
            captionTranscriptionCancelRequested = true;
            actionBtn.disabled = true;
            actionBtn.textContent = 'Cancelling...';
            statusText.textContent = captionTranslationBusy ? 'Cancelling translation…' : `Cancelling the active ${getCaptionEngineLabel()} job...`;
            captionTranslationController?.abort(new Error('Caption translation cancelled.'));
            if (activeCaptionTranscription && window.electronAPI && typeof window.electronAPI.cancelTranscribeVideo === 'function') {
                try {
                    await window.electronAPI.cancelTranscribeVideo({ ...activeCaptionTranscription, captionerVersion: 2, waitForRelease: true });
                } catch (error) {
                    console.error('[Caption] Cancel failed:', error);
                }
            }
            return;
        }
        if (captionQueueRunning || captionQueueExporting) return;
        if (captionVideoQueue.length > 1) await transcribeCaptionQueueFrom(captionQueueIndex);
        else await transcribeActiveCaptionVideo();
    });

    if (cancelBtn) cancelBtn.addEventListener('click', async () => {
        if ((!isExtractingText && !activeCaptionTranscription && !captionTranslationBusy) || captionTranscriptionCancelRequested) return;
        captionTranscriptionCancelRequested = true;
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Stopping...';
        actionBtn.disabled = true;
        actionBtn.textContent = 'Stopping...';
        statusText.textContent = captionTranslationBusy ? 'Stopping translation safely…' : 'Stopping the active transcription safely…';
        captionTranslationController?.abort(new Error('Caption translation cancelled.'));
        if (activeCaptionTranscription && window.electronAPI && typeof window.electronAPI.cancelTranscribeVideo === 'function') {
            try { await window.electronAPI.cancelTranscribeVideo({ ...(activeCaptionTranscription || {}), captionerVersion: 2, waitForRelease: true }); }
            catch (error) { console.error('[Caption] Cancel failed:', error); }
        }
    });


        function getVisibleCaptionText(fullText, activeWordIndex, maxWords = CAPTION_WORD_LIMIT) {
            const words = String(fullText || '').trim().split(/\s+/).filter(Boolean);
            if (!Number.isInteger(activeWordIndex) || activeWordIndex < 0) return '';
            const start = Math.floor(activeWordIndex / maxWords) * maxWords;
            return words.slice(start, start + maxWords).join(' ');
        }

        function getCaptionWordTimeline(caption) {
            const tokens = String(caption.text || '').trim().split(/\s+/).filter(Boolean);
            const [start, end] = caption.timestamp.map(Number);
            const complete = caption.words?.length === tokens.length && caption.words.every(word =>
                Array.isArray(word.timestamp) && Number.isFinite(Number(word.timestamp[0]))
                && Number.isFinite(Number(word.timestamp[1])) && Number(word.timestamp[1]) > Number(word.timestamp[0]));
            return tokens.map((text, index) => ({
                text,
                start: complete ? Math.max(start, Number(caption.words[index].timestamp[0])) : start + index / tokens.length * (end - start),
                end: complete ? Math.min(end, Number(caption.words[index].timestamp[1])) : start + (index + 1) / tokens.length * (end - start),
            }));
        }

        function getCaptionWordEnd(words, index, captionEnd) {
            const word = words[index];
            const next = words[index + 1];
            return Math.min(captionEnd, next && next.start - word.end < 0.3 ? next.start : word.end);
        }

        function getCaptionActiveWordIndex(caption, time) {
            const words = getCaptionWordTimeline(caption);
            for (let index = words.length - 1; index >= 0; index -= 1) {
                if (time >= words[index].start && time < getCaptionWordEnd(words, index, Number(caption.timestamp[1]))) return index;
            }
            return -1;
        }

        function getCaptionEmojiBitmap(emoji, fontSize) {
            const key = `${emoji}_${fontSize}`;
            if (captionEmojiCache.has(key)) return captionEmojiCache.get(key);
            const bitmap = document.createElement('canvas');
            bitmap.width = bitmap.height = Math.ceil(fontSize * 3);
            const ctx = bitmap.getContext('2d');
            if (!ctx) throw new Error('Could not render the color caption emoji.');
            ctx.font = `900 ${fontSize * 1.5}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(emoji, bitmap.width / 2, bitmap.height / 2);
            if (captionEmojiCache.size >= 64) captionEmojiCache.delete(captionEmojiCache.keys().next().value);
            captionEmojiCache.set(key, bitmap);
            return bitmap;
        }

        function addCaptionEmojiOverlay(overlays, emoji, fontSize, event) {
            let sprite = overlays.find(item => item.emoji === emoji);
            if (!sprite) {
                const bitmap = getCaptionEmojiBitmap(emoji, fontSize);
                sprite = { emoji, pngDataUrl: bitmap.toDataURL('image/png'), events: [] };
                overlays.push(sprite);
            }
            const previous = sprite.events[sprite.events.length - 1];
            if (previous && Math.abs(previous.end - event.start) < .0001
                && previous.x === event.x && previous.y === event.y
                && previous.offsetY === event.offsetY && previous.bounceStart === event.bounceStart) {
                previous.end = event.end;
            } else {
                sprite.events.push(event);
            }
        }

        function getWrappedCaptionLines(ctx, text, maxWidth) {
            const safeText = String(text || '').trim();
            if (!safeText) return [];
            if (!window._textWrapCache) window._textWrapCache = {};
            const fontStr = ctx.font;
            const cacheKey = `${safeText}_${maxWidth}_${fontStr}`;
            if (window._textWrapCache[cacheKey]) return window._textWrapCache[cacheKey];
            const words = safeText.split(/\s+/);
            const lines = [];
            let line = '';
            for (let n = 0; n < words.length; n += 1) {
                const testLine = line ? line + ' ' + words[n] : words[n];
                if (ctx.measureText(testLine).width > maxWidth && n > 0) {
                    lines.push(line);
                    line = words[n];
                } else {
                    line = testLine;
                }
            }
            if (line.trim()) lines.push(line);
            window._textWrapCache[cacheKey] = lines;
            return lines;
        }

        function getCaptionBottomSafety(fontSize, lineHeight, lineCount = 1) {
            return CAPTION_BOTTOM_OFFSET_PX;
        }

        function getBottomAnchoredCaptionCenterY(targetHeight, fontSize, lineHeight, lineCount) {
            const blockHeight = Math.max(lineHeight, lineCount * lineHeight);
            return Math.max(blockHeight / 2, targetHeight - getCaptionBottomSafety(fontSize, lineHeight, lineCount) - blockHeight / 2);
        }

        function drawWrappedText(ctx, fullText, x, y, maxWidth, lineHeight, elapsedTime, styleType, activeWordIndex = -1, targetEmoji = null, fontSize = 50, colorOverride = null, isKaraoke = true) {
        let text = fullText;

        if (styleType === 'white-yellow' && activeWordIndex === -1) return;
        text = getVisibleCaptionText(fullText, activeWordIndex, CAPTION_WORD_LIMIT);
        activeWordIndex = activeWordIndex < 0 ? -1 : activeWordIndex % CAPTION_WORD_LIMIT;

        let lines = getWrappedCaptionLines(ctx, text, maxWidth);

        ctx.save();
        ctx.translate(x, y);

        const globalColor = colorOverride || (colorPicker ? colorPicker.value : '#fde047');
        const strokeScale = strokeSlider ? parseInt(strokeSlider.value) / 100 : 0.8;
        const baseStrokeWidth = styleType === 'white-yellow'
            ? Math.max(2, Math.round(fontSize * 0.09))
            : Math.max(0, Math.floor(lineHeight * 0.15 * strokeScale));
        const shouldStroke = baseStrokeWidth > 0 && styleType !== 'glitch' && styleType !== 'retro';

        let currentY = -(lines.length * lineHeight) / 2 + lineHeight / 2;
        
        // Draw floating Emoji Reaction on top of caption block if requested
        if (targetEmoji) {
            ctx.save();
            // Pop bounce animation based on time
            const emojiScale = elapsedTime < 0.2 ? 0.5 + (Math.sin(elapsedTime / 0.2 * Math.PI / 2) * 0.7) : 1.2;
            ctx.scale(emojiScale, emojiScale);
            const bitmap = getCaptionEmojiBitmap(targetEmoji, fontSize);
            ctx.drawImage(bitmap, -bitmap.width / 2, -(lines.length * lineHeight) / 2 - Math.max(30, fontSize) - bitmap.height / 2);
            ctx.restore();
        }

        const renderLine = (txt, yPos, wordCursorStart, drawShadowFx) => {
            if (!isKaraoke || activeWordIndex === -1 || styleType === 'typewriter' || styleType === 'glitch') {
                if (drawShadowFx) drawShadowFx();
                if (shouldStroke) ctx.strokeText(txt, 0, yPos);
                ctx.fillText(txt, 0, yPos);
                return txt.trim().split(/\s+/).length;
            } else {
                if (!window._wordWidthCache) window._wordWidthCache = {};
                const fontKey = ctx.font;
                const getW = (textFrag) => {
                     const key = textFrag + "_" + fontKey;
                     if (!window._wordWidthCache[key]) window._wordWidthCache[key] = ctx.measureText(textFrag).width;
                     return window._wordWidthCache[key];
                };

                if (drawShadowFx) drawShadowFx(); // Compute massive canvas shader setup ONCE outside word loops!
                const wds = txt.trim().split(/\s+/);
                const measuredLine = wds.join(' ');
                let cx = -getW(measuredLine) / 2;
                const spaceW = getW(' ');

                for(let w = 0; w < wds.length; w++) {
                    const bw = getW(wds[w]);
                    // Keep the complete group visible; only the spoken word is highlighted.
                    const isFocus = (wordCursorStart + w === activeWordIndex);
                    const ogAlpha = ctx.globalAlpha;
                    const ogFill = ctx.fillStyle;
                    
                    if (!isFocus) {
                        if (styleType === 'white-yellow') {
                            ctx.globalAlpha = ogAlpha;
                            ctx.fillStyle = '#ffffff';
                        } else {
                            ctx.globalAlpha = ogAlpha * 0.3;
                            ctx.fillStyle = '#ffffff';
                        }
                    } else {
                        if (styleType === 'white-yellow') {
                            ctx.fillStyle = '#fde047';
                        }
                    }
                    
                    if (shouldStroke) {
                        ctx.strokeStyle = '#101820';
                        ctx.strokeText(wds[w], cx + bw/2, yPos);
                    }
                    ctx.fillText(wds[w], cx + bw/2, yPos);
                    
                    if (!isFocus || styleType === 'white-yellow') { ctx.globalAlpha = ogAlpha; ctx.fillStyle = ogFill; }
                    cx += bw + spaceW;
                }
                return wds.length;
            }
        };

        let wordCursor = 0;

        if (styleType === 'tiktok' || styleType === 'white-yellow') {
            let scale = 1.0;
            if (styleType !== 'white-yellow') {
                if (elapsedTime < 0.15) scale = 0.5 + (Math.sin((elapsedTime / 0.15) * Math.PI / 2) * 0.6); 
                else if (elapsedTime < 0.25) scale = 1.1 - ((elapsedTime - 0.15) / 0.1) * 0.1;
            }
            ctx.scale(scale, scale);
            
        ctx.lineWidth = baseStrokeWidth * 1.5; ctx.lineJoin = 'round';
            ctx.strokeStyle = '#101820'; ctx.fillStyle = (styleType === 'white-yellow') ? (isKaraoke ? '#fde047' : '#ffffff') : globalColor;
            
            for(let i = 0; i < lines.length; i++) {
                wordCursor += renderLine(lines[i].trim(), currentY, wordCursor, () => {
                    if (styleType === 'white-yellow') {
                        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
                    } else {
                        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 10; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 4;
                    }
                });
                currentY += lineHeight;
            }
        } 
        else if (styleType === 'classic') {
            ctx.fillStyle = 'rgba(0,0,0,0.8)';
            let maxLineWidth = 0;
            lines.forEach(l => { const w = ctx.measureText(l).width; if(w > maxLineWidth) maxLineWidth = w; });
            ctx.fillRect( -maxLineWidth/2 - 20, -(lines.length * lineHeight)/2 - 10, maxLineWidth + 40, lines.length * lineHeight + 20);
            
            ctx.fillStyle = globalColor;
            for(let i = 0; i < lines.length; i++) {
                wordCursor += renderLine(lines[i].trim(), currentY, wordCursor, () => { ctx.shadowColor='transparent'; });
                currentY += lineHeight;
            }
        }
        else if (styleType === 'cinematic') {
            if (elapsedTime < 0.4) ctx.globalAlpha = elapsedTime / 0.4;
            else ctx.globalAlpha = 1.0;
            
            ctx.fillStyle = globalColor;
            for(let i = 0; i < lines.length; i++) {
                wordCursor += renderLine(lines[i].trim(), currentY, wordCursor, () => {
                     ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 15; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
                });
                currentY += lineHeight;
            }
        }
        else if (styleType === 'neon') {
            if (elapsedTime < 0.1) ctx.globalAlpha = elapsedTime / 0.1;
            ctx.fillStyle = '#ffffff';
            for(let i = 0; i < lines.length; i++) {
                if (activeWordIndex === -1) {
                    ctx.shadowColor = globalColor; ctx.shadowBlur = 25;
                    ctx.fillText(lines[i].trim(), 0, currentY); ctx.fillText(lines[i].trim(), 0, currentY);
                } else {
                    wordCursor += renderLine(lines[i].trim(), currentY, wordCursor, () => {
                        ctx.shadowColor = globalColor; ctx.shadowBlur = 25;
                    });
                }
                currentY += lineHeight;
            }
        }
        else if (styleType === 'glitch') {
            ctx.lineWidth = baseStrokeWidth; ctx.lineJoin = 'round'; ctx.strokeStyle = '#000000';
            
            let xr = 0, yr = 0, xb = 0, yb = 0;
            if (elapsedTime < 0.3 || Math.random() > 0.95) {
                xr = (Math.random() - 0.5) * 15; yr = (Math.random() - 0.5) * 15;
                xb = (Math.random() - 0.5) * 15; yb = (Math.random() - 0.5) * 15;
            }
            
            for(let i = 0; i < lines.length; i++) {
                const txt = lines[i].trim();
                ctx.fillStyle = '#ff003c'; ctx.fillText(txt, xr, currentY + yr);
                ctx.fillStyle = '#00f0ff'; ctx.fillText(txt, xb, currentY + yb);
                
                ctx.fillStyle = globalColor;
                if(baseStrokeWidth > 0) ctx.strokeText(txt, 0, currentY);
                ctx.fillText(txt, 0, currentY);
                currentY += lineHeight;
            }
        }
        else if (styleType === 'vaporwave') {
            ctx.lineWidth = baseStrokeWidth; ctx.lineJoin = 'round'; ctx.strokeStyle = '#2b00ff';
            ctx.fillStyle = globalColor;
            
            const tilt = Math.sin(elapsedTime * 2) * 0.05;
            ctx.rotate(tilt);
            
            for(let i = 0; i < lines.length; i++) {
                wordCursor += renderLine(lines[i].trim(), currentY, wordCursor, () => {
                   ctx.shadowColor = '#ff00c8'; ctx.shadowBlur = 15; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 4; 
                });
                currentY += lineHeight;
            }
        }
        else if (styleType === 'retro') {
            const floatY = Math.floor(Math.sin(elapsedTime * 6)) * 8;
            ctx.translate(0, floatY);
            ctx.lineWidth = baseStrokeWidth; ctx.lineJoin = 'miter'; ctx.miterLimit = 2;
            ctx.strokeStyle = '#000'; ctx.fillStyle = globalColor;
            
            for(let i = 0; i < lines.length; i++) {
                if(baseStrokeWidth > 0) {
                    ctx.shadowColor = 'rgba(0,0,0,1)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 6; ctx.shadowOffsetY = 6;
                    ctx.strokeText(lines[i].trim(), 0, currentY);
                    ctx.shadowColor = 'transparent';
                }
                wordCursor += renderLine(lines[i].trim(), currentY, wordCursor, () => {
                    ctx.shadowColor = 'rgba(0,0,0,1)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 5;
                });
                currentY += lineHeight;
            }
        }
        else if (styleType === 'typewriter') {
            ctx.fillStyle = 'rgba(0,0,0,0.85)';
            // Box width must comfortably fit the largest cached line statically!
            let maxLineWidth = 0;
            lines.forEach(l => { const w = ctx.measureText(l.trim()).width; if(w > maxLineWidth) maxLineWidth = w; });
            maxLineWidth = Math.min(maxLineWidth, maxWidth);
            ctx.fillRect( -maxLineWidth/2 - 20, -(lines.length * lineHeight)/2 - 10, maxLineWidth + 40, lines.length * lineHeight + 20);
            
            ctx.fillStyle = globalColor;
            let charsAllowed = Math.floor(elapsedTime * 25);
            
            for(let i = 0; i < lines.length; i++) {
                let txt = lines[i].trim();
                let txtToDraw = txt;
                if (charsAllowed <= 0) break;
                if (charsAllowed < txt.length) txtToDraw = txt.slice(0, charsAllowed);
                
                ctx.fillText(txtToDraw, 0, currentY);
                charsAllowed -= txt.length + 1; // Accommodate the implicitly consumed line-wrap space
                currentY += lineHeight;
            }
        }

        ctx.restore();
    }

    function renderCaptionFrame(ctx, targetWidth, targetHeight, time, options = {}) {
      const isPreviewSurface = options.isPreviewSurface !== false;
      if (!ctx) return;
      if (!ctx.imageSmoothingEnabled) ctx.imageSmoothingEnabled = true;

      try {
        const filter = filterSelect ? filterSelect.value : 'none';
        let targetFilter = 'none';
        if (filter === 'darken') targetFilter = 'brightness(50%)';
        else if (filter === 'blur') targetFilter = 'blur(10px)';
        else if (filter === 'grayscale') targetFilter = 'grayscale(100%)';
        else if (filter === 'sepia') targetFilter = 'sepia(100%)';
        else if (filter === 'invert') targetFilter = 'invert(100%) hue-rotate(180deg)';

        if (ctx.filter !== targetFilter) ctx.filter = targetFilter;

        if (sourceVideo.readyState >= 2) { // HAVE_CURRENT_DATA
            try {
                ctx.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);
            } catch(ev) {}
        }
        
        if (ctx.filter !== 'none') ctx.filter = 'none';
        
        const offset = syncSlider ? parseInt(syncSlider.value) / 1000 : 0;
        const adjustedTime = time - offset;
        
        // Use backward array search to guarantee that if two chunks overlap due to trailing silence or gap optimizations,
        // the newly started sequential chunk immediately claims the screen render, preventing display masks!
        let currentChunk = null;
        for (let i = generatedCaptions.length - 1; i >= 0; i--) {
            if (adjustedTime >= generatedCaptions[i].timestamp[0] && adjustedTime < generatedCaptions[i].timestamp[1]
                && captionHasSpeechAtTime(generatedCaptions[i], adjustedTime)) {
                currentChunk = generatedCaptions[i];
                break;
            }
        }
        
        if (currentChunk && currentChunk.text) {
             let useMusic = bgMusicAudio && !bgMusicAudio.paused;
             if (bgMusicCheck && !bgMusicCheck.checked) useMusic = false;
             if (useMusic) bgMusicAudio.volume = 0.1; // Ducking active
             
             const brollImage = getBrollForText(currentChunk.text);
             if (brollImage && brollImage.complete && brollImage.width > 0 && brollImage.height > 0) {
                 ctx.save();
                 ctx.globalAlpha = 0.8;
                 const wr = targetWidth / brollImage.width; const hr = targetHeight / brollImage.height;
                 const scale = Math.max(wr, hr);
                 const ix = (targetWidth / 2) - (brollImage.width / 2) * scale;
                 const iy = (targetHeight / 2) - (brollImage.height / 2) * scale;
                 if (isImageReady(brollImage)) { ctx.drawImage(brollImage, ix, iy, brollImage.width * scale, brollImage.height * scale); }
                 ctx.restore();
             }

            // Use full-video coordinates while retaining the original preview size.
            ctx.save();
            ctx.scale(targetWidth / (sourceVideo.videoWidth || targetWidth), targetHeight / (sourceVideo.videoHeight || targetHeight));
            const captionWidth = sourceVideo.videoWidth || targetWidth;
            const captionHeight = sourceVideo.videoHeight || targetHeight;
            const fontSize = getCaptionSourceFontSize(captionWidth, captionHeight);
            
            const gapMult = (gapSlider ? parseInt(gapSlider.value) : 120) / 100;
            const heightMult = (heightSlider ? parseInt(heightSlider.value) : 100) / 100;
            const lineHeight = fontSize * gapMult * heightMult;

            const maxWBase = captionWidth;
            const widthMult = (widthSlider ? parseInt(widthSlider.value) : 85) / 100;
            const maxWidth = maxWBase * widthMult;
            
             let activeWordIndex = -1;
             const isKaraoke = karaokeCheck && karaokeCheck.checked;
             // Word timing controls visibility for every style, not only karaoke.
             if (currentChunk.text.trim()) {
                  const rawWords = currentChunk.text.trim().split(/\s+/);
                  const totalWords = rawWords.length;
                  
                  activeWordIndex = getCaptionActiveWordIndex(currentChunk, adjustedTime);
                  
                  if (activeWordIndex >= totalWords) activeWordIndex = totalWords - 1;
                  if (activeWordIndex < 0 || isNaN(activeWordIndex)) activeWordIndex = -1;
                  
                  if (isKaraoke && activeWordIndex !== -1 && activeWordIndex !== lastSfxWordIndex) {
                       const wordObj = currentChunk.text.trim().split(' ')[activeWordIndex];
                       if (wordObj) {
                           const word = wordObj.toLowerCase().replace(/[^a-z0-9]/g, '');
                           if (['boom','bang','pow','crash','smash'].includes(word)) playSfx('pop');
                           else if (['fast','whoosh','zoom','fly','run','speed'].includes(word)) playSfx('whoosh');
                           else if (['money','cash','buy','dollar','rich','wealth'].includes(word)) playSfx('pop');
                           else if (Math.random() > 0.85) playSfx('pop');
                       }
                       lastSfxWordIndex = activeWordIndex;
                  }
             } else {
                  lastSfxWordIndex = -1;
             }

            let targetEmoji = null;
            const useEmoji = emojiCheck && emojiCheck.checked;
            if (useEmoji) targetEmoji = getEmojiForText(currentChunk.text);

            const fontFamily = getCaptionFontFamily(generatedCaptions.map(cue => cue.text || '').join(' '));
            ctx.font = `${boldCheck && !boldCheck.checked ? 400 : 900} ${fontSize}px ${fontFamily}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const visibleCaptionText = getVisibleCaptionText(currentChunk.text.trim(), activeWordIndex, CAPTION_WORD_LIMIT);
            const wrappedLines = getWrappedCaptionLines(ctx, visibleCaptionText, maxWidth);
            const layout = fitCaptionBlock(captionHeight, fontSize, lineHeight, wrappedLines.length, captionPosY);
            if (layout.scale < 1) ctx.font = `${boldCheck && !boldCheck.checked ? 400 : 900} ${layout.fontSize}px ${fontFamily}`;
            
            drawWrappedText(ctx, currentChunk.text.trim(), captionWidth * captionPosX, layout.y, maxWidth, layout.lineHeight, adjustedTime - currentChunk.timestamp[0], styleSelect.value, activeWordIndex, targetEmoji, layout.fontSize, currentChunk.colorOverride, isKaraoke);
            ctx.restore();
          } else {
            let useMusic = bgMusicAudio && !bgMusicAudio.paused;
            if (bgMusicCheck && !bgMusicCheck.checked) useMusic = false;
            if (useMusic) bgMusicAudio.volume = 0.5; // Ducking inactive
            lastSfxWordIndex = -1;
        }

        if (sharedWatermarkImage && sharedWatermarkImage.complete && (!watermarkCheck || watermarkCheck.checked)) {
            ctx.save();
            ctx.globalAlpha = 0.5;
            const wmWidth = targetWidth * 0.15;
            const wmHeight = (wmWidth / sharedWatermarkImage.width) * sharedWatermarkImage.height;
            if (isImageReady(sharedWatermarkImage)) { ctx.drawImage(sharedWatermarkImage, targetWidth - wmWidth - 40, 40, wmWidth, wmHeight); }
            ctx.restore();
        }

        if (progressCheck && progressCheck.checked) {
            const duration = sourceVideo.duration || 1;
            const progress = time / duration;
            const globalColor = colorPicker ? colorPicker.value : '#fde047';
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8;
            ctx.fillStyle = globalColor;
            const barHeight = 15;
            ctx.fillRect(0, targetHeight - barHeight, targetWidth * progress, barHeight);
            ctx.restore();
        }
      } catch (err) {
         // Silently catch exceptions so the loop survives rendering failures
      }
    }

    function getCaptionSourcePath() {
        try {
            if (!activeFile) return "";
            const sourcePath = activeFile.path || ((window.electronAPI && typeof window.electronAPI.getPathForFile === 'function')
                ? (window.electronAPI.getPathForFile(activeFile) || "")
                : "");
            if (/\.part\.mp4$/i.test(sourcePath)) {
                throw new Error('This is an unfinished .part.mp4 export. Use the original video or a completed MP4, then generate captions again.');
            }
            return sourcePath;
        } catch (error) {
            console.warn('[Caption Export] Could not read source file path:', error);
            if (statusText) statusText.innerHTML = String(error && error.message ? error.message : error);
            return "";
        }
    }

    function getCaptionSyncOffsetSeconds() {
        const rawValue = syncSlider ? Number(syncSlider.value) : 0;
        return Number.isFinite(rawValue) ? rawValue / 1000 : 0;
    }

    function getValidatedCaptionBurnList() {
        const duration = Number(sourceVideo.duration) || 0;
        const syncOffset = getCaptionSyncOffsetSeconds();
        const sorted = (generatedCaptions || [])
            .map((caption) => {
                const timestamp = Array.isArray(caption.timestamp) ? caption.timestamp : [0, 0];
                const start = Math.max(0, Number(timestamp[0]) + syncOffset);
                const rawEnd = Number(timestamp[1]);
                const end = Math.max(start + 0.12, (Number.isFinite(rawEnd) ? rawEnd : timestamp[0] + 2) + syncOffset);
                return {
                    text: stripIgnoredIntroCaption(caption.text, start),
                    start,
                    end: duration > 0 ? Math.min(end, duration) : end
                };
            })
            .filter((caption) => caption.text && caption.end > caption.start)
            .sort((a, b) => a.start - b.start);

        for (let index = 0; index < sorted.length - 1; index += 1) {
            if (sorted[index].end > sorted[index + 1].start) {
                sorted[index].end = Math.max(sorted[index].start + 0.12, sorted[index + 1].start - 0.02);
            }
        }
        return sorted;
    }

    function toAssTimestamp(seconds) {
        const value = Math.max(0, Number(seconds) || 0);
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor((value % 3600) / 60);
        const secs = Math.floor(value % 60);
        const centis = Math.min(99, Math.floor((value - Math.floor(value)) * 100));
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
    }

    function escapeAssCaptionText(value) {
        return String(value || '')
            .replace(/\\/g, '\\\\')
            .replace(/\{/g, '\\{')
            .replace(/\}/g, '\\}')
            .replace(/\r?\n/g, '\\N');
    }

    function hexToAss(value, fallback) {
        const hex = /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
        return `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3).toUpperCase()}&`;
    }

    function getAssStyleConfig(styleType, fontSize, userColor, strokeValue) {
        const highlight = styleType === 'white-yellow' ? '#fde047' : userColor;
        const activeColor = hexToAss(highlight, '#facc15');
        const inactiveColor = styleType === 'white-yellow'
            ? '&H00FFFFFF&'
            : '&H00FFFFFF&';
        const baseTextColor = styleType === 'white-yellow' ? '&H00FFFFFF&' : activeColor;
        const outlineBase = Math.max(0, Math.round(fontSize * 0.12 * strokeValue));

        let borderStyle = 1;
        let outline = outlineBase;
        let shadow = 4;
        let backColor = '&H64000000&';
        let outlineColor = styleType === 'white-yellow' ? hexToAss('#101820', '#101820') : '&H00000000&';

        if (styleType === 'classic' || styleType === 'typewriter') {
            borderStyle = 3;
            outline = 0;
            shadow = 0;
            backColor = '&H33000000&';
        } else if (styleType === 'cinematic') {
            outline = Math.max(1, Math.round(outlineBase * 0.75));
            shadow = 3;
            backColor = '&HFF000000&';
        } else if (styleType === 'neon') {
            outline = Math.max(1, Math.round(outlineBase * 0.65));
            shadow = 8;
            backColor = '&HFF000000&';
        } else if (styleType === 'glitch') {
            outline = Math.max(1, outlineBase);
            shadow = 1;
            backColor = '&HFF000000&';
        } else if (styleType === 'retro') {
            outline = Math.max(2, Math.round(outlineBase * 1.2));
            shadow = 6;
            backColor = '&HFF000000&';
        } else if (styleType === 'white-yellow') {
            outline = Math.max(2, Math.round(fontSize * 0.055));
            shadow = 1;
            backColor = '&HFF000000&';
        } else {
            outline = Math.max(2, outlineBase);
            shadow = 4;
            backColor = '&HFF000000&';
        }

        // ASS outline is a radius; Canvas lineWidth covers both sides of the edge.
        if (styleType === 'white-yellow') {
            outline = Math.max(2, Math.round(fontSize * 0.09)) * 0.75;
            shadow = 0;
        }
        return { activeColor, inactiveColor, baseTextColor, outlineColor, backColor, borderStyle, outline, shadow };
    }

    function buildPreviewMatchedAss(emojiOverlays = []) {
        const width = sourceVideo.videoWidth || renderCanvas.width || 1920;
        const height = sourceVideo.videoHeight || renderCanvas.height || 1080;
        const fontSize = getCaptionSourceFontSize(width, height);
        const selectedStyle = styleSelect ? styleSelect.value : 'white-yellow';
        const userColor = colorPicker ? colorPicker.value : '#fde047';
        const strokeValue = (strokeSlider ? Number(strokeSlider.value) : 80) / 100;
        const assStyle = getAssStyleConfig(selectedStyle, fontSize, userColor, strokeValue);
        const { activeColor, inactiveColor, baseTextColor, outlineColor, backColor, borderStyle, outline, shadow } = assStyle;
        const x = Math.round(width * captionPosX);
        const captionAnchor = 5;
        const widthMult = (widthSlider ? Number(widthSlider.value) : 85) / 100;
        const sideMargin = Math.max(20, Math.round(width * (1 - widthMult) / 2));
        const marginV = CAPTION_BOTTOM_OFFSET_PX;
        const syncOffset = getCaptionSyncOffsetSeconds();
        const captionText = generatedCaptions.map(cue => cue.text || '').join(' ');
        const browserFont = getCaptionFontFamily(captionText);
        const requestedFont = /[\u0900-\u097f\u0c00-\u0c7f]/u.test(captionText) ? 'Nirmala UI'
            : String(fontSelect ? fontSelect.value : 'Nunito').split(',')[0].replace(/["']/g, '').trim() || 'Nunito';
        const selectedBold = boldCheck && !boldCheck.checked ? 0 : -1;
        const selectedFont = requestedFont === 'Nunito' && selectedBold ? 'Nunito Black' : requestedFont;
        const selectedHeight = Math.max(70, Math.min(140, Number(heightSlider?.value || 100)));
        const isKaraoke = Boolean(karaokeCheck && karaokeCheck.checked);
        const useEmoji = emojiCheck && emojiCheck.checked;
        const measureCanvas = document.createElement('canvas');
        const measureCtx = measureCanvas.getContext('2d');
        if (measureCtx) measureCtx.font = `${selectedBold ? 900 : 400} ${fontSize}px ${browserFont}`;
        // libass measures fontsize using Windows ascent + descent, not the CSS em.
        const fontMetrics = measureCtx?.measureText('Mg');
        const assFontSize = requestedFont === 'Nunito'
            ? fontSize * 1.377
            : (fontMetrics?.fontBoundingBoxAscent + fontMetrics?.fontBoundingBoxDescent) || fontSize;
        let assBaselineOffset = 0;
        if (measureCtx && Number.isFinite(fontMetrics?.actualBoundingBoxAscent)) {
            measureCtx.textBaseline = 'middle';
            const middleMetrics = measureCtx.measureText('Mg');
            measureCtx.textBaseline = 'alphabetic';
            const assBaseline = requestedFont === 'Nunito'
                ? fontSize * .3885
                : (fontMetrics.fontBoundingBoxAscent - fontMetrics.fontBoundingBoxDescent) / 2;
            if (Number.isFinite(assBaseline)) {
                assBaselineOffset = fontMetrics.actualBoundingBoxAscent - middleMetrics.actualBoundingBoxAscent - assBaseline;
            }
        }
        const wrapTokensForAss = (tokens) => {
            if (!measureCtx) return [tokens];
            const maxWidth = width * widthMult;
            const lines = [];
            let line = [];
            for (const token of tokens) {
                const testLine = [...line, token].join(' ');
                if (line.length && measureCtx.measureText(testLine).width > maxWidth) {
                    lines.push(line);
                    line = [token];
                } else {
                    line.push(token);
                }
            }
            if (line.length) lines.push(line);
            return lines.length ? lines : [tokens];
        };
        const lineHeight = fontSize * (Number(gapSlider?.value || 120) / 100) * selectedHeight / 100;

        const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Preview,${selectedFont},${assFontSize},${activeColor},${inactiveColor},${outlineColor},${backColor},${selectedBold},0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${captionAnchor},${sideMargin},${sideMargin},${marginV},1\nStyle: Progress,Arial,10,${activeColor},${activeColor},${activeColor},${activeColor},0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`;
        const events = [];
        const exportWordLimit = CAPTION_WORD_LIMIT;

        const exportCaptions = removeIgnoredIntroCaptions(generatedCaptions);
        for (const [captionIndex, caption] of exportCaptions.entries()) {
            const textTokens = String(caption.text || '').trim().split(/\s+/).filter(Boolean);
            if (!textTokens.length || !Array.isArray(caption.timestamp)) continue;
            const capStart = Math.max(0, Number(caption.timestamp[0]) + syncOffset);
            const nextCaptionStart = Number(exportCaptions[captionIndex + 1]?.timestamp?.[0]) + syncOffset;
            const capEnd = Math.min(Number(caption.timestamp[1]) + syncOffset,
                Number.isFinite(nextCaptionStart) ? nextCaptionStart : Infinity);
            const sourceWords = getCaptionWordTimeline(caption).map(word => ({
                ...word, start: word.start + syncOffset, end: word.end + syncOffset,
            }));
            const captionGroups = [];
            for (let groupStart = 0; groupStart < textTokens.length; groupStart += exportWordLimit) {
                const groupTokens = textTokens.slice(groupStart, groupStart + exportWordLimit);
                const groupWords = sourceWords.slice(groupStart, groupStart + exportWordLimit);
                const groupStartTime = groupWords[0] ? groupWords[0].start : capStart;
                const groupEndTime = groupWords[groupWords.length - 1]?.end ?? capEnd;
                captionGroups.push({
                    tokens: groupTokens,
                    words: groupWords,
                    start: Math.max(capStart, groupStartTime),
                    end: Math.max(groupStartTime + 0.1, Math.min(capEnd, groupEndTime)),
                });
            }
            const emoji = useEmoji ? getEmojiForText(caption.text) : null;
            captionGroups.forEach(group => {
                if (!group.tokens.length) return;
                if (measureCtx) measureCtx.font = `${selectedBold ? 900 : 400} ${fontSize}px ${browserFont}`;
                const layout = fitCaptionBlock(height, fontSize, lineHeight, wrapTokensForAss(group.tokens).length, captionPosY);
                if (measureCtx && layout.scale < 1) measureCtx.font = `${selectedBold ? 900 : 400} ${layout.fontSize}px ${browserFont}`;
                const wrappedTokenLines = wrapTokensForAss(group.tokens);
                // Keep the complete caption group visible and change only the
                // currently spoken word to the active colour.
                group.words.forEach((word, activeIndex) => {
                    const start = Math.max(0, word.start);
                    const end = getCaptionWordEnd(group.words, activeIndex, Math.min(capEnd, group.end));
                    if (end <= start) return;
                    let revealedCursor = 0;
                    wrappedTokenLines.forEach((line, lineIndex) => {
                        const revealedText = line.map(token => {
                            const captionColor = selectedStyle === 'white-yellow' ? activeColor : hexToAss(caption.colorOverride || userColor, '#fde047');
                            const color = !isKaraoke ? (selectedStyle === 'white-yellow' ? baseTextColor : captionColor)
                                : revealedCursor === activeIndex ? captionColor : inactiveColor;
                            const alpha = isKaraoke && selectedStyle !== 'white-yellow' && revealedCursor !== activeIndex ? '\\1a&HB3&' : '\\1a&H00&';
                            revealedCursor += 1;
                            return `{\\1c${color}${alpha}}${escapeAssCaptionText(token)}`;
                        }).join(' ');
                        const y = layout.y + (lineIndex - (wrappedTokenLines.length - 1) / 2) * layout.lineHeight + assBaselineOffset * layout.scale;
                        const sizeOverride = layout.scale < 1 ? `\\fs${assFontSize * layout.scale}\\bord${outline * layout.scale}\\shad${shadow * layout.scale}` : '';
                        events.push(`Dialogue: 0,${toAssTimestamp(start)},${toAssTimestamp(end)},Preview,,0,0,0,,{\\an${captionAnchor}\\pos(${x},${y})${sizeOverride}}${revealedText}`);
                    });
                    if (emoji) {
                        // Color emoji cannot be preserved as monochrome ASS glyphs.
                        addCaptionEmojiOverlay(emojiOverlays, emoji, layout.fontSize, {
                            start, end, x, y: layout.y,
                            offsetY: -wrappedTokenLines.length * layout.lineHeight / 2 - Math.max(30, layout.fontSize),
                            bounceStart: Number(caption.timestamp[0]) + syncOffset,
                        });
                    }
                });
            });
        }

        if (progressCheck && progressCheck.checked) {
            const duration = Number(sourceVideo.duration) || 0;
            const slices = Math.max(1, Math.min(120, Math.ceil(duration * 2)));
            for (let index = 0; index < slices; index += 1) {
                const start = duration * index / slices;
                const end = duration * (index + 1) / slices;
                const barWidth = Math.round(width * (index + 1) / slices);
                events.push(`Dialogue: 1,${toAssTimestamp(start)},${toAssTimestamp(end)},Progress,,0,0,0,,{\\an7\\pos(0,${height - 14})\\p1}m 0 0 l ${barWidth} 0 ${barWidth} 14 0 14{\\p0}`);
            }
        }
        return [header, ...events].join('\n');
    }

    function buildPreviewMatchedExport() {
        const emojiOverlays = [];
        const assContent = buildPreviewMatchedAss(emojiOverlays);
        return { assContent, emojiOverlays };
    }

    sourceVideo.addEventListener('loadedmetadata', () => {
        const ctx = renderCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        updateCaptionStyleValueLabels();
        publishCaptionLocalState();
    });

    sourceVideo.addEventListener('play', () => {
        updatePlayPauseLabel();
        schedulePreviewFrame();
    });
    sourceVideo.addEventListener('pause', () => {
        clearPreviewFrameHandle();
        updatePlayPauseLabel();
        renderPreviewNow(sourceVideo.currentTime);
    });
    sourceVideo.addEventListener('ended', () => {
        if (restartCaptionPreviewLoop()) return;
        clearPreviewFrameHandle();
        updatePlayPauseLabel();
        if (!isRecording) renderPreviewNow(sourceVideo.currentTime);
    });

    function seekCaptionPreviewTo(time) {
        return new Promise(resolve => {
            const safeTime = Math.max(0, Number(time) || 0);
            const done = () => resolve();
            sourceVideo.addEventListener('seeked', done, { once: true });
            sourceVideo.currentTime = safeTime;
            setTimeout(done, 900);
        });
    }

    if (previewBtn) {
        previewBtn.addEventListener('click', async () => {
            if (isRecording || captionQueueExporting || captionQueueRunning) {
                statusText.innerHTML = 'Preview is paused while export or queue work is running.';
                return;
            }
            if (!sourceVideo.src || !generatedCaptions.length) {
                statusText.innerHTML = 'Generate captions first, then preview.';
                return;
            }

            const duration = Number(sourceVideo.duration) || 0;
            const firstCaption = generatedCaptions.find(c => Array.isArray(c.timestamp) && Number.isFinite(Number(c.timestamp[0])));
            const current = Number(sourceVideo.currentTime) || 0;
            const fallbackStart = firstCaption ? Number(firstCaption.timestamp[0]) : 0;
            const maxStart = duration > 0 ? Math.max(0, duration - 0.25) : fallbackStart;
            const start = Math.max(0, Math.min(current || fallbackStart, maxStart));
            const end = duration > 0 ? Math.min(duration, start + 5) : start + 5;
            const oldText = previewBtn.textContent;

            try {
                previewBtn.disabled = true;
                previewBtn.textContent = 'Previewing 5s...';
                statusText.innerHTML = `Previewing captions for 5 seconds. Check font, placement, color, and ${CAPTION_WORD_LIMIT}-word grouping before export.`;
                sourceVideo.pause();
                // Request playback during the click's user activation. Waiting
                // for seeked first can make browsers reject audible playback.
                const seekReady = seekCaptionPreviewTo(start);
                await Promise.all([seekReady, sourceVideo.play()]);
                renderPreviewNow(sourceVideo.currentTime);
                await new Promise(resolve => {
                    let finished = false;
                    const finish = () => {
                        if (finished) return;
                        finished = true;
                        clearInterval(timer);
                        sourceVideo.removeEventListener('ended', finish);
                        resolve();
                    };
                    const timer = setInterval(() => {
                        if (sourceVideo.currentTime >= end || sourceVideo.ended || sourceVideo.paused) finish();
                    }, 120);
                    sourceVideo.addEventListener('ended', finish, { once: true });
                    setTimeout(finish, 5600);
                });
                sourceVideo.pause();
                renderPreviewNow(sourceVideo.currentTime || start);
                statusText.innerHTML = '5-second preview complete. If it looks correct, export the video.';
            } catch (error) {
                console.error('[Caption Preview]', error);
                statusText.innerHTML = 'Preview failed: ' + (error.message || error);
            } finally {
                previewBtn.disabled = false;
                previewBtn.textContent = oldText || 'Preview 5s';
                updatePlayPauseLabel();
            }
        });
    }

    async function confirmCaptionExportPreview() {
        if (!generatedCaptions.length) return false;
        clearCaptionPreviewLoop();
        sourceVideo.pause();
        const offset = getCaptionSyncOffsetSeconds();
        const cap = generatedCaptions.find(c => sourceVideo.currentTime - offset >= c.timestamp[0] && sourceVideo.currentTime - offset < c.timestamp[1]) || generatedCaptions[0];
        await Promise.race([
            seekCaptionPreviewTo(Math.max(0, Number(cap.timestamp[0]) + offset + 0.01)),
            new Promise(resolve => setTimeout(resolve, 180))
        ]);
        renderPreviewNow(sourceVideo.currentTime);
        renderCanvas.scrollIntoView({ block: 'center' });
        await Promise.race([
            new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            new Promise(resolve => setTimeout(resolve, 50))
        ]);
        // Keep the preview current, but never interrupt each queued export with a dialog.
        return true;
    }

    exportBtn.addEventListener('click', async () => {
        if (captionLocalBusy()) return;
        const notifyExport = createCaptionWhatsAppJob('AI Captioning · video export');
        let nativeExportObserved = false;
        try {
        isRecording = true;
        sourceVideo.playbackRate = 1;
        publishCaptionLocalState();
        if (!await confirmCaptionExportPreview()) {
            isRecording = false;
            publishCaptionLocalState();
            return;
        }
        setCaptionExportActionsVisible(false);
        exportBtn.textContent = '\u26a1 Express Export...';
        exportBtn.disabled = true;

        // -- FAST PATH: FFmpeg burn-in via IPC (instant - no video playback needed) --
        const _filePath = getCaptionSourcePath();
        const _hasIpc   = window.electronAPI && (
            typeof window.electronAPI.fastBurnAss === 'function' ||
            typeof window.electronAPI.burnCaptions === 'function'
        );
        const _styleName = styleSelect ? styleSelect.value : 'default';

        if (_hasIpc && !_filePath) {
            notifyExport('failed', 'The original source file path is unavailable. Re-upload the source video.');
            statusText.innerHTML = '\u274c Export stopped: the original source file path is unavailable. Re-upload the source video and try again.';
            exportBtn.textContent = 'Export Result';
            exportBtn.disabled = false;
            isRecording = false;
            publishCaptionLocalState();
            return;
        }

        // Full local-caption exports must use the source file directly. Canvas
        // MediaRecorder can emit a silent audio track and repeat the opening
        // frame when Chromium throttles a hidden video. Native FFmpeg preserves
        // the original frame timestamps and copies the original audio unchanged.
        if (_filePath && _hasIpc && generatedCaptions && generatedCaptions.length > 0) {
            try {
                const captionsForBurn = getValidatedCaptionBurnList();
                if (!captionsForBurn.length) {
                    throw new Error('No valid caption timings are available for export.');
                }
                statusText.innerHTML = '\u26a1 Sync export: 0% complete - 100% remaining';
                renderSingleCaptionProgress(0, 'Exporting captions', (activeFile && activeFile.name) || 'Current video');
                let burnProgressHandler = null;
                let syncShownPct = 0;
                let syncFinalizingTimer = null;
                const showSyncExportProgress = (pct, phaseLabel = 'Sync export') => {
                    syncShownPct = Math.max(syncShownPct, Math.max(0, Math.min(99, Math.round(pct))));
                    statusText.innerHTML = '\u26a1 ' + phaseLabel + ': ' + syncShownPct + '% complete - ' + (100 - syncShownPct) + '% remaining';
                    setCaptionProgressBar(syncShownPct);
                    renderSingleCaptionProgress(syncShownPct, phaseLabel, (activeFile && activeFile.name) || 'Current video');
                };
                syncFinalizingTimer = setInterval(() => {
                    if (!isRecording || syncShownPct < 94 || syncShownPct >= 99) return;
                    showSyncExportProgress(syncShownPct + 1, 'Finalizing export');
                }, 1200);
                if (window.electronAPI && typeof window.electronAPI.onBurnProgress === 'function') {
                    burnProgressHandler = data => {
                        let pct = 0;
                        if (typeof data === 'number') pct = data;
                        else if (data && typeof data.pct === 'number') pct = data.pct;
                        const isFinalizing = data && typeof data === 'object' && data.phase === 'finalizing';
                        showSyncExportProgress(pct, isFinalizing || pct >= 94 ? 'Finalizing export' : 'Sync export');
                    };
                    window.electronAPI.onBurnProgress(burnProgressHandler);
                }
                const _fontSize = getCaptionSourceFontSize();
                let _result = null;
                try {
                    await ensureCaptionFontReady();
                    nativeExportObserved = typeof window.electronAPI.burnCaptions === 'function';
                    _result = await window.electronAPI.burnCaptions({
                        videoPath: _filePath,
                        sourceFileName: captionVideoQueue[captionQueueIndex] && captionVideoQueue[captionQueueIndex].file
                            ? captionVideoQueue[captionQueueIndex].file.name
                            : '',
                        captions: captionsForBurn,
                        style: _styleName,
                        fontSize: _fontSize,
                        position: 'bottom',
                        ...buildPreviewMatchedExport()
                    });
                } finally {
                    if (syncFinalizingTimer) clearInterval(syncFinalizingTimer);
                    if (burnProgressHandler && typeof window.electronAPI.offBurnProgress === 'function') {
                        window.electronAPI.offBurnProgress(burnProgressHandler);
                    }
                }
                if (_result && _result.ok) {
                    const completedFileName = _result.fileName || 'captioned video';
                    statusText.innerHTML = '\u2705 Synced caption export done! Saved to Downloads: <strong>' + completedFileName + '</strong>.';
                    setCaptionProgressBar(100);
                    renderSingleCaptionProgress(100, 'Export complete', completedFileName);
                    renderCaptionExportActions(_result, { queueIndex: captionQueueIndex });
                    exportBtn.textContent = 'Export Result';
                    exportBtn.disabled = false;
                    isRecording = false;
                    publishCaptionLocalState();
                    console.log('[Caption Export] FFmpeg express export done:', _result.outputPath);
                    speakCaptionStudio(`Exporting done. ${completedFileName}`);
                    notifyCaptionStudio('Exporting done', completedFileName);
                    return;
                }
                throw new Error((_result && _result.error) || 'FFmpeg caption export failed.');
            } catch (_ffErr) {
                if (!nativeExportObserved) notifyExport('failed', _ffErr);
                console.error('[Caption Export] Native FFmpeg export failed:', _ffErr.message);
                statusText.innerHTML = '\u274c Export stopped: native FFmpeg could not preserve the source video and audio. ' + (_ffErr.message || '');
                exportBtn.textContent = 'Export Result';
                exportBtn.disabled = false;
                isRecording = false;
                publishCaptionLocalState();
                return;
            }
        }

        // Browser-only fallback. Voice Presentator desktop always uses native
        // FFmpeg above because it preserves source audio and frame timing.

        // FIX 1: Silence to speakers (muted + volume=0)
        const _origMuted  = sourceVideo.muted;
        const _origVolume = sourceVideo.volume;
        sourceVideo.muted  = true;
        sourceVideo.volume = 0;
        sourceVideo.pause();
        sourceVideo.playbackRate = 1.0;

        // FIX 2: Wait for seeked BEFORE starting recorder (prevents 2-sec truncation bug)
        await new Promise(resolve => {
            if (Math.abs(sourceVideo.currentTime) < 0.05) { resolve(); return; }
            sourceVideo.addEventListener('seeked', resolve, { once: true });
            sourceVideo.currentTime = 0;
        });
        sourceVideo.currentTime = 0;
        await new Promise(r => setTimeout(r, 80));

        const _duration = sourceVideo.duration || 0;
        if (!_duration || !isFinite(_duration)) {
            notifyExport('failed', 'Video duration is unknown. Reload the video before exporting.');
            statusText.innerHTML = '\u274c Cannot export: video duration unknown. Try reloading the video.';
            isRecording = false; exportBtn.textContent = 'Export Result'; exportBtn.disabled = false;
            publishCaptionLocalState();
            sourceVideo.muted = _origMuted; sourceVideo.volume = _origVolume;
            return;
        }

        const _expW = sourceVideo.videoWidth  || renderCanvas.width;
        const _expH = sourceVideo.videoHeight || renderCanvas.height;
        const _expCanvas = document.createElement('canvas');
        _expCanvas.width = _expW; _expCanvas.height = _expH;
        const _expCtx = _expCanvas.getContext('2d', { alpha: false });
        const _expFps = 30;
        const _expMs  = Math.round(1000 / _expFps);

        renderCaptionFrame(_expCtx, _expW, _expH, 0, { isPreviewSurface: false });

        const _stream = _expCanvas.captureStream(_expFps);

        // FIX 3: AudioContext routes audio to recording ONLY (NOT to speakers)
        let _expAudioCtx = null;
        try {
            _expAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const _dest = _expAudioCtx.createMediaStreamDestination();
            const _src  = _expAudioCtx.createMediaElementSource(sourceVideo);
            _src.connect(_dest); // recording stream ONLY - no connect to _expAudioCtx.destination
            const _aTracks = _dest.stream.getAudioTracks();
            if (_aTracks.length > 0) _stream.addTrack(_aTracks[0]);
        } catch (_aErr) {
            console.warn('[Caption Export] AudioContext failed, exporting video-only:', _aErr.message);
        }

        let _opts = { mimeType: 'video/webm; codecs=vp9' };
        let _ext  = 'webm';
        if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.4d4028, mp4a.40.2"')) {
            _opts = { mimeType: 'video/mp4; codecs="avc1.4d4028, mp4a.40.2"' }; _ext = 'mp4';
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
            _opts = { mimeType: 'video/mp4' }; _ext = 'mp4';
        } else if (!MediaRecorder.isTypeSupported(_opts.mimeType)) {
            _opts = { mimeType: 'video/webm; codecs=vp8' };
        }
        _opts.videoBitsPerSecond = 12000000;

        const _rec    = new MediaRecorder(_stream, _opts);
        _rec.addEventListener('error', event => notifyExport('failed', event.error || 'The browser video recorder failed.'));
        const _chunks = [];
        let   _expDone   = false;
        let   _loopTimer = null;
        let   _progTimer = null;
        let   _watchdog  = null;

        _rec.ondataavailable = e => { if (e.data.size > 0) _chunks.push(e.data); };

        const _finishExport = () => {
            if (_expDone) return;
            _expDone = true;
            if (_loopTimer) { clearInterval(_loopTimer); _loopTimer = null; }
            if (_progTimer) { clearInterval(_progTimer); _progTimer = null; }
            if (_watchdog)  { clearTimeout(_watchdog);  _watchdog  = null; }
            try { renderCaptionFrame(_expCtx, _expW, _expH, _duration, { isPreviewSurface: false }); } catch(e) {}
            _rec.requestData();
            setTimeout(() => { try { _rec.stop(); } catch(e) {} }, 200);
        };

        _rec.onstop = () => {
            try {
            if (_loopTimer) clearInterval(_loopTimer);
            if (_progTimer) clearInterval(_progTimer);
            if (_watchdog)  clearTimeout(_watchdog);

            const _blob = new Blob(_chunks, { type: _opts.mimeType.split(';')[0] });
            const _url  = URL.createObjectURL(_blob);
            const _a    = document.createElement('a');
            const _sourceName = captionVideoQueue[captionQueueIndex] && captionVideoQueue[captionQueueIndex].file
                ? captionVideoQueue[captionQueueIndex].file.name
                : `video.${_ext}`;
            const _sourceBase = _sourceName.replace(/\.[^/.]+$/, '') || 'video';
            const _exactExportName = `${_sourceBase}.${_ext}`;
            _a.href = _url; _a.download = _exactExportName; _a.click();
            URL.revokeObjectURL(_url);
            notifyExport(_blob.size ? 'completed' : 'failed', _blob.size
                ? `Video prepared; download requested: ${_exactExportName}`
                : 'The browser recorder produced an empty video.');

            isRecording = false;
            publishCaptionLocalState();
            exportBtn.textContent = 'Export Result';
            exportBtn.disabled    = false;
            statusText.innerHTML  = '\u2705 Export complete! <strong>' + _exactExportName + '</strong> saved to Downloads.';
            speakCaptionStudio(`Exporting done. ${_exactExportName}`);
            notifyCaptionStudio('Exporting done', _exactExportName);

            sourceVideo.pause(); sourceVideo.currentTime = 0;
            sourceVideo.muted = _origMuted; sourceVideo.volume = _origVolume;
            renderPreviewNow(0); updatePlayPauseLabel();
            _stream.getTracks().forEach(t => t.stop());
            if (_expAudioCtx) { try { _expAudioCtx.close(); } catch(e) {} }
            console.log('[Caption Export] Done. Duration:', _duration.toFixed(2) + 's, chunks:', _chunks.length);
            if (window.electronAPI && window.electronAPI.showNotification) {
                window.electronAPI.showNotification('Caption Export', 'Captioned video exported successfully!');
            }
            } catch (error) {
                notifyExport('failed', error);
                throw error;
            }
        };

        const _runLoop = () => {
            if (_expDone) return;
            renderCaptionFrame(_expCtx, _expW, _expH, sourceVideo.currentTime, { isPreviewSurface: false });
        };

        // FIX 4: recorder.start(250) with timeslice - ensures data collected throughout (not just on stop)
        _rec.start(250);
        _loopTimer = setInterval(_runLoop, _expMs);
        _runLoop();

        // Real-time 0-100% progress indicator
        _progTimer = setInterval(() => {
            if (_expDone || !isRecording) return;
            const _ct  = sourceVideo.currentTime;
            const _pct = _duration > 0 ? Math.min(100, Math.round((_ct / _duration) * 100)) : 0;
            const _remainingPct = Math.max(0, 100 - _pct);
            const _remainingSec = Math.max(0, _duration - _ct);
            statusText.innerHTML = 'Exporting captioned video: <strong>' + _pct + '%</strong> complete - <strong>' + _remainingPct + '%</strong> remaining&nbsp;&nbsp;(' + _remainingSec.toFixed(1) + 's left / ' + _duration.toFixed(1) + 's total) - please wait...';
            exportBtn.textContent = '\u23f3 Exporting ' + _pct + '%';
            renderSingleCaptionProgress(_pct, 'Exporting captions', (activeFile && activeFile.name) || 'Current video');
        }, 500);

        // FIX 5: Safety watchdog - force stop if ended event never fires
        _watchdog = setTimeout(() => {
            console.warn('[Caption Export] Watchdog triggered at', _duration + 5, 's');
            _finishExport();
        }, (_duration + 5) * 1000);

        statusText.innerHTML = 'Exporting captioned video: <strong>0%</strong> complete - <strong>100%</strong> remaining&nbsp;&nbsp;(' + _duration.toFixed(1) + 's left / ' + _duration.toFixed(1) + 's total) - please wait...';

        try { await sourceVideo.play(); } catch(_pErr) {
            notifyExport('failed', _pErr);
            console.warn('[Caption Export] play() rejected:', _pErr);
        }

        // FIX 6: ended event stops recording at true video end
        sourceVideo.addEventListener('ended', () => {
            if (!isRecording) return;
            _finishExport();
        }, { once: true });
        } catch (error) {
            if (!nativeExportObserved) notifyExport('failed', error);
            isRecording = false;
            exportBtn.disabled = false;
            exportBtn.textContent = 'Export Result';
            publishCaptionLocalState();
            throw error;
        }
    });


    // stageCaptionExportBtn is handled by script.js — do not add a second listener here.


    if (viralShortBtn) {
        viralShortBtn.addEventListener('click', () => {
            if(captionLocalBusy() || generatedCaptions.length === 0) return;
            const notifyShort = createCaptionWhatsAppJob('AI Captioning · viral short export');
            try {
            // Find most dense 15s window
            let bestStart = 0; let bestEnd = 15; let maxWords = 0;
            for(let i=0; i<Math.max(1, sourceVideo.duration - 15); i+=5) {
                const w = i, e = i+15;
                const score = generatedCaptions.filter(c => c.timestamp[0] >= w && c.timestamp[1] <= e).reduce((acc, c) => acc + c.text.split(' ').length, 0);
                if (score > maxWords) { maxWords = score; bestStart = w; bestEnd = e; }
            }
            
            isRecording = true; viralShortBtn.textContent = 'Recording 15s...'; viralShortBtn.disabled = true;
            publishCaptionLocalState();
            statusText.innerHTML = "Slicing Viral 15s Short Region...";
            sourceVideo.pause(); sourceVideo.currentTime = bestStart;
            sourceVideo.playbackRate = 1.0;
            
            const stream = renderCanvas.captureStream(30); // Using 30 to stay perfectly synced
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const destination = audioCtx.createMediaStreamDestination();
            if (!window.__cap2AudioSourceMerged) window.__cap2AudioSourceMerged = audioCtx.createMediaElementSource(sourceVideo);
            window.__cap2AudioSourceMerged.connect(destination); window.__cap2AudioSourceMerged.connect(audioCtx.destination);
            if (destination.stream.getAudioTracks().length > 0) stream.addTrack(destination.stream.getAudioTracks()[0]);
            if (sfxDest.stream.getAudioTracks().length > 0) stream.addTrack(sfxDest.stream.getAudioTracks()[0]);
            if (bgMusicAudio && !bgMusicAudio.paused) {
                 if (!window.__cap2BgMusicMerged) window.__cap2BgMusicMerged = audioCtx.createMediaElementSource(bgMusicAudio);
                 window.__cap2BgMusicMerged.connect(destination);
            }

            let options = {};
            let ext = 'webm';
            if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.4d4028, mp4a.40.2"')) {
                options = { mimeType: 'video/mp4; codecs="avc1.4d4028, mp4a.40.2"' };
                ext = 'mp4';
            } else if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.4d4028"')) {
                options = { mimeType: 'video/mp4; codecs="avc1.4d4028"' };
                ext = 'mp4';
            } else if (MediaRecorder.isTypeSupported('video/mp4')) {
                options = { mimeType: 'video/mp4' };
                ext = 'mp4';
            } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
                options = { mimeType: 'video/webm; codecs=vp9' };
            } else {
                options = { mimeType: 'video/webm; codecs=vp8' };
            }
            
            // Target 12 Mbps for a balance of small file size and good visual quality
            options.videoBitsPerSecond = 12000000;
            
            const recorder = new MediaRecorder(stream, options);
            recorder.addEventListener('error', event => notifyShort('failed', event.error || 'The browser short recorder failed.'));
            const recordedChunks = [];
            recorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
            recorder.onstop = () => {
                try {
                const blob = new Blob(recordedChunks, { type: options.mimeType.split(';')[0] });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `viral_short_clip.${ext}`; a.click(); URL.revokeObjectURL(url);
                notifyShort(blob.size ? 'completed' : 'failed', blob.size
                    ? `Video prepared; download requested: viral_short_clip.${ext}`
                    : 'The browser recorder produced an empty short video.');
                isRecording = false; viralShortBtn.textContent = '✂️ Export 15s Viral Short'; viralShortBtn.disabled = false;
                publishCaptionLocalState();
                statusText.innerHTML = "✅ Viral Short Export completed!";
                speakCaptionStudio(`Exporting done. viral_short_clip.${ext}`);
                notifyCaptionStudio('Exporting done', `viral_short_clip.${ext}`);
                sourceVideo.pause(); playPauseBtn.textContent = '▶️ Play';
                stream.getTracks().forEach(track => track.stop());
                } catch (error) {
                    notifyShort('failed', error);
                    throw error;
                }
            };
            recorder.start(); sourceVideo.play().catch(error => { notifyShort('failed', error); }); playPauseBtn.textContent = '⏸️ Pause';
            
            const checkEnd = setInterval(() => {
                if (sourceVideo.currentTime >= bestEnd) {
                    clearInterval(checkEnd);
                    if (isRecording) recorder.stop();
                }
            }, 100);
            } catch (error) {
                notifyShort('failed', error);
                isRecording = false;
                viralShortBtn.disabled = false;
                viralShortBtn.textContent = '✂️ Export 15s Viral Short';
                publishCaptionLocalState();
                throw error;
            }
        });
        
        // Show viral button if video is long enough
        sourceVideo.addEventListener('loadedmetadata', () => {
            if (sourceVideo.duration > 15 && viralShortBtn) viralShortBtn.classList.remove('hidden');
            else if (viralShortBtn) viralShortBtn.classList.add('hidden');
        });
    }

    // Wire Captioner 2 Voice & shortcuts buttons (#cap2_aiCapSttBtn, #cap2_aiCapTtsBtn)
    const cap2SttBtn = document.getElementById('cap2_aiCapSttBtn');
    const cap2TtsBtn = document.getElementById('cap2_aiCapTtsBtn');
    const cap2VoiceStatus = document.getElementById('cap2_aiCapVoiceStatus');
    if (cap2SttBtn) {
        cap2SttBtn.addEventListener('click', () => {
            const hasFile = Boolean(activeFile || (videoInput && videoInput.files && videoInput.files.length > 0));
            const hasVideoSrc = Boolean(sourceVideo && sourceVideo.src && !sourceVideo.src.endsWith(window.location.href));
            if (!hasFile && !hasVideoSrc) {
                if (cap2VoiceStatus) cap2VoiceStatus.textContent = '⚠️ Select a video in the Source video field first!';
                if (videoInput) {
                    videoInput.style.outline = '3px solid #f44336';
                    setTimeout(() => { videoInput.style.outline = ''; }, 2000);
                }
                return;
            }
            if (captionLocalBusy()) {
                if (cap2VoiceStatus) cap2VoiceStatus.textContent = '⚠️ Caption engine is busy — wait a moment and try again.';
                return;
            }
            if (cap2VoiceStatus) cap2VoiceStatus.textContent = '🎥 Transcribing video audio into timed captions...';
            if (captionVideoQueue.length > 1) {
                transcribeCaptionQueueFrom(captionQueueIndex);
                return;
            }
            transcribeActiveCaptionVideo();
        });
    }
    if (cap2TtsBtn) {
        let cap2TtsAudio = null;
        let cap2TtsPlaying = false;
        const resetTtsBtn = () => {
            cap2TtsPlaying = false;
            cap2TtsAudio = null;
            cap2TtsBtn.disabled = false;
            cap2TtsBtn.textContent = 'Read lesson aloud';
        };
        cap2TtsBtn.addEventListener('click', async () => {
            if (cap2TtsPlaying) {
                if (cap2TtsAudio) { try { cap2TtsAudio.pause(); } catch (_) {} }
                if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (_) {} }
                resetTtsBtn();
                if (cap2VoiceStatus) cap2VoiceStatus.textContent = '';
                return;
            }
            const text = (
                (Array.isArray(generatedCaptions) && generatedCaptions.length
                    ? generatedCaptions.map(c => c.text).join(' ')
                    : '') ||
                (document.getElementById('lessonInput') && document.getElementById('lessonInput').value) ||
                ''
            ).trim();
            if (!text) {
                if (cap2VoiceStatus) cap2VoiceStatus.textContent = '⚠️ Generate captions or enter lesson text first.';
                return;
            }
            cap2TtsBtn.disabled = true;
            cap2TtsBtn.textContent = 'Generating voice...';
            if (cap2VoiceStatus) cap2VoiceStatus.textContent = '⏳ Preparing speech...';
            try {
                const voice = window.state?.preferredNarrationVoice || 'sc3';
                const resp = await fetch('http://127.0.0.1:5111/api/narrate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, generationOptions: { voice } }),
                });
                if (!resp.ok) throw new Error('Server ' + resp.status);
                cap2TtsAudio = new Audio(URL.createObjectURL(await resp.blob()));
                cap2TtsPlaying = true;
                cap2TtsBtn.disabled = false;
                cap2TtsBtn.textContent = 'Stop reading';
                if (cap2VoiceStatus) cap2VoiceStatus.textContent = '🔊 Playing — click to stop';
                cap2TtsAudio.onended = () => {
                    resetTtsBtn();
                    if (cap2VoiceStatus) cap2VoiceStatus.textContent = '✔ Done.';
                };
                await cap2TtsAudio.play();
            } catch (_) {
                if (window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
                    window.speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance(text);
                    cap2TtsPlaying = true;
                    cap2TtsBtn.disabled = false;
                    cap2TtsBtn.textContent = 'Stop reading';
                    if (cap2VoiceStatus) cap2VoiceStatus.textContent = '🔊 Reading aloud — click to stop';
                    utterance.onend = () => {
                        resetTtsBtn();
                        if (cap2VoiceStatus) cap2VoiceStatus.textContent = '✔ Done.';
                    };
                    utterance.onerror = () => {
                        resetTtsBtn();
                        if (cap2VoiceStatus) cap2VoiceStatus.textContent = '⚠️ Speech playback stopped.';
                    };
                    window.speechSynthesis.speak(utterance);
                } else {
                    resetTtsBtn();
                    if (cap2VoiceStatus) cap2VoiceStatus.textContent = '⚠️ Local narration service is offline.';
                }
            }
        });
    }

  } catch (err) {
      window.__presentatorCaptioner2Booted = false;
      setTimeout(() => {
          const st = document.getElementById('cap2_captionStatusText');
          if (st) {
              st.innerHTML = `<span style='color:red'>FATAL UI CRASH: ${err.message}</span>`;
              if (st.parentElement) st.parentElement.classList.remove('hidden');
          }
          alert("Caption Studio failed to load: " + err.message);
      }, 500);
      console.error(err);
  }
}

window.bootCaptionStudioV2 = bootCaptionStudio;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootCaptionStudio, { once: true });
} else {
  bootCaptionStudio();
}
})();
