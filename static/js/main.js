import { createStage, PICK_TIME } from './stage.js';
import { ArrayView } from './array-view.js';
import { Bubble } from './bubble.js';
import { MESSAGES } from './i18n.js';

const $ = s => document.querySelector(s);
let SPEED = Number(new URLSearchParams(location.search).get('speed')) || 1;
const sleep = ms => new Promise(r => setTimeout(r, ms / SPEED));
const rawSleep = ms => new Promise(r => setTimeout(r, ms));

const stage = createStage($('#stage'));
const view = new ArrayView($('#board'));
const bubble = new Bubble($('#bubble'), () => stage.headPx(), speakCharacter);
const chatHistory = [];
let chatContext = { phase: 'idle' };
let speechId = 0;
let currentAudio = null;
let currentAudioUrl = null;

// Skin tones (RGB 0-1). null = original texture. Naya tone chahiye to yahan add karein
// (aur index.html ke swatches mein ek input add karein).
const SKIN_TONES = {
  original: null,
  fair:     [0.96, 0.80, 0.68],
  wheatish: [0.88, 0.68, 0.50],
  tan:      [0.72, 0.50, 0.34],
  deep:     [0.45, 0.29, 0.19],
};

let lang = 'en';
let currentIdx = 0;
let running = false;

// ---------------- speed buttons ----------------
function applySpeed(s) {
  SPEED = s;
  view.speed = s;
  bubble.speed = s;
  stage.setSpeed(s);
  document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', Number(b.dataset.s) === s));
}
document.querySelectorAll('#speed button').forEach(b => b.addEventListener('click', () => applySpeed(Number(b.dataset.s))));

// ---------------- manual mode: Down Arrow se next step ----------------
let manual = true;
let waiter = null;
const hint = $('#hint');

function release() {
  if (!waiter) return;
  const r = waiter;
  waiter = null;
  hint.classList.add('hidden');
  r();
}
function waitNext(text) {
  if (!manual) return sleep(700);                 // auto mode: thoda sa ruk kar aage
  return new Promise(resolve => {
    waiter = resolve;
    hint.textContent = text;
    hint.classList.remove('hidden');
  });
}
addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' && waiter) { e.preventDefault(); release(); }
});
hint.addEventListener('click', release);          // touch / mouse se bhi chal jaye
document.querySelectorAll('#mode button').forEach(b => b.addEventListener('click', () => {
  manual = b.dataset.m === 'manual';
  document.querySelectorAll('#mode button').forEach(x => x.classList.toggle('on', x === b));
  if (!manual) release();                         // Auto par jate hi ruka hua step chal pade
}));

// ---------------- status chip ----------------
function status(text) {
  const el = $('#status');
  if (!text) return el.classList.add('hidden');
  el.textContent = text;
  el.classList.remove('hidden');
}

// ---------------- preloader ----------------
async function boot() {
  const bar = $('#preBar');
  try {
    await Promise.all([
      stage.load(p => { bar.style.width = Math.round(p * 100) + '%'; }),
      rawSleep(1600),                       // preloader thodi der dikhe
    ]);
    bar.style.width = '100%';
  } catch (err) {
    console.error(err);
    $('#preText').textContent = 'Character load nahi hua. Page refresh karein.';
    return;
  }
  $('#preloader').classList.add('done');
  setTimeout(() => $('#preloader').remove(), 700);
  applySpeed(SPEED);
  openForm();
}

// ---------------- popup form ----------------
const modal = $('#modal'), form = $('#form'), errBox = $('#formError');
const openForm = () => { modal.classList.remove('hidden'); $('#arrayInput').focus(); };
const closeForm = () => modal.classList.add('hidden');

