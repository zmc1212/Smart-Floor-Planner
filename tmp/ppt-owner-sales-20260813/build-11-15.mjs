import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const root = "G:/workspace/向总/Smart-Floor-Planner";
const finalPath = `${root}/output/pdf/家客来-装修公司老板销售版-第8-10页内容优化版-2026-08.pptx`;
const outDir = `${root}/tmp/ppt-owner-sales-20260813/final-11-15`;
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
  // Slide 11: move from the seller's validation process to the owner's buying decision.
  "sh/03qxg7mx": "10 / 怎么开始更稳妥",
  "sh/xcryxg7y": "从一家门店开始，先把一条客户服务链跑顺",
  "sh/wbih4b6d": "先看真实客户能否从建档、量房走到方案沟通；团队日常用得顺，再决定账号规模和配套设备。",
  "sh/o7ih0r6h": "试点门店",
  "sh/72t03qp0": "选一家门店，带一组真实客户进入完整流程。",
  "sh/mdobedg3": "负责人",
  "sh/nehs7iho": "业务、量房、设计、管理各有明确接口人。",
  "sh/zaxs3yhc": "账号与权限",
  "sh/cn6t83y1": "按岗位开通账号，客户数据各看各的。",
  "sh/87ehgv6d": "4",
  "sh/7650nq5s": "AI 能力",
  "sh/65wzelo7": "确认可用能力、额度和异常处理方式。",
  "sh/y1czalob": "量房设备（可选）",
  "sh/p07ixkn6": "可接入已授权的蓝牙测距设备，也可直接手工录入。",
  "sh/o7axk7m9": "落地陪跑",
  "sh/98jedc3u": "培训、现场演示和首批客户陪跑。",
  "sh/eh8fex47": "家客来 JIAKELAI  ·  门店落地",

  // Slide 12: make the next step a customer-facing action path, not an internal experiment.
  "sh/0f2lgnmp": "选一家门店，把一个真实客户服务到底",
  "sh/ra943il8": "从客户建档到方案沟通，老板可以直接看到每一步是否顺畅，再决定是否扩大到更多门店和团队。",
  "sh/b6d4f2lc": "确定门店与负责人",
  "sh/wvupgz6t": "2",
  "sh/xw3q94ne": "开通账号与权限",
  "sh/bulo7u58": "3",
  "sh/orapcf6h": "选定真实客户",
  "sh/mps7a5or": "4",
  "sh/nq1o3a5w": "完成正式量房",
  "sh/1oj61kn6": "5",
  "sh/hkbm5wzu": "生成并沟通方案",
  "sh/fit436ho": "6",
  "sh/uh0na1g3": "决定是否扩大",
  "sh/sfi58ryd": "老板能直接判断：",
  "sh/7u94zmhs": "客户不用重复建档 · 量房成果能被设计直接使用 | 方案和修改留在同一客户下 · 每一步都有明确责任人",

  // Slide 13: explain how the capability maps to daily sales work.
  "sh/q50nydsj": "四类 AI 能力，覆盖客户沟通中的常见场景",
  "sh/bq9orito": "从第一次给客户看方向，到局部调整和持续深化，设计师都能沿用同一份空间依据继续推进。",
  "sh/1076lobm": "让客户先看懂空间",
  "sh/u9ofyp43": "让团队先看清问题",
  "sh/lkvy103m": "把空房或毛坯底图变成可沟通的完整方案。",
  "sh/bmhgfatc": "把客户喜欢的参考风格带进当前户型。",
  "sh/8vahgzu5": "把户型和布局问题讲清楚，方便方案讨论。",
  "sh/4re1o3ed": "把材质、软装和局部细节继续改到客户认可。",

  // Slide 14: replace inventory language with a concrete reassurance about coverage.
  "sh/pwvy90rq": "附录 B / 常见任务覆盖",
  "sh/xc7eds76": "老板不用担心每次都从零开始，常见家装任务已有现成入口",
  "sh/wbydknq1": "毛坯装修、风格迁移、户型诊断和局部深化，都能按真实客户需求直接选择。",
  "sh/1w3i14fq": "常见任务",
  "sh/hsvy50re": "覆盖高频家装场景",
  "sh/fqdg3q98": "老板看这三点",
  "sh/up4fal83": "能不能马上用 | 客户看不看得懂 | 设计能不能继续改",

  // Slide 15: frame boundaries as purchase-readiness questions.
  "sh/4n6d8z21": "附录 C / 开始前需要确认什么",
  "sh/547mhg3m": "把账号、户型和团队权限准备好，家客来才能在门店顺利用起来",
  "sh/k3y5ov21": "这些是采购和试点前需要双方确认的基础条件，确保一线拿来就能用。",
  "sh/s7y5sv2x": "企业账号",
  "sh/na5476l8": "账号、网络和服务连接正常。",
  "sh/upkrilwj": "蓝牙测距（可选）",
  "sh/vqdsrqx4": "有兼容设备就直接连接；没有也能手工录入。",
  "sh/judsvqxg": "正式户型",
  "sh/0z29cbyh": "墙体有效、空间闭合，设计结果才有可靠依据。",
  "sh/fi1grylo": "AI 能力",
  "sh/ehsfyt43": "开通需要的方案能力，并准备可用额度。",
  "sh/25sf2d4z": "方案边界",
  "sh/dc3y1s3m": "用于概念表达、方案比较和客户沟通，不替代施工图。",
  "sh/wj6d4z2p": "团队权限",
  "sh/hkfexkja": "按岗位分配客户和户型数据访问范围。",
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
