'use client';

import { notify } from '@/components/ui/operation-feedback';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Calendar,
  ChevronLeft,
  Cpu,
  Download,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
  Type,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface GenerationStatusData {
  id: string;
  type?: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  progress?: number;
  imageUrl?: string;
  error?: string;
  duration?: number;
  provider?: string;
  createdAt: string;
  input?: {
    style?: string;
    customPrompt?: string;
    sourceImage?: string;
    presetSnapshot?: {
      name?: string;
      icon?: string;
      previewClassName?: string;
    };
  };
}

export default function ScenarioDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [data, setData] = useState<GenerationStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/status/${id}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        if (json.data.status !== 'processing' && json.data.status !== 'pending') {
          setLoading(false);
        }
      } else {
        setError(json.error || '加载失败');
        setLoading(false);
      }
    } catch {
      setError('网络连接失败');
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchStatus();

    let interval: ReturnType<typeof setInterval> | undefined;
    if (data?.status === 'processing' || data?.status === 'pending') {
      interval = setInterval(fetchStatus, 3000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [fetchStatus, data?.status]);

  const presetSnapshot = data?.input?.presetSnapshot;
  const styleInfo = {
    label: presetSnapshot?.name || data?.input?.style || '未知场景',
    icon: presetSnapshot?.icon || 'AI',
    gradient: presetSnapshot?.previewClassName || 'from-zinc-500 to-zinc-400',
  };

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-purple-500" size={40} />
        <p className="font-medium text-muted-foreground">加载场景详情...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-500">
          <Info size={32} />
        </div>
        <p className="text-lg font-bold">{error}</p>
        <Button variant="outline" onClick={() => router.back()}>
          返回列表
        </Button>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const imageUrl = data.imageUrl || '';

  return (
    <div className="min-h-screen bg-white font-sans text-[#171717]">
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-xl hover:bg-muted">
              <ChevronLeft size={24} />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">场景魔方 - 方案详情</h1>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="outline" className="rounded-md font-medium">
                  ID: {id.slice(-6).toUpperCase()}
                </Badge>
                {data.status === 'succeeded' && (
                  <Badge className="border-none bg-green-100 text-[10px] font-bold uppercase text-green-700">已完成</Badge>
                )}
                {data.status === 'failed' && (
                  <Badge className="border-none bg-red-100 text-[10px] font-bold uppercase text-red-700">生成失败</Badge>
                )}
                {(data.status === 'processing' || data.status === 'pending') && (
                  <Badge className="animate-pulse border-none bg-blue-100 text-[10px] font-bold uppercase text-blue-700">
                    渲染中 {data.progress}%
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {data.status === 'succeeded' && (
            <div className="flex items-center gap-3">
              <Button variant="outline" className="gap-2 rounded-xl font-bold" onClick={() => window.open(imageUrl, '_blank')}>
                <ExternalLink size={16} /> 查看原图
              </Button>
              <Button
                className="gap-2 rounded-xl bg-black font-bold text-white hover:bg-zinc-800"
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = imageUrl;
                  a.download = \`AI_Scenario_${id}.png\`;
                  a.click();
                }}
              >
                <Download size={16} /> 下载原图
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[28px] border border-muted bg-muted/10 shadow-sm lg:aspect-[4/3]">
              {data.status === 'succeeded' ? (
                <div className="relative h-full w-full">
                  <img src={imageUrl} alt="Generated Scenario" className="h-full w-full object-contain" />
                </div>
              ) : data.status === 'failed' ? (
                <div className="p-12 text-center">
                  <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-red-50 text-red-500">
                    <Info size={40} />
                  </div>
                  <h2 className="mb-2 text-xl font-bold">生成失败</h2>
                  <p className="mb-6 max-w-md text-muted-foreground">{data.error || 'AI 服务响应异常，请尝试重新生成'}</p>
                  <Button variant="outline" className="rounded-xl font-bold" onClick={() => router.push('/ai-studio/scenarios')}>
                    返回重新生成
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-6">
                  <div className="relative">
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-purple-50">
                      <RefreshCw className="animate-spin text-purple-500" size={40} />
                    </div>
                    <div className="absolute inset-0 animate-ping rounded-full border-2 border-purple-200 opacity-30" />
                  </div>
                  <div className="space-y-2 text-center">
                    <p className="text-xl font-bold">AI 正在渲染中...</p>
                    <div className="flex min-w-[240px] flex-col items-center gap-1.5">
                      <div className="flex w-full justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        <span>Status</span>
                        <span>{data.progress}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-purple-500 transition-all duration-1000 ease-out"
                          style={{ width: \`\${Math.max(data.progress || 5, 5)}%\` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <section className="overflow-hidden rounded-2xl border bg-muted/20">
              <div className={cn('h-2 bg-gradient-to-r', styleInfo.gradient)} />
              <div className="p-6">
                <h3 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-muted-foreground">
                  <Sparkles size={12} className="text-purple-500" /> 场景配置
                </h3>
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-black text-white', styleInfo.gradient)}>
                    {styleInfo.icon}
                  </div>
                  <div>
                    <p className="text-lg font-bold">{styleInfo.label}</p>
                    <p className="text-xs text-muted-foreground">
                      场景魔方
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="px-1 text-xs font-black uppercase tracking-[0.15em] text-muted-foreground">任务元数据</h3>
              {[
                { icon: Calendar, label: '生成时间', value: new Date(data.createdAt).toLocaleString('zh-CN') },
                { icon: Cpu, label: '计算引擎', value: data.provider || 'AI Cluster' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3 rounded-2xl border border-muted/20 bg-muted/10 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-muted-foreground shadow-sm">
                    <item.icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{item.label}</p>
                    <p className="truncate text-sm font-bold">{item.value}</p>
                  </div>
                </div>
              ))}
            </section>

            {data.input?.customPrompt && (
              <section className="space-y-4 pt-2">
                <h3 className="flex items-center gap-2 px-1 text-xs font-black uppercase tracking-[0.15em] text-muted-foreground">
                  <Type size={12} /> AI 附加提示词
                </h3>
                <div className="break-words rounded-2xl bg-zinc-900 p-4 font-mono text-xs leading-relaxed text-zinc-400">
                  {data.input.customPrompt}
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
