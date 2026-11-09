// Voice: character ki awaaz (text-to-speech) aur mic se sawal (speech-to-text).
// Browser ki Web Speech API use hoti hai: Chrome / Edge mein behtareen chalti hai, koi API key nahi chahiye.

// Har language ke liye kaun si awaazein pasand hain (pehli sab se behtar)
const LANG_PREFS = {
  en: ['en-US', 'en-GB', 'en-IN', 'en-AU', 'en'],
  ur: ['ur-PK', 'ur-IN', 'ur', 'hi-IN', 'hi', 'en-IN'],
};
const FEMALE = /female|zira|aria|jenny|samantha|susan|hazel|heera|uzma|kalpana|swara|sonia|libby|natasha|ava|emma|allison|karen|moira|tessa|veena|catherine|neerja|salman?a/i;

export class Speech {
  constructor() {
    this.supported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
    this.enabled = this.supported;
    this.voiceURI = '';
    this.rate = 1;
    this.lang = 'en';
    this.onBoundary = null;          // har lafz par callback (agar voice support kare)
  }

  // voices kabhi kabhi der se load hoti hain
  async ready() {
    if (!this.supported || speechSynthesis.getVoices().length) return;
    await new Promise(resolve => {
      const t = setTimeout(resolve, 1500);
      speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }

  voices() { return this.supported ? speechSynthesis.getVoices() : []; }

  // is language ke liye awaazein, behtareen pehle (female ko thoda aage)
  voicesFor(lang) {
    const prefs = LANG_PREFS[lang] || LANG_PREFS.en;
    const rank = v => {
      const i = prefs.findIndex(p => v.lang === p || v.lang.startsWith(p + '-') || v.lang.replace('_', '-') === p);
      return i === -1 ? 99 : i;
    };
    const all = this.voices().map(v => ({ v, r: rank(v) }));
    const matching = all.filter(x => x.r < 99);
    const pool = matching.length ? matching : all;
    return pool
      .sort((a, b) => (a.r - b.r) || (FEMALE.test(b.v.name) - FEMALE.test(a.v.name)) || (b.v.localService - a.v.localService))
      .map(x => x.v);
  }

  best(lang) { return this.voicesFor(lang)[0] || null; }

  // text bolo. Promise tab resolve hota hai jab awaaz khatam (ya error / timeout)
  speak(text) {
    if (!this.enabled || !this.supported) return Promise.resolve();
    return new Promise(resolve => {
      let timer;
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const v = this.voices().find(x => x.voiceURI === this.voiceURI) || this.best(this.lang);
        if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = this.lang === 'ur' ? 'ur-PK' : 'en-US'; }
        u.rate = this.rate;
        u.pitch = 1.05;
        let done = false;
        const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
        u.onend = finish;
        u.onerror = finish;
        u.onboundary = e => { if (this.onBoundary && e.name !== 'sentence') this.onBoundary(e); };
        // Chrome kabhi 'end' event nahi deta, is liye safety timeout
        timer = setTimeout(() => { try { speechSynthesis.cancel(); } catch { /* ignore */ } finish(); }, text.length * 120 / this.rate + 4000);
        speechSynthesis.speak(u);
      } catch (err) {
        // voice mein koi bhi masla ho, show nahi rukna chahiye: bas bina awaaz ke aage badho
        console.warn('Speech failed:', err);
        clearTimeout(timer);
        resolve();
      }
    });
  }

  cancel() { try { if (this.supported) speechSynthesis.cancel(); } catch { /* ignore */ } }
}

// Mic se bolna (speech recognition)
export class Listener {
  constructor() {
    this.SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!this.SR;
    this.rec = null;
    this.active = false;
  }

  start(lang, { onText, onState }) {
    if (!this.supported) return;
    this.stop();
    const rec = new this.SR();
    rec.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = e => {
      let text = '', final = false;
      for (const r of e.results) { text += r[0].transcript; final = final || r.isFinal; }
      onText(text.trim(), final);
    };
    rec.onend = () => { this.active = false; onState(false); };
    rec.onerror = () => { this.active = false; onState(false); };
    this.rec = rec;
    this.active = true;
    onState(true);
    try { rec.start(); } catch { this.active = false; onState(false); }
  }

  stop() {
    if (this.rec) { try { this.rec.stop(); } catch { /* ignore */ } }
    this.active = false;
  }
}
