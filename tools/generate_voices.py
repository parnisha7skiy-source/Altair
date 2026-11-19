#!/usr/bin/env python3
"""
Генерация озвучки Тобота через Azure AI Speech (нейронные голоса) -> audio/<lang>/<id>.mp3

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
import hashlib
import json
import os
import sys
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
    "greeting":  {"rate": "-4%",  "pitch": "+10%"},
    "talk":      {"rate": "-6%",  "pitch": "+4%"},
    "joy":       {"rate": "+2%",  "pitch": "+14%"},
    "encourage": {"rate": "-12%", "pitch": "+2%"},
    "surprise":  {"rate": "-10%", "pitch": "+16%"},
    "explain":   {"rate": "-14%", "pitch": "+0%"},
    "victory":   {"rate": "-2%",  "pitch": "+14%"},
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="перегенерировать все реплики")
    ap.add_argument("--only", choices=list(VOICES), help="только один язык")
    ap.add_argument("--styles", action="store_true", help="включить эмоциональные стили Azure")
    args = ap.parse_args()

    key = os.environ.get("AZURE_SPEECH_KEY")
    region = os.environ.get("AZURE_SPEECH_REGION")
    if not key or not region:
        sys.exit("Задайте переменные AZURE_SPEECH_KEY и AZURE_SPEECH_REGION (см. шапку скрипта).")

    data = json.loads(PHRASES.read_text(encoding="utf-8"))
    name = data["name"]
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}

    done = skipped = 0
    for lang, by_type in data["lines"].items():
        if args.only and lang != args.only:
            continue
        voice = VOICES[lang]["name"]
        for ptype, texts in by_type.items():
            for i, raw in enumerate(texts):
                text = raw.replace("{name}", name)
                rid = f"{lang}/{ptype}-{i}"
                file_rel = f"audio/{lang}/{ptype}-{i}.mp3"
                file_abs = ROOT / file_rel
                sig = hashlib.sha1(
                    "|".join([voice, str(args.styles), ptype, text,
                              PROSODY.get(ptype, PROSODY["talk"])["rate"],
                              PROSODY.get(ptype, PROSODY["talk"])["pitch"]]).encode("utf-8")
                ).hexdigest()[:12]
                if not args.force and file_abs.exists() and manifest.get(rid, {}).get("hash") == sig:
                    skipped += 1
                    continue
                ssml = build_ssml(lang, voice, text, ptype, args.styles)
                audio = synthesize(region, key, ssml)
                file_abs.parent.mkdir(parents=True, exist_ok=True)
                file_abs.write_bytes(audio)
                manifest[rid] = {"file": file_rel, "hash": sig, "text": text, "voice": voice}
                done += 1
                print(f"[{rid}] {voice}: {text}")

    AUDIO.mkdir(exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Готово: создано/обновлено {done}, пропущено без изменений {skipped}. Манифест: {MANIFEST.relative_to(ROOT)}")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        sys.exit(str(e))
