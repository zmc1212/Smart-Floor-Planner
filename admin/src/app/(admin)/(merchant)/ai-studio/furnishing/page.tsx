'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  Clock,
  Image as ImageIcon,
  Loader2,
  Map,
  Palette,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import AiQuotaBar from '@/components/ai-studio/AiQuotaBar';
import RechargeDialog from '@/components/ai-studio/RechargeDialog';
import { useFetch } from '@/hooks/useFetch';

interface AiPreset {
  _id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  previewClassName: string;
  mockImageUrl?: string;
  enabled: boolean;
  sortOrder: number;
}

interface FloorPlanRoom {
  id?: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [key: string]: unknown;
}

interface AiQuotaData {
  tier: string;
  usedCount: number;
  monthlyLimit: number;
  bonusCredits: number;
  remaining: number;
}

interface FloorPlanItem {
  _id: string;
  name?: string;
  layoutData?: FloorPlanRoom[] | { rooms?: FloorPlanRoom[] };
}

interface AiHistoryItem {
  _id: string;
  status?: string;
  createdAt: string;
  input?: { style?: string };
  output?: { imageUrl?: string };
}

const LOADING_STAGES = [
  '正在解析户型结构...',
  '正在匹配装修风格...',
  '正在生成软装材质...',
  '正在处理门窗和房间关系...',
  '即将完成...',
];

function getRooms(plan?: FloorPlanItem) {
  const layoutData = plan?.layoutData;
  const rooms = Array.isArray(layoutData) ? layoutData : layoutData?.rooms || [];
  return Array.isArray(rooms) ? rooms : [];
}

