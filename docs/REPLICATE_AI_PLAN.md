# Replicate AI 渲染方案开发计划

本项目选择 **Replicate** 作为底层渲染引擎，利用其完善的 Node.js SDK 和基于 Webhook 的异步处理机制，实现高效、高质的 AI 户型图风格生成。

---

## 📅 开发计划

### 第一阶段：基础设施与基建对接 (第 1 周)
**目标：** 打通 Replicate 账号，配置 SDK，完善数据库模型以支持异步生图状态。

1.  **环境与依赖安装：**
    *   在 `admin` 目录下安装 Replicate 官方 SDK：`npm install replicate`。
    *   配置环境变量 `.env.local`：增加 `REPLICATE_API_TOKEN` 和 `REPLICATE_WEBHOOK_URL`。
2.  **数据库模型调整 (优化点)：**
    *   修改 `admin/src/models/AiGeneration.ts`。增加以下字段：
        *   `replicatePredictionId`: 存储任务 ID。
        *   `status`: 扩展为枚举 `['pending', 'processing', 'succeeded', 'failed']`。
        *   `error`: 存储生图失败时的错误信息。
3.  **配额管理对接：**
    *   在发起 Replicate 请求前，通过 `AiQuota` 模型校验余额。
    *   **策略：** 发起请求时预扣配额，Webhook 返回失败时退回。

### 第二阶段：核心 API 工作流开发 (第 2 周)
**目标：** 实现从“前端发起 -> Gemini 思考 -> Replicate 渲染”的闭环。

1.  **改造 `api/ai/generate/route.ts` (Prompt 引擎)：**
    *   调用 Gemini 生成专门针对 Stable Diffusion 的英文 Prompt (正向+负向)。
2.  **改造 `api/ai/render/route.ts` (生图发起端)：**
    *   接收前端的 2D 底图 (Base64) 和 Gemini 生成的 Prompt。
    *   **模型推荐：** `jagilley/controlnet-mlsd` 或 SDXL ControlNet 模型。
    *   发起异步任务并注入 Webhook 地址。
3.  **新增 Webhook 路由 (`api/ai/webhook/replicate/route.ts`)：**
    *   接收回调并更新数据库状态及图片 URL。

### 第三阶段：前端交互与体验优化 (第 3 周)
**目标：** 优化 AI Studio 相关页面的用户体验。

1.  **轮询 (Polling) 机制实现：** 前端定时轮询查询生成状态。
2.  **加载动画优化 (UX)：** 分阶段展示文案，缓解用户焦虑。
3.  **历史记录展示：** 对接历史记录接口，支持一键分享。

---

## 💡 核心优化策略

1.  **底图预处理优化：** 输入底图必须是清晰的**黑底白线 (或白底黑线)**，移除所有文字、标注和网格线。
2.  **冷启动延迟处理：** 前端明确提示“首次启动模型可能需要稍等片刻”，或考虑 "Keep-warm" 策略。
3.  **ComfyUI 工作流 API：** 后期可探索使用 ComfyUI API 实现商业级超高画质出图。
