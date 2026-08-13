import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const TMP = "C:/Users/Administrator/AppData/Local/Temp/codex-customer-demo-20260812";
const ASSET = path.join(TMP, "assets");
const OUT = path.join(TMP, "final");
const PPTX = path.join(TMP, "jiakelai-customer-demo-optimized-2026-08.pptx");

const W = 1280;
const H = 720;
const FONT = "Microsoft YaHei";
const COLORS = {
  ink: "#10231C",
  dark: "#06372A",
  green: "#0BAF55",
  green2: "#18C667",
  mint: "#EAF8EF",
  mint2: "#D6F2E0",
  paper: "#F7F6F1",
  white: "#FFFFFF",
  gray: "#66756F",
  light: "#EEF1EE",
  orange: "#F5A623",
  blue: "#4F7DF3",
  purple: "#8C63E8",
  red: "#E45A4F",
};

const sourceDeck = "家客来-产品说明书-内容优化版-16比9横版-2026-08.pdf";
const improvementPlan = "家客来-客户演示稿-内容改进计划-2026-08.md";

async function imageBytes(name) {
  const b = await fs.readFile(path.join(ASSET, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

function box(slide, x, y, w, h, fill, radius = 20, lineFill = "#00000000", lineWidth = 0, shadow) {
  const s = slide.shapes.add({
    geometry: "roundRect",
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: "solid", fill: lineFill, width: lineWidth },
    borderRadius: radius,
    ...(shadow ? { shadow } : {}),
  });
  return s;
}

function rect(slide, x, y, w, h, fill) {
  return slide.shapes.add({
    geometry: "rect",
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: "solid", fill: "#00000000", width: 0 },
  });
}

function line(slide, x, y, w, h, color, width = 2) {
  return slide.shapes.add({
    geometry: "line",
    position: { left: x, top: y, width: w, height: h },
    fill: "#00000000",
    line: { style: "solid", fill: color, width },
  });
}

function text(slide, content, x, y, w, h, opts = {}) {
  const s = slide.shapes.add({
    geometry: "textbox",
    position: { left: x, top: y, width: w, height: h },
    fill: "#00000000",
    line: { style: "solid", fill: "#00000000", width: 0 },
  });
  s.text = content;
  s.text.style = {
    fontSize: opts.size ?? 24,
    bold: opts.bold ?? false,
    color: opts.color ?? COLORS.ink,
    typeface: opts.typeface ?? FONT,
    alignment: opts.align ?? "left",
    verticalAlignment: opts.valign ?? "top",
    autoFit: opts.autoFit ?? "shrinkText",
    lineSpacing: opts.lineSpacing ?? 1.06,
    insets: opts.insets ?? { left: 0, right: 0, top: 0, bottom: 0 },
  };
  return s;
}

function circle(slide, x, y, d, fill, lineFill = "#00000000", lineWidth = 0) {
  return slide.shapes.add({
    geometry: "ellipse",
    position: { left: x, top: y, width: d, height: d },
    fill,
    line: { style: "solid", fill: lineFill, width: lineWidth },
  });
}

async function image(slide, name, x, y, w, h, opts = {}) {
  const im = slide.images.add({
    blob: await imageBytes(name),
    contentType: "image/png",
    alt: opts.alt ?? name,
    fit: opts.fit ?? "cover",
    position: { left: x, top: y, width: w, height: h },
    ...(opts.crop ? { crop: opts.crop } : {}),
    ...(opts.rounded === false ? {} : { geometry: "roundRect", borderRadius: opts.radius ?? 18 }),
  });
  return im;
}

function addFooter(slide, n, section = "客户主线") {
  text(slide, `家客来 JIAKELAI  ·  ${section}`, 54, 680, 400, 18, { size: 12, color: "#8AA097" });
  text(slide, String(n).padStart(2, "0"), 1180, 680, 48, 18, { size: 12, color: "#8AA097", align: "right" });
}

function addHeader(slide, eyebrow, title, subtitle, n, section = "客户主线") {
  text(slide, eyebrow.toUpperCase(), 54, 34, 520, 22, { size: 13, bold: true, color: COLORS.green });
  text(slide, title, 54, 72, 1120, 62, { size: 46, bold: true, color: COLORS.ink, lineSpacing: 0.95 });
  if (subtitle) text(slide, subtitle, 54, 142, 1120, 44, { size: 21, color: COLORS.gray, lineSpacing: 1.15 });
  addFooter(slide, n, section);
}

function addNotes(slide, extra = "") {
  slide.speakerNotes.textFrame.setText(
    `[Sources]\n- ${improvementPlan}\n- ${sourceDeck}\n- Current repository module inventories and runtime labels${extra ? `\n- ${extra}` : ""}`,
  );
  slide.speakerNotes.setVisible(true);
}

function label(slide, content, x, y, w, fill, color = COLORS.green) {
  box(slide, x, y, w, 34, fill, 17);
  text(slide, content, x + 12, y + 7, w - 24, 20, { size: 14, bold: true, color, align: "center" });
}

function bullet(slide, titleText, body, x, y, w, accent = COLORS.green) {
  circle(slide, x, y + 5, 11, accent);
  text(slide, titleText, x + 24, y, w - 24, 28, { size: 22, bold: true });
  text(slide, body, x + 24, y + 34, w - 24, 54, { size: 18, color: COLORS.gray, lineSpacing: 1.2 });
}

async function designShot(slide, name, x, y, w, h, caption, accent = COLORS.green, alt = caption) {
  box(slide, x, y, w, h, COLORS.white, 22, "#DDE5E0", 1, "shadow-sm");
  await image(slide, name, x + 7, y + 7, w - 14, h - 14, { fit: "contain", rounded: false, alt });
  label(slide, caption, x + 8, y + h + 10, w - 16, accent === COLORS.green ? COLORS.mint : "#FFF1E0", accent);
}

const deck = Presentation.create({ slideSize: { width: W, height: H } });

// 1 — cover
{
  const s = deck.slides.add();
  s.background.fill = COLORS.dark;
  rect(s, 0, 0, 1280, 720, COLORS.dark);
  await image(s, "p01-img01.png", 690, 135, 520, 410, { fit: "contain", rounded: false, alt: "正式量房通向设计方案的品牌主视觉" });
  await image(s, "p14-img01.png", 58, 48, 48, 48, { fit: "contain", rounded: false, alt: "家客来品牌标志" });
  text(s, "家客来  JIAKELAI", 120, 58, 320, 26, { size: 16, bold: true, color: "#DDF5E7" });
  text(s, "从客户建档到设计方案，\n让家装服务连续推进", 58, 160, 610, 190, { size: 64, bold: true, color: COLORS.white, lineSpacing: 0.96 });
  line(s, 58, 384, 106, 0, COLORS.green2, 5);
  text(s, "家客来连接客户档案、正式量房、AI 设计与团队跟进。", 58, 414, 590, 60, { size: 24, color: "#D5E8DF", lineSpacing: 1.2 });
  label(s, "客户档案  ·  正式户型  ·  设计方案", 58, 520, 430, "#0B4C3A", "#C9F7DA");
  text(s, "客户演示稿  ·  16:9  ·  2026.08", 58, 667, 390, 18, { size: 12, color: "#86A99B" });
  addNotes(s, "Brand visuals extracted from the local source deck");
}

// 2 — what it is
{
  const s = deck.slides.add();
  s.background.fill = COLORS.paper;
  addHeader(s, "01 / 家客来是什么", "一套围绕同一位客户持续工作的协作工具", "量房师、设计师和企业管理者使用同一份客户与空间资料，各自完成职责内的下一步。", 2);
  box(s, 54, 218, 610, 396, COLORS.white, 30, "#E3E8E4", 1, "shadow-sm");
  bullet(s, "谁使用", "家装企业的量房师、设计师和企业管理者。", 88, 254, 520, COLORS.green);
  bullet(s, "管什么", "客户资料、正式户型、设计方案和客户阶段。", 88, 364, 520, COLORS.blue);
  bullet(s, "带来什么", "后一个岗位直接使用前一个岗位的成果，减少重复确认与重新录入。", 88, 474, 520, COLORS.orange);
  await image(s, "p03-img01.png", 720, 212, 500, 408, { fit: "cover", radius: 28, alt: "小 K 连接客户档案与空间测量的品牌场景" });
  addNotes(s, "Brand illustration extracted from source slide 3");
}

// 3 — pain points
{
  const s = deck.slides.add();
  s.background.fill = COLORS.white;
  addHeader(s, "02 / 为什么需要", "问题不在工具少，而在工作成果经常断开", "客户资料、现场尺寸、设计依据和跟进责任一旦分散，团队就会反复确认同一件事。", 3);
  line(s, 122, 252, 0, 290, "#C9D6D0", 4);
  const items = [
    ["01", "客户资料散落", "个人微信、纸张和表格彼此分离，团队无法共享完整上下文。", COLORS.green],
    ["02", "现场尺寸反复录入", "手抄、拍照、转述后再录入，正式空间依据难以延续。", COLORS.blue],
    ["03", "设计接手仍要重问", "客户需求与户型信息没有连起来，设计师只能重新确认。", COLORS.orange],
    ["04", "管理者看不见下一步", "客户卡在哪一步、由谁接手、产出了什么都不够清晰。", COLORS.purple],
  ];
  items.forEach((it, i) => {
    const y = 224 + i * 92;
    circle(s, 98, y + 10, 50, it[3]);
    text(s, it[0], 98, y + 24, 50, 20, { size: 15, bold: true, color: COLORS.white, align: "center", valign: "middle" });
    text(s, it[1], 180, y, 330, 34, { size: 24, bold: true });
    text(s, it[2], 520, y + 2, 650, 52, { size: 20, color: COLORS.gray, lineSpacing: 1.15 });
  });
  box(s, 180, 602, 1000, 50, COLORS.mint, 18);
  text(s, "家客来把断开的工作接起来：每一步都留下可继续使用的成果。", 206, 615, 948, 24, { size: 20, bold: true, color: COLORS.green });
  addNotes(s);
}

// 4 — end-to-end customer path
{
  const s = deck.slides.add();
  s.background.fill = COLORS.paper;
  addHeader(s, "03 / 单一客户主线", "张女士的装修需求，沿一条路径持续推进", "这条路径是整套演示的导航：每一步同时明确负责人和产生的成果。", 4);
  const xs = [70, 270, 470, 670, 870, 1070];
  line(s, 104, 306, 1000, 0, "#B9DCCA", 8);
  const steps = [
    ["建立客户档案", "业务人员", "客户资料", COLORS.green],
    ["正式量房", "量房师", "测量墙图", COLORS.green],
    ["保存正式户型", "量房师", "空间资产", COLORS.blue],
    ["发起 AI 设计", "设计师", "设计任务", COLORS.orange],
    ["沟通与优化", "设计师", "概念方案", COLORS.orange],
    ["更新客户阶段", "团队", "跟进记录", COLORS.purple],
  ];
  steps.forEach((st, i) => {
    circle(s, xs[i], 280, 68, st[3]);
    text(s, String(i + 1), xs[i], 297, 68, 28, { size: 22, bold: true, color: COLORS.white, align: "center", valign: "middle" });
    text(s, st[0], xs[i] - 50, 372, 168, 50, { size: 20, bold: true, align: "center" });
    label(s, st[1], xs[i] - 32, 434, 132, COLORS.white, COLORS.gray);
    text(s, st[2], xs[i] - 32, 486, 132, 26, { size: 17, color: st[3], bold: true, align: "center" });
  });
  box(s, 70, 570, 1138, 58, COLORS.dark, 20);
  text(s, "客户档案是入口  ·  正式户型是空间依据  ·  设计方案是沟通成果", 96, 587, 1086, 28, { size: 23, bold: true, color: COLORS.white, align: "center" });
  addNotes(s);
}

// 5 — customer dossier
{
  const s = deck.slides.add();
  s.background.fill = COLORS.white;
  addHeader(s, "04 / 客户档案", "一条客户线索，就是后续服务的入口", "先把“为谁做、房子在哪里、现在进行到哪一步”说清楚，再进入量房与设计。", 5, "客户档案");
  await image(s, "p09-img03.png", 60, 212, 286, 428, { fit: "cover", crop: { left: 0, top: 0, right: 0, bottom: 0.02 }, radius: 26, alt: "家客来小程序客户与户型首页" });
  await image(s, "p09-img02.png", 370, 240, 255, 382, { fit: "cover", crop: { left: 0, top: 0, right: 0, bottom: 0.02 }, radius: 24, alt: "客户线索列表与阶段筛选" });
  box(s, 690, 222, 500, 392, COLORS.paper, 28);
  bullet(s, "建立完整档案", "记录称呼、电话、小区、面积和偏好。", 728, 258, 414, COLORS.green);
  bullet(s, "关联核心成果", "同一客户下查看正式户型、设计方案和更新时间。", 728, 370, 414, COLORS.blue);
  bullet(s, "找到下一步", "通过搜索与客户阶段筛选，定位需要继续处理的客户。", 728, 482, 414, COLORS.orange);
  addNotes(s, "Product screenshots extracted from source slide 9");
}

// 6 — surveying
{
  const s = deck.slides.add();
  s.background.fill = COLORS.paper;
  addHeader(s, "05 / 正式量房", "现场量房的成果，是一份可继续使用的正式户型", "设备只是输入方式；真正重要的是墙体、门窗、尺寸与闭合空间被保存到客户档案。", 6, "正式量房");
  await image(s, "p10-img02.png", 54, 210, 398, 430, { fit: "cover", crop: { left: 0, top: 0.02, right: 0, bottom: 0.18 }, radius: 28, alt: "正式量房编辑器手工输入墙体尺寸" });
  await image(s, "p10-img01.png", 478, 240, 250, 372, { fit: "cover", crop: { left: 0, top: 0.02, right: 0, bottom: 0.14 }, radius: 24, alt: "正式量房墙体绘制过程" });
  await image(s, "p10-img03.png", 754, 240, 250, 372, { fit: "cover", crop: { left: 0, top: 0.02, right: 0, bottom: 0.14 }, radius: 24, alt: "正式量房闭合空间成果" });
  box(s, 1026, 244, 194, 362, COLORS.dark, 24);
  text(s, "两种输入", 1052, 276, 144, 30, { size: 20, bold: true, color: COLORS.white, align: "center" });
  label(s, "手工录入", 1048, 334, 150, "#0C5B42", "#D4F8E1");
  label(s, "授权蓝牙", 1048, 382, 150, "#0C5B42", "#D4F8E1");
  line(s, 1052, 448, 142, 0, "#377A62", 2);
  text(s, "统一结果", 1052, 474, 144, 26, { size: 18, color: "#9EDCB9", align: "center" });
  text(s, "毫米制墙图\n门窗与闭合空间\n可继续量房", 1044, 518, 160, 76, { size: 17, bold: true, color: COLORS.white, align: "center", lineSpacing: 1.35 });
  addNotes(s, "Formal surveying screenshots extracted from source slide 10");
}

// 7 — formal plan reuse
{
  const s = deck.slides.add();
  s.background.fill = COLORS.white;
  addHeader(s, "06 / 正式户型复用", "同一份正式户型，继续服务多个后续场景", "查看、导出、2D/3D 与 AI 都从正式墙图派生，不再维护容易偏离的户型副本。", 7, "正式户型");
  box(s, 54, 220, 450, 394, COLORS.paper, 30);
  await image(s, "p04-img01.png", 94, 258, 370, 286, { fit: "contain", radius: 24, alt: "正式户型示意图" });
  label(s, "正式户型 = 统一空间依据", 116, 558, 326, COLORS.mint, COLORS.green);
  const uses = [
    ["客户详情", "查看量房状态、闭合空间数与更新时间", COLORS.green],
    ["管理后台", "集中查看正式户型与测量记录", COLORS.blue],
    ["2D / 3D / DXF", "完整且受支持时用于查看与下载", COLORS.orange],
    ["AI 设计", "从同一份正式户型派生整屋或单空间依据", COLORS.purple],
  ];
  uses.forEach((u, i) => {
    const y = 225 + i * 94;
    circle(s, 560, y + 4, 46, u[2]);
    text(s, String(i + 1), 560, y + 16, 46, 20, { size: 16, bold: true, color: COLORS.white, align: "center" });
    text(s, u[0], 630, y, 230, 30, { size: 23, bold: true });
    text(s, u[1], 630, y + 38, 520, 44, { size: 18, color: COLORS.gray, lineSpacing: 1.15 });
  });
  addNotes(s, "Formal floor-plan illustration extracted from source slide 4");
}

// 8 — AI overview
{
  const s = deck.slides.add();
  s.background.fill = COLORS.paper;
  addHeader(s, "07 / AI 设计总览", "AI 设计围绕同一位客户和同一份空间资料持续推进", "从项目工作台进入空间设计，客户、正式户型和方案阶段始终关联。", 8, "AI 能力");
  await designShot(s, "ai-project-switcher-v3.png", 68, 202, 330, 384, "选择客户项目", COLORS.green, "完整客户项目选择设计稿");
  await designShot(s, "ai-workbench-home-v2.png", 474, 202, 330, 384, "查看方案旅程", COLORS.orange, "完整 AI 工作台设计稿");
  await designShot(s, "ai-immersive-a-v1.png", 880, 202, 330, 384, "继续当前设计", COLORS.green, "完整沉浸式设计工作台设计稿");
  addNotes(s, "Full approved design comps: ai-design-customer-project-switcher-v3.png; ai-design-customer-workbench-home-v2.png; ai-design-immersive-a-space-tour-v1.png; docs/ai-design/miniprogram-ai-design-requirements.zh-CN.md");
}

// 9 — four AI tasks
{
  const s = deck.slides.add();
  s.background.fill = COLORS.white;
  addHeader(s, "08 / 四类 AI 任务", "四种 AI 任务，解决四种客户沟通问题", "两张完整设计稿展示任务入口与空间导航；右侧说明每类任务解决什么问题。", 9, "AI 能力");
  await designShot(s, "ai-home-v3.png", 58, 205, 270, 382, "任务入口", COLORS.green, "完整 AI 设计首页设计稿");
  await designShot(s, "ai-immersive-c-v1.png", 358, 205, 270, 382, "整屋与房间", COLORS.orange, "完整户型空间导航设计稿");
  const tasks = [
    ["参考图复刻", "把参考图的风格语言应用到当前空间，优先遵守空间结构。", COLORS.green],
    ["空间换风格", "尽量保留结构与镜头，调整材质、家具和整体氛围。", COLORS.orange],
    ["户型生成", "基于正式户型的整屋或单空间数据形成概念效果。", COLORS.blue],
    ["软装深化", "保留硬装与固定结构，优化家具、窗帘、灯具和装饰。", COLORS.purple],
  ];
  tasks.forEach((t, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 666 + col * 278;
    const y = 205 + row * 204;
    box(s, x, y, 254, 184, row === 0 ? COLORS.paper : "#F4F6F4", 24, "#E0E6E2", 1);
    circle(s, x + 24, y + 24, 42, t[2]);
    text(s, String(i + 1), x + 24, y + 36, 42, 18, { size: 15, bold: true, color: COLORS.white, align: "center" });
    text(s, t[0], x + 80, y + 25, 150, 30, { size: 21, bold: true });
    text(s, t[1], x + 24, y + 82, 208, 74, { size: 16, color: COLORS.gray, lineSpacing: 1.25 });
  });
  addNotes(s, "Full approved design comps: all-pages-ip-v3/04-ai-design-home-v3.png; ai-design-immersive-c-floor-map-v1.png; task definitions verified against current Mini Program AI requirements and code labels");
}

// 10 — formal plan as AI basis
{
  const s = deck.slides.add();
  s.background.fill = COLORS.paper;
  addHeader(s, "09 / 设计依据", "先确认设计对象，再选择整屋或单空间", "正式户型提供墙体、尺寸、层高与门窗依据；完整设计稿展示客户项目、空间范围和房间选择。", 10, "AI 能力");
  await designShot(s, "ai-project-switcher-v3.png", 58, 205, 274, 382, "客户与正式户型", COLORS.green, "完整客户项目选择设计稿");
  await designShot(s, "ai-immersive-c-v1.png", 360, 205, 274, 382, "整屋与单空间", COLORS.orange, "完整空间范围选择设计稿");
  await designShot(s, "ai-workbench-empty-v2.png", 662, 205, 274, 382, "资料未齐时提示", COLORS.blue, "完整 AI 工作台待完善设计稿");
  box(s, 966, 220, 252, 342, COLORS.dark, 24);
  text(s, "户型生成", 994, 250, 196, 30, { size: 23, bold: true, color: COLORS.white });
  text(s, "必须关联有效正式户型，再选择整屋或目标房间。", 994, 298, 196, 76, { size: 17, color: "#C8DDD4", lineSpacing: 1.3 });
  line(s, 994, 396, 196, 0, "#2D6B56", 2);
  text(s, "其他三类任务", 994, 424, 196, 30, { size: 21, bold: true, color: "#A9D8FF" });
  text(s, "可按实际素材独立使用；已选客户与空间时继续继承上下文。", 994, 470, 196, 70, { size: 16, color: "#C8DDD4", lineSpacing: 1.28 });
  addNotes(s, "Full approved design comps: ai-design-customer-project-switcher-v3.png; ai-design-immersive-c-floor-map-v1.png; ai-design-customer-workbench-empty-v2.png; formal plan eligibility verified against current AI requirements");
}

// 11 — controlled task creation
{
  const s = deck.slides.add();
  s.background.fill = COLORS.white;
  addHeader(s, "10 / 创建任务", "从准备素材到生成方案，每一步都有明确提示", "完整页面展示素材、风格与范围；不同任务状态则集中在项目列表中持续反馈。", 11, "AI 能力");
  await designShot(s, "ai-create-v3.png", 58, 205, 330, 382, "准备素材与风格", COLORS.green, "完整 AI 任务创建设计稿");
  await designShot(s, "ai-project-state-matrix-v4.png", 430, 205, 500, 382, "生成进度与异常处理", COLORS.orange, "完整 AI 项目状态矩阵设计稿");
  box(s, 970, 220, 244, 342, COLORS.dark, 24);
  text(s, "提交前", 998, 248, 188, 26, { size: 21, bold: true, color: COLORS.white });
  text(s, "任务类型\n所需图片\n目标风格\n设计范围\n点数预估", 998, 294, 188, 150, { size: 18, color: "#C9DFD6", lineSpacing: 1.55 });
  line(s, 998, 466, 188, 0, "#2D6B56", 2);
  text(s, "成功扣点\n失败释放 · 允许重试", 998, 490, 188, 58, { size: 17, bold: true, color: "#F3C27E", lineSpacing: 1.35 });
  addNotes(s, "Full approved design comps: all-pages-ip-v3/14-ai-design-create-v3.png; ai-design-project-state-matrix-v4.png; credit behavior verified against current AI requirements");
}

// 12 — outcomes and continued refinement
{
  const s = deck.slides.add();
  s.background.fill = COLORS.paper;
  addHeader(s, "11 / 成果与深化", "成果可以比较、分享，并沿同一客户方案继续深化", "三张完整设计稿展示结果对比、历史记录与方案推荐；小程序完成沟通，后台继续管理版本与下一步。", 12, "AI 能力");
  await designShot(s, "ai-result-v2.png", 58, 205, 288, 382, "查看前后效果", COLORS.green, "完整 AI 结果对比设计稿");
  await designShot(s, "ai-history-v3.png", 374, 205, 288, 382, "管理历史任务", COLORS.orange, "完整 AI 历史记录设计稿");
  await designShot(s, "ai-recommendations-v3.png", 690, 205, 288, 382, "比较推荐方案", COLORS.green, "完整装修方案推荐设计稿");
  box(s, 1006, 220, 208, 342, COLORS.dark, 24);
  text(s, "小程序", 1032, 248, 156, 26, { size: 21, bold: true, color: "#9CF0BC" });
  text(s, "预览与比较\n保存与分享\n继续优化\n查看历史", 1032, 292, 156, 112, { size: 17, color: COLORS.white, lineSpacing: 1.5 });
  line(s, 1032, 426, 156, 0, "#2D6B56", 2);
  text(s, "企业后台", 1032, 450, 156, 26, { size: 20, bold: true, color: "#A9D8FF" });
  text(s, "管理定稿与候选\n推荐下一步\n继续提案与灯光深化", 1032, 490, 156, 66, { size: 15, color: "#C8DDD4", lineSpacing: 1.35 });
  text(s, "概念方案，不是施工图", 998, 606, 224, 22, { size: 15, bold: true, color: "#B76822", align: "center" });
  addNotes(s, "Full approved design comps: ai-design-result-v2.png; all-pages-ip-v3/16-ai-design-history-v3.png; all-pages-ip-v3/17-recommendations-v3.png; backend continuation verified against current AI requirements and admin module inventory");
}

// 13 — enterprise AI studio
{
  const s = deck.slides.add();
  s.background.fill = COLORS.white;
  addHeader(s, "12 / 企业后台 AI 工作台", "AI 工作台把参考图整理成可继续创作的方案资产", "上传空间图或参考图后，AI 协助提取色彩、材质、家具与灯具语言，形成情绪板并继续生成空间效果。", 13, "AI 能力");
  box(s, 54, 210, 690, 316, "#171820", 24, "#353742", 1, "shadow-sm");
  await image(s, "user-ai-studio-workbench.png", 64, 220, 670, 296, { fit: "contain", rounded: false, alt: "用户提供的企业后台 AI 创作工作台截图" });
  label(s, "企业后台 · 上传参考图、编辑提示、再次生成与历史记录", 72, 542, 654, COLORS.mint, COLORS.green);

  box(s, 776, 210, 208, 208, COLORS.paper, 22, "#E0E6E2", 1);
  await image(s, "user-ai-moodboard.png", 784, 218, 192, 192, { fit: "contain", rounded: false, alt: "用户提供的现代自然风格情绪板" });
  box(s, 1004, 210, 222, 208, COLORS.paper, 22, "#E0E6E2", 1);
  await image(s, "user-ai-render-result.png", 1012, 218, 206, 192, { fit: "contain", rounded: false, alt: "用户提供的现代自然客厅空间效果图" });
  label(s, "风格情绪板", 784, 430, 192, COLORS.mint, COLORS.green);
  label(s, "空间效果图", 1012, 430, 206, "#FFF1E0", COLORS.orange);

  box(s, 776, 486, 450, 120, COLORS.dark, 24);
  text(s, "参考图", 800, 514, 76, 24, { size: 18, bold: true, color: COLORS.white, align: "center" });
  text(s, "→", 874, 514, 28, 24, { size: 18, bold: true, color: "#82E2A9", align: "center" });
  text(s, "提取设计语言", 904, 514, 126, 24, { size: 18, bold: true, color: COLORS.white, align: "center" });
  text(s, "→", 1030, 514, 28, 24, { size: 18, bold: true, color: "#82E2A9", align: "center" });
  text(s, "生成方案", 1060, 514, 102, 24, { size: 18, bold: true, color: COLORS.white, align: "center" });
  text(s, "从视觉参考中提取色彩、材质、纹理、家具与灯具线索，先形成可沟通的情绪板，再生成空间效果并持续迭代。", 800, 558, 402, 40, { size: 15, color: "#C8DDD4", align: "center", lineSpacing: 1.25 });
  addNotes(s, "User-provided references: codex-clipboard-28a3ca0b-9ad8-4156-8e98-ac50c896980b.png; codex-clipboard-1813148f-57d1-43e9-9d83-84beafc30de6.png; codex-clipboard-ae627997-305c-437b-b00d-5161e199391d.png");
}

// 14 — roles and handoff
{
  const s = deck.slides.add();
  s.background.fill = COLORS.white;
  addHeader(s, "13 / 团队接续", "三个角色围绕同一客户接力，不重复建档", "AI 成果回到客户方案后，量房师、设计师和企业管理者都能在各自职责内继续推进。", 14, "团队跟进");
  line(s, 250, 342, 760, 0, "#CBE3D7", 6);
  const roles = [
    ["量房师", "建立或接收客户\n完成正式量房", "交付：客户资料 + 正式户型", COLORS.green],
    ["设计师", "接收客户与空间\n生成并优化方案", "承接：不重新建档", COLORS.orange],
    ["企业管理者", "管理成员与权限\n查看进展与配置", "保障：角色能完成工作", COLORS.blue],
  ];
  roles.forEach((r, i) => {
    const x = 70 + i * 400;
    box(s, x, 238, 340, 346, COLORS.paper, 28, "#E1E8E3", 1);
    circle(s, x + 126, 270, 88, r[3]);
    text(s, String.fromCharCode(65 + i), x + 126, 294, 88, 28, { size: 26, bold: true, color: COLORS.white, align: "center" });
    text(s, r[0], x + 40, 376, 260, 40, { size: 27, bold: true, align: "center" });
    text(s, r[1], x + 40, 436, 260, 64, { size: 19, color: COLORS.gray, align: "center", lineSpacing: 1.3 });
    label(s, r[2], x + 28, 522, 284, COLORS.white, r[3]);
  });
  box(s, 264, 608, 752, 44, COLORS.mint, 16);
  text(s, "获客确认与提成独立记录，不改变客户处于量房或设计的业务阶段。", 282, 620, 716, 22, { size: 17, bold: true, color: COLORS.green, align: "center" });
  addNotes(s, "Role and acquisition boundaries verified against measurer–designer acquisition contract");
}

// 15 — mini program vs admin
{
  const s = deck.slides.add();
  s.background.fill = COLORS.paper;
  addHeader(s, "14 / 两端分工", "小程序跑现场，企业后台管组织与全局", "两端共享同一企业与客户上下文，但分别服务高频执行和集中管理。", 15, "两端协作");
  box(s, 54, 222, 565, 394, COLORS.white, 30, "#E0E7E2", 1, "shadow-sm");
  label(s, "小程序 · 高频执行", 84, 252, 210, COLORS.mint, COLORS.green);
  await image(s, "p09-img03.png", 86, 302, 184, 276, { fit: "cover", crop: { left: 0, top: 0.02, right: 0, bottom: 0.02 }, radius: 20, alt: "小程序高频工作首页" });
  bullet(s, "客户与量房", "录入客户、进入正式量房、查看个人待办。", 302, 308, 274, COLORS.green);
  bullet(s, "现场跟进", "查看客户、正式户型、待办与方案进展。", 302, 426, 274, COLORS.orange);
  box(s, 661, 222, 565, 394, COLORS.dark, 30);
  label(s, "企业后台 · 集中管理", 694, 252, 228, "#0B5941", "#CFF6DE");
  const adminItems = [
    ["组织与权限", "成员、岗位与访问范围"],
    ["客户与户型", "正式户型、测量记录与进展"],
    ["AI 创作与深化", "情绪板、方案版本与后续深化管理"],
  ];
  adminItems.forEach((a, i) => {
    const y = 318 + i * 82;
    circle(s, 696, y + 4, 36, i === 0 ? COLORS.green2 : i === 1 ? COLORS.blue : COLORS.orange);
    text(s, String(i + 1), 696, y + 13, 36, 18, { size: 14, bold: true, color: COLORS.white, align: "center" });
    text(s, a[0], 752, y, 200, 26, { size: 21, bold: true, color: COLORS.white });
    text(s, a[1], 752, y + 34, 390, 32, { size: 17, color: "#BFD9CF" });
  });
  text(s, "不重复建档，只保留客户企业内部的组织、资产与服务配置。", 696, 570, 470, 32, { size: 16, bold: true, color: "#9BE0B8" });
  addNotes(s, "Mini Program screenshot extracted from source slide 9; admin responsibilities verified against current module inventory");
}

// 16 — boundaries
{
  const s = deck.slides.add();
  s.background.fill = COLORS.dark;
  text(s, "15 / 使用条件与产品边界", 54, 34, 520, 22, { size: 13, bold: true, color: "#6EE39E" });
  text(s, "顺利完成量房与设计，需要先具备这些条件", 54, 78, 1130, 60, { size: 46, bold: true, color: COLORS.white });
  text(s, "账号、户型、权限和服务配置准备就绪后，团队即可沿客户流程继续推进。", 54, 150, 1120, 38, { size: 21, color: "#BFD7CE" });
  const boundaries = [
    ["账号与服务", "企业账号可正常使用，网络和服务连接有效。", COLORS.green2],
    ["蓝牙测距（可选）", "使用兼容且已分配授权的设备；也可手工录入。", COLORS.blue],
    ["户型数据", "墙体有效并形成闭合空间，方可进入对应设计流程。", COLORS.orange],
    ["AI 设计", "企业已开通权限，并具备可用点数和有效服务配置。", COLORS.purple],
    ["方案用途", "用于概念表达、方案比较和客户沟通，不作为施工图。", COLORS.red],
    ["数据访问", "员工按企业角色和本人权限访问客户与户型数据。", COLORS.green2],
  ];
  boundaries.forEach((b, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 56 + col * 608;
    const y = 226 + row * 120;
    box(s, x, y, 560, 92, i % 2 === 0 ? "#0A4937" : "#0B4032", 24, "#23624E", 1);
    circle(s, x + 24, y + 24, 44, b[2]);
    text(s, String(i + 1), x + 24, y + 37, 44, 18, { size: 15, bold: true, color: COLORS.white, align: "center" });
    text(s, b[0], x + 88, y + 18, 172, 26, { size: 21, bold: true, color: COLORS.white });
    text(s, b[1], x + 88, y + 50, 438, 28, { size: 16, color: "#C6DDD4" });
  });
  text(s, "家客来 JIAKELAI  ·  产品边界", 54, 680, 420, 18, { size: 12, color: "#789D8F" });
  text(s, "16", 1180, 680, 48, 18, { size: 12, color: "#789D8F", align: "right" });
  addNotes(s, "Capability boundaries verified against current Mini Program, admin, formal surveying, and AI module documentation");
}

// 17 — demo and close
{
  const s = deck.slides.add();
  s.background.fill = COLORS.paper;
  await image(s, "p14-img01.png", 58, 42, 52, 52, { fit: "contain", rounded: false, alt: "家客来品牌标志" });
  text(s, "现场演示", 126, 54, 220, 28, { size: 18, bold: true, color: COLORS.green });
  text(s, "接下来，用一位客户走完整流程", 58, 126, 850, 60, { size: 48, bold: true, color: COLORS.ink });
  text(s, "从建档、量房到 AI 设计和团队接续，所有步骤围绕同一份客户资料推进。", 58, 202, 1080, 36, { size: 21, color: COLORS.gray });
  const demoSteps = [
    "创建客户档案",
    "进入正式量房",
    "保存正式户型",
    "发起 AI 设计",
    "查看方案成果",
    "查看团队接续",
  ];
  line(s, 104, 310, 1028, 0, "#C0DDCD", 7);
  demoSteps.forEach((d, i) => {
    const x = 70 + i * 198;
    circle(s, x, 278, 66, i < 3 ? COLORS.green : i < 5 ? COLORS.orange : COLORS.blue);
    text(s, String(i + 1), x, 296, 66, 24, { size: 20, bold: true, color: COLORS.white, align: "center" });
    text(s, d, x - 46, 372, 158, 52, { size: 19, bold: true, align: "center" });
  });
  box(s, 58, 474, 1164, 150, COLORS.dark, 30);
  text(s, "您将看到：", 92, 506, 620, 40, { size: 28, bold: true, color: "#B7F3CD" });
  text(s, "客户资料如何沉淀为正式户型，\n并继续生成可沟通、可优化的设计方案。", 92, 550, 1030, 64, { size: 26, bold: true, color: COLORS.white, lineSpacing: 1.18 });
  text(s, "家客来 JIAKELAI  ·  客户演示稿  ·  2026.08", 58, 678, 520, 18, { size: 12, color: "#8AA097" });
  text(s, "17", 1180, 678, 48, 18, { size: 12, color: "#8AA097", align: "right" });
  addNotes(s);
}

await fs.mkdir(OUT, { recursive: true });
for (const [i, slide] of deck.slides.items.entries()) {
  const stem = `slide-${String(i + 1).padStart(2, "0")}`;
  const png = await deck.export({ slide, format: "png", scale: 1.4 });
  await fs.writeFile(path.join(OUT, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(OUT, `${stem}.layout.json`), await layout.text(), "utf8");
}
const montage = await deck.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile(path.join(OUT, "montage.webp"), new Uint8Array(await montage.arrayBuffer()));
const pptx = await PresentationFile.exportPptx(deck);
await pptx.save(PPTX);
console.log(PPTX);
