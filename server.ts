import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API 路由：代理 Pollinations 请求，安全地使用私密密钥
  app.post("/api/render/pollinations", async (req, res) => {
    const { prompt, model, seed } = req.body;
    const apiKey = process.env.POLLINATIONS_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: "服务器未配置 POLLINATIONS_API_KEY" });
    }

    const encodedPrompt = encodeURIComponent(prompt);
    const params = `model=${model || 'flux'}&width=1024&height=1024&nologo=true&enhance=true&seed=${seed || 42}`;
    const url = `https://gen.pollinations.ai/image/${encodedPrompt}?${params}`;

    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ error: `Pollinations API 错误: ${errorText}` });
      }

      const blob = await response.blob();
      const buffer = Buffer.from(await blob.arrayBuffer());
      const base64 = buffer.toString('base64');
      
      res.json({ data: `data:image/png;base64,${base64}` });
    } catch (error: any) {
      console.error("Server-side Pollinations error:", error);
      res.status(500).json({ error: "服务器内部错误" });
    }
  });

  // Vite 中间件
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
