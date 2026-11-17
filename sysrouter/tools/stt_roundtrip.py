# stt_roundtrip.py — text -> synthetic speech -> Whisper -> text, to collect REAL transcription
# errors for the dataset (R-EVAL-1). Python because the two tools are Python (GATHER D3).
#   pip install piper-tts faster-whisper numpy
#   python stt_roundtrip.py <voices_dir> <in.jsonl> <out.jsonl>
# in:  {"id","text","cond"}   cond = "clean" | "noisy"
# out: the same row plus {"stt","voice","whisper"}
# What this is and is not: GrowBot transcribes with Whisper large-v3-turbo on Groq
# (next.html transcribe). This runs the same model family locally through faster-whisper,
# int8 on CPU, on synthetic voices. It yields real Whisper errors, not real field audio.
# "noisy" adds brown noise at 5 dB SNR, to push the recogniser the way a room does.
import sys, json, io, wave, hashlib, numpy as np
from piper import PiperVoice
from faster_whisper import WhisperModel

VOICES = ["en_US-lessac-medium", "en_US-ryan-medium", "en_GB-alba-medium"]
WHISPER = "large-v3-turbo"

def synth(voice, text):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w: voice.synthesize_wav(text, w)
    buf.seek(0)
    with wave.open(buf, "rb") as w:
        sr = w.getframerate(); a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    n = int(len(a) * 16000 / sr)
    return np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a).astype(np.float32)

def noisy(a, seed, snr_db=5.0):
    rng = np.random.default_rng(seed)
    n = np.cumsum(rng.standard_normal(len(a))).astype(np.float32); n -= n.mean()
    n *= np.sqrt((a ** 2).mean() / ((n ** 2).mean() * 10 ** (snr_db / 10)) + 1e-12)
    return np.clip(a + n, -1, 1).astype(np.float32)

def main(vdir, src, dst):
    done = set()
    try:
        for line in open(dst): done.add(json.loads(line)["id"] + "|" + json.loads(line)["cond"])
    except FileNotFoundError: pass
    voices = {v: PiperVoice.load(f"{vdir}/{v}.onnx") for v in VOICES}
    model = WhisperModel(WHISPER, device="cpu", compute_type="int8", cpu_threads=4)
    out = open(dst, "a")
    for line in open(src):
        r = json.loads(line)
        if r["id"] + "|" + r["cond"] in done: continue
        seed = int(hashlib.sha1(r["id"].encode()).hexdigest()[:8], 16)
        v = VOICES[seed % len(VOICES)]
        a = synth(voices[v], r["text"])
        if r["cond"] == "noisy": a = noisy(a, seed)
        segs, _ = model.transcribe(a, language="en", temperature=0, beam_size=1)
        r.update(stt=" ".join(s.text.strip() for s in segs).strip(), voice=v, whisper=WHISPER + "/int8")
        out.write(json.dumps(r) + "\n"); out.flush()

if __name__ == "__main__": main(*sys.argv[1:4])
