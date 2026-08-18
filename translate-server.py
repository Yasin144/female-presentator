"""
translate-server.py
====================
Offline-capable translation server for Voice Presentator Caption Studio.
Uses the local Presentator AI for context-aware Telugu narration, with Google
Translate as a compatibility fallback.

API:
  POST /api/translate  { text, target, source? }  → { translated, target }
  POST /api/translate/batch  { texts:[], target, source? }  → { results:[] }
  GET  /health  → { status }

Ports: 8434
"""

import sys, json, re, os, time, urllib.parse, urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler

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

def normalize_lang(lang):
    return LANG_CODES.get(str(lang or "en").lower().strip(), "en")


# ── Translation cache (avoids re-translating the same text) ──────────────────
_cache = {}

TELUGU_NARRATION_PROMPT = """You are a professional Telugu children's-story translator and voice-over script editor.
Translate the supplied English narration into pure, natural, fluent Telugu.

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
- Output only a valid JSON array of strings. Do not use Markdown.
"""

def local_ai_translate_batch(texts, target, source="auto"):
    """Translate a complete caption sequence with shared narrative context."""
    if normalize_lang(target) != "te":
        raise ValueError("Local narration translation is currently enabled for Telugu only")

    cleaned = [str(item or "").strip() for item in texts]
    request_body = json.dumps({
        "model": OLLAMA_MODEL,
        "stream": False,
        "think": False,
        "format": "json",
        "keep_alive": "10m",
        "options": {"temperature": 0.2, "num_ctx": 4096, "num_predict": 4096},
        "messages": [
            {"role": "system", "content": TELUGU_NARRATION_PROMPT},
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

    content = str(payload.get("message", {}).get("content", "")).strip()
    parsed = json.loads(content)
    if isinstance(parsed, dict):
        parsed = parsed.get("translations") or parsed.get("results") or parsed.get("items")
    if not isinstance(parsed, list) or len(parsed) != len(cleaned):
        raise ValueError(
            f"Local AI returned {len(parsed) if isinstance(parsed, list) else 'invalid'} "
            f"items for {len(cleaned)} captions"
        )
    results = [str(item or "").strip() for item in parsed]
    if any(not item for item in results):
        raise ValueError("Local AI returned an empty translated caption")
    return results

def gemini_translate_batch(texts, target, source="auto"):
    """Create polished Telugu narration while preserving caption alignment."""
    if normalize_lang(target) != "te":
        raise ValueError("Narrative translation is currently enabled for Telugu only")
    api_key = str(os.environ.get("GEMINI_API_KEY", "")).strip()
    if not api_key and os.path.exists(GEMINI_KEY_PATH):
        with open(GEMINI_KEY_PATH, "r", encoding="utf-8") as key_file:
            api_key = key_file.read().strip()
    if not api_key:
        raise ValueError("Gemini API key is not configured")

    cleaned = [str(item or "").strip() for item in texts]
    prompt = TELUGU_NARRATION_PROMPT + "\nINPUT JSON:\n" + json.dumps(cleaned, ensure_ascii=False)
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
    parts = payload.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    content = "".join(str(part.get("text", "")) for part in parts).strip()
    parsed = json.loads(content)
    if not isinstance(parsed, list) or len(parsed) != len(cleaned):
        raise ValueError(f"Gemini returned an invalid caption array ({len(parsed) if isinstance(parsed, list) else 'not a list'})")
    results = [str(item or "").strip() for item in parsed]
    if any(not item for item in results):
        raise ValueError("Gemini returned an empty translated caption")
    return results

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
    return translator.translate(text) or text

def translate_text(text, target, source="auto"):
    text = str(text or "").strip()
    if not text:
        return ""
    target = normalize_lang(target)
    source = normalize_lang(source) if source and source != "auto" else "auto"
    cache_key = f"{source}→{target}:{text[:120]}"
    if cache_key in _cache:
        return _cache[cache_key]

    if target == "te":
        try:
            result = gemini_translate_batch([text], target, source)[0]
            _cache[cache_key] = result
            print(f"[Translate] Telugu narration via Gemini: {text[:80]!r} -> {result[:120]!r}", flush=True)
            return result
        except Exception as e:
            print(f"[Translate] Gemini Telugu narration unavailable; using Google fallback: {e}", flush=True)

    engines = (
        (google_translate_direct, deep_translate)
        if target == "te"
        else (deep_translate, google_translate_direct)
    )

    last_error = None
    for engine in engines:
        try:
            result = engine(text, target, source) or text
            _cache[cache_key] = result
            if target == "te":
                src_preview = text if len(text) <= 80 else text[:80] + "..."
                result_preview = result if len(result) <= 120 else result[:120] + "..."
                print(
                    f"[Translate] Telugu via {engine.__name__}: "
                    f"src_len={len(text)} out_len={len(result)} | "
                    f"{src_preview!r} -> {result_preview!r}",
                    flush=True
                )
            return result
        except Exception as e:
            last_error = e
            print(f"[Translate] {engine.__name__} error: {e}", flush=True)

    print(f"[Translate] All engines failed: {last_error}", flush=True)
    return text


def translate_batch(texts, target, source="auto"):
    """Translate captions together so narration retains story-wide context."""
    if normalize_lang(target) == "te":
        try:
            results = gemini_translate_batch(texts, target, source)
            print(f"[Translate] Telugu narrative batch via Gemini: {len(results)} captions", flush=True)
            return results
        except Exception as e:
            print(f"[Translate] Gemini Telugu narrative batch failed; using Google fallback: {e}", flush=True)
    return [translate_text(t, target, source) for t in texts]


# ── HTTP Handler ──────────────────────────────────────────────────────────────

class TranslateHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[{time.strftime('%H:%M:%S')}] {fmt % args}", flush=True)

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
        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length).decode("utf-8")
        try:
            payload = json.loads(body)
        except Exception:
            self._send_json({"error": "Invalid JSON"}, 400)
            return

        path = self.path.rstrip("/")

        if path == "/api/translate":
            text   = str(payload.get("text", "")).strip()
            target = str(payload.get("target", "en"))
            source = str(payload.get("source", "auto"))
            if not text:
                self._send_json({"error": "text required"}, 400)
                return
            result = translate_text(text, target, source)
            self._send_json({"translated": result, "target": normalize_lang(target)})

        elif path == "/api/translate/batch":
            texts  = [str(t) for t in payload.get("texts", [])]
            target = str(payload.get("target", "en"))
            source = str(payload.get("source", "auto"))
            if not texts:
                self._send_json({"error": "texts array required"}, 400)
                return
            results = translate_batch(texts, target, source)
            self._send_json({"results": results, "target": normalize_lang(target)})

        else:
            self._send_json({"error": "Unknown endpoint"}, 404)


# ── Start ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55, flush=True)
    print("  Caption Translation Server", flush=True)
    print(f"  Port  : {PORT}", flush=True)
    print("  Langs : English | हिंदी | తెలుగు | தமிழ் | اردو | العربية", flush=True)
    print("  Engine: Gemini narration (Telugu) + Google fallback", flush=True)
    print("=" * 55, flush=True)

    # Verify deep-translator
    try:
        from deep_translator import GoogleTranslator
        test = GoogleTranslator(source="en", target="hi").translate("hello")
        print(f"[OK] deep-translator works: 'hello' → '{test}'", flush=True)
    except Exception as e:
        print(f"[WARN] deep-translator test failed: {e}", flush=True)
        print("       Install with: pip install deep-translator", flush=True)

    server = HTTPServer(("127.0.0.1", PORT), TranslateHandler)
    print(f"\n[Ready] Listening on http://127.0.0.1:{PORT}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Stopped]", flush=True)
