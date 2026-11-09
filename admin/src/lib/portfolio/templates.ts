/** Persist stable keys rather than display names so existing profiles remain compatible. */
export const PORTFOLIO_TEMPLATES = [
  { value: 'gallery', label: '空间展窗（现有版）', description: '门洞展窗、图下标题与纸感作品目录。' },
  { value: 'notebook', label: '手账作品集', description: '绿色书脊、叠放照片、设计注解与材料色板。' },
] as const;

export type PortfolioTemplate = typeof PORTFOLIO_TEMPLATES[number]['value'];
export const DEFAULT_PORTFOLIO_TEMPLATE: PortfolioTemplate = 'gallery';
