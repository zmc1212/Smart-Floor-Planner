import LeadModel from '@/models/Lead';
import { FloorPlan } from '@/models/FloorPlan';
import { AiStylePreset } from '@/models/AiStylePreset';
import { AdminUser } from '@/models/AdminUser';
import dbConnect from '@/lib/mongodb';
import { getTenantFilter } from '@/lib/auth';

/**
 * AI Designer Agent Service
 * Handles conversational logic and tool execution.
 */

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface AgentContext {
  userId: string;
  enterpriseId: string;
  role: string;
  userName: string;
}

const LONGCAT_API_URL = 'https://api.longcat.chat/openai/v1/chat/completions';
const MODEL = 'LongCat-Flash-Chat';

// Define tools available to the agent
const TOOLS = [
  {
    name: 'search_leads',
    description: '搜索客户线索（客资），可以按姓名或状态筛选。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，如姓名、社区名等' },
        status: { type: 'string', enum: ['new', 'contacted', 'measuring', 'designing', 'quoting', 'converted', 'closed'] }
      }
    }
  },
  {
    name: 'search_floorplans',
    description: '搜索户型图项目。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '户型名称关键词' }
      }
    }
  },
  {
    name: 'get_ai_styles',
    description: '获取系统中可用的 AI 装修风格预设。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['floor_plan_style', 'furnishing_style'], description: '风格类型' }
      }
    }
  },
  {
    name: 'search_staff',
    description: '搜索当前企业的员工或系统账号（如设计师、地推人员）。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '员工姓名或关键词' },
        role: { type: 'string', description: '角色过滤 (designer, salesperson, measurer)' }
      }
    }
  }
];

export async function runAgent(messages: Message[], context: AgentContext, depth = 0) {
  if (depth > 5) {
    throw new Error('Agent reached maximum recursion depth');
  }

  await dbConnect();
  const apiKey = process.env.LONGCAT_API_KEY;
  if (!apiKey) throw new Error('LONGCAT_API_KEY is not configured');
  
  // ... (rest of the logic)
  const systemPrompt = `你是一个专业的“AI设计师”助手，集成在 Smart Floor Planner (智能量房大师) 系统中。
你的目标是协助设计师和销售人员管理客户、查看户型、并提供设计建议。

当前用户信息:
- 用户姓名: ${context.userName}
- 角色: ${context.role}
- 企业ID: ${context.enterpriseId}

能力说明:
- 你可以查询当前企业的客户线索。
- 你可以查询户型图库。
- 你可以推荐装修风格。
- 你可以查询当前企业的员工（如设计师、业务员等）。

行为准则:
1. 始终使用中文回答。
2. 保持专业、严谨且富有创意。
3. 当用户询问数据时，优先使用工具查询，而不是编造。
4. 如果无法完成任务，礼貌地说明原因。
5. 对于工具返回的数据，请以友好、结构化的方式展示给用户。

你可以使用工具通过 JSON 格式输出进行调用，我会为你执行并返回结果。`;

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  // 2. Call LONGCAT
  const response = await fetch(LONGCAT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: fullMessages,
      tools: TOOLS.map(t => ({ type: 'function', function: t })),
      tool_choice: 'auto',
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('LONGCAT API Error:', error);
    throw new Error(`AI Agent service failed: ${response.status}`);
  }

  const result = await response.json();
  const choice = result.choices[0];
  const message = choice.message;

  // 3. Handle Tool Calls
  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolOutputs = [];
    
    for (const toolCall of message.tool_calls) {
      const functionName = toolCall.function.name;
      let args;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch (e) {
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
          default:
            output = { error: `Unknown tool: ${functionName}` };
        }
      } catch (err: any) {
        output = { error: err.message };
      }
      
      toolOutputs.push({
        tool_call_id: toolCall.id,
        role: 'tool',
        name: functionName,
        content: JSON.stringify(output)
      });
    }

    // 4. Recursive call to get final response
    return runAgent([...messages, message, ...toolOutputs], context, depth + 1);
  }

  return message;
}

async function executeSearchLeads(args: any, context: AgentContext) {
  const filter: any = { enterpriseId: context.enterpriseId };
  if (args.query) {
    filter.$or = [
      { name: new RegExp(args.query, 'i') },
      { communityName: new RegExp(args.query, 'i') }
    ];
  }
  if (args.status) {
    filter.status = args.status;
  }
  
  const leads = await LeadModel.find(filter).sort({ createdAt: -1 }).limit(5);
  return leads.map(l => ({
    id: l._id,
    name: l.name,
    status: l.status,
    community: l.communityName,
    createdAt: l.createdAt
  }));
}

async function executeSearchFloorPlans(args: any, context: AgentContext) {
  const filter: any = { enterpriseId: context.enterpriseId };
  if (args.name) {
    filter.name = new RegExp(args.name, 'i');
  }
  
  const plans = await FloorPlan.find(filter).sort({ createdAt: -1 }).limit(5);
  return plans.map(p => ({
    id: p._id,
    name: p.name,
    createdAt: p.createdAt
  }));
}

async function executeGetAiStyles(args: any) {
  const filter: any = { enabled: true };
  if (args.type) {
    filter.type = args.type;
  }
  
  const styles = await AiStylePreset.find(filter).sort({ sortOrder: 1 }).limit(10);
  return styles.map(s => ({
    key: s.key,
    name: s.name,
    description: s.description
  }));
}

async function executeSearchStaff(args: any, context: AgentContext) {
  const filter: any = { enterpriseId: context.enterpriseId };
  if (args.name) {
    filter.displayName = new RegExp(args.name, 'i');
  }
  if (args.role) {
    filter.role = args.role;
  }
  
  const staff = await AdminUser.find(filter).select('displayName role status phone createdAt').limit(10);
  return staff.map(s => ({
    id: s._id,
    name: s.displayName,
    role: s.role,
    status: s.status,
    phone: s.phone,
    createdAt: s.createdAt
  }));
}
