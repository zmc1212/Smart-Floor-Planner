import type { AiWorkflowSourceAssetRole, AiWorkflowStageKey } from './workflow-stages';

export interface AiWorkflowDemoGeneration {
  id: string;
  type: string;
  stageKey: AiWorkflowStageKey;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  isSelectedBaseline: boolean;
  nextRecommendedStage?: AiWorkflowStageKey;
  status: 'succeeded' | 'failed' | 'processing' | 'pending';
  createdAt: string;
  input?: {
    customPrompt?: string;
  };
  output?: {
    imageUrl?: string;
    promptUsed?: string;
  };
}

export interface AiWorkflowDemoCase {
  id: string;
  name: string;
  tagline: string;
  summary: string;
  attraction: string;
  replaceHint: string;
  lead: {
    id: string;
    name: string;
    phone: string;
    status: string;
    stylePreference?: string;
    communityName?: string;
  };
  workflow: {
    id: string;
    title: string;
    workflowLabel?: string;
    sourceImage: string;
    sourceAssetRole: AiWorkflowSourceAssetRole;
    currentStageKey: AiWorkflowStageKey;
    createdAt: string;
    updatedAt: string;
  };
  generations: AiWorkflowDemoGeneration[];
}

function buildPrompt(stageName: string, styleText: string, extra: string) {
  return `你是一名家装签单设计师，请为“${stageName}”阶段生成一张用于签单沟通的高质感室内方案图。整体风格方向为：${styleText}。${extra}`;
}

