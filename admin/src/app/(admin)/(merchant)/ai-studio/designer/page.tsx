'use client';

import React, { useState, useEffect } from 'react';
import ChatInterface from '@/components/ai-studio/ChatInterface';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Info } from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ChatAction, ChatUiPayload } from '@/lib/ai/chat-ui';
import { useRouter } from 'next/navigation';

type ConfirmToolAction = Extract<ChatAction, { kind: 'confirm_tool' }>;

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  uiPayload?: ChatUiPayload;
}

interface Conversation {
  _id: string;
  title: string;
  lastMessageAt: string;
  createdAt: string;
}

export function AiDesignerLegacyPage() {
  const confirmAction = useConfirmDialog();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // 初始化获取对话列表
  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    try {
      const res = await fetch('/api/ai/conversations');
      const result = await res.json();
      if (result.success) {
        setConversations(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    }
  };

  const handleSelectConversation = async (id: string) => {
    if (id === activeConversationId) return;
    setIsLoading(true);
    setActiveConversationId(id);
    try {
      const res = await fetch(`/api/ai/conversations/${id}`);
      const result = await res.json();
      if (result.success) {
        setMessages(result.data.messages);
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
    setMessages([]);
  };

  const handleDeleteConversation = async (id: string) => {
    const confirmed = await confirmAction({
      title: '删除对话记录',
      description: '确定要删除这段对话记录吗？',
      confirmText: '删除',
      destructive: true,
    });
    if (!confirmed) return;
    
    try {
      const res = await fetch(`/api/ai/conversations/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        setConversations(prev => prev.filter(c => c._id !== id));
        if (activeConversationId === id) {
          handleNewChat();
        }
        notify.success('对话记录已删除');
      } else {
        notify.fromAlert(result.error || '删除失败');
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      notify.error('删除失败');
    }
  };

  const handleSendMessage = async (content: string, contextHint?: string) => {
    const userMessage: Message = { role: 'user', content };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const res = await fetch('/api/ai/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: [userMessage], // 仅发送当前消息，后端会从 Session 中恢复上下文
          conversationId: activeConversationId,
          contextHint
        })
      });

      const result = await res.json();
      if (result.success) {
        setMessages([...newMessages, result.data]);
        
        // 如果是新对话产生的回复，更新会话状态
        if (!activeConversationId) {
          setActiveConversationId(result.data.conversationId);
          fetchConversations(); // 刷新侧边栏列表
        }
      } else {
        console.error('Agent Error:', result.error);
        setMessages([
          ...newMessages, 
          { role: 'assistant', content: `抱歉，遇到了一些问题：${result.error}` }
        ]);
      }
    } catch (error) {
      console.error('Fetch Error:', error);
      setMessages([
        ...newMessages, 
        { role: 'assistant', content: '网络连接异常，请稍后再试。' }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunAction = async (action: ConfirmToolAction) => {
    if (!activeConversationId) {
      notify.error('请先在当前对话中执行操作');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/ai/agent/actions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          conversationId: activeConversationId,
          actionName: action.actionName,
          confirmed: true,
          ...action.arguments
        })
      });

      const result = await res.json();
      if (result.success) {
        setMessages((prev) => [...prev, result.data]);
        notify.success('操作已完成');
        fetchConversations();
      } else {
        notify.fromAlert(result.error || '操作失败');
      }
    } catch (error) {
      console.error('Agent action failed:', error);
      notify.error('操作失败，请稍后再试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa] text-[#171717] font-sans">
      <main className="mx-auto max-w-[1680px] px-6 py-8">
        {/* Header Section */}
        <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-900 text-white shadow-xl shadow-zinc-200">
                <Sparkles size={20} />
              </div>
              <h1 className="text-[32px] font-bold tracking-tight text-zinc-900">AI 工作台</h1>
              <Badge variant="secondary" className="border-none bg-indigo-50 text-indigo-700 px-3 py-1 font-bold">
                Alpha
              </Badge>
            </div>
            <p className="text-sm text-zinc-500 font-medium">
              您的数字化助手，协助您处理客资转化、方案比对和技术支持。
            </p>
          </div>

          <div className="flex items-center gap-4 bg-white px-5 py-3 rounded-2xl border border-zinc-100 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
              <Info size={20} />
            </div>
            <div>
              <p className="text-xs font-bold text-zinc-900">Agent 权限已开启</p>
              <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-tight">已连接生产数据库 · 只读模式</p>
            </div>
          </div>
        </div>

        {/* Chat Interface Container */}
        <div className="relative">
          {/* Subtle background decoration */}
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-indigo-400/5 blur-[100px] rounded-full"></div>
          <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-pink-400/5 blur-[100px] rounded-full"></div>
          
          <ChatInterface 
            messages={messages} 
            onSendMessage={handleSendMessage} 
            isLoading={isLoading}
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={handleSelectConversation}
            onNewChat={handleNewChat}
            onDeleteConversation={handleDeleteConversation}
            onRunAction={handleRunAction}
          />
        </div>
      </main>
    </div>
  );
}

export default function AiDesignerPage() {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('view', 'assistant');
    router.replace(`/ai-studio/scenarios?${params.toString()}`);
  }, [router]);
  return <div className="p-8 text-sm text-muted-foreground">正在进入统一 AI 设计工作台...</div>;
}
