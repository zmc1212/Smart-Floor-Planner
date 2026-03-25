import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  // 确保从系统环境变量 (process.env) 中也能读取到，这对 Vercel 部署至关重要
  const POLLINATIONS_API_KEY = env.POLLINATIONS_API_KEY || process.env.POLLINATIONS_API_KEY;
  const GEMINI_API_KEY = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  const DOUBAO_API_KEY = env.DOUBAO_API_KEY || process.env.DOUBAO_API_KEY;
  const DOUBAO_MODEL_ID = env.DOUBAO_MODEL_ID || process.env.DOUBAO_MODEL_ID;
  const QWEN_API_KEY = env.QWEN_API_KEY || process.env.QWEN_API_KEY;

  return {
    base:'./',
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(GEMINI_API_KEY),
      'process.env.DOUBAO_API_KEY': JSON.stringify(DOUBAO_API_KEY),
      'process.env.DOUBAO_MODEL_ID': JSON.stringify(DOUBAO_MODEL_ID),
      'process.env.QWEN_API_KEY': JSON.stringify(QWEN_API_KEY),
      'process.env.POLLINATIONS_API_KEY': JSON.stringify(POLLINATIONS_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
