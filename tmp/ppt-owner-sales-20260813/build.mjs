import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const root = "G:/workspace/向总/Smart-Floor-Planner";
const sourcePath = `${root}/tmp/ppt-owner-sales-20260813/source.pptx`;
const finalPath = `${root}/output/pdf/家客来-装修公司老板销售版-第8-10页内容优化版-2026-08.pptx`;
const outDir = `${root}/tmp/ppt-owner-sales-20260813/final`;
const imageA = `${root}/design-references/presentation-owner-sales-2026-08/sub2api-20260813-011942-1.png`;
const imageB = `${root}/design-references/presentation-owner-sales-2026-08/sub2api-20260813-012116-1.png`;

const presentation = await PresentationFile.importPptx(await FileBlob.load(sourcePath));
const inspected = await presentation.inspect({
  kind: "slide,textbox,shape,image,notes",
  include: "id,slide,name,title,text,textPreview,textChars,textLines,bbox,alt",
  maxChars: 240000,
});
const rows = (inspected.ndjson || "").trim().split(/\r?\n/).map(JSON.parse);
const byId = new Map(rows.map((row) => [row.id, row]));
const bySlide = new Map();
for (const row of rows) {
  if (!bySlide.has(row.slide)) bySlide.set(row.slide, []);
  bySlide.get(row.slide).push(row);
}

function resolve(id) {
  if (!byId.has(id)) throw new Error(`Missing element ${id}`);
  return presentation.resolve(id);
}

function rewrite(id, text) {
  resolve(id).text = text;
}

async function replaceImage(id, filePath, alt) {
  const row = byId.get(id);
  const element = resolve(id);
  const frame = element.frame;
  const geometry = element.geometry;
  const borderRadius = element.borderRadius;
  element.delete();
  const bytes = await fs.readFile(filePath);
  presentation.slides.getItem(row.slide - 1).images.add({
    blob: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    contentType: "image/png",
    alt,
    fit: "cover",
    position: frame,
    geometry,
    borderRadius,
  });
}

const rewrites = {
  "sh/lgbepgvm": "07 / 少返工、快沟通",
  "sh/18byd4zy": "量房资料直接变成方案，团队少返工，客户少等待",
  "sh/g72x4zyd": "设计师不再从聊天记录和手绘尺寸重新拼资料；围绕同一客户、同一户型持续出方案、改方案。",
  "sh/id0fu50z": "设计师：接手就能出首轮方案",
  "sh/n6pwfmd8": "老板：方案和责任都留在客户名下",
  "sh/1k7edwv2": "老板得到的结果",
  "sh/ehgvihwr": "少一次资料重整\n少一轮重复确认\n方案更快给客户看\n人员变化也能接着做",
  "sh/kfixwbe1": "前端更快谈方案\n后台保留过程与成果",
  "sh/ri9g7uhw": "家客来 JIAKELAI  ·  量房到方案",

  "sh/xc3mho32": "一线在客户现场完成动作，老板在后台掌握全局",
  "sh/cbu58j2h": "员工用小程序完成建档、量房、看户型和发起设计；老板用后台看客户推进、团队责任和方案沉淀。",
  "sh/bu5cnqd8": "谁在跟、走到哪、下一步是什么",
  "sh/q9srixs3": "任务记录、方案版本与使用成本",
  "sh/ru18r2to": "一线操作更轻，老板管理更清，新人接手和门店复制更容易。",

  "sh/xcryxg7y": "先用一条真实客户流程验证：能否少返工、快出方案、顺利交接",
  "sh/wbih4b6d": "建议从一家门店、一组真实客户开始；验证有效后，再确认账号规模、AI 使用和可选设备。",
  "sh/87ehgv6d": "AI 服务",
  "sh/65wzelo7": "确认可用能力、使用额度和异常处理规则。",

  "sh/q50nydsj": "四类常用 AI 任务，覆盖从首轮方案到持续深化",
  "sh/bq9orito": "设计师按任务选择现成能力，不必每次研究复杂提示词；客户更快看到可比较的方案。",

  "sh/xc7eds76": "真正的价值不是模板多，而是常见家装任务有人接得住",
  "sh/wbydknq1": "当前能力库覆盖毛坯装修、风格迁移、户型诊断和局部深化；以下用三个示例说明真实用途。",
  "sh/1w3i14fq": "当前能力库",
  "sh/hsvy50re": "持续维护常用家装任务",
  "sh/fqdg3q98": "选择原则",
  "sh/up4fal83": "家装高频 | 结果可比较 | 客户易沟通",

  "sh/547mhg3m": "账号、户型和团队权限准备好，试点才能真正跑通",
  "sh/k3y5ov21": "这些不是销售口号，而是开始试点前双方必须确认的运行条件。",
  "sh/fi1grylo": "AI 服务",
  "sh/ehsfyt43": "企业已开通对应能力，并具备可用额度和有效服务配置。",
};

for (const [id, text] of Object.entries(rewrites)) rewrite(id, text);
await replaceImage("im/yp8rix47", imageA, "设计师基于正式量房资料比较客户方案");
await replaceImage("im/jqhsb2ls", imageB, "装修公司老板与设计师围绕同一客户方案复盘");

const slide8 = presentation.slides.getItem(7);
const sources = [
  "[Sources]",
  "- Project source of truth: docs/admin-system-modules.zh-CN.md; docs/miniprogram-system-modules.zh-CN.md (accessed 2026-08-13)",
  "- Generated visual A: design-references/presentation-owner-sales-2026-08/sub2api-20260813-011942-1.png; Sub2API gpt-image-2; generated 2026-08-13",
  "- Generated visual B: design-references/presentation-owner-sales-2026-08/sub2api-20260813-012116-1.png; Sub2API gpt-image-2; generated 2026-08-13",
].join("\n");
const priorNotes = slide8.speakerNotes.textFrame.text || "";
slide8.speakerNotes.textFrame.setText(priorNotes.includes("[Sources]") ? priorNotes : `${priorNotes.trim()}${priorNotes.trim() ? "\n\n" : ""}${sources}`);

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
await fs.writeFile(`${outDir}/template-frame-map.json`, JSON.stringify({
  outputSlides: Array.from({ length: 15 }, (_, i) => ({
    outputSlide: i + 1,
    sourceSlide: i + 1,
    narrativeRole: i + 1 === 8 ? "owner value from measurement-to-design continuity" : "preserve and refine owner-facing sales narrative",
    reuseMode: "duplicate-slide",
    editTargets: (bySlide.get(i + 1) || []).filter((row) => rewrites[row.id]).map((row) => ({ action: "rewrite", shapeId: row.id, newText: rewrites[row.id] })),
  })),
  omittedSourceSlides: [],
}, null, 2), "utf8");

await fs.copyFile(finalPath, `${outDir}/pre-edit-backup.pptx`).catch(() => {});
await (await PresentationFile.exportPptx(presentation)).save(finalPath);
console.log(JSON.stringify({ finalPath, slides: presentation.slides.items.length }));
