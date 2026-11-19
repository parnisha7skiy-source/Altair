// Игры «выбери правильную плитку»: счёт, фигуры, кто как говорит, найди лишнего.
// Каждая игра — функция-генератор раунда: (level, last, gt) -> { prompt, scene?, options:[{key,html,bg}], answer }.
// Сложность (level) растёт с каждой пройденной игрой. Ошибка не наказывается.
import { sfx, confetti, once } from './fx.js';

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = rnd(i + 1); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
const PALETTE = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#fb8c00', '#8e24aa', '#ec407a'];
const TILE_BG = '#eef6ff';

const SHAPES = {
  circle: (c) => `<circle cx="50" cy="50" r="40" fill="${c}"/>`,
  square: (c) => `<rect x="14" y="14" width="72" height="72" rx="6" fill="${c}"/>`,
  triangle: (c) => `<polygon points="50,10 92,86 8,86" fill="${c}" stroke="${c}" stroke-width="4" stroke-linejoin="round"/>`,
  star: (c) => `<polygon points="50,6 61,38 95,38 68,58 78,92 50,71 22,92 32,58 5,38 39,38" fill="${c}" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>`,
  heart: (c) => `<path d="M50 88 C10 56 6 28 28 20 C40 16 48 24 50 32 C52 24 60 16 72 20 C94 28 90 56 50 88Z" fill="${c}"/>`,
};
const svg = (name, color) => `<svg viewBox="0 0 100 100" width="72%" height="72%" aria-hidden="true">${SHAPES[name](color)}</svg>`;

const OBJ = { apple: '🍎', star: '⭐', fish: '🐟', balloon: '🎈', car: '🚗', chick: '🐥' };
const ANIM = { cat: '🐱', dog: '🐶', cow: '🐮', sheep: '🐑', frog: '🐸' };
const GROUPS = [
  ['🍎', '🍌', '🍇', '🍊', '🍓'],
  ['🐶', '🐱', '🐰', '🐻', '🐼'],
  ['🚗', '🚌', '🚲', '✈️', '🚂'],
  ['⚽', '🧸', '🪁', '🎲', '🥁'],
];

export const CHOICE = {
  counting(level, last, gt) {
    const max = Math.min(9, 3 + level);
    let n; do { n = 1 + rnd(max); } while (String(n) === last && max > 1);
    const k = pick(Object.keys(OBJ));
    const nums = [n];
    const want = Math.min(level < 2 ? 3 : 4, max);
    while (nums.length < want) { const x = 1 + rnd(max); if (!nums.includes(x)) nums.push(x); }
    return {
      answer: String(n),
      prompt: gt.countQ.replace('{o}', gt.countObjs[k]),
      scene: Array(n).fill(OBJ[k]).join(' '),
      options: shuffle(nums).map((x) => ({ key: String(x), html: `<b class="digit">${x}</b>`, bg: TILE_BG })),
    };
  },
  shapes(level, last, gt) {
    const names = Object.keys(SHAPES);
    let a; do { a = pick(names); } while (a === last);
    const cnt = Math.min(5, 3 + level);
    const others = shuffle(names.filter((x) => x !== a)).slice(0, cnt - 1);
    return {
      answer: a,
      prompt: gt.shapeQ.replace('{o}', gt.shapes[a]),
      options: shuffle([a, ...others]).map((k) => ({ key: k, html: svg(k, pick(PALETTE)), bg: TILE_BG })),
    };
  },
  animals(level, last, gt) {
    const names = Object.keys(ANIM);
    let a; do { a = pick(names); } while (a === last);
    const cnt = level < 2 ? 3 : 4;
    const others = shuffle(names.filter((x) => x !== a)).slice(0, cnt - 1);
    return {
      answer: a,
      prompt: gt.animalQ.replace('{s}', gt.sounds[a]),
      options: shuffle([a, ...others]).map((k) => ({ key: k, html: ANIM[k], bg: TILE_BG })),
    };
  },
  odd(level, last, gt) {
    let b, ib, ia;
    do { ia = rnd(GROUPS.length); ib = (ia + 1 + rnd(GROUPS.length - 1)) % GROUPS.length; b = pick(GROUPS[ib]); } while (b === last);
    const same = shuffle(GROUPS[ia]).slice(0, 3);
    return {
      answer: b,
      prompt: gt.oddQ,
      options: shuffle([b, ...same]).map((k) => ({ key: k, html: k, bg: TILE_BG })),
    };
  },
};

