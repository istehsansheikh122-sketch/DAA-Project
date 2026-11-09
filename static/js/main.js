import { createStage, PICK_TIME } from './stage.js';
import { ArrayView } from './array-view.js';
import { Bubble } from './bubble.js';
import { MESSAGES, MALE_UR } from './i18n.js';
import { Speech, Listener } from './speech.js';
import { Chat } from './chat.js';
import { Music } from './music.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
let SPEED = Number(params.get('speed')) || 1;
const sleep = ms => new Promise(r => setTimeout(r, ms / SPEED));
const rawSleep = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

// Characters. Sab Mixamo ke hain, is liye original wali animations (character.glb) sab par chalti hain.
const MODELS_BASE = document.body.dataset.modelsBase;
const CHARACTERS = {
  original: { id: 'original', type: 'glb', url: document.body.dataset.model, tone: true },
  knight: { id: 'knight', type: 'fbx', url: MODELS_BASE + 'knight.fbx', tone: true, skin: { meshes: '^Head_Hands$', vmin: 0.5, maxSize: 1024 } },
  arissa: { id: 'arissa', type: 'fbx', url: MODELS_BASE + 'arissa.fbx', tone: true, skin: { meshes: '^arissaBody_Geo$', vmin: 0.5, maxSize: 1024 } },
  boy: { id: 'boy', type: 'fbx', url: MODELS_BASE + 'boy.fbx', tone: true, skin: { meshes: '^Boy01_Body_Geo$', vmin: 0.5, maxSize: 1024 } },
};

// Skin tones (RGB 0-1). null = original texture. Naya tone chahiye to yahan add karein
// (aur index.html ke swatches mein ek input add karein).
const SKIN_TONES = {
  original: null,
  fair:     [0.96, 0.80, 0.68],
  wheatish: [0.88, 0.68, 0.50],
  tan:      [0.72, 0.50, 0.34],
  deep:     [0.45, 0.29, 0.19],
};

const stage = createStage($('#stage'));
const view = new ArrayView($('#board'));
const speech = new Speech();
const listener = new Listener();
const music = new Music(document.body.dataset.audioBase);
const bubble = new Bubble($('#bubble'), () => stage.headPx(), {
  speech,
  onTalk: on => { stage.setTalking(on); music.duck(on); },
});
speech.onBoundary = () => stage.emphasize();

let lang = 'en';
let llmProvider = null;
let currentIdx = 0;
let running = false;
let session = null;          // chal rahi search ki state (chat ko context dene ke liye)
let asking = false;          // character abhi kisi sawal ka jawab de raha hai
let demoNoted = false;
const chatHistory = [];
const charName = () => $('#charInput').selectedOptions[0].textContent.trim();
const charGender = () => $('#charInput').selectedOptions[0].dataset.gender || 'f';
const M = () => (lang === 'ur' && charGender() !== 'f' ? MALE_UR : MESSAGES[lang]);

const chat = new Chat({ onSubmit: text => ask(text), listener, getLang: () => lang });

if (params.has('debug')) window.__bsg = { stage, view, speech, bubble, chat, music };

// ---------------- speed buttons ----------------
function applySpeed(s) {
  SPEED = s;
  view.speed = s;
  bubble.speed = s;
  speech.rate = 1 + (s - 1) * 0.6;          // 1x -> 1.0, 1.5x -> 1.3, 2x -> 1.6
  stage.setSpeed(s);
  document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', Number(b.dataset.s) === s));
}
document.querySelectorAll('#speed button').forEach(b => b.addEventListener('click', () => applySpeed(Number(b.dataset.s))));

