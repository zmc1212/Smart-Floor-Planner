import os
from pathlib import Path
from typing import Protocol


DEFAULT_MODEL = "manycore-research/SpatialLM1.1-Qwen-0.5B"


class InferenceEngine(Protocol):
    mode: str
    model_name: str
    device: str
    ready: bool

    def load(self) -> None: ...

    def predict(self, ply_file_path: Path) -> dict: ...


def create_engine() -> InferenceEngine:
    mode = os.getenv("SPATIALLM_MODE", "mock").strip().lower()
    if mode == "mock":
        from mock_model import MockSpatialLMEngine

        return MockSpatialLMEngine()
    if mode == "real":
        from spatiallm_model import SpatialLMEngine

        return SpatialLMEngine(
            model_name=os.getenv("SPATIALLM_MODEL_PATH", DEFAULT_MODEL),
            code_template=Path(
                os.getenv(
                    "SPATIALLM_CODE_TEMPLATE",
                    Path(__file__).with_name("code_template.txt"),
                )
            ),
        )
    raise ValueError("SPATIALLM_MODE must be either 'mock' or 'real'")
