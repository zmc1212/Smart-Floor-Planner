'use client';

import dynamic from 'next/dynamic';

const CreationWorkspace = dynamic(
  () => import('@/components/ai-creation/creation-workspace').then((module) => module.CreationWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-[#16171b] text-sm text-[#b3b3b3]">
        正在加载 AI 创作台...
      </div>
    ),
  },
);

export default function AiCreationPage() {
  return <CreationWorkspace />;
}
