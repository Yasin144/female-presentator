"""
translate-server.py
====================
Offline-capable translation server for Voice Presentator Caption Studio.
Uses Gemini when configured, local Ollama for reliable offline translation,
and Google only as a last compatibility fallback.

API:
  POST /api/translate  { text, target, source? }  → { translated, target }
  POST /api/translate/batch  { texts:[], target, source? }  → { results:[] }
  GET  /health  → { status }

Ports: 8434
"""

import sys, json, re, os, time, urllib.parse, urllib.request
from collections import OrderedDict
from threading import Lock
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

if hasattr(sys.stdout, "reconfigure"):
    try: sys.stdout.reconfigure(encoding="utf-8")
    except: pass

PORT = 8434
OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
OLLAMA_MODEL = "qwen3.5:4b"
GEMINI_MODEL = "gemini-3.5-flash"
GEMINI_KEY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".gemini_api_key")

# ── Language code mapping ─────────────────────────────────────────────────────
LANG_CODES = {
    "en": "en", "english": "en",
    "hi": "hi", "hindi": "hi", "hin": "hi",
    "te": "te", "telugu": "te", "tel": "te",
    "ta": "ta", "tamil": "ta", "tam": "ta",
    "kn": "kn", "kannada": "kn", "kan": "kn",
    "ml": "ml", "malayalam": "ml", "mal": "ml",
    "bn": "bn", "bengali": "bn", "bangla": "bn", "ben": "bn",
    "gu": "gu", "gujarati": "gu", "guj": "gu",
    "mr": "mr", "marathi": "mr", "mar": "mr",
    "ur": "ur", "urdu": "ur",
    "ar": "ar", "arabic": "ar",
    "auto": "auto"
}
LANG_LABELS = {
    "en": "English",
    "hi": "हिंदी",
    "te": "తెలుగు",
    "ta": "தமிழ்",
    "kn": "ಕನ್ನಡ", "ml": "മലയാളം", "bn": "বাংলা",
    "gu": "ગુજરાતી", "mr": "मराठी",
    "ur": "اردو",
    "ar": "العربية",
}

def normalize_lang(lang, allow_auto=False):
    if lang is None or lang == "":
        lang = "auto" if allow_auto else "en"
    if not isinstance(lang, str):
        raise ValueError("Language must be a supported language code")
    code = LANG_CODES.get(lang.lower().strip())
    if code is None or (code == "auto" and not allow_auto):
        raise ValueError("Unsupported source language" if allow_auto else "Unsupported target language")
    return code


class TranslationUnavailable(RuntimeError):
    """No provider returned a complete, valid caption translation."""


def validate_texts(texts):
    if not isinstance(texts, list) or not texts:
        raise ValueError("texts must be a nonempty array of caption strings")
    if any(not isinstance(item, str) or not item.strip() for item in texts):
        raise ValueError("Every caption must be a nonempty string")
    return [item.strip() for item in texts]


def validate_results(results, expected_count):
    if not isinstance(results, list) or len(results) != expected_count:
        raise ValueError("Translation must return exactly one result for every caption")
    if any(not isinstance(item, str) or not item.strip() for item in results):
        raise ValueError("Every translated caption must be a nonempty string")
    return [item.strip() for item in results]


