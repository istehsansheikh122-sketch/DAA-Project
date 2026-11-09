// Background music. Agar static/audio/music.mp3 (ya music.ogg) rakhi ho to wahi chalti hai.
// Warna ek halki, copyright-free ambient dhun browser mein khud bani (WebAudio) chalti hai.
// Character bolta hai to music dheemi ho jati hai (ducking).
const FILES = ['music.mp3', 'music.ogg', 'music.m4a', 'music.wav'];
const LEVEL = 0.32;              // music ki awaaz (0-1)
const DUCK = 0.3;                // jab character bol raha ho

const midi = m => 440 * Math.pow(2, (m - 69) / 12);
// Cmaj7 -> Am7 -> Fmaj7 -> G6 : naram, khushgawar
const CHORDS = [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 55, 59]];
const BELLS = [72, 74, 76, 79, 81, 84];

export class Music {
  constructor(base) {
    this.base = base;              // /static/audio/
    this.enabled = false;
    this.ducked = false;
    this.mode = null;              // 'file' | 'synth'
    this.audio = null;
    this.ctx = null;
    this.master = null;
    this.timer = null;
    this.starting = null;
  }

  get target() { return this.enabled ? LEVEL * (this.ducked ? DUCK : 1) : 0; }

  async setEnabled(on) {
    this.enabled = on;
    if (on) {
      try { await this._ensure(); } catch (e) { console.warn('Music failed:', e); this.enabled = false; return false; }
    }
    this._apply();
    if (!on) setTimeout(() => { if (!this.enabled) this._pause(); }, 900);
    return this.enabled;
  }

  duck(on) { this.ducked = on; this._apply(); }

  _apply() {
    if (this.mode === 'file' && this.audio) {
      this.audio.volume = this.target;
    } else if (this.mode === 'synth' && this.master) {
      this.master.gain.setTargetAtTime(this.target, this.ctx.currentTime, 0.5);
    }
  }

  _pause() {
    if (this.mode === 'file' && this.audio) this.audio.pause();
    if (this.mode === 'synth' && this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  async _ensure() {
    if (this.mode === 'file') { await this.audio.play(); return; }
    if (this.mode === 'synth') { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
    if (this.starting) return this.starting;
    this.starting = (async () => {
      for (const f of FILES) {
        try {
          const r = await fetch(this.base + f, { method: 'HEAD' });
          if (!r.ok) continue;
          const a = new Audio(this.base + f);
          a.loop = true; a.volume = 0;
          await a.play();
          this.audio = a; this.mode = 'file';
          return;
        } catch { /* agli file / synth */ }
      }
      this._startSynth();
    })();
    try { await this.starting; } finally { this.starting = null; }
  }

  _startSynth() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('WebAudio not supported');
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1500;
    lp.connect(master);
    // halka echo
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.46;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    lp.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
    this.bus = lp;
    this.mode = 'synth';

    let nextChord = ctx.currentTime + 0.1, chordIdx = 0, nextBell = ctx.currentTime + 2.5;
    const CH = 8;                      // har chord 8 second
    const schedule = () => {
      while (nextChord < ctx.currentTime + 2) { this._pad(CHORDS[chordIdx % CHORDS.length], nextChord, CH); chordIdx++; nextChord += CH; }
      while (nextBell < ctx.currentTime + 2) {
        this._bell(BELLS[Math.floor(Math.random() * BELLS.length)], nextBell);
        nextBell += 1.6 + Math.random() * 2.4;
      }
    };
    schedule();
    this.timer = setInterval(schedule, 500);
  }

  _pad(notes, t, dur) {
    const ctx = this.ctx;
    notes.forEach((m, i) => {
      [-4, 4].forEach(det => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = midi(m);
        o.detune.value = det;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05, t + 2.2);
        g.gain.setValueAtTime(0.05, t + dur - 2.4);
        g.gain.linearRampToValueAtTime(0, t + dur + 1.2);
        o.connect(g); g.connect(this.bus);
        o.start(t); o.stop(t + dur + 1.3);
      });
    });
  }

  _bell(m, t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = midi(m);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 2.4);
    o.connect(g); g.connect(this.bus);
    o.start(t); o.stop(t + 2.5);
  }
}
