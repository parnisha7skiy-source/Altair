// Простые эффекты без внешних файлов: звуки (WebAudio) и конфетти. Всё запускается только по касанию.
let ctx = null;
function ac() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) {}
  return ctx;
}
function tone(freq, t0, dur, type = 'sine', vol = 0.16) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  const t = c.currentTime + t0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  tap() { tone(520, 0, 0.07); },
  ok() { [660, 880, 1320].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle')); },
  miss() { tone(330, 0, 0.16, 'sine', 0.1); tone(262, 0.12, 0.22, 'sine', 0.09); },   // мягко, без «ошибки»
  win() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.11, 0.32, 'triangle')); },
};

const COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#fb8c00', '#8e24aa', '#ec407a'];
export function confetti(n = 36) {
  const W = innerWidth, H = innerHeight;
  for (let i = 0; i < n; i++) {
    const el = document.createElement('i');
    const s = 8 + Math.random() * 10;
    el.style.cssText = `position:fixed;left:${W / 2}px;top:${H * 0.38}px;width:${s}px;height:${s * 0.6}px;` +
      `background:${COLORS[i % COLORS.length]};border-radius:2px;pointer-events:none;z-index:20`;
    document.body.appendChild(el);
    const dx = (Math.random() - 0.5) * W * 0.9;
    const up = -(60 + Math.random() * 160);
    const down = H * 0.5 + Math.random() * 120;
    const rot = (Math.random() - 0.5) * 900;
    el.animate([
      { transform: 'translate(0,0) rotate(0)', opacity: 1 },
      { transform: `translate(${dx * 0.6}px,${up}px) rotate(${rot * 0.4}deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(${dx}px,${down}px) rotate(${rot}deg)`, opacity: 0 },
    ], { duration: 1500 + Math.random() * 600, easing: 'ease-out' }).onfinish = () => el.remove();
  }
}

// вызвать функцию не более одного раза (для «после реплики идём дальше» + страховка по таймеру)
export function once(fn) { let d = false; return (...a) => { if (d) return; d = true; return fn(...a); }; }
