'use client';

import { notify } from '@/components/ui/operation-feedback';

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
      allowedCapabilities?: string[];
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

  const [allowedCapabilities, setAllowedCapabilities] = useState<string[]>(
    aiConfig.allowedCapabilities || ['image']
  );
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

  const [availableModels, setAvailableModels] = useState<{text: any[], image: any[], video: any[]}>({text: [], image: [], video: []});
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    async function fetchModels() {
      setLoadingModels(true);
      try {
        const [textRes, imageRes] = await Promise.all([
          fetch('https://gen.pollinations.ai/text/models').catch(() => ({ json: () => [] })),
          fetch('https://gen.pollinations.ai/image/models').catch(() => ({ json: () => [] }))
        ]);
        const textModelsData = await (textRes as Response).json();
        const imageModelsData = await (imageRes as Response).json();
        
        const textModels = Array.isArray(textModelsData) ? textModelsData : [];
        const combinedImageModels = Array.isArray(imageModelsData) ? imageModelsData : [];
        
        const imageModels = combinedImageModels.filter(m => m.output_modalities?.includes('image'));
        const videoModels = combinedImageModels.filter(m => m.output_modalities?.includes('video'));
        
        setAvailableModels({ text: textModels, image: imageModels, video: videoModels });
      } catch (err) {
        console.error('Failed to fetch models:', err);
      } finally {
        setLoadingModels(false);
      }
    }
    fetchModels();
  }, []);

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
    if (parsedModels.length === 0) {
      notify.fromAlert('请至少选择一个允许使用的模型');
      return;
    }
    
    await runAction(rotate ? 'rotate' : 'create', async () => {
      const res = await fetch(`/api/admin/enterprises/${enterprise._id}/ai-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowedCapabilities,
          allowedModels: parsedModels,
          pollenBudget: parsedBudget,
          rotate,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify.fromAlert(data.error || '创建企业 AI Key 失败');
        return;
      }

      setLatestSecret(data.data?.secret || '');
      setLatestKeyRef(data.data?.keyInfo?.keyId || '');
      setLatestKeyName(data.data?.keyInfo?.keyName || '');
      notify.fromAlert(rotate ? '企业 AI Key 已轮换并同步完成' : '企业 AI Key 已创建并同步完成');
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
        notify.fromAlert(data.error || '撤销企业 AI Key 失败');
        return;
      }

      setLatestKeyRef('');
      setLatestKeyName('');
      setLatestSecret('');
      notify.fromAlert('企业 AI Key 已撤销');
    });
  };

  const saveConfig = async () => {
    await runAction('save', async () => {
      const res = await fetch(`/api/admin/enterprises/${enterprise._id}/ai-key`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowedCapabilities,
          allowedModels: parsedModels,
          pollenBudget: parsedBudget,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify.fromAlert(data.error || '保存配置失败');
        return;
      }
      notify.fromAlert('企业 AI 配置已保存');
    });
  };

  const syncUsage = async () => {
    await runAction('sync', async () => {
      const res = await fetch(`/api/admin/enterprises/${enterprise._id}/ai-sync`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify.fromAlert(data.error || '同步企业 AI 用量失败');
        return;
      }
      notify.fromAlert('企业 AI 余额和每日用量已同步');
    });
  };

  const hasKey = Boolean(resolvedKeyRef || aiConfig.pollinationsMaskedKey || snapshot?.keyInfo?.maskedKey);

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
        <div className="space-y-3 md:col-span-2">
          <div>
            <Label>AI 工具权限</Label>
            <p className="text-xs text-muted-foreground mt-1 mb-2">选择该企业可使用的 AI 类型（文本对话、图像生成、视频生成）。</p>
            <div className="flex gap-4">
              {[{ id: 'text', label: '文本对话' }, { id: 'image', label: '图像生成' }, { id: 'video', label: '视频生成' }].map((cap) => (
                <label key={cap.id} className={cn("flex items-center gap-2 text-sm", hasKey ? "opacity-70 cursor-not-allowed" : "cursor-pointer")}>
                  <input
                    type="checkbox"
                    disabled={hasKey}
                    checked={allowedCapabilities.includes(cap.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setAllowedCapabilities([...allowedCapabilities, cap.id]);
                      } else {
                        setAllowedCapabilities(allowedCapabilities.filter((c) => c !== cap.id));
                      }
                    }}
                    className="h-4 w-4 rounded border-zinc-300 disabled:bg-zinc-100"
                  />
                  {cap.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label>允许模型</Label>
          {loadingModels ? (
            <div className="text-sm text-muted-foreground">正在加载官方模型列表...</div>
          ) : (availableModels.text.length > 0 || availableModels.image.length > 0 || availableModels.video.length > 0) ? (
            <div className={cn("flex flex-col gap-6 max-h-[400px] overflow-y-auto rounded-md border p-4", hasKey && "opacity-80 bg-zinc-50")}>
              {[
                { type: 'text', title: '文本模型', data: availableModels.text },
                { type: 'image', title: '图像模型', data: availableModels.image },
                { type: 'video', title: '视频模型', data: availableModels.video }
              ].map((category) => (
                allowedCapabilities.includes(category.type) && category.data.length > 0 ? (
                  <div key={category.type}>
                    <h4 className="mb-2 font-semibold text-sm">{category.title}</h4>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {category.data.map((m) => {
                        const id = m.name || m.id;
                        
                        const displayModels = hasKey 
                          ? (aiConfig.allowedModels?.length ? aiConfig.allowedModels : snapshot?.keyInfo?.allowedModels || [])
                          : parsedModels;
                          
                        const isSelected = displayModels.includes(id);
                        
                        // Hide unselected models if key is already created to simplify view
                        if (hasKey && !isSelected) return null;

                        return (
                          <div
                            key={id}
                            className={cn(
                              "flex flex-col gap-1 rounded-lg border p-3 text-sm transition-colors",
                              isSelected ? "border-zinc-900 bg-zinc-50" : "hover:bg-muted/50",
                              !hasKey && "cursor-pointer"
                            )}
                            onClick={() => {
                              if (hasKey) return;
                              if (isSelected) {
                                setAllowedModels(parsedModels.filter(x => x !== id).join(', '));
                              } else {
                                setAllowedModels([...parsedModels, id].join(', '));
                              }
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{id}</span>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={hasKey}
                                readOnly
                                className="h-4 w-4 rounded border-zinc-300 disabled:opacity-70"
                              />
                            </div>
                            <div className="text-xs text-muted-foreground line-clamp-2">{m.description || '暂无描述'}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {m.input_modalities?.map((mod: string) => (
                                <Badge key={`in-${mod}`} variant="secondary" className="px-1 py-0 text-[9px] uppercase leading-tight">
                                  In: {mod}
                                </Badge>
                              ))}
                              {m.output_modalities?.map((mod: string) => (
                                <Badge key={`out-${mod}`} variant="outline" className="px-1 py-0 text-[9px] uppercase leading-tight">
                                  Out: {mod}
                                </Badge>
                              ))}
                              {m.pricing?.completionImageTokens && (
                                <Badge variant="outline" className="border-amber-200 bg-amber-50 px-1 py-0 text-[9px] text-amber-700 leading-tight">
                                  💰 {m.pricing.completionImageTokens} Pollen/图
                                </Badge>
                              )}
                              {m.pricing?.promptTextTokens && (
                                <Badge variant="outline" className="border-amber-200 bg-amber-50 px-1 py-0 text-[9px] text-amber-700 leading-tight">
                                  💰 In: {m.pricing.promptTextTokens} / Out: {m.pricing.completionTextTokens}
                                </Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">无法加载模型列表，请手动输入。</div>
          )}
          
          <div className={cn("mt-2", hasKey && "hidden")}>
            <Input
              id={`allowed-models-${enterprise._id}`}
              value={hasKey ? (aiConfig.allowedModels?.length ? aiConfig.allowedModels : snapshot?.keyInfo?.allowedModels || []).join(', ') : allowedModels}
              onChange={(event) => setAllowedModels(event.target.value)}
              placeholder="例如: flux, openai"
            />
            <p className="text-xs text-muted-foreground mt-1">可点击上方卡片选择，或在输入框中手动填写，多个模型请用英文逗号分隔。</p>
          </div>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor={`pollen-budget-${enterprise._id}`}>Pollen 预算</Label>
          <Input
            id={`pollen-budget-${enterprise._id}`}
            value={pollenBudget}
            onChange={(event) => setPollenBudget(event.target.value)}
            placeholder="例如: 100"
            type="number"
            min="0"
            disabled={hasKey}
            className={cn(hasKey && "bg-zinc-50 opacity-70")}
          />
          {!hasKey && (
            <p className="text-xs text-muted-foreground">
              留空时默认按 100 创建子 Key 预算，便于单 Key 独立查看余额。
            </p>
          )}
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
          <div className="font-semibold">本次新建的子 Key</div>
          <div className="mt-1 break-all font-mono text-[12px]">{latestSecret}</div>
          <div className="mt-1 text-[12px] text-emerald-700">
            仅本次展示，后续页面只保留 masked 信息。
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {!hasKey ? (
          <Button onClick={() => createOrRotateKey(false)} disabled={Boolean(loading)} variant="default">
            {loading === 'create' ? '创建中...' : '创建企业子 Key'}
          </Button>
        ) : null}

        {hasKey ? (
          <Button variant="outline" onClick={syncUsage} disabled={Boolean(loading)}>
            {loading === 'sync' ? '同步中...' : '立即同步余额/用量'}
          </Button>
        ) : null}

        {hasKey ? (
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
