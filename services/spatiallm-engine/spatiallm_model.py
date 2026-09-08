from pathlib import Path

import numpy as np


MILLIMETRES_PER_METRE = 1000.0


class SpatialLMEngine:
    mode = "real"
    device = "cuda"
    ready = False

    def __init__(self, model_name: str, code_template: Path):
        self.model_name = model_name
        self.code_template = code_template
        self.model = None
        self.tokenizer = None

    def load(self) -> None:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        # Importing spatiallm registers its custom model types with Transformers.
        import spatiallm  # noqa: F401

        if not torch.cuda.is_available():
            raise RuntimeError("SPATIALLM_MODE=real requires a CUDA GPU")
        if not self.code_template.is_file():
            raise FileNotFoundError(f"Missing code template: {self.code_template}")

        self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        self.model = AutoModelForCausalLM.from_pretrained(
            self.model_name,
            torch_dtype=torch.bfloat16,
        )
        self.model.to(self.device)
        self.model.set_point_backbone_dtype(torch.float32)
        self.model.eval()
        self.ready = True

    def predict(self, ply_file_path: Path) -> dict:
        import torch
        from spatiallm import Layout
        from spatiallm.pcd import cleanup_pcd, get_points_and_colors, load_o3d_pcd

        if not self.ready or self.model is None or self.tokenizer is None:
            raise RuntimeError("SpatialLM model is not loaded")

        point_cloud = load_o3d_pcd(str(ply_file_path))
        num_bins = self.model.config.point_config["num_bins"]
        grid_size = Layout.get_grid_size(num_bins)
        point_cloud = cleanup_pcd(point_cloud, voxel_size=grid_size)
        points, colors = get_points_and_colors(point_cloud)
        if len(points) == 0:
            raise ValueError("PLY file contains no usable points")

        min_extent = np.min(points, axis=0)
        input_pcd = self._preprocess(points, colors, grid_size, num_bins)
        conversation = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": self._build_prompt()},
        ]
        input_ids = self.tokenizer.apply_chat_template(
            conversation,
            add_generation_prompt=True,
            return_tensors="pt",
        ).to(self.device)

        with torch.inference_mode():
            generated = self.model.generate(
                input_ids=input_ids,
                point_clouds=input_pcd,
                max_new_tokens=4096,
                do_sample=True,
                use_cache=True,
                temperature=0.6,
                top_p=0.95,
                top_k=10,
                num_beams=1,
            )
        generated_ids = generated[0, input_ids.shape[1] :]
        layout_text = self.tokenizer.decode(generated_ids, skip_special_tokens=True)
        layout = Layout(layout_text)
        layout.undiscretize_and_unnormalize(num_bins=num_bins)
        layout.translate(min_extent)
        return self._to_response(layout)

    def _preprocess(self, points, colors, grid_size, num_bins):
        import torch
        from spatiallm.pcd import Compose

        transform = Compose(
            [
                dict(type="PositiveShift"),
                dict(type="NormalizeColor"),
                dict(
                    type="GridSample",
                    grid_size=grid_size,
                    hash_type="fnv",
                    mode="test",
                    keys=("coord", "color"),
                    return_grid_coord=True,
                    max_grid_coord=num_bins,
                ),
            ]
        )
        transformed = transform(
            {"name": "pcd", "coord": points.copy(), "color": colors.copy()}
        )
        features = np.concatenate(
            [transformed["grid_coord"], transformed["coord"], transformed["color"]],
            axis=1,
        )
        return torch.as_tensor(np.stack([features], axis=0))

    def _build_prompt(self) -> str:
        template = self.code_template.read_text(encoding="utf-8")
        return (
            "<|point_start|><|point_pad|><|point_end|>"
            "Detect walls, doors, windows. "
            f"The reference code is as followed: {template}"
        )

    @staticmethod
    def _mm(value: float) -> float:
        return round(float(value) * MILLIMETRES_PER_METRE, 3)

    def _to_response(self, layout) -> dict:
        walls = [
            {
                "id": f"wall_{wall.id}",
                "start": [self._mm(wall.ax), self._mm(wall.ay), self._mm(wall.az)],
                "end": [self._mm(wall.bx), self._mm(wall.by), self._mm(wall.bz)],
                "height": self._mm(wall.height),
                "thickness": self._mm(wall.thickness),
            }
            for wall in layout.walls
        ]
        openings = []
        for entity in [*layout.doors, *layout.windows]:
            openings.append(
                {
                    "id": f"{entity.entity_label}_{entity.id}",
                    "type": entity.entity_label,
                    "center": [
                        self._mm(entity.position_x),
                        self._mm(entity.position_y),
                        self._mm(entity.position_z),
                    ],
                    "width": self._mm(entity.width),
                    "height": self._mm(entity.height),
                    "host_wall_id": f"wall_{entity.wall_id}",
                }
            )
        objects = [
            {
                "id": f"bbox_{bbox.id}",
                "class": bbox.class_name,
                "center": [
                    self._mm(bbox.position_x),
                    self._mm(bbox.position_y),
                    self._mm(bbox.position_z),
                ],
                "angle_z": float(bbox.angle_z),
                "size": [
                    self._mm(bbox.scale_x),
                    self._mm(bbox.scale_y),
                    self._mm(bbox.scale_z),
                ],
            }
            for bbox in layout.bboxes
        ]
        return {
            "project_id": "spatiallm_inference_v1",
            "units": "millimetres",
            "layout": {"walls": walls, "openings": openings, "objects": objects},
        }
