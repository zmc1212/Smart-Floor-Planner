'use client';

import { Suspense } from 'react';
import { WorkbenchWorkspace } from '@/components/ai-studio/workbench-workspace';

export default function Page() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-[#16171b] text-sm text-[#b3b3b3]">正在加载 AI 工作台...</div>}>
      <WorkbenchWorkspace />
    </Suspense>
  );
}
