'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Bot, Loader2, Sparkles, PlusCircle, Trash2, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

interface Conversation {
  _id: string;
  title: string;
  lastMessageAt: string;
  createdAt: string;
}

interface ChatInterfaceProps {
  onSendMessage: (content: string) => Promise<void>;
  messages: Message[];
  isLoading: boolean;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
}

const QUICK_ACTIONS = [
  "帮我找一下最近的客资",
  "推荐几个适合大户型的现代风格",
  "查看最近完成的户型图",
  "我该如何提高转化率？"
];

export default function ChatInterface({ 
  onSendMessage, 
  messages, 
  isLoading,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation
}: ChatInterfaceProps) {
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input);
    setInput('');
  };

  const handleQuickAction = (action: string) => {
    if (isLoading) return;
    onSendMessage(action);
  };

  return (
    <div className="flex h-[calc(100vh-200px)] bg-white rounded-[32px] shadow-2xl shadow-zinc-200/50 border border-zinc-100 overflow-hidden">
      {/* Sidebar - History */}
      <div className={cn(
        "bg-zinc-50/50 border-r border-zinc-100 flex flex-col transition-all duration-300 ease-in-out shrink-0",
        isSidebarOpen ? "w-64" : "w-0 overflow-hidden border-none"
      )}>
        <div className="p-4 shrink-0">
          <Button 
            onClick={onNewChat}
            className="w-full justify-start gap-2 bg-white hover:bg-zinc-100 text-zinc-900 border border-zinc-200 rounded-xl shadow-sm"
            variant="outline"
          >
            <PlusCircle size={18} />
            <span className="font-bold text-sm">新对话</span>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1 py-2">
          {conversations.map((chat) => (
            <div 
              key={chat._id}
              className={cn(
                "group relative flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all",
                activeConversationId === chat._id 
                  ? "bg-white text-zinc-900 shadow-sm border border-zinc-100" 
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              )}
              onClick={() => onSelectConversation(chat._id)}
            >
              <MessageSquare size={16} className={cn(
                activeConversationId === chat._id ? "text-indigo-500" : "text-zinc-400"
              )} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate">{chat.title || '新对话'}</p>
                <p className="text-[10px] text-zinc-400 font-medium">
                  {new Date(chat.lastMessageAt || chat.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteConversation(chat._id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 hover:text-red-500 rounded-lg transition-all text-zinc-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-100 bg-zinc-50/80">
          <p className="text-[10px] text-zinc-400 font-black uppercase tracking-widest text-center">
            对话记录自动保存
          </p>
        </div>
      </div>

      {/* Main Chat Content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Toggle Sidebar Button (Floating) */}
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={cn(
            "absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-12 bg-white border border-zinc-100 shadow-md rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-900 z-10 transition-all",
            !isSidebarOpen && "left-0"
          )}
        >
          {isSidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* Header */}
        <div className="px-8 py-6 border-b border-zinc-50 bg-white/80 backdrop-blur-md flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white shadow-lg shadow-indigo-100">
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-zinc-900">
                {activeConversationId ? conversations.find(c => c._id === activeConversationId)?.title || 'AI 设计师' : 'AI 设计师'}
              </h2>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <p className="text-xs text-zinc-500 font-medium">在线 · 随时为您服务</p>
              </div>
            </div>
          </div>
          <Badge variant="secondary" className="bg-zinc-100 text-zinc-600 border-none px-3 py-1 text-[10px] font-black uppercase tracking-widest">
            LongCat Flash
          </Badge>
        </div>

        {/* Messages Area */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-8 space-y-8 scroll-smooth"
        >
          {messages.length === 0 && !isLoading && (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-6">
              <div className="w-20 h-20 rounded-[30%] bg-zinc-50 flex items-center justify-center">
                <Bot size={40} className="text-zinc-200" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-zinc-900 mb-2">我是您的 AI 助理设计师</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">
                  您可以问我关于客户跟进、户型分析或设计风格的问题。我会实时查阅系统数据为您提供精准建议。
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 w-full mt-4">
                {QUICK_ACTIONS.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => handleQuickAction(action)}
                    className="px-4 py-3 text-sm font-medium text-zinc-600 bg-zinc-50 hover:bg-zinc-100 hover:text-zinc-900 rounded-2xl transition-all border border-zinc-100 text-left"
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.filter(m => m.role !== 'system' && m.role !== 'tool').map((m, i) => (
            <div 
              key={i}
              className={cn(
                "flex w-full gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300",
                m.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm",
                m.role === 'user' ? "bg-zinc-900 text-white" : "bg-white border border-zinc-100 text-indigo-500"
              )}>
                {m.role === 'user' ? <User size={18} /> : <Sparkles size={18} />}
              </div>
              <div className={cn(
                "max-w-[80%] rounded-[24px] px-6 py-4 text-sm leading-relaxed",
                m.role === 'user' 
                  ? "bg-zinc-900 text-white shadow-xl shadow-zinc-200" 
                  : "bg-zinc-50 text-zinc-800 border border-zinc-100 shadow-sm"
              )}>
                {m.content.split('\n').map((line, j) => (
                  <p key={j} className={j > 0 ? "mt-2" : ""}>{line}</p>
                ))}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex w-full gap-4 animate-pulse">
              <div className="w-10 h-10 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center shrink-0">
                <Loader2 size={18} className="text-zinc-300 animate-spin" />
              </div>
              <div className="bg-zinc-50 border border-zinc-100 rounded-[24px] px-6 py-4">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce"></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-8 border-t border-zinc-50 bg-white/80 backdrop-blur-md shrink-0">
          <form 
            onSubmit={handleSubmit}
            className="relative flex items-center gap-3 max-w-4xl mx-auto"
          >
            <button 
              type="button"
              onClick={onNewChat}
              className="p-3 text-zinc-400 hover:text-zinc-600 transition-colors"
              title="新建对话"
            >
              <PlusCircle size={24} />
            </button>
            <div className="flex-1 relative">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="在这里输入您的问题，如：帮我找找万科小区的客资..."
                className="h-14 pl-6 pr-16 rounded-[20px] bg-zinc-50 border-zinc-100 focus:bg-white focus:border-indigo-200 focus:ring-indigo-100 transition-all text-base placeholder:text-zinc-400"
                disabled={isLoading}
              />
              <Button 
                type="submit"
                disabled={!input.trim() || isLoading}
                className="absolute right-2 top-2 h-10 w-10 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 transition-all shadow-lg"
                size="icon"
              >
                <Send size={18} />
              </Button>
            </div>
          </form>
          <p className="mt-4 text-center text-[10px] text-zinc-400 font-medium uppercase tracking-widest">
            AI 可能会产生误差，请结合实际业务核对数据
          </p>
        </div>
      </div>
    </div>
  );
}