export const AI_WORKFLOW_DEMO_CASES: AiWorkflowDemoCase[] = [
  {
    id: 'urban-modern',
    name: '89平现代首轮签单演示',
    tagline: '从毛坯图到提案板，一眼看懂完整工作流',
    summary: '适合首页演示“第一次谈单就能快速出方向、再逐步深化”的完整故事线。',
    attraction: '用户不用理解十个独立工具，只要看一次这个演示，就能明白每一步为什么要承接上一轮结果。',
    replaceHint:
      '后续你只需要把本地生成好的图片路径替换到 src/lib/ai/workflow-demo.ts 里的 imageUrl 字段，就能快速升级成正式演示素材。',
    lead: {
      id: 'demo-lead-urban-modern',
      name: '演示客户·李女士',
      phone: '13800000089',
      status: 'assigned',
      stylePreference: '现代、奶油、木质感',
      communityName: '中央公园 89㎡ 三房',
    },
    workflow: {
      id: 'demo-workflow-urban-modern',
      title: '李女士 · 现代首轮签单方案',
      workflowLabel: '首页演示版',
      sourceImage: '/demo-workflows/source-rough.png',
      sourceAssetRole: 'rough_sketch',
      currentStageKey: 'lighting',
      createdAt: '2026-05-15T09:00:00.000Z',
      updatedAt: '2026-05-15T10:25:00.000Z',
    },
    generations: [
      {
        id: 'demo-direction-urban-modern',
        type: 'scenario',
        stageKey: 'direction',
        sourceAssetRole: 'rough_sketch',
        isSelectedBaseline: false,
        nextRecommendedStage: 'base_render',
        status: 'succeeded',
        createdAt: '2026-05-15T09:10:00.000Z',
        input: {
          customPrompt: buildPrompt(
            '选风格',
            '现代、奶油、原木、轻奢和新中式的多风格对比板',
            '请基于同一空间结构输出 4 到 5 套明显不同但都适合家装落地的方向，用于第一次谈单时帮助客户快速选风格。'
          ),
        },
        output: {
          imageUrl: '/colorful.png',
          promptUsed: buildPrompt(
            '选风格',
            '现代、奶油、原木、轻奢和新中式的多风格对比板',
            '请基于同一空间结构输出 4 到 5 套明显不同但都适合家装落地的方向，用于第一次谈单时帮助客户快速选风格。'
          ),
        },
      },
      {
        id: 'demo-base-render-urban-modern',
        type: 'scenario',
        stageKey: 'base_render',
        sourceAssetRole: 'rough_sketch',
        isSelectedBaseline: true,
        nextRecommendedStage: 'soft_furnishing',
        status: 'succeeded',
        createdAt: '2026-05-15T09:28:00.000Z',
        input: {
          customPrompt: buildPrompt(
            '出基准方案',
            '偏现代暖灰木质调',
            '请在保留原始空间结构和镜头逻辑不变的前提下，输出一张可作为后续深化基础的标准效果图。'
          ),
        },
        output: {
          imageUrl: '/3d.png',
          promptUsed: buildPrompt(
            '出基准方案',
            '偏现代暖灰木质调',
            '请在保留原始空间结构和镜头逻辑不变的前提下，输出一张可作为后续深化基础的标准效果图。'
          ),
        },
      },
      {
        id: 'demo-soft-furnishing-urban-modern',
        type: 'scenario',
        stageKey: 'soft_furnishing',
        sourceAssetRole: 'base_render',
        isSelectedBaseline: true,
        nextRecommendedStage: 'proposal_pack',
        status: 'succeeded',
        createdAt: '2026-05-15T09:46:00.000Z',
        input: {
          customPrompt: buildPrompt(
            '深化软装',
            '奶油木质现代混搭',
            '请严格保留硬装结构和镜头，仅替换软装、材质与色彩氛围，形成更接近签单版本的效果图。'
          ),
        },
        output: {
          imageUrl: '/soft-furnishing-result.png',
          promptUsed: buildPrompt(
            '深化软装',
            '奶油木质现代混搭',
            '请严格保留硬装结构和镜头，仅替换软装、材质与色彩氛围，形成更接近签单版本的效果图。'
          ),
        },
      },
      {
        id: 'demo-proposal-urban-modern',
        type: 'scenario',
        stageKey: 'proposal_pack',
        sourceAssetRole: 'approved_render',
        isSelectedBaseline: false,
        nextRecommendedStage: 'lighting',
        status: 'succeeded',
        createdAt: '2026-05-15T10:05:00.000Z',
        input: {
          customPrompt: buildPrompt(
            '生成提案',
            '现代奶油签单提案板',
            '请把定稿效果图包装成适合客户汇报的提案材料，包含多视角、情绪板和软装搭配说明。'
          ),
        },
        output: {
          imageUrl: '/cad.png',
          promptUsed: buildPrompt(
            '生成提案',
            '现代奶油签单提案板',
            '请把定稿效果图包装成适合客户汇报的提案材料，包含多视角、情绪板和软装搭配说明。'
          ),
        },
      },
      {
        id: 'demo-lighting-urban-modern',
        type: 'scenario',
        stageKey: 'lighting',
        sourceAssetRole: 'approved_render',
        isSelectedBaseline: false,
        status: 'succeeded',
        createdAt: '2026-05-15T10:25:00.000Z',
        input: {
          customPrompt: buildPrompt(
            '增强签单',
            '现代暖光氛围',
            '请输出夜景与灯光气质增强图，用于临门一脚阶段增强专业背书和客户购买欲。'
          ),
        },
        output: {
          imageUrl: '/3d.png',
          promptUsed: buildPrompt(
            '增强签单',
            '现代暖光氛围',
            '请输出夜景与灯光气质增强图，用于临门一脚阶段增强专业背书和客户购买欲。'
          ),
        },
      },
    ],
  },
  {
    id: 'cream-family',
    name: '120平奶油亲子方案演示',
    tagline: '更偏家庭生活感，适合打动女性客户',
    summary: '强调温柔、松弛、收纳和亲子生活氛围，适合展示“软装深化”带来的签单推动力。',
    attraction: '这一组更适合做首页吸睛卡片，用户能快速感受到 AI 不只是出图，而是在卖生活方式。',
    replaceHint:
      '建议你后续用 gpt-image-1 或 Nano Banana 生成一套更统一的奶油亲子图，再替换本案例的 sourceImage 和各阶段 imageUrl。',
    lead: {
      id: 'demo-lead-cream-family',
      name: '演示客户·周先生',
      phone: '13800000120',
      status: 'assigned',
      stylePreference: '奶油、原木、亲子互动感',
      communityName: '湖畔天境 120㎡ 四房',
    },
    workflow: {
      id: 'demo-workflow-cream-family',
      title: '周先生 · 奶油亲子提案',
      workflowLabel: '吸睛演示版',
      sourceImage: '/handdrawn.png',
      sourceAssetRole: 'rough_sketch',
      currentStageKey: 'proposal_pack',
      createdAt: '2026-05-14T14:00:00.000Z',
      updatedAt: '2026-05-14T15:35:00.000Z',
    },
    generations: [
      {
        id: 'demo-direction-cream-family',
        type: 'scenario',
        stageKey: 'direction',
        sourceAssetRole: 'rough_sketch',
        isSelectedBaseline: false,
        nextRecommendedStage: 'base_render',
        status: 'succeeded',
        createdAt: '2026-05-14T14:12:00.000Z',
        input: {
          customPrompt: buildPrompt(
            '选风格',
            '奶油亲子、原木治愈、温柔法式和轻暖现代的对比方案',
            '请突出家庭陪伴、生活松弛感和儿童友好细节，让客户一眼感受到未来生活场景。'
          ),
        },
        output: {
          imageUrl: '/colorful.png',
          promptUsed: buildPrompt(
            '选风格',
            '奶油亲子、原木治愈、温柔法式和轻暖现代的对比方案',
            '请突出家庭陪伴、生活松弛感和儿童友好细节，让客户一眼感受到未来生活场景。'
          ),
        },
      },
      {
        id: 'demo-base-render-cream-family',
        type: 'scenario',
        stageKey: 'base_render',
        sourceAssetRole: 'rough_sketch',
        isSelectedBaseline: false,
        nextRecommendedStage: 'soft_furnishing',
        status: 'succeeded',
        createdAt: '2026-05-14T14:35:00.000Z',
        input: {
          customPrompt: buildPrompt(
            '出基准方案',
            '原木奶油底图',
            '请输出一张开放客餐厅的基准效果图，为后续软装深化和情绪提案做统一底图。'
          ),
        },
        output: {
          imageUrl: '/3d.png',
          promptUsed: buildPrompt(
            '出基准方案',
            '原木奶油底图',
            '请输出一张开放客餐厅的基准效果图，为后续软装深化和情绪提案做统一底图。'
          ),
        },
      },
      {
        id: 'demo-soft-furnishing-cream-family',
        type: 'scenario',
        stageKey: 'soft_furnishing',
        sourceAssetRole: 'base_render',
        isSelectedBaseline: true,
        nextRecommendedStage: 'proposal_pack',
        status: 'succeeded',
        createdAt: '2026-05-14T15:02:00.000Z',
        input: {
          customPrompt: buildPrompt(
            '深化软装',
            '奶油原木亲子生活感',
            '请增加织物、弧形家具、亲子互动角和温暖灯光，让客户更容易代入未来居住氛围。'
          ),
        },
        output: {
          imageUrl: '/soft-furnishing-result.png',
          promptUsed: buildPrompt(
            '深化软装',
            '奶油原木亲子生活感',
            '请增加织物、弧形家具、亲子互动角和温暖灯光，让客户更容易代入未来居住氛围。'
          ),
        },
      },
      {
        id: 'demo-proposal-cream-family',
        type: 'scenario',
        stageKey: 'proposal_pack',
        sourceAssetRole: 'approved_render',
        isSelectedBaseline: false,
        nextRecommendedStage: 'lighting',
        status: 'succeeded',
        createdAt: '2026-05-14T15:35:00.000Z',
        input: {
          customPrompt: buildPrompt(
            '生成提案',
            '奶油亲子情绪提案板',
            '请输出适合销售汇报和朋友圈传播的提案板，重点体现空间情绪、材料语言和家庭生活方式。'
          ),
        },
        output: {
          imageUrl: '/cad.png',
          promptUsed: buildPrompt(
            '生成提案',
            '奶油亲子情绪提案板',
            '请输出适合销售汇报和朋友圈传播的提案板，重点体现空间情绪、材料语言和家庭生活方式。'
          ),
        },
      },
    ],
  },
];

export function getAiWorkflowDemoCaseById(id?: string | null) {
  if (!id) {
    return null;
  }

  return AI_WORKFLOW_DEMO_CASES.find((item) => item.id === id) || null;
}
