'use client';

import React, { useState, useEffect } from 'react';
import {
  Loader2, Sparkles, Download, Image as ImageIcon, Clock,
  ChevronRight, Map, RefreshCw, ExternalLink, Share2, Check, Palette
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
} from "@/components/ui/select";
import AiQuotaBar from '@/components/ai-studio/AiQuotaBar';
import RechargeDialog from '@/components/ai-studio/RechargeDialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';

// --- 软装风格定义 ---
const FURNISHING_STYLES = [
  { id: 'modern', label: '现代简约', icon: '🏠', color: 'from-slate-400 to-zinc-500' },
  { id: 'cream', label: '奶油风', icon: '🍦', color: 'from-amber-200 to-orange-200' },
  { id: 'chinese', label: '新中式', icon: '🏮', color: 'from-red-500 to-amber-600' },
  { id: 'luxury', label: '意式轻奢', icon: '💎', color: 'from-yellow-400 to-amber-500' },
  { id: 'wabi', label: '侘寂风', icon: '🪵', color: 'from-stone-400 to-stone-600' },
  { id: 'scandinavian', label: '北欧风', icon: '🌿', color: 'from-emerald-300 to-teal-400' },
  { id: 'japanese', label: '日式原木', icon: '🎋', color: 'from-lime-300 to-green-400' },
  { id: 'industrial', label: '工业风', icon: '⚙️', color: 'from-gray-500 to-gray-700' },
];

const ROOM_TYPES = [
  { id: '客厅', label: '客厅/客餐厅', icon: '🛋️' },
  { id: '主卧', label: '主卧', icon: '🛏️' },
  { id: '次卧', label: '次卧/儿童房', icon: '🧒' },
  { id: '厨房', label: '厨房', icon: '🍳' },
  { id: '卫生间', label: '卫生间', icon: '🚿' },
  { id: '书房', label: '书房/办公室', icon: '📚' },
  { id: '阳台', label: '阳台', icon: '🌅' },
  { id: '玄关', label: '玄关', icon: '🚪' },
];

