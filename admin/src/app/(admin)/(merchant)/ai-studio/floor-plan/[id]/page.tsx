'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Calendar,
  ChevronLeft,
  Cpu,
  Download,
  ExternalLink,
  Info,
  Loader2,
  Map,
  RefreshCw,
  Sparkles,
  Type,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  buildLabelRenderData,
  escapeSvgText,
  getLayoutMetrics,
  normalizeRooms,
  scalePoint,
} from '@/lib/ai/floorplan-labels';

const FALLBACK_STYLES: Record<string, { label: string; icon: string; gradient: string }> = {
  colorful: { label: '彩色风格', icon: 'CP', gradient: 'from-pink-400 to-blue-400' },
  cad: { label: 'CAD 风格', icon: 'CAD', gradient: 'from-zinc-700 to-zinc-400' },
  '3d': { label: '3D 风格', icon: '3D', gradient: 'from-cyan-400 to-indigo-500' },
  handdrawn: { label: '手绘风格', icon: 'SK', gradient: 'from-amber-300 to-rose-300' },
  modern: { label: '现代简约', icon: 'MD', gradient: 'from-slate-400 to-neutral-500' },
  nordic: { label: '北欧风', icon: 'NO', gradient: 'from-sky-200 to-emerald-300' },
  cream: { label: '奶油风', icon: 'CR', gradient: 'from-amber-100 to-stone-200' },
  luxury: { label: '轻奢风', icon: 'LX', gradient: 'from-zinc-500 to-amber-300' },
  new_chinese: { label: '新中式', icon: 'CN', gradient: 'from-red-500 to-stone-500' },
};

const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 900;

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
    roomName?: string;
    customPrompt?: string;
    roomData?: unknown;
    presetSnapshot?: {
      name?: string;
      icon?: string;
      previewClassName?: string;
    };
  };
}

