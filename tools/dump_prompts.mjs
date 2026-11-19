// Печатает JSON {ru:[...], kk:[...]} — тексты заданий игр. Используется генератором озвучки.
import { allPrompts } from '../js/games.js';
globalThis.window = globalThis.window || {};
console.log(JSON.stringify({ ru: allPrompts('ru'), kk: allPrompts('kk') }));