# Animal noun meanings verified against Cambridge's English-Telugu dictionary:
# https://dictionary.cambridge.org/dictionary/english-telugu/tiger
# The fox/jackal family shares the everyday Telugu noun, not the English species.
# Forms are explicit nominative/accusative/dative/instrumental singular/plural;
# never replace arbitrary Telugu substrings or guess an unfamiliar inflection.
TELUGU_ANIMAL_FORMS = {
    "tiger": ("పులి", "పులులు", "పులిని", "పులికి", "పులితో", "పులులను", "పులులకు", "పులులతో"),
    "fox_jackal": ("నక్క", "నక్కలు", "నక్కను", "నక్కకు", "నక్కతో", "నక్కలను", "నక్కలకు", "నక్కలతో"),
    "lion": ("సింహం", "సింహాలు", "సింహాన్ని", "సింహానికి", "సింహంతో", "సింహాలను", "సింహాలకు", "సింహాలతో"),
    "elephant": ("ఏనుగు", "ఏనుగులు", "ఏనుగును", "ఏనుగుకు", "ఏనుగుతో", "ఏనుగులను", "ఏనుగులకు", "ఏనుగులతో"),
    "deer": ("జింక", "జింకలు", "జింకను", "జింకకు", "జింకతో", "జింకలను", "జింకలకు", "జింకలతో"),
    "giraffe": ("జిరాఫీ", "జిరాఫీలు", "జిరాఫీని", "జిరాఫీకి", "జిరాఫీతో", "జిరాఫీలను", "జిరాఫీలకు", "జిరాఫీలతో"),
}
ENGLISH_ANIMAL_GROUPS = {
    "tiger": "tiger", "tigers": "tiger",
    "fox": "fox_jackal", "foxes": "fox_jackal", "jackal": "fox_jackal", "jackals": "fox_jackal",
    "lion": "lion", "lions": "lion", "elephant": "elephant", "elephants": "elephant",
    "deer": "deer", "giraffe": "giraffe", "giraffes": "giraffe",
}
_ENGLISH_ANIMAL = re.compile(r"\b(" + "|".join(ENGLISH_ANIMAL_GROUPS) + r")\b", re.IGNORECASE)
_NON_ANIMAL_USE = re.compile(
    r"\b(?:tiger\s+(?:woods|shroff|sharks?|moths?|lil(?:y|ies)|snakes?|prawns?|shrimp)|"
    r"paper\s+tigers?|fox\s+news|lion['’]s\s+share|mountain\s+lions?|sea\s+elephants?|"
    r"elephant\s+in\s+the\s+room|(?:named|called|brand|movie|film|team)\s+[\"']?"
    r"(?:tiger|fox|lion|elephant|deer|giraffe))\b", re.IGNORECASE)
_TELUGU_WORD = re.compile(r"[\u0c00-\u0c7f]+")
_ANIMAL_FORM = {form: (animal, index) for animal, forms in TELUGU_ANIMAL_FORMS.items()
                for index, form in enumerate(forms)}
_ANIMAL_FORM.update({"నక్కకి": ("fox_jackal", 3), "జింకకి": ("deer", 3), "ఏనుగుకి": ("elephant", 3)})


def source_animal_terms(text, source="auto"):
    if source not in ("en", "auto") or _NON_ANIMAL_USE.search(text):
        return set()
    if source == "auto" and any(char.isalpha() and not char.isascii() for char in text):
        return set()
    return {ENGLISH_ANIMAL_GROUPS[match.group().lower()] for match in _ENGLISH_ANIMAL.finditer(text)}


def validate_caption_meaning(texts, results, target, source="auto"):
    """Conservatively guard one explicit English animal per Telugu caption.

    This verifies terminology, not general translation quality. Context never
    permits moving an animal into a different cue. An unambiguous wrong noun
    can be replaced using a known matching case/number; uncertainty rejects the
    provider so the complete chunk falls back instead of publishing bad text.
    """
    results = validate_results(results, len(texts))
    if target != "te":
        return results
    guarded = []
    for original, translated in zip(texts, results):
        expected = source_animal_terms(original, source)
        if len(expected) != 1:
            guarded.append(translated)
            continue
        animal = next(iter(expected))
        matches = [(match, _ANIMAL_FORM[match.group()]) for match in _TELUGU_WORD.finditer(translated)
                   if match.group() in _ANIMAL_FORM]
        found = {term[0] for _, term in matches}
        if found == {animal}:
            guarded.append(translated)
            continue
        if len(found) != 1 or not matches:
            raise ValueError("Caption animal terminology is missing or ambiguous")
        # A single recognized wrong animal is correctable only within this cue.
        # Do not perform a global fox-to-tiger replacement across the video.
        for match, (_, form_index) in reversed(matches):
            translated = (translated[:match.start()] + TELUGU_ANIMAL_FORMS[animal][form_index]
                          + translated[match.end():])
        guarded.append(translated)
    return guarded


def log_provider_failure(provider, error):
    # Provider exceptions may contain request URLs, headers, or credentials.
    # Log a useful error category without exposing those values or captions.
    print(f"[Translate] {provider} unavailable ({type(error).__name__})", flush=True)