function stripOuterSvg(svg: string) {
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

function getBackPath(type?: string) {
  return type === 'furnishing_render' ? '/ai-studio/furnishing' : '/ai-studio/floor-plan';
}

export default function GenerationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [data, setData] = useState<GenerationStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingLabel, setDownloadingLabel] = useState(false);

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
  const styleKey = data?.input?.style || '';
  const fallbackStyle = FALLBACK_STYLES[styleKey] || {
    label: data?.input?.style || '未知风格',
    icon: 'AI',
    gradient: 'from-zinc-500 to-zinc-400',
  };
  const styleInfo = {
    label: presetSnapshot?.name || fallbackStyle.label,
    icon: presetSnapshot?.icon || fallbackStyle.icon,
    gradient: presetSnapshot?.previewClassName || fallbackStyle.gradient,
  };

  const rooms = useMemo(() => normalizeRooms(data?.input?.roomData), [data?.input?.roomData]);
  const layoutMetrics = useMemo(() => getLayoutMetrics(rooms), [rooms]);
  const labelData = useMemo(() => buildLabelRenderData(rooms), [rooms]);
  const proxiedImageUrl = data?.imageUrl ? `/api/ai/image-proxy?url=${encodeURIComponent(data.imageUrl)}` : null;

  const overlaySvg = useMemo(() => {
    if (!layoutMetrics || !labelData.length) {
      return null;
    }

    const labelNodes = labelData
      .map((label) => {
        const center = scalePoint(label.centerX, label.centerY, layoutMetrics, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, 64);
        const roomName = escapeSvgText(label.roomName);
        const dimText = [label.widthLabel, label.heightLabel].filter(Boolean).join(' x ');

        return `
          <g>
            <text x="${center.x}" y="${center.y}" text-anchor="middle" dominant-baseline="middle"
              font-size="30" font-weight="700" fill="#111111" stroke="#ffffff" stroke-width="6" paint-order="stroke">
              ${roomName}
            </text>
            ${
              dimText
                ? `<text x="${center.x}" y="${center.y + 34}" text-anchor="middle" dominant-baseline="middle"
              font-size="16" font-weight="600" fill="#1f2937" stroke="#ffffff" stroke-width="4" paint-order="stroke">${escapeSvgText(dimText)}</text>`
                : ''
            }
          </g>
        `;
      })
      .join('');

    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWPORT_WIDTH} ${VIEWPORT_HEIGHT}" width="${VIEWPORT_WIDTH}" height="${VIEWPORT_HEIGHT}" preserveAspectRatio="none">
        ${labelNodes}
      </svg>
    `;
  }, [labelData, layoutMetrics]);

  const handleDownloadLabeled = async () => {
    if (!proxiedImageUrl || !overlaySvg) return;

    setDownloadingLabel(true);
    try {
      const imageResponse = await fetch(proxiedImageUrl);
      const imageBlob = await imageResponse.blob();
      const imageDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(imageBlob);
      });

      const mergedSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWPORT_WIDTH} ${VIEWPORT_HEIGHT}" width="${VIEWPORT_WIDTH}" height="${VIEWPORT_HEIGHT}">
          <image href="${imageDataUrl}" x="0" y="0" width="${VIEWPORT_WIDTH}" height="${VIEWPORT_HEIGHT}" preserveAspectRatio="xMidYMid meet" />
          ${stripOuterSvg(overlaySvg)}
        </svg>
      `;

      const blob = new Blob([mergedSvg], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `AI_FloorPlan_Labeled_${id}.svg`;
      link.click();
      URL.revokeObjectURL(blobUrl);
    } catch (downloadError) {
      console.error(downloadError);
      alert('下载标注版失败');
    } finally {
      setDownloadingLabel(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-purple-500" size={40} />
        <p className="font-medium text-muted-foreground">加载方案详情...</p>
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
              <h1 className="text-2xl font-bold tracking-tight">方案详情</h1>
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
                variant="outline"
                className="gap-2 rounded-xl font-bold"
                onClick={handleDownloadLabeled}
                disabled={downloadingLabel || !overlaySvg}
              >
                {downloadingLabel ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                下载标注版
              </Button>
              <Button
                className="gap-2 rounded-xl bg-black font-bold text-white hover:bg-zinc-800"
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = imageUrl;
                  a.download = `AI_FloorPlan_${id}.png`;
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
                  <img src={imageUrl} alt="Generated Floor Plan" className="h-full w-full object-contain" />
                  {overlaySvg && (
                    <div className="pointer-events-none absolute inset-0" dangerouslySetInnerHTML={{ __html: overlaySvg }} />
                  )}
                </div>
              ) : data.status === 'failed' ? (
                <div className="p-12 text-center">
                  <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-red-50 text-red-500">
                    <Info size={40} />
                  </div>
                  <h2 className="mb-2 text-xl font-bold">生成失败</h2>
                  <p className="mb-6 max-w-md text-muted-foreground">{data.error || 'AI 服务响应异常，请尝试重新生成'}</p>
                  <Button variant="outline" className="rounded-xl font-bold" onClick={() => router.push(getBackPath(data.type))}>
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
                          style={{ width: `${Math.max(data.progress || 5, 5)}%` }}
                        />
                      </div>
                    </div>
                    <p className="mt-4 text-sm text-muted-foreground">完成后会自动叠加房间标注</p>
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
                  <Sparkles size={12} className="text-purple-500" /> 风格配置
                </h3>
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-black text-white', styleInfo.gradient)}>
                    {styleInfo.icon}
                  </div>
                  <div>
                    <p className="text-lg font-bold">{styleInfo.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {data.type === 'furnishing_render' ? 'AI 软装设计' : 'AI 室内平面'}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="px-1 text-xs font-black uppercase tracking-[0.15em] text-muted-foreground">任务元数据</h3>
              {[
                { icon: Map, label: '关联户型', value: data.input?.roomName || '未命名户型' },
                { icon: Calendar, label: '生成时间', value: new Date(data.createdAt).toLocaleString('zh-CN') },
                { icon: Cpu, label: '计算引擎', value: data.provider || 'AI Cluster' },
                { icon: Type, label: '标注状态', value: overlaySvg ? `已叠加 ${labelData.length} 个房间标注` : '无房间标注数据' },
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
                  <Type size={12} /> AI 提示词
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
