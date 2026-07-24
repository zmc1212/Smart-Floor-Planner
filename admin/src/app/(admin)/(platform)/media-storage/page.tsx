'use client';

import { useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  Cloud,
  Database,
  HardDrive,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  TestTube2,
  XCircle,
} from 'lucide-react';
import { useFetch } from '@/hooks/useFetch';
import { notify } from '@/components/ui/operation-feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type StorageStats = {
  activeCount: number;
  activeBytes: number;
  pendingPurgeCount: number;
  pendingPurgeBytes: number;
  totalCount: number;
  totalBytes: number;
};

type QiniuConfig = {
  id: string;
  key: string;
  name: string;
  driver: 'qiniu';
  accessKeyMasked: string;
  secretKeyMasked: string;
  bucket: string;
  region: string;
  domain: string;
  objectPrefix: string;
  status: 'active' | 'archived';
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string;
  archivedAt: string | null;
  stats: StorageStats | null;
};

type MediaStorageData = {
  activeProviderKey: string;
  activatedAt: string | null;
  grsOutputPersistence: { enabled: boolean };
  encryption: { ready: boolean; dedicated: boolean };
  local: {
    id: 'local';
    key: 'local';
    name: string;
    driver: 'local';
    status: 'active';
    persistent: boolean;
    storageDirectoryConfigured: boolean;
    stats: StorageStats | null;
  };
  configs: QiniuConfig[];
};

type StorageForm = {
  id?: string;
  key: string;
  name: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
  domain: string;
  objectPrefix: string;
};

const REGION_OPTIONS = [
  ['z0', '华东-浙江'],
  ['cn-east-2', '华东-浙江 2'],
  ['z1', '华北-河北'],
  ['z2', '华南-广东'],
  ['na0', '北美-洛杉矶'],
  ['as0', '亚太-新加坡'],
] as const;

function emptyForm(): StorageForm {
  return {
    key: '',
    name: '',
    accessKey: '',
    secretKey: '',
    bucket: '',
    region: 'z0',
    domain: 'https://',
    objectPrefix: '',
  };
}

function editForm(config: QiniuConfig): StorageForm {
  return {
    id: config.id,
    key: config.key,
    name: config.name,
    accessKey: '',
    secretKey: '',
    bucket: config.bucket,
    region: config.region,
    domain: config.domain,
    objectPrefix: config.objectPrefix || '',
  };
}

