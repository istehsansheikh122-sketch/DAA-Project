"""LLM agent for the character guide.

Character ke chat ke peeche ek chhota "agent" hai:
  * LLM ko screen ki poori state di jati hai (array, target, kaun se steps ho chuke).
  * LLM tools call kar sakta hai: boxes highlight karna, character ko kisi box ke paas
    bhejna, gesture karna, aur kisi step ki details poochna.
  * Server tools chalata hai, aur aakhir mein {reply, actions} browser ko bhejta hai.

Providers (koi extra package nahi, sirf Python ka urllib):
  * OpenRouter  -> OPENROUTER_API_KEY + OPENROUTER_BASE_URL for /chat/completions
  * anthropic  -> OPENROUTER_API_KEY (Anthropic-compatible /v1/messages API)
  * openai     -> OPENAI_API_KEY (+ OPENAI_BASE_URL: OpenAI, Gemini, Groq, Ollama... jo bhi
                  OpenAI-compatible ho)
  * mock       -> koi key na ho to demo mode (built-in simple jawab)
"""
import json
import os
import re
import urllib.error
from urllib.parse import urlsplit
import urllib.request

MAX_AGENT_STEPS = 4
MAX_HISTORY = 10
MAX_MSG_CHARS = 500
MAX_TOKENS = 400
GESTURES = ["nod", "shake", "think", "ack", "happy", "dismiss", "sigh", "wave"]
PHASES = {"intro", "between_steps", "result", "finished"}


class LLMError(Exception):
    """LLM se baat karte waqt masla (user ko dikhane layak message)."""


# ----------------------------------------------------------------- config
APP_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_STATUS = {"file": None, "keys": [], "tried": [], "hint": ""}


def _read_text(path):
    """Windows ke alag alag editors alag encoding mein save karte hain (UTF-8, UTF-8 BOM, UTF-16)."""
    raw = open(path, "rb").read()
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    return raw.decode("utf-8-sig", errors="replace")


def load_env_file(path=None):
    """Chhota sa .env reader (python-dotenv ki zaroorat nahi).

    .env pehle project folder (app.py ke saath) mein dhoondta hai, phir us folder mein jahan se server chalaya.
    Khali (empty) environment variable ko .env ki value se badal deta hai.
    """
    candidates = [path] if path else list(dict.fromkeys(
        [os.path.join(APP_DIR, ".env"), os.path.join(os.getcwd(), ".env")]))
    ENV_STATUS.update(file=None, keys=[], tried=candidates, hint="")
    for p in candidates:
        if not os.path.isfile(p):
            continue
        ENV_STATUS["file"] = p
        for line in _read_text(p).splitlines():
            line = line.strip().lstrip("\ufeff")
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.lower().startswith("export "):
                line = line[7:].strip()
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip()
            if value[:1] in "\"'" and value[-1:] == value[:1] and len(value) >= 2:
                value = value[1:-1]
            elif " #" in value:
                value = value.split(" #", 1)[0].strip()
            if not key or not value:
                continue
            if not os.environ.get(key):
                os.environ[key] = value
            ENV_STATUS["keys"].append(key)
        return ENV_STATUS
    # .env nahi mili: sab se aam galti Windows mein ".env.txt" ban jana hai
    for name in (".env.txt", "env", "env.txt", ".env.example"):
        for base in (APP_DIR, os.getcwd()):
            if os.path.isfile(os.path.join(base, name)) and name != ".env.example":
                ENV_STATUS["hint"] = f"Found '{name}' but the file must be named exactly '.env' (no .txt)."
    return ENV_STATUS


def describe():
    """Server start par terminal mein dikhane ke liye ek line."""
    prov = provider()
    if prov == "mock":
        why = ENV_STATUS["hint"] or (
            f".env found at {ENV_STATUS['file']} but it has no OPENROUTER_API_KEY / OPENAI_API_KEY value."
            if ENV_STATUS["file"] else f"No .env file found (looked in: {', '.join(ENV_STATUS['tried'])}).")
        return f"LLM: DEMO MODE (no key). {why}"
    return f"LLM: {prov} / {model_name()} (key loaded{' from ' + ENV_STATUS['file'] if ENV_STATUS['file'] else ' from environment'})"


