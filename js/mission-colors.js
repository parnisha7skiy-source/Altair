// Миссия «Учить цвета»: Тобот просит найти предмет нужного цвета («Найди красное яблоко!»).
// Пул цветов растёт от миссии к миссии: 4 → 5 → … → все 8. Вариантов на экране всегда 4.
// Ошибка не наказывается: мягкий звук, подбадривание, после двух промахов или паузы — подсказка.
import { sfx, confetti, once } from './fx.js';

// порядок введения: сначала красный, зелёный, коричневый и синий, потом остальные
export const COLOR_ORDER = ['red', 'green', 'brown', 'blue', 'yellow', 'orange', 'purple', 'pink'];
// эти цвета выпадают чаще (в колоде по два раза)
export const PRIORITY = ['red', 'green', 'brown'];
export const OPTIONS = 4;   // вариантов ответа на экране
export const COLOR_HEX = {
  red: '#e53935', blue: '#1e88e5', yellow: '#fdd835', green: '#43a047',
  orange: '#fb8c00', purple: '#8e24aa', pink: '#ec407a', brown: '#8d6e63',
};
// предмет каждого цвета: ребёнок видит картинку, а слово слышит от Тобота
export const COLOR_EMOJI = {
  red: '🍎', blue: '🐳', yellow: '🍌', green: '🐸', orange: '🍊', purple: '🍇', pink: '🐷', brown: '🐻',
};
export const ROUNDS = 5;
const HINT_AFTER_MISSES = 2;
const HINT_IDLE_MS = 9000;

export function poolSize(missions) {
  return Math.min(COLOR_ORDER.length, OPTIONS + Math.max(0, missions | 0));   // сразу 4 цвета, дальше по одному
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// pairSafe: красный и зелёный не показываются вместе (их часто путают дети с особенностями цветового зрения)
export function buildRound(missions, rng = Math.random, target = null, pairSafe = false) {
  const pool = COLOR_ORDER.slice(0, poolSize(missions));
  const optionCount = Math.min(OPTIONS, pool.length);
  if (!target) target = pool[Math.floor(rng() * pool.length)];
  let others = shuffle(pool.filter((c) => c !== target), rng);
  if (pairSafe) {
    if (target === 'red') others = others.filter((c) => c !== 'green');
    if (target === 'green') others = others.filter((c) => c !== 'red');
    if (target !== 'red' && target !== 'green') {
      // если оба из пары попали в варианты, убираем один из них
      const both = others.includes('red') && others.includes('green');
      if (both) { const drop = rng() < 0.5 ? 'red' : 'green'; others = others.filter((c) => c !== drop); }
    }
  }
  others = others.slice(0, optionCount - 1);
  return { target, options: shuffle([target, ...others], rng) };
}

// say(type, text|null): text=null — Тобот сам выбирает реплику типа из content/phrases.json
export function runColorsMission({ host, strings: s, lang, missions, say, onCorrect, onFinish, onClose, labels = false, pairSafe = false }) {
  const promptFor = (c) => s.promptColor.replace('{o}', s.objects[c]);
  let round = 0, stars = 0, misses = 0, busy = true, target = null, timers = [], idle = null;

  // колода: каждый цвет по одному разу, затем перемешиваем; подряд одинаковых нет
  let bag = [], last = null;
  const pool = COLOR_ORDER.slice(0, poolSize(missions));
  function nextTarget() {
    if (!bag.length) {
      const deck = pool.flatMap((c) => (PRIORITY.includes(c) ? [c, c] : [c]));
      // перемешиваем, пока два одинаковых цвета не окажутся рядом (и первый не совпадёт с предыдущим)
      for (let tries = 0; tries < 50; tries++) {
        bag = shuffle(deck, Math.random);
        if (bag[0] !== last && bag.every((c, i) => i === 0 || c !== bag[i - 1])) break;
      }
    }
    last = bag.shift();
    return last;
  }

  const root = document.createElement('div');
  root.className = 'mission show';
  root.setAttribute('lang', lang);
  root.innerHTML = `
    <div class="mtop">
      <div class="mstars" data-role="stars"></div>
      <button class="pill btnlike" data-role="repeat" aria-label="🔊">🔊</button>
      <button class="pill btnlike" data-role="exit" aria-label="✕">✕</button>
    </div>
    <div class="mgrid" data-role="grid"></div>
    <div class="mresult" data-role="result" hidden></div>`;
  host.appendChild(root);
  const q = (role) => root.querySelector(`[data-role="${role}"]`);

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function renderStars() {
    q('stars').textContent = '⭐'.repeat(stars) + '☆'.repeat(ROUNDS - stars);
  }
  function hint() {
    const el = root.querySelector(`.mopt[data-c="${target}"]`);
    if (el) el.classList.add('hint');
    say('explain', promptFor(target));
  }
  function armIdle() {
    clearTimeout(idle);
    idle = setTimeout(() => { if (!busy) hint(); armIdle(); }, HINT_IDLE_MS);
  }

  function ask() {
    const { target: tg, options } = buildRound(missions, Math.random, nextTarget(), pairSafe);
    target = tg; misses = 0; busy = false;
    renderStars();
    q('grid').style.gridTemplateColumns = `repeat(${options.length <= 4 ? 2 : 3}, 1fr)`;
    q('grid').innerHTML = options.map((c) =>
      `<button class="mopt" data-c="${c}" style="background:${COLOR_HEX[c]}" aria-label="${s.colorNames[c]}"><span>${COLOR_EMOJI[c]}</span>${labels ? `<em class="mlabel">${s.colorNames[c]}</em>` : ''}</button>`
    ).join('');
    say('explain', promptFor(target));
    armIdle();
  }

  function choose(btn) {
    const c = btn.dataset.c;
    if (c === target) {
      busy = true; clearTimeout(idle);
      btn.classList.add('ok');
      stars++; renderStars();
      sfx.ok(); confetti(24);
      onCorrect(c);
      // следующий раунд — только когда Тобот договорил похвалу (страховка 9 секунд)
      const go = once(() => { round++; if (round >= ROUNDS) finish(); else ask(); });
      say('joy', null, () => later(go, 600));
      later(go, 9000);
    } else {
      sfx.miss();
      btn.classList.remove('miss'); void btn.offsetWidth; btn.classList.add('miss');
      misses++;
      say('encourage', null, () => { if (misses >= HINT_AFTER_MISSES && !busy) later(hint, 400); });
      armIdle();
    }
  }

  function finish() {
    busy = true; clearTimeout(idle);
    sfx.win(); confetti(70);
    say('victory', null);
    q('grid').innerHTML = '';
    const res = q('result');
    res.hidden = false;
    res.innerHTML = `<div class="big">🏆</div><h2>${s.missionDone}</h2><p>${'⭐'.repeat(ROUNDS)}</p>` +
      `<button class="close" data-role="next">${s.next}</button>`;
    onFinish();
  }

  function close(next) {
    clearTimeout(idle);
    timers.forEach(clearTimeout); timers = [];
    root.remove();
    onClose && onClose(!!next);
  }

  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-role="exit"]')) return close(false);
    if (t.closest('[data-role="next"]')) return close(true);
    if (t.closest('[data-role="repeat"]')) { sfx.tap(); if (target && !busy) say('explain', promptFor(target)); return; }
    const opt = t.closest('.mopt');
    if (opt && !busy) choose(opt);
  });

  ask();
  return { close };
}
