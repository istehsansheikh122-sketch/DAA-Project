"""Binary Search Guide - Flask backend.

Frontend (character + animations) sirf *dikhata* hai.
Asal binary search ke steps yahan Python mein calculate hote hain
aur /api/solve JSON mein wapas jate hain.
"""
import os

from flask import Flask, Response, jsonify, render_template, request
from chat_agent import ChatAgentError, generate_reply, generate_speech

app = Flask(__name__)

MIN_ITEMS = 2
MAX_ITEMS = 15          # screen par saaf dikhne ki limit
MAX_ABS_VALUE = 9999
MAX_CHAT_MESSAGES = 12
MAX_CHAT_MESSAGE_LENGTH = 1200


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


@app.get("/")
def index():
    return render_template(
        "index.html",
        max_items=MAX_ITEMS,
        min_items=MIN_ITEMS,
        natural_voice_enabled=bool(os.getenv("OPENAI_API_KEY", "").strip()),
    )


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


@app.post("/api/chat")
def chat():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="Chat request JSON is required."), 400

    messages = data.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= MAX_CHAT_MESSAGES:
        return jsonify(error=f"Send between 1 and {MAX_CHAT_MESSAGES} chat messages."), 400

    clean_messages = []
    for message in messages:
        if not isinstance(message, dict):
            return jsonify(error="Chat messages must have a user or assistant role."), 400
        role = message.get("role")
        if not isinstance(role, str) or role not in {"user", "assistant"}:
            return jsonify(error="Chat messages must have a user or assistant role."), 400
        content = message.get("content")
        if not isinstance(content, str) or not content.strip() or len(content) > MAX_CHAT_MESSAGE_LENGTH:
            return jsonify(error=f"Each chat message must contain 1 to {MAX_CHAT_MESSAGE_LENGTH} characters."), 400
        clean_messages.append({"role": role, "content": content.strip()})

    if clean_messages[-1]["role"] != "user":
        return jsonify(error="The latest chat message must be from the user."), 400

    language = data.get("language", "en")
    if not isinstance(language, str) or language not in {"en", "ur"}:
        return jsonify(error="Choose English or Roman Urdu for the guide."), 400

    try:
        reply = generate_reply(clean_messages, data.get("context"), language)
    except ChatAgentError as exc:
        return jsonify(error=str(exc)), exc.status_code

    return jsonify(reply=reply)


@app.post("/api/speak")
def speak():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="Speech request JSON is required."), 400
    text = data.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > 1200:
        return jsonify(error="Speech text must contain 1 to 1200 characters."), 400
    language = data.get("language", "en")
    if not isinstance(language, str) or language not in {"en", "ur"}:
        return jsonify(error="Choose English or Roman Urdu for the guide."), 400
    try:
        audio = generate_speech(text.strip(), language)
    except ChatAgentError as exc:
        return jsonify(error=str(exc)), exc.status_code
    response = Response(audio, mimetype="audio/mpeg")
    response.headers["Cache-Control"] = "no-store"
    return response


if __name__ == "__main__":
    app.run(debug=True, port=5000)