// ---------------- voice on/off ----------------
function applyVoice(on) {
  speech.enabled = on && speech.supported;
  if (!speech.enabled) speech.cancel();
  document.querySelectorAll('#voice button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'on') === on));
  store.set('bsg.voice', on ? 'on' : 'off');
}
document.querySelectorAll('#voice button').forEach(b => b.addEventListener('click', () => applyVoice(b.dataset.v === 'on')));

// ---------------- background music ----------------
// Browser music tab tak shuru nahi karne deta jab tak user kuch click / tap na kare, is liye
// pehle click par (form Start) shuru hoti hai agar pehle On rakhi ho.
let musicWanted = store.get('bsg.music') === 'on';
function paintMusic(on) {
  document.querySelectorAll('#music button').forEach(b => b.classList.toggle('on', (b.dataset.mu === 'on') === on));
}
paintMusic(musicWanted);
document.querySelectorAll('#music button').forEach(b => b.addEventListener('click', async () => {
  musicWanted = b.dataset.mu === 'on';
  store.set('bsg.music', musicWanted ? 'on' : 'off');
  paintMusic(musicWanted);
  const ok = await music.setEnabled(musicWanted);
  if (musicWanted && !ok) { musicWanted = false; store.set('bsg.music', 'off'); }
  paintMusic(musicWanted);
}));
addEventListener('pointerdown', () => { if (musicWanted && !music.enabled) music.setEnabled(true); }, { once: true });

// ---------------- manual mode: Down Arrow se next step ----------------
let manual = true;
let waiter = null;
const hint = $('#hint');
const isPhone = () => matchMedia('(pointer: coarse)').matches || innerWidth < 700;

function release() {
  if (!waiter || asking) return;
  const r = waiter;
  waiter = null;
  hint.classList.add('hidden');
  chat.setEnabled(false, M().ui.chatWait);
  r();
}
function waitNext(text) {
  chat.setEnabled(true, session && session.phase === 'finished' ? M().ui.chatEnd : M().ui.chatAsk);
  if (!manual) return sleep(700).then(() => chat.setEnabled(false, M().ui.chatWait));
  return new Promise(resolve => {
    waiter = resolve;
    hint.textContent = isPhone() ? text.replace('Press ↓ to start the search', 'Tap here to start').replace('Press ↓ for the next step', 'Tap here for the next step').replace('Press ↓ to see the result', 'Tap here to see the result').replace(/ ?↓ dabayein/, ' yahan tap karein') : text;
    hint.classList.remove('hidden');
  });
}
const typingInField = el => el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' && waiter && !typingInField(e.target)) { e.preventDefault(); release(); }
  if (e.key === '/' && chat.enabled && !typingInField(e.target)) { e.preventDefault(); chat.focus(); }
});
$('#chatInput').addEventListener('keydown', e => { if (e.key === 'Escape') e.target.blur(); });
hint.addEventListener('click', release);
document.querySelectorAll('#mode button').forEach(b => b.addEventListener('click', () => {
  manual = b.dataset.m === 'manual';
  document.querySelectorAll('#mode button').forEach(x => x.classList.toggle('on', x === b));
  if (!manual) release();
}));

// ---------------- status chip ----------------
function status(text) {
  const el = $('#status');
  if (!text) return el.classList.add('hidden');
  el.textContent = text;
  el.classList.remove('hidden');
}

// ---------------- voice select (form) ----------------
function fillVoices() {
  const sel = $('#voiceInput');
  const l = $('#langInput').value;
  sel.innerHTML = '<option value="">Automatic</option>';
  if (!speech.supported) { sel.disabled = true; sel.firstChild.textContent = 'Not supported in this browser'; return; }
  for (const v of speech.voicesFor(l)) {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
  }
  const saved = store.get('bsg.voiceURI.' + l);
  if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved;
}
$('#langInput').addEventListener('change', fillVoices);

// ---------------- character select (form) ----------------
const charSel = $('#charInput');
{ const saved = store.get('bsg.char'); if (saved && CHARACTERS[saved]) charSel.value = saved; }
speech.gender = charGender();
function syncToneBox() { $('#toneBox').style.display = CHARACTERS[charSel.value].tone ? '' : 'none'; }
charSel.addEventListener('change', () => { syncToneBox(); speech.gender = charGender(); fillVoices(); });
syncToneBox();

