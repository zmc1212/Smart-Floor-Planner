export type AiWorkflowCategory = 'main' | 'advanced';

export type AiWorkflowStageKey =
  | 'conversation'
  | 'direction'
  | 'base_render'
  | 'soft_furnishing'
  | 'proposal_pack'
  | 'lighting'
  | 'tour_board'
  | 'premium_board'
  | 'perspective_upgrade'
  | 'cad_detail';

export type AiWorkflowSourceAssetRole =
  | 'rough_sketch'
  | 'floor_plan'
  | 'base_render'
  | 'approved_render'
  | 'concept_element';

export interface AiWorkflowStageDefinition {
  key: AiWorkflowStageKey;
  name: string;
  actionLabel: string;
  description: string;
  inputHint: string;
  outputHint: string;
  category: AiWorkflowCategory;
  nextRecommendedStage?: AiWorkflowStageKey;
}

export const AI_WORKFLOW_STAGE_DEFINITIONS: Record<AiWorkflowStageKey, AiWorkflowStageDefinition> =
  {
    conversation: {
      key: 'conversation',
      name: '方案对话',
      actionLabel: '继续出图',
      description: '围绕同一套方案用自然语言多轮出图，勾选满意效果图后发给客户。',
      inputHint: '正式户型 + 上一轮效果图',
      outputHint: '对话效果图',
      category: 'main',
    },
    direction: {
      key: 'direction',
      name: '选风格',
      actionLabel: '生成风格方向',
      description: '基于毛坯图、手稿或彩平快速出多风格方向，用于首次沟通和锁定客户偏好。',
      inputHint: '毛坯图 / 手稿 / 彩平',
      outputHint: '风格对比板、候选方向',
      category: 'main',
      nextRecommendedStage: 'base_render',
    },
    base_render: {
      key: 'base_render',
      name: '出基准方案',
      actionLabel: '生成基准效果图',
      description: '把当前空间输入转成可复用的基准效果图，作为后续软装、提案和灯光的统一底图。',
      inputHint: '原始参考图 + 风格方向',
      outputHint: '基准效果图',
      category: 'main',
      nextRecommendedStage: 'soft_furnishing',
    },
    soft_furnishing: {
      key: 'soft_furnishing',
      name: '深化软装',
      actionLabel: '生成软装深化',
      description: '基于基准效果图替换软装、材质与色调，保留硬装结构和镜头。',
      inputHint: '基准效果图',
      outputHint: '软装版本 / 定稿效果图',
      category: 'main',
      nextRecommendedStage: 'proposal_pack',
    },
    proposal_pack: {
      key: 'proposal_pack',
      name: '生成提案',
      actionLabel: '生成提案板',
      description: '把定稿效果图包装成适合汇报和转发的提案材料，如情绪板、选型说明和视角展示。',
      inputHint: '定稿效果图',
      outputHint: '提案图、情绪板、软装清单',
      category: 'main',
      nextRecommendedStage: 'lighting',
    },
    lighting: {
      key: 'lighting',
      name: '增强签单',
      actionLabel: '生成灯光增强',
      description: '在客户已接近成交时补充灯光分析、日夜景和灯具建议，强化专业背书。',
      inputHint: '定稿效果图',
      outputHint: '夜景图、灯光分析板、灯具建议',
      category: 'main',
    },
    tour_board: {
      key: 'tour_board',
      name: '九宫格漫游',
      actionLabel: '生成九宫格',
      description: '把定稿空间扩展成多视角九宫格，用于空间漫游和社群传播。',
      inputHint: '定稿效果图',
      outputHint: '九宫格分镜板',
      category: 'advanced',
    },
    premium_board: {
      key: 'premium_board',
      name: '高端提案工具',
      actionLabel: '生成高端展板',
      description: '围绕单一设计元素推演概念板，适用于高端汇报和品牌表达。',
      inputHint: '设计元素 / 特色家具 / 特殊材质',
      outputHint: '概念展板',
      category: 'advanced',
    },
    perspective_upgrade: {
      key: 'perspective_upgrade',
      name: '彩平转透视',
      actionLabel: '生成透视效果',
      description: '把彩平或户型图转成更适合沟通的透视效果图。',
      inputHint: '彩平 / 户型图',
      outputHint: '透视效果图',
      category: 'advanced',
    },
    cad_detail: {
      key: 'cad_detail',
      name: '深化辅助工具',
      actionLabel: '生成线稿参考',
      description: '把效果图拆成黑白线稿、立面和施工参考，用于设计深化。',
      inputHint: '效果图',
      outputHint: '线稿 / 立面参考',
      category: 'advanced',
    },
  };

export const MAIN_WORKFLOW_STAGES: AiWorkflowStageDefinition[] = [
  AI_WORKFLOW_STAGE_DEFINITIONS.direction,
  AI_WORKFLOW_STAGE_DEFINITIONS.base_render,
  AI_WORKFLOW_STAGE_DEFINITIONS.soft_furnishing,
  AI_WORKFLOW_STAGE_DEFINITIONS.proposal_pack,
  AI_WORKFLOW_STAGE_DEFINITIONS.lighting,
];

export const ADVANCED_WORKFLOW_TOOLS: AiWorkflowStageDefinition[] = [
  AI_WORKFLOW_STAGE_DEFINITIONS.tour_board,
  AI_WORKFLOW_STAGE_DEFINITIONS.premium_board,
  AI_WORKFLOW_STAGE_DEFINITIONS.perspective_upgrade,
  AI_WORKFLOW_STAGE_DEFINITIONS.cad_detail,
];

export function getWorkflowStageDefinition(stageKey?: string | null) {
  if (!stageKey) {
    return undefined;
  }

  return AI_WORKFLOW_STAGE_DEFINITIONS[stageKey as AiWorkflowStageKey];
}

export function getNextWorkflowStage(
  stageKey?: AiWorkflowStageKey | null
): AiWorkflowStageKey | undefined {
  return stageKey ? AI_WORKFLOW_STAGE_DEFINITIONS[stageKey]?.nextRecommendedStage : undefined;
}
