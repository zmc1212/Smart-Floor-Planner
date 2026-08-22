'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { Alert, Button, Input, Tag } from 'antd';
import { AlertCircle, ArrowRight, Lock, ShieldCheck, User as UserIcon } from 'lucide-react';
import { AdminAntdProvider } from '@/components/admin/antd-provider';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (data.success) {
        window.location.assign('/');
        return;
      } else {
        setError(data.error || '登录失败，请检查用户名和密码');
      }
    } catch {
      setError('网络错误，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminAntdProvider includeAccountSettings={false}>
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 font-sans selection:bg-primary selection:text-primary-foreground">
        <div className="max-w-[440px] w-full transform transition-all duration-700 animate-in fade-in slide-in-from-bottom-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-3 mb-8">
              <Image
                src="/brand-logo.png"
                alt="家客来"
                width={56}
                height={56}
                className="shrink-0 rounded-[20px]"
              />
              <div className="text-left">
                <h1 className="text-[24px] font-black tracking-tighter leading-none mb-1">家客来</h1>
                <Tag className="!m-0 !border-none !bg-muted !px-2 !py-0 !text-[10px] !font-bold !uppercase !tracking-widest !text-muted-foreground">
                  企业管理后台
                </Tag>
              </div>
            </div>
            <h2 className="text-[32px] font-black tracking-tighter text-foreground mb-4 leading-tight">
              全权管理您的数字化资产
            </h2>
            <p className="text-muted-foreground font-medium text-[15px]">
              欢迎回来。请在下方输入受信任的管理员凭据。
            </p>
          </div>

          <div className="bg-white rounded-[40px] border border-muted shadow-2xl shadow-primary/5 p-10 md:p-12 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 opacity-50" />

            <form onSubmit={handleLogin} className="space-y-8 relative z-10">
              {error ? (
                <Alert
                  type="error"
                  showIcon
                  icon={<AlertCircle size={18} />}
                  message={error}
                  className="!rounded-[20px] animate-shake"
                />
              ) : null}

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground ml-1">
                    受信任的用户名
                  </label>
                  <Input
                    required
                    size="large"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    prefix={<UserIcon size={18} className="text-muted-foreground/40" />}
                    placeholder="请输入管理员 ID 或 手机号"
                    autoFocus
                    className="!h-14 !rounded-[18px] !border-none !bg-muted/30 !font-bold placeholder:!font-normal focus:!bg-white"
                    suppressHydrationWarning
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground">
                      访问密码
                    </label>
                    <button type="button" className="text-[10px] font-bold text-muted-foreground hover:text-primary transition-colors">
                      忘记凭据?
                    </button>
                  </div>
                  <Input.Password
                    required
                    size="large"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    prefix={<Lock size={18} className="text-muted-foreground/40" />}
                    placeholder="••••••••"
                    className="!h-14 !rounded-[18px] !border-none !bg-muted/30 focus:!bg-white [&_.ant-input]:!bg-transparent [&_.ant-input]:!font-bold"
                    suppressHydrationWarning
                  />
                </div>
              </div>

              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                size="large"
                className="!h-14 !rounded-[18px] !border-none !bg-foreground !text-[15px] !font-black !text-background !shadow-xl !shadow-primary/10 hover:!bg-black hover:!scale-[1.02] active:!scale-[0.98]"
                icon={!loading ? <ArrowRight size={18} /> : undefined}
                iconPosition="end"
              >
                认证并进入系统
              </Button>
            </form>

            <div className="mt-12 pt-8 border-t border-muted text-center space-y-4">
              <div className="flex items-center justify-center gap-2 text-[11px] font-bold text-muted-foreground/50">
                <ShieldCheck size={14} />
                <span>AES-256 加密端到端身份认证</span>
              </div>
              <p className="text-[11px] text-muted-foreground/40 leading-relaxed px-4 max-w-[280px] mx-auto">
                只有被授权的管理员账号才能访问。
                如有疑问，请通过钉钉或微信联系技术部。
              </p>
            </div>
          </div>

          <div className="mt-12 text-center">
            <div className="inline-flex items-center gap-2 text-muted-foreground/50">
              <Image src="/brand-logo.png" alt="" aria-hidden="true" width={18} height={18} className="rounded-md" />
              <span className="text-[12px] font-bold">家客来</span>
            </div>
          </div>
        </div>

        <style jsx>{`
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-4px); }
            75% { transform: translateX(4px); }
          }
          .animate-shake {
            animation: shake 0.4s ease-in-out;
          }
        `}</style>
      </div>
    </AdminAntdProvider>
  );
}