def provider():
    name = os.getenv("LLM_PROVIDER", "").strip().lower()
    if name in {"anthropic", "openai", "mock"}:
        return name
    if os.getenv("OPENROUTER_API_KEY"):
        return "openai" if _openrouter_uses_chat_completions() else "anthropic"
    if os.getenv("OPENAI_API_KEY"):
        return "openai"
    return "mock"


def _openrouter_uses_chat_completions():
    base = os.getenv("OPENROUTER_BASE_URL", "").rstrip("/")
    return bool(os.getenv("OPENROUTER_API_KEY")) and (
        base.lower().endswith("/chat/completions")
        or urlsplit(base).hostname == "openrouter.ai"
    )


def model_name():
    prov = provider()
    if prov == "anthropic":
        return os.getenv("OPENROUTER_MODEL", "claude-haiku-5-5")
    if prov == "openai":
        if _openrouter_uses_chat_completions() and not os.getenv("OPENAI_MODEL"):
            return os.getenv("OPENROUTER_MODEL", "openrouter/free")
        return os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    return "demo"


# ----------------------------------------------------------------- tools
TOOLS = [
    {
        "name": "highlight_indices",
        "description": "Screen par kuch boxes (array positions) ko kuch der ke liye highlight karo "
                       "jab tum unke baare mein samjha rahe ho. Indices 0 se shuru hote hain.",
        "input_schema": {
            "type": "object",
            "properties": {"indices": {"type": "array", "items": {"type": "integer"}}},
            "required": ["indices"],
        },
    },
    {
        "name": "walk_to_index",
        "description": "Character ko array ke kisi box ke neeche chala do (jaise us box ko dikhane ke liye).",
        "input_schema": {
            "type": "object",
            "properties": {"index": {"type": "integer"}},
            "required": ["index"],
        },
    },
    {
        "name": "play_gesture",
        "description": "Jawab ke saath character ko ek gesture karwao (nod = haan, shake = nahi, "
                       "think = soch, ack = samajh gayi, happy = khush, dismiss = ignore/hata do).",
        "input_schema": {
            "type": "object",
            "properties": {"name": {"type": "string", "enum": GESTURES}},
            "required": ["name"],
        },
    },
    {
        "name": "get_step_details",
        "description": "Binary search ke kisi step (1 se shuru) ki exact details lo: low, high, mid, "
                       "mid par value aur result. Number quote karne se pehle ise use karo.",
        "input_schema": {
            "type": "object",
            "properties": {"step": {"type": "integer"}},
            "required": ["step"],
        },
    },
]


def execute_tool(call, state, actions):
    """Tool chalao. UI tools `actions` mein jama hote hain (browser unhein chalata hai)."""
    name, args = call["name"], call.get("args") or {}
    n = len(state["sorted"])

    if name == "highlight_indices":
        raw = args.get("indices")
        idx = [i for i in (raw if isinstance(raw, list) else []) if isinstance(i, int) and 0 <= i < n][:6]
        if not idx:
            return f"Error: indices 0 se {n - 1} ke beech hone chahiye."
        actions.append({"type": "highlight", "indices": idx})
        return "Done: boxes screen par highlight ho gaye."

    if name == "walk_to_index":
        i = args.get("index")
        if not isinstance(i, int) or not 0 <= i < n:
            return f"Error: index 0 se {n - 1} ke beech hona chahiye."
        actions.append({"type": "walk", "index": i})
        return "Done: character wahan jaa raha hai."

    if name == "play_gesture":
        g = args.get("name")
        if g not in GESTURES:
            return "Error: gesture ka naam " + ", ".join(GESTURES) + " mein se ho."
        actions.append({"type": "gesture", "name": g})
        return "Done: gesture ho raha hai."

    if name == "get_step_details":
        k = args.get("step")
        for s in state["steps"]:
            if s["step"] == k:
                return json.dumps(s)
        return "Error: aisa step nahi hai. Total steps: " + str(len(state["steps"]))

    return "Error: unknown tool."


