from pathlib import Path


class MockSpatialLMEngine:
    mode = "mock"
    model_name = "mock"
    device = "cpu"
    ready = False

    def load(self) -> None:
        self.ready = True

    def predict(self, ply_file_path: Path) -> dict:
        if not ply_file_path.is_file():
            raise FileNotFoundError(ply_file_path)
        return {
            "project_id": "spatiallm_inference_v1",
            "units": "millimetres",
            "layout": {
                "walls": [
                    {
                        "id": "wall_1",
                        "start": [0.5, 0.2, 0.0],
                        "end": [4002.1, -1.8, 0.0],
                        "height": 2800.0,
                        "thickness": 200.0,
                    }
                ],
                "openings": [],
                "objects": [],
            },
        }


def infer_spatiallm(ply_file_path: str) -> dict:
    """Compatibility wrapper for callers using the original mock function."""
    engine = MockSpatialLMEngine()
    engine.load()
    return engine.predict(Path(ply_file_path))