export default function AiFurnishingPage() {
  const router = useRouter();
  const { data: floorPlansData, isLoading: loadingPlans } = useFetch<FloorPlanItem[]>('/api/floorplans');
  const { data: quota, mutate: mutateQuota } = useFetch<AiQuotaData>('/api/ai/quota');
  const { data: presetsData, isLoading: loadingPresets } = useFetch<AiPreset[]>(
    '/api/ai/presets?type=furnishing_style'
  );
  const { data: historyData, mutate: mutateHistory } = useFetch<AiHistoryItem[]>('/api/ai/history?type=furnishing_render&limit=8');

  const floorPlans = floorPlansData || [];
  const presets = useMemo(
    () => [...(presetsData || [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [presetsData]
  );
  const history = historyData || [];

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedStyle, setSelectedStyle] = useState('modern');
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [showRecharge, setShowRecharge] = useState(false);

  const selectedPlan = floorPlans.find((plan) => plan._id === selectedPlanId);
  const selectedPreset = presets.find((preset) => preset.key === selectedStyle);

  useEffect(() => {
    if (presets.length > 0 && !presets.some((preset) => preset.key === selectedStyle)) {
      setSelectedStyle(presets[0].key);
    }
  }, [presets, selectedStyle]);

  useEffect(() => {
    let timer: number | undefined;
    if (isGenerating) {
      timer = window.setInterval(() => {
        setLoadingStage((prev) => (prev + 1) % LOADING_STAGES.length);
      }, 2500);
    } else {
      setLoadingStage(0);
    }

    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [isGenerating]);

  const handleGenerate = async () => {
    if (!selectedPlanId) {
      alert('请先选择一个户型图');
      return;
    }

    const rooms = getRooms(selectedPlan);
    if (rooms.length === 0) {
      alert('当前户型缺少 layoutData，无法生成控制图');
      return;
    }

    setIsGenerating(true);
    setLoadingStage(0);

    try {
      const roomNameForPrompt = rooms.map((room) => room.name).filter(Boolean).join(', ') || selectedPlan?.name || '住宅';
      const firstRoom = rooms[0] || {};

      const genRes = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'furnishing_render',
          style: selectedStyle,
          floorPlanId: selectedPlanId,
          roomName: roomNameForPrompt,
          roomType: 'whole_floor_plan',
          width: firstRoom.width || 500,
          height: firstRoom.height || 400,
          mode: 'floor_plan_overview',
          roomData: rooms,
        }),
      });

      const genData = await genRes.json();
      if (!genData.success) {
        alert(genData.error || '提示词生成失败');
        setIsGenerating(false);
        return;
      }

      let base64Image: string;
      try {
        const { generateBaseMap } = await import('@/lib/canvasExport');
        base64Image = await generateBaseMap(rooms);
      } catch (exportErr) {
        console.error('Failed to generate base map', exportErr);
        alert('无法提取户型线稿，请检查户型数据');
        setIsGenerating(false);
        return;
      }

      const renderRes = await fetch('/api/ai/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationId: genData.data.id,
          image: base64Image,
          prompt: genData.data.prompt,
          negativePrompt: genData.data.negativePrompt,
        }),
      });

      const renderData = await renderRes.json();
      if (!renderData.success) {
        alert(renderData.error || '提交渲染失败');
        setIsGenerating(false);
        return;
      }

      mutateQuota();
      mutateHistory();
      router.push(`/ai-studio/floor-plan/${genData.data.id}`);
    } catch (error) {
      console.error(error);
      alert('网络异常，请重试');
      setIsGenerating(false);
    }
  };

  const handleUpgrade = async (tier: string, amount: number) => {
    const res = await fetch('/api/ai/quota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upgrade', tier, amount, method: 'manual' }),
    });
    const data = await res.json();
    if (data.success) mutateQuota();
  };

  const handleRecharge = async (credits: number, amount: number) => {
    const res = await fetch('/api/ai/quota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recharge', credits, amount, method: 'manual' }),
    });
    const data = await res.json();
    if (data.success) mutateQuota();
  };

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-pink-500 text-white">
              <Palette size={20} />
            </div>
            <h1 className="text-[28px] font-bold tracking-tight">AI 风格设计</h1>
            <Badge variant="secondary" className="border-none bg-orange-50 text-orange-700">
              Beta
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            基于真实户型结构生成不同装修风格的俯视风格效果图，适合快速比稿和方案沟通。
          </p>
        </div>

        <div className="mb-8">
          <AiQuotaBar quota={quota} loading={!quota && !floorPlans.length} onRecharge={() => setShowRecharge(true)} />
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
              <SelectTrigger className="h-14 rounded-2xl border-muted bg-muted/20 text-base font-medium">
                <SelectValue placeholder="选择一个户型图作为 AI 输入源..." />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-none shadow-2xl">
                {loadingPlans ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 animate-spin" size={20} />
                    加载中...
                  </div>
                ) : floorPlans.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">暂无户型图，请先通过小程序量房采集</div>
                ) : (
                  floorPlans.map((plan) => (
                    <SelectItem key={plan._id} value={plan._id} className="rounded-xl py-3">
                      <div className="flex items-center gap-3">
                        <Map size={16} className="text-muted-foreground" />
                        <div>
                          <span className="font-medium">{plan.name || '未命名户型'}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{getRooms(plan).length} 个房间</span>
                        </div>
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[28px] border-2 border-dashed border-muted bg-muted/10">
              {isGenerating ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-orange-100">
                      <Palette className="animate-spin text-orange-500" size={32} />
                    </div>
                    <div className="absolute inset-0 animate-ping rounded-full border-2 border-orange-300" />
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold">{LOADING_STAGES[loadingStage]}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{selectedPreset?.name || selectedStyle} · 俯视软装效果图</p>
                  </div>
                </div>
              ) : selectedPreset?.mockImageUrl ? (
                <div className="relative h-full w-full">
                  <img src={selectedPreset.mockImageUrl} alt={selectedPreset.name} className="h-full w-full object-contain" />
                  <div className="absolute bottom-4 left-4">
                    <Badge className="border-none bg-black/70 text-white">{selectedPreset.name}</Badge>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 text-muted-foreground">
                  <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-muted/50">
                    <Palette size={40} className="opacity-30" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-foreground">选择户型图和装修风格</p>
                    <p className="text-sm">AI 会基于同一户型生成不同软装方案</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-8">
            <div>
              <h3 className="mb-4 text-xs font-black uppercase tracking-[0.15em] text-muted-foreground">装修风格</h3>
              <div className="grid grid-cols-2 gap-3">
                {loadingPresets ? (
                  <div className="col-span-2 rounded-2xl border p-6 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 animate-spin" size={18} />
                    正在加载风格...
                  </div>
                ) : (
                  presets.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => setSelectedStyle(preset.key)}
                      className={cn(
                        'relative rounded-2xl border-2 p-4 text-left transition-all',
                        selectedStyle === preset.key
                          ? 'border-orange-500 bg-orange-50/60 shadow-lg shadow-orange-100'
                          : 'border-muted hover:border-muted-foreground/30 hover:shadow-sm'
                      )}
                    >
                      <div
                        className={cn(
                          'mb-3 flex aspect-square w-full items-center justify-center rounded-xl bg-gradient-to-br text-sm font-black text-white',
                          preset.previewClassName
                        )}
                      >
                        {preset.icon || 'AI'}
                      </div>
                      <div className={cn('text-sm font-bold', selectedStyle === preset.key ? 'text-orange-700' : 'text-foreground')}>
                        {preset.name}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{preset.description}</div>
                      {selectedStyle === preset.key && (
                        <div className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500">
                          <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            <Button
              className="h-14 w-full rounded-2xl bg-gradient-to-r from-orange-500 to-pink-500 text-base font-bold text-white shadow-xl shadow-orange-200 transition-all hover:from-orange-600 hover:to-pink-600 disabled:opacity-50"
              disabled={isGenerating || !selectedPlanId || presets.length === 0}
              onClick={handleGenerate}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 animate-spin" size={20} />
                  AI 生成中...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2" size={20} />
                  生成软装效果图
                </>
              )}
            </Button>

            {history.length > 0 && (
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-muted-foreground">
                  <Clock size={12} /> 最近生成
                </h3>
                <div className="space-y-2">
                  {history.map((item) => (
                    <button
                      key={item._id}
                      type="button"
                      className="group flex w-full items-center gap-3 rounded-xl bg-muted/20 p-3 text-left transition-all hover:bg-muted/40"
                      onClick={() => router.push(`/ai-studio/floor-plan/${item._id}`)}
                    >
                      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                        {item.output?.imageUrl ? (
                          <img src={item.output.imageUrl} className="h-full w-full object-cover" alt="" />
                        ) : item.status === 'processing' || item.status === 'pending' ? (
                          <RefreshCw size={16} className="animate-spin text-muted-foreground/50" />
                        ) : (
                          <ImageIcon size={16} className="text-muted-foreground/50" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold">
                          {presets.find((preset) => preset.key === item.input?.style)?.name || item.input?.style}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(item.createdAt).toLocaleString('zh-CN', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <ChevronRight size={14} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <RechargeDialog
        open={showRecharge}
        onOpenChange={setShowRecharge}
        currentTier={quota?.tier}
        onUpgrade={handleUpgrade}
        onRecharge={handleRecharge}
      />
    </div>
  );
}
