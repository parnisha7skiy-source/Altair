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
