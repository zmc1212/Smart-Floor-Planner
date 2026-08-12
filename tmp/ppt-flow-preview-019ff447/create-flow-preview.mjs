import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const root = "G:/workspace/向总/Smart-Floor-Planner";
const workspace = `${root}/tmp/ppt-flow-preview-019ff447`;
const output = `${root}/customer-materials/家客来-三角色接力流程图预览`;
const media = `${workspace}/media`;

async function writeBlob(path, blob) {
  await fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}

async function imageBytes(path) {
  const bytes = await fs.readFile(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const slide = deck.slides.add();
slide.background.fill = "#F6F9F7";

function shape(geometry, left, top, width, height, fill, line = { style: "solid", fill: "none", width: 0 }, extra = {}) {
  return slide.shapes.add({
    geometry,
    position: { left, top, width, height },
    fill,
    line,
    ...extra,
  });
}

function text(value, left, top, width, height, style = {}, name) {
  const box = shape("textbox", left, top, width, height, "none", { style: "solid", fill: "none", width: 0 }, name ? { name } : {});
  box.text = value;
  box.text.style = {
    color: "#143C32",
    fontSize: 18,
    ...style,
  };
  return box;
}

async function addImage(path, left, top, width, height, alt) {
  return slide.images.add({
    blob: await imageBytes(path),
    contentType: "image/png",
    alt,
    fit: "cover",
    position: { left, top, width, height },
    geometry: "roundRect",
    borderRadius: "rounded-lg",
  });
}

// Subtle brand texture and header.
shape("ellipse", 1000, 10, 280, 280, "#E5F7EB");
shape("ellipse", 1110, 20, 150, 150, "#D3F1DD");
shape("rect", 0, 0, 1280, 7, "#18A95B");
shape("roundRect", 58, 34, 42, 42, "#FFFFFF", { style: "solid", fill: "#D7E8DD", width: 1 }, { borderRadius: "rounded-lg", shadow: "shadow-sm" });
await addImage(`${media}/image.png`, 63, 39, 32, 32, "家客来 Logo");
text("家客来  /  客户服务协同流程", 114, 43, 400, 28, { fontSize: 15, bold: true, color: "#285846" });
text("一位客户，三角色接力完成服务", 58, 90, 810, 52, { fontSize: 35, bold: true, color: "#163D32" }, "slide-title");
text("从线索到方案交付，客户、空间与过程始终可追溯", 60, 151, 720, 25, { fontSize: 17, color: "#628075" });
shape("roundRect", 971, 101, 244, 44, "#E6F7EC", { style: "solid", fill: "#B8E6C6", width: 1 }, { borderRadius: "rounded-full" });
text("同一客户 · 全程可追溯", 990, 112, 206, 20, { fontSize: 15, bold: true, color: "#16864A", alignment: "center" });

const cards = [
  { x: 58, num: "01", title: "客户建档", role: "测量员", caption: "线索 · 档案 · 跟进", tint: "#F0F8F3", roleFill: "#D9F1E2", roleColor: "#16864A", image: `${media}/image10.png`, alt: "客户线索页面" },
  { x: 294, num: "02", title: "正式量房", role: "测量员", caption: "墙体 · 尺寸 · 门窗", tint: "#F0F8F3", roleFill: "#D9F1E2", roleColor: "#16864A", image: `${media}/image11.png`, alt: "正式量房页面" },
  { x: 530, num: "03", title: "AI 方案", role: "设计师", caption: "正式户型 · 方案方向", tint: "#F0FAF4", roleFill: "#C7F0D7", roleColor: "#098848", image: `${media}/image13.png`, alt: "AI 设计成果页面" },
  { x: 766, num: "04", title: "协作交接", role: "设计师", caption: "确认 · 通知 · 回执", tint: "#F3FAF6", roleFill: "#C7F0D7", roleColor: "#098848" },
  { x: 1002, num: "05", title: "企业管理", role: "负责人", caption: "人 · 数据 · 设备 · 规则", tint: "#EFF6F2", roleFill: "#D6E9DE", roleColor: "#275C48" },
];

// Connectors are created before the cards' content and stay behind each step.
for (let index = 0; index < cards.length - 1; index += 1) {
  const left = cards[index].x + 194;
  shape("line", left, 335, 42, 0, "none", { style: "solid", fill: "#7AC89B", width: 2 }, { tail: { type: "none" }, head: { type: "arrow", width: "sm", length: "sm" } });
}

for (const card of cards) {
  shape("roundRect", card.x, 223, 194, 242, "#FFFFFF", { style: "solid", fill: "#DCEAE2", width: 1 }, { borderRadius: "rounded-xl", shadow: "shadow-sm" });
  shape("roundRect", card.x + 14, 238, 40, 27, card.roleFill, { style: "solid", fill: "none", width: 0 }, { borderRadius: "rounded-full" });
  text(card.num, card.x + 14, 244, 40, 16, { fontSize: 12, bold: true, color: card.roleColor, alignment: "center" });
  text(card.title, card.x + 16, 282, 162, 30, { fontSize: 23, bold: true, color: "#163D32", alignment: "center" });
  shape("roundRect", card.x + 55, 319, 84, 25, card.roleFill, { style: "solid", fill: "none", width: 0 }, { borderRadius: "rounded-full" });
  text(card.role, card.x + 55, 324, 84, 16, { fontSize: 12, bold: true, color: card.roleColor, alignment: "center" });
  if (card.image) {
    await addImage(card.image, card.x + 16, 355, 162, 65, card.alt);
  } else if (card.num === "04") {
    const checks = ["确认", "通知", "回执"];
    for (let i = 0; i < checks.length; i += 1) {
      shape("ellipse", card.x + 20, 361 + i * 22, 12, 12, "#17A95C");
      text("✓", card.x + 20, 360 + i * 22, 12, 13, { fontSize: 9, bold: true, color: "#FFFFFF", alignment: "center" });
      text(checks[i], card.x + 41, 358 + i * 22, 110, 18, { fontSize: 13, color: "#41695A" });
    }
  } else {
    const grid = [["人", "数据"], ["设备", "规则"]];
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        shape("roundRect", card.x + 17 + col * 81, 358 + row * 36, 69, 27, "#EDF5F0", { style: "solid", fill: "#D9E8DD", width: 1 }, { borderRadius: "rounded-md" });
        text(grid[row][col], card.x + 17 + col * 81, 365 + row * 36, 69, 14, { fontSize: 12, bold: true, color: "#396452", alignment: "center" });
      }
    }
  }
  text(card.caption, card.x + 16, 431, 162, 18, { fontSize: 12, color: "#728D80", alignment: "center" });
}

