import type { AiActionKey, AiCapability, AiLogicalModelKey } from '@/lib/ai/provider-types';
import type { AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import type { MiniAiRenderMode } from '@/lib/ai/mini-ai-provider';

export type AiDesignSurface = 'admin_workflow' | 'admin_quick' | 'miniprogram';

export interface AiDesignActionDefinition {
  key: string;
  label: string;
  shortDescription: string;
  resultBoundary: string;
  requiredInputs: Array<'customer' | 'floor_plan' | 'space_image' | 'reference_image' | 'selected_baseline' | 'style'>;
  actionKey: AiActionKey;
  capability: AiCapability;
  logicalModelKey: AiLogicalModelKey;
  surfaces: AiDesignSurface[];
  stageKey?: AiWorkflowStageKey;
  miniMode?: MiniAiRenderMode;
  nextStageKey?: AiWorkflowStageKey;
}

export const AI_DESIGN_ACTION_DEFINITIONS: AiDesignActionDefinition[] = [
  {
    key: 'direction',
    label: '确定风格方向',
    shortDescription: '快速生成首轮风格方向，用于和客户锁定偏好。',
    resultBoundary: '输出风格方向图，不作为最终施工方案。',
    requiredInputs: ['customer', 'floor_plan'],
    actionKey: 'image.scenario',
    capability: 'image.generate',
    logicalModelKey: 'image.generate.standard',
    surfaces: ['admin_workflow'],
    stageKey: 'direction',
    nextStageKey: 'base_render',
  },
  {
    key: 'base_render',
    label: '直接出空间效果',
    shortDescription: '从当前户型或现场图生成可继续深化的基准效果图。',
    resultBoundary: '输出概念效果图，后续可继续软装、提案和灯光阶段。',
    requiredInputs: ['customer', 'floor_plan'],
    actionKey: 'image.scenario',
    capability: 'image.generate',
    logicalModelKey: 'image.generate.standard',
    surfaces: ['admin_workflow'],
    stageKey: 'base_render',
    nextStageKey: 'soft_furnishing',
  },
  {
    key: 'soft_furnishing',
    label: '深化软装',
    shortDescription: '保留硬装和固定结构，优化家具、窗帘、地毯与装饰。',
    resultBoundary: '仅调整软装表达，不改变门窗、墙体和镜头。',
    requiredInputs: ['customer', 'selected_baseline'],
    actionKey: 'image.scenario',
    capability: 'image.edit',
    logicalModelKey: 'image.edit.standard',
    surfaces: ['admin_workflow'],
    stageKey: 'soft_furnishing',
    nextStageKey: 'proposal_pack',
  },
  {
    key: 'proposal_pack',
    label: '生成客户提案',
    shortDescription: '把当前定稿包装成适合汇报和转发的提案板。',
    resultBoundary: '输出提案图或展板，不生成真实 PDF。',
    requiredInputs: ['customer', 'selected_baseline'],
    actionKey: 'image.scenario',
    capability: 'image.edit',
    logicalModelKey: 'image.edit.standard',
    surfaces: ['admin_workflow'],
    stageKey: 'proposal_pack',
    nextStageKey: 'lighting',
  },
  {
    key: 'lighting',
    label: '增强签单表达',
    shortDescription: '生成夜景、灯光分析和灯具建议。',
    resultBoundary: '用于沟通展示，不替代电气施工图。',
    requiredInputs: ['customer', 'selected_baseline'],
    actionKey: 'image.scenario',
    capability: 'image.edit',
    logicalModelKey: 'image.edit.standard',
    surfaces: ['admin_workflow'],
    stageKey: 'lighting',
  },
  {
    key: 'reference_recreate',
    label: '参考图复刻',
    shortDescription: '提取灵感图的设计语言，应用到当前空间。',
    resultBoundary: '优先保留当前空间结构，不承诺像素级复制。',
    requiredInputs: ['space_image', 'reference_image'],
    actionKey: 'image.reference_recreate',
    capability: 'image.edit',
    logicalModelKey: 'image.edit.standard',
    surfaces: ['miniprogram'],
    miniMode: 'reference_recreate',
    stageKey: 'base_render',
    nextStageKey: 'soft_furnishing',
  },
  {
    key: 'style_transform',
    label: '空间换风格',
    shortDescription: '保留结构与视角，快速切换整体风格。',
    resultBoundary: '调整材质、家具和氛围，尽量不改变门窗位置。',
    requiredInputs: ['space_image', 'style'],
    actionKey: 'image.style_transform',
    capability: 'image.edit',
    logicalModelKey: 'image.edit.standard',
    surfaces: ['miniprogram'],
    miniMode: 'style_transform',
    stageKey: 'base_render',
    nextStageKey: 'soft_furnishing',
  },
  {
    key: 'floor_plan_render',
    label: '户型生成',
    shortDescription: '按正式量房尺寸、层高和开口生成概念效果。',
    resultBoundary: '只是概念效果，不作为施工级或像素级还原。',
    requiredInputs: ['floor_plan', 'style'],
    actionKey: 'image.floor_plan_style',
    capability: 'image.generate',
    logicalModelKey: 'image.generate.standard',
    surfaces: ['miniprogram'],
    miniMode: 'floor_plan_render',
    stageKey: 'perspective_upgrade',
    nextStageKey: 'base_render',
  },
  {
    key: 'mini_soft_furnishing',
    label: '软装深化',
    shortDescription: '保留硬装，重点优化软装细节。',
    resultBoundary: '仅调整家具、窗帘、地毯、挂画、绿植和装饰灯。',
    requiredInputs: ['space_image', 'style'],
    actionKey: 'image.soft_furnishing_render',
    capability: 'image.edit',
    logicalModelKey: 'image.edit.standard',
    surfaces: ['miniprogram'],
    miniMode: 'soft_furnishing',
    stageKey: 'soft_furnishing',
    nextStageKey: 'proposal_pack',
  },
  {
    key: 'floor_plan_style',
    label: '户型表现',
    shortDescription: '把现有户型转换为彩平、CAD、3D 或手绘风格。',
    resultBoundary: '为沟通表现图，不替代正式 CAD 或施工图。',
    requiredInputs: ['floor_plan', 'style'],
    actionKey: 'image.floor_plan_style',
    capability: 'image.generate',
    logicalModelKey: 'image.generate.standard',
    surfaces: ['admin_quick'],
  },
  {
    key: 'furnishing_render',
    label: '快速风格设计',
    shortDescription: '基于户型快速生成不同装修风格表现。',
    resultBoundary: '用于快速比稿和沟通，不承诺施工精度。',
    requiredInputs: ['floor_plan', 'style'],
    actionKey: 'image.furnishing_render',
    capability: 'image.generate',
    logicalModelKey: 'image.generate.standard',
    surfaces: ['admin_quick'],
  },
  {
    key: 'soft_furnishing_render',
    label: '快速软装改造',
    shortDescription: '上传现场图，快速生成软装沟通图。',
    resultBoundary: '优先保留原空间结构，结果为概念沟通图。',
    requiredInputs: ['space_image', 'style'],
    actionKey: 'image.soft_furnishing_render',
    capability: 'image.edit',
    logicalModelKey: 'image.edit.standard',
    surfaces: ['admin_quick'],
  },
];

export function getAiDesignActionDefinition(key?: string | null) {
  return AI_DESIGN_ACTION_DEFINITIONS.find((action) => action.key === key || action.stageKey === key || action.miniMode === key);
}

export function listAiDesignActions(surface: AiDesignSurface) {
  return AI_DESIGN_ACTION_DEFINITIONS.filter((action) => action.surfaces.includes(surface));
}