function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = bytes / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[index]}`;
}

function StatsSummary({ stats }: { stats: StorageStats | null }) {
  return (
    <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/40 p-3 text-sm">
      <div><div className="text-muted-foreground">有效资产</div><div className="mt-1 font-medium">{stats?.activeCount || 0} / {formatBytes(stats?.activeBytes)}</div></div>
      <div><div className="text-muted-foreground">待清理</div><div className="mt-1 font-medium">{stats?.pendingPurgeCount || 0} / {formatBytes(stats?.pendingPurgeBytes)}</div></div>
      <div><div className="text-muted-foreground">累计</div><div className="mt-1 font-medium">{stats?.totalCount || 0} / {formatBytes(stats?.totalBytes)}</div></div>
    </div>
  );
}

function TestStatus({ config }: { config: QiniuConfig }) {
  if (config.lastTestOk === true) {
    return <Badge variant="secondary"><CheckCircle2 className="mr-1 size-3" />测试通过</Badge>;
  }
  if (config.lastTestOk === false) {
    return <Badge variant="destructive"><XCircle className="mr-1 size-3" />测试失败</Badge>;
  }
  return <Badge variant="outline">待测试</Badge>;
}

export default function MediaStoragePage() {
  const { data, isLoading, error, mutate } = useFetch<MediaStorageData>('/api/admin/media-storage');
  const [form, setForm] = useState<StorageForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [workingKey, setWorkingKey] = useState('');
  const [confirmAction, setConfirmAction] = useState<{
    type: 'activate' | 'archive';
    id: string;
    key: string;
    name: string;
  } | null>(null);

  const canSave = useMemo(() => Boolean(
    form?.key.trim()
    && form?.name.trim()
    && form?.bucket.trim()
    && form?.region
    && form?.domain.trim()
    && (form.id || (form.accessKey.trim() && form.secretKey.trim()))
  ), [form]);

  async function requestAction(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.error || '操作失败');
    return result.data;
  }

  const save = async () => {
    if (!form || !canSave) return;
    setSaving(true);
    try {
      await requestAction(form.id ? `/api/admin/media-storage/${form.id}` : '/api/admin/media-storage', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, driver: 'qiniu' }),
      });
      await mutate();
      setForm(null);
      notify.success(form.id ? '媒体存储配置已更新' : '媒体存储配置已创建，请先执行连通测试');
    } catch (saveError) {
      notify.error(saveError instanceof Error ? saveError.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (id: string, key: string) => {
    setWorkingKey(`${key}:test`);
    try {
      await requestAction(`/api/admin/media-storage/${id}/test`, { method: 'POST' });
      await mutate();
      notify.success(key === 'local' ? '本地存储读写删除测试通过' : '七牛云完整连通测试通过');
    } catch (testError) {
      await mutate();
      notify.error(testError instanceof Error ? testError.message : '连通测试失败');
    } finally {
      setWorkingKey('');
    }
  };

  const setGrsOutputPersistence = async (enabled: boolean) => {
    setWorkingKey('grs-output-persistence');
    try {
      await requestAction('/api/admin/media-storage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persistGrsAiOutputs: enabled }),
      });
      await mutate();
      notify.success(enabled ? '后续 GRS 结果图将转存到当前七牛云配置' : '后续 GRS 结果图将保留上游 URL');
    } catch (policyError) {
      notify.error(policyError instanceof Error ? policyError.message : '更新 GRS 结果图存储策略失败');
    } finally {
      setWorkingKey('');
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmAction) return;
    const current = confirmAction;
    setConfirmAction(null);
    setWorkingKey(`${current.key}:${current.type}`);
    try {
      await requestAction(
        `/api/admin/media-storage/${current.id}${current.type === 'activate' ? '/activate' : ''}`,
        { method: current.type === 'activate' ? 'POST' : 'DELETE' }
      );
      await mutate();
      notify.success(current.type === 'activate' ? `${current.name} 已设为新上传默认存储` : `${current.name} 已归档`);
    } catch (actionError) {
      notify.error(actionError instanceof Error ? actionError.message : '操作失败');
    } finally {
      setWorkingKey('');
    }
  };

  if (isLoading) {
    return <main className="mx-auto max-w-7xl px-6 py-10 text-sm text-muted-foreground">正在读取媒体存储配置…</main>;
  }

  if (!data || error) {
    return <main className="mx-auto max-w-7xl px-6 py-10 text-sm text-destructive">媒体存储配置加载失败，请刷新重试。</main>;
  }

  const activeConfig = data.activeProviderKey === 'local'
    ? data.local
    : data.configs.find((config) => config.key === data.activeProviderKey);
  const activeQiniuConfig = data.configs.find((config) => config.key === data.activeProviderKey);
  const canEnableGrsOutputPersistence = Boolean(activeQiniuConfig?.lastTestOk === true);

  return (
    <main className="mx-auto max-w-7xl space-y-7 px-6 py-10">
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><Database size={22} /><h1 className="text-2xl font-semibold">媒体存储配置</h1></div>
          <p className="mt-2 text-sm text-muted-foreground">统一管理服务器本地存储和多套七牛云私有空间配置。配置切换只影响新上传资产。</p>
        </div>
        <Button onClick={() => setForm(emptyForm())} disabled={!data.encryption.ready}><Plus size={16} />新增七牛配置</Button>
      </header>

      {!data.encryption.ready ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          当前生产环境缺少媒体存储加密主密钥，禁止保存云存储凭证。请配置 <code>MEDIA_STORAGE_KEY_ENCRYPTION_SECRET</code>。
        </div>
      ) : !data.encryption.dedicated ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          当前使用兼容加密密钥。正式部署建议单独配置 <code>MEDIA_STORAGE_KEY_ENCRYPTION_SECRET</code>，便于凭证独立轮换。
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" />当前默认存储</CardTitle>
            <CardDescription className="mt-2">新资产写入失败会直接返回失败，不会静默回退到本地。</CardDescription>
          </div>
          <Badge>{data.activeProviderKey}</Badge>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-medium">{activeConfig?.name || data.activeProviderKey}</div>
            <div className="mt-1 text-sm text-muted-foreground">{data.activatedAt ? `最后切换：${new Date(data.activatedAt).toLocaleString()}` : '尚未通过后台切换，使用兼容默认值'}</div>
          </div>
          <div className="text-sm text-muted-foreground">历史资产始终按自身 <code>storageProvider</code> 读取</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GRS AI 结果图存储</CardTitle>
          <CardDescription className="mt-2">
            默认直接使用 GRS 返回的图片 URL，不额外占用平台存储。启用后，后续 GRS 结果图会下载并写入当前默认七牛云配置；历史结果不会迁移。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm">
            <div className="font-medium">
              {data.grsOutputPersistence.enabled ? `已启用：转存至 ${activeConfig?.name || data.activeProviderKey}` : '未启用：直接使用 GRS 图片 URL'}
            </div>
            {!data.grsOutputPersistence.enabled && !canEnableGrsOutputPersistence ? (
              <div className="mt-1 text-amber-700">请先将已测试通过的七牛云配置设为默认，才能启用转存。</div>
            ) : null}
          </div>
          <Button
            variant={data.grsOutputPersistence.enabled ? 'outline' : 'default'}
            disabled={Boolean(workingKey) || (!data.grsOutputPersistence.enabled && !canEnableGrsOutputPersistence)}
            onClick={() => setGrsOutputPersistence(!data.grsOutputPersistence.enabled)}
          >
            {workingKey === 'grs-output-persistence' ? <RefreshCw className="size-4 animate-spin" /> : null}
            {data.grsOutputPersistence.enabled ? '关闭转存' : '启用七牛转存'}
          </Button>
        </CardContent>
      </Card>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card className={data.activeProviderKey === 'local' ? 'border-primary/50' : ''}>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2"><HardDrive className="size-5" />服务器本地存储</CardTitle>
                <CardDescription className="mt-2">内置配置 <code>local</code>，文件由 <code>AI_ASSET_STORAGE_DIR</code> 指向的持久化目录保存。</CardDescription>
              </div>
              {data.activeProviderKey === 'local' ? <Badge>当前默认</Badge> : <Badge variant="outline">可用</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <StatsSummary stats={data.local.stats} />
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className={data.local.persistent ? 'text-emerald-700' : 'text-amber-700'}>{data.local.persistent ? '已配置持久化目录' : '未显式配置持久化目录'}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={Boolean(workingKey)} onClick={() => testConnection('local', 'local')}><TestTube2 size={15} />测试</Button>
                {data.activeProviderKey !== 'local' ? <Button size="sm" disabled={Boolean(workingKey)} onClick={() => setConfirmAction({ type: 'activate', id: 'local', key: 'local', name: data.local.name })}>设为默认</Button> : null}
              </div>
            </div>
          </CardContent>
        </Card>

        {data.configs.map((config) => {
          const isActive = data.activeProviderKey === config.key;
          const archived = config.status === 'archived';
          return (
            <Card key={config.id} className={isActive ? 'border-primary/50' : archived ? 'opacity-75' : ''}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2"><Cloud className="size-5" />{config.name}</CardTitle>
                    <CardDescription className="mt-2"><code>{config.key}</code> · {config.bucket} · {config.region}</CardDescription>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {isActive ? <Badge>当前默认</Badge> : null}
                    {archived ? <Badge variant="outline">已归档</Badge> : <TestStatus config={config} />}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div><span className="text-muted-foreground">AccessKey：</span><code>{config.accessKeyMasked}</code></div>
                  <div><span className="text-muted-foreground">SecretKey：</span><code>{config.secretKeyMasked}</code></div>
                  <div className="sm:col-span-2 break-all"><span className="text-muted-foreground">下载域名：</span>{config.domain}</div>
                  <div className="sm:col-span-2"><span className="text-muted-foreground">存储前缀：</span><code>{config.objectPrefix || '（Bucket 根目录）'}</code></div>
                </div>
                <StatsSummary stats={config.stats} />
                <div className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
                  <div>{config.lastTestMessage || '尚未执行连通测试'}</div>
                  {config.lastTestedAt ? <div className="mt-1">最后测试：{new Date(config.lastTestedAt).toLocaleString()}</div> : null}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" size="sm" disabled={archived || Boolean(workingKey)} onClick={() => setForm(editForm(config))}><Pencil size={15} />编辑/轮换密钥</Button>
                  <Button variant="outline" size="sm" disabled={archived || Boolean(workingKey)} onClick={() => testConnection(config.id, config.key)}>{workingKey === `${config.key}:test` ? <RefreshCw className="size-4 animate-spin" /> : <TestTube2 size={15} />}测试</Button>
                  {!isActive && !archived ? <Button size="sm" disabled={config.lastTestOk !== true || Boolean(workingKey)} onClick={() => setConfirmAction({ type: 'activate', id: config.id, key: config.key, name: config.name })}>设为默认</Button> : null}
                  {!isActive && !archived ? <Button variant="ghost" size="sm" disabled={Boolean(workingKey)} onClick={() => setConfirmAction({ type: 'archive', id: config.id, key: config.key, name: config.name })}><Archive size={15} />归档</Button> : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {!data.configs.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">尚未配置七牛云。新增配置并通过完整连通测试后即可设为默认。</div>
      ) : null}

      <Dialog open={Boolean(form)} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? '编辑七牛云配置' : '新增七牛云配置'}</DialogTitle>
            <DialogDescription>Bucket 必须为私有空间。密钥仅在服务端加密保存，页面不会返回明文或密文。</DialogDescription>
          </DialogHeader>
          {form ? (
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="space-y-2"><Label>配置标识</Label><Input value={form.key} disabled={Boolean(form.id)} onChange={(event) => setForm({ ...form, key: event.target.value.toLowerCase() })} placeholder="qiniu-primary" /><p className="text-xs text-muted-foreground">创建后不可修改，资产会保存此稳定标识。</p></div>
              <div className="space-y-2"><Label>名称</Label><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="七牛主存储" /></div>
              <div className="space-y-2"><Label>{form.id ? 'AccessKey（留空保留）' : 'AccessKey'}</Label><Input type="password" autoComplete="new-password" value={form.accessKey} onChange={(event) => setForm({ ...form, accessKey: event.target.value })} /></div>
              <div className="space-y-2"><Label>{form.id ? 'SecretKey（留空保留）' : 'SecretKey'}</Label><Input type="password" autoComplete="new-password" value={form.secretKey} onChange={(event) => setForm({ ...form, secretKey: event.target.value })} /></div>
              <div className="space-y-2"><Label>Bucket</Label><Input value={form.bucket} onChange={(event) => setForm({ ...form, bucket: event.target.value })} placeholder="private-media" /></div>
              <div className="space-y-2"><Label>区域</Label><Select value={form.region} onValueChange={(region) => setForm({ ...form, region })}><SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger><SelectContent>{REGION_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}（{value}）</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2 sm:col-span-2"><Label>存储前缀（可选）</Label><Input value={form.objectPrefix} onChange={(event) => setForm({ ...form, objectPrefix: event.target.value })} placeholder="smart-floor/ai-assets/" /><p className="text-xs text-muted-foreground">相当于 Bucket 内的上传文件夹。保存后只影响新上传文件；历史资产位置不会改变。仅支持字母、数字、点、下划线、连字符和斜杠。</p></div>
              <div className="space-y-2 sm:col-span-2"><Label>HTTPS 下载域名</Label><Input value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} placeholder="https://media.example.com" /><p className="text-xs text-muted-foreground">只能填写域名根地址，并需加入微信小程序下载合法域名。</p></div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>取消</Button>
            <Button onClick={save} disabled={!canSave || saving}>{saving ? <RefreshCw className="size-4 animate-spin" /> : null}{saving ? '保存中…' : '保存配置'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirmAction)} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.type === 'activate' ? '确认切换默认媒体存储？' : '确认归档媒体存储配置？'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === 'activate'
                ? `切换后仅新上传资产写入“${confirmAction?.name}”，历史资产位置不会变化。`
                : `归档后“${confirmAction?.name}”不能再写入、测试或重新激活，但仍会继续读取和删除历史资产。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirmedAction}>{confirmAction?.type === 'activate' ? '确认切换' : '确认归档'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
