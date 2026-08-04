import { serializeAiWorkflow } from '@/lib/ai/workflow-utils';
import {
  AdminUserRepository,
  FloorPlanRepository,
  LeadRepository,
} from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  ensureDefaultAiStylePresets,
  listAiStylePresets,
} from '@/lib/ai/presets';
import type { ChatAction, ChatFloorPlanOption, ChatUiPayload, ChatWorkflowDetail } from '@/lib/ai/chat-ui';
import { mergeChatUiPayload } from '@/lib/ai/chat-ui';
import {
  createPostgresAiWorkflow,
  getPostgresAiWorkflowContext,
  listPostgresAiWorkflows,
  preparePostgresAiWorkflowStage,
  updatePostgresAiWorkflowState,
} from '@/lib/ai/postgres-workflow-service';
import { submitPostgresCreationGeneration } from '@/lib/ai/postgres-creation-runtime';
import {
  getWorkflowStageDefinition,
  type AiWorkflowSourceAssetRole,
  type AiWorkflowStageKey,
} from '@/lib/ai/workflow-stages';

/**
 * AI Designer Agent Service
 * Handles conversational logic and tool execution.
 */

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  uiPayload?: ChatUiPayload;
}

export interface AgentContext {
  userId: string;
  enterpriseId: string;
  role: string;
  userName: string;
}

const LONGCAT_CHAT_URL =
  process.env.LONGCAT_BASE_URL || 'https://api.longcat.chat/openai/v1/chat/completions';
const LONGCAT_CHAT_MODEL = process.env.LONGCAT_MODEL || 'LongCat-Flash-Chat';

type ToolArgs = Record<string, unknown>;

interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

function sanitizeToolOutputForModel(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return '[内容层级过深，已省略]';
  }

  if (typeof value === 'string') {
    if (value.startsWith('data:image')) {
      return `[图片数据已省略，长度 ${value.length}]`;
    }

    if (value.length > 2000) {
      return `${value.slice(0, 2000)}\n\n[长文本已截断，原长度 ${value.length}]`;
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeToolOutputForModel(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    Object.entries(source).forEach(([key, item]) => {
      if (
        key.toLowerCase().includes('image') ||
        key.toLowerCase().includes('base64') ||
        key === 'roomData' ||
        key === 'layoutData' ||
        key === 'presetSnapshot'
      ) {
        result[key] = typeof item === 'string' ? sanitizeToolOutputForModel(item, depth + 1) : '[大字段已省略]';
        return;
      }

      result[key] = sanitizeToolOutputForModel(item, depth + 1);
    });

    return result;
  }

  return value;
}

// Define tools available to the agent
const TOOLS = [
  {
    name: 'search_leads',
    description: '搜索客户线索（客资），可以按姓名或状态筛选。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，如姓名、社区名等' },
        status: {
          type: 'string',
          enum: ['new', 'measuring', 'measured', 'assigned', 'converted', 'closed'],
        },
      },
    },
  },
  {
    name: 'search_floorplans',
    description: '搜索户型图项目。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '户型名称关键词' },
      },
    },
  },
  {
    name: 'get_ai_styles',
    description: '获取系统中可用的 AI 装修风格预设。',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['floor_plan_style', 'furnishing_style', 'scenario'],
          description: '风格类型',
        },
      },
    },
  },
  {
    name: 'search_staff',
    description: '搜索当前企业的员工或系统账号（如设计师、地推人员）。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '员工姓名或关键词' },
        role: { type: 'string', description: '角色过滤 (designer, salesperson, measurer)' },
      },
    },
  },
  {
    name: 'list_ai_workflows',
    description: '查看某条客户线索下的 AI 设计方案会话列表。',
    parameters: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: '客户线索 ID' },
      },
      required: ['leadId'],
    },
  },
  {
    name: 'get_ai_workflow_detail',
    description: '查看 AI 设计方案会话详情，包括当前阶段、产物时间线和可执行步骤。可用 workflowId 精确查询，也可用 query 按方案标题模糊查询。',
    parameters: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'AI 方案会话 ID' },
        leadId: { type: 'string', description: '可选，客户线索 ID，用于缩小标题查询范围' },
        query: { type: 'string', description: '可选，方案标题关键词，例如 方案3 / 方案 3 / 首轮方案' },
      },
    },
  },
  {
    name: 'create_ai_workflow',
    description: '为客户线索创建 AI 设计方案会话。通常需要已有来源图；如果只传户型图 ID，后续仍可能需要补充来源图。',
    parameters: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: '客户线索 ID' },
        workflowLabel: { type: 'string', description: '方案标签，例如 首轮方案 / 客厅方案' },
        sourceImage: { type: 'string', description: 'base64 图片数据，仅在用户明确提供时使用' },
        sourceFloorPlanId: { type: 'string', description: '客户线索下的户型图 ID' },
        sourceAssetRole: {
          type: 'string',
          enum: ['rough_sketch', 'floor_plan', 'base_render', 'approved_render', 'concept_element'],
          description: '来源素材角色',
        },
      },
      required: ['leadId'],
    },
  },
  {
    name: 'recommend_next_workflow_step',
    description: '根据当前方案会话状态推荐下一步 AI 设计动作。',
    parameters: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'AI 方案会话 ID' },
      },
      required: ['workflowId'],
    },
  },
  {
    name: 'run_ai_workflow_stage',
    description: '执行某个 AI 设计工作流阶段。该工具会消耗企业 AI 额度，必须在用户明确确认后传 confirmed=true。',
    parameters: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'AI 方案会话 ID' },
        stageKey: {
          type: 'string',
          enum: [
            'direction',
            'base_render',
            'soft_furnishing',
            'proposal_pack',
            'lighting',
            'tour_board',
            'premium_board',
            'perspective_upgrade',
            'cad_detail',
          ],
          description: '要执行的工作流阶段',
        },
        presetKey: { type: 'string', description: '可选的场景预设 key，例如 scenario_1' },
        confirmed: { type: 'boolean', description: '用户是否已明确确认执行并消耗 AI 额度' },
      },
      required: ['workflowId', 'stageKey'],
    },
  },
  {
    name: 'select_ai_generation_baseline',
    description: '把某个产物设为当前定稿。该动作会影响后续步骤来源，必须在用户明确确认后传 confirmed=true。',
    parameters: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'AI 方案会话 ID' },
        generationId: { type: 'string', description: '要设为当前定稿的产物 ID' },
        confirmed: { type: 'boolean', description: '用户是否已明确确认切换定稿' },
      },
      required: ['workflowId', 'generationId'],
    },
  },
];

