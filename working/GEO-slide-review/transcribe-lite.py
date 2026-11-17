import os, sys, types
from pathlib import Path
import numpy as np

# Decode with local FFmpeg. The model receives PCM and uses only local files.
sys.modules['av'] = types.ModuleType('av')
sys.modules['huggingface_hub'] = types.ModuleType('huggingface_hub')
from faster_whisper import WhisperModel

temp = Path(os.environ['TEMP'])
audio = np.fromfile(temp/'codex-geo-ffmpeg'/'audio.pcm', dtype='<f4')
model = WhisperModel(str(temp/'codex-geo-whisper-base'), device='cpu', compute_type='int8', cpu_threads=4)
segments, info = model.transcribe(audio, language='ru', beam_size=3, vad_filter=False,
    condition_on_previous_text=False, initial_prompt='Планёрка Редстар. GEO, SEO, Алиса AI, Метрика, тарифы, замеры и лиды.')
print(f'Audio duration: {info.duration:.0f}s', flush=True)
with Path(__file__).with_name('meeting-transcript-lite.txt').open('w', encoding='utf-8') as transcript:
    for segment in segments:
        print(f'[{segment.start:.1f}–{segment.end:.1f}] {segment.text.strip()}', file=transcript, flush=True)
