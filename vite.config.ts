import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  // 合并系统环境变量和 .env 文件变量
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  
  const POLLINATIONS_API_KEY = env.POLLINATIONS_API_KEY;
  const GEMINI_API_KEY = env.GEMINI_API_KEY;
  const DOUBAO_API_KEY = env.DOUBAO_API_KEY;
  const DOUBAO_MODEL_ID = env.DOUBAO_MODEL_ID;
  const QWEN_API_KEY = env.QWEN_API_KEY;

  return {
    base:'./',
    plugins: [react(), tailwindcss()],
    define: {
      'process.env': {
        GEMINI_API_KEY: GEMINI_API_KEY,
        DOUBAO_API_KEY: DOUBAO_API_KEY,
        DOUBAO_MODEL_ID: DOUBAO_MODEL_ID,
        QWEN_API_KEY: QWEN_API_KEY,
        POLLINATIONS_API_KEY: POLLINATIONS_API_KEY,
      }
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
