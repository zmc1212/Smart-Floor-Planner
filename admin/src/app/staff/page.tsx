'use client';

import React, { useState, useEffect } from 'react';
import Navbar from "@/components/Navbar";
import { Loader2, User, Plus, X, Shield, Pencil, Trash2, Smartphone } from "lucide-react";

export default function StaffPage() {
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    displayName: '',
    phone: '',
    role: 'designer',
    enterpriseId: ''
  });

  const fetchCurrentUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.success) setCurrentUser(data.data);
    } catch (err) {
      console.error('Auth error:', err);
    }
  };

  const fetchStaff = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff');
      const data = await res.json();
      if (data.success) {
        setStaff(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch staff:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
    fetchStaff();
  }, []);

  const resetForm = () => {
    setFormData({ username: '', password: '', displayName: '', phone: '', role: 'designer', enterpriseId: '' });
    setIsEditMode(false);
    setEditingId(null);
  };

  const handleOpenCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const handleEditClick = (member: any) => {
    setFormData({
      username: member.username,
      password: '', // Password field blank for editing unless changing
      displayName: member.displayName || '',
      phone: member.phone || '',
      role: member.role,
      enterpriseId: member.enterpriseId || ''
    });
    setEditingId(member._id);
    setIsEditMode(true);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该员工账号吗？此操作不可撤销。')) return;
    
    try {
      const res = await fetch(`/api/staff/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        fetchStaff();
      } else {
        alert(data.error);
      }
    } catch (err: any) {
      alert('删除失败: ' + err.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    const url = isEditMode ? `/api/staff/${editingId}` : '/api/staff';
    const method = isEditMode ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (data.success) {
        setIsModalOpen(false);
        resetForm();
        fetchStaff();
      } else {
        alert(data.error);
      }
    } catch (err: any) {
      alert((isEditMode ? '保存失败: ' : '创建失败: ') + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: any = {
      enterprise_admin: '公司负责人',
      designer: '设计师',
      salesperson: '销售顾问',
      super_admin: '超级管理员'
    };
    return labels[role] || role;
  };

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-16">
        <div className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <h2 className="text-[32px] font-semibold tracking-[-1.5px] leading-tight">
              员工与账号管理
            </h2>
            {!loading && (
              <span className="bg-[#f5f5f5] text-[#666] px-3 py-1 rounded-full text-[14px] font-medium">
                {staff.length} 名成员
              </span>
            )}
          </div>
          {(currentUser?.role === 'super_admin' || currentUser?.role === 'enterprise_admin' || currentUser?.role === 'admin') && (
            <button 
              onClick={handleOpenCreateModal}
              className="px-6 py-2.5 bg-[#171717] text-white rounded-full text-[14px] font-medium hover:bg-black transition-all flex items-center gap-2"
            >
              <Plus size={18} /> 新增员工
            </button>
          )}
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-[#808080]">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p className="text-[14px]">正在加载团队成员...</p>
          </div>
        )}

        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {staff.map((member: any) => (
              <div key={member._id} className="group relative bg-white p-6 rounded-3xl shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08),0px_2px_4px_rgba(0,0,0,0.02)] hover:shadow-xl transition-all border border-transparent hover:border-gray-100">
                <div className="flex items-start justify-between mb-6">
                  <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-lg font-bold text-gray-400 group-hover:bg-[#171717] group-hover:text-white transition-colors">
                    {member.displayName?.[0] || member.username[0].toUpperCase()}
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                    member.role === 'enterprise_admin' ? 'bg-purple-50 text-purple-600' : 
                    member.role === 'designer' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'
                  }`}>
                    {getRoleLabel(member.role)}
                  </div>
                </div>

                <div className="space-y-1 mb-6">
                  <h3 className="text-[18px] font-bold text-gray-900">{member.displayName || member.username}</h3>
                  <p className="text-[13px] text-gray-400 font-medium">@{member.username}</p>
                </div>

                <div className="space-y-3 pt-6 border-t border-gray-50">
                  <div className="flex items-center gap-2 text-[13px] text-gray-500">
                    <Smartphone size={14} className="text-gray-300" />
                    <span>{member.phone || '未绑定手机'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[13px] text-gray-500">
                    <Shield size={14} className="text-gray-300" />
                    <span className="truncate">{member.openid ? '已绑定微信' : '未绑定微信'}</span>
                  </div>
                </div>

                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-all flex gap-1">
                   <button 
                    onClick={() => handleEditClick(member)}
                    className="p-2 bg-white shadow-lg rounded-full text-gray-400 hover:text-black hover:scale-110 transition-all"
                   >
                     <Pencil size={14}/>
                   </button>
                   <button 
                    onClick={() => handleDelete(member._id)}
                    className="p-2 bg-white shadow-lg rounded-full text-gray-400 hover:text-red-600 hover:scale-110 transition-all"
                   >
                    <Trash2 size={14}/>
                   </button>
                </div>
              </div>
            ))}
            {staff.length === 0 && (
              <div className="col-span-full py-24 text-center text-gray-400 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                暂无员工数据
              </div>
            )}
          </div>
        )}

        {/* Create Staff Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
            <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-lg font-bold">{isEditMode ? '编辑员工信息' : '新增员工'}</h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-gray-400 uppercase">登陆账号</label>
                  <input 
                    required
                    disabled={isEditMode}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-black/5 disabled:opacity-50"
                    placeholder="例如: designer_zhang"
                    value={formData.username}
                    onChange={(e) => setFormData({...formData, username: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-gray-400 uppercase">{isEditMode ? '修改密码 (留空则不修改)' : '登录密码'}</label>
                  <input 
                    required={!isEditMode}
                    type="password"
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-black/5"
                    placeholder={isEditMode ? "不少于6位" : "不少于6位"}
                    value={formData.password}
                    onChange={(e) => setFormData({...formData, password: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-gray-400 uppercase">姓名/昵称</label>
                  <input 
                    required
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-black/5"
                    placeholder="显示名称"
                    value={formData.displayName}
                    onChange={(e) => setFormData({...formData, displayName: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-gray-400 uppercase">联系电话 (用于手机登录)</label>
                  <input 
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-black/5"
                    placeholder="11位手机号"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-gray-400 uppercase">员工角色</label>
                  <select 
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-black/5"
                    value={formData.role}
                    onChange={(e) => setFormData({...formData, role: e.target.value})}
                  >
                    <option value="designer">设计师</option>
                    <option value="salesperson">销售顾问</option>
                    {currentUser?.role === 'super_admin' && <option value="enterprise_admin">公司负责人</option>}
                  </select>
                </div>

                <div className="pt-4">
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3 bg-[#171717] text-white font-bold rounded-xl hover:bg-black disabled:opacity-50 transition-all"
                  >
                    {isSubmitting ? '正在处理...' : (isEditMode ? '保 存 修 改' : '确 认 创 建')}
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
