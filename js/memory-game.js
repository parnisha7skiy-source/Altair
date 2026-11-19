// «Найди пару»: перевёрнутые карточки, нужно найти две одинаковые. 2 → 3 → 4 пары по мере прохождения.
import { sfx, confetti } from './fx.js';

const FACES = ['🍎', '🐶', '🚗', '🌟', '🐟', '🐥', '🎈', '🍌', '🐱', '🍇'];
function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

export function runMemory({ host, lang, gt, level, say, onCorrect, onFinish, onClose, strings }) {
  const pairs = Math.min(4, 2 + level);
  const cards = shuffle(shuffle(FACES).slice(0, pairs).flatMap((f) => [f, f]));
  let open = [], found = 0, lock = false, timers = [], bad = 0;

  const root = document.createElement('div');
  root.className = 'mission show';
  root.setAttribute('lang', lang);
  root.innerHTML = `
    <div class="mtop">
      <div class="mstars" data-role="stars"></div>
      <button class="pill btnlike" data-role="repeat" aria-label="🔊">🔊</button>
      <button class="pill btnlike" data-role="exit" aria-label="✕">✕</button>
    </div>
    <div class="mgrid" data-role="grid" style="grid-template-columns:repeat(${pairs === 2 ? 2 : pairs === 3 ? 3 : 4},1fr)">
      ${cards.map((f, i) => `<button class="mopt card-back" data-i="${i}" data-f="${f}"><span>❓</span></button>`).join('')}
    </div>
    <div class="mresult" data-role="result" hidden></div>`;
  host.appendChild(root);
  const q = (r) => root.querySelector(`[data-role="${r}"]`);
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const renderStars = () => { q('stars').textContent = '⭐'.repeat(found) + '☆'.repeat(pairs - found); };
  renderStars();
  say('explain', gt.memoryQ);

  function flip(btn, up) {
    btn.classList.toggle('card-back', !up);
    btn.classList.toggle('card-up', up);
    btn.firstElementChild.textContent = up ? btn.dataset.f : '❓';
  }

  function finish() {
    sfx.win(); confetti(70);
    say('victory', null);
    q('grid').innerHTML = '';
    const res = q('result'); res.hidden = false;
    res.innerHTML = `<div class="big">🏆</div><h2>${strings.missionDone}</h2><p>${'⭐'.repeat(pairs)}</p>` +
      `<button class="close" data-role="next">${strings.next}</button>`;
    onFinish();
  }

  function close() { timers.forEach(clearTimeout); timers = []; root.remove(); onClose && onClose(); }

  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-role="exit"]') || t.closest('[data-role="next"]')) return close();
    if (t.closest('[data-role="repeat"]')) { sfx.tap(); say('explain', gt.memoryQ); return; }
    const btn = t.closest('.mopt');
    if (!btn || lock || btn.classList.contains('card-up') || btn.classList.contains('done')) return;
    sfx.tap(); flip(btn, true); open.push(btn);
    if (open.length < 2) return;
    const [a, b] = open; open = [];
    if (a.dataset.f === b.dataset.f) {
      a.classList.add('done', 'ok'); b.classList.add('done', 'ok');
      found++; renderStars(); sfx.ok(); confetti(14); onCorrect();
      if (found >= pairs) { lock = true; later(finish, 900); } else say('joy', null);
    } else {
      lock = true; sfx.miss(); bad++;
      if (bad % 2 === 0) say('encourage', null);
      later(() => { flip(a, false); flip(b, false); lock = false; }, 1100);
    }
  });

  return { close };
}
