'use client';

import React, { useState } from 'react';
import { Loader2, CheckCircle2, Building2, User, Phone, ArrowLeft } from 'lucide-react';

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    contactPerson: { name: '', phone: '', email: '' }
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register-enterprise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (data.success) {
        setIsSuccess(true);
      } else {
        setError(data.error || '提交失败，请检查填写资料');
      }
    } catch (err) {
      setError('网络请求失败，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-6 animate-in zoom-in duration-500">
          <CheckCircle2 size={48} className="text-green-500" />
        </div>
        <h1 className="text-2xl font-bold mb-3 tracking-tight">提交成功</h1>
        <p className="text-gray-500 max-w-xs mb-8 text-[15px] leading-relaxed">
          您的申请资料已进入审核队列。我们将会在 1-2 个工作日内进行核实并以短信形式通知您。
        </p>
        <button 
          onClick={() => window.location.reload()}
          className="px-8 py-3 bg-black text-white rounded-2xl font-bold text-[15px] shadow-lg shadow-black/10 transition-all active:scale-95"
        >
          返回
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-[#171717]">
      {/* Header */}
      <div className="p-6 flex items-center gap-4">
        <button onClick={() => window.history.back()} className="p-2 hover:bg-gray-50 rounded-full">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">加入企业服务</h1>
      </div>

      <main className="max-w-md mx-auto px-6 pb-20">
        <div className="mb-10 text-center">
          <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 size={32} className="text-gray-400" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">企业入驻申请</h2>
          <p className="text-gray-400 text-sm mt-1">请填写详细资料，开启智能测绘之旅</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-2xl text-[14px] font-medium animate-in fade-in slide-in-from-top-2">
              {error}
            </div>
          )}

          <section className="space-y-4">
            <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-widest px-1">企业资料</h3>
            <div className="space-y-3">
              <div className="relative">
                <input 
                  required
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full h-14 pl-4 pr-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all placeholder:text-gray-300 font-medium"
                  placeholder="企业全称"
                />
              </div>
              <div className="relative">
                <input 
                  required
                  value={formData.code}
                  onChange={e => setFormData({...formData, code: e.target.value})}
                  className="w-full h-14 pl-4 pr-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all placeholder:text-gray-300 font-mono"
                  placeholder="统一社会信用代码 (18位)"
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-widest px-1">联系人信息</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input 
                  required
                  value={formData.contactPerson.name}
                  onChange={e => setFormData({...formData, contactPerson: {...formData.contactPerson, name: e.target.value}})}
                  className="w-full h-14 px-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all font-medium"
                  placeholder="姓名"
                />
                <input 
                  required
                  type="tel"
                  value={formData.contactPerson.phone}
                  onChange={e => setFormData({...formData, contactPerson: {...formData.contactPerson, phone: e.target.value}})}
                  className="w-full h-14 px-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all font-medium"
                  placeholder="手机号"
                />
              </div>
              <input 
                type="email"
                value={formData.contactPerson.email}
                onChange={e => setFormData({...formData, contactPerson: {...formData.contactPerson, email: e.target.value}})}
                className="w-full h-14 px-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all font-medium"
                placeholder="初建账号绑定的邮箱 (可选)"
              />
            </div>
          </section>

          <div className="pt-6">
            <button 
              type="submit"
              disabled={isSubmitting}
              className="w-full h-14 bg-[#171717] text-white font-bold rounded-2xl hover:bg-black disabled:opacity-50 transition-all shadow-xl shadow-black/10 flex items-center justify-center gap-2 active:scale-95"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : '提交申请'}
            </button>
            <p className="text-center text-[12px] text-gray-400 mt-6 leading-relaxed">
              点击提交即表示您同意我们的 <span className="text-black font-medium underline">《服务协议》</span> 和 <span className="text-black font-medium underline">《隐私政策》</span>
            </p>
          </div>
        </form>
      </main>
    </div>
  );
}
