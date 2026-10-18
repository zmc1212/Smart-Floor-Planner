import type { WorkContent } from './contracts';
export const STYLE_OPTIONS = ['原木风', '现代简约', '奶油风', '侘寂风', '新中式', '北欧', '法式', '轻奢', '其他'];
export const EMPTY_WORK: WorkContent = {
  title: '', description: '', primaryStyle: '', secondaryStyles: [], cityCode: '', cityName: '', district: '', communityId: null,
  area: null, rooms: '', authorRole: '', source: '', authorization: '', rightsUntil: null, images: [], coverAssetId: null,
  showOnProfile: true, recommendable: true,
};
