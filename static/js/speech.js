// Voice: character ki awaaz (text-to-speech) aur mic se sawal (speech-to-text).
// Browser ki Web Speech API use hoti hai: Chrome / Edge mein behtareen chalti hai, koi API key nahi chahiye.

// Har language ke liye kaun si awaazein pasand hain (pehli sab se behtar)
const LANG_PREFS = {
  en: ['en-US', 'en-GB', 'en-IN', 'en-AU', 'en'],
  ur: ['ur-PK', 'ur-IN', 'ur', 'hi-IN', 'hi', 'en-IN'],
};
const MALE = /\b(male|david|mark|guy|ryan|james|george|alex|daniel|fred|tom|thomas|christopher|eric|brian|roger|steffan|connor|liam|william|oliver|ravi|hemant|prabhat|asad|salman|madhur|rishi|arthur|aaron|gordon|rocko|reed|eddy|lee)\b/i;
const FEMALE = /female|zira|aria|jenny|samantha|susan|hazel|heera|uzma|kalpana|swara|sonia|libby|natasha|ava|emma|allison|karen|moira|tessa|veena|catherine|neerja|salman?a/i;

export class Speech {
  constructor() {
    this.supported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
    this.enabled = this.supported;
    this.voiceURI = '';
    this.rate = 1;
    this.lang = 'en';
    this.gender = 'f';               // 'f' larki, 'm' mard, 'b' ladka (character ke hisaab se)
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

  // naam se andaza: awaaz female hai ya male ('?' = pata nahi)
  guess(v) { return /female/i.test(v.name) || FEMALE.test(v.name) ? 'f' : MALE.test(v.name) ? 'm' : '?'; }

  // character ke jins se awaaz kitni milti hai (0 = behtareen)
  genderRank(v) {
    const g = this.guess(v), want = this.gender === 'f' ? 'f' : 'm';
    return g === want ? 0 : g === '?' ? 1 : 2;
  }

  // pitch: mard thodi bhari, ladka thodi patli (bachon jaisi), larki normal. Agar awaaz ka jins match na ho to pitch se kaam chalao.
  pitchFor(v) {
    const g = v ? this.guess(v) : '?';
    if (this.gender === 'f') return g === 'm' ? 1.35 : 1.05;
    if (this.gender === 'm') return g === 'f' ? 0.7 : g === 'm' ? 0.95 : 0.85;
    return g === 'f' ? 1.0 : g === 'm' ? 1.25 : 1.15;      // ladka
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
      .sort((a, b) => (a.r - b.r) || (this.genderRank(a.v) - this.genderRank(b.v)) || (b.v.localService - a.v.localService))
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
        u.pitch = this.pitchFor(v);
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
