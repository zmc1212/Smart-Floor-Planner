'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Armchair,
  BedDouble,
  Boxes,
  Check,
  ChevronLeft,
  Image as ImageIcon,
  Lamp,
  Loader2,
  PanelTop,
  Sofa,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import AiQuotaBar from '@/components/ai-studio/AiQuotaBar';
import RechargeDialog from '@/components/ai-studio/RechargeDialog';
import { useFetch } from '@/hooks/useFetch';
import type {
  FurnitureSelection,
  SoftFurnishingPlacementRole,
  SoftFurnishingSizeClass,
} from '@/lib/ai/soft-furnishing';

interface AiQuotaData {
  tier: string;
  usedCount: number;
  monthlyLimit: number;
  bonusCredits: number;
  remaining: number;
}

interface FurnitureAsset extends FurnitureSelection {
  subCategory: string;
  color: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

interface AiHistoryItem {
  _id: string;
  status?: string;
  createdAt: string;
  output?: { imageUrl?: string };
}

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

const CATEGORIES = [
  { id: 'sofa', label: '沙发', icon: Sofa },
  { id: 'chair', label: '座椅', icon: Armchair },
  { id: 'cabinet', label: '柜体', icon: Boxes },
  { id: 'bed', label: '床具', icon: BedDouble },
  { id: 'lighting', label: '灯具', icon: Lamp },
  { id: 'finish', label: '墙顶材质', icon: PanelTop },
];

function createAsset(
  id: string,
  name: string,
  category: string,
  subCategory: string,
  typePrompt: string,
  stylePrompt: string,
  placementRole: SoftFurnishingPlacementRole,
  sizeClass: SoftFurnishingSizeClass,
  color: string,
  icon: FurnitureAsset['icon']
): FurnitureAsset {
  return {
    id,
    name,
    category,
    subCategory,
    typePrompt,
    stylePrompt,
    placementRole,
    sizeClass,
    color,
    icon,
  };
}

const FURNITURE_ASSETS: FurnitureAsset[] = [
  createAsset('cream-sectional-sofa', '奶油转角沙发', 'sofa', '客厅主沙发', 'a soft L-shaped sectional sofa', 'cream fabric upholstery, rounded silhouette, warm residential styling', 'primary_seating', 'large', 'from-stone-100 to-amber-100', Sofa),
  createAsset('low-coffee-table', '低矮茶几', 'sofa', '茶几边几', 'a compact coffee table', 'light wood and stone mix, clean modern detailing', 'center_table', 'medium', 'from-zinc-100 to-stone-200', Boxes),
  createAsset('single-lounge-chair', '休闲单椅', 'chair', '点缀单椅', 'an accent lounge chair', 'slim profile, cozy upholstery, premium residential styling', 'accent_seating', 'medium', 'from-neutral-200 to-zinc-300', Armchair),
  createAsset('wall-bookshelf', '开放书柜', 'cabinet', '展示收纳', 'a tall open shelving unit', 'warm built-in wood shelving with subtle display lighting', 'storage_tall', 'large', 'from-stone-500 to-zinc-700', Boxes),
  createAsset('glass-wardrobe', '玻璃衣柜', 'cabinet', '高柜整柜', 'a tall wardrobe cabinet', 'dark framed glass doors with refined storage proportions', 'storage_tall', 'large', 'from-zinc-700 to-neutral-900', Boxes),
  createAsset('bedroom-bed', '软包双人床', 'bed', '卧室主床', 'a double upholstered bed', 'soft headboard, warm textile bedding, restful bedroom styling', 'sleeping', 'large', 'from-stone-100 to-zinc-200', BedDouble),
  createAsset('track-light', '磁吸轨道灯', 'lighting', '顶部照明', 'linear ceiling lighting', 'minimal recessed magnetic track lights, soft ambient glow', 'ceiling_light', 'large', 'from-zinc-800 to-neutral-950', Lamp),
  createAsset('wood-ceiling-wall', '木饰面墙顶', 'finish', '背景材质', 'wood veneer finish treatment', 'warm wood slat feature wall and coordinated ceiling finish', 'surface_finish', 'large', 'from-amber-300 to-stone-500', PanelTop),
];

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImageFile(file: File) {
  const dataUrl = await readFileAsDataUrl(file);

  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}

export default function AiSoftFurnishingPage() {
  const router = useRouter();
  const { data: quota, mutate: mutateQuota } = useFetch<AiQuotaData>('/api/ai/quota');
  const { data: presetsData } = useFetch<AiPreset[]>('/api/ai/presets?type=furnishing_style');
  const { data: historyData, mutate: mutateHistory } = useFetch<AiHistoryItem[]>(
    '/api/ai/history?type=soft_furnishing_render&limit=6'
  );

  const presets = useMemo(
    () => [...(presetsData || [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [presetsData]
  );
  const history = historyData || [];
  const [sourceImage, setSourceImage] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('sofa');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedStyle, setSelectedStyle] = useState('cream');
  const [resolution, setResolution] = useState<'1k' | '2k'>('1k');
  const [isRendering, setIsRendering] = useState(false);
  const [showRecharge, setShowRecharge] = useState(false);
  const [generatedImage, setGeneratedImage] = useState('');

  const selectedItems = useMemo(
    () => FURNITURE_ASSETS.filter((asset) => selectedIds.includes(asset.id)),
    [selectedIds]
  );
  const visibleAssets = FURNITURE_ASSETS.filter((asset) => asset.category === selectedCategory);
  const requestFurnitureItems = useMemo(
    () =>
      selectedItems.map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        typePrompt: item.typePrompt,
        stylePrompt: item.stylePrompt,
        placementRole: item.placementRole,
        sizeClass: item.sizeClass,
      })),
    [selectedItems]
  );