# ── Translation cache (avoids re-translating the same text) ──────────────────
_cache = OrderedDict()
_cache_lock = Lock()
CACHE_LIMIT = 256
MAX_BATCH_ITEMS = 60
MAX_BATCH_CHARACTERS = 2000
MAX_REQUEST_BYTES = 1024 * 1024

TELUGU_NARRATION_PROMPT = """You are a professional Telugu children's-story translator and voice-over script editor.
Detect the source language and translate the supplied narration into pure, natural, fluent Telugu.

Rules:
- Preserve the complete meaning, events, emotions, suspense, humour, dialogue, and moral.
- Translate contextually, never mechanically word for word.
- Use warm, vivid, child-friendly Telugu that sounds natural when spoken aloud.
- Prefer authentic Telugu storytelling expressions; use "అనగనగా" for "Once upon a time" when appropriate.
- Avoid English words and awkward machine-translated constructions when a natural Telugu expression exists.
- Preserve names, speaker intent, gender, number, and dialogue accurately.
- Repair obvious punctuation/transcription breaks only when the intended meaning is clear from context.
- Do not summarize, omit, explain, censor, or invent events.
- Return exactly one translated string for every input item, in the same order.
- Caption boundaries may split sentences. Read all items as one continuous story before translating them.
- Keep each item's meaning in that item's translation; do not move words to another caption.
- Keep captions concise and use Telugu script so they remain readable within their original display times.
- Output only a valid JSON array of strings. Do not use Markdown.
"""


def caption_translation_prompt(target, texts=None, source="auto"):
    target_code = normalize_lang(target)
    if target_code == "te":
        constraints = []
        for index, text in enumerate(texts or []):
            animals = source_animal_terms(text, source)
            if len(animals) == 1:
                animal = next(iter(animals))
                forms = TELUGU_ANIMAL_FORMS[animal]
                constraints.append(f"- Cue {index + 1}: {animal.replace('_', '/')} = {forms[0]} (plural {forms[1]}).")
        if constraints:
            return (TELUGU_NARRATION_PROMPT + "\nSource-grounded animal terminology for each cue:\n"
                    + "\n".join(constraints) + "\nPreserve these exact animals in their own cues. "
                    "Use natural inflections. Tiger is పులి; fox/jackal is నక్క. Never substitute one for the other.\n")
        return TELUGU_NARRATION_PROMPT
    target_label = LANG_LABELS[target_code]
    return f"""You are a professional caption translator.
Translate every supplied caption into natural, fluent {target_label} ({target_code}).
Use the target language's normal written script.
Preserve meaning, names, numbers, punctuation, tone, and caption order.
Do not summarize, omit, explain, censor, or invent anything.
Return exactly one translated string for every input item, in the same order.
Read all items as continuous narration so split sentences remain coherent.
Keep each item's meaning in its own output item; do not move words across caption boundaries.
Keep captions concise so they remain readable within their original display times.
Output only a valid JSON array of strings. Do not use Markdown.
"""

def local_ai_translate_batch(texts, target, source="auto"):
    """Translate a complete caption sequence with shared narrative context."""
    target_code = normalize_lang(target)
    source_code = normalize_lang(source, allow_auto=True)
    cleaned = validate_texts(texts)
    if source_code == target_code:
        return cleaned
    system_prompt = caption_translation_prompt(target_code, cleaned, source_code)
    request_body = json.dumps({
        "model": OLLAMA_MODEL,
        "stream": False,
        "think": False,
        "format": "json",
        "keep_alive": "10m",
        "options": {"temperature": 0.2, "num_ctx": 4096, "num_predict": 4096},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(cleaned, ensure_ascii=False)},
        ],
    }, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA_URL,
        data=request_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        payload = json.loads(resp.read().decode("utf-8", "ignore"))

    if not isinstance(payload, dict) or not isinstance(payload.get("message"), dict):
        raise ValueError("Local AI returned invalid translation content")
    if payload.get("done") is False or payload.get("done_reason") == "length":
        raise ValueError("Local AI did not finish the caption translation")
    content = payload.get("message", {}).get("content", "")
    if not isinstance(content, str):
        raise ValueError("Local AI returned invalid translation content")
    parsed = json.loads(content)
    if isinstance(parsed, dict):
        parsed = parsed.get("translations") or parsed.get("results") or parsed.get("items")
    return validate_caption_meaning(cleaned, parsed, target_code, source_code)

