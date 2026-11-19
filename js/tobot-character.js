// TobotCharacter — обёртка над GLB-моделью Тобота (Three.js + AnimationMixer).
//
// КОНТРАКТ МОДЕЛИ (чтобы заменить временную модель финальной, править код не нужно):
//   Обязательные клипы (имена анимаций в GLB): Idle, Greeting, Talking, Listening, Happy,
//                                              Thinking, Sad, Victory, Pointing
//   Необязательные узлы (по имени):  Mouth, EyeL, EyeR, BrowL, BrowR, Antenna, Head
//   Если узла нет — соответствующая «живость» (моргание, рот) просто отключается.
//   Модель обращена лицом к +Z, стоит на y=0, высота ~1.6 м (масштаб подгоняется через options.scale).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TobotVoice, VOICE_STYLES } from './tobot-voice.js';

export const REQUIRED_CLIPS = ['Idle', 'Greeting', 'Talking', 'Listening', 'Happy', 'Thinking', 'Sad', 'Victory', 'Pointing'];
export const OPTIONAL_NODES = ['Mouth', 'EyeL', 'EyeR', 'BrowL', 'BrowR', 'Antenna', 'Head'];
const LOOPING = new Set(['Idle', 'Talking', 'Listening', 'Thinking']);

// форма рта в покое для каждого состояния: [ширина, высота] (множители масштаба)
const MOUTH_BASE = {
  Idle: [1.0, 0.55], Greeting: [1.35, 0.8], Talking: [1.0, 0.55], Listening: [0.7, 0.6], Happy: [1.6, 0.8], Surprise: [0.8, 1.2],
  Thinking: [0.55, 0.4], Sad: [0.6, 0.3], Victory: [1.7, 1.1], Pointing: [1.0, 0.6],
};

export class TobotCharacter {
  constructor({ url, data, scale = 1 } = {}) {
    this.url = url;
    this.data = data;   // ArrayBuffer (необязательно вместо url)
    this.scale = scale;
    this.root = new THREE.Group();
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.currentName = null;
    this.nodes = {};
    this.speaking = false;
    this._mouthOpen = 0;       // 0..1, текущая «открытость» рта
    this._mouthTarget = 0;
    this._mouthShape = [1, 0.55];
    this._blink = { t: 2, phase: 0 };
    this._speakStart = 0;
    this._returnTimer = null;
    this.onClipFinished = null;
    this.voice = new TobotVoice();
  }