// ---------------- preloader ----------------
async function boot() {
  const bar = $('#preBar');
  try {
    await Promise.all([
      stage.load(CHARACTERS[store.get('bsg.char')] || CHARACTERS.original, p => { bar.style.width = Math.round(p * 100) + '%'; }),
      speech.ready(),
      fetch('/api/config').then(r => r.json()).then(c => { llmProvider = c.provider; }).catch(() => {}),
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
  applyVoice(store.get('bsg.voice') !== 'off');
  if (!speech.supported) document.querySelectorAll('#voice button').forEach(b => { b.disabled = true; });
  fillVoices();
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
    speech.lang = lang;
    speech.gender = charGender();
    speech.voiceURI = $('#voiceInput').value;
    store.set('bsg.voiceURI.' + lang, speech.voiceURI);
    store.set('bsg.char', charSel.value);
    const def = CHARACTERS[charSel.value];
    if (stage.characterId !== def.id) {
      const lbl = $('#startBtn').textContent;
      $('#startBtn').textContent = 'Loading guide…';
      try { await stage.load(def); }
      catch (err) { console.error(err); errBox.textContent = 'Character load nahi hua. Dobara try karein.'; return; }
      finally { $('#startBtn').textContent = lbl; }
    }
    stage.setSkinTone(def.tone ? (SKIN_TONES[form.elements.tone.value] ?? null) : null);
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
  speech.cancel();
  bubble.hide();
  view.clear();
  stage.placeAtPx(-300);
  stage.lookAt(null);
  stage.setTalking(false);
  chat.hide();
  chat.addLog('system', M().ui.newSearch);
  chatHistory.length = 0;
  session = null;
  running = false;
  openForm();
});

addEventListener('resize', () => {
  if (!view.items.length) return;
  view.relayout();
  if (running) stage.placeAtPx(view.slotX(currentIdx));
});

// ---------------- chat: character se sawal (LLM agent) ----------------
const chatState = () => ({
  sorted: session.data.sorted,
  target: session.data.target,
  steps: session.data.steps,
  done: session.stepsDone,
  found: session.data.found,
  index: session.data.index,
  phase: session.phase,
});

async function ask(text) {
  if (!session || asking) return;
  asking = true;
  chat.setEnabled(false, M().ui.chatThinking);
  chat.addLog('user', text);
  chat.showYou(text);
  if (llmProvider === 'mock' && !demoNoted) { chat.addLog('system', M().ui.demo); demoNoted = true; }

  speech.cancel();
  bubble.think();
  stage.playOnce('think');                      // jawab aane tak soch wala gesture

  let out;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: chatHistory.slice(-10), state: chatState(), lang, character: charSel.value }),
    });
    out = await res.json();
    if (!res.ok) throw new Error(out.error || res.statusText);
  } catch (err) {
    out = { reply: M().ui.chatError(err.message), actions: [] };
  }

  // agent ke actions: boxes highlight, character ko chalana, gesture
  const walks = [];
  for (const a of out.actions || []) {
    if (a.type === 'highlight') view.pulse(a.indices);
    else if (a.type === 'gesture') stage.playOnce(a.name);
    else if (a.type === 'walk') {
      currentIdx = a.index;
      stage.lookAt(view.discPos(a.index));
      walks.push(stage.walkTo(view.slotX(a.index)));
    }
  }
  await Promise.all([bubble.say(out.reply), ...walks]);

  chat.addLog('assistant', out.reply);
  chatHistory.push({ role: 'user', text }, { role: 'assistant', text: out.reply });
  asking = false;
  chat.setEnabled(true, session && session.phase === 'finished' ? M().ui.chatEnd : M().ui.chatAsk);
}