  const toggleAsset = (assetId: string) => {
    setGeneratedImage('');
    setSelectedIds((current) => {
      if (current.includes(assetId)) {
        return current.filter((id) => id !== assetId);
      }
      if (current.length >= 8) {
        alert('最多选择 8 件家具类型');
        return current;
      }
      return [...current, assetId];
    });
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('请上传图片文件');
      return;
    }

    const dataUrl = await compressImageFile(file);
    setSourceImage(dataUrl);
    setGeneratedImage('');
  };

  const handleRender = async () => {
    if (!sourceImage) {
      alert('请先上传现场图');
      return;
    }
    if (selectedItems.length === 0) {
      alert('请至少选择一件家具类型');
      return;
    }

    setIsRendering(true);
    setGeneratedImage('');

    try {
      const roomType = selectedItems.some((item) => item.placementRole === 'sleeping') ? 'bedroom' : 'living_room';
      const roomName = roomType === 'bedroom' ? '卧室软装' : '客厅软装';

      const genRes = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'soft_furnishing_render',
          style: selectedStyle,
          roomType,
          roomName,
          mode: `photo_furniture_staging_${resolution}`,
          furnitureItems: requestFurnitureItems,
        }),
      });

      const genData = await genRes.json();
      if (!genData.success) {
        alert(genData.error || '生成提示词失败');
        return;
      }

      const res = await fetch('/api/ai/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationId: genData.data.id,
          image: sourceImage,
          prompt: genData.data.prompt,
          negativePrompt: genData.data.negativePrompt,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        alert(data.error || '提交软装渲染失败');
        return;
      }

      mutateQuota();
      mutateHistory();
      if (data.data?.imageUrl) {
        setGeneratedImage(data.data.imageUrl);
      } else {
        router.push(`/ai-studio/floor-plan/${genData.data.id}`);
      }
    } catch (error) {
      console.error(error);
      alert('渲染提交失败，请稍后重试');
    } finally {
      setIsRendering(false);
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
    <div className="min-h-screen bg-[#f4f6f8] text-[#17202a]">
      <main className="mx-auto max-w-[1520px] px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white">
                <Sofa size={20} />
              </div>
              <h1 className="text-[28px] font-bold tracking-tight">AI 软装设计</h1>
              <Badge variant="secondary" className="border-none bg-white text-slate-700">
                Prompt First
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              先生成软装提示词，再基于毛坯现场图渲染效果图。系统会尽量保持户型空间结构不变，并把你选择的家具类型写入提示词。
            </p>
          </div>
          <div className="w-full max-w-sm">
            <AiQuotaBar quota={quota} loading={!quota} onRecharge={() => setShowRecharge(true)} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_390px]">
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="mb-5 text-center">
              <h2 className="text-xl font-bold">现场图生成</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                提示词会先描述风格、家具清单和“保持原始结构不变”的约束，再交给图片模型生成结果。
              </p>
            </div>

            {!sourceImage ? (
              <label className="flex min-h-[520px] cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-muted-foreground">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white shadow-sm">
                  <Upload size={32} />
                </div>
                <div className="text-center">
                  <p className="font-bold text-foreground">上传现场图</p>
                  <p className="mt-1 text-sm">建议使用横向、正视角、空房或近空房照片</p>
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
              </label>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="overflow-hidden rounded-2xl border bg-slate-50">
                    <div className="flex items-center justify-between border-b bg-white px-4 py-3">
                      <div>
                        <p className="text-sm font-bold">原始现场图</p>
                        <p className="text-xs text-muted-foreground">结构参考图</p>
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs font-bold shadow-sm">
                        <Upload size={14} />
                        更换图片
                        <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
                      </label>
                    </div>
                    <img src={sourceImage} alt="现场图" className="mx-auto max-h-[560px] w-full object-contain" />
                  </div>

                  <div className="overflow-hidden rounded-2xl border bg-slate-50">
                    <div className="border-b bg-white px-4 py-3">
                      <p className="text-sm font-bold">本次渲染结果</p>
                      <p className="text-xs text-muted-foreground">先生成提示词，再进行渲染</p>
                    </div>
                    {generatedImage ? (
                      <img src={generatedImage} alt="软装效果图" className="mx-auto max-h-[560px] w-full object-contain" />
                    ) : (
                      <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 px-10 text-center text-muted-foreground">
                        <Sparkles size={32} />
                        <div>
                          <p className="font-bold text-foreground">还没有生成结果</p>
                          <p className="mt-1 text-sm">选择风格和家具后，系统会先生成提示词，再根据现场图出软装方案。</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          <aside className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-4">
              <div className="mb-3 text-xs font-bold text-muted-foreground">已选家具，最多可选 8 件</div>
              <div className="min-h-20 rounded-xl bg-slate-50 p-3">
                {selectedItems.length === 0 ? (
                  <div className="flex h-14 items-center justify-center text-sm text-muted-foreground">从下方图库选择家具类型</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {selectedItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleAsset(item.id)}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold text-white"
                      >
                        {item.name}
                        <X size={12} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategory(category.id)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-sm font-bold transition-colors',
                    selectedCategory === category.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-muted-foreground'
                  )}
                >
                  <category.icon size={14} />
                  {category.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {visibleAssets.map((asset) => {
                const Icon = asset.icon;
                const selected = selectedIds.includes(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => toggleAsset(asset.id)}
                    className={cn(
                      'relative overflow-hidden rounded-xl border p-2 text-left transition-all',
                      selected ? 'border-slate-900 ring-2 ring-slate-900/10' : 'border-slate-200 hover:border-slate-400'
                    )}
                  >
                    <div className={cn('mb-2 flex aspect-square items-center justify-center rounded-lg bg-gradient-to-br', asset.color)}>
                      <Icon size={26} className="text-slate-900/80" />
                    </div>
                    <div className="truncate text-xs font-bold">{asset.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{asset.subCategory}</div>
                    {selected && (
                      <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white">
                        <Check size={12} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-5">
              <div className="mb-2 text-sm font-bold">装修风格</div>
              <div className="grid grid-cols-2 gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => setSelectedStyle(preset.key)}
                    className={cn(
                      'rounded-xl border px-3 py-3 text-left text-sm font-bold transition-all',
                      selectedStyle === preset.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white'
                    )}
                  >
                    <div>{preset.name}</div>
                    <div className={cn('mt-1 text-[10px]', selectedStyle === preset.key ? 'text-white/70' : 'text-muted-foreground')}>
                      {preset.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
              <div className="mb-2 text-sm font-bold">当前生成策略</div>
              <p className="text-xs leading-6 text-muted-foreground">
                V2 会先调用 generate 接口生成提示词，例如“根据毛坯现场图生成法式复古风格，加上奶油转角沙发、低矮茶几，并保持户型结构不变”，再进行最终渲染。
              </p>
            </div>

            <div className="mt-5">
              <div className="mb-2 text-sm font-bold">生成尺寸</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setResolution('1k')}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-sm font-bold',
                    resolution === '1k' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200'
                  )}
                >
                  1k
                </button>
                <button
                  type="button"
                  onClick={() => setResolution('2k')}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-sm font-bold',
                    resolution === '2k' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200'
                  )}
                >
                  2k <span className="ml-1 text-[10px] text-rose-500">企业</span>
                </button>
              </div>
            </div>

            <div className="mt-7 grid grid-cols-2 gap-3">
              <Button variant="outline" className="h-12 rounded-xl font-bold" onClick={() => router.back()}>
                <ChevronLeft size={16} className="mr-2" />
                上一步
              </Button>
              <Button
                className="h-12 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-500"
                disabled={isRendering || !sourceImage || selectedItems.length === 0 || presets.length === 0}
                onClick={handleRender}
              >
                {isRendering ? <Loader2 size={18} className="mr-2 animate-spin" /> : <Sparkles size={18} className="mr-2" />}
                开始渲染
              </Button>
            </div>

            {history.length > 0 && (
              <div className="mt-7">
                <div className="mb-3 text-xs font-black uppercase tracking-[0.15em] text-muted-foreground">最近生成</div>
                <div className="grid grid-cols-3 gap-2">
                  {history.map((item) => (
                    <button
                      key={item._id}
                      type="button"
                      className="aspect-square overflow-hidden rounded-xl bg-slate-100"
                      onClick={() => router.push(`/ai-studio/floor-plan/${item._id}`)}
                    >
                      {item.output?.imageUrl ? (
                        <img src={item.output.imageUrl} className="h-full w-full object-cover" alt="" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageIcon size={16} className="text-muted-foreground" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
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