export async function runAgent(
  messages: Message[],
  context: AgentContext,
  depth = 0,
  uiPayload?: ChatUiPayload
) {
  if (depth > 5) {
    return {
      role: 'assistant',
      content: '工具调用次数过多，我已停止继续执行。请换一种更具体的问法，或直接指定客户/方案会话 ID。',
      uiPayload,
    };
  }

  const apiKey = process.env.LONGCAT_API_KEY;
  if (!apiKey) {
    throw new Error('LongCat API key is not configured. Set LONGCAT_API_KEY.');
  }

  const systemPrompt = `你是一个专业的“AI设计师”助手，集成在 Smart Floor Planner (智能量房大师) 系统中。
你的目标是协助设计师和销售人员管理客户、查看户型、推进 AI 设计方案，并提供设计建议。

当前用户信息:
- 用户姓名: ${context.userName}
- 角色: ${context.role}
- 企业ID: ${context.enterpriseId}

能力说明:
- 你可以查询当前企业的客户线索。
- 你可以查询户型图库。
- 你可以推荐装修风格。
- 你可以查询当前企业的员工（如设计师、业务员等）。
- 你可以查看、创建、推荐和执行 AI 设计方案工作流。

行为准则:
1. 始终使用中文回答。
2. 保持专业、严谨且富有创意。
3. 当用户询问数据时，优先使用工具查询，而不是编造。
4. 如果无法完成任务，礼貌地说明原因。
5. 对于工具返回的数据，请以友好、结构化的方式展示给用户。
6. 查询、分析、推荐可以直接执行；真正出图、消耗 AI 额度、切换当前定稿前，必须先说明影响并得到用户明确确认。
7. 如果工具返回 requiresConfirmation=true，请不要假装已经完成动作，而是告诉用户需要确认的具体动作和参数。
8. 展示 AI 方案会话列表时，请尽量带上方案会话 ID；当用户说“查看方案3/首轮方案”等自然称呼时，请用标题关键词查询，不要要求用户必须输入 ID。

你可以使用工具通过 JSON 格式输出进行调用，我会为你执行并返回结果。`;

  const fullMessages = [
    {
      role: 'system',
      content: `${systemPrompt}\n9. 用户可见回复不得展示 leadId、workflowId、generationId 或 Mongo ObjectId；需要指代对象时使用客户姓名、方案标题或“该客户/该方案”。`,
    },
    ...messages,
  ];

  const shouldAllowTools = !messages.some((message) => message.role === 'tool');
  const response = await fetch(LONGCAT_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: LONGCAT_CHAT_MODEL,
      messages: fullMessages,
      ...(shouldAllowTools ? { tools: TOOLS.map((tool) => ({ type: 'function', function: tool })) } : {}),
      tool_choice: shouldAllowTools ? 'auto' : 'none',
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('LongCat Agent API Error:', error);
    throw new Error(`AI Agent service failed: ${response.status}`);
  }

  const result = await response.json();
  const choice = result.choices[0];
  const message = choice.message;
  const parsedTextToolCalls = parseLongCatTextToolCalls(message.content);
  const toolCalls = normalizeToolCalls(message.tool_calls, parsedTextToolCalls);

  if (toolCalls.length > 0) {
    const toolOutputs = [];
    const toolUiPayloads: ChatUiPayload[] = [];

    for (const toolCall of toolCalls) {
      const functionName = toolCall.name;
      let args;
      try {
        args = JSON.parse(toolCall.arguments);
      } catch {
        args = {};
      }

      let output;
      try {
        switch (functionName) {
          case 'search_leads':
            output = await executeSearchLeads(args, context);
            break;
          case 'search_floorplans':
            output = await executeSearchFloorPlans(args, context);
            break;
          case 'get_ai_styles':
            output = await executeGetAiStyles(args);
            break;
          case 'search_staff':
            output = await executeSearchStaff(args, context);
            break;
          case 'list_ai_workflows':
            output = await executeListAiWorkflowsV2(args, context);
            break;
          case 'get_ai_workflow_detail':
            output = await executeGetAiWorkflowDetail(args, context);
            break;
          case 'create_ai_workflow':
            output = await executeCreateAiWorkflow(args, context);
            break;
          case 'recommend_next_workflow_step':
            output = await executeRecommendNextWorkflowStep(args, context);
            break;
          case 'run_ai_workflow_stage':
            output = await executeRunAiWorkflowStage(args, context);
            break;
          case 'select_ai_generation_baseline':
            output = await executeSelectAiGenerationBaseline(args, context);
            break;
          default:
            output = { error: `Unknown tool: ${functionName}` };
        }
      } catch (err: unknown) {
        output = { error: err instanceof Error ? err.message : '工具执行失败' };
      }

      const toolUiPayload = buildUiPayloadForTool(functionName, output);
      if (toolUiPayload) {
        toolUiPayloads.push(toolUiPayload);
      }

      toolOutputs.push({
        tool_call_id: toolCall.id,
        role: 'tool',
        name: functionName,
        content: JSON.stringify(sanitizeToolOutputForModel(output)),
      });
    }

    return runAgent(
      [...messages, message, ...toolOutputs],
      context,
      depth + 1,
      mergeChatUiPayload(uiPayload, ...toolUiPayloads)
    );
  }

  return {
    ...message,
    content: maskBusinessIds(
      stripLongCatToolCallText(typeof message.content === 'string' ? message.content : ''),
      uiPayload
    ),
    uiPayload,
  };
}

