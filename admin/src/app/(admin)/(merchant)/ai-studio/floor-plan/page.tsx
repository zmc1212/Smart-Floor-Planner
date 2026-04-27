'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, Sparkles, Download, Image as ImageIcon, Clock, ChevronRight, Map, RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import AiQuotaBar from '@/components/ai-studio/AiQuotaBar';
import RechargeDialog from '@/components/ai-studio/RechargeDialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFetch } from '@/hooks/useFetch';

// --- 平面风格定义 ---
const FLOOR_PLAN_STYLES = [
  {
    id: 'colorful',
    label: '彩色风格',
    description: '鲜明色块区分空间，直观易读',
    gradient: 'from-pink-400 via-purple-400 to-blue-400',
    emoji: '🎨',
  },
  {
    id: 'cad',
    label: 'CAD风格',
    description: '专业黑白线稿，精确尺寸标注',
    gradient: 'from-zinc-700 via-zinc-500 to-zinc-400',
    emoji: '📐',
  },
  {
    id: '3d',
    label: '3D风格',
    description: '立体透视图，沉浸感呈现',
    gradient: 'from-cyan-400 via-blue-500 to-indigo-500',
    emoji: '🏗️',
  },
  {
    id: 'handdrawn',
    label: '手绘风格',
    description: '水彩手绘质感，温暖艺术化',
    gradient: 'from-amber-300 via-orange-300 to-rose-300',
    emoji: '✏️',
  },
];

