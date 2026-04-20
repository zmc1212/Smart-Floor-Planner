'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Cpu, Lock, User as UserIcon, AlertCircle, ArrowRight, ShieldCheck, Sparkles, Loader2 } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

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
        // Redirection is handled by the browser/next.js after a successful cookie is set
        // But we explicitly push to home
        router.push('/');
        router.refresh();
      } else {
        setError(data.error || '登录失败，请检查用户名和密码');
      }
    } catch (err) {
      setError('网络错误，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 font-sans selection:bg-primary selection:text-primary-foreground">
      <div className="max-w-[440px] w-full transform transition-all duration-700 animate-in fade-in slide-in-from-bottom-8">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-3 mb-8">
             <div className="w-14 h-14 bg-foreground rounded-[20px] flex items-center justify-center shadow-2xl shadow-primary/20">
                <Cpu className="text-background" size={28} />
             </div>
             <div className="text-left">
                <h1 className="text-[24px] font-black tracking-tighter leading-none mb-1">量房大师</h1>
                <Badge variant="secondary" className="bg-muted text-muted-foreground border-none font-bold text-[10px] uppercase tracking-widest px-2 py-0">Admin Enterprise</Badge>
             </div>
          </div>
          <h2 className="text-[32px] font-black tracking-tighter text-foreground mb-4 leading-tight">全权管理您的数字化资产</h2>
          <p className="text-muted-foreground font-medium text-[15px]">欢迎回来。请在下方输入受信任的管理员凭据。</p>
        </div>

        <div className="bg-white rounded-[40px] border border-muted shadow-2xl shadow-primary/5 p-10 md:p-12 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 opacity-50" />
          
          <form onSubmit={handleLogin} className="space-y-8 relative z-10">
            {error && (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive px-5 py-4 rounded-[20px] flex items-center gap-3 text-[13px] font-bold animate-shake">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground ml-1">受信任的用户名</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-muted-foreground/40 group-focus-within:text-primary transition-colors">
                    <UserIcon size={18} />
                  </div>
                   <Input
                    required
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-14 pl-12 bg-muted/30 border-none rounded-[18px] text-foreground focus-visible:ring-primary focus-visible:bg-white font-bold transition-all placeholder:font-normal"
                    placeholder="请输入管理员 ID"
                    autoFocus
                    suppressHydrationWarning
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <label className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground">访问密码</label>
                  <button type="button" className="text-[10px] font-bold text-muted-foreground hover:text-primary transition-colors">忘记凭据?</button>
                </div>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-muted-foreground/40 group-focus-within:text-primary transition-colors">
                    <Lock size={18} />
                  </div>
                   <Input
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-14 pl-12 bg-muted/30 border-none rounded-[18px] text-foreground focus-visible:ring-primary focus-visible:bg-white transition-all"
                    placeholder="••••••••"
                    suppressHydrationWarning
                  />
                </div>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-14 bg-foreground text-background font-black rounded-[18px] hover:bg-black hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 text-[15px] shadow-xl shadow-primary/10 flex items-center justify-center gap-2 group"
            >
              {loading ? (
                <Loader2 className="animate-spin text-background" size={20} />
              ) : (
                <>
                  认证并进入系统
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </>
              )}
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
           <p className="text-[12px] font-bold text-muted-foreground/30 uppercase tracking-[4px]">Powered by ZMC Systems</p>
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
  );
}
