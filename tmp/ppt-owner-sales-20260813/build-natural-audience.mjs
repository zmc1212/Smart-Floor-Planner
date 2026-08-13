import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const root = "G:/workspace/向总/Smart-Floor-Planner";
const finalPath = `${root}/output/pdf/家客来-装修公司老板销售版-第8-10页内容优化版-2026-08.pptx`;
const outDir = `${root}/tmp/ppt-owner-sales-20260813/final-natural-audience`;
const presentation = await PresentationFile.importPptx(await FileBlob.load(finalPath));
const inspect = await presentation.inspect({
  kind: "slide,textbox,shape,image,notes",
  include: "id,slide,name,title,text,textPreview,textChars,textLines,bbox,alt",
  maxChars: 240000,
});
const rows = (inspect.ndjson || "").trim().split(/\r?\n/).map(JSON.parse);
const byId = new Map(rows.map((row) => [row.id, row]));

function rewrite(id, text) {
  if (!byId.has(id)) throw new Error(`Missing element ${id}`);
  presentation.resolve(id).text = text;
}

const rewrites = {
  "sh/wn6dc7eh": "客户演示版  ·  16:9  ·  2026.08",

  "sh/gbmxszmt": "01 / 为什么现在需要",
  "sh/b29kza94": "家客来 JIAKELAI  ·  客户服务闭环",
  "sh/s72xofmh": "下一步没人说得清",

  "sh/n6pwfmd8": "团队：方案和责任都留在客户名下",
  "sh/1k7edwv2": "带来的结果",

  "sh/cva9k7a9": "09 / 前台执行与后台管理",
  "sh/xc3mho32": "一线在客户现场完成动作，后台统一掌握客户与团队",
  "sh/cbu58j2h": "员工用小程序完成建档、量房、看户型和发起设计；管理端统一查看客户推进、团队责任和方案沉淀。",
  "sh/ozitcv29": "企业后台 · 统一管理",
  "sh/ru18r2to": "一线操作更轻，客户与责任更清楚，门店复制更容易。",

  "sh/ra943il8": "从客户建档到方案沟通，每一步是否顺畅一目了然，再决定是否扩大到更多门店和团队。",
  "sh/sfi58ryd": "结果一目了然：",
  "sh/6t0n6hg7": "家客来 JIAKELAI  ·  客户演示版  ·  2026.08",

  "sh/xc7eds76": "常见家装任务不必每次从零开始，已有现成入口",
  "sh/fqdg3q98": "选择时看三点",
};

for (const [id, text] of Object.entries(rewrites)) rewrite(id, text);

await fs.mkdir(outDir, { recursive: true });
for (let i = 0; i < presentation.slides.items.length; i += 1) {
  const slide = presentation.slides.getItem(i);
  const stem = `slide-${String(i + 1).padStart(2, "0")}`;
  const png = await presentation.export({ slide, format: "png", scale: 1.5 });
  await fs.writeFile(`${outDir}/${stem}.png`, Buffer.from(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(`${outDir}/${stem}.layout.json`, Buffer.from(await layout.arrayBuffer()));
}
const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile(`${outDir}/montage.webp`, Buffer.from(await montage.arrayBuffer()));
const finalInspect = await presentation.inspect({
  kind: "slide,textbox,shape,image,notes",
  include: "id,slide,name,title,text,textPreview,textChars,textLines,bbox,alt",
  maxChars: 240000,
});
await fs.writeFile(`${outDir}/final-inspect.ndjson`, finalInspect.ndjson || "", "utf8");
const pendingPath = `${outDir}/pending.pptx`;
await (await PresentationFile.exportPptx(presentation)).save(pendingPath);
console.log(JSON.stringify({ finalPath, pendingPath, slides: presentation.slides.items.length }));
