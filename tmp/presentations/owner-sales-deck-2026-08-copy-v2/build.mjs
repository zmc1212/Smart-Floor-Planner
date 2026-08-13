import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const finalPath = "G:/workspace/向总/Smart-Floor-Planner/output/pdf/家客来-装修公司老板销售版-第8-10页内容优化版-2026-08.pptx";
const assetDir = "G:/workspace/向总/Smart-Floor-Planner/design-references/presentation-ai-demo-2026-08";
const plan = JSON.parse(await fs.readFile("template-frame-map.json", "utf8"));
const sourceRows = (await fs.readFile("current-full-inspect.ndjson", "utf8"))
  .trim().split(/\r?\n/).map(JSON.parse);
const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
const bboxKey = (bbox = []) => bbox.map((value) => Math.round(Number(value))).join(",");

const presentation = await PresentationFile.importPptx(await FileBlob.load("template-starter.pptx"));
const live = await presentation.inspect({
  kind: "slide,textbox,shape,image,notes",
  include: "id,slide,name,title,text,textPreview,textChars,textLines,bbox,alt",
  maxChars: 240000,
});
const liveRows = (live.ndjson || "").trim().split(/\r?\n/).map(JSON.parse);

function resolveLive(outputSlide, source) {
  const matches = liveRows.filter((row) => row.slide === outputSlide && row.kind === source.kind && bboxKey(row.bbox) === bboxKey(source.bbox));
  if (matches.length !== 1) throw new Error(`Target mismatch slide ${outputSlide}, ${source.id}: ${matches.map((x) => x.id).join(",")}`);
  return presentation.resolve(matches[0].id);
}

for (const slidePlan of plan.outputSlides) {
  for (const target of slidePlan.editTargets) {
    const source = sourceById.get(target.shapeId);
    if (!source) throw new Error(`Missing source record ${target.shapeId}`);
    const element = resolveLive(slidePlan.outputSlide, source);
    if (target.action === "rewrite") {
      element.text = target.newText;
      continue;
    }
    if (target.action === "replace") {
      const bytes = await fs.readFile(path.join(assetDir, target.asset));
      const frame = element.frame;
      const geometry = element.geometry;
      const borderRadius = element.borderRadius;
      const rotation = element.rotation;
      const flipHorizontal = element.flipHorizontal;
      const flipVertical = element.flipVertical;
      const lockAspectRatio = element.lockAspectRatio;
      element.delete();
      const slide = presentation.slides.getItem(slidePlan.outputSlide - 1);
      const image = slide.images.add({
        blob: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        contentType: "image/jpeg",
        alt: "现代奶油毛坯装修示例",
        fit: "cover",
        position: frame,
        geometry,
        borderRadius,
      });
      image.rotation = rotation;
      image.flipHorizontal = flipHorizontal;
      image.flipVertical = flipVertical;
      image.lockAspectRatio = lockAspectRatio;
      continue;
    }
    throw new Error(`Unsupported action ${target.action}`);
  }
}

await fs.mkdir(path.dirname(finalPath), { recursive: true });
await (await PresentationFile.exportPptx(presentation)).save(finalPath);

await fs.mkdir("final-renders", { recursive: true });
await fs.mkdir("final-layout", { recursive: true });
for (let index = 0; index < presentation.slides.items.length; index += 1) {
  const slide = presentation.slides.getItem(index);
  const stem = `slide-${String(index + 1).padStart(2, "0")}`;
  const png = await presentation.export({ slide, format: "png", scale: 1.5 });
  await fs.writeFile(`final-renders/${stem}.png`, Buffer.from(await png.arrayBuffer()));
  const layout = await presentation.export({ slide, format: "layout" });
  await fs.writeFile(`final-layout/${stem}.layout.json`, Buffer.from(await layout.arrayBuffer()));
}
const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile("final-montage.webp", Buffer.from(await montage.arrayBuffer()));
const inspect = await presentation.inspect({
  kind: "slide,textbox,shape,image,notes",
  include: "id,slide,name,title,text,textPreview,textChars,textLines,bbox,alt",
  maxChars: 240000,
});
await fs.writeFile("final-inspect.ndjson", inspect.ndjson || "", "utf8");
console.log(JSON.stringify({ finalPath, slides: presentation.slides.items.length }));
