'use client';

import { useState, type FormEvent } from 'react';
import Image from 'next/image';
import { Alert, Button, Input, Tag } from 'antd';
import { AlertCircle, Lock, LogOut, ShieldCheck } from 'lucide-react';
import { AdminAntdProvider } from '@/components/admin/antd-provider';

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (newPassword.length < 6 || newPassword.length > 32) {
      setError('新密码应为 6–32 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '修改密码失败');
      }
      window.location.assign('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '修改密码失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/login');
  };

  return (
    <AdminAntdProvider includeAccountSettings={false}>
      <div className="min-h-screen bg-white flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex items-center justify-center gap-3">
            <Image src="/brand-logo.png" alt="家客来" width={52} height={52} className="rounded-[18px]" />
            <div>
              <h1 className="mb-1 text-[24px] font-black leading-none tracking-[-0.02em]">家客来</h1>
              <Tag className="!m-0 !border-none !bg-muted !px-2 !py-0 !text-[10px] !font-bold !text-muted-foreground">
                首次登录安全设置
              </Tag>
            </div>
          </div>

          <div className="rounded-[32px] border border-muted bg-white p-8 shadow-xl shadow-primary/5 md:p-10">
            <div className="mb-7 text-center">
              <ShieldCheck size={34} className="mx-auto mb-4 text-primary" aria-hidden="true" />
              <h2 className="mb-2 text-[26px] font-black tracking-[-0.02em] text-foreground">请先修改初始密码</h2>
              <p className="text-[14px] leading-6 text-muted-foreground">
                为保护员工账号，设置新密码后才能进入业务工作台。
              </p>
            </div>

            <form onSubmit={submit} className="space-y-5">
              {error ? (
                <Alert type="error" showIcon icon={<AlertCircle size={18} />} message={error} className="!rounded-[16px]" />
              ) : null}
              <Input.Password
                required
                size="large"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                prefix={<Lock size={18} className="text-muted-foreground/50" />}
                placeholder="当前密码"
                autoComplete="current-password"
                className="!h-14 !rounded-[16px] !bg-muted/30"
              />
              <Input.Password
                required
                size="large"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                prefix={<Lock size={18} className="text-muted-foreground/50" />}
                placeholder="新密码（6–32 位）"
                autoComplete="new-password"
                className="!h-14 !rounded-[16px] !bg-muted/30"
              />
              <Input.Password
                required
                size="large"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                prefix={<Lock size={18} className="text-muted-foreground/50" />}
                placeholder="再次输入新密码"
                autoComplete="new-password"
                className="!h-14 !rounded-[16px] !bg-muted/30"
              />
              <Button type="primary" htmlType="submit" block size="large" loading={saving} className="!h-14 !rounded-[16px] !font-bold">
                保存新密码并进入系统
              </Button>
              <Button type="text" block icon={<LogOut size={16} />} disabled={saving} onClick={() => void logout()}>
                退出并返回登录
              </Button>
            </form>
          </div>
        </div>
      </div>
    </AdminAntdProvider>
  );
}
