'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, Plus, Trash2, Star, Eye, Search, Image as ImageIcon, Sparkles } from "lucide-react";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import Link from 'next/link';

export default function InspirationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    style: '现代简约',
    roomType: '客厅',
    coverImage: '',
    renderingImage: '',
    layoutData: [{ id: 'room-1', name: '复刻空间', width: 400, height: 300, openings: [] }],
    isRecommended: false
  });

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/inspirations');
      const data = await res.json();
      if (data.success) {
        setItems(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch inspirations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, field: 'coverImage' | 'renderingImage') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 500 * 1024) {
      alert('图片体积超过 500KB 限制，请先压缩图片后再上传。');
      e.target.value = '';
      return;
    }

    try {
      const base64 = await fileToBase64(file);
      setFormData({ ...formData, [field]: base64 });
    } catch (err) {
      console.error('File conversion error:', err);
      alert('图片读取失败');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.coverImage) {
      alert('请上传案例封面图');
      return;
    }

    try {
      const res = await fetch('/api/inspirations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        setFormData({
          title: '',
          style: '现代简约',
          roomType: '客厅',
          coverImage: '',
          renderingImage: '',
          layoutData: [{ id: 'room-1', name: '复刻空间', width: 400, height: 300, openings: [] }],
          isRecommended: false
        });
        fetchItems();
      }
    } catch (err) {
      console.error('Failed to create inspiration:', err);
    }
  };

  const deleteItem = async (id: string) => {
    if (!confirm('确定删除此案例吗？')) return;
    try {
      const res = await fetch(`/api/inspirations?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) fetchItems();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const renderInspirationForm = () => (
    <form onSubmit={handleCreate}>
      <DialogHeader className="p-10 pb-6 border-b bg-muted/20">
        <DialogTitle className="text-2xl font-bold">发布新设计案例</DialogTitle>
        <DialogDescription>
          上传精美渲染图，为 AI 辅助扩图提供更高质量的学习素材
        </DialogDescription>
      </DialogHeader>

      <div className="p-10 space-y-8 max-h-[60vh] overflow-y-auto">
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">案例标题 (必填)</Label>
          <Input 
            required
            className="h-12 rounded-2xl bg-muted/30 border-none focus-visible:ring-primary font-medium"
            placeholder="例如：极简原木风温馨客厅"
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
          />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">空间类型</Label>
            <Select 
              value={formData.roomType} 
              onValueChange={(val) => val && setFormData({...formData, roomType: val})}
            >
              <SelectTrigger className="h-12 rounded-2xl bg-muted/30 border-none focus-visible:ring-primary font-medium shadow-none">
                <SelectValue placeholder="选择空间" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="客厅">客厅</SelectItem>
                <SelectItem value="主卧">主卧</SelectItem>
                <SelectItem value="厨房">厨房</SelectItem>
                <SelectItem value="卫生间">卫生间</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">设计风格</Label>
            <Select 
              value={formData.style} 
              onValueChange={(val) => val && setFormData({...formData, style: val})}
            >
              <SelectTrigger className="h-12 rounded-2xl bg-muted/30 border-none focus-visible:ring-primary font-medium shadow-none">
                <SelectValue placeholder="选择风格" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="现代简约">现代简约</SelectItem>
                <SelectItem value="侘寂风">侘寂风</SelectItem>
                <SelectItem value="原木风">原木风</SelectItem>
                <SelectItem value="轻法式奶油">轻法式奶油</SelectItem>
                <SelectItem value="精致轻奢">精致轻奢</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="space-y-6">
          <div className="space-y-3">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">展示封面 (建议 1:1 或 4:5)</Label>
            <div className="flex items-center gap-6 p-4 bg-muted/20 rounded-[24px] border border-dashed border-muted">
              <div className="w-24 h-24 rounded-2xl bg-white border border-muted flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                {formData.coverImage ? (
                  <img src={formData.coverImage} className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="text-muted-foreground/30" size={32} />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <Input 
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleFileChange(e, 'coverImage')}
                  className="bg-transparent border-none shadow-none text-xs h-auto p-0 file:bg-primary file:text-primary-foreground file:border-none file:rounded-full file:px-4 file:py-2 file:mr-4 file:cursor-pointer"
                />
                <p className="text-[10px] text-muted-foreground leading-relaxed">体积需小于 500KB，建议进行 WebP 压缩后再上传。</p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">渲染透视图/效果全图</Label>
            <div className="flex items-center gap-6 p-4 bg-muted/20 rounded-[24px] border border-dashed border-muted">
              <div className="w-24 h-24 rounded-2xl bg-white border border-muted flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                {formData.renderingImage ? (
                  <img src={formData.renderingImage} className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="text-muted-foreground/30" size={32} />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <Input 
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleFileChange(e, 'renderingImage')}
                  className="bg-transparent border-none shadow-none text-xs h-auto p-0 file:bg-primary file:text-primary-foreground file:border-none file:rounded-full file:px-4 file:py-2 file:mr-4 file:cursor-pointer"
                />
                <p className="text-[10px] text-muted-foreground leading-relaxed">提供给 AI 模型深度学习，要求构图精美、细节丰富。</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 bg-primary/5 rounded-2xl border border-primary/10">
          <input 
            type="checkbox" 
            id="recommended" 
            checked={formData.isRecommended}
            onChange={(e) => setFormData({...formData, isRecommended: e.target.checked})}
            className="w-5 h-5 rounded-[6px] border-muted text-primary focus:ring-primary h-5 w-5"
          />
          <Label htmlFor="recommended" className="text-sm font-bold cursor-pointer">设为首页“精选推荐”案例</Label>
        </div>
      </div>

      <DialogFooter className="p-10 pt-4 bg-muted/30 border-t">
        <Button 
          type="button" 
          variant="ghost" 
          className="h-12 rounded-2xl px-8 bg-background hover:bg-muted" 
          onClick={() => setShowModal(false)}
        >
          取消
        </Button>
        <Button 
          type="submit" 
          className="h-12 rounded-2xl px-12 font-bold shadow-lg shadow-primary/10"
        >
          确认发布
        </Button>
      </DialogFooter>
    </form>
  );

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <main className="max-w-7xl mx-auto px-6 py-12">

        <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-1">
            <h2 className="text-[32px] font-bold tracking-tight">
              AI 装修灵感库
            </h2>
            <p className="text-muted-foreground text-sm flex items-center gap-2">
               <Sparkles size={14} className="text-primary" /> 精选室内设计案例，为 AI 扩图提供美学深度
            </p>
          </div>

          <div className="flex items-center gap-3">
             {!loading && (
               <Badge variant="outline" className="h-11 rounded-full px-6 font-bold text-muted-foreground border-muted">
                 {items.length} 个设计灵感
               </Badge>
             )}
            <Dialog open={showModal} onOpenChange={setShowModal}>
              <DialogTrigger asChild>
                <Button className="h-11 rounded-full px-8 font-bold shadow-lg shadow-primary/20">
                  <Plus size={18} className="mr-2" /> 发布新设计
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl p-0 overflow-hidden rounded-[32px] shadow-2xl border-none">
                {renderInspirationForm()}
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 text-muted-foreground">
            <Loader2 className="animate-spin mb-4" size={48} />
            <p className="text-sm font-medium">唤醒设计美学库...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {items.map((item: any) => (
              <div key={item._id} className="group bg-white border border-muted rounded-[32px] overflow-hidden hover:shadow-2xl hover:shadow-primary/5 hover:border-primary/20 transition-all duration-500 flex flex-col">
                <div className="aspect-[4/5] relative overflow-hidden bg-muted">
                  <img src={item.coverImage} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent h-2/3 opacity-40 group-hover:opacity-60 transition-opacity" />
                  
                  {item.isRecommended && (
                    <div className="absolute top-4 left-4 bg-primary text-primary-foreground p-2 rounded-[14px] shadow-lg">
                      <Star size={14} fill="currentColor" />
                    </div>
                  )}

                  <div className="absolute inset-0 flex items-center justify-center gap-3 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
                    <Button size="icon" variant="secondary" className="h-12 w-12 rounded-full shadow-xl hover:scale-110">
                       <Eye size={20} />
                    </Button>
                    <Button onClick={() => deleteItem(item._id)} size="icon" variant="secondary" className="h-12 w-12 rounded-full shadow-xl hover:scale-110 text-destructive">
                       <Trash2 size={20} />
                    </Button>
                  </div>

                  <div className="absolute bottom-6 left-6 right-6 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500">
                     <p className="text-white text-[11px] font-bold uppercase tracking-widest opacity-80 mb-1">{item.style}</p>
                     <h3 className="text-white font-bold text-lg leading-tight truncate">{item.title}</h3>
                  </div>
                </div>
                <div className="p-6">
                  <div className="flex justify-between items-center">
                    <div className="flex gap-2">
                       <Badge variant="secondary" className="bg-muted text-muted-foreground border-none font-bold text-[10px] uppercase">{item.roomType}</Badge>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground/60">
                       <Eye size={12} />
                       <span>{item.viewCount || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <div className="col-span-full py-32 text-center text-muted-foreground bg-muted/20 rounded-[40px] border-4 border-dashed border-muted/50">
                <div className="bg-muted w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                   <ImageIcon size={32} className="opacity-20" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-1">设计库暂无收录</h3>
                <p>点击上方按钮发布您的第一个 AI 设计案例</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
