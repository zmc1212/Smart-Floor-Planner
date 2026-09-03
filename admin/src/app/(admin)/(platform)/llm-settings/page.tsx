'use client';

/*
 * THESIS: One calm control room for the platform's shared OpenAI-compatible LLM connection.
 * OWN-WORLD: Existing green Admin tokens, white operational surfaces, and restrained status color.
 * STORY: Choose a service, verify its exact model, save encrypted credentials, then confirm reachability.
 * FIRST VIEWPORT: Configuration owns the wide left column; persistent service truth stays visible at right.
 * FORM: A faithful operational adaptation of the supplied Toonflow split-panel reference inside Admin Pro.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { isShorterModelPrefix, shouldShowLlmModelOption } from '@/lib/llm-model-options';

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
};

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || '请求失败');
  return result.data;
}

export default function LlmSettingsPage() {
  const { user } = useCurrentUser();
  const canManage = ['super_admin', 'admin'].includes(user?.role || '');
  const [config, setConfig] = useState<LlmConfig>(EMPTY_CONFIG);
  const [enabled, setEnabled] = useState(false);
  const [providerKey, setProviderKey] = useState('siliconflow');
  const [baseUrl, setBaseUrl] = useState(EMPTY_CONFIG.baseUrl);
  const [model, setModel] = useState(EMPTY_CONFIG.model);
  const [apiKey, setApiKey] = useState('');
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [lastTestSignature, setLastTestSignature] = useState('');

  const applyConfig = useCallback((next: LlmConfig) => {
    setConfig(next);
    setEnabled(next.enabled);
    setProviderKey(next.providerKey || 'custom');
    setBaseUrl(next.baseUrl);
    setModel(next.model);
    setLastTestSignature(next.lastTestStatus
      ? JSON.stringify({ baseUrl: next.baseUrl, model: next.model, apiKey: '__saved__' })
      : '');
  }, []);

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    try {
      applyConfig(await requestJson('/api/platform/llm-config'));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取 LLM 大模型配置失败');
    } finally {
      setLoading(false);
    }
  }, [applyConfig, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentPreset = PROVIDER_PRESETS.find((preset) => preset.value === providerKey)
    || PROVIDER_PRESETS.at(-1)!;
  const localProvider = providerKey === 'ollama' || providerKey === 'lmstudio';
  const freeOnly = providerKey === 'siliconflow' || localProvider;

  const modelOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ value: string; label: string }> = [];
    const add = (id: string, label = id, free: boolean | null = null) => {
      if (!id || seen.has(id)) return;
      if (isShorterModelPrefix(id, model)) return;
      seen.add(id);
      options.push({ value: id, label: free ? `${label} · 免费` : label });
    };
    catalogModels.forEach((item) => add(item.id, item.label, item.free));
    add(model);
    currentPreset.recommendedModels.forEach((item) => add(item.id, item.label));
    return options;
  }, [catalogModels, currentPreset, model]);

  const changePreset = (value: string) => {
    const preset = PROVIDER_PRESETS.find((item) => item.value === value);
    setProviderKey(value);
    setCatalogModels([]);
    if (preset && value !== 'custom') {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  };

  const payload = () => ({
    enabled,
    providerKey,
    baseUrl,
    model,
    apiKey: apiKey || undefined,
  });
  const currentTestSignature = JSON.stringify({
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    apiKey: apiKey || '__saved__',
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
      notify.success('LLM 大模型配置已保存');
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
      setConfig((current) => ({
        ...current,
        lastTestStatus: tested.status,
        lastTestMessage: tested.message,
        lastTestAt: tested.testedAt,
      }));
      setLastTestSignature(currentTestSignature);
      notify.success('大模型连接测试成功');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LLM 大模型连接测试失败';
      setConfig((current) => ({
        ...current,
        lastTestStatus: '失败',
        lastTestMessage: message,
        lastTestAt: new Date().toISOString(),
      }));
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

  const currentDraftTested = lastTestSignature === currentTestSignature;
  const testedSuccessfully = enabled && currentDraftTested && config.lastTestStatus === '成功';
  const testedFailed = enabled && currentDraftTested && config.lastTestStatus === '失败';
  const draftAvailable = enabled
    && Boolean(model.trim())
    && config.credentialReady
    && (localProvider || Boolean(apiKey) || config.hasApiKey);
  const draftUnavailableReason = !enabled
    ? '大模型服务尚未启用。'
    : !model.trim()
      ? '尚未配置模型名称。'
      : !config.credentialReady
        ? '部署环境缺少可用的凭证加密密钥。'
        : !localProvider && !apiKey && !config.hasApiKey
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
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title={<Space size={12}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bot size={21} /></span>LLM大模型配置</Space>}
        subTitle="独立配置平台文本大模型；启用后覆盖 AI 供应商的 Chat 路由"
      >
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
              ? '当前 Chat 请求由 LLM 大模型配置接管'
              : '当前 Chat 请求沿用 AI 供应商默认路由'}
            description={llmCurrentlyOverridesChat
              ? '设计建议、提示词优化与纯文本编译只使用本页配置；连接失败时不会静默切回 AI 供应商。视觉分析、生图和改图仍使用 AI 供应商。'
              : '本页覆盖未启用，设计建议、提示词优化与纯文本编译继续按照 AI 供应商的能力和优先级执行。'}
          />
        ) : null}

        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="admin-panel-card" loading={loading}>
            <Flex vertical gap={20}>
              <Flex align="center" justify="space-between" gap={20}>
                <div>
                  <Typography.Text strong>启用 LLM Chat 覆盖</Typography.Text>
                  <Typography.Paragraph type="secondary" className="!mb-0 !mt-1">
                    保存后，纯文本 Chat 请求只走本页配置；关闭后恢复 AI 供应商默认路由。
                  </Typography.Paragraph>
                </div>
                <Switch checked={enabled} onChange={setEnabled} aria-label="启用 LLM Chat 覆盖" />
              </Flex>

              {routingDraftChanged ? (
                <Alert
                  showIcon
                  type="warning"
                  message="路由变更尚未保存"
                  description={enabled
                    ? '保存后，新的纯文本 Chat 请求将改走本页 LLM 配置。'
                    : '保存后，新的纯文本 Chat 请求将恢复 AI 供应商默认路由。'}
                />
              ) : null}

              <Divider className="!my-0" />

              <div>
                <Typography.Text strong>快速服务预设</Typography.Text>
                <Select
                  className="mt-2 w-full"
                  value={providerKey}
                  onChange={changePreset}
                  options={PROVIDER_PRESETS.map(({ value, label }) => ({ value, label }))}
                />
              </div>

              <div>
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
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </div>

              <div>
                <Flex justify="space-between" align="center" gap={12} wrap="wrap">
                  <Typography.Text strong>Model（模型名称）</Typography.Text>
                  <Button
                    size="small"
                    icon={<RefreshCw size={14} />}
                    loading={catalogLoading}
                    onClick={() => void loadModels()}
                  >
                    拉取官方列表
                  </Button>
                </Flex>
                <AutoComplete
                  className="mt-2 w-full"
                  value={model}
                  options={modelOptions}
                  defaultActiveFirstOption={false}
                  onChange={setModel}
                  placeholder="选择或输入模型 ID"
                  filterOption={(input, option) => shouldShowLlmModelOption(input, option, modelOptions)}
                  listHeight={320}
                />
                <Typography.Paragraph type="secondary" className="!mb-0 !mt-2 !text-xs">
                  {localProvider
                    ? '目录会显示后台服务环境中已安装的模型，名称须与服务端完全一致。'
                    : freeOnly
                      ? '优先展示上游目录中可确认免费的对话模型；也可直接输入准确的模型 ID。'
                      : '可从官方目录选择，也可直接输入 OpenAI 兼容服务支持的模型 ID。'}
                </Typography.Paragraph>
              </div>

              <div>
                <Typography.Text strong>API Key / Access Token</Typography.Text>
                <Input.Password
                  className="mt-2"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  prefix={<KeyRound size={15} className="text-muted-foreground" />}
                  placeholder={localProvider ? '本地服务通常可留空' : config.apiKeyMasked || '输入服务平台生成的 API Key / Token'}
                />
                {config.hasApiKey && !apiKey ? (
                  <Typography.Paragraph type="secondary" className="!mb-0 !mt-2 !text-xs">
                    已保存加密凭据；留空将保持不变。
                  </Typography.Paragraph>
                ) : null}
              </div>

              {providerKey === 'modelscope' ? (
                <Alert showIcon type="warning" message="魔搭调用可能消耗账户魔粒" description="费用与免费额度以服务平台当前规则为准，保存前请在官方控制台核对。" />
              ) : null}

              <Flex gap={12} wrap="wrap">
                <Button type="primary" loading={saving} onClick={() => void save()}>保存配置</Button>
                <Button icon={<CheckCircle2 size={15} />} loading={testing} onClick={() => void testConnection()}>测试连接</Button>
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
                          {llmCurrentlyOverridesChat ? 'LLM 大模型配置 · 严格覆盖' : 'AI 供应商默认路由'}
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
                        {currentDraftTested && config.lastTestStatus && config.lastTestAt
                          ? `${config.lastTestStatus} · ${new Date(config.lastTestAt).toLocaleString('zh-CN', { hour12: false })}`
                          : '尚未测试当前配置'}
                      </Typography.Paragraph>
                      {currentDraftTested && config.lastTestMessage ? (
                        <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 break-all !text-xs">
                          {config.lastTestMessage}
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
                    : '系统使用 /models 拉取目录，并通过 /chat/completions 发起真实连接测试。费用、限额与数据政策由所选服务商决定。'}
                />
              </Flex>
            )}
          </Card>
        </div>
      </PageContainer>
    </div>
  );
}
