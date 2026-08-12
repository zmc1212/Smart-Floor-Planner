import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const root = "G:/workspace/向总/Smart-Floor-Planner";
const output = `${root}/customer-materials/家客来-设计师主线文案确认版.pptx`;
const qa = `${root}/tmp/designer-led-copy-deck-019ff447/qa`;

const palette = {
  ink: "#123D31",
  green: "#12A75A",
  mint: "#DDF5E6",
  light: "#F5FAF7",
  line: "#CFE4D7",
  muted: "#5B756A",
  warm: "#FCFCF8",
};

async function writeBlob(path, blob) {
  await fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}

const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });

function addShape(slide, geometry, left, top, width, height, fill, line = { style: "solid", fill: "none", width: 0 }, extra = {}) {
  return slide.shapes.add({ geometry, position: { left, top, width, height }, fill, line, ...extra });
}

function addText(slide, value, left, top, width, height, style = {}, name) {
  const box = addShape(slide, "textbox", left, top, width, height, "none", { style: "solid", fill: "none", width: 0 }, name ? { name } : {});
  box.text = value;
  box.text.style = { color: palette.ink, fontSize: 18, ...style };
  return box;
}

function addChrome(slide, section, number) {
  slide.background.fill = palette.warm;
  addShape(slide, "rect", 0, 0, 18, 720, palette.green);
  addText(slide, "家客来", 64, 42, 120, 24, { fontSize: 16, bold: true, color: palette.green });
  addText(slide, section, 184, 43, 340, 21, { fontSize: 14, bold: true, color: palette.muted });
  addText(slide, String(number).padStart(2, "0"), 1144, 43, 70, 21, { fontSize: 14, bold: true, color: palette.muted, alignment: "right" });
  addShape(slide, "line", 64, 81, 1152, 0, "none", { style: "solid", fill: palette.line, width: 1 });
}

function title(slide, value, sub) {
  addText(slide, value, 64, 121, 1080, 58, { fontSize: 35, bold: true, color: palette.ink }, "slide-title");
  if (sub) addText(slide, sub, 67, 193, 1010, 30, { fontSize: 18, color: palette.muted });
}

function note(slide, value) {
  addShape(slide, "roundRect", 64, 618, 1152, 48, palette.ink, { style: "solid", fill: "none", width: 0 }, { borderRadius: "rounded-xl" });
  addText(slide, value, 88, 632, 1100, 21, { fontSize: 16, bold: true, color: "#FFFFFF", alignment: "center" });
}

function bullet(slide, index, lead, copy, y) {
  addShape(slide, "ellipse", 78, y + 7, 20, 20, palette.green);
  addText(slide, String(index), 78, y + 10, 20, 12, { fontSize: 10, bold: true, color: "#FFFFFF", alignment: "center" });
  addText(slide, lead, 124, y, 295, 25, { fontSize: 20, bold: true, color: palette.ink });
  addText(slide, copy, 124, y + 33, 790, 28, { fontSize: 17, color: palette.muted });
}

function roleBlock(slide, label, copy, left, top, width, tone) {
  addShape(slide, "roundRect", left, top, width, 110, "#FFFFFF", { style: "solid", fill: palette.line, width: 1 }, { borderRadius: "rounded-xl" });
  addShape(slide, "roundRect", left + 22, top + 20, 92, 27, tone, { style: "solid", fill: "none", width: 0 }, { borderRadius: "rounded-full" });
  addText(slide, label, left + 22, top + 26, 92, 16, { fontSize: 13, bold: true, color: "#FFFFFF", alignment: "center" });
  addText(slide, copy, left + 22, top + 61, width - 44, 31, { fontSize: 17, bold: true, color: palette.ink, alignment: "center" });
}

// 1. Design is the client-facing core.
{
  const slide = deck.slides.add();
  addChrome(slide, "设计师主线", 1);
  addText(slide, "设计师，是客户体验与成交推进的关键角色", 64, 172, 820, 112, { fontSize: 48, bold: true, color: palette.ink }, "slide-title");
  addText(slide, "客户是否被接住、需求是否被理解、方案是否能讲清，\n最终都由设计师把服务往前推进。", 68, 316, 700, 66, { fontSize: 23, color: palette.muted });
  addShape(slide, "roundRect", 828, 163, 324, 308, palette.mint, { style: "solid", fill: palette.line, width: 1 }, { borderRadius: "rounded-xl" });
  addText(slide, "设计师的工作不是\n“出一张效果图”", 865, 206, 250, 68, { fontSize: 24, bold: true, color: palette.ink, alignment: "center" });
  addShape(slide, "line", 896, 300, 186, 0, "none", { style: "solid", fill: palette.green, width: 3 });
  addText(slide, "而是接住客户、\n理解空间、推进沟通。", 865, 329, 250, 65, { fontSize: 21, bold: true, color: palette.green, alignment: "center" });
  note(slide, "先把设计师的客户服务过程跑顺，企业才有可复制的服务能力。");
}

