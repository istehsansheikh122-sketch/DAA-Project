// Character ke chehre ke saath wala speech bubble (typewriter effect).
function formatBubbleText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*|__(.*?)__/g, '$1$2')
    .replace(/(?<!\*)\*([^*\n]+)\*|(?<!_)_([^_\n]+)_/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
    .replace(/[ \t]+[-*][ \t]+/g, '\n• ')
    .replace(/[ \t]+(Step \d+:)/gi, '\n$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class Bubble {
  constructor(el, getAnchor, onSpeak) {
    this.el = el;
    this.typed = el.querySelector('.typed');
    this.rest = el.querySelector('.rest');
    this.getAnchor = getAnchor;
    this.onSpeak = onSpeak;
    this.speed = 1;
    this.pos = null;
    this.shown = false;
    this.sayId = 0;
    this.resolveAnimation = null;
    requestAnimationFrame(() => this.follow());
  }

  follow() {
    requestAnimationFrame(() => this.follow());
    if (!this.shown) return;
    const a = this.getAnchor();
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const gap = 54;
    let side = 'right';
    let x = a.x + gap;
    if (x + w > innerWidth - 12) { side = 'left'; x = a.x - gap - w; }
    x = Math.max(12, x);
    const y = Math.max(12, Math.min(a.y - h * 0.5, innerHeight - h - 12));
    if (!this.pos) this.pos = { x, y };
    this.pos.x += (x - this.pos.x) * 0.25;
    this.pos.y += (y - this.pos.y) * 0.25;
    this.el.style.transform = `translate(${this.pos.x}px, ${this.pos.y}px)`;
    this.el.dataset.side = side;
  }

  show() { this.shown = true; this.el.classList.remove('hidden'); }
  hide() { this.shown = false; this.pos = null; this.el.classList.add('hidden'); }

  // text type karo, phir padhne ka waqt do
  say(text) {
    const id = ++this.sayId;
    if (this.resolveAnimation) this.resolveAnimation();
    const displayText = formatBubbleText(text);
    this.show();
    this.typed.textContent = '';
    this.rest.textContent = displayText;    // poora text invisible rakho, taake bubble ka size na hile
    let speech;
    const animation = new Promise(resolve => {
      this.resolveAnimation = resolve;
      let started = false;
      const startAnimation = durationMs => {
        if (started || id !== this.sayId) return;
        started = true;
        const defaultDuration = displayText.length / (38 * this.speed) * 1000;
        const duration = Number.isFinite(durationMs) && durationMs > 0
          ? durationMs
          : defaultDuration;
        const start = performance.now();
        const frame = now => {
          if (id !== this.sayId) return resolve();
          const progress = Math.min(1, (now - start) / duration);
          const n = Math.min(displayText.length, Math.floor(progress * displayText.length));
          this.typed.textContent = displayText.slice(0, n);
          this.rest.textContent = displayText.slice(n);
          if (progress < 1) requestAnimationFrame(frame);
          else setTimeout(() => {
            if (id === this.sayId) this.resolveAnimation = null;
            resolve();
          }, (650 + displayText.length * 22) / this.speed);
        };
        requestAnimationFrame(frame);
      };
      speech = this.onSpeak
        ? this.onSpeak(text, startAnimation)
        : (startAnimation(), Promise.resolve());
      speech = Promise.resolve(speech).catch(() => startAnimation());
    });
    return Promise.all([animation, speech]);
  }
}
