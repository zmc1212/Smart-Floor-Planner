import type { WorkContent } from './contracts';
export const STYLE_OPTIONS = ['原木风', '现代简约', '奶油风', '侘寂风', '新中式', '北欧', '法式', '轻奢', '其他'];
export const LAYOUT_OPTIONS = ['小户型', '两居', '三居', '四居及以上', '大平层', '复式/跃层', '别墅', '旧房改造', '精装改造', '毛坯新房', '局部改造', '其他'];
export const SPACE_OPTIONS = ['客厅', '餐厅', '主卧', '次卧', '儿童房', '书房', '厨房', '卫生间', '阳台', '玄关', '其他'];
const DEFAULT_TOUR_HOSTS: Record<string, string> = {
  'matterport.com': 'Matterport',
  'kuula.co': 'Kuula',
  '720yun.com': '720云',
  '3dvista.com': '3DVista',
};
function configuredTourHosts(value: string | undefined) {
  if (!value?.trim()) return DEFAULT_TOUR_HOSTS;
  const hosts: Record<string, string> = {};
  for (const item of value.split(',')) {
    const [host, provider] = item.trim().toLowerCase().split('=');
    if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host || '') && provider?.trim()) hosts[host] = provider.trim();
  }
  return Object.keys(hosts).length ? hosts : DEFAULT_TOUR_HOSTS;
}
export const TOUR_HOSTS: Readonly<Record<string, string>> = Object.freeze(configuredTourHosts(process.env.PORTFOLIO_TOUR_HOSTS));
export const EMPTY_WORK: WorkContent = {
  title: '', description: '', primaryStyle: '', secondaryStyles: [], cityCode: '', cityName: '', district: '', communityId: null,
  area: null, rooms: '', layoutTypes: [], authorRole: '', source: '', authorization: '', rightsUntil: null,
  highlights: [], materials: [], palette: [], tours: [], images: [], coverAssetId: null,
  showOnProfile: true, recommendable: true,
};
