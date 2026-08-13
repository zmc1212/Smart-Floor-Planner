import fs from "node:fs/promises";

const records = (await fs.readFile("Z:/source-inspect.ndjson", "utf8"))
  .trim()
  .split(/\r?\n/)
  .map(JSON.parse);

const bboxKey = (bbox = []) => bbox.map((value) => Math.round(Number(value))).join(",");
const bySlide = (slide) => records.filter((record) => record.slide === slide);

function find(slide, left, top, kind = "textbox") {
  const matches = bySlide(slide).filter((record) =>
    record.kind === kind &&
    Math.round(record.bbox?.[0] ?? -1) === Math.round(left) &&
    Math.round(record.bbox?.[1] ?? -1) === Math.round(top)
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one ${kind} at slide ${slide} / ${left},${top}; got ${matches.length}: ${matches.map((item) => `${item.id}:${bboxKey(item.bbox)}`).join(" | ")}`);
  }
  return matches[0];
}

function rewrite(slide, left, top, newText) {
  const record = find(slide, left, top, "textbox");
  return { action: "rewrite", shapeId: record.id, oldText: record.text, newText };
}

function replace(slide, left, top, asset) {
  const record = find(slide, left, top, "image");
  return { action: "replace", shapeId: record.id, asset };
}

const slides = [
  {
    sourceSlide: 1,
    narrativeRole: "owner-facing opening promise",
    edits: [
      rewrite(1, 120, 58, "家客来  JIAKELAI"),
      rewrite(1, 58, 160, "量房成果沉淀\n设计直接接手\n客户更快看方案"),
      rewrite(1, 58, 414, "家客来把客户档案、正式量房、AI 方案和团队跟进连接成同一条服务主线。"),
      rewrite(1, 70, 527, "同一客户  ·  同一户型  ·  持续设计"),
      rewrite(1, 58, 667, "老板销售版  ·  16:9  ·  2026.08"),
    ],
  },
  {
    sourceSlide: 3,
    narrativeRole: "owner business pain",
    edits: [
      rewrite(3, 54, 34, "01 / 老板为什么需要"),
      rewrite(3, 54, 72, "真正拖慢签单的，不是设计能力，而是交接断点"),
      rewrite(3, 54, 142, "客户资料、现场尺寸、设计依据和跟进责任分散后，团队会重复劳动，客户也要重复等待。"),
      rewrite(3, 54, 680, "家客来 JIAKELAI  ·  老板决策"),
      rewrite(3, 1180, 680, "02"),
      rewrite(3, 180, 224, "客户资料散落"),
      rewrite(3, 520, 226, "微信、纸张、表格分开保存，接手的人看不到完整上下文。"),
      rewrite(3, 180, 316, "尺寸反复录入"),
      rewrite(3, 520, 318, "现场手抄、拍照、转述后再录入，耗时且容易失真。"),
      rewrite(3, 180, 408, "设计师重新确认"),
      rewrite(3, 520, 410, "客户需求和户型没有连接，设计接手仍要从头问起。"),
      rewrite(3, 180, 500, "老板看不见下一步"),
      rewrite(3, 520, 502, "客户卡在哪一步、由谁负责、已经产出了什么都不够清楚。"),
      rewrite(3, 206, 615, "家客来解决的不是“多一个工具”，而是让每一步成果继续被下一岗位使用。"),
    ],
  },
  {
    sourceSlide: 4,
    narrativeRole: "single customer journey",
    edits: [
      rewrite(4, 54, 34, "02 / 一个客户走完整流程"),
      rewrite(4, 54, 72, "张女士只建一次档案，沿一条服务主线持续推进"),
      rewrite(4, 54, 142, "同一位客户、同一份正式户型、同一组设计成果，贯穿业务、量房、设计和管理。"),
      rewrite(4, 54, 680, "家客来 JIAKELAI  ·  张女士客户主线"),
      rewrite(4, 1180, 680, "03"),
      rewrite(4, 20, 372, "建立客户档案"),
      rewrite(4, 38, 486, "客户资料"),
      rewrite(4, 220, 372, "进入正式量房"),
      rewrite(4, 238, 486, "测量墙图"),
      rewrite(4, 420, 372, "保存正式户型"),
      rewrite(4, 438, 486, "空间依据"),
      rewrite(4, 620, 372, "生成 AI 方案"),
      rewrite(4, 638, 486, "多方案结果"),
      rewrite(4, 820, 372, "沟通与深化"),
      rewrite(4, 838, 486, "修改记录"),
      rewrite(4, 1020, 372, "更新客户阶段"),
      rewrite(4, 1038, 486, "跟进状态"),
      rewrite(4, 96, 587, "一次建档  ·  一次量房  ·  多轮设计  ·  全程可追踪"),
    ],
  },
  {
    sourceSlide: 5,
    narrativeRole: "customer record as common entry",
    edits: [
      rewrite(5, 54, 34, "03 / 客户档案"),
      rewrite(5, 54, 72, "一条客户线索，就是量房、设计和跟进的共同入口"),
      rewrite(5, 54, 142, "张女士的称呼、电话、小区、面积和偏好只录入一次，后续成果继续关联在同一客户下。"),
      rewrite(5, 54, 680, "家客来 JIAKELAI  ·  张女士客户档案"),
      rewrite(5, 1180, 680, "04"),
      rewrite(5, 752, 258, "客户资料一次建全"),
      rewrite(5, 752, 292, "称呼、电话、小区、面积、偏好与当前阶段集中保存。"),
      rewrite(5, 752, 370, "量房和方案继续关联"),
      rewrite(5, 752, 404, "正式户型、AI 方案和更新时间都回到同一客户档案。"),
      rewrite(5, 752, 482, "下一步更清楚"),
      rewrite(5, 752, 516, "按客户阶段筛选需要量房、设计、跟进或回访的人。"),
    ],
  },
  {
    sourceSlide: 6,
    narrativeRole: "formal surveying proof",
    edits: [
      rewrite(6, 54, 34, "04 / 正式量房"),
      rewrite(6, 54, 72, "现场量房的成果，要能直接进入后续设计"),
      rewrite(6, 54, 142, "手工录入或授权蓝牙都形成毫米制墙图；墙体、门窗和闭合空间保存到张女士的客户档案。"),
      rewrite(6, 54, 680, "家客来 JIAKELAI  ·  正式量房"),
      rewrite(6, 1180, 680, "05"),
      rewrite(6, 1052, 276, "两种输入"),
      rewrite(6, 1060, 341, "手工录入"),
      rewrite(6, 1060, 389, "授权蓝牙"),
      rewrite(6, 1052, 474, "统一结果"),
      rewrite(6, 1044, 518, "毫米制墙图\n门窗与闭合空间\n可继续量房或设计"),
    ],
  },
  {
    sourceSlide: 10,
    narrativeRole: "correct same-space three-style comparison",
    edits: [
      rewrite(10, 54, 34, "05 / 同空间多方案"),
      rewrite(10, 54, 72, "同一间客厅，保持结构不变，直接比较三种设计语言"),
      rewrite(10, 54, 142, "以下为张女士客厅的 AI 演示效果：使用同一空房基准，仅改变硬装、材质、家具与灯光。"),
      rewrite(10, 54, 680, "家客来 JIAKELAI  ·  AI 方案比较"),
      rewrite(10, 1180, 680, "06"),
      rewrite(10, 78, 514, "现代奶油 · 温暖克制"),
      rewrite(10, 380, 514, "现代法式 · 精致明亮"),
      rewrite(10, 682, 514, "现代中式 · 沉静留白"),
      rewrite(10, 994, 250, "同一份空间依据"),
      rewrite(10, 994, 298, "同一镜头、结构与开口\n只比较风格表达"),
      rewrite(10, 994, 424, "用途说明"),
      rewrite(10, 994, 470, "用于概念方案比较与客户沟通\n不是施工图"),
      replace(10, 70, 245, "owner-sales-modern-cream-v2.jpg"),
      replace(10, 372, 245, "owner-sales-modern-french-v2.jpg"),
      replace(10, 674, 245, "owner-sales-modern-chinese-v2.jpg"),
    ],
  },
  {
    sourceSlide: 15,
    narrativeRole: "before-after and local refinement evidence",
    edits: [
      rewrite(15, 54, 34, "06 / 持续深化"),
      rewrite(15, 54, 72, "从空房到方案，再到局部材质修改，\n同一客户可以持续深化"),
      rewrite(15, 54, 178, "张女士客厅的每次生成都保留在同一设计旅程中，设计师可以比较、选择和继续修改。"),
      rewrite(15, 54, 680, "家客来 JIAKELAI  ·  AI 持续深化"),
      rewrite(15, 1180, 680, "07"),
      rewrite(15, 84, 549, "空房 → 现代奶油：建立第一版沟通方案"),
      rewrite(15, 796, 437, "同空间 · 第一版方案"),
      rewrite(15, 1024, 437, "同方案 · 局部材质替换"),
      rewrite(15, 800, 514, "选择目标"),
      rewrite(15, 904, 514, "生成方案"),
      rewrite(15, 1060, 514, "继续深化"),
      rewrite(15, 800, 558, "AI 演示效果；用于方案沟通与比较，不作为施工图。"),
    ],
  },
  {
    sourceSlide: 13,
    narrativeRole: "actual task lifecycle and cost feedback",
    edits: [
      rewrite(13, 54, 34, "07 / 实际任务链"),
      rewrite(13, 54, 72, "真实任务链同时管理素材、进度、点数与异常"),
      rewrite(13, 54, 142, "设计师提交前看清所需图片、目标风格和点数预估；生成中持续查看进度，失败释放点数并可重试。"),
      rewrite(13, 54, 680, "家客来 JIAKELAI  ·  AI 任务管理"),
      rewrite(13, 1180, 680, "08"),
      rewrite(13, 78, 604, "提交前：素材与范围"),
      rewrite(13, 450, 604, "生成中：进度与异常"),
      rewrite(13, 998, 248, "任务可控"),
      rewrite(13, 998, 294, "所需素材\n目标风格\n设计范围\n点数预估"),
      rewrite(13, 998, 490, "成功扣点\n失败释放 · 可重试"),
    ],
  },
  {
    sourceSlide: 16,
    narrativeRole: "role handoff around one customer",
    edits: [
      rewrite(16, 54, 34, "08 / 团队接力"),
      rewrite(16, 54, 72, "量房师、设计师和管理者围绕同一客户接力"),
      rewrite(16, 54, 142, "张女士不需要重复建档；上一岗位交付的成果，直接成为下一岗位的工作起点。"),
      rewrite(16, 54, 680, "家客来 JIAKELAI  ·  团队接力"),
      rewrite(16, 1180, 680, "09"),
      rewrite(16, 110, 436, "接收客户\n完成正式量房"),
      rewrite(16, 110, 529, "交付：客户资料 + 正式户型"),
      rewrite(16, 510, 436, "接收正式户型\n生成并优化方案"),
      rewrite(16, 510, 529, "承接：不重新录入"),
      rewrite(16, 910, 436, "配置成员与权限\n查看阶段与进展"),
      rewrite(16, 910, 529, "保障：角色边界清晰"),
      rewrite(16, 282, 620, "同一客户、同一空间依据、同一方案旅程。"),
    ],
  },
  {
    sourceSlide: 17,
    narrativeRole: "Mini Program and Admin management split",
    edits: [
      rewrite(17, 54, 34, "09 / 两端分工"),
      rewrite(17, 54, 72, "小程序服务现场高频动作，企业后台负责组织与全局"),
      rewrite(17, 54, 142, "两端共享同一企业和客户上下文，但不把复杂管理工作塞进现场操作。"),
      rewrite(17, 54, 680, "家客来 JIAKELAI  ·  两端协作"),
      rewrite(17, 1180, 680, "10"),
      rewrite(17, 96, 259, "小程序 · 高频执行"),
      rewrite(17, 326, 308, "客户与量房"),
      rewrite(17, 326, 342, "录入客户、进入正式量房、查看本人待办。"),
      rewrite(17, 326, 426, "现场跟进"),
      rewrite(17, 326, 460, "查看正式户型、方案进度并继续当前任务。"),
      rewrite(17, 706, 259, "企业后台 · 集中管理"),
      rewrite(17, 752, 318, "组织与权限"),
      rewrite(17, 752, 352, "成员、岗位与访问范围"),
      rewrite(17, 752, 400, "客户与资产"),
      rewrite(17, 752, 434, "客户、正式户型、测量记录与阶段"),
      rewrite(17, 752, 482, "AI 创作与深化"),
      rewrite(17, 752, 516, "方案版本、历史任务和后续深化"),
      rewrite(17, 696, 570, "老板看全局，员工做当下；客户和空间资料不重复建立。"),
    ],
  },
  {
    sourceSlide: 18,
    narrativeRole: "pilot and purchasing checklist",
    edits: [
      rewrite(18, 54, 34, "10 / 试点与采购构成"),
      rewrite(18, 54, 78, "先用一个真实客户闭环验证，再决定扩大使用范围"),
      rewrite(18, 54, 150, "建议以单门店、单小组为最小试点单元；正式报价按账号、AI 点数、可选设备和实施范围确认。"),
      rewrite(18, 144, 244, "试点范围"),
      rewrite(18, 144, 276, "选择一家门店和一组真实客户流程。"),
      rewrite(18, 752, 244, "参与角色"),
      rewrite(18, 752, 276, "业务、量房、设计和管理各明确一名负责人。"),
      rewrite(18, 144, 364, "企业账号"),
      rewrite(18, 144, 396, "开通组织、角色与客户数据访问范围。"),
      rewrite(18, 752, 364, "AI 使用"),
      rewrite(18, 752, 396, "确认可用点数、任务价格和失败释放规则。"),
      rewrite(18, 144, 484, "可选设备"),
      rewrite(18, 144, 516, "需要时配置兼容并授权的蓝牙测距设备。"),
      rewrite(18, 752, 484, "实施支持"),
      rewrite(18, 752, 516, "完成培训、现场演示与试点复盘。"),
      rewrite(18, 54, 680, "家客来 JIAKELAI  ·  试点方案"),
      rewrite(18, 1180, 680, "11"),
    ],
  },
  {
    sourceSlide: 19,
    narrativeRole: "standalone decision and next action",
    edits: [
      rewrite(19, 126, 54, "下一步"),
      rewrite(19, 58, 126, "先走通张女士这一条真实客户流程"),
      rewrite(19, 58, 202, "不先讨论所有功能，先验证客户资料、正式量房、AI 方案和团队接续能否在一家门店顺利运行。"),
      rewrite(19, 24, 372, "确认试点团队"),
      rewrite(19, 222, 372, "准备企业账号"),
      rewrite(19, 420, 372, "选择真实客户"),
      rewrite(19, 618, 372, "完成正式量房"),
      rewrite(19, 816, 372, "生成并沟通方案"),
      rewrite(19, 1014, 372, "复盘是否扩大"),
      rewrite(19, 92, 506, "试点成功标准："),
      rewrite(19, 92, 550, "不重复建档 · 正式户型可被设计直接使用\nAI 结果留在同一客户下 · 管理者看得见阶段与责任人"),
      rewrite(19, 58, 678, "家客来 JIAKELAI  ·  老板销售版  ·  2026.08"),
      rewrite(19, 1180, 678, "12"),
    ],
  },
  {
    sourceSlide: 9,
    narrativeRole: "appendix AI capability categories",
    edits: [
      rewrite(9, 54, 34, "附录 A / 四类 AI 能力"),
      rewrite(9, 54, 72, "常用家装任务已经模板化，设计师不必每次从零写提示词"),
      rewrite(9, 54, 142, "主销售过程只讲客户最容易理解的四类能力；完整模板库按企业需要筛选使用。"),
      rewrite(9, 54, 680, "家客来 JIAKELAI  ·  产品附录"),
      rewrite(9, 1180, 680, "13"),
    ],
  },
  {
    sourceSlide: 12,
    narrativeRole: "appendix prompt-library evidence",
    edits: [
      rewrite(12, 54, 34, "附录 B / 模板库证据"),
      rewrite(12, 54, 72, "模板数量不是卖点，稳定覆盖真实任务才有价值"),
      rewrite(12, 54, 142, "当前启用 960 个模板；以下仅展示现代奶油、法式毛坯装修和户型问题诊断三个数据库示例。"),
      rewrite(12, 54, 680, "家客来 JIAKELAI  ·  产品附录"),
      rewrite(12, 1180, 680, "14"),
      rewrite(12, 994, 250, "当前模板库"),
      rewrite(12, 994, 298, "2026-08-01 发布\n960 个启用模板"),
      rewrite(12, 994, 424, "筛选原则"),
      rewrite(12, 994, 470, "家装优先\n可比较\n客户易理解"),
    ],
  },
  {
    sourceSlide: 18,
    narrativeRole: "appendix operating conditions and boundaries",
    edits: [
      rewrite(18, 54, 34, "附录 C / 使用条件与边界"),
      rewrite(18, 54, 78, "账号、户型、权限与服务准备就绪后，才能顺利运行"),
      rewrite(18, 54, 150, "这些是产品正常运行的前提，也是试点开始前需要共同确认的边界。"),
      rewrite(18, 54, 680, "家客来 JIAKELAI  ·  产品边界"),
      rewrite(18, 1180, 680, "15"),
    ],
  },
];

const outputSlides = slides.map((slide, index) => ({
  outputSlide: index + 1,
  sourceSlide: slide.sourceSlide,
  narrativeRole: slide.narrativeRole,
  reuseMode: "duplicate-slide",
  editTargets: slide.edits,
}));

const used = new Set(slides.map((slide) => slide.sourceSlide));
const omittedSourceSlides = Array.from({ length: 19 }, (_, index) => index + 1)
  .filter((slide) => !used.has(slide))
  .map((sourceSlide) => ({ sourceSlide, reason: "Not required in the condensed owner-sales narrative; capability details are covered by selected appendix patterns." }));

await fs.writeFile(
  "Z:/template-frame-map.json",
  `${JSON.stringify({ outputSlides, omittedSourceSlides }, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({ outputSlides: outputSlides.length, omittedSourceSlides: omittedSourceSlides.map((item) => item.sourceSlide) }));