// 2. Multiple entries, one designer-led record.
{
  const slide = deck.slides.add();
  addChrome(slide, "客户入口", 2);
  title(slide, "客户可以从不同入口进来，但应由设计师统一推进", "客户来源不同，客户记录只有一条；设计师接手后，服务才进入同一条主线。");
  const sources = [
    ["销售", "带来线索", 64],
    ["测量员", "完成空间信息", 348],
    ["设计师", "直接接待客户", 632],
  ];
  for (const [label, copy, x] of sources) {
    addShape(slide, "roundRect", x, 290, 216, 110, "#FFFFFF", { style: "solid", fill: palette.line, width: 1 }, { borderRadius: "rounded-xl" });
    addText(slide, label, x, 315, 216, 26, { fontSize: 23, bold: true, color: palette.ink, alignment: "center" });
    addText(slide, copy, x, 354, 216, 20, { fontSize: 15, color: palette.muted, alignment: "center" });
    addShape(slide, "line", x + 216, 345, 42, 0, "none", { style: "solid", fill: palette.green, width: 2 }, { head: { type: "arrow", width: "sm", length: "sm" } });
  }
  addShape(slide, "roundRect", 916, 276, 300, 138, palette.ink, { style: "solid", fill: "none", width: 0 }, { borderRadius: "rounded-xl" });
  addText(slide, "设计师统一推进", 946, 306, 240, 27, { fontSize: 23, bold: true, color: "#FFFFFF", alignment: "center" });
  addText(slide, "同一客户记录\n同一套服务动作", 946, 346, 240, 44, { fontSize: 17, color: "#CBEEDA", alignment: "center" });
  addText(slide, "重点不是谁先录入，而是客户不因人员和入口不同而断在半路。", 64, 486, 1050, 28, { fontSize: 21, bold: true, color: palette.ink });
  note(slide, "客户来源可以分散，设计服务的主线必须统一。");
}

// 3. Reliable space base.
{
  const slide = deck.slides.add();
  addChrome(slide, "正式量房", 3);
  title(slide, "设计师最需要的，是一份可信的空间底图", "不管谁来量房，后续设计都应基于同一份正式户型，而不是再次口头确认。");
  roleBlock(slide, "设计师量房", "从客户到方案一体推进", 64, 300, 340, palette.green);
  roleBlock(slide, "测量员量房", "设计师接收正式户型后继续服务", 470, 300, 340, "#238557");
  roleBlock(slide, "销售获客", "设计师接手需求与设计服务", 876, 300, 340, "#366A57");
  addText(slide, "正式户型记录墙体、尺寸、门窗与空间信息，为后续方案沟通建立共同依据。", 64, 468, 1040, 31, { fontSize: 20, color: palette.muted });
  note(slide, "谁量房都可以；设计师始终对客户方案负责。");
}

// 4. AI as expression aid.
{
  const slide = deck.slides.add();
  addChrome(slide, "方案表达", 4);
  title(slide, "有了正式户型，设计师才能更快把需求讲成方案", "AI 是设计师的方案表达助手，用于探索方向、保留结果并继续和客户沟通。");
  bullet(slide, 1, "选择目标", "基于已完成的正式户型，选择整户或单空间。", 276);
  bullet(slide, 2, "形成表达", "围绕空间、风格与软装方向，建立可沟通的方案参考。", 371);
  bullet(slide, 3, "保留过程", "任务历史、状态与重试入口留在同一条设计工作流中。", 466);
  addShape(slide, "roundRect", 892, 266, 284, 258, palette.light, { style: "solid", fill: palette.line, width: 1 }, { borderRadius: "rounded-xl" });
  addText(slide, "正确定位", 922, 303, 224, 26, { fontSize: 22, bold: true, color: palette.green, alignment: "center" });
  addText(slide, "AI 用于方案参考\n与概念表达", 922, 354, 224, 54, { fontSize: 22, bold: true, color: palette.ink, alignment: "center" });
  addText(slide, "不是施工图、\n自动报价或自动成交", 922, 431, 224, 44, { fontSize: 16, color: palette.muted, alignment: "center" });
  note(slide, "让设计师更快进入方案沟通，而不是替代设计师的判断。");
}

