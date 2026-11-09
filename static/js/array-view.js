// Array ke gol "pebbles" (DOM) aur unki animations: fly-in, shuffle, sort, search states.
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class ArrayView {
  constructor(board) {
    this.board = board;
    this.speed = 1;
    this.items = [];      // {id, value, el}
    this.slots = [];      // slots[i] = item jo i-th jagah par hai
    this.labels = [];
    this.ptrEls = {};
    this.ptrState = null;
    this.size = 64;
    this.gap = 14;
    this.following = null;
  }

  // ----- layout -----
  get rowY() { return innerWidth < 700 ? Math.max(150, innerHeight * 0.27) : innerHeight * 0.30; }          // array upar-beech mein (focus yahan)

  computeLayout() {
    const n = Math.max(1, this.items.length);
    const narrow = innerWidth < 700;
    this.gap = narrow ? 4 : Math.max(10, Math.min(22, innerWidth * 0.014));
    const side = narrow ? 28 : 64;
    this.size = Math.max(narrow ? 20 : 36, Math.min(104, (innerWidth - side - (n - 1) * this.gap) / n));
    this.board.style.setProperty('--d', this.size + 'px');
    this._placeShelf();
  }

  // array ke neeche lakdi ki shelf: boxes us par rakhe hue lagte hain
  _placeShelf() {
    if (!this.shelf) return;
    const n = this.items.length;
    const total = n * this.size + (n - 1) * this.gap + (innerWidth < 700 ? 20 : 64);
    this.shelf.style.width = total + 'px';
    this.shelf.style.transform = `translate(${(innerWidth - total) / 2}px, ${this.rowY + this.size / 2 - 6}px)`;
  }

  slotX(i) {
    const n = this.items.length;
    const total = n * this.size + (n - 1) * this.gap;
    return (innerWidth - total) / 2 + this.size / 2 + i * (this.size + this.gap);
  }

  discPos(i) { return { x: this.slotX(i), y: this.rowY }; }

  _place(el, x, y, { rot = 0, scale = 1, dur = 0.8, delay = 0 } = {}) {
    el.style.transitionDuration = `${dur / this.speed}s`;
    el.style.transitionDelay = `${delay / this.speed}s`;
    el.style.transform = `translate(${x - this.size / 2}px, ${y - this.size / 2}px) rotate(${rot}deg) scale(${scale})`;
  }

  // ----- build -----
  build(values) {
    this.clear();
    this.shelf = document.createElement('div');
    this.shelf.className = 'shelf';
    this.board.appendChild(this.shelf);
    requestAnimationFrame(() => this.shelf.classList.add('on'));
    this.items = values.map((value, id) => {
      const el = document.createElement('div');
      el.className = 'disc';
      el.textContent = value;
      this.board.appendChild(el);
      return { id, value, el };
    });
    this.slots = [...this.items];
    this.computeLayout();
  }

  clear() {
    this.stopFollow();
    this.board.innerHTML = '';
    this.items = []; this.slots = []; this.labels = []; this.ptrEls = {}; this.ptrState = null;
    this.shelf = null;
  }

  relayout() {
    this.computeLayout();
    this.slots.forEach((it, i) => {
      it.el.style.transitionDuration = '0s';
      it.el.style.transitionDelay = '0s';
      if (!it.floating) this._place(it.el, this.slotX(i), this.rowY, { dur: 0 });
    });
    this.labels.forEach((l, i) => this._placeLabel(l, i));
    if (this.ptrState) this.setPointers(this.ptrState);
  }

  // ----- 1) sab taraf se array ke boxes aate hain -----
  async flyIn() {
    const W = innerWidth, H = innerHeight, m = this.size * 2;
    this.items.forEach(it => {
      const side = Math.floor(Math.random() * 4);
      const sx = side === 0 ? -m : side === 1 ? W + m : Math.random() * W;
      const sy = side === 2 ? -m : side === 3 ? H + m : Math.random() * H;
      it.el.style.transition = 'none';
      this._place(it.el, sx, sy, { rot: (Math.random() - 0.5) * 720, scale: 0.6, dur: 0 });
    });
    void this.board.offsetWidth;                // reflow
    this.items.forEach((it, i) => {
      it.el.style.transition = '';
      this._place(it.el, this.slotX(i), this.rowY, { dur: 1.1, delay: i * 0.09 });
    });
    await sleep((1100 + this.items.length * 90 + 250) / this.speed);
  }

  // ----- 2) shuffle -----
  async shuffle(rounds = 3) {
    for (let r = 0; r < rounds; r++) {
      const order = [...this.slots];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      this.slots = order;
      this.slots.forEach((it, i) => {
        const last = r === rounds - 1;
        this._place(it.el, this.slotX(i), this.rowY + (last ? 0 : (Math.random() - 0.5) * 40),
          { rot: last ? 0 : (Math.random() - 0.5) * 30, dur: 0.65 });
      });
      await sleep(760 / this.speed);
    }
  }

  // ----- 3) sort (selection sort, ek ek swap dikhate hue) -----
  async sort() {
    const n = this.slots.length;
    const y = this.rowY;
    for (let i = 0; i < n - 1; i++) {
      let min = i;
      for (let j = i + 1; j < n; j++) if (this.slots[j].value < this.slots[min].value) min = j;
      if (min !== i) {
        const a = this.slots[min], b = this.slots[i];
        const xa = this.slotX(i), xb = this.slotX(min);
        a.el.classList.add('moving'); b.el.classList.add('moving');
        const lift = this.size * 0.9;
        this._place(a.el, this.slotX(min), y - lift, { dur: 0.22 });
        await sleep(230 / this.speed);
        this._place(a.el, xa, y - lift, { dur: 0.45 });
        this._place(b.el, xb, y, { dur: 0.45 });
        await sleep(470 / this.speed);
        this._place(a.el, xa, y, { dur: 0.22 });
        await sleep(240 / this.speed);
        a.el.classList.remove('moving'); b.el.classList.remove('moving');
        this.slots[i] = a; this.slots[min] = b;
      }
      this.slots[i].el.classList.add('sorted');
    }
    this.slots[n - 1].el.classList.add('sorted');
    await sleep(500 / this.speed);
    this.slots.forEach(it => it.el.classList.remove('sorted'));
  }

  // ----- index labels (0,1,2...) -----
  showIndices() {
    this.labels = this.slots.map((_, i) => {
      const l = document.createElement('div');
      l.className = 'idx';
      l.textContent = i;
      this.board.appendChild(l);
      this._placeLabel(l, i);
      requestAnimationFrame(() => l.classList.add('on'));
      return l;
    });
  }
  _placeLabel(l, i) {
    l.style.transform = `translate(${this.slotX(i) - this.size / 2}px, ${this.rowY + this.size / 2 + 20}px)`;   // shelf ke neeche
  }

  // ----- low / mid / high pointers -----
  setPointers(state) {
    this.ptrState = state;
    const rows = {};
    ['low', 'mid', 'high'].forEach(name => {
      const idx = state[name];
      let el = this.ptrEls[name];
      if (idx === undefined || idx === null) { if (el) el.classList.remove('on'); return; }
      const row = rows[idx] = (rows[idx] ?? -1) + 1;
      const x = this.slotX(idx);
      const y = this.rowY - this.size / 2 - 22 - row * 26;
      const css = `translate(${x}px, ${y}px) translateX(-50%)`;
      if (!el) {                                   // pehli baar: seedha sahi jagah par banao
        el = document.createElement('div');
        el.className = `ptr ptr-${name}`;
        el.textContent = name;
        el.style.transition = 'none';
        el.style.transform = css;
        this.board.appendChild(el);
        void el.offsetWidth;
        el.style.transition = '';
        this.ptrEls[name] = el;
      } else {
        el.style.transform = css;
      }
      requestAnimationFrame(() => el.classList.add('on'));
    });
  }
  hidePointers() {
    this.ptrState = null;
    Object.values(this.ptrEls).forEach(el => el.classList.remove('on'));
  }

  // ----- agent ke kehne par kuch boxes ko kuch der highlight karo -----
  pulse(indices) {
    indices.forEach(i => {
      const el = this.slots[i] && this.slots[i].el;
      if (!el) return;
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
      setTimeout(() => el.classList.remove('pulse'), 3200 / this.speed);
    });
  }

  // ----- search states -----
  setMid(i) { this.slots.forEach(it => it.el.classList.remove('mid')); if (i !== null) this.slots[i].el.classList.add('mid'); }
  dim(from, to) { for (let i = from; i <= to; i++) this.slots[i].el.classList.add('out'); }
  markFound(i) {
    const el = this.slots[i].el;
    el.classList.remove('mid');
    el.classList.add('found');
  }

  // ----- found disc shelf se neeche character ke saamne floor par aata hai -----
  drop(i, x, y) {
    const it = this.slots[i];
    it.floating = true;
    this._place(it.el, x, y, { scale: 0.62, dur: 0.8 });
  }

  // ----- found disc ko haath ke saath chalana -----
  follow(i, getPos) {
    const it = this.slots[i];
    it.floating = true;
    it.el.style.transitionDuration = '0.45s';
    const p0 = getPos();
    this._place(it.el, p0.x, p0.y, { scale: 0.62, dur: 0.45 });
    let on = true;
    const start = performance.now();
    const loop = () => {
      if (!on) return;
      if (performance.now() - start > 450 / this.speed) {
        const p = getPos();
        it.el.style.transitionDuration = '0s';
        it.el.style.transform = `translate(${p.x - this.size / 2}px, ${p.y - this.size / 2}px) scale(0.62)`;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this.following = () => { on = false; };
  }
  stopFollow() { if (this.following) { this.following(); this.following = null; } }

  hold(i, x, y) {
    this.stopFollow();
    this._place(this.slots[i].el, x, y, { scale: 0.9, dur: 0.7 });
  }
}