# ----------------------------------------------------------------- state / prompt
def _ints(value, limit):
    out = []
    for v in (value if isinstance(value, list) else [])[:limit]:
        if isinstance(v, bool) or not isinstance(v, int):
            continue
        out.append(v)
    return out


def sanitize_state(raw):
    """Browser se aayi state ko saaf aur chhota karo (kuch bhi trust nahi)."""
    s = raw if isinstance(raw, dict) else {}
    steps = []
    for st in (s.get("steps") if isinstance(s.get("steps"), list) else [])[:8]:
        try:
            item = {k: int(st[k]) for k in ("step", "low", "high", "mid", "value")}
            item["result"] = st.get("result") if st.get("result") in {"found", "left", "right"} else "right"
            steps.append(item)
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
    target = s.get("target")
    done = s.get("done")
    index = s.get("index")
    return {
        "sorted": _ints(s.get("sorted"), 15),
        "target": target if isinstance(target, int) and not isinstance(target, bool) else None,
        "steps": steps,
        "done": max(0, min(done, len(steps))) if isinstance(done, int) else 0,
        "found": bool(s.get("found")),
        "index": index if isinstance(index, int) else -1,
        "phase": s.get("phase") if s.get("phase") in PHASES else "between_steps",
    }


def build_system_prompt(state, lang):
    if lang == "ur":
        language = ("Roman Urdu (Urdu angrezi huroof mein, jaise 'main dhoondti hoon'). Tum female ho, "
                    "isliye female verb forms use karo. Agar user Urdu script mein likhe tab bhi jawab Roman Urdu mein do.")
    else:
        language = "simple, friendly English."
    return f"""You are the friendly on-screen guide character of a "Binary Search" teaching demo.
A student is watching you find a number in a sorted array using binary search. You already
explained the steps out loud; now the student is asking you questions.

LANGUAGE: reply only in {language}
STYLE: your reply is spoken aloud in a speech bubble, so keep it SHORT (1-3 sentences, under 45
words), warm and clear. No markdown, no bullet points, no emojis. Use concrete numbers and
indices from the state below. If the student seems confused, explain with a tiny example.
Don't give away steps that haven't happened yet unless the student asks what comes next.
If the question is unrelated to binary search / this demo, politely steer back in one sentence.

TOOLS: use them when helpful, and always finish with a short spoken reply.
 - highlight_indices: when you refer to specific boxes (low / mid / high, discarded half...).
 - walk_to_index: to go stand under a box you are talking about.
 - play_gesture: one fitting gesture (nod, shake, think, ack, happy, dismiss, sigh, wave).
 - get_step_details: to check the exact numbers of a step before quoting them.

CURRENT STATE (JSON):
{json.dumps(state)}
(`done` = how many search steps have been completed so far; `phase` = where the show is now.)"""