$('#example').addEventListener('click', () => {
  const n = 7 + Math.floor(Math.random() * 4);
  const set = new Set();
  while (set.size < n) set.add(1 + Math.floor(Math.random() * 99));
  const arr = [...set];
  $('#arrayInput').value = arr.join(', ');
  $('#targetInput').value = arr[Math.floor(Math.random() * arr.length)];
  errBox.textContent = '';
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  errBox.textContent = '';
  const parts = $('#arrayInput').value.split(/[\s,;]+/).filter(Boolean);
  const array = parts.map(Number);
  const targetRaw = $('#targetInput').value.trim();
  if (parts.length === 0 || array.some(n => !Number.isInteger(n))) {
    errBox.textContent = 'Array mein sirf poore numbers likhein, comma se alag (jaise 5, 12, 9).';
    return;
  }
  if (targetRaw === '' || !Number.isInteger(Number(targetRaw))) {
    errBox.textContent = 'Dhoondne wala number (poora number) likhein.';
    return;
  }
  const btn = $('#startBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ array, target: Number(targetRaw) }),
    });
    const data = await res.json();
    if (!res.ok) { errBox.textContent = data.error || 'Kuch galat ho gaya.'; return; }
    lang = $('#langInput').value;
    stage.setSkinTone(SKIN_TONES[form.elements.tone.value] ?? null);
    closeForm();
    run(data).catch(err => console.error(err));
  } catch (err) {
    errBox.textContent = 'Server se rabta nahi hua. Flask chal raha hai?';
  } finally {
    btn.disabled = false;
  }
});

$('#again').addEventListener('click', () => {
  $('#again').classList.add('hidden');
  bubble.hide();
  view.clear();
  stage.placeAtPx(-300);
  stage.lookAt(null);
  running = false;
  chatContext = { phase: 'idle' };
  openForm();
});

// ---------------- AI chat and spoken replies ----------------
const chatForm = $('#chatForm');
const chatInput = $('#chatInput');
const chatError = $('#chatError');

function cancelCharacterSpeech() {
  speechId++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
  stage.setSpeaking(false);
}

function femaleVoice(voices, language) {
  const languageVoices = voices.filter(voice => voice.lang.toLowerCase().startsWith(language));
  const feminineName = /female|woman|samantha|victoria|karen|moira|tessa|fiona|ava|allison|susan|zira|jenny|aria|emma|natasha|sara|google us english/i;
  const languageMatches = languageVoices.length ? languageVoices : voices;
  const feminineVoices = languageMatches.filter(voice => feminineName.test(voice.name));
  const candidates = feminineVoices.length ? feminineVoices : languageMatches;
  const qualityName = /natural|neural|premium|enhanced|online|aria|jenny|ava|samantha|google us english/i;
  return candidates.sort((a, b) => {
    const score = voice =>
      (qualityName.test(voice.name) ? 10 : 0) +
      (voice.localService === false ? 2 : 0);
    return score(b) - score(a);
  })[0];
}

function getVoices() {
  const voices = speechSynthesis.getVoices();
  if (voices.length) return Promise.resolve(voices);
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      resolve(speechSynthesis.getVoices());
    }, 1000);
    const onVoicesChanged = () => {
      clearTimeout(timeout);
      speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      resolve(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener('voiceschanged', onVoicesChanged, { once: true });
  });
}

async function speakCharacter(text, onStarted) {
  cancelCharacterSpeech();
  const id = speechId;
  const spokenText = text
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*|__(.*?)__/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (document.body.dataset.naturalVoice === 'true') {
    try {
      const response = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: spokenText, language: lang }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Natural voice service is unavailable.');
      }
      const audioBlob = await response.blob();
      if (id !== speechId) return;
      currentAudioUrl = URL.createObjectURL(audioBlob);
      currentAudio = new Audio(currentAudioUrl);
      return await new Promise(resolve => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          if (id === speechId) {
            stage.setSpeaking(false);
            currentAudio = null;
            if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
            currentAudioUrl = null;
          }
          resolve();
        };
        const fallback = () => {
          if (finished) return;
          finished = true;
          stage.setSpeaking(false);
          currentAudio = null;
          if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
          currentAudioUrl = null;
          if (id === speechId) {
            chatError.textContent = 'Natural voice playback failed; using the browser voice instead.';
            void speakWithBrowser(spokenText, id, onStarted).then(resolve);
          } else {
            resolve();
          }
        };
        currentAudio.onended = finish;
        currentAudio.onerror = fallback;
        currentAudio.onplay = () => {
          if (id === speechId) {
            const durationMs = Number.isFinite(currentAudio.duration)
              ? currentAudio.duration * 1000
              : undefined;
            onStarted(durationMs);
            stage.setSpeaking(true);
          }
        };
        stage.setSpeaking(true);
        currentAudio.play().catch(fallback);
      });
    } catch (error) {
      if (id !== speechId) return;
      chatError.textContent = 'Natural voice is unavailable; using the browser voice instead.';
    }
  }
  return speakWithBrowser(spokenText, id, onStarted);
}