// 5. One customer journey.
{
  const slide = deck.slides.add();
  addChrome(slide, "客户旅程", 5);
  title(slide, "一个客户的服务过程，不再靠口头交接", "以“张女士，89㎡两居室”为例：每一步都回到同一位客户的记录中。 ");
  const steps = [
    ["客户进入", "录入需求与基本信息"],
    ["空间确认", "完成正式量房或接收正式户型"],
    ["方案沟通", "设计师基于户型推进表达"],
    ["协作沉淀", "交接、通知与回执留下记录"],
  ];
  for (let i = 0; i < steps.length; i += 1) {
    const x = 64 + i * 286;
    addShape(slide, "ellipse", x, 312, 56, 56, i === 2 ? palette.green : palette.mint, { style: "solid", fill: i === 2 ? palette.green : palette.line, width: 1 });
    addText(slide, String(i + 1).padStart(2, "0"), x, 329, 56, 17, { fontSize: 15, bold: true, color: i === 2 ? "#FFFFFF" : palette.green, alignment: "center" });
    if (i < steps.length - 1) addShape(slide, "line", x + 56, 340, 184, 0, "none", { style: "solid", fill: palette.line, width: 2 }, { head: { type: "arrow", width: "sm", length: "sm" } });
    addText(slide, steps[i][0], x - 12, 392, 150, 25, { fontSize: 19, bold: true, color: palette.ink, alignment: "center" });
    addText(slide, steps[i][1], x - 25, 429, 180, 42, { fontSize: 15, color: palette.muted, alignment: "center" });
  }
  note(slide, "客户不是被“转交”出去，而是在同一条服务记录里持续被推进。");
}

// 6. Enterprise outcome.
{
  const slide = deck.slides.add();
  addChrome(slide, "企业收益", 6);
  addText(slide, "老板买到的不是“监控团队”，\n而是可复制的设计服务能力", 64, 155, 860, 113, { fontSize: 43, bold: true, color: palette.ink }, "slide-title");
  addText(slide, "设计师能专注服务客户；企业保留客户、户型、方案与协作过程。", 67, 290, 820, 29, { fontSize: 20, color: palette.muted });
  const benefits = [
    ["客户可接手", "客户、户型、方案记录留在企业"],
    ["服务可复制", "新人接手时不必从零重新问起"],
    ["过程可看见", "负责人看到进度、分工与关键记录"],
  ];
  for (let i = 0; i < benefits.length; i += 1) {
    const y = 365 + i * 70;
    addShape(slide, "roundRect", 64, y, 1080, 52, i === 0 ? palette.mint : "#FFFFFF", { style: "solid", fill: palette.line, width: 1 }, { borderRadius: "rounded-xl" });
    addText(slide, benefits[i][0], 91, y + 15, 170, 20, { fontSize: 17, bold: true, color: palette.green });
    addText(slide, benefits[i][1], 300, y + 15, 800, 20, { fontSize: 16, color: palette.ink });
  }
  note(slide, "下一步：选一个真实客户，让负责人、设计师和测量员一起跑一遍。");
}

await fs.mkdir(qa, { recursive: true });
for (let index = 0; index < deck.slides.items.length; index += 1) {
  const slide = deck.slides.items[index];
  await writeBlob(`${qa}/slide-${String(index + 1).padStart(2, "0")}.png`, await deck.export({ slide, format: "png", scale: 1.5 }));
  await fs.writeFile(`${qa}/slide-${String(index + 1).padStart(2, "0")}.layout.json`, await (await slide.export({ format: "layout" })).text(), "utf8");
}
await writeBlob(`${qa}/montage.webp`, await deck.export({ format: "webp", montage: true, scale: 1 }));
const pptx = await PresentationFile.exportPptx(deck);
await pptx.save(output);
await fs.writeFile(`${qa}/inspect.ndjson`, (await deck.inspect({ kind: "slide,textbox,shape,notes", maxChars: 30000 })).ndjson, "utf8");
