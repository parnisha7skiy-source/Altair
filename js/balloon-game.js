// «Шарики»: шарики плывут вверх, нужно лопнуть 5 шариков названного цвета. Промах не наказывается.
import { sfx, confetti } from './fx.js';
import { COLOR_ORDER, COLOR_HEX, poolSize } from './mission-colors.js';

const GOAL = 5;

export function runBalloons({ host, lang, gt, level, say, onCorrect, onFinish, onClose, strings }) {
  const pool = COLOR_ORDER.slice(0, Math.max(3, poolSize(level)));
  const target = pool[Math.floor(Math.random() * pool.length)];
  const prompt = gt.balloonQ.replace('{o}', gt.balloonColors[target]);
  let popped = 0, over = false, timers = [], spawnT = null, idle = null, lastTalk = 0;

  const root = document.createElement('div');
  root.className = 'mission show air';
  root.setAttribute('lang', lang);
  root.innerHTML = `
    <div class="mtop">
      <div class="mstars" data-role="stars"></div>
      <button class="pill btnlike" data-role="repeat" aria-label="🔊">🔊</button>
      <button class="pill btnlike" data-role="exit" aria-label="✕">✕</button>
    </div>
    <div class="field" data-role="field"></div>
    <div class="mresult" data-role="result" hidden></div>`;
  host.appendChild(root);
  const q = (r) => root.querySelector(`[data-role="${r}"]`);
  const field = q('field');
  const renderStars = () => { q('stars').textContent = '⭐'.repeat(popped) + '☆'.repeat(GOAL - popped); };
  renderStars();
  say('explain', prompt);

  function talk(type) {
    const now = Date.now();
    if (now - lastTalk < 3500) return;
    lastTalk = now; say(type, null);
  }
  function armIdle() { clearTimeout(idle); idle = setTimeout(() => { if (!over) { lastTalk = Date.now(); say('explain', prompt); } armIdle(); }, 12000); }

  function spawn() {
    if (over) return;
    const c = Math.random() < 0.5 ? target : pool[Math.floor(Math.random() * pool.length)];
    const b = document.createElement('button');
    b.className = 'balloon';
    b.dataset.c = c;
    b.setAttribute('aria-label', c);
    b.style.background = COLOR_HEX[c];
    b.style.left = (4 + Math.random() * 78) + '%';
    field.appendChild(b);
    const rise = innerHeight + 220;
    const dur = 5500 + Math.random() * 2500;
    const sway = (Math.random() - 0.5) * 60;
    const anim = b.animate([
      { transform: 'translate(0,0)' },
      { transform: `translate(${sway}px,${-rise * 0.5}px)` },
      { transform: `translate(${-sway}px,${-rise}px)` },
    ], { duration: dur, easing: 'linear' });
    anim.onfinish = () => b.remove();
  }
  function loop() { spawn(); spawnT = setTimeout(loop, 700 + Math.random() * 400); }
  loop(); armIdle();

  function finish() {
    over = true; clearTimeout(spawnT); clearTimeout(idle);
    field.querySelectorAll('.balloon').forEach((b) => b.remove());
    sfx.win(); confetti(70);
    say('victory', null);
    const res = q('result'); res.hidden = false;
    res.innerHTML = `<div class="big">🏆</div><h2>${strings.missionDone}</h2><p>${'⭐'.repeat(GOAL)}</p>` +
      `<button class="close" data-role="next">${strings.next}</button>`;
    onFinish();
  }

  function close(next) {
    over = true; clearTimeout(spawnT); clearTimeout(idle); timers.forEach(clearTimeout);
    root.remove(); onClose && onClose(!!next);
  }

  root.addEventListener('pointerdown', (e) => {
    const t = e.target;
    const b = t.closest && t.closest('.balloon');
    if (!b || over) return;
    if (b.dataset.c === target) {
      b.classList.add('pop');
      setTimeout(() => b.remove(), 160);
      popped++; renderStars(); sfx.ok(); confetti(8); onCorrect(target);
      armIdle();
      if (popped >= GOAL) finish(); else if (popped === 2 || popped === 4) talk('joy');
    } else {
      sfx.miss();
      b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
      talk('encourage');
    }
  });
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-role="exit"]')) return close(false);
    if (t.closest('[data-role="next"]')) return close(true);
    if (t.closest('[data-role="repeat"]')) { sfx.tap(); lastTalk = Date.now(); say('explain', prompt); }
  });

  return { close };
}
