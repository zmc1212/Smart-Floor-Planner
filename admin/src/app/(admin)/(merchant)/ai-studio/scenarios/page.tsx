'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';

function WorkbenchLoading() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#16171b] text-sm text-[#b3b3b3]">
      正在加载 AI 工作台...
    </div>
  );
}

const WorkbenchWorkspace = dynamic(
  () => import('@/components/ai-studio/workbench-workspace').then((module) => module.WorkbenchWorkspace),
  { ssr: false, loading: WorkbenchLoading },
);

export default function Page() {
  return (
    <Suspense fallback={<WorkbenchLoading />}>
      <WorkbenchWorkspace />
    </Suspense>
  );
}
