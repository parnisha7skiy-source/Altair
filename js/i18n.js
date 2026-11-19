// Интерфейс на двух языках: русский и казахский. Все надписи — здесь, а не в коде экранов.
export const LANGS = ['ru', 'kk'];

export const UI = {
  ru: {
    title: 'Привет, Альтаир!',
    hint: 'Нажми на Тобота — он поздоровается',
    start: 'Начать приключение',
    colors: 'Учить цвета',
    play: 'Играть',
    rewards: 'Мои награды',
    soon: 'скоро',
    rewardsTitle: 'Мои награды',
    stars: 'звёзд',
    missions: 'миссий',
    colorsCount: 'цветов',
    close: 'Закрыть',
    soonToast: 'Модули миссий появятся в следующих обновлениях',
    noVoice: 'На этом устройстве нет казахского голоса. Тобот показывает текст.',
    langBtn: 'ҚАЗ',
    colorsTitle: 'Учим цвета',
    promptColor: 'Найди {o}!',
    objects: {
      red: 'красное яблоко', blue: 'синего кита', yellow: 'жёлтый банан', green: 'зелёную лягушку',
      orange: 'оранжевый апельсин', purple: 'фиолетовый виноград', pink: 'розовую свинку', brown: 'коричневого мишку',
    },
    colorNames: {
      red: 'красный', blue: 'синий', yellow: 'жёлтый', green: 'зелёный',
      orange: 'оранжевый', purple: 'фиолетовый', pink: 'розовый', brown: 'коричневый',
    },
    praise: 'Молодец!',
    tryAgain: 'Попробуй ещё раз!',
    missionDone: 'Миссия выполнена!',
    missionStars: 'Звёзд за миссию: {n}',
    next: 'Дальше',
    achievements: [
      { icon: '🏁', name: 'Первая миссия' },
      { icon: '🔴', name: 'Знаток красного цвета' },
      { icon: '🌈', name: 'Знаток всех цветов' },
      { icon: '🤝', name: 'Помощник Тобота' },
      { icon: '🏆', name: 'Настоящий чемпион' },
    ],
  },
  kk: {
    title: 'Сәлем, Альтаир!',
    hint: 'Тоботты бас — ол сәлемдеседі',
    start: 'Шытырман оқиғаны бастау',
    colors: 'Түстерді үйрену',
    play: 'Ойнау',
    rewards: 'Менің марапаттарым',
    soon: 'жақында',
    rewardsTitle: 'Менің марапаттарым',
    stars: 'жұлдыз',
    missions: 'миссия',
    colorsCount: 'түс',
    close: 'Жабу',
    soonToast: 'Миссия модульдері келесі жаңартуларда пайда болады',
    noVoice: 'Бұл құрылғыда қазақ дауысы жоқ. Тобот мәтінді көрсетеді.',
    langBtn: 'РУС',
    colorsTitle: 'Түстерді үйренеміз',
    promptColor: '{o} тап!',
    objects: {
      red: 'қызыл алманы', blue: 'көк китті', yellow: 'сары бананды', green: 'жасыл бақаны',
      orange: 'қызғылт сары апельсинді', purple: 'күлгін жүзімді', pink: 'қызғылт шошқаны', brown: 'қоңыр аюды',
    },
    colorNames: {
      red: 'қызыл', blue: 'көк', yellow: 'сары', green: 'жасыл',
      orange: 'қызғылт сары', purple: 'күлгін', pink: 'қызғылт', brown: 'қоңыр',
    },
    praise: 'Керемет!',
    tryAgain: 'Тағы байқап көр!',
    missionDone: 'Миссия орындалды!',
    missionStars: 'Миссия үшін жұлдыз: {n}',
    next: 'Әрі қарай',
    achievements: [
      { icon: '🏁', name: 'Бірінші миссия' },
      { icon: '🔴', name: 'Қызыл түс білгірі' },
      { icon: '🌈', name: 'Барлық түстерді білгірі' },
      { icon: '🤝', name: 'Тобот көмекшісі' },
      { icon: '🏆', name: 'Шынайы чемпион' },
    ],
  },
};

const KEY = 'tobot.lang';

export function initialLang() {
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGS.includes(saved)) return saved;
  } catch (e) {}
  return (navigator.language || '').toLowerCase().startsWith('kk') ? 'kk' : 'ru';
}

export function saveLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch (e) {}
}
