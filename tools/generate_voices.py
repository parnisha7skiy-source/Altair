#!/usr/bin/env python3
"""
Генерация озвучки Тобота нейронными голосами Microsoft -> audio/<lang>/<id>.mp3

Два движка (--engine):
  edge   — библиотека edge-tts: бесплатно, без аккаунта и ключа (те же голоса Dmitry/Daulet). Неофициальный
           доступ к сервису чтения в Edge: для семейного приложения подходит, но может перестать работать.
  azure  — официальный Azure AI Speech (нужен ключ и регион).
  auto   — по умолчанию: azure, если заданы AZURE_SPEECH_KEY и AZURE_SPEECH_REGION, иначе edge.

Что делает:
  1. читает content/phrases.json (все реплики на русском и казахском);
  2. для каждой реплики считает хэш (текст + голос + стиль + темп + тон);
  3. если файла нет или хэш изменился — запрашивает синтез у Azure и сохраняет MP3;
  4. пишет audio/manifest.json: приложение по нему понимает, какой файл проигрывать.

Запуск (нужен ключ Azure Speech и интернет):
  export AZURE_SPEECH_KEY=...           # ключ ресурса Speech
  export AZURE_SPEECH_REGION=eastus     # регион ресурса, например westeurope или eastus
  python3 tools/generate_voices.py              # только изменённые реплики
  python3 tools/generate_voices.py --force      # перегенерировать всё
  python3 tools/generate_voices.py --only kk    # только казахский

Голоса меняются в VOICES ниже. Ключ в репозиторий не кладите: он нужен только на вашем компьютере.
Скрипт использует только стандартную библиотеку Python 3.8+.
"""
import argparse
import asyncio
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
PHRASES = ROOT / "content" / "phrases.json"
AUDIO = ROOT / "audio"
MANIFEST = AUDIO / "manifest.json"

# Голос по языку. Казахский: DauletNeural (мужской) или AigulNeural (женский).
# Русский: DmitryNeural (мужской). Список голосов: https://learn.microsoft.com/azure/ai-services/speech-service/language-support
VOICES = {
    "ru": {"name": "ru-RU-DmitryNeural", "lang": "ru-RU"},
    "kk": {"name": "kk-KZ-DauletNeural", "lang": "kk-KZ"},
}

# Характер по типу реплики: темп и тон в процентах относительно обычного голоса.
PROSODY = {
    "greeting":  {"rate": "+4%",  "pitch": "+10%"},
    "talk":      {"rate": "-2%",  "pitch": "+4%"},
    "joy":       {"rate": "+8%",  "pitch": "+14%"},
    "encourage": {"rate": "-8%",  "pitch": "+4%"},
    "surprise":  {"rate": "+2%",  "pitch": "+18%"},
    "explain":   {"rate": "-8%",  "pitch": "+2%"},
    "victory":   {"rate": "+6%",  "pitch": "+14%"},
}

# Эмоциональные стили Azure (express-emotion). Не все голоса их поддерживают.
# Включаются только флагом --styles; если голос стиль не знает, Azure просто играет без него.
STYLES = {
    "greeting": "friendly", "joy": "cheerful", "victory": "cheerful",
    "encourage": "hopeful", "talk": "friendly",
}

ENDPOINT = "https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
OUTPUT_FORMAT = "audio-24khz-96kbitrate-mono-mp3"


def build_ssml(lang, voice, text, ptype, use_styles):
    p = PROSODY.get(ptype, PROSODY["talk"])
    body = f'<prosody rate="{p["rate"]}" pitch="{p["pitch"]}">{escape(text)}</prosody>'
    style = STYLES.get(ptype) if use_styles else None
    if style:
        body = f'<mstts:express-emotion style="{style}">{body}</mstts:express-emotion>'
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        'xmlns:mstts="https://www.w3.org/2001/mstts" '
        f'xml:lang="{VOICES[lang]["lang"]}">'
        f'<voice name="{voice}">{body}</voice></speak>'
    )