// ---------------- main show ----------------
async function run(data) {
  running = true;
  session = { data, stepsDone: 0, phase: 'intro' };
  const { target: t, steps } = data;
  const n = data.sorted.length;
  const say = text => bubble.say(text);

  chat.show();
  chat.setEnabled(false, M().ui.chatWait);

  // 1) numbers sab taraf se aate hain -> shuffle -> sort
  view.build(data.original);
  status(M().ui.arriving); await view.flyIn();
  status(M().ui.shuffling); await view.shuffle();
  status(M().ui.sorting);   await view.sort();
  view.showIndices();
  status(null);
  await sleep(400);

  // 2) character left se aata hai, right ki taraf chalta hai, phir wave
  currentIdx = Math.floor((n - 1) / 2);
  await stage.walkTo(view.slotX(currentIdx));
  stage.playOnce('wave');
  await say(M().intro1(t, charName()));
  await say(M().intro2());
  stage.playOnce('ack');
  await say(M().intro3());
  await waitNext(M().ui.hintStart);                 // presenter ready ho to ↓

  // 3) binary search: har step character khud karta hai
  session.phase = 'between_steps';
  let low = 0, high = n - 1;
  for (const [idx, s] of steps.entries()) {
    const isLast = idx === steps.length - 1;
    view.setPointers({ low: s.low, high: s.high });
    const walk = stage.walkTo(view.slotX(s.mid));
    currentIdx = s.mid;
    const lineA = say(M().stepA(s.step, s.low, s.high, s.mid));
    sleep(900).then(() => view.setPointers({ low: s.low, high: s.high, mid: s.mid }));
    await Promise.all([lineA, walk]);

    view.setMid(s.mid);
    stage.lookAt(view.discPos(s.mid));

    if (s.result === 'found') {
      await say(M().foundAt(s.mid, s.value, t));
      session.stepsDone = idx + 1;
      await waitNext(M().ui.hintResult);
      break;
    }

    stage.playOnce('think');
    await say(s.result === 'right' ? M().right(s.mid, s.value, t) : M().left(s.mid, s.value, t));

    stage.playOnce('dismiss');
    if (s.result === 'right') { view.dim(0, s.mid); low = s.mid + 1; high = s.high; await say(M().discard(0, s.mid)); }
    else                      { view.dim(s.mid, n - 1); high = s.mid - 1; low = s.low; await say(M().discard(s.mid, n - 1)); }
    view.setMid(null);
    session.stepsDone = idx + 1;
    await waitNext(isLast ? M().ui.hintResult : M().ui.hintNext);   // har step ke baad ↓ ka intezar
  }

  // 4) result
  session.phase = 'result';
  chat.setEnabled(false, M().ui.chatWait);
  view.hidePointers();
  if (data.found) {
    const i = data.index;
    view.markFound(i);
    const feet = stage.feetPx();
    view.drop(i, feet.x + 6, feet.y - 20);          // disc shelf se utar kar character ke saamne aata hai
    const pickup = stage.playOnce('pickup');
    const line = say(M().pickup());
    await rawSleep(PICK_TIME * 1000 / SPEED);       // jab haath neeche pahunchta hai
    view.follow(i, () => stage.handPx());           // disc haath ke saath uthta hai
    await Promise.all([pickup, line]);
    const hp = stage.headPx();
    view.hold(i, hp.x, hp.y - 80);                  // sar ke upar "trophy"
    stage.startLoop('hiphop');                      // jeet ka dance
    await say(M().foundDone(t, i, data.comparisons, n));
    await say(M().bigO());
    await say(M().end());
    stage.stopLoop();
  } else {
    stage.playOnce('shake');
    await say(M().empty(low, high));
    stage.playOnce('sigh');
    await say(M().notFound(t));
    await say(M().end());
  }

  stage.lookAt(null);                       // ab sirf mouse follow hoga
  session.phase = 'finished';
  chat.setEnabled(true, M().ui.chatEnd);    // ab idle mein bhi sawal pooch sakte hain
  $('#again').classList.remove('hidden');
}

boot();
