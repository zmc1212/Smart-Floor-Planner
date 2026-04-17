'use client';

import React, { useState, useEffect } from 'react';
import Navbar from "@/components/Navbar";
import { Loader2, Plus, Trash2, Star, Eye } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function InspirationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    style: '现代简约',
    roomType: '客厅',
    coverImage: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=400&q=80',
    renderingImage: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=800&q=80',
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
    if (!formData.coverImage || formData.coverImage.startsWith('http')) {
      alert('请上传案例封面图 (Base64格式)');
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

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-16">
        <div className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <h2 className="text-[32px] font-semibold tracking-[-1.5px] leading-tight">
              装修灵感库
            </h2>
            {!loading && (
              <span className="bg-[#f5f5f5] text-[#666] px-3 py-1 rounded-full text-[14px] font-medium">
                {items.length} 个案例
              </span>
            )}
          </div>
          <button 
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-[#171717] text-white px-5 py-2.5 rounded-full text-[14px] font-medium hover:bg-black transition-all"
          >
            <Plus size={18} /> 新增灵感案例
          </button>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-[#808080]">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p className="text-[14px]">加载灵感库中...</p>
          </div>
        )}

        {!loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {items.map((item: any) => (
              <div key={item._id} className="group border border-gray-100 rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-300">
                <div className="aspect-square relative overflow-hidden bg-gray-100">
                  <img src={item.coverImage} alt={item.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                  {item.isRecommended && (
                    <div className="absolute top-3 left-3 bg-[#171717] text-white p-1.5 rounded-full">
                      <Star size={12} fill="white" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                    <button className="bg-white p-2 rounded-full hover:bg-gray-100"><Eye size={18} /></button>
                    <button onClick={() => deleteItem(item._id)} className="bg-white p-2 rounded-full hover:bg-red-50 text-red-600"><Trash2 size={18} /></button>
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-[15px] truncate flex-1">{item.title}</h3>
                    <span className="text-[11px] font-medium px-2 py-0.5 bg-gray-100 rounded text-gray-500">{item.viewCount} 阅</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[12px] text-gray-400">{item.style}</span>
                    <span className="text-[12px] text-gray-400">·</span>
                    <span className="text-[12px] text-gray-400">{item.roomType}</span>
                  </div>
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <div className="col-span-full py-24 text-center border-2 border-dashed border-gray-100 rounded-3xl text-gray-400">
                <p>暂无灵感案例，点击右上角开始添加</p>
              </div>
            )}
          </div>
        )}

        {/* Create Modal */}
        {showModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)} />
            <div className="bg-white w-full max-w-xl rounded-3xl shadow-2xl z-10 overflow-hidden animate-in fade-in zoom-in duration-200">
              <form onSubmit={handleCreate}>
                <div className="px-8 py-6 border-b border-gray-50">
                  <h3 className="text-xl font-bold">发布装修灵感案例</h3>
                </div>
                <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
                  <div className="space-y-2">
                    <label className="text-[13px] font-semibold text-gray-500">案例名称</label>
                    <input 
                      className="w-full px-4 py-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-black/5 transition-all"
                      placeholder="例如：极简原木风温馨客厅"
                      value={formData.title}
                      onChange={(e) => setFormData({...formData, title: e.target.value})}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[13px] font-semibold text-gray-500">空间类型</label>
                      <Select 
                        value={formData.roomType} 
                        onValueChange={(value) => value && setFormData({...formData, roomType: value})}
                      >
                        <SelectTrigger className="w-full h-[48px] px-4 bg-gray-50 rounded-xl outline-none border-none shadow-none focus:ring-2 focus:ring-black/5 text-[15px]">
                          <SelectValue placeholder="空间类型" />
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
                      <label className="text-[13px] font-semibold text-gray-500">设计风格</label>
                      <Select 
                        value={formData.style} 
                        onValueChange={(value) => value && setFormData({...formData, style: value})}
                      >
                        <SelectTrigger className="w-full h-[48px] px-4 bg-gray-50 rounded-xl outline-none border-none shadow-none focus:ring-2 focus:ring-black/5 text-[15px]">
                          <SelectValue placeholder="设计风格" />
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
                  
                  {/* File Uploads */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[13px] font-semibold text-gray-500">案例封面图 (建议小于 500KB)</label>
                      <div className="flex items-center gap-4">
                        <div className="w-20 h-20 rounded-xl bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                          {formData.coverImage ? (
                            <img src={formData.coverImage} className="w-full h-full object-cover" />
                          ) : (
                            <Plus className="text-gray-300" />
                          )}
                        </div>
                        <input 
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleFileChange(e, 'coverImage')}
                          className="text-[13px] file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-[13px] file:font-semibold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[13px] font-semibold text-gray-500">大图或效果图 (建议小于 500KB)</label>
                      <div className="flex items-center gap-4">
                        <div className="w-20 h-20 rounded-xl bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                          {formData.renderingImage ? (
                            <img src={formData.renderingImage} className="w-full h-full object-cover" />
                          ) : (
                            <Plus className="text-gray-300" />
                          )}
                        </div>
                        <input 
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleFileChange(e, 'renderingImage')}
                          className="text-[13px] file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-[13px] file:font-semibold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <input 
                      type="checkbox" 
                      id="recommended" 
                      checked={formData.isRecommended}
                      onChange={(e) => setFormData({...formData, isRecommended: e.target.checked})}
                      className="w-4 h-4 rounded border-gray-300 text-black focus:ring-black"
                    />
                    <label htmlFor="recommended" className="text-[14px] font-medium">设为首页精选推荐</label>
                  </div>
                </div>
                <div className="px-8 py-6 bg-gray-50 flex gap-4">
                  <button 
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 px-6 py-3 rounded-xl font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    取消
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-6 py-3 bg-[#171717] text-white rounded-xl font-semibold hover:bg-black transition-colors"
                  >
                    发布案例
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
