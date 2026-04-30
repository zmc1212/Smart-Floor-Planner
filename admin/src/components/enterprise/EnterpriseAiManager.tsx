'use client';

import { useMemo, useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface EnterpriseAiManagerProps {
  enterprise: {
    _id: string;
    aiConfig?: {
      allowedModels?: string[];
      pollenBudget?: number | null;
      pollinationsKeyName?: string;
      pollinationsKeyRef?: string;
      pollinationsMaskedKey?: string;
    };
    aiUsageSnapshot?: {
      balance?: number;
      lastSyncedAt?: string | Date | null;
      syncError?: string;
      keyInfo?: {
        keyId?: string;
        keyName?: string;
        maskedKey?: string;
        valid?: boolean;
        allowedModels?: string[];
        pollenBudget?: number | null;
      } | null;
      summary?: {
        today?: { requests: number; costUsd: number };
        recent7Days?: Array<{ date: string; requests: number; costUsd: number }>;
      };
    } | null;
  };
  onRefresh?: () => Promise<void> | void;
}

function statusTone(status?: string) {
  switch (status) {
    case 'configured':
      return 'bg-green-100 text-green-700 hover:bg-green-100';
    case 'invalid':
      return 'bg-amber-100 text-amber-700 hover:bg-amber-100';
    default:
      return 'bg-zinc-100 text-zinc-600 hover:bg-zinc-100';
  }
}

function statusLabel(status?: string) {
  switch (status) {
    case 'configured':
      return '已配置';
    case 'invalid':
      return 'Key 无效';
    default:
      return '未配置';
  }
}

export default function EnterpriseAiManager({ enterprise, onRefresh }: EnterpriseAiManagerProps) {
  const aiConfig = enterprise?.aiConfig || {};
  const snapshot = enterprise?.aiUsageSnapshot || {};
  const summary = snapshot?.summary || { today: { requests: 0, costUsd: 0 }, recent7Days: [] };
  const effectiveKeyRef = aiConfig.pollinationsKeyRef || snapshot?.keyInfo?.keyId || '';
  const effectiveKeyName = aiConfig.pollinationsKeyName || snapshot?.keyInfo?.keyName || '';
  const effectiveStatus = !effectiveKeyRef
    ? 'unconfigured'
    : snapshot?.keyInfo?.valid === false
      ? 'invalid'
      : 'configured';

  const [allowedModels, setAllowedModels] = useState<string>(
    (aiConfig.allowedModels || snapshot?.keyInfo?.allowedModels || []).join(', ')
  );
  const [pollenBudget, setPollenBudget] = useState<string>(
    aiConfig.pollenBudget !== null && aiConfig.pollenBudget !== undefined
      ? String(aiConfig.pollenBudget)
      : ''
  );
  const [loading, setLoading] = useState<string>('');
  const [latestSecret, setLatestSecret] = useState('');
  const [latestKeyRef, setLatestKeyRef] = useState('');
  const [latestKeyName, setLatestKeyName] = useState('');

  const resolvedKeyRef = latestKeyRef || effectiveKeyRef;
  const resolvedKeyName = latestKeyName || effectiveKeyName;

  const parsedModels = useMemo(
    () =>
      allowedModels
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    [allowedModels]
  );

  const parsedBudget = pollenBudget.trim() ? Number(pollenBudget) : null;

  const runAction = async (action: string, runner: () => Promise<void>) => {
    setLoading(action);
    try {
      await runner();
      await onRefresh?.();
    } finally {
      setLoading('');
    }
  };

  const createOrRotateKey = async (rotate = false) => {
    await runAction(rotate ? 'rotate' : 'create', async () => {
      const res = await fetch(`/api/admin/enterprises/${enterprise._id}/ai-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowedModels: parsedModels,
          pollenBudget: parsedBudget,
          rotate,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || '创建企业 AI Key 失败');
        return;
      }

      setLatestSecret(data.data?.secret || '');
      setLatestKeyRef(data.data?.keyInfo?.keyId || '');
      setLatestKeyName(data.data?.keyInfo?.keyName || '');
      alert(rotate ? '企业 AI Key 已轮换并同步完成' : '企业 AI Key 已创建并同步完成');
    });
  };

  const revokeKey = async () => {
    await runAction('revoked', async () => {
      const res = await fetch(`/api/admin/enterprises/${enterprise._id}/ai-key`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'revoked',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || '撤销企业 AI Key 失败');
        return;
      }

      setLatestKeyRef('');
      setLatestKeyName('');
      setLatestSecret('');
      alert('企业 AI Key 已撤销');
    });
  };

  const syncUsage = async () => {
    await runAction('sync', async () => {
      const res = await fetch(`/api/admin/enterprises/${enterprise._id}/ai-sync`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || '同步企业 AI 用量失败');
        return;
      }
      alert('企业 AI 余额和每日用量已同步');
    });
  };

  return (
    <div className="space-y-5 rounded-3xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
            AI 账户配置
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="secondary" className={cn(statusTone(effectiveStatus))}>
              {statusLabel(effectiveStatus)}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {resolvedKeyName || '尚未创建企业子 Key'}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm md:min-w-[320px]">
          <div className="rounded-2xl bg-muted/20 p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              官方余额
            </div>
            <div className="mt-1 text-xl font-bold">{Number(snapshot?.balance || 0).toFixed(2)}</div>
          </div>
          <div className="rounded-2xl bg-muted/20 p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              今日请求
            </div>
            <div className="mt-1 text-xl font-bold">{summary.today?.requests || 0}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`allowed-models-${enterprise._id}`}>允许模型</Label>
          <Input
            id={`allowed-models-${enterprise._id}`}
            value={allowedModels}
            onChange={(event) => setAllowedModels(event.target.value)}
            placeholder="例如: gptimage, gptimage-large"
          />
          <p className="text-xs text-muted-foreground">多个模型请用英文逗号分隔。</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`pollen-budget-${enterprise._id}`}>Pollen 预算</Label>
          <Input
            id={`pollen-budget-${enterprise._id}`}
            value={pollenBudget}
            onChange={(event) => setPollenBudget(event.target.value)}
            placeholder="例如: 100"
            type="number"
            min="0"
          />
          <p className="text-xs text-muted-foreground">
            留空时默认按 100 创建子 Key 预算，便于单 Key 独立查看余额。
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border bg-muted/10 p-4 text-sm">
          <div className="mb-2 font-semibold">Key 摘要</div>
          <div className="space-y-2 text-muted-foreground">
            <div>Key ID: {resolvedKeyRef || '-'}</div>
            <div>Masked Key: {aiConfig.pollinationsMaskedKey || snapshot?.keyInfo?.maskedKey || '-'}</div>
            <div>
              最近同步{' '}
              {snapshot?.lastSyncedAt ? new Date(snapshot.lastSyncedAt).toLocaleString() : '未同步'}
            </div>
          </div>
        </div>
        <div className="rounded-2xl border bg-muted/10 p-4 text-sm">
          <div className="mb-2 font-semibold">近 7 日摘要</div>
          <div className="space-y-2 text-muted-foreground">
            <div>天数: {(summary.recent7Days || []).length}</div>
            <div>
              请求总数:{' '}
              {(summary.recent7Days || []).reduce(
                (sum: number, item: { requests: number }) => sum + Number(item.requests || 0),
                0
              )}
            </div>
            <div>
              费用总计: $
              {(summary.recent7Days || []).reduce(
                (sum: number, item: { costUsd: number }) => sum + Number(item.costUsd || 0),
                0
              ).toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {snapshot?.syncError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          最近同步错误：{snapshot.syncError}
        </div>
      ) : null}

      {latestSecret ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="font-semibold">本次新建/轮换得到的子 Key</div>
          <div className="mt-1 break-all font-mono text-[12px]">{latestSecret}</div>
          <div className="mt-1 text-[12px] text-emerald-700">
            仅本次展示，后续页面只保留 masked 信息。
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {!resolvedKeyRef ? (
          <Button onClick={() => createOrRotateKey(false)} disabled={Boolean(loading)}>
            {loading === 'create' ? '创建中...' : '创建企业子 Key'}
          </Button>
        ) : null}

        {resolvedKeyRef ? (
          <Button variant="outline" onClick={() => createOrRotateKey(true)} disabled={Boolean(loading)}>
            {loading === 'rotate' ? '轮换中...' : '轮换 Key'}
          </Button>
        ) : null}

        {resolvedKeyRef ? (
          <Button variant="outline" onClick={syncUsage} disabled={Boolean(loading)}>
            {loading === 'sync' ? '同步中...' : '立即同步余额/用量'}
          </Button>
        ) : null}

        {resolvedKeyRef ? (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={revokeKey}
            disabled={Boolean(loading)}
          >
            撤销 Key
          </Button>
        ) : null}
      </div>
    </div>
  );
}
