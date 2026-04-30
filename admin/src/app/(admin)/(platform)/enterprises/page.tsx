'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Check, Copy, Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import EnterpriseEditorDialog from '@/components/enterprise/EnterpriseEditorDialog';
import { EnterpriseListItem } from '@/components/enterprise/types';
import {
  formatAiKeyStatus,
  getEnterpriseStatusBadge,
  getWecomCompletionText,
  isEnterpriseWecomConfigured,
} from '@/components/enterprise/enterprise-utils';

export default function EnterprisesPage() {
  const [enterprises, setEnterprises] = useState<EnterpriseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [editingEnt, setEditingEnt] = useState<EnterpriseListItem | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const fetchEnterprises = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/enterprises');
      const data = await res.json();
      if (data.success) {
        setEnterprises(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch enterprises:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEnterprises();
  }, []);

  const copyInvitationLink = () => {
    const link = `${window.location.origin}/register`;
    navigator.clipboard.writeText(link).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    });
  };

  const updateStatus = async (id: string, status: EnterpriseListItem['status']) => {
    try {
      const res = await fetch(`/api/admin/enterprises/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || '状态更新失败');
        return;
      }
      await fetchEnterprises();
    } catch (error) {
      console.error('Failed to update enterprise status:', error);
      alert('状态更新失败');
    }
  };

  return (
    <div className="min-h-screen bg-white font-sans text-[#171717]">
      <main className="mx-auto max-w-7xl px-6 py-16">
        <div className="mb-12 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-[32px] font-semibold leading-tight tracking-[-1.5px]">
              企业管理
            </h2>
            {!loading && (
              <span className="rounded-full bg-[#f5f5f5] px-3 py-1 text-[14px] font-medium text-[#666]">
                共 {enterprises.length} 家
              </span>
            )}
          </div>

          <div className="flex gap-4">
            <Button
              variant="outline"
              onClick={copyInvitationLink}
              className="flex items-center gap-2 rounded-full"
            >
              {copyFeedback ? <Check size={16} /> : <Copy size={16} />}
              {copyFeedback ? '邀请链接已复制' : '复制邀请链接'}
            </Button>
            <Button
              onClick={() => {
                setEditingEnt(null);
                setIsEditorOpen(true);
              }}
              className="flex items-center gap-2 rounded-full"
            >
              <Plus size={16} />
              手动添加企业
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="mb-4 animate-spin" size={32} />
            <p className="text-sm">正在获取企业数据...</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border shadow-sm">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[24%]">企业名称</TableHead>
                  <TableHead>编码</TableHead>
                  <TableHead>联系人</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>企微</TableHead>
                  <TableHead>AI 摘要</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enterprises.map((ent) => (
                  <TableRow key={ent._id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                          <Building2 size={16} className="text-muted-foreground" />
                        </div>
                        <div>
                          <div className="font-semibold">{ent.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {ent.registrationMode === 'self_service'
                              ? '自主注册'
                              : '后台录入'}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{ent.code}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">
                        {ent.contactPerson?.name || '-'}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {ent.contactPerson?.phone || '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        {getEnterpriseStatusBadge(ent.status)}
                        {ent.status === 'pending_approval' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus(ent._id, 'active')}
                          >
                            审核通过
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge
                          variant="secondary"
                          className={
                            isEnterpriseWecomConfigured(ent)
                              ? 'bg-green-100 text-green-700 hover:bg-green-100'
                              : 'bg-amber-100 text-amber-700 hover:bg-amber-100'
                          }
                        >
                          {isEnterpriseWecomConfigured(ent) ? '已配置' : '未配置'}
                        </Badge>
                        <div className="text-[11px] text-muted-foreground">
                          员工完成度 {getWecomCompletionText(ent)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant="secondary">{formatAiKeyStatus(ent)}</Badge>
                        <div className="text-[11px] text-muted-foreground">
                          余额 {Number(ent.aiUsageSnapshot?.balance || 0).toFixed(2)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          今日请求 {ent.aiUsageSnapshot?.summary?.today?.requests || 0}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/enterprises/${ent._id}`}
                          className={buttonVariants({
                            variant: 'ghost',
                            size: 'sm',
                            className: 'h-8 text-[13px]',
                          })}
                        >
                          查看概览
                        </Link>
                        <Link
                          href={`/enterprises/${ent._id}/ai`}
                          className={buttonVariants({
                            variant: 'ghost',
                            size: 'sm',
                            className: 'h-8 text-[13px]',
                          })}
                        >
                          AI 管理
                        </Link>
                        <Link
                          href={`/enterprises/${ent._id}/wecom`}
                          className={buttonVariants({
                            variant: 'ghost',
                            size: 'sm',
                            className: 'h-8 text-[13px]',
                          })}
                        >
                          企微管理
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingEnt(ent);
                            setIsEditorOpen(true);
                          }}
                          className="h-8 text-[13px] text-blue-600 hover:text-blue-700"
                        >
                          编辑基础信息
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

                {enterprises.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-24 text-center text-muted-foreground"
                    >
                      暂无企业数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      <EnterpriseEditorDialog
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        enterprise={editingEnt}
        onSaved={fetchEnterprises}
      />
    </div>
  );
}