// Role responsibility rail.
text("谁在接力", 60, 509, 105, 22, { fontSize: 14, bold: true, color: "#58776A" });
const lanes = [
  { x: 58, w: 430, title: "测量员", copy: "接住客户与空间数据", fill: "#E9F7EE", line: "#BFE5CD", color: "#16864A" },
  { x: 512, w: 430, title: "设计师", copy: "把空间转成方案并完成交接", fill: "#EAF8F0", line: "#BFE5CD", color: "#0F8B4C" },
  { x: 966, w: 250, title: "负责人", copy: "看见全流程", fill: "#EDF5F0", line: "#C9DED1", color: "#2E654F" },
];
for (const lane of lanes) {
  shape("roundRect", lane.x, 539, lane.w, 53, lane.fill, { style: "solid", fill: lane.line, width: 1 }, { borderRadius: "rounded-xl" });
  text(lane.title, lane.x + 18, 555, 74, 19, { fontSize: 15, bold: true, color: lane.color });
  text(lane.copy, lane.x + 101, 556, lane.w - 115, 19, { fontSize: 14, color: "#567568" });
}

shape("roundRect", 58, 626, 1158, 48, "#143F33", { style: "solid", fill: "none", width: 0 }, { borderRadius: "rounded-xl" });
text("客户资产不断线：一次录入，多角色协同，企业全过程可见。", 82, 640, 860, 21, { fontSize: 17, bold: true, color: "#FFFFFF" });
text("家客来", 1087, 641, 102, 19, { fontSize: 16, bold: true, color: "#A9E7C0", alignment: "right" });

await fs.mkdir(output, { recursive: true });
await writeBlob(`${output}/家客来-三角色接力流程图预览.png`, await deck.export({ slide, format: "png", scale: 2 }));
const pptx = await PresentationFile.exportPptx(deck);
await pptx.save(`${output}/家客来-三角色接力流程图预览.pptx`);
await fs.writeFile(`${output}/家客来-三角色接力流程图预览.layout.json`, await (await slide.export({ format: "layout" })).text(), "utf8");
