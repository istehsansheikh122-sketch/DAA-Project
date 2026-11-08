# Binary Search Guide

Flask project: ek 3D character guide khud binary search karke number dhoondta hai.

## Chalane ka tareeqa

```bash
pip install -r requirements.txt
python app.py
```

Browser mein kholein: http://127.0.0.1:5000

## Railway par deploy karna

GitHub repository ko Railway se connect karein. `Procfile` Gunicorn web server
start karta hai, jo Railway ke `PORT` par `0.0.0.0` se listen karta hai. AI chat
aur speech ke liye zaroori API keys Railway service ke Variables tab mein set
karein; `.env` ko GitHub par upload na karein.

## AI chat aur spoken replies

Project root ki `.env` file mein apni OpenRouter key daalein:

```env
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1/chat/completions
OPENROUTER_SITE_URL=
OPENROUTER_APP_NAME=Binary Search Guide
OPENROUTER_REASONING_EFFORT=minimal
OPENAI_API_KEY=your_openai_api_key
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=nova
```

Server restart karne ke baad page ke neeche message field se guide ko likhein. Jawab
character ke speech bubble mein aayega aur character use bolega. Character ke walkthrough
ke jumle bhi bol kar sunaaye jaate hain. Browser mein feminine voice select hoti hai jab
`OPENAI_API_KEY` set ho to natural OpenAI TTS voice use hoti hai (`nova` by default).
Is service has separate usage charges and requires an OpenAI API key; OpenRouter alone
does not provide this speech. Without the key or if the service fails, the app falls
back to the best feminine browser voice available. Actual browser voice quality depends
on the installed browser/operating-system voices. Koi microphone ya voice input nahi hai.
Browser voice support na kare to text bubble kaam karta rahega.
`.env` mein secrets rakhein; yeh file Git ke liye ignore hoti hai. OpenRouter request
logic `chat_agent.py` mein hai; LLM key browser ko kabhi nahi bheji jati. Jawabat
chhote headings aur bullet/numbered lines mein format hote hain. Agar model text content
na de ya token limit par ruk jaye, chat OpenRouter error ka wazeh sabab dikhati hai.
`OPENROUTER_REASONING_EFFORT=minimal` reasoning models ko kam internal tokens istemal
karne ke liye set karta hai; agar response phir bhi truncate ho to app zyada token budget
ke saath ek baar dobara try karti hai.

## Flow

1. Preloader (character load hota hai)
2. Popup form: array + dhoondne wala number (aur guide ki language)
3. Array ke gol boxes screen ke sab taraf se aate hain, shuffle hote hain, phir sort hote hain
4. Character left se right chal kar aata hai aur wave karta hai
5. Character khud binary search karta hai aur har step speech bubble mein samjhata hai
6. Number mile to character utha leta hai aur dance karta hai (na mile to head shake)

## Files

| File | Kaam |
|---|---|
| `app.py` | Flask server. `/api/solve` binary search ke steps calculate karta hai |
| `chat_agent.py` | OpenRouter LLM connection aur character chat |
| `templates/index.html` | Page (preloader, form, bubble) |
| `static/js/main.js` | Poora show: steps ko character aur boxes ke saath chalata hai |
| `static/js/stage.js` | Three.js: character load, walk, gestures, head tracking |
| `static/js/array-view.js` | Boxes ki animation: fly-in, shuffle, sort, highlight |
| `static/js/bubble.js` | Character ke chehre ke saath speech bubble |
| `static/js/i18n.js` | Character ke sentences (English / Roman Urdu) |
| `static/css/style.css` | Design (soft colours, gol shapes) |
| `static/img/bg.jpg` | Background image (apni image se badal sakte hain) |
| `static/models/character.glb` | Character + sab animations |

## Customize

- **Background badalna:** `static/img/bg.jpg` replace karein. Floor ka upar wala kinara screen ki lagbhag 66% height par rakhein, taake character floor par khada dikhe.
- **Sentences badalna:** `static/js/i18n.js`
- **Array ki limit:** `MAX_ITEMS` in `app.py`
- **Character ke pair ki jagah / size:** `FEET_FRAC` aur `CAM_D` in `static/js/stage.js`
- **Speed:** page ke upar right mein 1x / 1.5x / 2x buttons
- **Animations:** GLB ke andar clips ke naam: `walk, idle, hiphop, wave, pickup, nod, shake, dismiss, ack, happy, think, sigh`