  async load() {
    const loader = new GLTFLoader();
    const gltf = this.data
      ? await new Promise((res, rej) => loader.parse(this.data, '', res, rej))
      : await loader.loadAsync(this.url);
    this.model = gltf.scene;
    this.model.scale.setScalar(this.scale);
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      a.setLoop(LOOPING.has(clip.name) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = false;
      a._eyes = clip.tracks.some((t) => /^Eye[LR]\.scale/.test(t.name));  // клип сам управляет масштабом глаз
      this.actions[clip.name] = a;
    }
    for (const n of OPTIONAL_NODES) this.nodes[n] = this.model.getObjectByName(n) || null;
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.current && this.currentName !== 'Idle') {
        const done = this.currentName;
        if (this.onClipFinished) this.onClipFinished(done);
        // одноразовый клип закончился -> мягко возвращаемся к Idle (или к Talking, если ещё говорим)
        if (this.current === e.action) this.play(this.speaking ? 'Talking' : 'Idle', { fade: 0.35 });
      }
    });
    this.stats = this.computeStats();
    this.play('Idle', { fade: 0 });
    return this;
  }

  /** Проверка соответствия контракту: что отсутствует в загруженной модели. */
  validate() {
    return {
      missingClips: REQUIRED_CLIPS.filter((c) => !this.actions[c]),
      missingNodes: OPTIONAL_NODES.filter((n) => !this.nodes[n]),
    };
  }

  computeStats() {
    let tris = 0, meshes = 0;
    this.model.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        const g = o.geometry;
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      }
    });
    return { tris: Math.round(tris), meshes };
  }

  /** Проиграть клип с плавным переходом. */
  play(name, { fade = 0.3 } = {}) {
    const next = this.actions[name];
    if (!next) { console.warn('Нет клипа', name); return null; }
    if (this.current === next && next.isRunning()) return next;
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (this.current) {
      if (fade > 0) this.current.crossFadeTo(next, fade, false);
      else this.current.stop();
    }
    this.current = next;
    this.currentName = name;
    return next;
  }

  /**
   * Реплика определённого типа (greeting, talk, joy, encourage, surprise, explain, victory).
   * Тело: эмоциональный клип типа (Greeting/Happy/Victory/…), после него — Talking до конца речи, затем Idle.
   * Рот: если у реплики есть аудиофайл — по реальной громкости звука (WebAudio);
   *      при синтезе речи (Web Speech не отдаёт звук) — по границам слов + слоговой ритм.
   */
  say(type, line, { onend } = {}) {
    const style = VOICE_STYLES[type] || VOICE_STYLES.talk;
    const text = typeof line === 'string' ? line : line.text;
    const audio = typeof line === 'object' && line.audio;
    this.stopSpeaking();
    this.speaking = true;
    this.play(style.clip, { fade: 0.25 });
    const finish = () => {
      if (!this.speaking) return;
      this.speaking = false; this._mouthTarget = 0; this._analyser = null;
      if (this.currentName === 'Talking') this.play('Idle', { fade: 0.4 });
      if (onend) onend();
    };
    if (audio) {
      this._playAudio(audio, finish).catch(() => this.voice.speak(text, type, { lang: line.lang || 'ru', onboundary: () => (this._mouthPulse = 1), onend: finish }));
      return { audio: true, file: audio };
    }
    const ok = this.voice.speak(text, type, { lang: line.lang || 'ru', onboundary: () => (this._mouthPulse = 1), onend: finish });
    return { audio: ok, ...this.voice.status() };
  }

  /** Совместимость: обычная речь. */
  speak(text, opts = {}) { return this.say('talk', text, opts); }

  async _playAudio(url, onend) {
    const el = new Audio(url);
    el.volume = this.voice.volume;
    el.crossOrigin = 'anonymous';
    try {
      this._ctx = this._ctx || new (window.AudioContext || window.webkitAudioContext)();
      const src = this._ctx.createMediaElementSource(el);
      const an = this._ctx.createAnalyser(); an.fftSize = 512;
      src.connect(an); an.connect(this._ctx.destination);
      this._analyser = an; this._abuf = new Uint8Array(an.fftSize);
    } catch (e) { this._analyser = null; }
    el.onended = onend;
    this._audioEl = el;
    await el.play();
  }

  stopSpeaking() {
    this.voice.stop();
    if (this._audioEl) { this._audioEl.pause(); this._audioEl = null; }
    this._analyser = null;
    if (this.speaking) {
      this.speaking = false; this._mouthTarget = 0;
      if (this.currentName === 'Talking') this.play('Idle', { fade: 0.3 });
    }
  }

  /** Вызывать каждый кадр ПОСЛЕ расчёта dt. Миксер -> затем рантайм-надстройка (моргание, рот). */
  update(dt) {
    if (!this.mixer) return;
    this.mixer.update(dt);

    // --- рот
    const now = performance.now() / 1000;
    if (this.speaking && this._analyser) {
      this._analyser.getByteTimeDomainData(this._abuf);
      let sum = 0; for (const v of this._abuf) { const d = (v - 128) / 128; sum += d * d; }
      this._mouthTarget = Math.min(1, Math.sqrt(sum / this._abuf.length) * 6);
    } else if (this.speaking) {
      const syl = 0.5 + 0.5 * Math.sin(now * 2 * Math.PI * 5.2) * (0.6 + 0.4 * Math.sin(now * 2.3));
      this._mouthPulse = Math.max(0, (this._mouthPulse || 0) - dt * 6);
      this._mouthTarget = Math.min(1, 0.15 + 0.65 * syl + 0.5 * this._mouthPulse);
    }
    this._mouthOpen += (this._mouthTarget - this._mouthOpen) * Math.min(1, dt * 22);
    const base = MOUTH_BASE[this.currentName] || MOUTH_BASE.Idle;
    this._mouthShape[0] += (base[0] - this._mouthShape[0]) * Math.min(1, dt * 8);
    this._mouthShape[1] += (base[1] - this._mouthShape[1]) * Math.min(1, dt * 8);
    const m = this.nodes.Mouth;
    if (m) m.scale.set(this._mouthShape[0] * (1 - 0.25 * this._mouthOpen), this._mouthShape[1] + 2.2 * this._mouthOpen, 1);

    // --- моргание (множитель поверх клипа)
    const b = this._blink;
    b.t -= dt;
    if (b.phase === 0 && b.t <= 0) { b.phase = 1; b.t = 0.07; }
    else if (b.phase === 1 && b.t <= 0) { b.phase = 2; b.t = 0.09; }
    else if (b.phase === 2 && b.t <= 0) { b.phase = 0; b.t = 2 + Math.random() * 3; }
    const k = b.phase === 1 ? 0.08 : b.phase === 2 ? 0.55 : 1;
    // если ни один активный клип не пишет масштаб глаз, миксер его не сбрасывает -> задаём абсолютно
    const driven = Object.values(this.actions).some((a) => a._eyes && a.isRunning() && a.getEffectiveWeight() > 0);
    for (const e of [this.nodes.EyeL, this.nodes.EyeR]) {
      if (!e) continue;
      if (e.userData.baseY === undefined) e.userData.baseY = e.scale.y;
      e.scale.y = (driven ? e.scale.y : e.userData.baseY) * k;
    }
  }

  dispose() {
    this.stopSpeaking();
    this.mixer && this.mixer.stopAllAction();
    this.root.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); }
    });
  }
}
