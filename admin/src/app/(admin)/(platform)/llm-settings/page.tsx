'use client';

/*
 * THESIS: One calm control room for the platform's shared OpenAI-compatible LLM connection.
 * OWN-WORLD: Existing green Admin tokens, white operational surfaces, and restrained status color.
 * STORY: Choose a service, verify its exact model, save encrypted credentials, then confirm reachability.
 * FIRST VIEWPORT: Configuration owns the wide left column; persistent service truth stays visible at right.
 * FORM: A faithful operational adaptation of the supplied Toonflow split-panel reference inside Admin Pro.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Divider,
  Flex,
  Input,
  Result,
  Select,
  Skeleton,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import {
  Bot,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { isShorterModelPrefix, llmModelPriceLabel, resolveLlmModelFree, shouldShowLlmModelOption } from '@/lib/llm-model-options';
import { ZHIPU_BASE_URL } from '@/lib/ai/providers/zhipu';
import { QINIU_BASE_URL, QINIU_CONATUS_MODEL } from '@/lib/ai/providers/qiniu';

type LlmConfig = {
  enabled: boolean;
  providerKey: string;
  baseUrl: string;
  model: string;
  apiKeyMasked: string | null;
  hasApiKey: boolean;
  credentialReady: boolean;
  available: boolean;
  unavailableReason: string | null;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  lastTestAt: string | null;
  routingSource: 'llm_settings' | 'ai_providers';
  fallbackOnError: false;
  reuseLlmCredentials: boolean;
  providerProfiles: Record<string, ConnectionProfile>;
  linkedLlm: { providerKey: string; baseUrl: string; hasApiKey: boolean; apiKeyMasked: string | null } | null;
};

type ConnectionProfile = Pick<LlmConfig, 'providerKey' | 'baseUrl' | 'model' | 'hasApiKey' | 'apiKeyMasked'
  | 'lastTestStatus' | 'lastTestMessage' | 'lastTestAt'>;
type TestResult = Pick<LlmConfig, 'lastTestStatus' | 'lastTestMessage' | 'lastTestAt'>;
type ModelPurpose = 'chat' | 'vision';

const VISION_MODELS: Record<string, string[]> = {
  siliconflow: ['Qwen/Qwen3-VL-8B-Instruct', 'zai-org/GLM-4.5V'],
  dashscope: ['qwen-vl-plus', 'qwen-vl-max'],
  zhipu: ['glm-4.6v-flash', 'glm-4.6v'],
  qiniu: [QINIU_CONATUS_MODEL],
  modelscope: ['Qwen/Qwen2.5-VL-7B-Instruct'],
  ollama: ['llava'],
  lmstudio: [],
  custom: [],
};

type CatalogModel = {
  id: string;
  label: string;
  free: boolean | null;
  ownedBy: string | null;
};

type ProviderPreset = {
  label: string;
  value: string;
  baseUrl: string;
  model: string;
  docUrl: string;
  recommendedModels: Array<{ id: string; label: string }>;
};

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    label: '七牛云 Conatus（限时免费至 2026-11-30）',
    value: 'qiniu',
    baseUrl: QINIU_BASE_URL,
    model: QINIU_CONATUS_MODEL,
    docUrl: 'https://portal.qiniu.com/ai-inference/api-key',
    recommendedModels: [{ id: QINIU_CONATUS_MODEL, label: 'Conatus Free' }],
  },
  {
    label: '硅基流动（OpenAI 兼容）',
    value: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    docUrl: 'https://cloud.siliconflow.cn/account/ak',
    recommendedModels: [
      { id: 'Qwen/Qwen2.5-7B-Instruct', label: 'Qwen2.5-7B' },
      { id: 'Qwen/Qwen3-8B', label: 'Qwen3-8B' },
      { id: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B', label: 'DeepSeek-R1 蒸馏 8B' },
    ],
  },
  {
    label: '阿里云百炼 / 通义千问',
    value: 'dashscope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    docUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    recommendedModels: [
      { id: 'qwen-plus', label: 'qwen-plus' },
      { id: 'qwen-turbo', label: 'qwen-turbo' },
      { id: 'qwen-max', label: 'qwen-max' },
    ],
  },
  {
    label: 'DeepSeek 官方平台',
    value: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    docUrl: 'https://platform.deepseek.com/api_keys',
    recommendedModels: [
      { id: 'deepseek-chat', label: 'deepseek-chat' },
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner' },
    ],
  },
  {
    label: '智谱官方',
    value: 'zhipu',
    baseUrl: ZHIPU_BASE_URL,
    model: 'glm-4.7-flash',
    docUrl: 'https://bigmodel.cn/apikey/platform',
    recommendedModels: [
      { id: 'glm-4.7-flash', label: 'GLM-4.7-Flash' },
      { id: 'glm-4.7', label: 'GLM-4.7' },
      { id: 'glm-5.3', label: 'GLM-5.3' },
    ],
  },
  {
    label: 'ModelScope 魔搭社区',
    value: 'modelscope',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    model: 'deepseek-ai/DeepSeek-V4-Flash-0731',
    docUrl: 'https://modelscope.cn/my/access/token',
    recommendedModels: [
      { id: 'deepseek-ai/DeepSeek-V4-Flash-0731', label: 'DeepSeek-V4-Flash' },
      { id: 'MiniMax/MiniMax-M1-80k', label: 'MiniMax-M1-80k' },
    ],
  },
  {
    label: 'Ollama 本地服务',
    value: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    docUrl: 'https://ollama.com/library',
    recommendedModels: [
      { id: 'qwen2.5:7b', label: 'qwen2.5:7b' },
      { id: 'qwen2.5:14b', label: 'qwen2.5:14b' },
      { id: 'deepseek-r1:7b', label: 'deepseek-r1:7b' },
    ],
  },
  {
    label: 'LM Studio 本地服务',
    value: 'lmstudio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'qwen2.5-7b-instruct',
    docUrl: 'https://lmstudio.ai/',
    recommendedModels: [
      { id: 'qwen2.5-7b-instruct', label: 'qwen2.5-7b-instruct' },
      { id: 'deepseek-r1-distill-qwen-7b', label: 'deepseek-r1-distill-qwen-7b' },
    ],
  },
  {
    label: '自定义 OpenAI 兼容接口',
    value: 'custom',
    baseUrl: '',
    model: '',
    docUrl: '',
    recommendedModels: [],
  },
];

const EMPTY_CONFIG: LlmConfig = {
  enabled: false,
  providerKey: 'siliconflow',
  baseUrl: 'https://api.siliconflow.cn/v1',
  model: 'Qwen/Qwen2.5-7B-Instruct',
  apiKeyMasked: null,
  hasApiKey: false,
  credentialReady: true,
  available: false,
  unavailableReason: '大模型服务尚未启用。',
  lastTestStatus: null,
  lastTestMessage: null,
  lastTestAt: null,
  routingSource: 'ai_providers',
  fallbackOnError: false,
  reuseLlmCredentials: false,
  providerProfiles: {},
  linkedLlm: null,
};

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(url.endsWith('/test') ? 110_000 : 40_000) });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || '请求失败');
  return result.data;
}

export default function LlmSettingsPage() {
  const [llmRevision, setLlmRevision] = useState(0);
  return (
    <div className="admin-page-frame">
      <PageContainer breadcrumbRender={false} className="admin-page-container"
        title={<Space size={12}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bot size={21} /></span>LLM大模型配置</Space>}
        subTitle="独立配置文本与视觉模型，按用途管理服务商和加密凭据">
        <Tabs items={[
          { key: 'chat', label: 'LLM 大模型', children: <LlmSettingsEditor purpose="chat" onSaved={() => setLlmRevision((value) => value + 1)} /> },
          { key: 'vision', label: 'VLM 视觉模型', children: <LlmSettingsEditor key={llmRevision} purpose="vision" /> },
        ]} />
      </PageContainer>
    </div>
  );
}

function LlmSettingsEditor({ purpose, onSaved }: { purpose: ModelPurpose; onSaved?: () => void }) {
  const vision = purpose === 'vision';
  const serviceLabel = vision ? 'VLM 视觉模型' : 'LLM 大模型';
  const { user } = useCurrentUser();
  const canManage = ['super_admin', 'admin'].includes(user?.role || '');
  const [config, setConfig] = useState<LlmConfig>(EMPTY_CONFIG);
  const [enabled, setEnabled] = useState(false);
  const [providerKey, setProviderKey] = useState('siliconflow');
  const [baseUrl, setBaseUrl] = useState(EMPTY_CONFIG.baseUrl);
  const [model, setModel] = useState(EMPTY_CONFIG.model);
  const [selectedModel, setSelectedModel] = useState(EMPTY_CONFIG.model);
  const [apiKey, setApiKey] = useState('');
  const [reuseLlmCredentials, setReuseLlmCredentials] = useState(false);
  const drafts = useRef<Record<string, { baseUrl: string; model: string; apiKey: string; catalogModels: CatalogModel[] }>>({});
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [lastTestSignature, setLastTestSignature] = useState('');
  const [testResult, setTestResult] = useState<TestResult>(EMPTY_CONFIG);
  const [loadError, setLoadError] = useState('');

  const applyConfig = useCallback((next: LlmConfig) => {
    setConfig(next);
    setEnabled(next.enabled);
    setProviderKey(next.providerKey || 'custom');
    setBaseUrl(next.baseUrl);
    setModel(next.model);
    setSelectedModel(next.model);
    setReuseLlmCredentials(next.reuseLlmCredentials);
    setTestResult(next);
    delete drafts.current[next.providerKey];
    setLastTestSignature(next.lastTestStatus
      ? JSON.stringify({ providerKey: next.reuseLlmCredentials ? next.linkedLlm?.providerKey : next.providerKey,
        baseUrl: next.reuseLlmCredentials ? next.linkedLlm?.baseUrl : next.baseUrl,
        model: next.model, apiKey: '__saved__', reuseLlmCredentials: next.reuseLlmCredentials })
      : '');
  }, []);

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    try {
      applyConfig(await requestJson(`/api/platform/llm-config?purpose=${purpose}`));
      setLoadError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取模型配置失败';
      setLoadError(message);
      notify.error(message);
    } finally {
      setLoading(false);
    }
  }, [applyConfig, canManage, purpose]);

  useEffect(() => {
    void load();
  }, [load]);

  const presets = vision ? PROVIDER_PRESETS.filter((preset) => preset.value !== 'deepseek') : PROVIDER_PRESETS;
  const effectiveProviderKey = reuseLlmCredentials ? config.linkedLlm?.providerKey || providerKey : providerKey;
  const effectiveBaseUrl = reuseLlmCredentials ? config.linkedLlm?.baseUrl || '' : baseUrl;
  const currentPreset = presets.find((preset) => preset.value === effectiveProviderKey)
    || PROVIDER_PRESETS.at(-1)!;
  const localProvider = /^http[s]?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)([:/]|$)/i.test(effectiveBaseUrl);
  const freeOnly = !vision && (providerKey === 'siliconflow' || localProvider);
  const savedProfile = config.providerProfiles[providerKey];
  const savedCredentialMatches = savedProfile?.baseUrl === baseUrl.trim().replace(/\/+$/, '');
  const hasSavedKey = reuseLlmCredentials ? config.linkedLlm?.hasApiKey : savedCredentialMatches && savedProfile?.hasApiKey;
  const savedKeyMasked = reuseLlmCredentials ? config.linkedLlm?.apiKeyMasked : savedCredentialMatches ? savedProfile?.apiKeyMasked : null;
  const busy = saving || testing || catalogLoading;
  const selectedModelFree = resolveLlmModelFree({
    baseUrl: effectiveBaseUrl, model, local: localProvider,
    catalogFree: catalogModels.find((item) => item.id === model)?.free,
  });

  const modelOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ value: string; label: string }> = [];
    const add = (id: string, label = id, free: boolean | null = null) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      const modelFree = resolveLlmModelFree({
        baseUrl: effectiveBaseUrl, model: id, catalogFree: free, local: localProvider,
      });
      options.push({ value: id, label: `${label} · ${llmModelPriceLabel(modelFree)}` });
    };
    catalogModels.forEach((item) => add(item.id, item.label, item.free));
    if (!isShorterModelPrefix(selectedModel, model)) add(selectedModel);
    if (vision) (VISION_MODELS[effectiveProviderKey] || []).forEach((id) => add(id));
    else currentPreset.recommendedModels.forEach((item) => add(item.id, item.label));
    return options;
  }, [catalogModels, currentPreset, effectiveBaseUrl, effectiveProviderKey, localProvider, model, selectedModel, vision]);

  const changePreset = (value: string) => {
    const preset = PROVIDER_PRESETS.find((item) => item.value === value);
    drafts.current[providerKey] = { baseUrl, model, apiKey, catalogModels };
    const saved = config.providerProfiles[value];
    const draft = drafts.current[value];
    const nextBaseUrl = draft?.baseUrl ?? saved?.baseUrl ?? preset?.baseUrl ?? '';
    const nextModel = draft?.model ?? saved?.model ?? (vision ? VISION_MODELS[value]?.[0] || '' : preset?.model || '');
    setProviderKey(value);
    setCatalogModels(draft?.catalogModels || []);
    setBaseUrl(nextBaseUrl);
    setModel(nextModel);
    setSelectedModel(nextModel);
    setApiKey(draft?.apiKey || '');
    setTestResult(saved || EMPTY_CONFIG);
    setLastTestSignature(saved?.lastTestStatus ? JSON.stringify({ providerKey: value, baseUrl: saved.baseUrl,
      model: saved.model, apiKey: '__saved__', reuseLlmCredentials: false }) : '');
  };

  const payload = () => ({
    enabled,
    providerKey,
    baseUrl,
    model,
    purpose,
    reuseLlmCredentials,
    apiKey: reuseLlmCredentials ? undefined : apiKey || undefined,
  });
  const currentTestSignature = JSON.stringify({
    providerKey: effectiveProviderKey,
    baseUrl: effectiveBaseUrl.trim().replace(/\/+$/, ''),
    model: model.trim(),
    apiKey: reuseLlmCredentials ? '__saved__' : apiKey || '__saved__',
    reuseLlmCredentials,
  });

  const save = async () => {
    setSaving(true);
    try {
      const next = await requestJson('/api/platform/llm-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      applyConfig(next);
      setApiKey('');
      onSaved?.();
      notify.success(`${serviceLabel}配置已保存`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存 LLM 大模型配置失败');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const tested = await requestJson('/api/platform/llm-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      setTestResult({
        lastTestStatus: tested.status,
        lastTestMessage: tested.message,
        lastTestAt: tested.testedAt,
      });
      setLastTestSignature(currentTestSignature);
      notify.success(`${serviceLabel}连接测试成功`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LLM 大模型连接测试失败';
      setTestResult({
        lastTestStatus: '失败',
        lastTestMessage: message,
        lastTestAt: new Date().toISOString(),
      });
      setLastTestSignature(currentTestSignature);
      notify.error(message);
    } finally {
      setTesting(false);
    }
  };

  const loadModels = async () => {
    setCatalogLoading(true);
    try {
      const data = await requestJson('/api/platform/llm-config/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload(), freeOnly }),
      });
      setCatalogModels(data.models);
      if (data.models.length) notify.success(`已拉取 ${data.models.length} 个可用模型`);
      else notify.warning(data.message || '上游未返回可用模型');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '拉取模型目录失败');
    } finally {
      setCatalogLoading(false);
    }
  };

  if (user && !canManage) {
    return <Result status="403" title="无权访问" subTitle="仅平台 admin / super_admin 可以配置全局 LLM 大模型服务。" />;
  }
  if (loadError && !loading) return <Alert showIcon type="error" message="读取配置失败" description={loadError}
    action={<Button onClick={() => void load()}>重试</Button>} />;

  const currentDraftTested = lastTestSignature === currentTestSignature;
  const testedSuccessfully = enabled && currentDraftTested && testResult.lastTestStatus === '成功';
  const testedFailed = enabled && currentDraftTested && testResult.lastTestStatus === '失败';
  const draftAvailable = enabled
    && Boolean(model.trim())
    && config.credentialReady
    && (localProvider || (!reuseLlmCredentials && Boolean(apiKey)) || hasSavedKey);
  const draftUnavailableReason = !enabled
    ? '大模型服务尚未启用。'
    : !model.trim()
      ? '尚未配置模型名称。'
      : !config.credentialReady
        ? '部署环境缺少可用的凭证加密密钥。'
        : !localProvider && (reuseLlmCredentials || !apiKey) && !hasSavedKey
          ? '尚未配置 API Key / Access Token。'
          : null;
  const statusColor = testedSuccessfully ? 'success' : testedFailed ? 'error' : draftAvailable ? 'processing' : 'warning';
  const statusText = testedSuccessfully
    ? '大模型服务连接正常'
    : testedFailed
      ? '大模型连接测试失败'
    : draftAvailable
      ? '配置完整，等待连接测试'
      : '大模型服务未就绪';
  const llmCurrentlyOverridesChat = config.routingSource === 'llm_settings';
  const routingDraftChanged = enabled !== config.enabled;

  return (
    <>
        {!config.credentialReady && !loading ? (
          <Alert
            className="mb-4"
            showIcon
            type="warning"
            message="凭证加密密钥未就绪"
            description="生产环境请配置 AI_PROVIDER_KEY_ENCRYPTION_SECRET 或 JWT_SECRET，否则无法安全保存新的 API Key。"
          />
        ) : null}

        {!loading ? (
          <Alert
            className="mb-4"
            showIcon
            type={llmCurrentlyOverridesChat ? 'success' : 'info'}
            message={llmCurrentlyOverridesChat
              ? `当前${vision ? '视觉分析' : ' Chat 请求'}由${serviceLabel}配置接管`
              : `当前${vision ? '视觉分析' : ' Chat 请求'}沿用 AI 供应商默认路由`}
            description={llmCurrentlyOverridesChat
              ? vision ? '参考图分析只使用本页视觉模型；连接失败时不会静默切回 AI 供应商。生图、改图与文本模型路由保持独立。'
                : '设计建议、提示词优化与纯文本编译只使用本页配置；连接失败时不会静默切回 AI 供应商。视觉分析由 VLM 页单独配置，生图和改图仍使用 AI 供应商。'
              : `${vision ? '视觉' : '文本'}覆盖未启用，相关请求继续按照 AI 供应商的能力和优先级执行。`}
          />
        ) : null}

        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="admin-panel-card" loading={loading}>
            <Flex vertical gap={20}>
              <Flex align="center" justify="space-between" gap={20}>
                <div>
                  <Typography.Text strong>{vision ? '启用 VLM 视觉覆盖' : '启用 LLM Chat 覆盖'}</Typography.Text>
                  <Typography.Paragraph type="secondary" className="!mb-0 !mt-1">
                    保存后，{vision ? '视觉分析' : '纯文本 Chat'}请求只走本页配置；关闭后恢复 AI 供应商默认路由。
                  </Typography.Paragraph>
                </div>
                <Switch disabled={busy} checked={enabled} onChange={setEnabled} aria-label={vision ? '启用 VLM 视觉覆盖' : '启用 LLM Chat 覆盖'} />
              </Flex>

              {routingDraftChanged ? (
                <Alert
                  showIcon
                  type="warning"
                  message="路由变更尚未保存"
                  description={enabled
                    ? `保存后，新的${vision ? '视觉分析' : '纯文本 Chat'}请求将改走本页配置。`
                    : `保存后，新的${vision ? '视觉分析' : '纯文本 Chat'}请求将恢复 AI 供应商默认路由。`}
                />
              ) : null}

              <Divider className="!my-0" />

              {vision ? (
                <Flex align="center" justify="space-between" gap={20}>
                  <div>
                    <Typography.Text strong>复用大模型凭据</Typography.Text>
                    <Typography.Paragraph type="secondary" className="!mb-0 !mt-1">
                      使用已保存的 LLM 接口地址与 Key，视觉模型名称在本页独立选择。
                    </Typography.Paragraph>
                  </div>
                  <Switch checked={reuseLlmCredentials} disabled={busy} aria-label="复用大模型凭据"
                    onChange={(value) => { setReuseLlmCredentials(value); setCatalogModels([]); }} />
                </Flex>
              ) : null}

              {reuseLlmCredentials ? <Alert showIcon type="info" message="接口地址与 Key 来自 LLM 大模型"
                description={`当前已保存地址：${config.linkedLlm?.baseUrl || '尚未配置'}。${config.linkedLlm?.hasApiKey ? '已保存加密凭据。' : '如为云端服务，请先在 LLM 页保存 Key。'}`} /> : null}

              {!reuseLlmCredentials ? <div>
                <Typography.Text strong>快速服务预设</Typography.Text>
                <Select
                  className="mt-2 w-full"
                  value={providerKey}
                  aria-label={`${serviceLabel}服务商`}
                  disabled={busy}
                  onChange={changePreset}
                  options={presets.map(({ value, label }) => ({ value, label }))}
                />
              </div> : null}

              {!reuseLlmCredentials ? <div>
                <Flex justify="space-between" align="center" gap={12} wrap="wrap">
                  <Typography.Text strong>Base URL（接口地址）</Typography.Text>
                  {currentPreset.docUrl ? (
                    <Typography.Link href={currentPreset.docUrl} target="_blank" rel="noreferrer">
                      <Space size={4}>{localProvider ? '查看服务文档' : '获取访问 Token'}<ExternalLink size={13} /></Space>
                    </Typography.Link>
                  ) : null}
                </Flex>
                <Input
                  className="mt-2"
                  value={baseUrl}
                  disabled={busy}
                  aria-label={`${serviceLabel}接口地址`}
                  name={`platform-${purpose}-endpoint`}
                  autoComplete="off"
                  data-form-type="other"
                  onChange={(event) => { setBaseUrl(event.target.value); setCatalogModels([]); }}
                  placeholder="https://api.example.com/v1"
                />
              </div> : null}

              <div>
                <Flex justify="space-between" align="center" gap={12} wrap="wrap">
                  <Space size={8}>
                    <Typography.Text strong>{vision ? 'Model（视觉模型名称）' : 'Model（模型名称）'}</Typography.Text>
                    <Tag color={selectedModelFree === true ? 'success' : selectedModelFree === false ? 'warning' : 'default'}>
                      {llmModelPriceLabel(selectedModelFree)}
                    </Tag>
                  </Space>
                  <Button
                    size="small"
                    icon={<RefreshCw size={14} />}
                    loading={catalogLoading}
                    disabled={saving || testing}
                    onClick={() => void loadModels()}
                  >
                    拉取官方列表
                  </Button>
                </Flex>
                <AutoComplete
                  className="mt-2 w-full"
                  disabled={busy}
                  value={model}
                  options={modelOptions}
                  defaultActiveFirstOption={false}
                  onChange={setModel}
                  onSelect={(value) => { setModel(value); setSelectedModel(value); }}
                  filterOption={(input, option) => shouldShowLlmModelOption(input, option, modelOptions)}
                  listHeight={320}
                >
                  <Input aria-label={vision ? '视觉模型名称' : '模型名称'} name={`platform-${purpose}-model-id`}
                    autoComplete="off" spellCheck={false} autoCapitalize="none" autoCorrect="off"
                    data-form-type="other" data-lpignore="true" data-1p-ignore="true" data-bwignore="true"
                    placeholder="选择或输入模型 ID" />
                </AutoComplete>
                <Typography.Paragraph type="secondary" className="!mb-0 !mt-2 !text-xs">
                  {vision ? '可选择支持图片输入的模型，或手动填写自定义模型别名；测试会发送内置色块图片验证视觉能力，云端视觉模型可能按量计费。' : localProvider
                    ? '目录会显示后台服务环境中已安装的模型，名称须与服务端完全一致。'
                    : freeOnly
                      ? '优先展示上游目录中可确认免费的对话模型；也可直接输入准确的模型 ID。'
                      : '可从官方目录选择，也可直接输入 OpenAI 兼容服务支持的模型 ID。'}
                </Typography.Paragraph>
              </div>

              {!reuseLlmCredentials ? <form autoComplete="off" onSubmit={(event) => event.preventDefault()}>
                <Typography.Text strong>API Key / Access Token</Typography.Text>
                <Input.Password
                  className="mt-2"
                  value={apiKey}
                  disabled={busy}
                  aria-label={`${serviceLabel} API Key`}
                  name={`platform-${purpose}-api-token`}
                  autoComplete="new-password"
                  data-form-type="other"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-bwignore="true"
                  onChange={(event) => setApiKey(event.target.value)}
                  prefix={<KeyRound size={15} className="text-muted-foreground" />}
                  placeholder={localProvider ? '本地服务通常可留空' : savedKeyMasked || '输入当前服务商的 API Key / Token'}
                />
                {hasSavedKey && !apiKey ? (
                  <Typography.Paragraph type="secondary" className="!mb-0 !mt-2 !text-xs">
                    当前服务商和接口地址已保存加密凭据；留空将保持不变，切换服务商后可自动恢复。
                  </Typography.Paragraph>
                ) : null}
              </form> : null}

              {providerKey === 'modelscope' ? (
                <Alert showIcon type="warning" message="魔搭调用可能消耗账户魔粒" description="费用与免费额度以服务平台当前规则为准，保存前请在官方控制台核对。" />
              ) : null}

              <Flex gap={12} wrap="wrap">
                <Button type="primary" loading={saving} disabled={testing || catalogLoading} onClick={() => void save()}>保存配置</Button>
                <Button icon={<CheckCircle2 size={15} />} loading={testing} disabled={saving || catalogLoading} onClick={() => void testConnection()}>测试连接</Button>
              </Flex>
            </Flex>
          </Card>

          <Card className="admin-panel-card h-full">
            {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : (
              <Flex vertical justify="space-between" className="h-full min-h-[460px]" gap={28}>
                <div>
                  <Typography.Title level={5} className="!mb-3">服务状态</Typography.Title>
                  <Tag color={statusColor} className="!m-0">{statusText}</Tag>
                  {draftUnavailableReason ? (
                    <Typography.Paragraph type="secondary" className="!mt-3">{draftUnavailableReason}</Typography.Paragraph>
                  ) : null}

                  <Divider />
                  <Space direction="vertical" size={18} className="w-full">
                    <div>
                      <Typography.Text type="secondary">当前生效来源</Typography.Text>
                      <div className="mt-1">
                        <Tag color={llmCurrentlyOverridesChat ? 'success' : 'default'} className="!m-0">
                          {llmCurrentlyOverridesChat ? `${serviceLabel}配置 · 严格覆盖` : 'AI 供应商默认路由'}
                        </Tag>
                      </div>
                    </div>
                    <div>
                      <Typography.Text type="secondary">当前模型</Typography.Text>
                      <Typography.Paragraph className="!mb-0 !mt-1 break-all font-mono !text-xs">
                        {model || '未配置'}
                      </Typography.Paragraph>
                    </div>
                    <div>
                      <Typography.Text type="secondary">最近连接测试</Typography.Text>
                      <Typography.Paragraph className="!mb-0 !mt-1">
                        {currentDraftTested && testResult.lastTestStatus && testResult.lastTestAt
                          ? `${testResult.lastTestStatus} · ${new Date(testResult.lastTestAt).toLocaleString('zh-CN', { hour12: false })}`
                          : '尚未测试当前配置'}
                      </Typography.Paragraph>
                      {currentDraftTested && testResult.lastTestMessage ? (
                        <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 break-all !text-xs">
                          {testResult.lastTestMessage}
                        </Typography.Paragraph>
                      ) : null}
                    </div>
                  </Space>
                </div>

                <Alert
                  showIcon
                  type="info"
                  icon={<Sparkles size={16} />}
                  message={localProvider ? '本地服务说明' : 'OpenAI 兼容协议'}
                  description={localProvider
                    ? '连接发生在后台服务器运行环境；容器部署时，127.0.0.1 指向容器自身。Ollama 首次加载模型可能需要较长时间。'
                    : `系统使用 /models 拉取目录，并通过 /chat/completions 发起${vision ? '带图' : '文本'}连接测试。费用、限额与数据政策由所选服务商决定。`}
                />
              </Flex>
            )}
          </Card>
        </div>
    </>
  );
}
