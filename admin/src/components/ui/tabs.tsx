'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface Tab {
  id: string;
  label: string | React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

/**
 * 通用 Tab 切换组件 (Segmented Control 风格)
 * 参考 admins 页面的设计规范：bg-muted/30 容器 + bg-white 激活项
 */
export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  return (
    <div className={cn("flex p-1 bg-muted/30 rounded-xl border border-muted/50 w-fit", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "px-6 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap",
            activeTab === tab.id 
              ? "bg-white shadow-sm text-primary" 
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
