'use client';

import type { ReactNode } from 'react';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AiToolFrameProps {
  title: string;
  description: string;
  icon: LucideIcon;
  onBack?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function AiToolFrame({
  title,
  description,
  icon: Icon,
  onBack,
  actions,
  children,
}: AiToolFrameProps) {
  return (
    <div className="min-h-full bg-background text-foreground">
      <main className="mx-auto max-w-[1480px] px-5 py-6 sm:px-7 sm:py-8">
        <header className="mb-7 flex flex-col gap-5 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            {onBack ? (
              <Button variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground" onClick={onBack}>
                <ArrowLeft data-icon="inline-start" />
                返回快捷工具
              </Button>
            ) : null}
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon size={19} />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold leading-8">{title}</h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
              </div>
            </div>
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
        {children}
      </main>
    </div>
  );
}