async function speakWithBrowser(spokenText, id, onStarted) {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    chatError.textContent = 'Spoken replies are not supported by this browser.';
    onStarted();
    return;
  }
  if (id !== speechId) return;
  const utterance = new SpeechSynthesisUtterance(spokenText);
  utterance.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
  utterance.pitch = 1.08;
  utterance.rate = 0.9;
  const voices = await getVoices();
  if (id !== speechId) return;
  const voice = femaleVoice(voices, lang === 'ur' ? 'ur' : 'en');
  if (voice) utterance.voice = voice;
  return new Promise(resolve => {
    const finish = () => {
      if (id === speechId) stage.setSpeaking(false);
      resolve();
    };
    utterance.onstart = () => {
      if (id === speechId) {
        onStarted(spokenText.length / 14 * 1000);
        stage.setSpeaking(true);
      }
    };
    utterance.onend = finish;
    utterance.onerror = event => {
      finish();
      if (id === speechId && !['canceled', 'interrupted'].includes(event.error)) {
        chatError.textContent = 'The spoken reply could not be played.';
      }
    };
    stage.setSpeaking(true);
    speechSynthesis.speak(utterance);
  });
}

chatForm.addEventListener('submit', async e => {
  e.preventDefault();
  const content = chatInput.value.trim();
  if (!content) return;

  chatError.textContent = '';
  $('#chatStatus').textContent = 'Sending your message…';
  chatInput.value = '';
  chatHistory.push({ role: 'user', content });
  const sendButton = $('#chatSend');
  const sendLabel = $('#chatSendLabel');
  const sendSpinner = $('#chatSendSpinner');
  sendButton.setAttribute('aria-busy', 'true');
  sendLabel.textContent = 'Sending';
  sendSpinner.classList.remove('hidden');
  sendButton.disabled = true;
  chatInput.disabled = true;
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: chatHistory.slice(-12),
        context: chatContext,
        language: lang,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The guide could not reply. Please try again.');

    chatHistory.push({ role: 'assistant', content: data.reply });
    if (chatHistory.length > 12) chatHistory.splice(0, chatHistory.length - 12);
    $('#chatStatus').textContent = 'Message sent · reply received';
    void bubble.say(data.reply);
  } catch (err) {
    const pendingMessage = chatHistory.at(-1);
    if (pendingMessage?.role === 'user' && pendingMessage.content === content) chatHistory.pop();
    chatInput.value = content;
    $('#chatStatus').textContent = 'Message not sent';
    chatError.textContent = err.message || 'The guide could not reply. Please try again.';
  } finally {
    sendButton.removeAttribute('aria-busy');
    sendLabel.textContent = 'Send';
    sendSpinner.classList.add('hidden');
    sendButton.disabled = false;
    chatInput.disabled = false;
    chatInput.focus();
  }
});

addEventListener('resize', () => {
  if (!view.items.length) return;
  view.relayout();
  if (running) stage.placeAtPx(view.slotX(currentIdx));
});

