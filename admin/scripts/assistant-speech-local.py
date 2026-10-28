"""One bounded local transcription; original WAV in stdin, UTF-8 JSON in stdout."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import wave


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--sha256", required=True)
    args = parser.parse_args()
    model_path = Path(args.model)
    if not model_path.is_absolute() or not all((model_path / name).is_file() for name in ("model.bin", "config.json", "tokenizer.json")):
        raise ValueError("speech_model_unavailable")
    digest = hashlib.sha256()
    with (model_path / "model.bin").open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != args.sha256:
        raise ValueError("speech_model_changed")
    model_stat = (model_path / "model.bin").stat()
    metadata = {"config": hashlib.sha256((model_path / "config.json").read_bytes()).hexdigest(), "tokenizer": hashlib.sha256((model_path / "tokenizer.json").read_bytes()).hexdigest()}
    metadata_hash = hashlib.sha256(json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError("speech_audio_invalid")
    with wave.open(io.BytesIO(raw), "rb") as handle:
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2 or handle.getframerate() != 16000 or handle.getcomptype() != "NONE":
            raise ValueError("speech_audio_invalid")
        duration = (handle.getnframes() * 1000 + 15999) // 16000
        if not 300 <= duration <= 60000:
            raise ValueError("speech_audio_invalid")
        pcm = handle.readframes(handle.getnframes())
    # Both settings and local_files_only fence implicit Hugging Face downloads.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    from faster_whisper import WhisperModel
    import numpy as np
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    if float(np.sqrt(np.mean(samples * samples))) < 0.002:
        raise ValueError("speech_no_audio")
    model = WhisperModel(str(model_path), device="cpu", compute_type="int8", cpu_threads=4, num_workers=1, local_files_only=True)
    segments, _info = model.transcribe(samples, language="zh", beam_size=5, temperature=0, condition_on_previous_text=False, vad_filter=False)
    text = "".join(segment.text for segment in segments if segment.no_speech_prob < 0.85).strip()
    if not text or len(text) > 4000:
        raise ValueError("speech_no_text")
    final_stat = (model_path / "model.bin").stat()
    if (model_stat.st_size, model_stat.st_mtime_ns) != (final_stat.st_size, final_stat.st_mtime_ns):
        raise ValueError("speech_model_changed")
    print(json.dumps({"text": text, "durationMs": duration, "modelHash": digest.hexdigest(), "metadataHash": metadata_hash}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("speech_local_failed", file=sys.stderr)
        sys.exit(1)