export default function AiFloorPlanPage() {
  const { user } = useCurrentUser();
  const { data: floorPlansData, isLoading: loadingPlans } = useFetch<any[]>('/api/floorplans');
  const floorPlans = floorPlansData || [];
  const { data: quota, mutate: mutateQuota } = useFetch<any>('/api/ai/quota');
  const { data: historyData, mutate: mutateHistory } = useFetch<any>('/api/ai/history?type=floor_plan_style&limit=6');
  
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [selectedStyle, setSelectedStyle] = useState<string>('colorful');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [showRecharge, setShowRecharge] = useState(false);

  const history = historyData || [];


  const selectedPlan = floorPlans.find(p => p._id === selectedPlanId);

  const handleGenerate = async () => {
    if (!selectedPlanId) {
      alert('请先选择一个户型图');
      return;
    }

    setIsGenerating(true);
    setGeneratedImage(null);

    try {
      const plan = selectedPlan;
      // 提取房间信息构建描述
      const rooms = plan?.layoutData?.rooms || plan?.layoutData || [];
      const roomNames = Array.isArray(rooms) ? rooms.map((r: any) => r.name).filter(Boolean).join(', ') : '';

      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'floor_plan_style',
          style: selectedStyle,
          floorPlanId: selectedPlanId,
          roomName: roomNames || plan?.name || '住宅',
          width: rooms[0]?.width || 500,
          height: rooms[0]?.height || 400,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setGeneratedImage(data.data.imageUrl);
        // 刷新配额和历史
        mutateQuota();
        mutateHistory();
      } else {
        alert(data.error || 'AI 生成失败');
        if (data.quota) mutateQuota();
      }
    } catch (err) {
      console.error(err);
      alert('网络异常，请重试');
    } finally {
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
      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center text-white">
              <Sparkles size={20} />
            </div>
            <h1 className="text-[28px] font-bold tracking-tight">AI 室内平面</h1>
            <Badge variant="secondary" className="bg-purple-50 text-purple-700 border-none font-bold text-[10px] uppercase">
              Beta
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">选择已有户型图，一键转换为彩色、CAD、3D、手绘等多种平面风格</p>
        </div>

        {/* Quota Bar */}
        <div className="mb-8">
          <AiQuotaBar quota={quota} loading={!quota && !floorPlans.length} onRecharge={() => setShowRecharge(true)} />
        </div>

        {/* Main Content — Two Column */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* LEFT: Preview Area */}
          <div className="lg:col-span-2 space-y-6">

            {/* Floor Plan Selector */}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                  <SelectTrigger className="h-14 rounded-2xl bg-muted/20 border-muted font-medium text-base">
                    <SelectValue placeholder="选择一个户型图作为 AI 输入源..." />
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl border-none shadow-2xl">
                    {loadingPlans ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">
                        <Loader2 className="animate-spin mx-auto mb-2" size={20} />
                        加载中...
                      </div>
                    ) : floorPlans.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">
                        暂无户型图，请先通过小程序量房采集
                      </div>
                    ) : (
                      floorPlans.map(plan => (
                        <SelectItem key={plan._id} value={plan._id} className="rounded-xl py-3">
                          <div className="flex items-center gap-3">
                            <Map size={16} className="text-muted-foreground" />
                            <div>
                              <span className="font-medium">{plan.name || '未命名户型'}</span>
                              <span className="text-xs text-muted-foreground ml-2">
                                {Array.isArray(plan.layoutData) ? plan.layoutData.length : (plan.layoutData?.rooms?.length || 0)} 个房间
                              </span>
                            </div>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Canvas / Result Area */}
            <div className="relative bg-muted/10 border-2 border-dashed border-muted rounded-[32px] overflow-hidden aspect-[4/3] flex items-center justify-center">
              {isGenerating ? (
                <div className="flex flex-col items-center gap-4 animate-pulse">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full bg-purple-100 flex items-center justify-center">
                      <Sparkles className="text-purple-500 animate-spin" size={32} />
                    </div>
                    <div className="absolute inset-0 rounded-full border-2 border-purple-300 animate-ping" />
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold">AI 正在生成</p>
                    <p className="text-sm text-muted-foreground">
                      {FLOOR_PLAN_STYLES.find(s => s.id === selectedStyle)?.label} · 预计 10-30 秒
                    </p>
                  </div>
                </div>
              ) : generatedImage ? (
                <div className="w-full h-full relative group">
                  <img
                    src={generatedImage}
                    alt="AI Generated Floor Plan"
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="rounded-xl shadow-lg font-bold text-xs"
                      onClick={() => window.open(generatedImage, '_blank')}
                    >
                      <ExternalLink size={14} className="mr-1" /> 查看大图
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="rounded-xl shadow-lg font-bold text-xs"
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = generatedImage;
                        a.download = `AI_${selectedStyle}_${Date.now()}.png`;
                        a.click();
                      }}
                    >
                      <Download size={14} className="mr-1" /> 保存图片
                    </Button>
                  </div>
                  <div className="absolute bottom-4 left-4">
                    <Badge className="bg-black/70 text-white border-none font-bold text-xs">
                      {FLOOR_PLAN_STYLES.find(s => s.id === selectedStyle)?.emoji}{' '}
                      {FLOOR_PLAN_STYLES.find(s => s.id === selectedStyle)?.label}
                    </Badge>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 text-muted-foreground">
                  <div className="w-24 h-24 rounded-3xl bg-muted/50 flex items-center justify-center">
                    <ImageIcon size={40} className="opacity-30" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-foreground">选择户型图和风格</p>
                    <p className="text-sm">AI 将自动转换为目标平面风格</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Control Panel */}
          <div className="space-y-8">

            {/* Style Selector */}
            <div>
              <h3 className="text-xs font-black uppercase tracking-[0.15em] text-muted-foreground mb-4">平面风格</h3>
              <div className="grid grid-cols-2 gap-3">
                {FLOOR_PLAN_STYLES.map((style) => (
                  <div
                    key={style.id}
                    onClick={() => setSelectedStyle(style.id)}
                    className={cn(
                      "relative flex flex-col items-center p-4 rounded-2xl cursor-pointer transition-all border-2 group",
                      selectedStyle === style.id
                        ? "border-purple-500 bg-purple-50/50 shadow-lg shadow-purple-100"
                        : "border-muted hover:border-muted-foreground/30 hover:shadow-md"
                    )}
                  >
                    <div className={cn(
                      "w-full aspect-square rounded-xl mb-3 bg-gradient-to-br flex items-center justify-center text-3xl",
                      style.gradient
                    )}>
                      {style.emoji}
                    </div>
                    <span className={cn(
                      "text-xs font-bold text-center",
                      selectedStyle === style.id ? "text-purple-700" : "text-foreground"
                    )}>
                      {style.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground text-center mt-0.5 leading-tight">
                      {style.description}
                    </span>
                    {selectedStyle === style.id && (
                      <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Generate Button */}
            <Button
              className="w-full h-14 rounded-2xl font-bold text-base bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-xl shadow-purple-200 transition-all disabled:opacity-50"
              disabled={isGenerating || !selectedPlanId}
              onClick={handleGenerate}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="animate-spin mr-2" size={20} />
                  AI 生成中...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2" size={20} />
                  开始生成
                </>
              )}
            </Button>

            {generatedImage && (
              <Button
                variant="outline"
                className="w-full h-12 rounded-2xl font-bold text-sm"
                onClick={handleGenerate}
              >
                <RefreshCw size={16} className="mr-2" />
                重新生成
              </Button>
            )}

            {/* History */}
            {history.length > 0 && (
              <div>
                <h3 className="text-xs font-black uppercase tracking-[0.15em] text-muted-foreground mb-3 flex items-center gap-2">
                  <Clock size={12} /> 最近生成
                </h3>
                <div className="space-y-2">
                  {history.map((item: any) => (
                    <div
                      key={item._id}
                      className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 hover:bg-muted/40 cursor-pointer transition-all group"
                      onClick={() => {
                        if (item.output?.imageUrl) setGeneratedImage(item.output.imageUrl);
                      }}
                    >
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
                        {item.output?.imageUrl ? (
                          <img src={item.output.imageUrl} className="w-full h-full object-cover" alt="" />
                        ) : (
                          <ImageIcon size={16} className="text-muted-foreground/50" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate">
                          {FLOOR_PLAN_STYLES.find(s => s.id === item.input?.style)?.label || item.input?.style}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(item.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <ChevronRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Recharge Dialog */}
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