def synthesize(region, key, ssml):
    req = urllib.request.Request(
        ENDPOINT.format(region=region),
        data=ssml.encode("utf-8"),
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml; charset=utf-8",
            "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
            "User-Agent": "tobot-voice-generator",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Azure ответил {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")


def _pct(x):
    return int(x.rstrip("%"))


def sentence_prosody(ptype, sent, idx, total):
    """Интонация одного предложения: восклицания выше и быстрее, вопросы с подъёмом, короткие «Ура!» ярче."""
    p = PROSODY.get(ptype, PROSODY["talk"])
    rate, pitch = _pct(p["rate"]), _pct(p["pitch"])
    s = sent.strip()
    if s.endswith("!"):
        pitch += 8; rate += 4
    elif s.endswith("?"):
        pitch += 10; rate -= 3
    if len(s.split()) <= 3 and s.endswith(("!", "?")):
        pitch += 8; rate += 4          # «Ура!», «Ой!», «Ух ты!»
    if idx == total - 1 and ptype in ("explain", "encourage", "victory"):
        rate -= 4                      # концовка чуть медленнее и яснее
    return max(-30, min(25, rate)), max(-10, min(28, pitch))


def split_sentences(text):
    return [x.strip() for x in re.findall(r"[^.!?…]+[.!?…]*", text) if x.strip()] or [text]


def synthesize_edge(voice, text, ptype, tries=3):
    """edge-tts: каждое предложение отдельно со своим темпом и тоном (в Гц, ~1.5 Гц на 1%), потом склеиваем MP3."""
    try:
        import edge_tts
    except ImportError:
        raise RuntimeError("Установите библиотеку: pip install edge-tts")
    parts = split_sentences(text)

    async def one(sent, rate, hz):
        out = bytearray()
        comm = edge_tts.Communicate(sent, voice, rate=f"{rate:+d}%", pitch=f"{hz:+d}Hz")
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                out += chunk["data"]
        if not out:
            raise RuntimeError("сервис вернул пустой звук")
        return bytes(out)

    audio = b""
    for i, sent in enumerate(parts):
        rate, pitch = sentence_prosody(ptype, sent, i, len(parts))
        hz = int(round(pitch * 1.5))
        # сервис иногда не отдаёт звук (притормаживает частые запросы или не любит значения): повторяем с нарастающей паузой,
        # потом пробуем мягче, в конце без интонации
        attempts = [(rate, hz), (rate, hz), (rate, min(hz, 30)), (min(rate, 2), min(hz, 30)), (min(rate, 2), 15), (0, 0)]
        pauses = [1.5, 3, 6, 10, 15, 0]
        last = None
        for n, (r, h) in enumerate(attempts):
            try:
                audio += asyncio.run(one(sent, r, h))
                if n > 1:
                    print(f"  (запасной вариант {n}: rate={r:+d}% pitch={h:+d}Hz) «{sent[:30]}»")
                last = None
                break
            except Exception as e:
                last = e
                time.sleep(pauses[n])
        if last:
            raise RuntimeError(f"edge-tts не смог озвучить «{sent[:40]}»: {last}")
        time.sleep(0.5)
    return audio


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="перегенерировать все реплики")
    ap.add_argument("--only", choices=list(VOICES), help="только один язык")
    ap.add_argument("--styles", action="store_true", help="включить эмоциональные стили Azure (только движок azure)")
    ap.add_argument("--engine", choices=["auto", "edge", "azure"], default="auto")
    args = ap.parse_args()

    key = os.environ.get("AZURE_SPEECH_KEY")
    region = os.environ.get("AZURE_SPEECH_REGION")
    engine = args.engine
    if engine == "auto":
        engine = "azure" if key and region else "edge"
    if engine == "azure" and (not key or not region):
        sys.exit("Для движка azure задайте AZURE_SPEECH_KEY и AZURE_SPEECH_REGION (см. шапку скрипта).")
    print(f"Движок озвучки: {engine}")

    data = json.loads(PHRASES.read_text(encoding="utf-8"))
    name = data["name"]
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}

    # задания: (ключ манифеста, путь файла, текст, тип, язык)
    jobs = []
    for lang, by_type in data["lines"].items():
        for ptype, texts in by_type.items():
            for i, raw in enumerate(texts):
                jobs.append((f"{lang}/{ptype}-{i}", f"audio/{lang}/{ptype}-{i}.mp3", raw.replace("{name}", name), ptype, lang))
    # задания игр («Найди красное яблоко!» и т. п.): ключ prompt|<язык>|<текст>
    try:
        out = subprocess.run(["node", str(ROOT / "tools" / "dump_prompts.mjs")], capture_output=True, text=True, check=True).stdout
        for lang, texts in json.loads(out).items():
            for t in texts:
                h = hashlib.sha1(t.encode("utf-8")).hexdigest()[:10]
                jobs.append((f"prompt|{lang}|{t}", f"audio/{lang}/prompts/{h}.mp3", t, "explain", lang))
    except (OSError, subprocess.CalledProcessError) as e:
        print(f"Предупреждение: задания игр не добавлены (нужен node): {e}")

    done = skipped = 0
    failed = []
    for rid, file_rel, text, ptype, lang in jobs:
        if args.only and lang != args.only:
            continue
        voice = VOICES[lang]["name"]
        file_abs = ROOT / file_rel
        pr = PROSODY.get(ptype, PROSODY["talk"])
        sig = hashlib.sha1(
            "|".join(["emo2", engine, voice, str(args.styles and engine == "azure"), ptype, text, pr["rate"], pr["pitch"]]).encode("utf-8")
        ).hexdigest()[:12]
        if not args.force and file_abs.exists() and manifest.get(rid, {}).get("hash") == sig:
            skipped += 1
            continue
        try:
            if engine == "azure":
                audio = synthesize(region, key, build_ssml(lang, voice, text, ptype, args.styles))
            else:
                audio = synthesize_edge(voice, text, ptype)
        except RuntimeError as e:
            failed.append(rid)
            print(f"[{rid}] ПРОПУЩЕНО: {e}")
            continue
        file_abs.parent.mkdir(parents=True, exist_ok=True)
        file_abs.write_bytes(audio)
        manifest[rid] = {"file": file_rel, "hash": sig, "text": text, "voice": voice}
        done += 1
        print(f"[{rid}] {voice}: {text}")

    AUDIO.mkdir(exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Готово: создано/обновлено {done}, без изменений {skipped}, не удалось {len(failed)}. Манифест: {MANIFEST.relative_to(ROOT)}")
    if failed:
        sys.exit(2)   # код 2: часть реплик не озвучена; следующий проход (или запуск) доделает только их


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        sys.exit(str(e))
