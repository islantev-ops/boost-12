import os
from pathlib import Path
from faster_whisper import WhisperModel
audio = Path.home() / 'Downloads' / 'Telegram Desktop' / '17.11.2026 15.49.m4a'
model_path = Path(os.environ['TEMP']) / 'codex-geo-whisper-base'
model = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=6)
segments, info = model.transcribe(str(audio), language='ru', beam_size=3, vad_filter=True, initial_prompt='Планёрка Редстар. GEO, SEO, Алиса AI, Метрика, тарифы, замеры и лиды.')
print(f'Audio duration: {info.duration:.0f}s', flush=True)
with Path(__file__).with_name('meeting-transcript.txt').open('w', encoding='utf-8') as transcript:
    for segment in segments:
        print(f'[{segment.start:.1f}–{segment.end:.1f}] {segment.text.strip()}', file=transcript, flush=True)

