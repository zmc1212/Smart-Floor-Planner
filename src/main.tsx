import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// 注入全局 process 对象，方便在浏览器控制台调试验证
(window as any).process = {
  env: {
    GEMINI_API_KEY: (import.meta as any).env?.VITE_GEMINI_API_KEY || (process.env as any).GEMINI_API_KEY,
    POLLINATIONS_API_KEY: (import.meta as any).env?.VITE_POLLINATIONS_API_KEY || (process.env as any).POLLINATIONS_API_KEY,
    DOUBAO_API_KEY: (import.meta as any).env?.VITE_DOUBAO_API_KEY || (process.env as any).DOUBAO_API_KEY,
    DOUBAO_MODEL_ID: (import.meta as any).env?.VITE_DOUBAO_MODEL_ID || (process.env as any).DOUBAO_MODEL_ID,
    QWEN_API_KEY: (import.meta as any).env?.VITE_QWEN_API_KEY || (process.env as any).QWEN_API_KEY,
  }
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
