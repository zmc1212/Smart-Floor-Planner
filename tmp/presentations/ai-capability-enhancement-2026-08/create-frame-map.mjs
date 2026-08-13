import fs from 'node:fs/promises';

const inspectPath = 'C:/Users/Administrator/CodexTmp/ai-capability-enhancement-2026-08/full-inspect.ndjson';
const records = (await fs.readFile(inspectPath, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
const bySlide = new Map();
for (const item of records) {
  if (!item.slide) continue;
  if (!bySlide.has(item.slide)) bySlide.set(item.slide, []);
  bySlide.get(item.slide).push(item);
}

const edits = new Map();
function rewrite(slide, texts) {
  const items = bySlide.get(slide) || [];
  const targets = [];
  for (const [oldText, newText] of Object.entries(texts)) {
    const item = items.find((candidate) => candidate.text === oldText);
    if (!item) throw new Error(`Missing text on slide ${slide}: ${oldText}`);
    targets.push({ action: 'rewrite', shapeId: item.id, oldText, newText });
  }
  edits.set(slide, [...(edits.get(slide) || []), ...targets]);
}
function replaceImages(slide, replacements) {
  const images = (bySlide.get(slide) || []).filter((item) => item.kind === 'image');
  if (images.length !== replacements.length) throw new Error(`Slide ${slide}: expected ${replacements.length} images, got ${images.length}`);
  edits.set(slide, [
    ...(edits.get(slide) || []),
    ...images.map((image, index) => ({ action: 'replace', shapeId: image.id, asset: replacements[index] })),
  ]);
}

rewrite(9, {
  '四种 AI 任务，解决四种客户沟通问题': '数据库里的家装模板，把一次生成扩展为多种能力',
  '两张完整设计稿展示任务入口与空间导航；右侧说明每类任务解决什么问题。': '当前启用模板库共 960 项；这里筛选最适合客户沟通的四类家装能力。',
  '任务入口': '毛坯变完整方案',
  '整屋与房间': '户型与空间诊断',
  '参考图复刻': '毛坯装修',
  '把参考图的风格语言应用到当前空间，优先遵守空间结构。': '从空房或毛坯底图生成完整硬装、家具与灯光表达。',
  '空间换风格': '风格迁移',
  '尽量保留结构与镜头，调整材质、家具和整体氛围。': '沿用参考图的色彩、材质与家具语言，适配当前空间。',
  '户型生成': '平面与诊断',
  '基于正式户型的整屋或单空间数据形成概念效果。': '彩化户型、识别布局问题，辅助整屋方案沟通。',
  '软装深化': '局部深化',
  '保留硬装与固定结构，优化家具、窗帘、灯具和装饰。': '材质替换、软装搭配与局部修改，支持持续迭代。',
});
replaceImages(9, ['db-906.jpg', 'db-642.jpg']);

rewrite(10, {
  '09 / 设计依据': '09 / 同空间多方案',
  '先确认设计对象，再选择整屋或单空间': '同一空间保持几何不变，快速比较三种设计语言',
  '正式户型提供墙体、尺寸、层高与门窗依据；完整设计稿展示客户项目、空间范围和房间选择。': '演示以同一空房为基准，仅改变硬装、材质、家具与灯光，方案差异一眼可见。',
  '客户与正式户型': '输入 · 原始空间',
  '整屋与单空间': '方案 A · 现代奶油',
  '资料未齐时提示': '方案 B · 现代法式',
  '户型生成': '方案 C · 现代中式',
  '必须关联有效正式户型，再选择整屋或目标房间。': '深色胡桃木、纸灯与克制留白，氛围沉静。',
  '其他三类任务': '演示价值',
  '可按实际素材独立使用；已选客户与空间时继续继承上下文。': '统一镜头下直接比较，减少客户对风格想象的偏差。',
});
replaceImages(10, ['01-before-empty.jpg', '02-modern-cream.jpg', '03-modern-french.jpg']);

rewrite(12, {
  '11 / 成果与深化': '11 / 小程序成果交付',
  '成果可以比较、分享，并沿同一客户方案继续深化': '同一套小程序界面，承接多种 AI 设计结果',
  '三张完整设计稿展示结果对比、历史记录与方案推荐；小程序完成沟通，后台继续管理版本与下一步。': '以下为基于获批结果页设计稿的演示状态，用于展示真实运行截图缺失时的产品能力。',
  '查看前后效果': '现代奶油 · 温暖治愈',
  '管理历史任务': '现代法式 · 精致明亮',
  '比较推荐方案': '现代中式 · 沉静克制',
  '小程序': '现场沟通',
  '预览与比较\n保存与分享\n继续优化\n查看历史': '预览多方案\n保存与分享\n继续优化\n查看历史',
  '企业后台': '状态说明',
  '管理定稿与候选\n推荐下一步\n继续提案与灯光深化': '批准设计稿 + AI 演示效果\n非真实运行截图\n能力边界保持不变',
});
replaceImages(12, ['08-miniprogram-result-cream.png', '09-miniprogram-result-french.png', '10-miniprogram-result-chinese.png']);

rewrite(13, {
  'AI 工作台把参考图整理成可继续创作的方案资产': 'AI 工作台不止一种效果，而是一套可复用的家装模板库',
  '上传空间图或参考图后，AI 协助提取色彩、材质、家具与灯具语言，形成情绪板并继续生成空间效果。': '当前数据库启用 960 个模板；家装演示优先呈现毛坯装修、风格迁移、材质替换与软装分析。',
  '企业后台 · 上传参考图、编辑提示、再次生成与历史记录': '示例：现代奶油毛坯装修 · 从空房到完整客厅方案',
  '风格情绪板': '同空间 · 毛坯 → 方案',
  '空间效果图': '局部深化 · 材质替换',
  '参考图': '选择模板',
  '提取设计语言': '参数化提示',
  '生成方案': '继续深化',
  '从视觉参考中提取色彩、材质、纹理、家具与灯具线索，先形成可沟通的情绪板，再生成空间效果并持续迭代。': '可组合空间类型、目标风格、硬装材质、家具与灯光要求；历史任务继续保留并可再次生成。',
});
replaceImages(13, ['06-compare-before-cream.jpg', 'db-906.jpg', '07-compare-cream-material.jpg']);

for (let slide = 10; slide <= 17; slide += 1) {
  const items = bySlide.get(slide) || [];
  const page = items.find((item) => item.kind === 'textbox' && item.text === String(slide));
  if (page) {
    edits.set(slide, [...(edits.get(slide) || []), { action: 'rewrite', shapeId: page.id, oldText: String(slide), newText: String(slide + 2) }]);
  }
  const eyebrow = items.find((item) => item.kind === 'textbox' && /^\d{2} \/ /.test(item.text || ''));
  if (eyebrow && slide >= 10) {
    const oldPrefix = eyebrow.text.slice(0, 2);
    const newPrefix = String(Number(oldPrefix) + 2).padStart(2, '0');
    edits.set(slide, [...(edits.get(slide) || []), { action: 'rewrite', shapeId: eyebrow.id, oldText: eyebrow.text, newText: newPrefix + eyebrow.text.slice(2) }]);
  }
}

const outputSlides = [];
for (let outputSlide = 1; outputSlide <= 19; outputSlide += 1) {
  let sourceSlide;
  let narrativeRole;
  if (outputSlide <= 9) {
    sourceSlide = outputSlide;
    narrativeRole = outputSlide === 9 ? 'AI capability evidence with database templates' : 'preserve source narrative';
  } else if (outputSlide === 10) {
    sourceSlide = 10;
    narrativeRole = 'same-space multi-style design comparison';
  } else if (outputSlide === 11) {
    sourceSlide = 10;
    narrativeRole = 'same-space local material refinement';
  } else if (outputSlide === 12) {
    sourceSlide = 10;
    narrativeRole = 'database prompt template gallery';
  } else {
    sourceSlide = outputSlide - 2;
    narrativeRole = sourceSlide === 12 ? 'Mini Program AI result state comparison' : sourceSlide === 13 ? 'enterprise AI workbench template evidence' : 'preserve source narrative with renumbering';
  }
  outputSlides.push({ outputSlide, sourceSlide, narrativeRole, reuseMode: 'duplicate-slide', editTargets: edits.get(sourceSlide) || [] });
}

await fs.writeFile('C:/Users/Administrator/CodexTmp/ai-capability-enhancement-2026-08/template-frame-map-base.json', JSON.stringify({ outputSlides }, null, 2), 'utf8');
console.log(JSON.stringify({ slides: outputSlides.length, editedSources: [...edits.keys()] }));
