// Chat bar (character se sawal), mic button, aur conversation log.
const $ = s => document.querySelector(s);

export class Chat {
  constructor({ onSubmit, listener, getLang }) {
    this.form = $('#chat');
    this.input = $('#chatInput');
    this.send = $('#sendBtn');
    this.mic = $('#micBtn');
    this.you = $('#you');
    this.logEl = $('#log');
    this.logBody = $('#logBody');
    this.listener = listener;
    this.getLang = getLang;
    this.enabled = false;
    this.youTimer = null;

    this.form.addEventListener('submit', e => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text || !this.enabled) return;
      this.input.value = '';
      this.listener.stop();
      onSubmit(text);
    });

    // mic: dabao aur bolo, jawab foran chala jata hai
    if (!listener.supported) {
      this.mic.disabled = true;
      this.mic.title = 'Mic ke liye Chrome ya Edge use karein';
    }
    this.mic.addEventListener('click', () => {
      if (!this.enabled) return;
      if (listener.active) return listener.stop();
      listener.start(this.getLang(), {
        onText: (text, final) => {
          this.input.value = text;
          if (final && text) this.form.requestSubmit();
        },
        onState: on => this.mic.classList.toggle('on', on),
      });
    });

    $('#logBtn').addEventListener('click', () => this.logEl.classList.toggle('hidden'));
    $('#logClose').addEventListener('click', () => this.logEl.classList.add('hidden'));
  }

  show() { this.form.classList.remove('hidden'); $('#logBtn').classList.remove('hidden'); }
  hide() { this.form.classList.add('hidden'); this.setEnabled(false, ''); }

  setEnabled(on, placeholder) {
    this.enabled = on;
    this.input.disabled = !on;
    this.send.disabled = !on;
    this.form.classList.toggle('off', !on);
    if (placeholder !== undefined) this.input.placeholder = placeholder;
    if (!on) this.listener.stop();
  }

  focus() { if (this.enabled) this.input.focus(); }

  addLog(role, text) {
    const d = document.createElement('div');
    d.className = `msg ${role}`;
    d.textContent = text;
    this.logBody.appendChild(d);
    this.logBody.scrollTop = this.logBody.scrollHeight;
  }

  // sawal ka chhota sa chip (character ke jawab ke dauran)
  showYou(text) {
    this.you.textContent = text;
    this.you.classList.remove('hidden');
    clearTimeout(this.youTimer);
    this.youTimer = setTimeout(() => this.you.classList.add('hidden'), 6000);
  }
}