export const ROUNDS = 5;

// say(type, text|null): text=null — реплика типа берётся из content/phrases.json
export function runChoice({ host, lang, gt, id, level, say, onCorrect, onFinish, onClose, strings }) {
  const gen = CHOICE[id];
  let round = 0, stars = 0, misses = 0, busy = true, cur = null, last = null, timers = [], idle = null;

  const root = document.createElement('div');
  root.className = 'mission show';
  root.setAttribute('lang', lang);
  root.innerHTML = `
    <div class="mtop">
      <div class="mstars" data-role="stars"></div>
      <button class="pill btnlike" data-role="repeat" aria-label="🔊">🔊</button>
      <button class="pill btnlike" data-role="exit" aria-label="✕">✕</button>
    </div>
    <div class="mscene" data-role="scene"></div>
    <div class="mgrid" data-role="grid"></div>
    <div class="mresult" data-role="result" hidden></div>`;
  host.appendChild(root);
  const q = (r) => root.querySelector(`[data-role="${r}"]`);
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const renderStars = () => { q('stars').textContent = '⭐'.repeat(stars) + '☆'.repeat(ROUNDS - stars); };

  function hint() {
    const el = root.querySelector(`.mopt[data-k="${CSS.escape(cur.answer)}"]`);
    if (el) el.classList.add('hint');
    say('explain', cur.prompt);
  }
  function armIdle() { clearTimeout(idle); idle = setTimeout(() => { if (!busy) hint(); armIdle(); }, 9000); }

  function ask() {
    cur = gen(level, last, gt);
    last = cur.answer; misses = 0; busy = false;
    renderStars();
    q('scene').textContent = cur.scene || '';
    q('scene').style.display = cur.scene ? '' : 'none';
    q('grid').style.gridTemplateColumns = `repeat(${cur.options.length <= 4 ? 2 : 3}, 1fr)`;
    q('grid').innerHTML = cur.options.map((o) =>
      `<button class="mopt" data-k="${o.key}" style="background:${o.bg}">${o.html}</button>`).join('');
    say('explain', cur.prompt);
    armIdle();
  }

  function choose(btn) {
    if (btn.dataset.k === cur.answer) {
      busy = true; clearTimeout(idle);
      btn.classList.add('ok');
      stars++; renderStars();
      sfx.ok(); confetti(22);
      onCorrect();
      // следующий раунд — только когда Тобот договорил похвалу (страховка 9 секунд)
      const go = once(() => { round++; if (round >= ROUNDS) finish(); else ask(); });
      say('joy', null, () => later(go, 600));
      later(go, 9000);
    } else {
      sfx.miss();
      btn.classList.remove('miss'); void btn.offsetWidth; btn.classList.add('miss');
      misses++;
      say('encourage', null, () => { if (misses >= 2 && !busy) later(hint, 400); });
      armIdle();
    }
  }

  function finish() {
    busy = true; clearTimeout(idle);
    sfx.win(); confetti(70);
    say('victory', null);
    q('grid').innerHTML = ''; q('scene').style.display = 'none';
    const res = q('result'); res.hidden = false;
    res.innerHTML = `<div class="big">🏆</div><h2>${strings.missionDone}</h2><p>${'⭐'.repeat(ROUNDS)}</p>` +
      `<button class="close" data-role="next">${strings.next}</button>`;
    onFinish();
  }

  function close(next) {
    clearTimeout(idle); timers.forEach(clearTimeout); timers = [];
    root.remove();
    onClose && onClose(!!next);
  }

  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-role="exit"]')) return close(false);
    if (t.closest('[data-role="next"]')) return close(true);
    if (t.closest('[data-role="repeat"]')) { sfx.tap(); if (cur && !busy) say('explain', cur.prompt); return; }
    const opt = t.closest('.mopt');
    if (opt && !busy) choose(opt);
  });

  ask();
  return { close };
}
