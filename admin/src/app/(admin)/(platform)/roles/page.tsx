'use client';

import { notify } from '@/components/ui/operation-feedback';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import {
  Shield, 
  Settings2, 
  RefreshCw, 
  Save, 
  Check, 
  ChevronRight,
  Lock,
  LayoutDashboard,
  Users,
  Map,
  Smartphone,
  ClipboardList,
  Coins,
  Sparkles,
  UserSquare2,
  UserCog,
  Building2,
  Ruler,
  Settings,
  Cable,
  HardDrive,
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RoleConfig {
  _id: string;
  roleKey: string;
  label: string;
  menuKeys: string[];
}

const ALL_MENUS = [
  { key: 'dashboard', label: '概览', icon: LayoutDashboard },
  { key: 'enterprises', label: '企业管理', icon: Building2 },
  { key: 'ai-providers', label: 'AI 供应商', icon: Cable },
  { key: 'media-storage', label: '媒体存储', icon: HardDrive },
  { key: 'roles', label: '角色权限管理', icon: Shield },
  { key: 'floorplans', label: '户型图库', icon: Map },
  { key: 'users', label: '用户审计', icon: Users },
  { key: 'devices', label: '设备管理', icon: Smartphone },
  { key: 'measurements', label: '量房记录', icon: Ruler },
  { key: 'leads', label: '线索转化', icon: ClipboardList },
  { key: 'promotion-records', label: '企业报备', icon: Building2 },
  { key: 'workflow-logs', label: '提醒日志', icon: ClipboardList },
  { key: 'enterprise-orders', label: '成交订单', icon: ClipboardList },
  { key: 'commissions', label: '提成结算', icon: Coins },
  { key: 'ai-scenarios', label: 'AI 设计', icon: Sparkles },
  { key: 'ai-presets', label: 'AI 预设配置', icon: Settings },
  { key: 'ai-credit-prices', label: 'AI 点数价格', icon: Coins },
  { key: 'inspirations', label: '灵感方案', icon: Sparkles },
  { key: 'staff', label: '员工管理', icon: UserSquare2 },
  { key: 'packages', label: '套餐管理', icon: ClipboardList },
  { key: 'admins', label: '系统管理', icon: UserCog },
];

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<RoleConfig | null>(null);
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/roles');
      const data = await res.json();
      if (data.success) {
        setRoles(data.data);
        if (data.data.length > 0 && !selectedRole) {
          setSelectedRole(data.data[0]);
          setEditPermissions(data.data[0].menuKeys);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  const handleSelectRole = (role: RoleConfig) => {
    setSelectedRole(role);
    setEditPermissions(role.menuKeys);
  };

  const togglePermission = (key: string) => {
    setEditPermissions(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSave = async () => {
    if (!selectedRole) return;
    setSaving(true);
    try {
      const res = await fetch('/api/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedRole._id,
          menuKeys: editPermissions,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRoles(roles.map(r => r._id === selectedRole._id ? data.data : r));
        setSelectedRole(data.data);
        notify.fromAlert('保存成功');
      }
    } catch (err) {
      console.error(err);
      notify.fromAlert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div>
            <h1 className="text-[32px] font-bold tracking-tight mb-2">默认角色权限管理</h1>
            <p className="text-muted-foreground text-sm flex items-center gap-2">
              <Shield size={14} className="text-primary" /> 管理系统不同角色的默认菜单配置，修改后将影响新创建的账号
            </p>
          </div>
          <Button 
             variant="outline" 
             size="sm" 
             onClick={fetchRoles}
             className="rounded-full h-10 w-10 shrink-0"
          >
            <RefreshCw size={18} className={cn(loading && "animate-spin")} />
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Role List */}
          <div className="lg:col-span-4 space-y-3">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest px-4 mb-4">系统角色列表</h3>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="h-14 bg-zinc-50 animate-pulse rounded-2xl" />
                ))}
              </div>
            ) : (
              roles.map((role) => (
                <button
                  key={role._id}
                  onClick={() => handleSelectRole(role)}
                  className={cn(
                    "w-full flex items-center justify-between p-4 rounded-2xl border transition-all duration-200 group",
                    selectedRole?._id === role._id
                      ? "bg-zinc-950 text-white border-zinc-950 shadow-xl shadow-zinc-200"
                      : "bg-white text-zinc-600 border-zinc-100 hover:border-zinc-300 hover:bg-zinc-50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs",
                      selectedRole?._id === role._id ? "bg-white/10 text-white" : "bg-zinc-100 text-zinc-500"
                    )}>
                      {role.label[0]}
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-bold">{role.label}</p>
                      <p className={cn(
                        "text-[10px] uppercase tracking-wider font-medium opacity-60",
                        selectedRole?._id === role._id ? "text-zinc-400" : "text-zinc-500"
                      )}>{role.roleKey}</p>
                    </div>
                  </div>
                  <ChevronRight size={16} className={cn(
                    "transition-transform",
                    selectedRole?._id === role._id ? "translate-x-1 opacity-100" : "opacity-0 group-hover:opacity-40"
                  )} />
                </button>
              ))
            )}
          </div>

          {/* Permissions Config */}
          <div className="lg:col-span-8">
            <div className="bg-white border border-zinc-100 rounded-[32px] overflow-hidden shadow-sm">
              {selectedRole ? (
                <div className="flex flex-col h-full">
                  <div className="p-8 border-b border-zinc-50 bg-zinc-50/30 flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-bold flex items-center gap-2">
                        <Lock size={20} className="text-primary" /> 
                        编辑 {selectedRole.label} 默认菜单
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">勾选该角色在初始化时默认拥有的菜单项</p>
                    </div>
                    <Button 
                      onClick={handleSave} 
                      disabled={saving}
                      className="rounded-full px-6 flex items-center gap-2 shadow-lg shadow-primary/10"
                    >
                      {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                      保存配置
                    </Button>
                  </div>

                  <div className="p-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {ALL_MENUS.map((menu) => (
                        <button
                          key={menu.key}
                          onClick={() => togglePermission(menu.key)}
                          className={cn(
                            "flex items-center gap-4 p-4 rounded-2xl border transition-all duration-200 group relative",
                            editPermissions.includes(menu.key)
                              ? "bg-zinc-50 border-zinc-200 text-zinc-900 shadow-sm"
                              : "bg-white border-zinc-50 text-zinc-400 hover:border-zinc-200 hover:bg-zinc-50/50"
                          )}
                        >
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                            editPermissions.includes(menu.key) ? "bg-white text-primary shadow-sm" : "bg-zinc-50 text-zinc-300"
                          )}>
                            {React.createElement(menu.icon as any, { size: 18 })}
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-bold">{menu.label}</p>
                            <p className="text-[10px] opacity-60 font-mono tracking-tight">{menu.key}</p>
                          </div>
                          
                          {editPermissions.includes(menu.key) && (
                            <div className="absolute right-4 w-5 h-5 bg-primary rounded-full flex items-center justify-center text-white shadow-md animate-in zoom-in-50 duration-200">
                              <Check size={12} strokeWidth={3} />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-40 text-zinc-300">
                  <Settings2 size={48} strokeWidth={1} className="mb-4 opacity-20" />
                  <p className="text-sm font-medium">请从左侧选择一个角色开始配置</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
