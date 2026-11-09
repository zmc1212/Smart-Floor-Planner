"""Single GPU worker; loopback-only deployment, authenticated bounded requests."""
import asyncio
import contextlib
import hmac
import itertools
import json
import logging
from logging.handlers import RotatingFileHandler
from contextlib import asynccontextmanager
from pathlib import Path

import torch
from fastapi import FastAPI, HTTPException, Request
from sentence_transformers import SentenceTransformer
from transformers import AutoTokenizer

ROOT = Path(__file__).resolve().parent
MODEL = "Qwen/Qwen3-Embedding-0.6B"
REVISION = "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3"
PROFILE = "qwen3-embedding-0.6b-1024-zh-v1"
QUEUE = asyncio.PriorityQueue(maxsize=32)
SEQUENCE = itertools.count()
TOKEN = (ROOT / "api-key.txt").read_text(encoding="utf-8").strip()
if len(TOKEN) < 32:
    raise RuntimeError("Missing service credential")


@asynccontextmanager
async def lifespan(app):
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA required; CPU fallback is disabled")
    torch.set_num_threads(4)
    # Cap this process's CUDA caching allocator; never change the ComfyUI process.
    torch.cuda.set_per_process_memory_fraction(0.20)
    model = SentenceTransformer(str(ROOT / "model" / REVISION), device="cuda",
                                model_kwargs={"torch_dtype": torch.float16, "attn_implementation": "sdpa"},
                                tokenizer_kwargs={"padding_side": "left"}, local_files_only=True)
    model.max_seq_length = 512
    model.default_prompt_name = None
    model.encode(["warmup"], normalize_embeddings=True)
    app.state.model = model
    # Fast tokenizers mutate padding/truncation state; do not share one across the event loop and inference thread.
    app.state.counter = AutoTokenizer.from_pretrained(str(ROOT / "model" / REVISION), local_files_only=True)

    def infer(texts):
        vectors = model.encode(texts, batch_size=8, normalize_embeddings=False, convert_to_numpy=True,
                               show_progress_bar=False).astype("float32")
        vectors = torch.nn.functional.normalize(torch.from_numpy(vectors), p=2, dim=1).numpy()
        if vectors.shape != (len(texts), 1024) or not torch.isfinite(torch.from_numpy(vectors)).all():
            raise RuntimeError("Invalid model output")
        return vectors.tolist()

    async def worker():
        while True:
            _, _, texts, future = await QUEUE.get()
            try:
                if not future.cancelled():
                    result = await asyncio.to_thread(infer, texts)
                    if not future.done():
                        future.set_result(result)
            except Exception:
                logging.exception("embedding_inference_failed")
                torch.cuda.empty_cache()
                if not future.done():
                    future.set_exception(HTTPException(503, "embedding_unavailable", headers={"Retry-After": "2"}))
            finally:
                QUEUE.task_done()

    task = asyncio.create_task(worker())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def authorize(request):
    if not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + TOKEN):
        raise HTTPException(401, "unauthorized")


@app.get("/health")
async def health(request: Request):
    authorize(request)
    return {"status": "ok", "model": MODEL, "revision": REVISION, "profile": PROFILE,
            "dimensions": 1024, "normalized": True, "dtype": "float16", "device": "cuda",
            "max_tokens": 512, "max_batch": 8, "queued": QUEUE.qsize(),
            "cuda_allocator_fraction": 0.20,
            "cuda_allocated_bytes": torch.cuda.memory_allocated(), "cuda_reserved_bytes": torch.cuda.memory_reserved()}


@app.post("/v1/chunks")
async def chunks(request: Request):
    authorize(request)
    body = bytearray()
    async for part in request.stream():
        body.extend(part)
        if len(body) > 65536:
            raise HTTPException(413, "request_too_large")
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(422, "invalid_input")
    if not isinstance(data, dict) or set(data) != {"text", "profile"} or data["profile"] != PROFILE:
        raise HTTPException(422, "profile_mismatch")
    text = data["text"]
    if not isinstance(text, str) or not text.strip() or len(text) > 16000 or len(text.encode("utf-8")) > 48000:
        raise HTTPException(422, "invalid_input")
    tokenizer = app.state.counter
    offsets = tokenizer(text, add_special_tokens=False, return_offsets_mapping=True)["offset_mapping"]
    result, start = [], 0
    while start < len(offsets):
        end = min(start + 512, len(offsets))
        left, right = offsets[start][0], offsets[end - 1][1]
        # Re-tokenize whole Unicode characters, including special tokens. Never decode partial byte tokens.
        while end > start and len(tokenizer(text[left:right])["input_ids"]) > 512:
            end -= 1
            right = offsets[end - 1][1]
        if end <= start or right <= left:
            raise HTTPException(422, "invalid_input")
        value = text[left:right]
        result.append({"text": value, "start": left, "end": right,
                       "tokens": len(tokenizer(value)["input_ids"])})
        if len(result) > 128:
            raise HTTPException(422, "too_many_chunks")
        if end == len(offsets):
            break
        start = max(start + 1, end - 64)
    return {"profile": PROFILE, "revision": REVISION, "chunks": result}


@app.post("/v1/embeddings")
async def embeddings(request: Request):
    authorize(request)
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 65536:
            raise HTTPException(413, "request_too_large")
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(422, "invalid_input")
    if not isinstance(data, dict) or set(data) - {"model", "input", "dimensions", "encoding_format", "input_type"}:
        raise HTTPException(422, "invalid_input")
    if data.get("model") != MODEL or data.get("dimensions", 1024) != 1024 or data.get("encoding_format", "float") != "float":
        raise HTTPException(422, "profile_mismatch")
    kind = data.get("input_type")
    if kind not in ("query", "document"):
        raise HTTPException(422, "input_type_required")
    texts = data.get("input")
    if isinstance(texts, str):
        texts = [texts]
    if not isinstance(texts, list) or not 1 <= len(texts) <= 8 or any(not isinstance(t, str) or not t.strip() for t in texts):
        raise HTTPException(422, "invalid_input")
    # Count the exact prepared input, with special tokens, before encode. Never truncate.
    texts = [text.strip() for text in texts]
    lengths = [len(ids) for ids in app.state.counter(texts, truncation=False)["input_ids"]]
    if max(lengths) > 512:
        raise HTTPException(422, "input_too_long")
    future = asyncio.get_running_loop().create_future()
    try:
        QUEUE.put_nowait((0 if kind == "query" else 1, next(SEQUENCE), texts, future))
    except asyncio.QueueFull:
        raise HTTPException(429, "queue_full", headers={"Retry-After": "2"})
    try:
        vectors = await asyncio.wait_for(future, timeout=25)
    except asyncio.TimeoutError:
        raise HTTPException(503, "queue_timeout", headers={"Retry-After": "2"})
    return {"object": "list", "model": MODEL, "revision": REVISION, "profile": PROFILE,
            "data": [{"object": "embedding", "index": i, "embedding": v} for i, v in enumerate(vectors)],
            "usage": {"prompt_tokens": sum(lengths), "total_tokens": sum(lengths)}}


if __name__ == "__main__":
    import uvicorn
    handler = RotatingFileHandler(ROOT / "service.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8")
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).handlers = [handler]
        logging.getLogger(name).propagate = False
    uvicorn.run(app, host="127.0.0.1", port=8089, workers=1, access_log=False, log_config=None)
