'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Cpu, Lock, User, AlertCircle } from 'lucide-react';

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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-lg mb-6">
            <Cpu className="text-white" size={32} />
          </div>
          <h1 className="text-[32px] font-bold tracking-tight text-gray-900 mb-2">量房大师</h1>
          <p className="text-gray-500 font-medium">管理后台身份认证</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100 p-8 md:p-10">
          <form onSubmit={handleLogin} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm animate-shake">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2 ml-1">用户名</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                  <User size={18} />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-gray-900 focus:bg-white focus:ring-4 focus:ring-blue-100 focus:border-blue-600 outline-none transition-all"
                  placeholder="请输入您的用户名"
                  required
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2 ml-1">密码</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                  <Lock size={18} />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-gray-900 focus:bg-white focus:ring-4 focus:ring-blue-100 focus:border-blue-600 outline-none transition-all"
                  placeholder="请输入您的密码"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-gray-900 text-white font-bold rounded-2xl hover:bg-black focus:ring-4 focus:ring-gray-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                '登录后台'
              )}
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-gray-50 text-center">
            <p className="text-xs text-gray-400 leading-relaxed px-4">
              提示：只有被授权的管理员账号才能访问。
              <br />
              如有疑问，请联系系统超级管理员。
            </p>
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
  );
}
