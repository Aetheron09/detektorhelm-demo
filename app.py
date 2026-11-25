import io
import os
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from ultralytics import YOLO


ROOT = Path(__file__).resolve().parent
MODEL_PATH = Path(os.getenv("HELMET_MODEL_PATH", ROOT / "models" / "helmet-v2.pt"))
MODEL_URL = os.getenv(
    "HELMET_MODEL_URL",
    "https://github.com/GPA-N/helmet-detection-yolo26/releases/download/v2.0/helmet-v2.pt",
)
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
CONFIDENCE = 0.25
model: YOLO | None = None


def load_model() -> YOLO:
    if not MODEL_PATH.is_file():
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = MODEL_PATH.with_suffix(MODEL_PATH.suffix + ".download")
        try:
            urllib.request.urlretrieve(MODEL_URL, temporary_path)
            temporary_path.replace(MODEL_PATH)
        except Exception as exc:
            temporary_path.unlink(missing_ok=True)
            raise RuntimeError(
                f"Could not download model weights from {MODEL_URL}: {exc}"
            ) from exc

    try:
        return YOLO(str(MODEL_PATH))
    except Exception as exc:
        raise RuntimeError(f"Could not load model weights at {MODEL_PATH}: {exc}") from exc


@asynccontextmanager
async def lifespan(_: FastAPI):
    global model
    model = await run_in_threadpool(load_model)
    yield
    model = None


app = FastAPI(title="Helmet Detector Demo", lifespan=lifespan)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ready": model is not None,
        "model": MODEL_PATH.name,
        "confidence": CONFIDENCE,
    }


def predict(image: Image.Image) -> dict[str, Any]:
    if model is None:
        raise RuntimeError("The detection model is not ready.")

    result = model.predict(image, conf=CONFIDENCE, verbose=False)[0]
    detections = []
    for box in result.boxes:
        class_id = int(box.cls[0].item())
        detections.append(
            {
                "label": result.names[class_id],
                "confidence": float(box.conf[0].item()),
                "box": [float(value) for value in box.xyxy[0].tolist()],
            }
        )

    return {
        "width": image.width,
        "height": image.height,
        "detections": detections,
    }


@app.post("/api/detect")
async def detect(file: UploadFile = File(...)) -> dict[str, Any]:
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is larger than 10 MB.")
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    try:
        with Image.open(io.BytesIO(raw)) as uploaded:
            if uploaded.width * uploaded.height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=413, detail="Image resolution is too large."
                )
            image = uploaded.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(
            status_code=415, detail="Please upload a valid image."
        ) from exc

    return await run_in_threadpool(predict, image)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(ROOT / "static" / "index.html")


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
