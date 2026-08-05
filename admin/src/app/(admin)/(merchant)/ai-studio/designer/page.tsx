'use client';

import React, { useState, useEffect } from 'react';
import ChatInterface from '@/components/ai-studio/ChatInterface';
import { Sparkles } from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { AiToolFrame } from '@/components/ai-studio/ai-tool-frame';
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
    <AiToolFrame
      title="AI 助手"
      description="围绕客户、方案和户型上下文完成查询、建议与经确认的工作流操作。"
      icon={Sparkles}
    >
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
    </AiToolFrame>
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