export default function AiFurnishingPage() {
  const { user } = useCurrentUser();
  const [floorPlans, setFloorPlans] = useState<any[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [selectedStyle, setSelectedStyle] = useState<string>('modern');
  const [selectedRoom, setSelectedRoom] = useState<string>('客厅');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [quota, setQuota] = useState<any>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [showRecharge, setShowRecharge] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [shareSuccess, setShareSuccess] = useState(false);

  // 并行获取数据
  useEffect(() => {
    Promise.all([
      fetch('/api/floorplans').then(r => r.json()),
      fetch('/api/ai/quota').then(r => r.json()),
      fetch('/api/ai/history?type=furnishing_render&limit=8').then(r => r.json()),
    ]).then(([plansData, quotaData, historyData]) => {
      if (plansData.success) setFloorPlans(plansData.data);
      if (quotaData.success) setQuota(quotaData.data);
      if (historyData.success) setHistory(historyData.data);
    }).finally(() => {
      setLoadingPlans(false);
      setQuotaLoading(false);
    });
  }, []);

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
      const rooms = plan?.layoutData?.rooms || plan?.layoutData || [];
      const roomData = Array.isArray(rooms) ? rooms.find((r: any) => r.name === selectedRoom) : null;

      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'furnishing_render',
          style: selectedStyle,
          roomType: selectedRoom,
          roomName: selectedRoom,
          floorPlanId: selectedPlanId,
          width: roomData?.width || 500,
          height: roomData?.height || 400,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setGeneratedImage(data.data.imageUrl);
        setQuota(data.quota);
        // 刷新历史
        fetch('/api/ai/history?type=furnishing_render&limit=8')
          .then(r => r.json())
          .then(d => { if (d.success) setHistory(d.data); });
      } else {
        alert(data.error || 'AI 生成失败');
        if (data.quota) setQuota(data.quota);
      }
    } catch (err) {
      console.error(err);
      alert('网络异常，请重试');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveToInspiration = async () => {
    if (!generatedImage) return;
    try {
      const styleLabel = FURNISHING_STYLES.find(s => s.id === selectedStyle)?.label || selectedStyle;
      const res = await fetch('/api/inspirations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `AI ${styleLabel} - ${selectedRoom}`,
          style: styleLabel,
          roomType: selectedRoom,
          coverImage: generatedImage,
          renderingImage: generatedImage,
          layoutData: selectedPlan?.layoutData || [],
          isRecommended: false,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShareSuccess(true);
        setTimeout(() => setShareSuccess(false), 3000);
      } else {
        alert('保存失败');
      }
    } catch (err) {
      alert('保存异常');
    }
  };

  const handleUpgrade = async (tier: string, amount: number) => {
    const res = await fetch('/api/ai/quota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upgrade', tier, amount, method: 'manual' }),
    });
    const data = await res.json();
    if (data.success) setQuota(data.data);
  };

  const handleRecharge = async (credits: number, amount: number) => {
    const res = await fetch('/api/ai/quota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recharge', credits, amount, method: 'manual' }),
    });
    const data = await res.json();
    if (data.success) setQuota(data.data);
  };

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-pink-500 rounded-2xl flex items-center justify-center text-white">
              <Palette size={20} />
            </div>
            <h1 className="text-[28px] font-bold tracking-tight">AI 软装设计</h1>
            <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-none font-bold text-[10px] uppercase">
              Beta
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">基于真实户型数据，一键生成不同装修风格的室内效果图</p>
        </div>

        {/* Quota Bar */}
        <div className="mb-8">
          <AiQuotaBar quota={quota} loading={quotaLoading} onRecharge={() => setShowRecharge(true)} />
        </div>

        {/* Selectors Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
            <SelectTrigger className="h-14 rounded-2xl bg-muted/20 border-muted font-medium text-base">
              <SelectValue placeholder="选择户型图..." />
            </SelectTrigger>
            <SelectContent className="rounded-2xl border-none shadow-2xl">
              {loadingPlans ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  <Loader2 className="animate-spin mx-auto mb-2" size={20} /> 加载中...
                </div>
              ) : floorPlans.map(plan => (
                <SelectItem key={plan._id} value={plan._id} className="rounded-xl py-3">
                  <div className="flex items-center gap-2">
                    <Map size={16} className="text-muted-foreground" />
                    <span className="font-medium">{plan.name || '未命名户型'}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedRoom} onValueChange={setSelectedRoom}>
            <SelectTrigger className="h-14 rounded-2xl bg-muted/20 border-muted font-medium text-base">
              <SelectValue placeholder="选择空间..." />
            </SelectTrigger>
            <SelectContent className="rounded-2xl border-none shadow-2xl">
              {ROOM_TYPES.map(room => (
                <SelectItem key={room.id} value={room.id} className="rounded-xl py-3">
                  <span>{room.icon} {room.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Main Content — Two Column */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* LEFT: Preview */}
          <div className="lg:col-span-2">
            <div className="relative bg-muted/10 border-2 border-dashed border-muted rounded-[32px] overflow-hidden aspect-[16/10] flex items-center justify-center">
              {isGenerating ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center">
                      <Palette className="text-orange-500 animate-spin" size={32} />
                    </div>
                    <div className="absolute inset-0 rounded-full border-2 border-orange-300 animate-ping" />
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold">AI 正在渲染</p>
                    <p className="text-sm text-muted-foreground">
                      {FURNISHING_STYLES.find(s => s.id === selectedStyle)?.label} · {selectedRoom} · 预计 15-30 秒
                    </p>
                  </div>
                </div>
              ) : generatedImage ? (
                <div className="w-full h-full relative group">
                  <img
                    src={generatedImage}
                    alt="AI Generated Furnishing"
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="secondary" className="rounded-xl shadow-lg font-bold text-xs"
                      onClick={() => window.open(generatedImage, '_blank')}
                    >
                      <ExternalLink size={14} className="mr-1" /> 大图
                    </Button>
                    <Button size="sm" variant="secondary" className="rounded-xl shadow-lg font-bold text-xs"
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = generatedImage;
                        a.download = `AI_furnishing_${selectedStyle}_${Date.now()}.png`;
                        a.click();
                      }}
                    >
                      <Download size={14} className="mr-1" /> 保存
                    </Button>
                    <Button size="sm"
                      variant="secondary"
                      className={cn("rounded-xl shadow-lg font-bold text-xs", shareSuccess && "bg-green-500 text-white")}
                      onClick={handleSaveToInspiration}
                    >
                      {shareSuccess ? <Check size={14} className="mr-1" /> : <Share2 size={14} className="mr-1" />}
                      {shareSuccess ? '已保存' : '存入灵感库'}
                    </Button>
                  </div>
                  <div className="absolute bottom-4 left-4 flex gap-2">
                    <Badge className="bg-black/70 text-white border-none font-bold text-xs">
                      {FURNISHING_STYLES.find(s => s.id === selectedStyle)?.icon}{' '}
                      {FURNISHING_STYLES.find(s => s.id === selectedStyle)?.label}
                    </Badge>
                    <Badge className="bg-white/90 text-foreground border-none font-bold text-xs">
                      {selectedRoom}
                    </Badge>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 text-muted-foreground">
                  <div className="w-24 h-24 rounded-3xl bg-muted/50 flex items-center justify-center">
                    <Palette size={40} className="opacity-30" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-foreground">选择户型图、空间和风格</p>
                    <p className="text-sm">AI 将生成逼真的室内软装效果图</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Style Panel */}
          <div className="space-y-8">
            <div>
              <h3 className="text-xs font-black uppercase tracking-[0.15em] text-muted-foreground mb-4">装修风格</h3>
              <div className="grid grid-cols-2 gap-2.5">
                {FURNISHING_STYLES.map((style) => (
                  <div
                    key={style.id}
                    onClick={() => setSelectedStyle(style.id)}
                    className={cn(
                      "flex items-center gap-2.5 p-3 rounded-xl cursor-pointer transition-all border-2",
                      selectedStyle === style.id
                        ? "border-orange-500 bg-orange-50/50 shadow-md"
                        : "border-muted hover:border-muted-foreground/30"
                    )}
                  >
                    <div className={cn(
                      "w-9 h-9 rounded-lg bg-gradient-to-br flex items-center justify-center text-lg shrink-0",
                      style.color
                    )}>
                      {style.icon}
                    </div>
                    <span className={cn(
                      "text-xs font-bold",
                      selectedStyle === style.id ? "text-orange-700" : "text-foreground"
                    )}>
                      {style.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Generate */}
            <Button
              className="w-full h-14 rounded-2xl font-bold text-base bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white shadow-xl shadow-orange-200 transition-all disabled:opacity-50"
              disabled={isGenerating || !selectedPlanId}
              onClick={handleGenerate}
            >
              {isGenerating ? (
                <><Loader2 className="animate-spin mr-2" size={20} /> AI 渲染中...</>
              ) : (
                <><Sparkles className="mr-2" size={20} /> 生成效果图</>
              )}
            </Button>

            {generatedImage && (
              <Button variant="outline" className="w-full h-12 rounded-2xl font-bold text-sm" onClick={handleGenerate}>
                <RefreshCw size={16} className="mr-2" /> 重新生成
              </Button>
            )}

            {/* History */}
            {history.length > 0 && (
              <div>
                <h3 className="text-xs font-black uppercase tracking-[0.15em] text-muted-foreground mb-3 flex items-center gap-2">
                  <Clock size={12} /> 最近生成
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {history.map((item: any) => (
                    <div
                      key={item._id}
                      className="aspect-square rounded-xl bg-muted overflow-hidden cursor-pointer hover:ring-2 ring-primary transition-all"
                      onClick={() => {
                        if (item.output?.imageUrl) setGeneratedImage(item.output.imageUrl);
                      }}
                    >
                      {item.output?.imageUrl ? (
                        <img src={item.output.imageUrl} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon size={16} className="text-muted-foreground/50" />
                        </div>
                      )}
                    </div>
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
