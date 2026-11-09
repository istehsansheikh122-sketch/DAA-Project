"""Binary Search Guide - Flask backend.

Frontend (character + animations) sirf *dikhata* hai.
Asal binary search ke steps yahan Python mein calculate hote hain
aur /api/solve JSON mein wapas jate hain.
"""
import time
from collections import defaultdict, deque

from flask import Flask, jsonify, render_template, request

import llm

llm.load_env_file()          # .env file ho to API keys wahan se parh lo
print(llm.describe())        # terminal mein dikhata hai ke key mili ya demo mode

app = Flask(__name__)

MIN_ITEMS = 2
MAX_ITEMS = 15          # screen par saaf dikhne ki limit
MAX_ABS_VALUE = 9999


def binary_search_steps(arr, target):
    """Sorted `arr` mein `target` dhoondo aur har step record karo."""
    low, high = 0, len(arr) - 1
    steps = []
    found_index = -1

    while low <= high:
        mid = (low + high) // 2
        value = arr[mid]

        if value == target:
            result = "found"
        elif value < target:
            result = "right"      # target bada hai -> right half mein dekho
        else:
            result = "left"       # target chhota hai -> left half mein dekho

        steps.append({
            "step": len(steps) + 1,
            "low": low,
            "high": high,
            "mid": mid,
            "value": value,
            "result": result,
        })

        if result == "found":
            found_index = mid
            break
        if result == "right":
            low = mid + 1
        else:
            high = mid - 1

    return steps, found_index


def parse_ints(raw, field):
    """List/number ko int mein badlo. Galat ho to ValueError."""
    try:
        if isinstance(raw, bool):
            raise ValueError
        value = int(raw)
        if isinstance(raw, float) and raw != value:
            raise ValueError
        return value
    except (TypeError, ValueError):
        raise ValueError(f"'{field}' mein sirf poore numbers (integers) allowed hain.")


# Har character ka naam aur jins (f = larki / aurat, m = mard, b = ladka). Naam yahan badlein.
CHARACTER_NAMES = {
    "original": "Fairy Tale",
    "knight": "Bram",
    "arissa": "Nova",
    "boy": "Finn",
}
CHARACTER_GENDER = {"original": "f", "knight": "m", "arissa": "f", "boy": "b"}


@app.get("/")
def index():
    characters = [(cid, name, CHARACTER_GENDER.get(cid, "f")) for cid, name in CHARACTER_NAMES.items()]
    return render_template("index.html", max_items=MAX_ITEMS, min_items=MIN_ITEMS, characters=characters)


@app.get("/api/config")
def config():
    """Browser ko batata hai ke LLM real hai ya demo mode."""
    return jsonify(provider=llm.provider(), model=llm.model_name(), env_file=llm.ENV_STATUS["file"])


# ---- chat (LLM agent) ----
RATE_LIMIT = 20           # ek IP se 1 minute mein itne messages
_hits = defaultdict(deque)


def _rate_limited(ip):
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return True
    q.append(now)
    return False


@app.post("/api/chat")
def chat():
    if _rate_limited(request.remote_addr or "?"):
        return jsonify(error="Bohat zyada messages. Thodi der baad try karein."), 429
    data = request.get_json(silent=True) or {}
    try:
        cid = str(data.get("character") or "original").lower()
        reply, actions = llm.run_agent(
            data.get("message"), data.get("history"), data.get("state"), data.get("lang"),
            name=CHARACTER_NAMES.get(cid, "Guide"), gender=CHARACTER_GENDER.get(cid, "f"))
    except llm.LLMError as exc:
        return jsonify(error=str(exc)), 502
    return jsonify(reply=reply, actions=actions, provider=llm.provider())


@app.post("/api/solve")
def solve():
    data = request.get_json(silent=True) or {}
    raw_array = data.get("array")
    raw_target = data.get("target")

    if not isinstance(raw_array, list):
        return jsonify(error="Array bhejna zaroori hai."), 400
    if not (MIN_ITEMS <= len(raw_array) <= MAX_ITEMS):
        return jsonify(error=f"Array mein {MIN_ITEMS} se {MAX_ITEMS} numbers hone chahiye."), 400
    if raw_target is None or raw_target == "":
        return jsonify(error="Dhoondne wala number (target) bhi likhein."), 400

    try:
        original = [parse_ints(v, "array") for v in raw_array]
        target = parse_ints(raw_target, "target")
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

    if any(abs(v) > MAX_ABS_VALUE for v in original + [target]):
        return jsonify(error=f"Numbers {-MAX_ABS_VALUE} se {MAX_ABS_VALUE} ke beech rakhein."), 400

    sorted_arr = sorted(original)
    steps, index_found = binary_search_steps(sorted_arr, target)

    return jsonify(
        original=original,
        sorted=sorted_arr,
        target=target,
        steps=steps,
        found=index_found != -1,
        index=index_found,
        comparisons=len(steps),
        linear_worst_case=len(sorted_arr),
    )


if __name__ == "__main__":
    app.run(debug=True, port=5000)
