import fs from 'node:fs/promises';

const dir = 'C:/Users/Administrator/CodexTmp/ai-capability-enhancement-2026-08';
const plan = JSON.parse(await fs.readFile(`${dir}/template-frame-map-base.json`, 'utf8'));
const records = (await fs.readFile(`${dir}/full-inspect.ndjson`, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
const items = (slide) => records.filter((item) => item.slide === slide);
const findText = (slide, text) => {
  const item = items(slide).find((candidate) => candidate.text === text);
  if (!item) throw new Error(`Missing ${slide}: ${text}`);
  return item.id;
};
const rewrite = (slide, oldText, newText) => ({ action: 'rewrite', shapeId: findText(slide, oldText), oldText, newText });
const imageTargets = (slide, assets) => {
  const images = items(slide).filter((item) => item.kind === 'image');
  if (images.length !== assets.length) throw new Error(`Images ${slide}: ${images.length} != ${assets.length}`);
  return images.map((item, index) => ({ action: 'replace', shapeId: item.id, asset: assets[index] }));
};
const uniqueTargets = (targets) => {
  const seen = new Set();
  return targets.filter((target) => {
    if (seen.has(target.shapeId)) return false;
    seen.add(target.shapeId);
    return true;
  });
};

const out10 = plan.outputSlides.find((entry) => entry.outputSlide === 10);
out10.editTargets = uniqueTargets(out10.editTargets.filter((target) => ![findText(10, '10')].includes(target.shapeId)));

plan.outputSlides.find((entry) => entry.outputSlide === 11).editTargets = [
  rewrite(10, '09 / 设计依据', '10 / 局部深化'),
  rewrite(10, '先确认设计对象，再选择整屋或单空间', '同一方案继续优化，只改材质也能形成清晰对比'),
  rewrite(10, '正式户型提供墙体、尺寸、层高与门窗依据；完整设计稿展示客户项目、空间范围和房间选择。', '保留结构、家具与灯光，仅把电视墙替换为洞石、地面替换为浅烟熏橡木。'),
  rewrite(10, '客户与正式户型', '基础方案 · 现代奶油'),
  rewrite(10, '整屋与单空间', '局部修改 · 材质替换'),
  rewrite(10, '资料未齐时提示', '辅助输出 · 软装分析'),
  rewrite(10, '户型生成', '提示词要点'),
  rewrite(10, '必须关联有效正式户型，再选择整屋或目标房间。', '电视墙改暖米色洞石；地面改浅烟熏橡木。'),
  rewrite(10, '其他三类任务', '不变项'),
  rewrite(10, '可按实际素材独立使用；已选客户与空间时继续继承上下文。', '镜头、结构、家具、灯光与物件位置保持不变。'),
  ...imageTargets(10, ['portrait-02-modern-cream.jpg', 'portrait-05-material-replacement.jpg', 'portrait-db-618.jpg']),
  rewrite(10, '10', '11'),
];

plan.outputSlides.find((entry) => entry.outputSlide === 12).editTargets = [
  rewrite(10, '09 / 设计依据', '11 / 家装模板库'),
  rewrite(10, '先确认设计对象，再选择整屋或单空间', '把模板做成可选择的能力，而不是一条固定提示词'),
  rewrite(10, '正式户型提供墙体、尺寸、层高与门窗依据；完整设计稿展示客户项目、空间范围和房间选择。', '真实数据库示例：现代奶油毛坯装修、法式毛坯装修、户型问题诊断。'),
  rewrite(10, '客户与正式户型', '现代奶油毛坯装修'),
  rewrite(10, '整屋与单空间', '法式毛坯装修'),
  rewrite(10, '资料未齐时提示', '户型问题诊断'),
  rewrite(10, '户型生成', '当前提示词库'),
  rewrite(10, '必须关联有效正式户型，再选择整屋或目标房间。', '2026-08-01 发布；共 960 个启用模板。'),
  rewrite(10, '其他三类任务', '演示筛选'),
  rewrite(10, '可按实际素材独立使用；已选客户与空间时继续继承上下文。', '优先家装、可比较、客户易理解的模板。'),
  ...imageTargets(10, ['portrait-db-906.jpg', 'portrait-db-893.jpg', 'portrait-db-642.jpg']),
  rewrite(10, '10', '12'),
];

for (const entry of plan.outputSlides) {
  if (entry.outputSlide === 14) {
    entry.editTargets = uniqueTargets(entry.editTargets).map((target) =>
      target.shapeId === findText(12, '11 / 成果与深化')
        ? { ...target, newText: '13 / 小程序成果交付' }
        : target,
    );
  } else if (entry.outputSlide === 15) {
    entry.editTargets = uniqueTargets(entry.editTargets).map((target) =>
      target.shapeId === findText(13, '12 / 企业后台 AI 工作台')
        ? { ...target, newText: '14 / 企业后台 AI 工作台' }
        : target,
    );
  } else {
    entry.editTargets = uniqueTargets(entry.editTargets);
  }
}

plan.omittedSourceSlides = [];
await fs.writeFile(`${dir}/template-frame-map.json`, JSON.stringify(plan, null, 2), 'utf8');
console.log(JSON.stringify(plan.outputSlides.map(({ outputSlide, sourceSlide, editTargets }) => ({ outputSlide, sourceSlide, edits: editTargets.length }))));
