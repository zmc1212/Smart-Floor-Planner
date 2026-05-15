'use client';

import { notify } from '@/components/ui/operation-feedback';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  Clock,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  UploadCloud,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
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
  image?: {
    mode: string;
  };
}

interface AiQuotaData {
  tier: string;
  usedCount: number;
  monthlyLimit: number;
  bonusCredits: number;
  remaining: number;
}

interface AiHistoryItem {
  _id: string;
  status?: string;
  createdAt: string;
  input?: { style?: string };
  output?: { imageUrl?: string };
}

const LOADING_STAGES = [
  '正在解析上传图像...',
  '正在理解场景与空间布局...',
  '正在构建风格转化网络...',
  '正在处理细节渲染...',
  '即将完成...',
];

export default function AiScenariosPage() {
  const router = useRouter();
  const { data: quota, mutate: mutateQuota } = useFetch<AiQuotaData>('/api/ai/quota');
  const { data: presetsData, isLoading: loadingPresets } = useFetch<AiPreset[]>(
    '/api/ai/presets?type=scenario'
  );
  const { data: historyData, mutate: mutateHistory } = useFetch<AiHistoryItem[]>(
    '/api/ai/history?type=scenario&limit=6'
  );

  const presets = useMemo(
    () => [...(presetsData || [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [presetsData]
  );
  const history = historyData || [];

  const [selectedScenarioKey, setSelectedScenarioKey] = useState<string | null>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [showRecharge, setShowRecharge] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedPreset = presets.find((preset) => preset.key === selectedScenarioKey);

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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      notify.fromAlert('图片大小不能超过 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setUploadedImage(event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    if (!selectedPreset) return;
    if (!uploadedImage) {
      notify.fromAlert('请先上传一张参考图片');
      return;
    }

    setIsGenerating(true);
    setLoadingStage(0);

    try {
      const genRes = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'scenario',
          style: selectedPreset.key,
          mode: selectedPreset.image?.mode || 'generation'
        }),
      });

      const genData = await genRes.json();
      if (!genData.success) {
        notify.fromAlert(genData.error || '场景任务初始化失败');
        setIsGenerating(false);
        return;
      }

      const renderRes = await fetch('/api/ai/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationId: genData.data.id,
          image: uploadedImage,
          prompt: genData.data.prompt,
          negativePrompt: genData.data.negativePrompt,
        }),
      });

      const renderData = await renderRes.json();
      if (!renderData.success) {
        notify.fromAlert(renderData.error || '渲染请求失败');
        setIsGenerating(false);
        return;
      }

      mutateQuota();
      mutateHistory();
      // Assume detail viewing route is similar to floor-plan: /ai-studio/scenarios/[id]
      router.push(`/ai-studio/scenarios/${genData.data.id}`);
    } catch (error) {
      console.error(error);
      notify.fromAlert('网络异常，请重试');
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

  if (selectedScenarioKey && selectedPreset) {
    return (
      <div className="min-h-screen bg-white text-[#171717] font-sans">
        <main className="mx-auto max-w-7xl px-6 py-8">
          <button 
            onClick={() => { setSelectedScenarioKey(null); setUploadedImage(null); }}
            className="mb-6 flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft size={16} className="mr-1" />
            返回场景魔方
          </button>

          <div className="mb-8">
            <div className="mb-2 flex items-center gap-3">
              <div className={cn(
                "flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br text-white text-sm font-black",
                selectedPreset.previewClassName
              )}>
                {selectedPreset.icon}
              </div>
              <h1 className="text-[28px] font-bold tracking-tight">{selectedPreset.name}</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {selectedPreset.description}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <div 
                className={cn(
                  "relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[28px] border-2 border-dashed transition-all",
                  uploadedImage ? "border-transparent bg-black" : "border-muted bg-muted/10 hover:border-purple-300 hover:bg-purple-50/50 cursor-pointer"
                )}
                onClick={() => !uploadedImage && fileInputRef.current?.click()}
              >
                {isGenerating ? (
                  <div className="absolute inset-0 bg-black/60 z-10 flex flex-col items-center justify-center backdrop-blur-sm">
                    <div className="relative mb-6">
                      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-purple-500 text-white">
                        <Sparkles className="animate-spin" size={32} />
                      </div>
                      <div className="absolute inset-0 animate-ping rounded-full border-2 border-purple-400" />
                    </div>
                    <div className="text-center text-white">
                      <p className="text-lg font-bold">{LOADING_STAGES[loadingStage]}</p>
                      <p className="mt-1 text-sm opacity-80">{selectedPreset.name} · 生成中</p>
                    </div>
                  </div>
                ) : null}

                {uploadedImage ? (
                  <div className="relative h-full w-full group">
                    <img src={uploadedImage} alt="Uploaded" className="h-full w-full object-contain" />
                    {!isGenerating && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); setUploadedImage(null); if(fileInputRef.current) fileInputRef.current.value = ''; }}
                        className="absolute top-4 right-4 h-10 w-10 bg-black/50 hover:bg-black/80 rounded-full flex items-center justify-center text-white backdrop-blur-md transition-colors"
                      >
                        <X size={20} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4 text-muted-foreground pointer-events-none">
                    <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-white shadow-sm">
                      <UploadCloud size={40} className="text-purple-500" />
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-foreground text-lg">点击上传参考图</p>
                      <p className="text-sm mt-1">支持 JPG / PNG / WEBP 格式，最大 10MB</p>
                    </div>
                  </div>
                )}
                
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/jpeg, image/png, image/webp" 
                  onChange={handleImageUpload} 
                />
              </div>
            </div>

            <div className="space-y-6">
              <AiQuotaBar quota={quota} loading={!quota} onRecharge={() => setShowRecharge(true)} />
              
              <div className="rounded-2xl border p-5 bg-muted/10">
                <h3 className="font-bold mb-2">生成说明</h3>
                <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
                  <li>该场景完全由 AI 自动排版和计算</li>
                  <li>请尽量上传清晰度高、结构完整的图片</li>
                  <li>生成时长预计为 10-20 秒，请耐心等待</li>
                </ul>
              </div>

              <Button
                className="h-14 w-full rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 text-base font-bold text-white shadow-xl shadow-purple-200 transition-all hover:from-purple-700 hover:to-pink-700 disabled:opacity-50"
                disabled={isGenerating || !uploadedImage}
                onClick={handleGenerate}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 animate-spin" size={20} />
                    正在生成...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2" size={20} />
                    开始生成
                  </>
                )}
              </Button>
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

  // Grid Hub View
  return (
    <div className="min-h-screen bg-slate-50/50 text-[#171717] font-sans pb-12">
      <div className="bg-white border-b px-6 py-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-2 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-200">
              <Sparkles size={20} />
            </div>
            <h1 className="text-[28px] font-bold tracking-tight">场景魔方</h1>
            <Badge variant="secondary" className="border-none bg-indigo-50 text-indigo-700">
              Pro
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            提供十大数据驱动的 AI 实战场景，涵盖长图拼合、概念展板、图转线稿、光影分析等。选择一个场景，上传参考图即可一键生成。
          </p>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {loadingPresets ? (
          <div className="flex py-20 items-center justify-center text-muted-foreground">
            <Loader2 className="animate-spin mr-2" size={24} />
            正在加载场景库...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {presets.map((preset) => (
              <div 
                key={preset.key}
                onClick={() => setSelectedScenarioKey(preset.key)}
                className="group relative bg-white rounded-3xl p-6 border shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-transparent to-black/5 opacity-0 group-hover:opacity-100 rounded-bl-full transition-opacity pointer-events-none" />
                <div className={cn(
                  "mb-5 flex h-14 w-14 items-center justify-center rounded-2xl text-white font-black text-xl shadow-md",
                  preset.previewClassName
                )}>
                  {preset.icon}
                </div>
                <h3 className="font-bold text-lg mb-2 group-hover:text-purple-600 transition-colors">{preset.name}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {preset.description}
                </p>
              </div>
            ))}
          </div>
        )}

        {history.length > 0 && (
          <div className="mt-16">
            <h3 className="mb-6 flex items-center gap-2 text-sm font-bold tracking-wider">
              <Clock size={16} className="text-muted-foreground" /> 历史场景生成
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {history.map((item) => (
                <button
                  key={item._id}
                  onClick={() => router.push(`/ai-studio/scenarios/${item._id}`)}
                  className="group relative aspect-[3/4] overflow-hidden rounded-2xl bg-muted border hover:border-purple-400 transition-all shadow-sm hover:shadow-md"
                >
                  {item.output?.imageUrl ? (
                    <img src={item.output.imageUrl} className="h-full w-full object-cover transition-transform group-hover:scale-105" alt="" />
                  ) : item.status === 'processing' || item.status === 'pending' ? (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <RefreshCw size={24} className="animate-spin opacity-50" />
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <ImageIcon size={24} className="opacity-30" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-8">
                    <p className="truncate text-xs font-bold text-white text-left">
                      {presets.find((preset) => preset.key === item.input?.style)?.name || '未知场景'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
