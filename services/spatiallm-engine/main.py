import asyncio
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from model_engine import create_engine


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("spatiallm-engine")

MAX_UPLOAD_BYTES = int(os.getenv("SPATIALLM_MAX_UPLOAD_BYTES", str(512 * 1024 * 1024)))
CHUNK_SIZE = 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.inference_lock = asyncio.Lock()
    app.state.engine = create_engine()
    app.state.engine.load()
    logger.info("SpatialLM engine ready in %s mode", app.state.engine.mode)
    yield


app = FastAPI(
    title="SpatialLM 3D Prediction Engine",
    version="1.1.0",
    lifespan=lifespan,
)


@app.get("/healthz")
async def health() -> dict:
    engine = app.state.engine
    return {
        "status": "ok" if engine.ready else "loading",
        "mode": engine.mode,
        "model": engine.model_name,
        "device": engine.device,
    }


async def save_upload(upload: UploadFile, destination: Path) -> None:
    total = 0
    with destination.open("wb") as target:
        while chunk := await upload.read(CHUNK_SIZE):
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="PLY file is too large")
            target.write(chunk)


@app.post("/api/v1/predict3d")
async def predict_3d(file: UploadFile = File(...)) -> dict:
    filename = file.filename or ""
    if Path(filename).suffix.lower() != ".ply":
        raise HTTPException(status_code=400, detail="Only .ply files are supported")

    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".ply", delete=False) as temp_file:
            temp_path = Path(temp_file.name)
        await save_upload(file, temp_path)

        async with app.state.inference_lock:
            return await run_in_threadpool(app.state.engine.predict, temp_path)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("SpatialLM inference failed")
        raise HTTPException(status_code=500, detail="SpatialLM inference failed") from exc
    finally:
        await file.close()
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=os.getenv("SPATIALLM_HOST", "0.0.0.0"),
        port=int(os.getenv("SPATIALLM_PORT", "8002")),
    )
