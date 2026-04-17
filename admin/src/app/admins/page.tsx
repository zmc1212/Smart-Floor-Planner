'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Shield, Search, Plus, RefreshCw, Edit2, Trash2, Check, X,
  ArrowLeft, KeyRound, Ban, CheckCircle, ChevronDown, ChevronUp,
} from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AdminUser {
  _id: string;
  username: string;
  displayName: string;
  role: 'super_admin' | 'admin' | 'viewer';
  menuPermissions: string[];
  effectivePermissions: string[];
  status: 'active' | 'disabled';
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '普通管理员',
  viewer: '只读审计员',
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-purple-100 text-purple-700 border-purple-200',
  admin: 'bg-blue-100 text-blue-700 border-blue-200',
  viewer: 'bg-gray-100 text-gray-600 border-gray-200',
};

const ALL_MENUS = [
  { key: 'dashboard', label: '总览' },
  { key: 'floorplans', label: '户型图' },
  { key: 'users', label: '用户列表' },
  { key: 'devices', label: '设备管理' },
  { key: 'admins', label: '管理员管理' },
];

export default function AdminsPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Add form
  const [adding, setAdding] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<string>('admin');

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState('admin');
  const [updating, setUpdating] = useState(false);

  // Expanded row for permissions
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editPermissions, setEditPermissions] = useState<string[]>([]);

  // Password reset
  const [resetPwdId, setResetPwdId] = useState<string | null>(null);
  const [resetPwdValue, setResetPwdValue] = useState('');

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin-users');
      const data = await res.json();
      if (data.success) setAdmins(data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
  }, []);

  const filteredAdmins = useMemo(() => {
    if (!searchTerm.trim()) return admins;
    const lower = searchTerm.toLowerCase();
    return admins.filter(
      (a) =>
        a.username.toLowerCase().includes(lower) ||
        a.displayName.toLowerCase().includes(lower)
    );
  }, [admins, searchTerm]);

  // --- Handlers ---

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          displayName: newDisplayName.trim(),
          role: newRole,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNewUsername('');
        setNewPassword('');
        setNewDisplayName('');
        setNewRole('admin');
        fetchAdmins();
      } else {
        alert(data.error || '添加失败');
      }
    } catch (err) {
      console.error(err);
      alert('请求失败');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string, username: string) => {
    if (!confirm(`确定删除管理员 "${username}" 吗？此操作不可恢复。`)) return;
    try {
      const res = await fetch(`/api/admin-users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setAdmins(admins.filter((a) => a._id !== id));
      } else {
        alert(data.error || '删除失败');
      }
    } catch (err) {
      console.error(err);
      alert('删除失败');
    }
  };

  const startEdit = (admin: AdminUser) => {
    setEditingId(admin._id);
    setEditDisplayName(admin.displayName);
    setEditRole(admin.role);
  };

  const handleUpdate = async (id: string) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/admin-users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: editDisplayName.trim(),
          role: editRole,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAdmins(admins.map((a) => (a._id === id ? { ...a, ...data.data } : a)));
        setEditingId(null);
        fetchAdmins(); // Refresh to get effectivePermissions
      } else {
        alert(data.error || '更新失败');
      }
    } catch (err) {
      console.error(err);
      alert('网络错误');
    } finally {
      setUpdating(false);
    }
  };

  const handleToggleStatus = async (admin: AdminUser) => {
    const newStatus = admin.status === 'active' ? 'disabled' : 'active';
    const action = newStatus === 'disabled' ? '禁用' : '启用';
    if (!confirm(`确定${action}管理员 "${admin.username}" 吗？`)) return;

    try {
      const res = await fetch(`/api/admin-users/${admin._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setAdmins(admins.map((a) => (a._id === admin._id ? { ...a, status: newStatus } : a)));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleResetPassword = async (id: string) => {
    if (!resetPwdValue || resetPwdValue.length < 6) {
      alert('密码长度不能少于6位');
      return;
    }
    try {
      const res = await fetch(`/api/admin-users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: resetPwdValue }),
      });
      const data = await res.json();
      if (data.success) {
        alert('密码已重置');
        setResetPwdId(null);
        setResetPwdValue('');
      } else {
        alert(data.error || '重置失败');
      }
    } catch (err) {
      console.error(err);
      alert('网络错误');
    }
  };

  const toggleExpand = (admin: AdminUser) => {
    if (expandedId === admin._id) {
      setExpandedId(null);
    } else {
      setExpandedId(admin._id);
      setEditPermissions(admin.menuPermissions.length > 0 ? [...admin.menuPermissions] : []);
    }
  };

  const togglePermission = (key: string) => {
    setEditPermissions((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const savePermissions = async (id: string) => {
    try {
      const res = await fetch(`/api/admin-users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menuPermissions: editPermissions }),
      });
      const data = await res.json();
      if (data.success) {
        fetchAdmins();
        setExpandedId(null);
      } else {
        alert(data.error || '保存失败');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const clearPermissionOverride = async (id: string) => {
    try {
      const res = await fetch(`/api/admin-users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menuPermissions: [] }),
      });
      const data = await res.json();
      if (data.success) {
        fetchAdmins();
        setEditPermissions([]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // --- Render ---

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="p-6 max-w-6xl mx-auto">
        <Link
          href="/"
          className="flex items-center gap-1 text-gray-500 hover:text-blue-600 transition-colors mb-6 w-fit"
        >
          <ArrowLeft size={16} />
          <span className="text-sm font-medium">返回首页</span>
        </Link>

        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="text-purple-600" />
              管理员管理
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              管理后台管理员账号，分配角色与菜单权限。
            </p>
          </div>
          <button
            onClick={fetchAdmins}
            className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
            title="刷新列表"
          >
            <RefreshCw
              size={20}
              className={loading ? 'animate-spin text-gray-400' : 'text-gray-600'}
            />
          </button>
        </div>

        {/* Search Bar */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6 flex flex-col md:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索用户名或显示名称..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none transition-all"
            />
          </div>
          <div className="text-sm text-gray-400">共 {filteredAdmins.length} 个管理员</div>
        </div>

        {/* Add Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
          <div className="p-4 bg-gray-50 border-b border-gray-100 font-semibold text-gray-700 flex items-center gap-2">
            <Plus size={18} /> 新增管理员
          </div>
          <form onSubmit={handleAdd} className="p-4 grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">用户名 (必填)</label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="login_name"
                className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">密码 (必填, ≥6位)</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••"
                className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                required
                minLength={6}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">显示名称</label>
              <input
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="张三"
                className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">角色</label>
              <Select value={newRole} onValueChange={(val) => val && setNewRole(val)}>
                <SelectTrigger className="w-full h-[38px] p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none bg-white border-solid shadow-none">
                  <SelectValue placeholder="选择角色" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="super_admin">超级管理员</SelectItem>
                  <SelectItem value="admin">普通管理员</SelectItem>
                  <SelectItem value="viewer">只读审计员</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <button
              type="submit"
              disabled={adding || !newUsername.trim() || !newPassword.trim()}
              className="px-6 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors h-[38px]"
            >
              {adding ? '添加中...' : '添加管理员'}
            </button>
          </form>
        </div>

        {/* Admin List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {loading && admins.length === 0 ? (
            <div className="p-8 text-center text-gray-400">加载中...</div>
          ) : admins.length === 0 ? (
            <div className="p-8 text-center text-gray-400">暂无管理员，请在上方添加</div>
          ) : filteredAdmins.length === 0 ? (
            <div className="p-8 text-center text-gray-400">未找到匹配的管理员</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-6 py-3 font-medium">用户名</th>
                    <th className="px-6 py-3 font-medium">显示名称</th>
                    <th className="px-6 py-3 font-medium">角色</th>
                    <th className="px-6 py-3 font-medium">状态</th>
                    <th className="px-6 py-3 font-medium">创建时间</th>
                    <th className="px-6 py-3 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredAdmins.map((admin) => (
                    <React.Fragment key={admin._id}>
                      <tr className={`hover:bg-gray-50/50 ${admin.status === 'disabled' ? 'opacity-50' : ''}`}>
                        {/* Username */}
                        <td className="px-6 py-4 font-mono font-medium text-gray-900">
                          {admin.username}
                        </td>

                        {/* Display Name */}
                        <td className="px-6 py-4 text-gray-600">
                          {editingId === admin._id ? (
                            <input
                              type="text"
                              value={editDisplayName}
                              onChange={(e) => setEditDisplayName(e.target.value)}
                              className="w-full p-1 border border-purple-500 rounded text-sm"
                              autoFocus
                            />
                          ) : (
                            admin.displayName || '-'
                          )}
                        </td>

                        {/* Role */}
                        <td className="px-6 py-4">
                          {editingId === admin._id ? (
                            <Select value={editRole} onValueChange={(val) => val && setEditRole(val)}>
                              <SelectTrigger className="h-[30px] p-1 px-2 border border-purple-500 rounded text-sm bg-white shadow-none">
                                <SelectValue placeholder="选择角色" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="super_admin">超级管理员</SelectItem>
                                <SelectItem value="admin">普通管理员</SelectItem>
                                <SelectItem value="viewer">只读审计员</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <span
                              className={`text-xs px-2 py-1 rounded-full border font-medium ${ROLE_COLORS[admin.role] || 'bg-gray-100 text-gray-600'}`}
                            >
                              {ROLE_LABELS[admin.role] || admin.role}
                            </span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-6 py-4">
                          {admin.status === 'active' ? (
                            <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-medium">
                              正常
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-600 font-medium">
                              已禁用
                            </span>
                          )}
                        </td>

                        {/* Created */}
                        <td className="px-6 py-4 text-gray-400">
                          {new Date(admin.createdAt).toLocaleString('zh-CN')}
                        </td>

                        {/* Actions */}
                        <td className="px-6 py-4 text-right">
                          {editingId === admin._id ? (
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => handleUpdate(admin._id)}
                                disabled={updating}
                                className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                title="保存"
                              >
                                <Check size={18} />
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
                                title="取消"
                              >
                                <X size={18} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => toggleExpand(admin)}
                                className="p-2 text-purple-500 hover:bg-purple-50 rounded-lg transition-colors"
                                title="菜单权限"
                              >
                                {expandedId === admin._id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                              </button>
                              <button
                                onClick={() => startEdit(admin)}
                                className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                                title="编辑"
                              >
                                <Edit2 size={18} />
                              </button>
                              <button
                                onClick={() => {
                                  setResetPwdId(resetPwdId === admin._id ? null : admin._id);
                                  setResetPwdValue('');
                                }}
                                className="p-2 text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                                title="重置密码"
                              >
                                <KeyRound size={18} />
                              </button>
                              <button
                                onClick={() => handleToggleStatus(admin)}
                                className={`p-2 rounded-lg transition-colors ${admin.status === 'active' ? 'text-orange-500 hover:bg-orange-50' : 'text-green-500 hover:bg-green-50'}`}
                                title={admin.status === 'active' ? '禁用' : '启用'}
                              >
                                {admin.status === 'active' ? <Ban size={18} /> : <CheckCircle size={18} />}
                              </button>
                              <button
                                onClick={() => handleDelete(admin._id, admin.username)}
                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="删除"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>

                      {/* Password Reset Row */}
                      {resetPwdId === admin._id && (
                        <tr className="bg-amber-50/50">
                          <td colSpan={6} className="px-6 py-3">
                            <div className="flex items-center gap-3">
                              <KeyRound size={16} className="text-amber-500" />
                              <span className="text-sm text-gray-600">为 <b>{admin.username}</b> 重置密码：</span>
                              <input
                                type="password"
                                value={resetPwdValue}
                                onChange={(e) => setResetPwdValue(e.target.value)}
                                placeholder="请输入新密码 (≥6位)"
                                className="p-1.5 border border-amber-300 rounded text-sm flex-1 max-w-xs focus:ring-2 focus:ring-amber-500 outline-none"
                              />
                              <button
                                onClick={() => handleResetPassword(admin._id)}
                                className="px-3 py-1.5 bg-amber-500 text-white text-sm rounded hover:bg-amber-600 transition-colors"
                              >
                                确认重置
                              </button>
                              <button
                                onClick={() => { setResetPwdId(null); setResetPwdValue(''); }}
                                className="px-3 py-1.5 bg-gray-100 text-gray-600 text-sm rounded hover:bg-gray-200 transition-colors"
                              >
                                取消
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Permissions Expanded Row */}
                      {expandedId === admin._id && (
                        <tr className="bg-purple-50/30">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-gray-700">
                                  菜单权限配置
                                  {admin.menuPermissions.length > 0 && (
                                    <span className="ml-2 text-xs text-purple-500 font-normal">(已自定义)</span>
                                  )}
                                </h4>
                                <div className="flex gap-2">
                                  {admin.menuPermissions.length > 0 && (
                                    <button
                                      onClick={() => clearPermissionOverride(admin._id)}
                                      className="text-xs px-3 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                                    >
                                      恢复角色默认
                                    </button>
                                  )}
                                  <button
                                    onClick={() => savePermissions(admin._id)}
                                    className="text-xs px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
                                  >
                                    保存权限
                                  </button>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {ALL_MENUS.map((menu) => {
                                  const isActive = editPermissions.length > 0
                                    ? editPermissions.includes(menu.key)
                                    : admin.effectivePermissions.includes(menu.key);
                                  return (
                                    <button
                                      key={menu.key}
                                      onClick={() => {
                                        if (editPermissions.length === 0) {
                                          // Initialize from effective
                                          setEditPermissions(
                                            admin.effectivePermissions.includes(menu.key)
                                              ? admin.effectivePermissions.filter((k) => k !== menu.key)
                                              : [...admin.effectivePermissions, menu.key]
                                          );
                                        } else {
                                          togglePermission(menu.key);
                                        }
                                      }}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                                        isActive
                                          ? 'bg-purple-100 text-purple-700 border-purple-300'
                                          : 'bg-gray-50 text-gray-400 border-gray-200'
                                      }`}
                                    >
                                      {menu.label}
                                    </button>
                                  );
                                })}
                              </div>
                              <p className="text-xs text-gray-400">
                                角色 "{ROLE_LABELS[admin.role]}" 的默认权限会在未自定义时生效。点击菜单项可自定义覆盖。
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
