# SpatialLM 3D Prediction Engine

这是一个独立的 FastAPI 微服务，专门用于运行 `SpatialLM` 大模型的 3D 点云结构化提取。
该微服务被设计为部署在配有 `RTX 4080 / 4090 (sm_89)` 或其他兼容 CUDA 架构的独立 GPU 云主机上，以此与主业务 Node.js 系统完全解耦。

## 环境配置与启动 (在 GPU 主机上运行)

1. 创建并激活 Python 3.10 的虚拟环境。
2. 安装依赖：
   ```bash
   pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu121
   ```
3. 需自行编译安装 `torchsparse`：
   ```bash
   wget https://github.com/mit-han-lab/torchsparse/archive/refs/heads/master.zip -O torchsparse.zip
   unzip torchsparse.zip && cd torchsparse-master
   pip install --no-build-isolation .
   ```
4. 启动微服务：
   ```bash
   python main.py
   # 服务将运行在 http://0.0.0.0:8002
   ```

## 接口说明

**Endpoint**: `POST /api/v1/predict3d`
**Content-Type**: `multipart/form-data`
**Body**: 包含名为 `file` 的字段，值为上传的 `.ply` 点云文件。

### CURL 调用示例

```bash
curl -X POST -F "file=@/path/to/your/pointcloud.ply" http://localhost:8002/api/v1/predict3d
```

### 返回格式示例

返回一份 JSON，由 3D 浮点噪声构成的墙体、门、窗坐标包围盒（Node.js 端需经过 Adapter 处理）：

```json
{
  "project_id": "spatiallm_inference_v1",
  "layout": {
    "walls": [
      {
        "id": "wall_1",
        "start": [0.5, 0.2, 0.0],
        "end": [4002.1, -1.8, 0.0],
        "thickness": 200.0
      }
    ],
    "openings": []
  }
}
```