function normalizeToolCalls(rawToolCalls: unknown, parsedTextToolCalls: ParsedToolCall[]): ParsedToolCall[] {
  if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
    return rawToolCalls
      .map((toolCall, index) => {
        const item = toolCall as {
          id?: string;
          function?: {
            name?: string;
            arguments?: string;
          };
        };
        if (!item.function?.name) {
          return null;
        }

        return {
          id: item.id || `tool-${index}`,
          name: item.function.name,
          arguments: item.function.arguments || '{}',
        };
      })
      .filter((item): item is ParsedToolCall => Boolean(item));
  }

  return parsedTextToolCalls;
}

function parseLongCatTextToolCalls(content: unknown): ParsedToolCall[] {
  if (typeof content !== 'string') {
    return [];
  }

  const matches = [...content.matchAll(/<longcat_tool_call>\s*([\s\S]*?)\s*<\/longcat_tool_call>/g)];
  return matches
    .map((match, index) => {
      try {
        const parsed = JSON.parse(match[1]) as { name?: string; arguments?: string | Record<string, unknown> };
        if (!parsed.name) {
          return null;
        }

        return {
          id: `longcat-text-tool-${index}`,
          name: parsed.name,
          arguments:
            typeof parsed.arguments === 'string'
              ? parsed.arguments
              : JSON.stringify(parsed.arguments || {}),
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is ParsedToolCall => Boolean(item));
}

function stripLongCatToolCallText(content: string) {
  return content.replace(/<longcat_tool_call>[\s\S]*?<\/longcat_tool_call>/g, '').trim();
}

function maskBusinessIds(content: string, payload?: ChatUiPayload) {
  let result = content;
  const idLabels = new Map<string, string>();

  payload?.cards?.forEach((card) => {
    if (card.id && card.title) {
      idLabels.set(card.id, card.title);
    }

    card.actions.forEach((action) => {
      if (action.kind !== 'navigate') return;
      const workflowMatch = action.value.match(/\/ai-studio\/scenarios\/([a-f0-9]{24}|[1-9]\d{0,18})/i);
      if (workflowMatch?.[1] && card.type === 'workflow') {
        idLabels.set(workflowMatch[1], card.title);
      }
      const leadMatch = action.value.match(/[?&]leadId=([a-f0-9]{24}|[1-9]\d{0,18})/i);
      if (leadMatch?.[1]) {
        idLabels.set(leadMatch[1], card.type === 'lead' || card.type === 'workflow_empty' ? card.title : '该客户');
      }
    });
  });

  idLabels.forEach((label, id) => {
    result = result.replace(new RegExp(id, 'gi'), label);
  });

  return result
    .replace(/\b(?:leadId|workflowId|generationId)\s*[:=]\s*["']?[1-9]\d{0,18}["']?/gi, 'internal object')
    .replace(/\b(?:leadId|workflowId|generationId)\s*[:=：]?\s*["']?[a-f0-9]{24}["']?/gi, '该对象')
    .replace(/\b(?:leadId|workflowId|generationId)\b/gi, '该对象')
    .replace(/\b[a-f0-9]{24}\b/gi, '该对象');
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function toUiString(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value == null ? undefined : String(value);
}

function formatUiDate(value: unknown) {
  const raw = toUiString(value);
  if (!raw) {
    return undefined;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toSafeChatImageUrl(value: unknown) {
  const raw = toUiString(value);
  if (!raw || raw.startsWith('data:image')) {
    return undefined;
  }

  if (raw.startsWith('/api/ai/assets/') || raw.startsWith('/')) {
    return raw;
  }

  return /^https?:\/\//i.test(raw) ? raw : undefined;
}

function toGenerationChatImageUrl(generation: Record<string, unknown>) {
  const id = toUiString(generation.id || generation._id);
  const outputImageUrl = isRecord(generation.output) ? generation.output.imageUrl : undefined;
  return toSafeChatImageUrl(outputImageUrl) || (id && outputImageUrl ? `/api/ai/generations/${id}/image` : undefined);
}

function getWorkflowActionLabel(stageKey?: string, stageLabel?: string) {
  const definition = getWorkflowStageDefinition(stageKey);
  return stageLabel || definition?.name || definition?.actionLabel || '执行下一步';
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildLeadCard(lead: Record<string, unknown>) {
  const id = toUiString(lead.id || lead._id);
  if (!id) {
    return undefined;
  }

  const title = toUiString(lead.name) || '未命名客户';
  const community = toUiString(lead.community || lead.communityName);
  const status = toUiString(lead.status);
  const createdAt = formatUiDate(lead.createdAt);

  return {
    type: 'lead' as const,
    id,
    title,
    subtitle: community || '未登记小区',
    meta: [
      status ? `状态：${status}` : undefined,
      createdAt ? `创建：${createdAt}` : undefined,
    ].filter((item): item is string => Boolean(item)),
    actions: ([
      {
        label: '查看 AI 工作流',
        kind: 'prompt' as const,
        value: `查看 leadId=${id} 的 AI 设计工作流`,
        variant: 'primary' as const,
      },
      {
        label: '打开工作流页',
        kind: 'navigate' as const,
        value: `/ai-studio/scenarios?leadId=${id}`,
        variant: 'secondary' as const,
      },
    ] as ChatAction[]),
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildWorkflowCard(
  workflow: Record<string, unknown>,
  fallbackLeadId?: string,
  detail?: ChatWorkflowDetail
) {
  const id = toUiString(workflow.id || workflow._id);
  if (!id) {
    return undefined;
  }

  const leadId = toUiString(workflow.leadId) || fallbackLeadId;
  const title = toUiString(workflow.title) || toUiString(workflow.workflowLabel) || '未命名方案';
  const currentStage =
    toUiString(workflow.currentStageLabel) || toUiString(workflow.currentStageKey) || '未开始';
  const generationCount = Number(workflow.generationCount || 0);
  const updatedAt = formatUiDate(workflow.updatedAt);
  const isPrimary = Boolean(workflow.isPrimary);

  return {
    type: 'workflow' as const,
    id,
    title,
    subtitle: `当前阶段：${currentStage}`,
    badge: isPrimary ? '主方案' : currentStage,
    meta: [
      `产物：${Number.isFinite(generationCount) ? generationCount : 0} 个`,
      updatedAt ? `更新：${updatedAt}` : undefined,
      isPrimary ? '主方案' : undefined,
    ].filter((item): item is string => Boolean(item)),
    ...(detail ? { detail } : {}),
    actions: [
      ...(detail?.recommendedNextAction?.stageKey
        ? [
            {
              label: '执行下一步',
              kind: 'confirm_tool' as const,
              actionName: 'run_workflow_stage' as const,
              arguments: {
                workflowId: id,
                stageKey: detail.recommendedNextAction.stageKey,
              },
              confirmTitle: `确认执行 ${detail.recommendedNextAction.stageLabel || '下一阶段'}？`,
              confirmDescription: '该操作会消耗企业 AI 额度并生成新的方案产物。',
              variant: 'primary' as const,
            },
          ]
        : []),
      {
        label: '查看详情',
        kind: 'prompt' as const,
        value: `查看 workflowId=${id} 的 AI 设计工作流详情`,
        variant: detail ? ('secondary' as const) : ('primary' as const),
      },
      {
        label: '刷新状态',
        kind: 'confirm_tool' as const,
        actionName: 'refresh_workflow_detail' as const,
        arguments: { workflowId: id },
        confirmTitle: '刷新方案状态？',
        confirmDescription: '系统会重新读取该方案的最新阶段、产物和推荐动作。',
        variant: 'secondary' as const,
      },
      {
        label: '打开详情页',
        kind: 'navigate' as const,
        value: `/ai-studio/scenarios/${id}`,
        variant: 'secondary' as const,
      },
      ...(leadId
        ? [
            {
              label: '继续设计',
              kind: 'navigate' as const,
              value: `/ai-studio/scenarios?leadId=${leadId}&workflowId=${id}`,
              variant: 'secondary' as const,
            },
          ]
        : []),
    ] as ChatAction[],
  };
}

function buildWorkflowDetailPayload(output: Record<string, unknown>): ChatWorkflowDetail | undefined {
  const workflow = isRecord(output.workflow) ? output.workflow : undefined;
  if (!workflow) {
    return undefined;
  }

  const lead = isRecord(output.lead) ? output.lead : undefined;
  const stageState = isRecord(workflow.stageState) ? workflow.stageState : undefined;
  const latestGeneration = isRecord(workflow.latestGeneration) ? workflow.latestGeneration : undefined;
  const generations = toRecordArray(output.generations).slice(0, 20);
  const recommendedNextAction =
    stageState && isRecord(stageState.recommendedNextAction)
      ? stageState.recommendedNextAction
      : undefined;
  const blockedReasons = recommendedNextAction
    ? []
    : toRecordArray(stageState?.blockedStages)
    .map((stage) => toUiString(stage.reason))
    .filter((reason): reason is string => Boolean(reason))
    .filter((reason, index, source) => source.indexOf(reason) === index)
    .slice(0, 3);

  return {
    ...(lead
      ? {
          lead: {
            name: toUiString(lead.name),
            communityName: toUiString(lead.communityName),
            status: toUiString(lead.status),
          },
        }
      : {}),
    progress: {
      completedStageCount: countArray(stageState?.completedStages),
      availableStageCount: countArray(stageState?.availableStages),
      generationCount: Number(workflow.generationCount || 0),
    },
    ...(latestGeneration
      ? {
          latestGeneration: {
            stageKey: toUiString(latestGeneration.stageKey),
            stageLabel:
              toUiString(latestGeneration.stageLabel) ||
              toUiString(latestGeneration.stageKey),
            status: toUiString(latestGeneration.status),
            createdAt: formatUiDate(latestGeneration.createdAt),
            imageUrl: toGenerationChatImageUrl(latestGeneration),
          },
        }
      : {}),
    ...(recommendedNextAction
      ? {
          recommendedNextAction: {
            stageKey: toUiString(recommendedNextAction.stageKey),
            stageLabel:
              toUiString(recommendedNextAction.stageLabel) ||
              toUiString(recommendedNextAction.stageKey),
            reason: toUiString(recommendedNextAction.reason),
          },
        }
      : {}),
    ...(generations.length > 0
      ? {
          timeline: generations
            .map((generation) => {
              const id = toUiString(generation.id || generation._id);
              if (!id) {
                return undefined;
              }

              return {
                id,
                stageKey: toUiString(generation.stageKey),
                stageLabel: toUiString(generation.stageLabel) || toUiString(generation.stageKey),
                status: toUiString(generation.status),
                isSelectedBaseline: Boolean(generation.isSelectedBaseline),
                createdAt: formatUiDate(generation.createdAt),
                imageUrl: toGenerationChatImageUrl(generation),
              };
            })
            .filter(Boolean) as NonNullable<ChatWorkflowDetail['timeline']>,
        }
      : {}),
    ...(blockedReasons.length > 0 ? { blockedReasons } : {}),
  };
}

export function buildWorkflowDetailUiPayload(output: unknown): ChatUiPayload | undefined {
  if (!isRecord(output) || !isRecord(output.workflow)) {
    return undefined;
  }

  const lead = isRecord(output.lead) ? output.lead : undefined;
  const card = buildWorkflowCardV2(
    output.workflow,
    toUiString(lead?.id || lead?._id),
    buildWorkflowDetailPayload(output)
  );

  return card ? { cards: [card] } : undefined;
}

function toFloorPlanOptions(value: unknown): ChatFloorPlanOption[] {
  return toRecordArray(value)
    .map((plan): ChatFloorPlanOption | undefined => {
      const id = toUiString(plan.id || plan._id);
      if (!id) {
        return undefined;
      }

      return {
        id,
        name: toUiString(plan.name),
        createdAt: formatUiDate(plan.createdAt),
        status: toUiString(plan.status),
      };
    })
    .filter((item): item is ChatFloorPlanOption => Boolean(item));
}

function buildLeadCardV2(lead: Record<string, unknown>) {
  const id = toUiString(lead.id || lead._id);
  if (!id) {
    return undefined;
  }

  const title = toUiString(lead.name) || '未命名客户';
  const community = toUiString(lead.community || lead.communityName);
  const status = toUiString(lead.status);
  const createdAt = formatUiDate(lead.createdAt);

  return {
    type: 'lead' as const,
    id,
    title,
    subtitle: community || '未登记小区',
    meta: [
      status ? `状态：${status}` : undefined,
      createdAt ? `创建：${createdAt}` : undefined,
    ].filter((item): item is string => Boolean(item)),
    actions: [
      {
        label: '查看 AI 工作流',
        kind: 'prompt' as const,
        value: `查看 ${title} 的 AI 设计工作流`,
        displayText: `查看 ${title} 的 AI 设计工作流`,
        hiddenContext: `请查询 leadId=${id} 的 AI 设计工作流。对用户回复时使用客户姓名“${title}”，不要展示 leadId。`,
        variant: 'primary' as const,
      },
      {
        label: '打开工作流页',
        kind: 'navigate' as const,
        value: `/ai-studio/scenarios?leadId=${id}`,
        variant: 'secondary' as const,
      },
    ] as ChatAction[],
  };
}

function buildWorkflowCardV2(
  workflow: Record<string, unknown>,
  fallbackLeadId?: string,
  detail?: ChatWorkflowDetail
) {
  const id = toUiString(workflow.id || workflow._id);
  if (!id) {
    return undefined;
  }

  const leadId = toUiString(workflow.leadId) || fallbackLeadId;
  const title = toUiString(workflow.title) || toUiString(workflow.workflowLabel) || '未命名方案';
  const currentStage =
    toUiString(workflow.currentStageLabel) || toUiString(workflow.currentStageKey) || '未开始';
  const generationCount = Number(workflow.generationCount || 0);
  const updatedAt = formatUiDate(workflow.updatedAt);
  const isPrimary = Boolean(workflow.isPrimary);

  const actions: ChatAction[] = [];
  if (detail?.recommendedNextAction?.stageKey) {
    const nextStageLabel = getWorkflowActionLabel(
      detail.recommendedNextAction.stageKey,
      detail.recommendedNextAction.stageLabel
    );
    const nextAction: ChatAction = {
      label: '执行下一步',
      kind: 'confirm_tool',
      actionName: 'run_workflow_stage',
      arguments: {
        workflowId: id,
        stageKey: detail.recommendedNextAction.stageKey,
      },
      confirmTitle: `确认执行 ${detail.recommendedNextAction.stageLabel || '下一阶段'}？`,
      confirmDescription: '该操作会消耗企业 AI 额度并生成新的方案产物。',
      variant: 'primary',
    };
    nextAction.label = nextStageLabel;
    nextAction.confirmTitle = `确认开始「${nextStageLabel}」？`;
    nextAction.confirmDescription = `系统将按「${nextStageLabel}」阶段生成新的方案产物，并消耗企业 AI 额度。`;
    actions.push(nextAction);
  }

  actions.push(
    {
      label: '查看详情',
      kind: 'prompt',
      value: `查看 ${title} 的 AI 设计工作流详情`,
      displayText: `查看 ${title} 的 AI 设计工作流详情`,
      hiddenContext: `请查看 workflowId=${id} 的 AI 设计工作流详情。对用户回复时使用方案标题“${title}”，不要展示 workflowId。`,
      variant: detail ? 'secondary' : 'primary',
    },
    {
      label: '刷新状态',
      kind: 'confirm_tool',
      actionName: 'refresh_workflow_detail',
      arguments: { workflowId: id },
      confirmTitle: '刷新方案状态？',
      confirmDescription: '系统会重新读取该方案的最新阶段、产物和推荐动作。',
      variant: 'secondary',
    },
    {
      label: '打开详情页',
      kind: 'navigate',
      value: `/ai-studio/scenarios/${id}`,
      variant: 'secondary',
    }
  );

  if (leadId) {
    actions.push({
      label: '继续设计',
      kind: 'navigate',
      value: `/ai-studio/scenarios?leadId=${leadId}&workflowId=${id}`,
      variant: 'secondary',
    });
  }

  return {
    type: 'workflow' as const,
    id,
    title,
    subtitle: `当前阶段：${currentStage}`,
    badge: isPrimary ? '主方案' : currentStage,
    meta: [
      `产物：${Number.isFinite(generationCount) ? generationCount : 0} 个`,
      updatedAt ? `更新：${updatedAt}` : undefined,
      isPrimary ? '主方案' : undefined,
    ].filter((item): item is string => Boolean(item)),
    ...(detail ? { detail } : {}),
    actions,
  };
}

function buildEmptyWorkflowCard(output: Record<string, unknown>): ChatUiPayload | undefined {
  const lead = isRecord(output.lead) ? output.lead : undefined;
  if (!lead) {
    return undefined;
  }

  const id = toUiString(lead.id || lead._id);
  if (!id) {
    return undefined;
  }

  const title = toUiString(lead.name) || '未命名客户';
  const floorPlans = toFloorPlanOptions(lead.floorPlans);
  const hasFloorPlans = floorPlans.length > 0;

  return {
    cards: [
      {
        type: 'workflow_empty',
        id,
        title,
        subtitle: `${toUiString(lead.communityName) || '未登记小区'} · 还没有 AI 设计工作流`,
        meta: [
          toUiString(lead.status) ? `状态：${toUiString(lead.status)}` : undefined,
          `户型图：${floorPlans.length} 份`,
        ].filter((item): item is string => Boolean(item)),
        floorPlans,
        actions: [
          {
            label: '使用户型图创建',
            kind: 'confirm_tool',
            actionName: 'create_workflow',
            arguments: { leadId: id },
            needsFloorPlanSelection: true,
            confirmTitle: hasFloorPlans ? '选择户型图创建 AI 工作流' : '暂无户型图',
            confirmDescription: hasFloorPlans
              ? '请选择一份户型图作为方案来源，确认后会创建新的 AI 设计工作流。'
              : '当前客户没有户型图，请改用上传参考图创建。',
            variant: hasFloorPlans ? 'primary' : 'secondary',
          },
          {
            label: '上传参考图创建',
            kind: 'confirm_tool',
            actionName: 'create_workflow',
            arguments: { leadId: id },
            needsUpload: true,
            confirmTitle: '上传参考图创建 AI 工作流',
            confirmDescription: '请选择一张参考图，系统会用它作为方案来源创建新的 AI 设计工作流。',
            variant: hasFloorPlans ? 'secondary' : 'primary',
          },
          {
            label: '打开工作流页',
            kind: 'navigate',
            value: `/ai-studio/scenarios?leadId=${id}`,
            variant: 'secondary',
          },
        ],
      },
    ],
  };
}

function buildUiPayloadForTool(functionName: string, output: unknown): ChatUiPayload | undefined {
  if (functionName === 'search_leads') {
    const cards = toRecordArray(output)
      .map(buildLeadCardV2)
      .filter((card): card is NonNullable<ReturnType<typeof buildLeadCardV2>> => Boolean(card));

    return cards.length > 0 ? { cards } : undefined;
  }

  if (functionName === 'list_ai_workflows') {
    if (isRecord(output)) {
      const workflows = toRecordArray(output.workflows);
      if (workflows.length === 0) {
        return buildEmptyWorkflowCard(output);
      }

      const cards = workflows
        .map((workflow) => buildWorkflowCardV2(workflow))
        .filter((card): card is NonNullable<ReturnType<typeof buildWorkflowCardV2>> => Boolean(card));

      return cards.length > 0 ? { cards } : undefined;
    }

    const cards = toRecordArray(output)
      .map((workflow) => buildWorkflowCardV2(workflow))
      .filter((card): card is NonNullable<ReturnType<typeof buildWorkflowCardV2>> => Boolean(card));

    return cards.length > 0 ? { cards } : undefined;
  }

  if (functionName === 'get_ai_workflow_detail') {
    return buildWorkflowDetailUiPayload(output);
  }

  return undefined;
}

async function executeSearchLeads(args: ToolArgs, context: AgentContext) {
  const query = optionalString(args.query);
  const status = optionalString(args.status);
  const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
  const result = await withTenantTransaction(enterpriseId, (transaction) =>
    new LeadRepository(transaction).list({ query, status, limit: 5 })
  );
  return result.rows.map((lead) => ({
    id: lead.id.toString(),
    name: lead.name,
    status: lead.status,
    community: lead.communityName,
    createdAt: lead.createdAt,
  }));
}

async function executeSearchFloorPlans(args: ToolArgs, context: AgentContext) {
  const name = optionalString(args.name);
  const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
  const result = await withTenantTransaction(enterpriseId, (transaction) =>
    new FloorPlanRepository(transaction).list({ search: name, limit: 5 })
  );
  return result.rows.map((plan) => ({
    id: plan.id.toString(),
    name: plan.name,
    createdAt: plan.createdAt,
  }));
}

async function executeGetAiStyles(args: ToolArgs) {
  await ensureDefaultAiStylePresets();
  const type = optionalString(args.type);
  const styles = (await listAiStylePresets(type as import('@/lib/ai/preset-definitions').AiPresetType | undefined)).slice(0, 10);
  return styles.map((style) => ({
    key: style.key,
    name: style.name,
    description: style.description,
    workflowStage: style.workflowStage,
  }));
}

async function executeSearchStaff(args: ToolArgs, context: AgentContext) {
  const name = optionalString(args.name);
  const role = optionalString(args.role);
  const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
  const result = await withTenantTransaction(enterpriseId, (transaction) =>
    new AdminUserRepository(transaction).list({
      search: name,
      roles: role ? [role] : undefined,
      limit: 10,
    })
  );
  return result.rows.map((item) => ({
    id: item.id.toString(),
    name: item.displayName,
    role: item.role,
    status: item.status,
    phone: item.phone,
    createdAt: item.createdAt,
  }));
}

async function executeListAiWorkflowsV2(args: ToolArgs, context: AgentContext) {
  const leadId = optionalString(args.leadId);
  if (!leadId) {
    return { error: '缺少客户线索信息' };
  }

  const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
  const [lead, workflows] = await Promise.all([
    withTenantTransaction(enterpriseId, (transaction) =>
      new LeadRepository(transaction).findById(parsePostgresId(leadId, 'leadId'))
    ),
    listPostgresAiWorkflows({ enterpriseId, leadId, status: 'active', limit: 10 }),
  ]);

  if (!lead) {
    return { error: '客户线索不存在或无权访问' };
  }

  return {
    lead: {
      id: lead.id.toString(),
      name: lead.name,
      status: lead.status,
      communityName: lead.communityName,
      floorPlans: lead.floorPlanRecords.map((plan) => ({
        id: plan.id.toString(),
        name: plan.name,
        createdAt: plan.createdAt,
        status: plan.status,
      })),
    },
    workflows: workflows.data.map((workflow) => ({
      id: workflow.id,
      leadId: workflow.leadId,
      title: workflow.title,
      workflowLabel: workflow.workflowLabel,
      isPrimary: workflow.isPrimary,
      status: workflow.status,
      currentStageKey: workflow.currentStageKey,
      currentStageLabel: workflow.currentStageLabel,
      generationCount: workflow.generationCount,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    })),
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function executeListAiWorkflows(args: ToolArgs, context: AgentContext) {
  const leadId = optionalString(args.leadId);
  if (!leadId) {
    return { error: '缺少 leadId' };
  }

  const workflows = await listPostgresAiWorkflows({
    enterpriseId: context.enterpriseId,
    leadId,
    status: 'active',
    limit: 10,
  });
  return workflows.data;
}

async function executeGetAiWorkflowDetail(args: ToolArgs, context: AgentContext) {
  let workflowId = optionalString(args.workflowId);
  const query = optionalString(args.query);
  const leadId = optionalString(args.leadId);

  if (!workflowId && query) {
    const workflows = await findPostgresWorkflowsByTitleQuery(query, context, leadId);
    if (workflows.length === 0) {
      return { error: `没有找到标题匹配“${query}”的方案会话` };
    }

    if (workflows.length > 1) {
      return {
        error: `找到 ${workflows.length} 个匹配的方案会话，请指定其中一个 ID`,
        matches: workflows.map((workflow) => ({
          id: workflow.id,
          title: workflow.title,
          currentStageKey: workflow.currentStageKey,
          updatedAt: workflow.updatedAt,
        })),
      };
    }

    workflowId = workflows[0].id;
  }

  if (!workflowId) {
    return { error: '缺少 workflowId 或 query' };
  }

  return getPostgresAiWorkflowContext({ enterpriseId: context.enterpriseId, workflowId });
}

function normalizeWorkflowTitle(value: string) {
  return value.replace(/[\s·・.。_-]/g, '').toLowerCase();
}

async function findPostgresWorkflowsByTitleQuery(query: string, context: AgentContext, leadId?: string) {
  const normalizedQuery = normalizeWorkflowTitle(query);
  const workflows = await listPostgresAiWorkflows({
    enterpriseId: context.enterpriseId,
    leadId,
    status: 'active',
    limit: 50,
  });

  return workflows.data.filter((workflow) => {
    const title = normalizeWorkflowTitle(workflow.title || '');
    const label = normalizeWorkflowTitle(workflow.workflowLabel || '');
    return title.includes(normalizedQuery) || label.includes(normalizedQuery);
  });
}

async function executeCreateAiWorkflow(args: ToolArgs, context: AgentContext) {
  const workflow = await createPostgresAiWorkflow({
    enterpriseId: context.enterpriseId,
    operatorId: context.userId,
    leadId: optionalString(args.leadId) || '',
    workflowLabel: optionalString(args.workflowLabel),
    sourceImage: optionalString(args.sourceImage),
    sourceFloorPlanId: optionalString(args.sourceFloorPlanId),
    sourceAssetRole: optionalString(args.sourceAssetRole) as AiWorkflowSourceAssetRole | undefined,
  });

  return serializeAiWorkflow({ ...workflow, _id: workflow.id });
}

async function executeRecommendNextWorkflowStep(args: ToolArgs, context: AgentContext) {
  const workflowId = optionalString(args.workflowId);
  if (!workflowId) {
    return { error: '缺少 workflowId' };
  }

  const workflowContext = await getPostgresAiWorkflowContext({
    enterpriseId: context.enterpriseId,
    workflowId,
  });
  return workflowContext.workflow.stageState.recommendedNextAction || {
    reason: 'No workflow stage is available until its source or baseline is selected.',
  };
}

async function executeRunAiWorkflowStage(args: ToolArgs, context: AgentContext) {
  const workflowId = optionalString(args.workflowId) || '';
  const stageKey = optionalString(args.stageKey) as AiWorkflowStageKey;
  if (!args.confirmed) {
    const stage = getWorkflowStageDefinition(stageKey);
    return {
      requiresConfirmation: true,
      message: `Running ${stage?.name || stageKey} consumes enterprise AI credits and creates a new result.`,
    };
  }
  const generation = await preparePostgresAiWorkflowStage({
    enterpriseId: context.enterpriseId,
    operatorId: context.userId,
    workflowId,
    stageKey,
    presetKey: optionalString(args.presetKey),
  });
  await submitPostgresCreationGeneration({
    enterpriseId: context.enterpriseId,
    generationId: generation.id.toString(),
  });
  return getPostgresAiWorkflowContext({ enterpriseId: context.enterpriseId, workflowId });
}

async function executeSelectAiGenerationBaseline(args: ToolArgs, context: AgentContext) {
  if (!args.confirmed) {
    return {
      requiresConfirmation: true,
      message: 'Selecting a baseline changes the source of later workflow stages.',
    };
  }
  const selected = await updatePostgresAiWorkflowState({
    enterpriseId: context.enterpriseId,
    workflowId: optionalString(args.workflowId) || '',
    generationId: optionalString(args.generationId) || '',
    action: 'select-generation',
  });
  if (!('generation' in selected)) {
    throw new Error('Baseline selection did not return a generation.');
  }
  return {
    workflow: serializeAiWorkflow({ ...selected.workflow, _id: selected.workflow.id }),
    generation: {
      id: selected.generation.id.toString(),
      status: selected.generation.status,
      isSelectedBaseline: selected.generation.isSelectedBaseline,
    },
  };
}
