'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { 
  Loader2, 
  Sparkles, 
  Download, 
  Image as ImageIcon, 
  Clock, 
  ChevronLeft, 
  Map, 
  RefreshCw, 
  ExternalLink,
  Info,
  Calendar,
  Cpu,
  Type,
  Share2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const FLOOR_PLAN_STYLES: Record<string, any> = {
  'colorful': { label: '彩色风格', emoji: '🎨', gradient: 'from-pink-400 to-blue-400' },
  'cad': { label: 'CAD风格', emoji: '📐', gradient: 'from-zinc-700 to-zinc-400' },
  '3d': { label: '3D风格', emoji: '🏗️', gradient: 'from-cyan-400 to-indigo-500' },
  'handdrawn': { label: '手绘风格', emoji: '✏️', gradient: 'from-amber-300 to-rose-300' },
};

export default function GenerationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/ai/status/${id}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        if (json.data.status !== 'processing' && json.data.status !== 'pending') {
          setLoading(false);
        }
      } else {
        setError(json.error);
        setLoading(false);
      }
    } catch (err) {
      setError('网络连接失败');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    
    // 如果状态是进行中，开启轮询
    let interval: any;
    if (data?.status === 'processing' || data?.status === 'pending') {
      interval = setInterval(fetchStatus, 3000);
    }
    
    return () => clearInterval(interval);
  }, [id, data?.status]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="animate-spin text-purple-500" size={40} />
        <p className="text-muted-foreground font-medium">加载方案详情...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center text-red-500">
          <Info size={32} />
        </div>
        <p className="text-lg font-bold">{error}</p>
        <Button variant="outline" onClick={() => router.back()}>返回列表</Button>
      </div>
    );
  }

  const styleInfo = FLOOR_PLAN_STYLES[data.input?.style] || { label: data.input?.style || '未知风格', emoji: '✨', gradient: 'from-zinc-500 to-zinc-400' };

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <main className="max-w-6xl mx-auto px-6 py-8">
        
        {/* Header / Nav */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => router.back()}
              className="rounded-xl hover:bg-muted"
            >
              <ChevronLeft size={24} />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">方案详情</h1>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="rounded-md font-medium">ID: {id.slice(-6).toUpperCase()}</Badge>
                {data.status === 'succeeded' && <Badge className="bg-green-100 text-green-700 border-none font-bold uppercase text-[10px]">已完成</Badge>}
                {data.status === 'failed' && <Badge className="bg-red-100 text-red-700 border-none font-bold uppercase text-[10px]">生成失败</Badge>}
                {(data.status === 'processing' || data.status === 'pending') && (
                  <Badge className="bg-blue-100 text-blue-700 border-none font-bold uppercase text-[10px] animate-pulse">渲染中 {data.progress}%</Badge>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {data.status === 'succeeded' && (
              <>
                <Button variant="outline" className="rounded-xl font-bold gap-2" onClick={() => window.open(data.imageUrl, '_blank')}>
                  <ExternalLink size={16} /> 查看原图
                </Button>
                <Button className="rounded-xl font-bold bg-black text-white hover:bg-zinc-800 gap-2" onClick={() => {
                   const a = document.createElement('a');
                   a.href = data.imageUrl;
                   a.download = `AI_FloorPlan_${id}.png`;
                   a.click();
                }}>
                  <Download size={16} /> 下载
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Visual Content */}
          <div className="lg:col-span-2">
            <div className="relative bg-muted/10 border border-muted rounded-[32px] overflow-hidden aspect-square lg:aspect-[4/3] flex items-center justify-center group shadow-sm">
              {data.status === 'succeeded' ? (
                <img 
                  src={data.imageUrl} 
                  alt="Generated Floor Plan" 
                  className="w-full h-full object-contain"
                />
              ) : data.status === 'failed' ? (
                <div className="text-center p-12">
                  <div className="w-20 h-20 bg-red-50 text-red-500 rounded-3xl flex items-center justify-center mx-auto mb-4">
                    <Info size={40} />
                  </div>
                  <h2 className="text-xl font-bold mb-2">生成失败</h2>
                  <p className="text-muted-foreground mb-6 max-w-md">{data.error || 'AI 服务响应异常，请尝试重新生成'}</p>
                  <Button variant="outline" className="rounded-xl font-bold" onClick={() => router.push('/ai-studio/floor-plan')}>
                    返回重新生成
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-6">
                  <div className="relative">
                    <div className="w-24 h-24 rounded-full bg-purple-50 flex items-center justify-center">
                      <RefreshCw className="text-purple-500 animate-spin" size={40} />
                    </div>
                    <div className="absolute inset-0 rounded-full border-2 border-purple-200 animate-ping opacity-30" />
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-xl font-bold">AI 正在深度渲染中...</p>
                    <div className="flex flex-col items-center gap-1.5 min-w-[240px]">
                      <div className="flex justify-between w-full text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        <span>Status</span>
                        <span>{data.progress}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-purple-500 transition-all duration-1000 ease-out" 
                          style={{ width: `${Math.max(data.progress || 5, 5)}%` }}
                        />
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-4">1k 分辨率模式 · 约耗时 30-60 秒</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Metadata Sidebar */}
          <div className="space-y-6">
            
            {/* Style Card */}
            <Card className="rounded-[24px] border-none bg-muted/20 shadow-none overflow-hidden">
              <div className={cn("h-2 bg-gradient-to-r", styleInfo.gradient)} />
              <CardContent className="p-6">
                <h3 className="text-xs font-black uppercase tracking-[0.15em] text-muted-foreground mb-4 flex items-center gap-2">
                  <Sparkles size={12} className="text-purple-500" /> 风格配置
                </h3>
                <div className="flex items-center gap-3">
                  <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center text-2xl bg-gradient-to-br", styleInfo.gradient)}>
                    {styleInfo.emoji}
                  </div>
                  <div>
                    <p className="font-bold text-lg">{styleInfo.label}</p>
                    <p className="text-xs text-muted-foreground">AI 室内平面生图模式</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Info List */}
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-[0.15em] text-muted-foreground px-1">任务元数据</h3>
              
              <div className="grid grid-cols-1 gap-3">
                <div className="flex items-center gap-3 p-4 rounded-2xl bg-muted/10 border border-muted/20">
                  <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-muted-foreground">
                    <Map size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">关联户型</p>
                    <p className="text-sm font-bold truncate">{data.input?.roomName || '未命名户型'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 rounded-2xl bg-muted/10 border border-muted/20">
                  <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-muted-foreground">
                    <Calendar size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">生成时间</p>
                    <p className="text-sm font-bold">{new Date(data.createdAt).toLocaleString('zh-CN')}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 rounded-2xl bg-muted/10 border border-muted/20">
                  <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-muted-foreground">
                    <Cpu size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">计算引擎</p>
                    <p className="text-sm font-bold uppercase">{data.provider || 'AI Cluster'}</p>
                  </div>
                </div>

                {data.duration && (
                  <div className="flex items-center gap-3 p-4 rounded-2xl bg-muted/10 border border-muted/20">
                    <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-muted-foreground">
                      <Clock size={18} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">渲染耗时</p>
                      <p className="text-sm font-bold">{(data.duration / 1000).toFixed(1)}s</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Prompt Section */}
            {data.input?.customPrompt && (
              <div className="space-y-4 pt-2">
                <h3 className="text-xs font-black uppercase tracking-[0.15em] text-muted-foreground px-1 flex items-center gap-2">
                   <Type size={12} /> AI 提示词
                </h3>
                <div className="p-4 rounded-2xl bg-zinc-900 text-zinc-400 text-xs font-mono leading-relaxed break-words">
                  {data.input.customPrompt}
                </div>
              </div>
            )}

            {/* Actions Footer */}
            <div className="pt-4 flex flex-col gap-3">
              <Button 
                className="w-full h-12 rounded-xl font-bold bg-purple-600 hover:bg-purple-700 text-white gap-2"
                onClick={() => alert('已生成分享海报链接并复制到剪贴板')}
              >
                <Share2 size={18} /> 分享方案
              </Button>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