def gemini_translate_batch(texts, target, source="auto"):
    """Translate captions with shared context and preserve their item alignment."""
    target_code = normalize_lang(target)
    source_code = normalize_lang(source, allow_auto=True)
    cleaned = validate_texts(texts)
    if source_code == target_code:
        return cleaned
    api_key = str(os.environ.get("GEMINI_API_KEY", "")).strip()
    if not api_key and os.path.exists(GEMINI_KEY_PATH):
        with open(GEMINI_KEY_PATH, "r", encoding="utf-8") as key_file:
            api_key = key_file.read().strip()
    if not api_key:
        raise ValueError("Gemini API key is not configured")

    prompt = caption_translation_prompt(target_code, cleaned, source_code) + "\nINPUT JSON:\n" + json.dumps(cleaned, ensure_ascii=False)
    body = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 8192,
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "ARRAY",
                "items": {"type": "STRING"},
            },
        },
    }, ensure_ascii=False).encode("utf-8")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode("utf-8", "ignore"))
    if not isinstance(payload, dict):
        raise ValueError("Gemini returned invalid translation content")
    candidates = payload.get("candidates", [])
    if not isinstance(candidates, list) or not candidates or not isinstance(candidates[0], dict):
        raise ValueError("Gemini returned no completed caption translation")
    candidate = candidates[0]
    if candidate.get("finishReason") not in (None, "STOP"):
        raise ValueError("Gemini did not finish the caption translation")
    content_object = candidate.get("content", {})
    if not isinstance(content_object, dict) or not isinstance(content_object.get("parts", []), list):
        raise ValueError("Gemini returned invalid translation content")
    parts = content_object.get("parts", [])
    content = "".join(part["text"] for part in parts if isinstance(part, dict) and
                      isinstance(part.get("text"), str) and not part.get("thought"))
    parsed = json.loads(content)
    return validate_caption_meaning(cleaned, parsed, target_code, source_code)

