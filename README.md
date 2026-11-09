# Binary Search Guide

Flask project: ek 3D character guide khud binary search karke number dhoondta hai, bolta hai, aur aap us se sawal bhi pooch sakte hain (LLM agent).

## Chalane ka tareeqa

```bash
pip install -r requirements.txt
python app.py
```

Browser mein kholein: http://127.0.0.1:5000 (Chrome ya Edge behtar hain, voice ke liye).

Bina API key ke bhi chalta hai: chat "demo mode" mein kuch built-in jawab deti hai. Asli LLM agent ke liye key lagayein (neeche).

## Flow

1. Preloader (character load hota hai)
2. Popup form: array, dhoondne wala number, language, voice, **character**, skin tone
3. Array ke gol boxes screen ke sab taraf se aate hain, shuffle hote hain, phir sort hote hain
4. Character left se right chal kar aata hai aur wave karta hai
5. Character khud binary search karta hai aur har step speech bubble mein samjhata hai (aur bolta hai)
6. Number mile to character utha leta hai aur dance karta hai (na mile to head shake)

**Presentation mode:** har step ke baad `↓` dabana padta hai (upar "Manual ↓ / Auto" se badal sakte hain).

## Characters

Form mein "Guide's character" se chunein: Original, Knight, Arissa, Boy. Sab Mixamo ke characters hain aur ek hi animation set (`character.glb` ke 12 clips) share karte hain.

- Knight, Arissa, Boy FBX files se load hote hain (`static/models/knight.fbx`, `arissa.fbx`, `boy.fbx`), sirf jab chune jayein.
- FBX mein har mesh ke saath skeleton ki alag copy aati hai. `stage.js` mein `rebuildRig()` unhein ek skeleton bana deta hai, warna animation sirf aadhi body ko chalati.
- Har character ka kad original ke barabar kar diya jata hai, aur Hips ki position wali track uske qad ke hisaab se scale hoti hai.
- Skin-tone picker sab characters ke liye hai. Sirf skin (chehra, haath) badalti hai, kapre aur armour nahi. Har character ke skin wale mesh ka naam `static/js/main.js` ke `CHARACTERS` mein `skin.meshes` mein likha hai.

**Naya Mixamo character add karna:**
1. Mixamo se character download karein: FBX Binary, **With Skin**, T-pose (animation ki zaroorat nahi).
2. File `static/models/` mein rakhein, jaise `static/models/mera.fbx`.
3. `static/js/main.js` ke `CHARACTERS` mein ek line add karein: `mera: { id: 'mera', type: 'fbx', url: MODELS_BASE + 'mera.fbx', tone: false }`
4. `templates/index.html` ke `#charInput` mein ek `<option value="mera">` add karein.

Jis character mein standard Mixamo bones (`mixamorig:Hips`, `Spine`, `LeftArm` ...) na hon, us par ye animations nahi chalengi.

## Background music

- Upar "Music On / Off". Browser pehle click ya tap ke baghair awaaz nahi chalne deta, is liye On karne par ya Start dabane par shuru hoti hai.
- Apna track lagane ke liye file `static/audio/music.mp3` (ya `.ogg`, `.m4a`, `.wav`) rakh dein. Wo loop hota hai.
- File na ho to page khud ek halki ambient dhun banata hai (koi copyright ka masla nahi).
- Character bolta hai to music dheemi ho jati hai.

## Phone / mobile

- Phone (portrait) par controls do line mein aate hain, bubble character ke sar ke upar aata hai, character thoda chhota hota hai, aur "Press ↓" ki jagah "Tap" likha aata hai (hint par tap karke agla step).
- Array ke 10 se zyada numbers phone par bohat chhote dikhte hain. Phone par 7-10 numbers behtar hain.

## Voice

- Character ki awaaz browser ki Web Speech API se aati hai (koi key nahi chahiye). Upar left mein Voice On/Off, aur form mein awaaz chun sakte hain.
- Roman Urdu ke liye `ur-PK` awaaz chahiye. Jo browser ya computer mein na ho to wo kisi aur awaaz se Roman Urdu parhta hai, jo ajeeb sunai de sakta hai. Aisi surat mein English ya Voice Off rakhein.
- Mic button se bolkar sawal pooch sakte hain (Chrome / Edge).

## Character se baat (LLM agent)

