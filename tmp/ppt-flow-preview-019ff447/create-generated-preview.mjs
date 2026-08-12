import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const root = "G:/workspace/向总/Smart-Floor-Planner";
const output = `${root}/customer-materials/家客来-三角色接力流程图预览`;
const imagePath = `${output}/家客来-三角色接力-生图主视觉.png`;
const workingPng = `${output}/家客来-三角色接力流程图-生图稳定版.png`;
const finalPptx = `${output}/家客来-三角色接力流程图-生图稳定版.pptx`;

async function writeBlob(path, blob) {
  await fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}

async function readImage(path) {
  const bytes = await fs.readFile(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function addImage(slide, blob, left, top, width, height, alt) {
  slide.images.add({
    blob,
    contentType: "image/png",
    alt,
    fit: "cover",
    position: { left, top, width, height },
    geometry: "rect",
  });
}

function addShape(slide, geometry, left, top, width, height, fill, line = { style: "solid", fill: "none", width: 0 }, extra = {}) {
  return slide.shapes.add({ geometry, position: { left, top, width, height }, fill, line, ...extra });
}

function addText(slide, value, left, top, width, height, style = {}) {
  const box = addShape(slide, "textbox", left, top, width, height, "none", { style: "solid", fill: "none", width: 0 });
  box.text = value;
  box.text.style = { color: "#173E33", fontSize: 18, ...style };
  return box;
}

const visual = await readImage(imagePath);
const editable = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const slide = editable.slides.add();
addImage(slide, visual, 0, 0, 1280, 720, "三角色协同服务主视觉");

addShape(slide, "rect", 0, 0, 16, 720, "#169E55");
addText(slide, "家客来  /  客户服务协同", 72, 64, 390, 24, { fontSize: 15, bold: true, color: "#208450" });
addText(slide, "一位客户，\n三角色接力完成服务", 70, 110, 520, 104, { fontSize: 38, bold: true, color: "#173E33" });
addText(slide, "从客户建档到方案交接，\n同一份客户资产始终连续。", 72, 234, 440, 58, { fontSize: 19, color: "#5B756A" });

const roles = [
  ["测量员", "建档 · 正式量房", "#1F9E58"],
  ["设计师", "AI 方案 · 协作交接", "#148A50"],
  ["负责人", "权限 · 规则 · 全过程", "#315E4E"],
];
for (let index = 0; index < roles.length; index += 1) {
  const [role, line, color] = roles[index];
  const y = 363 + index * 66;
  addShape(slide, "ellipse", 74, y + 5, 14, 14, color);
  if (index < roles.length - 1) {
    addShape(slide, "line", 80, y + 23, 0, 37, "none", { style: "solid", fill: "#A8D9B9", width: 1.5 });
  }
  addText(slide, role, 108, y - 1, 110, 22, { fontSize: 18, bold: true, color });
  addText(slide, line, 108, y + 27, 330, 18, { fontSize: 14, color: "#60796E" });
}
addShape(slide, "roundRect", 70, 595, 450, 50, "#173E33", { style: "solid", fill: "none", width: 0 }, { borderRadius: "rounded-full" });
addText(slide, "一条客户主线，让协同自然发生", 95, 610, 400, 22, { fontSize: 16, bold: true, color: "#FFFFFF", alignment: "center" });

// Create a final composited PNG, then embed that exact image in the delivery PPTX.
await writeBlob(workingPng, await editable.export({ slide, format: "png", scale: 2 }));
const stable = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const stableSlide = stable.slides.add();
addImage(stableSlide, await readImage(workingPng), 0, 0, 1280, 720, "家客来三角色接力流程图生图稳定版");
const pptx = await PresentationFile.exportPptx(stable);
await pptx.save(finalPptx);
await fs.writeFile(`${output}/家客来-三角色接力流程图-生图稳定版.layout.json`, await (await stableSlide.export({ format: "layout" })).text(), "utf8");
