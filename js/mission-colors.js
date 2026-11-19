// Миссия «Учить цвета»: Тобот называет цвет, ребёнок находит его среди вариантов.
// Пул цветов растёт от миссии к миссии: 2 → 3 → 4 → … → все 8.
// Вариантов ответа на экране от 2 до 6. Ошибка не наказывается: показываем подсказку и даём попробовать снова.

export const COLOR_ORDER = ['red', 'blue', 'yellow', 'green', 'orange', 'purple', 'pink', 'brown'];
export const COLOR_HEX = {
  red: '#e53935', blue: '#1e88e5', yellow: '#fdd835', green: '#43a047',
  orange: '#fb8c00', purple: '#8e24aa', pink: '#ec407a', brown: '#8d6e63',
};
export const ROUNDS = 5;

// сколько цветов доступно при данном числе пройденных миссий
export function poolSize(missions) {
  return Math.min(COLOR_ORDER.length, 2 + Math.max(0, missions | 0));
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// один раунд: загаданный цвет и варианты (всегда содержат загаданный)
// target можно передать заранее (см. колоду в runColorsMission)
export function buildRound(missions, rng = Math.random, target = null) {
  const pool = COLOR_ORDER.slice(0, poolSize(missions));
  const optionCount = Math.min(6, pool.length);
  if (!target) target = pool[Math.floor(rng() * pool.length)];
  const others = shuffle(pool.filter((c) => c !== target), rng).slice(0, optionCount - 1);
  return { target, options: shuffle([target, ...others], rng) };
}

// Запускает миссию внутри host. strings — UI[lang] из i18n.js.
// say(type, text) — озвучка и субтитры через Тобота (см. index.html).
// onCorrect(color) — засчитать цвет и звезду. onFinish() — миссия пройдена.
// onClose() — игрок закрыл миссию (в том числе досрочно).
export function runColorsMission({ host, strings: s, lang, missions, say, onCorrect, onFinish, onClose }) {
  const name = (c) => s.colorNames[c];
  const promptFor = (c) => s.promptColor.replace('{c}', name(c));
  let round = 0, stars = 0, busy = true, target = null, timers = [];
  // колода: каждый цвет выпадает по одному разу, потом колода перемешивается заново;
  // первый цвет новой колоды не совпадает с предыдущим
  let bag = [], last = null;
  const pool = COLOR_ORDER.slice(0, poolSize(missions));
  function nextTarget() {
    if (!bag.length) {
      bag = shuffle(pool, Math.random);
      if (bag.length > 1 && bag[0] === last) bag.push(bag.shift());
    }
    last = bag.shift();
    return last;
  }

  const root = document.createElement('div');
  root.className = 'mission show';
  root.setAttribute('lang', lang);
  root.innerHTML = `
    <div class="mtop">
      <div class="pill" data-role="round"></div>
      <button class="pill btnlike" data-role="repeat" aria-label="🔊">🔊</button>
      <div class="pill" data-role="stars"></div>
      <button class="pill btnlike" data-role="exit" aria-label="✕">✕</button>
    </div>
    <div class="mprompt" data-role="prompt"></div>
    <div class="mgrid" data-role="grid"></div>
    <div class="mresult" data-role="result" hidden></div>`;
  host.appendChild(root);
  const q = (role) => root.querySelector(`[data-role="${role}"]`);

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

  function ask() {
    const { target: tg, options } = buildRound(missions, Math.random, nextTarget());
    target = tg;
    busy = false;
    q('round').textContent = `${round + 1}/${ROUNDS}`;
    q('stars').textContent = '⭐ ' + stars;
    q('prompt').textContent = promptFor(target);
    const cols = options.length <= 4 ? 2 : 3;
    q('grid').style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    q('grid').innerHTML = options.map((c) =>
      `<button class="mopt" data-c="${c}" style="background:${COLOR_HEX[c]}" aria-label="${name(c)}"></button>`
    ).join('');
    say('explain', promptFor(target));
  }

  function choose(btn) {
    const c = btn.dataset.c;
    if (c === target) {
      busy = true;
      btn.classList.add('ok');
      stars++;
      q('stars').textContent = '⭐ ' + stars;
      onCorrect(c);
      say('joy', s.praise);
      later(() => {
        round++;
        if (round >= ROUNDS) finish(); else ask();
      }, 1400);
    } else {
      btn.classList.remove('miss');
      void btn.offsetWidth; // перезапуск анимации при повторной ошибке
      btn.classList.add('miss');
      say('encourage', s.tryAgain);
    }
  }

  function finish() {
    busy = true;
    say('victory', s.missionDone);
    q('prompt').textContent = '';
    q('grid').innerHTML = '';
    q('round').textContent = `${ROUNDS}/${ROUNDS}`;
    const res = q('result');
    res.hidden = false;
    res.innerHTML = `<h2>${s.missionDone}</h2><p>${s.missionStars.replace('{n}', stars)}</p>` +
      `<button class="close" data-role="next">${s.next}</button>`;
    onFinish();
  }

  function close() {
    timers.forEach(clearTimeout);
    timers = [];
    root.remove();
    onClose && onClose();
  }

  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-role="exit"]')) return close();
    if (t.closest('[data-role="next"]')) return close();
    if (t.closest('[data-role="repeat"]')) { if (target) say('explain', promptFor(target)); return; }
    const opt = t.closest('.mopt');
    if (opt && !busy) choose(opt);
  });

  ask();
  return { close };
}
