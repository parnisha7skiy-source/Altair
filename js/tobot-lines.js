// Реплики Тобота. Тексты лежат в content/phrases.json (ru и kk), озвучка — в audio/ по манифесту.
// pickLine выбирает реплики «мешком»: все варианты типа идут по кругу без повторов.
// Если для реплики есть готовый файл озвучки, он будет помечен в поле audio.

let DATA = null;
let MANIFEST = {};
const bags = {};
const last = {};

export async function loadPhrases(base = './') {
  const [data, manifest] = await Promise.all([
    fetch(base + 'content/phrases.json', { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error('phrases.json: ' + r.status);
      return r.json();
    }),
    fetch(base + 'audio/manifest.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  DATA = data;
  MANIFEST = manifest;
  return data;
}

export function audioReady(lang) {
  return Object.keys(MANIFEST).some((k) => k.startsWith(lang + '/'));
}

// озвучка задания игры по точному тексту (ключ манифеста prompt|<язык>|<текст>)
export function audioForText(lang, text) {
  const e = MANIFEST[`prompt|${lang}|${text}`];
  return e ? e.file + '?v=' + e.hash : null;
}

function nextIndex(key, n) {
  let bag = bags[key];
  if (!bag || bag.length === 0) {
    bag = Array.from({ length: n }, (_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (bag.length > 1 && bag[0] === last[key]) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
  }
  bags[key] = bag;
  const idx = bag.pop();
  last[key] = idx;
  return idx;
}

export function pickLine(lang, type) {
  const arr = DATA.lines[lang][type] || DATA.lines[lang].talk;
  const realType = DATA.lines[lang][type] ? type : 'talk';
  const i = nextIndex(lang + ':' + realType, arr.length);
  const id = `${lang}/${realType}-${i}`;
  const entry = MANIFEST[id];
  return {
    id,
    lang,
    type: realType,
    text: arr[i].replace(/\{name\}/g, DATA.name),
    audio: entry ? entry.file + '?v=' + entry.hash : null,   // хэш в адресе: после перезаписи озвучки старый файл из кэша не играет
  };
}

// Для тапа по Тоботу: смесь типов, чтобы он говорил разное.
const MIX = ['talk', 'talk', 'talk', 'joy', 'encourage', 'surprise', 'greeting'];
export function pickMixed(lang) {
  return pickLine(lang, MIX[Math.floor(Math.random() * MIX.length)]);
}