// ---------------- main show ----------------
async function run(data) {
  running = true;
  chatContext = { phase: 'walkthrough', sorted: data.sorted, target: data.target };
  const M = MESSAGES[lang];
  const { target: t, steps } = data;
  const n = data.sorted.length;
  const say = text => bubble.say(text);

  // 1) numbers sab taraf se aate hain -> shuffle -> sort
  view.build(data.original);
  status(M.ui.arriving); await view.flyIn();
  status(M.ui.shuffling); await view.shuffle();
  status(M.ui.sorting);   await view.sort();
  view.showIndices();
  status(null);
  await sleep(400);

  // 2) character left se aata hai, right ki taraf chalta hai, phir wave
  currentIdx = Math.floor((n - 1) / 2);
  await stage.walkTo(view.slotX(currentIdx));
  stage.playOnce('wave');
  await say(M.intro1(t));
  await say(M.intro2());
  stage.playOnce('ack');
  await say(M.intro3());
  await waitNext(M.ui.hintStart);                   // presenter ready ho to ↓

  // 3) binary search: har step character khud karta hai
  let low = 0, high = n - 1;
  for (const [idx, s] of steps.entries()) {
    const isLast = idx === steps.length - 1;
    chatContext = {
      phase: 'walkthrough',
      sorted: data.sorted,
      target: data.target,
      step: s.step,
      low: s.low,
      high: s.high,
      mid: s.mid,
      value: s.value,
      result: s.result,
    };
    view.setPointers({ low: s.low, high: s.high });
    const walk = stage.walkTo(view.slotX(s.mid));
    currentIdx = s.mid;
    const lineA = say(M.stepA(s.step, s.low, s.high, s.mid));
    sleep(900).then(() => view.setPointers({ low: s.low, high: s.high, mid: s.mid }));
    await Promise.all([lineA, walk]);

    view.setMid(s.mid);
    stage.lookAt(view.discPos(s.mid));

    if (s.result === 'found') {
      await say(M.foundAt(s.mid, s.value, t));
      await waitNext(M.ui.hintResult);
      break;
    }

    stage.playOnce('think');
    await say(s.result === 'right' ? M.right(s.mid, s.value, t) : M.left(s.mid, s.value, t));

    stage.playOnce('dismiss');
    if (s.result === 'right') { view.dim(0, s.mid); low = s.mid + 1; high = s.high; await say(M.discard(0, s.mid)); }
    else                      { view.dim(s.mid, n - 1); high = s.mid - 1; low = s.low; await say(M.discard(s.mid, n - 1)); }
    view.setMid(null);
    await waitNext(isLast ? M.ui.hintResult : M.ui.hintNext);   // har step ke baad ↓ ka intezar
  }

  // 4) result
  view.hidePointers();
  if (data.found) {
    const i = data.index;
    view.markFound(i);
    const feet = stage.feetPx();
    view.drop(i, feet.x + 6, feet.y - 20);          // disc shelf se utar kar character ke saamne aata hai
    const pickup = stage.playOnce('pickup');
    const line = say(M.pickup());
    await rawSleep(PICK_TIME * 1000 / SPEED);       // jab haath neeche pahunchta hai
    view.follow(i, () => stage.handPx());           // disc haath ke saath uthta hai
    await Promise.all([pickup, line]);
    const hp = stage.headPx();
    view.hold(i, hp.x, hp.y - 80);                  // sar ke upar "trophy"
    stage.startLoop('hiphop');                      // jeet ka dance
    await say(M.foundDone(t, i, data.comparisons, n));
    await say(M.bigO());
    await say(M.end());
    stage.stopLoop();
  } else {
    stage.playOnce('shake');
    await say(M.empty(low, high));
    stage.playOnce('sigh');
    await say(M.notFound(t));
    await say(M.end());
  }

  stage.lookAt(null);                       // ab sirf mouse follow hoga
  running = false;
  chatContext = {
    phase: 'completed',
    sorted: data.sorted,
    target: data.target,
    step: steps.length,
    result: data.found ? 'found' : undefined,
  };
  $('#again').classList.remove('hidden');
}

boot();
