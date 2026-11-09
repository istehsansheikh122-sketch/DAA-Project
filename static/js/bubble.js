// Character ke chehre ke saath wala speech bubble: typewriter + awaaz (voice) + bolne ki movement.
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Bubble {
  constructor(el, getAnchor, { speech = null, onTalk = () => {} } = {}) {
    this.el = el;
    this.typed = el.querySelector('.typed');
    this.rest = el.querySelector('.rest');
    this.getAnchor = getAnchor;
    this.speech = speech;
    this.onTalk = onTalk;           // true/false: character bol raha hai ya nahi (movement ke liye)
    this.speed = 1;
    this.pos = null;
    this.shown = false;
    requestAnimationFrame(() => this.follow());
  }

  follow() {
    requestAnimationFrame(() => this.follow());
    if (!this.shown) return;
    const a = this.getAnchor();
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const gap = 54;
    let side = 'right';
    let x, y;
    if (innerWidth < 700) {
      // phone: bubble sar ke upar, tail neeche character ki taraf
      side = 'bottom';
      x = Math.max(12, Math.min(innerWidth - w - 12, a.x - w / 2));
      y = Math.max(96, a.y - h - 62);
      this.el.style.setProperty('--tail', Math.max(26, Math.min(w - 26, a.x - x)) + 'px');
    } else {
      x = a.x + gap;
      if (x + w > innerWidth - 12) { side = 'left'; x = a.x - gap - w; }
      x = Math.max(12, x);
      y = Math.max(12, a.y - h * 0.5);
    }
    if (!this.pos) this.pos = { x, y };
    this.pos.x += (x - this.pos.x) * 0.25;
    this.pos.y += (y - this.pos.y) * 0.25;
    this.el.style.transform = `translate(${this.pos.x}px, ${this.pos.y}px)`;
    this.el.dataset.side = side;
  }

  show() { this.shown = true; this.el.classList.remove('hidden'); }
  hide() { this.shown = false; this.pos = null; this.el.classList.add('hidden'); }

  // "soch raha hai..." (jab LLM ka jawab aa raha ho)
  think() {
    this.show();
    this.el.classList.add('thinking');
    this.typed.textContent = '…';
    this.rest.textContent = '';
  }

  _type(text) {
    this.el.classList.remove('thinking');
    this.typed.textContent = '';
    this.rest.textContent = text;           // poora text invisible rakho, taake bubble ka size na hile
    const cps = 38 * this.speed;
    return new Promise(resolve => {
      const start = performance.now();
      const frame = now => {
        const n = Math.min(text.length, Math.floor((now - start) / 1000 * cps));
        this.typed.textContent = text.slice(0, n);
        this.rest.textContent = text.slice(n);
        if (n < text.length) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  // text type karo + (voice on ho to) bolo + movement. Jab sab khatam ho tab resolve.
  async say(text) {
    this.show();
    this.onTalk(true);
    const hold = (650 + text.length * 22) / this.speed;
    const t0 = performance.now();
    const speaking = this.speech && this.speech.enabled ? this.speech.speak(text) : null;
    await this._type(text);
    if (speaking) {
      await speaking;
      // awaaz foran khatam ho gayi (voice nahi mili / error)? to normal padhne ka waqt do
      if (performance.now() - t0 < Math.min(1500, text.length * 20)) await sleep(hold);
      else await sleep(350 / this.speed);
    } else {
      await sleep(hold);
    }
    this.onTalk(false);
  }
}