- Chat bar har step ke baad (jab `↓` ka intezar ho) aur character idle ho to khulta hai. Narration ke dauran band rehta hai. Shortcut: `/` dabane se chat par focus.
- Sawal poochne par character sochta hai (think gesture), jawab bolta hai, aur zaroorat ho to boxes highlight karta hai, chal kar kisi box ke paas jata hai, ya gesture karta hai.
- Agent ke tools: `highlight_indices`, `walk_to_index`, `play_gesture` (screen par action) aur `get_step_details` (server par step ki detail).
- Server sirf search ki state (sorted array, steps, target) agent ko deta hai. Key browser ko kabhi nahi milti.
- Rate limit: 20 requests / minute / IP (`app.py`).

### API key lagana

`.env.example` ko `.env` naam se copy karein aur ek provider ki key bharein:

| Variable | Matlab |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter key ya Anthropic-compatible API key |
| `OPENROUTER_MODEL` | model ka naam (OpenRouter default `openrouter/free`; Anthropic default `claude-haiku-5-5`) |
| `OPENROUTER_BASE_URL` | OpenRouter URL (`https://openrouter.ai/api/v1` ya full `/chat/completions` URL), ya Anthropic-compatible API ka base URL |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | OpenAI ya koi OpenAI-compatible service (Groq, OpenRouter, local) |
| `LLM_PROVIDER` | `anthropic`, `openai` ya `mock` (zabardasti choose karne ke liye) |

OpenRouter ka base URL agar `openrouter.ai` par ho ya `/chat/completions` par khatam ho, to app OpenAI-compatible API format, Bearer authentication, aur `OPENROUTER_MODEL` use karti hai. Doosre `OPENROUTER_BASE_URL` values Anthropic-compatible `/v1/messages` API ke liye hain.

**Agar abhi bhi demo mode dikhe:**
1. File ka naam bilkul `.env` hona chahiye (Windows mein aksar `.env.txt` ban jata hai: File Explorer mein View, Show, File name extensions on karke dekhein).
2. `.env` `app.py` ke saath usi folder mein ho.
3. Line aise ho: `OPENROUTER_API_KEY=your-api-key` (khali value ya `#` se shuru line ignore hoti hai).
4. `.env` badalne ke baad server band karke dobara `python app.py` chalayein.
5. Server shuru hote hi terminal mein ek line aati hai: `LLM: anthropic / ...` (key mili) ya `LLM: DEMO MODE ...` ke saath wajah. Browser mein `http://127.0.0.1:5000/api/config` bhi provider batata hai.

Model ka naam aapke account mein jo model mojood ho wahi likhein. Agar `/api/chat` 502 de to server ke terminal mein error dekhein (aksar galat key ya model naam).

## Tests

```bash
python -m unittest discover -s tests
```

Ye tests ek nakli LLM server se agent loop, tools, rate limit aur mock mode check karte hain (asli key ki zaroorat nahi).

## Files

| File | Kaam |
|---|---|
| `app.py` | Flask server: `/api/solve` (steps), `/api/chat` (agent), `/api/config` |
| `llm.py` | LLM agent: tools, system prompt, Anthropic / OpenAI adapters, mock mode |
| `templates/index.html` | Page (preloader, form, chat bar, bubble) |
| `static/js/main.js` | Poora show: steps, chat, characters ka intezam |
| `static/js/stage.js` | Three.js: character load (GLB / FBX), walk, gestures, head tracking |
| `static/js/array-view.js` | Boxes ki animation: fly-in, shuffle, sort, highlight |
| `static/js/bubble.js` | Character ke chehre ke saath speech bubble |
| `static/js/speech.js` | Awaaz (text-to-speech) aur mic (speech-to-text) |
| `static/js/chat.js` | Chat bar aur conversation log |
| `static/js/music.js` | Background music (apni file ya khud bani dhun) |
| `static/audio/` | Apna `music.mp3` yahan rakhein |
| `static/js/i18n.js` | Character ke sentences (English / Roman Urdu) |
| `static/css/style.css` | Design (soft colours, gol shapes) |
| `static/img/bg.jpg` | Background image |
| `static/models/character.glb` | Original character + sab 12 animations |
| `static/models/*.fbx` | Knight, Arissa, Boy |
| `static/vendor/three/` | Three.js (local copy, internet ki zaroorat nahi) |
| `tests/test_agent.py` | Agent ke tests |

## Customize

- **Background badalna:** `static/img/bg.jpg` replace karein.
- **Sentences badalna:** `static/js/i18n.js`
- **Array ki limit:** `MAX_ITEMS` in `app.py`
- **Character ke pair ki jagah / size:** `FEET_FRAC` aur `CAM_D` in `static/js/stage.js`
- **Speed:** page ke upar right mein 1x / 1.5x / 2x buttons
- **Animations:** clips ke naam: `walk, idle, hiphop, wave, pickup, nod, shake, dismiss, ack, happy, think, sigh`
