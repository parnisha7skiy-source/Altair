// TobotVoice — голос Тобота на Web Speech API.
// Задачи: (1) выбрать МОЛОДОЙ МУЖСКОЙ русский голос и закрепить его (постоянный, узнаваемый),
//         (2) 7 типов озвучивания с разной высотой/темпом/интонацией,
//         (3) мультяшная подача: повышенный тон + интонация по фразам (! и ? звучат выше).
// Ограничение: «характер» голоса задаёт устройство. Если мужского русского голоса на устройстве нет,
// модуль честно сообщает об этом (status.male === false) и даёт инструкцию, как его установить.

export const VOICE_STYLES = {
  greeting:  { label: 'Приветствие',   icon: '👋', rate: 0.94, pitch: 1.42, clip: 'Greeting' },
  talk:      { label: 'Разговор',      icon: '💬', rate: 0.92, pitch: 1.32, clip: 'Talking' },
  joy:       { label: 'Радость',       icon: '😄', rate: 1.00, pitch: 1.55, clip: 'Happy' },
  encourage: { label: 'Подбадривание', icon: '🤗', rate: 0.86, pitch: 1.30, clip: 'Talking' },
  surprise:  { label: 'Удивление',     icon: '😮', rate: 0.88, pitch: 1.60, clip: 'Sad' },
  explain:   { label: 'Объяснение',    icon: '👉', rate: 0.84, pitch: 1.28, clip: 'Pointing' },
  victory:   { label: 'Победа',        icon: '🏆', rate: 0.96, pitch: 1.58, clip: 'Victory' },
};

// Известные мужские русские голоса (iOS/macOS, Windows/Edge, прочие) — по убыванию качества.
const MALE = [/dmitr.*natural/i, /дмитр/i, /yuri.*(enhanced|premium|улучш)/i, /yuri|юрий/i, /dmitr/i,
  /pavel|павел/i, /maxim|максим/i, /ermil|filipp|филипп|nikolai|николай|artem|артём|artyom/i, /\bmale\b|мужск/i];
const FEMALE = /milena|милена|irina|ирина|svetlana|светлана|katya|катя|alena|алёна|anna|анна|daria|дарья|female|женск|google русский/i;
const KEY = 'tobot.voiceURI';

export const MALE_VOICE_HELP = {
  iphone: 'iPhone/iPad: Настройки → Универсальный доступ → Устный контент → Голоса → Русский → «Юрий» (лучше «улучшенный»), скачать. Затем перезагрузить страницу.',
  windows: 'Компьютер: откройте страницу в Microsoft Edge — там есть мужской голос «Dmitry (Natural)». В Windows также: Параметры → Время и язык → Речь → Добавить голоса → Русский («Павел»).',
  android: 'Android: Настройки → Синтез речи → Google → Установить голосовые данные → Русский → выбрать мужской вариант голоса.',
};

export class TobotVoice {
  constructor() {
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.voice = null;
    this.volume = 1;
    this.ready = this._init();
  }

  get supported() { return !!(this.synth && typeof SpeechSynthesisUtterance !== 'undefined'); }

  _init() {
    if (!this.supported) return Promise.resolve();
    return new Promise((res) => {
      const done = () => { this._pick(); res(); };
      if (this.synth.getVoices().length) return done();
      this.synth.addEventListener?.('voiceschanged', done, { once: true });
      setTimeout(done, 1500);                       // Safari иногда не шлёт событие
    });
  }

  /** Есть ли на устройстве голос для языка (ru, kk). Казахский часто отсутствует — тогда показываем текст. */
  hasVoiceFor(lang) {
    if (!this.supported) return false;
    const code = lang === 'kk' ? 'kk' : 'ru';
    return this.synth.getVoices().some((v) => v.lang && v.lang.toLowerCase().startsWith(code));
  }

  /** Все русские голоса с пометкой «мужской?» и оценкой. */
  list() {
    if (!this.supported) return [];
    return this.synth.getVoices().filter((v) => /^ru/i.test(v.lang)).map((v) => {
      const mi = MALE.findIndex((r) => r.test(v.name));
      const male = mi >= 0 && !FEMALE.test(v.name);
      const score = (male ? 100 - mi * 5 : 0) + (/natural|enhanced|premium|neural|улучш/i.test(v.name) ? 10 : 0) + (v.localService ? 2 : 0);
      return { voice: v, name: v.name, uri: v.voiceURI, male, score };
    }).sort((a, b) => b.score - a.score);
  }

  _pick() {
    const all = this.list();
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    const chosen = all.find((x) => x.uri === saved) || all[0];
    this.voice = chosen ? chosen.voice : null;
    this.isMale = chosen ? chosen.male : false;
  }

  /** Закрепить голос (выбор родителя) — сохраняется, чтобы голос Тобота не «плавал». */
  setVoice(uri) {
    const x = this.list().find((v) => v.uri === uri);
    if (!x) return;
    this.voice = x.voice; this.isMale = x.male;
    try { localStorage.setItem(KEY, uri); } catch (e) {}
  }

  status() {
    return { supported: this.supported, voice: this.voice ? this.voice.name : null, male: !!this.isMale, count: this.list().length };
  }

  /** Разбить на фразы и выставить интонацию каждой: восклицание и вопрос выше, концовка объяснения медленнее. */
  plan(text, styleKey) {
    const st = VOICE_STYLES[styleKey] || VOICE_STYLES.talk;
    // Если мужской голос не найден, тон поднимаем меньше: женский голос + высокий тон звучит пискляво
    const lift = this.isMale ? 0 : -0.25;
    const parts = text.match(/[^.!?…]+[.!?…]*/g) || [text];
    return parts.map((p, i) => {
      p = p.trim();
      let pitch = st.pitch + lift, rate = st.rate;
      if (/!$/.test(p)) pitch += 0.08;
      if (/\?$/.test(p)) pitch += 0.12;
      if (styleKey === 'explain' && i === parts.length - 1) rate -= 0.05;
      if (styleKey === 'joy' || styleKey === 'victory') pitch += (i % 2) * 0.05;   // «прыгающая» радостная интонация
      return { text: p, pitch: Math.min(2, Math.max(0.5, pitch)), rate };
    }).filter((x) => x.text);
  }

  /**
   * Произнести. Все фразы ставятся в очередь синхронно — это важно для iPhone,
   * где речь разрешена только в ответ на касание.
   */
  speak(text, styleKey = 'talk', { onstart, onboundary, onend, lang = 'ru' } = {}) {
    this.stop();
    if (!this.supported || !this.hasVoiceFor(lang)) { onend && setTimeout(onend, Math.max(1200, text.length * 70)); return false; }
    const plan = this.plan(text, styleKey);
    let finished = false;
    const end = () => { if (!finished) { finished = true; onend && onend(); } };
    plan.forEach((ph, i) => {
      const u = new SpeechSynthesisUtterance(ph.text);
      u.lang = lang === 'kk' ? 'kk-KZ' : 'ru-RU'; u.pitch = ph.pitch; u.rate = ph.rate; u.volume = this.volume;
      const match = this.synth.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith(lang === 'kk' ? 'kk' : 'ru'));
      if (lang === 'kk' ? match : this.voice) u.voice = lang === 'kk' ? match : this.voice;
      if (i === 0) u.onstart = () => onstart && onstart();
      u.onboundary = () => onboundary && onboundary();
      if (i === plan.length - 1) { u.onend = end; }
      u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') end(); };
      this.synth.speak(u);
    });
    return true;
  }

  stop() { if (this.supported) this.synth.cancel(); }
}
