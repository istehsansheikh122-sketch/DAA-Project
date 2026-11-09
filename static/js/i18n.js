// Character ke bolne wale text. Do languages: English aur Roman Urdu.
const plural = (k) => (k === 1 ? 'step' : 'steps');
const roundNote = (low, high, en) =>
  (low + high) % 2 === 0 ? '' : (en ? ' (rounded down)' : ' (neeche ki taraf round)');

export const MESSAGES = {
  en: {
    ui: {
      arriving: 'Your numbers are arriving…',
      shuffling: 'Shuffling…',
      sorting: 'Sorting…',
      loading: 'Waking up your guide…',
      hintStart: 'Press ↓ to start the search',
      hintNext: 'Press ↓ for the next step',
      hintResult: 'Press ↓ to see the result',
      chatWait: "I'm explaining… you can ask at the next pause",
      chatAsk: 'Ask me about this step…',
      chatEnd: 'Ask me anything about binary search…',
      chatThinking: 'Thinking…',
      chatError: msg => `Sorry, I couldn't reach my brain (the LLM) right now. ${msg}`,
      demo: 'Demo mode: no LLM key found, so I answer with a few built-in replies. Add OPENROUTER_API_KEY (see README) for the real agent.',
      newSearch: 'New search',
    },
    intro1: (t, name) => `Hi! I'm ${name}, your guide. Watch me find ${t} using binary search.`,
    intro2: () => `Binary search only works on a sorted list, and your numbers are sorted now.`,
    intro3: () => `The idea: check the middle number, then throw away the half that can't contain the answer. Repeat!`,
    stepA: (k, low, high, mid) =>
      `Step ${k}: my search window is index ${low} to ${high}. The middle is (${low} + ${high}) ÷ 2 = ${mid}${roundNote(low, high, true)}.`,
    right: (mid, v, t) => `Index ${mid} holds ${v}. ${v} is smaller than ${t}, so ${t} must be on the right side.`,
    left: (mid, v, t) => `Index ${mid} holds ${v}. ${v} is bigger than ${t}, so ${t} must be on the left side.`,
    foundAt: (mid, v, t) => `Index ${mid} holds ${v}, and that's exactly ${t}!`,
    discard: (from, to) =>
      from === to ? `I can ignore index ${from} now.` : `I can ignore index ${from} to ${to} completely.`,
    empty: (low, high) => `The search window is empty now (low = ${low}, high = ${high}).`,
    notFound: t => `${t} isn't in this array. Binary search has checked every place it could be, so I'm sure.`,
    pickup: () => `Let me pick it up for you!`,
    foundDone: (t, i, k, n) =>
      `Found ${t} at index ${i} in just ${k} ${plural(k)}! A linear search might need up to ${n}.`,
    bigO: () => `Each step halves the list, so binary search is O(log n). Pretty fast!`,
    end: () => `Want to try another one? Press "Search again".`,
  },

  ur: {
    ui: {
      arriving: 'Numbers aa rahe hain…',
      shuffling: 'Shuffle ho raha hai…',
      sorting: 'Sort ho raha hai…',
      loading: 'Guide ko bula rahi hoon…',
      hintStart: 'Search shuru karne ke liye ↓ dabayein',
      hintNext: 'Agle step ke liye ↓ dabayein',
      hintResult: 'Result dekhne ke liye ↓ dabayein',
      chatWait: 'Main samjha rahi hoon… agle pause par poochiye',
      chatAsk: 'Is step ke baare mein poochiye…',
      chatEnd: 'Binary search ke baare mein kuch bhi poochiye…',
      chatThinking: 'Soch rahi hoon…',
      chatError: msg => `Maaf kijiye, abhi main apne dimaag (LLM) tak nahi pahunch saki. ${msg}`,
      demo: 'Demo mode: LLM key nahi mili, is liye main kuch built-in jawab deti hoon. Asli agent ke liye OPENROUTER_API_KEY lagayein (README dekhein).',
      newSearch: 'Nayi search',
    },
    intro1: (t, name) => `Hi! Main ${name} hoon, aap ki guide. Dekhiye, main binary search se ${t} kaise dhoondti hoon.`,
    intro2: () => `Binary search sirf sorted list par chalti hai, aur aap ke numbers ab sorted ho chuke hain.`,
    intro3: () => `Tareeqa ye hai: darmiyan wala number dekho, phir wo aadha hissa phenk do jis mein jawab ho hi nahi sakta. Ye dohrate jao!`,
    stepA: (k, low, high, mid) =>
      `Step ${k}: meri search window index ${low} se ${high} tak hai. Darmiyan = (${low} + ${high}) ÷ 2 = ${mid}${roundNote(low, high, false)}.`,
    right: (mid, v, t) => `Index ${mid} par ${v} hai. ${v}, ${t} se chhota hai, is liye ${t} right side mein hona chahiye.`,
    left: (mid, v, t) => `Index ${mid} par ${v} hai. ${v}, ${t} se bada hai, is liye ${t} left side mein hona chahiye.`,
    foundAt: (mid, v, t) => `Index ${mid} par ${v} hai, aur yehi to ${t} hai!`,
    discard: (from, to) =>
      from === to ? `Ab main index ${from} ko ignore kar sakti hoon.` : `Ab main index ${from} se ${to} tak sab ignore kar sakti hoon.`,
    empty: (low, high) => `Ab search window khali ho gayi (low = ${low}, high = ${high}).`,
    notFound: t => `${t} is array mein maujood nahi hai. Binary search ne har mumkin jagah check kar li, is liye mujhe yaqeen hai.`,
    pickup: () => `Ye lijiye, main isay utha leti hoon!`,
    foundDone: (t, i, k, n) =>
      `Mil gaya! ${t} index ${i} par hai, sirf ${k} step mein! Linear search mein ${n} tak steps lag sakte the.`,
    bigO: () => `Har step list ko aadha kar deta hai, is liye binary search O(log n) hai. Bohat tez!`,
    end: () => `Ek aur try karna hai? "Search again" dabayein.`,
  },
};

// Male / ladka character ke liye Roman Urdu ke verb forms (sakti -> sakta, rahi -> raha ...)
const MALE_SWAPS = [
  [/sakti hoon/g, 'sakta hoon'], [/dhoondti/g, 'dhoondta'], [/rahi hoon/g, 'raha hoon'],
  [/leti hoon/g, 'leta hoon'], [/deti hoon/g, 'deta hoon'], [/pahunch saki/g, 'pahunch saka'],
  [/bula rahi/g, 'bula raha'], [/aap ki guide/g, 'aap ka guide'],
];
const maleify = x => {
  if (typeof x === 'string') return MALE_SWAPS.reduce((s, [re, to]) => s.replace(re, to), x);
  if (typeof x === 'function') return (...a) => maleify(x(...a));
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, maleify(v)]));
  return x;
};
export const MALE_UR = maleify(MESSAGES.ur);
