'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import { Loader2 } from 'lucide-react';

// @see react-best-practices: bundle-dynamic-imports
// Three.js + react-three-fiber 重型组件延迟加载，SSR=false
// 必须在 Client Component 中使用 ssr: false
const FloorPlanViewer = dynamic(
  () => import('@/components/FloorPlanViewer'),
  { 
    ssr: false, 
    loading: () => (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="animate-spin text-primary" size={48} />
        <p className="text-sm font-medium text-muted-foreground">正在加载 3D 引擎...</p>
      </div>
    )
  }
);

type FloorPlanViewerProps = ComponentProps<typeof FloorPlanViewer>;

/**
 * 客户端包装器，负责 dynamic import + ssr:false。
 * 父级 Server Component 负责数据获取和序列化。
 */
export default function FloorPlanViewerWrapper({ planData }: { planData: Record<string, unknown> }) {
  return <FloorPlanViewer planData={planData as unknown as FloorPlanViewerProps['planData']} />;
}
