// Реестр игр. Чтобы добавить игру: модуль с функцией run…, строка здесь, тексты в js/game-text.js.
import { runColorsMission } from './mission-colors.js';
import { runChoice } from './choice-games.js';
import { runMemory } from './memory-game.js';
import { runBalloons } from './balloon-game.js';
import { GT } from './game-text.js';
import { UI } from './i18n.js';

export const GAMES = [
  { id: 'colors', emoji: '🎨', air: false },
  { id: 'counting', emoji: '🔢', air: false },
  { id: 'shapes', emoji: '🔷', air: false },
  { id: 'animals', emoji: '🐮', air: false },
  { id: 'memory', emoji: '🃏', air: false },
  { id: 'odd', emoji: '🧩', air: false },
  { id: 'balloons', emoji: '🎈', air: true },
];
// порядок «Начать приключение»
export const ADVENTURE = ['colors', 'counting', 'shapes', 'animals', 'memory', 'odd', 'balloons'];

export const gameName = (lang, id) => GT[lang].names[id];

// ctx: { host, lang, level, say, onCorrect, onFinish, onClose }
export function runGame(id, ctx) {
  const gt = GT[ctx.lang], strings = UI[ctx.lang];
  const base = { ...ctx, gt, strings };
  if (id === 'colors') return runColorsMission({ ...ctx, strings, missions: ctx.level });
  if (id === 'memory') return runMemory(base);
  if (id === 'balloons') return runBalloons(base);
  return runChoice({ ...base, id });
}

// Все задания игр как тексты — для озвучки (tools/generate_voices.py). Порядок не важен.
export function allPrompts(lang) {
  const gt = GT[lang], u = UI[lang], out = [];
  for (const o of Object.values(u.objects)) out.push(u.promptColor.replace('{o}', o));
  for (const o of Object.values(gt.countObjs)) out.push(gt.countQ.replace('{o}', o));
  for (const o of Object.values(gt.shapes)) out.push(gt.shapeQ.replace('{o}', o));
  for (const s of Object.values(gt.sounds)) out.push(gt.animalQ.replace('{s}', s));
  for (const o of Object.values(gt.balloonColors)) out.push(gt.balloonQ.replace('{o}', o));
  out.push(gt.oddQ, gt.memoryQ);
  return [...new Set(out)];
}