def google_translate_direct(text, target, source="auto"):
    query = urllib.parse.urlencode({
        "client": "gtx",
        "sl": source,
        "tl": target,
        "dt": "t",
        "q": text,
    })
    url = "https://translate.googleapis.com/translate_a/single?" + query
    with urllib.request.urlopen(url, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8", "ignore"))
    return "".join(part[0] or "" for part in data[0])

def deep_translate(text, target, source="auto"):
    from deep_translator import GoogleTranslator
    translator = GoogleTranslator(source=source, target=target)
    return translator.translate(text)

def translate_text(text, target, source="auto"):
    text = validate_texts([text])[0]
    target = normalize_lang(target)
    source = normalize_lang(source, allow_auto=True)
    if source == target:
        return text
    # The full source string matters: captions with the same first 120
    # characters can have different endings, names, or instructions.
    cache_key = (source, target, text)
    with _cache_lock:
        if cache_key in _cache:
            _cache.move_to_end(cache_key)
            return _cache[cache_key]
    result = translate_batch([text], target, source)[0]
    with _cache_lock:
        _cache[cache_key] = result
        _cache.move_to_end(cache_key)
        while len(_cache) > CACHE_LIMIT:
            _cache.popitem(last=False)
    return result


def translate_chunk(texts, target, source):
    for provider, translator in (("Gemini", gemini_translate_batch), ("Local AI", local_ai_translate_batch)):
        try:
            results = validate_caption_meaning(texts, translator(texts, target, source), target, source)
            print(f"[Translate] {provider}: {len(results)} captions -> {target}", flush=True)
            return results
        except Exception as error:
            log_provider_failure(provider, error)
    # A failed AI batch must not retry both AI providers once per caption.
    # Each compatibility provider either translates the whole chunk or fails;
    # a partial list is never returned as a successful caption translation.
    engines = (("Google direct", google_translate_direct), ("Google compatibility", deep_translate))
    if target != "te":
        engines = tuple(reversed(engines))
    for provider, translator in engines:
        try:
            results = validate_caption_meaning(texts, [translator(text, target, source) for text in texts], target, source)
            print(f"[Translate] {provider}: {len(results)} captions -> {target}", flush=True)
            return results
        except Exception as error:
            log_provider_failure(provider, error)
    raise TranslationUnavailable("No translation provider returned a complete caption translation")


def translate_batch(texts, target, source="auto"):
    """Return a complete ordered caption list, or fail without partial output."""
    cleaned = validate_texts(texts)
    target = normalize_lang(target)
    source = normalize_lang(source, allow_auto=True)
    if source == target:
        return cleaned
    results, chunk, characters = [], [], 0
    # Bound context/output size for long videos while keeping adjacent cues
    # together. Finish every chunk before returning any replacement captions.
    for text in cleaned:
        if chunk and (len(chunk) >= MAX_BATCH_ITEMS or characters + len(text) > MAX_BATCH_CHARACTERS):
            results.extend(translate_chunk(chunk, target, source))
            chunk, characters = [], 0
        chunk.append(text)
        characters += len(text)
    if chunk:
        results.extend(translate_chunk(chunk, target, source))
    return validate_results(results, len(cleaned))


# ── HTTP Handler ──────────────────────────────────────────────────────────────

class TranslateHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        path = self.path.split("?", 1)[0]
        if path not in ("/health", "/api/translate", "/api/translate/batch"):
            path = "unknown endpoint"
        print(f"[{time.strftime('%H:%M:%S')}] {getattr(self, 'command', 'HTTP')} {path}", flush=True)

    def _send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            self._send_json({"status": "ok", "port": PORT,
                             "supported": list(LANG_LABELS.keys())})
        else:
            self._send_json({"error": "Not found"}, 404)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0:
                raise ValueError("Request body required")
        except (TypeError, ValueError):
            self._send_json({"error": "A valid Content-Length is required"}, 400)
            return
        if length > MAX_REQUEST_BYTES:
            self._send_json({"error": "Translation request is too large"}, 413)
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            self._send_json({"error": "Invalid JSON"}, 400)
            return
        if not isinstance(payload, dict):
            self._send_json({"error": "JSON object required"}, 400)
            return

        path = self.path.rstrip("/")

        if path == "/api/translate":
            try:
                text = validate_texts([payload.get("text")])[0]
                target = normalize_lang(payload.get("target", "en"))
                source = normalize_lang(payload.get("source", "auto"), allow_auto=True)
            except ValueError as error:
                self._send_json({"error": str(error)}, 400)
                return
            try:
                result = validate_results([translate_text(text, target, source)], 1)[0]
                self._send_json({"translated": result, "target": target})
            except Exception as exc:
                log_provider_failure("Translation request", exc)
                self._send_json({"error": "Translation unavailable; no complete caption results were returned"}, 502)

        elif path == "/api/translate/batch":
            try:
                texts = validate_texts(payload.get("texts"))
                target = normalize_lang(payload.get("target", "en"))
                source = normalize_lang(payload.get("source", "auto"), allow_auto=True)
            except ValueError as error:
                self._send_json({"error": str(error)}, 400)
                return
            try:
                results = validate_results(translate_batch(texts, target, source), len(texts))
                self._send_json({"results": results, "target": target})
            except Exception as exc:
                log_provider_failure("Caption batch request", exc)
                self._send_json({"error": "Translation unavailable; no complete caption results were returned"}, 502)

        else:
            self._send_json({"error": "Unknown endpoint"}, 404)


# ── Start ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55, flush=True)
    print("  Caption Translation Server", flush=True)
    print(f"  Port  : {PORT}", flush=True)
    print("  Langs : English | हिंदी | తెలుగు | தமிழ் | اردو | العربية", flush=True)
    print("  Engine: Gemini + Local Ollama + Google last fallback", flush=True)
    print("=" * 55, flush=True)

    # Verify installation only. Do not spend provider quota or trigger HTTP 429
    # by sending online translations every time the desktop app starts.
    try:
        import deep_translator
        print(f"[OK] deep-translator installed ({getattr(deep_translator, '__version__', 'version unknown')})", flush=True)
    except Exception as e:
        print(f"[WARN] deep-translator is not installed: {e}", flush=True)

    # A slow cloud/local-AI request must not block health checks or other jobs.
    server = ThreadingHTTPServer(("127.0.0.1", PORT), TranslateHandler)
    server.daemon_threads = True
    print(f"\n[Ready] Listening on http://127.0.0.1:{PORT}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Stopped]", flush=True)
