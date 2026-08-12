import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const output = "G:/workspace/向总/Smart-Floor-Planner/customer-materials/家客来-三角色接力流程图预览";
const source = `${output}/家客来-三角色接力流程图-全生图版.png`;
const final = `${output}/家客来-三角色接力流程图-纯图片PPT版.pptx`;
const bytes = await fs.readFile(source);
const blob = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const slide = deck.slides.add();
slide.images.add({
  blob,
  contentType: "image/png",
  alt: "家客来一位客户三角色接力完成服务流程图",
  fit: "cover",
  position: { left: 0, top: 0, width: 1280, height: 720 },
  geometry: "rect",
});
const pptx = await PresentationFile.exportPptx(deck);
await pptx.save(final);
const layout = await slide.export({ format: "layout" });
await fs.writeFile(`${output}/家客来-三角色接力流程图-纯图片PPT版.layout.json`, await layout.text(), "utf8");