# ----------------------------------------------------------------- HTTP helper
def _post(url, headers, payload, timeout=45):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:300]
        raise LLMError(f"LLM API error {exc.code}: {body}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise LLMError(f"LLM se rabta nahi hua: {exc}") from None
    except json.JSONDecodeError:
        raise LLMError("LLM ka jawab samajh nahi aaya.") from None


def _alternate(history, message):
    """History ko user/assistant ki alternate list banao jo user se shuru aur user par khatam ho."""
    msgs = []
    for h in (history if isinstance(history, list) else [])[-MAX_HISTORY:]:
        if not isinstance(h, dict):
            continue
        role = "assistant" if h.get("role") == "assistant" else "user"
        text = str(h.get("text", ""))[:MAX_MSG_CHARS].strip()
        if not text:
            continue
        if msgs and msgs[-1]["role"] == role:
            msgs[-1]["content"] += "\n" + text
        else:
            msgs.append({"role": role, "content": text})
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    if msgs and msgs[-1]["role"] == "user":
        msgs[-1]["content"] += "\n" + message
    else:
        msgs.append({"role": "user", "content": message})
    return msgs


# ----------------------------------------------------------------- adapters
class AnthropicAdapter:
    def __init__(self):
        self.key = os.environ["OPENROUTER_API_KEY"]
        self.url = os.getenv("OPENROUTER_BASE_URL", "https://api.anthropic.com").rstrip("/") + "/v1/messages"

    def init(self, system, history, message):
        return {"system": system, "messages": _alternate(history, message)}

    def step(self, conv):
        data = _post(
            self.url,
            {"x-api-key": self.key, "anthropic-version": "2023-06-01"},
            {
                "model": model_name(),
                "max_tokens": MAX_TOKENS,
                "system": conv["system"],
                "tools": TOOLS,
                "messages": conv["messages"],
            },
        )
        blocks = data.get("content") or []
        conv["messages"].append({"role": "assistant", "content": blocks})
        text = " ".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
        calls = [
            {"id": b["id"], "name": b["name"], "args": b.get("input") or {}}
            for b in blocks if b.get("type") == "tool_use"
        ]
        return text, calls

    def add_results(self, conv, results):
        conv["messages"].append({
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": cid, "content": out} for cid, _name, out in results],
        })


class OpenAIAdapter:
    def __init__(self):
        if _openrouter_uses_chat_completions():
            self.key = os.environ.get("OPENROUTER_API_KEY", "")
            base = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
        else:
            self.key = os.environ.get("OPENAI_API_KEY", "")
            base = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        self.url = base if base.lower().endswith("/chat/completions") else base + "/chat/completions"
        self.tools = [
            {"type": "function", "function": {
                "name": t["name"], "description": t["description"], "parameters": t["input_schema"]}}
            for t in TOOLS
        ]

    def init(self, system, history, message):
        return {"messages": [{"role": "system", "content": system}] + _alternate(history, message)}

    def step(self, conv):
        headers = {"Authorization": f"Bearer {self.key}"} if self.key else {}
        data = _post(self.url, headers, {
            "model": model_name(),
            "max_tokens": MAX_TOKENS,
            "tools": self.tools,
            "tool_choice": "auto",
            "messages": conv["messages"],
        })
        try:
            msg = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError):
            raise LLMError("LLM ka jawab samajh nahi aaya.") from None
        conv["messages"].append(msg)
        calls = []
        for tc in msg.get("tool_calls") or []:
            try:
                args = json.loads(tc["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            calls.append({"id": tc["id"], "name": tc["function"]["name"], "args": args})
        return (msg.get("content") or "").strip(), calls

    def add_results(self, conv, results):
        for cid, _name, out in results:
            conv["messages"].append({"role": "tool", "tool_call_id": cid, "content": out})


# ----------------------------------------------------------------- demo / mock mode
def _recap_step(state):
    steps = state["steps"]
    if not steps:
        return None
    return steps[state["done"] - 1] if state["done"] > 0 else steps[0]


def mock_reply(message, state, lang, actions):
    """Key na ho to simple rule-based jawab (taake demo phir bhi chale)."""
    ur = lang == "ur"
    m = message.lower()
    step = _recap_step(state)
    t = state["target"]

    def pick(en, ur_text):
        return ur_text if ur else en

    def has(*words):
        return any(w in m for w in words)

    if step and has("mid", "middle", "darmiyan", "centre", "center", "kaise nikal", "kese nikal"):
        low, high, mid, val = step["low"], step["high"], step["mid"], step["value"]
        actions += [{"type": "highlight", "indices": [mid]}, {"type": "gesture", "name": "ack"}]
        return pick(
            f"The middle is (low + high) // 2. In step {step['step']}: ({low} + {high}) // 2 = {mid}, "
            f"and index {mid} holds {val}.",
            f"Darmiyan = (low + high) // 2. Step {step['step']} mein: ({low} + {high}) // 2 = {mid}, "
            f"aur index {mid} par {val} hai.")

    if has("sort", "sorted"):
        actions.append({"type": "gesture", "name": "think"})
        return pick(
            "Binary search needs a sorted list: only then can I say that everything on one side of the middle "
            "is smaller and everything on the other side is bigger.",
            "Binary search ke liye list sorted honi zaroori hai, tab hi hum keh sakte hain ke darmiyan ke ek "
            "taraf sab chhote aur doosri taraf sab bade number hain.")

    if has("half", "aadha", "adha", "ignore", "discard", "phenk", "hata"):
        actions.append({"type": "gesture", "name": "dismiss"})
        if step:
            lo, hi = (0, step["mid"]) if step["result"] == "right" else (step["mid"], len(state["sorted"]) - 1)
            actions.append({"type": "highlight", "indices": [lo, hi]})
        return pick(
            "If the middle number is smaller than my target, the target can't be on the left, so that half is "
            "thrown away. If it's bigger, I throw away the right half.",
            "Agar darmiyan wala number target se chhota ho to target left mein ho hi nahi sakta, is liye wo hissa "
            "phenk dete hain. Agar bada ho to right hissa phenk dete hain.")

    if has("log", "complex", "fast", "tez", "time", "speed", "o("):
        n = max(len(state["sorted"]), 1)
        actions.append({"type": "gesture", "name": "happy"})
        return pick(
            f"Every step cuts the list in half, so even a huge list needs only about log2(n) steps. "
            f"For your {n} numbers that's at most {n.bit_length()} steps.",
            f"Har step list ko aadha kar deta hai, is liye bari list mein bhi sirf log2(n) steps lagte hain. "
            f"Aap ke {n} numbers ke liye zyada se zyada {n.bit_length()} steps.")

    if step and has("again", "repeat", "dobara", "samajh", "confus", "explain", "phir", "wapas", "?"):
        low, high, mid, val = step["low"], step["high"], step["mid"], step["value"]
        actions += [{"type": "highlight", "indices": sorted({low, mid, high})}, {"type": "gesture", "name": "ack"}]
        side = {"found": "found it", "right": "go right", "left": "go left"}[step["result"]]
        side_ur = {"found": "mil gaya", "right": "right mein jao", "left": "left mein jao"}[step["result"]]
        return pick(
            f"Sure! In step {step['step']} my window was index {low} to {high}. The middle index {mid} holds {val}, "
            f"compared with {t} that means: {side}.",
            f"Zaroor! Step {step['step']} mein meri window index {low} se {high} thi. Darmiyan index {mid} par {val} hai, "
            f"aur {t} se compare karne par matlab: {side_ur}.")

    actions.append({"type": "gesture", "name": "nod"})
    return pick(
        "I'm in demo mode (no LLM key is set), so I only know a few things. Try asking: how is the middle "
        "found, why must the list be sorted, why do we ignore half, or explain this step again.",
        "Main demo mode mein hoon (LLM key set nahi hai), is liye kam cheezein jaanti hoon. Poochiye: darmiyan "
        "kaise nikalte hain, list sorted kyun chahiye, aadha hissa kyun phenkte hain, ya ye step dobara samjhayein.")


# ----------------------------------------------------------------- agent loop
def run_agent(message, history, raw_state, lang):
    """Return (reply_text, actions)."""
    message = str(message or "").strip()[:MAX_MSG_CHARS]
    if not message:
        raise LLMError("Message khali hai.")
    lang = "ur" if lang == "ur" else "en"
    state = sanitize_state(raw_state)
    actions = []

    prov = provider()
    if prov == "mock":
        return mock_reply(message, state, lang, actions), actions

    adapter = AnthropicAdapter() if prov == "anthropic" else OpenAIAdapter()
    conv = adapter.init(build_system_prompt(state, lang), history, message)
    texts = []
    for _ in range(MAX_AGENT_STEPS):
        text, calls = adapter.step(conv)
        if text:
            texts.append(text)
        if not calls:
            break
        adapter.add_results(conv, [(c["id"], c["name"], execute_tool(c, state, actions)) for c in calls])

    reply = " ".join(texts).strip()
    reply = re.sub(r"[*_`#]+", "", reply)          # markdown hata do (bol kar padha jayega)
    if not reply:
        reply = "Hmm, mujhe samajh nahi aaya, dobara poochiye?" if lang == "ur" else "Hmm, I didn't catch that. Could you ask again?"
    return reply, actions[:6]
