import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const source = process.argv[2];
const target = process.argv[3];
const presentation = await PresentationFile.importPptx(await FileBlob.load(source));

function setText(id, text) {
  presentation.resolve(id).text = text;
}

// Slide 8: three acquisition channels converge into one accountable private-domain flow.
for (const [id, text] of Object.entries({
  "sh/lgbepgvm": "07 / 三渠获客",
  "sh/18byd4zy": "三个免费钩子，把线索持续送进设计师",
  "sh/g72x4zyd": "编外网络、定点活动和线上平台各自获客，但都进入同一私域入口、同一分级与跟进流程。",
  "sh/ri9g7uhw": "家客来 JIAKELAI  ·  获客入口",
  "sh/id0fu50z": "编外网络：推荐人只做引荐",
  "sh/n6pwfmd8": "定点活动、线上平台：统一进入设计师微信",
  "sh/1k7edwv2": "统一承接规则",
  "sh/ehgvihwr": "专属码溯源\n第一触达锁定\nAI 分级 S/A/B/C\n24h 响应与跟进",
  "sh/kfixwbe1": "线索有来源\n客户有归属\n每一步都有下一步",
})) setText(id, text);
presentation.resolve("nt/fu1gfa1s").setText([
  "[Sources]",
  "- 家客来AI获客系统完整工作流.docx, V7.0: 三大渠道、统一私域入口、AI分级、专属推广码、第一触达锁定与线上24h响应机制。",
  "- Inherited visual assets from the supplied sales deck; used as illustrative context only.",
].join("\n"));

// Slide 9: make the 1+N operating model visible, rather than a generic handoff.
for (const [id, text] of Object.entries({
  "sh/2l4faloj": "08 / 1+N 获客小组",
  "sh/1cfmhgne": "一个设计师带队，多渠道线索有人承接",
  "sh/0b65obm9": "设计师是小组责任主体；推荐人抓前端触达，测绘员提供技术支持，装企可按设计师数量复制小组。",
  "sh/nex4jq5k": "家客来 JIAKELAI  ·  1+N 获客小组",
  "sh/ah8nu54b": "N1",
  "sh/oza1gfyh": "推荐人",
  "sh/p0ji9kf2": "触达业主\n引导加设计师微信",
  "sh/3y107axw": "贡献：线索与来源",
  "sh/qlcjipgn": "1",
  "sh/bml0buxs": "设计师",
  "sh/0ru1ozyp": "小组负责人\n分级、派单、转化",
  "sh/98ji147e": "负责：客户经营",
  "sh/ml8j6p8n": "N2",
  "sh/hcji5o7a": "测绘员",
  "sh/wba1cjqp": "预约上门\n正式测绘、上传数据",
  "sh/u9sja98z": "交付：可用户型",
  "sh/cf6h0fql": "1 个设计师 + N1 推荐人 + N2 测绘员，按小组复制。",
})) setText(id, text);
presentation.resolve("nt/udsvah03").setText([
  "[Sources]",
  "- 家客来AI获客系统完整工作流.docx, V7.0: 1+N获客小组结构、推荐人/测绘员/设计师职责与按设计师数量复制的组织逻辑。",
].join("\n"));

// Slide 10: move the decision maker from operational supervision to funnel and ROI control.
for (const [id, text] of Object.entries({
  "sh/cva9k7a9": "09 / 老板管系统",
  "sh/xc3mho32": "不用盯每个人，老板只看漏斗、ROI 和异常",
  "sh/cbu58j2h": "一线围绕客户完成承接、测绘和跟进；老板从驾驶舱看三渠效果、小组表现与需要介入的例外。",
  "sh/zelojyl8": "家客来 JIAKELAI  ·  获客总控",
  "sh/725onyl4": "一线小程序 · 客户推进",
  "sh/d87uxg3m": "承接与分级",
  "sh/q5gb21kb": "扫码或留资进入，AI 分级后优先处理高意向客户。",
  "sh/0bit8b2d": "派单与跟进",
  "sh/1cru1g3y": "设计师派单测绘，用效果图和跟进持续推进。",
  "sh/ozitcv29": "老板驾驶舱 · 总控",
  "sh/wvetgbud": "分渠道 ROI",
  "sh/bu5cnqd8": "获客量、转化率与成本对比",
  "sh/kjytkvup": "红黄绿预警",
  "sh/jypcrqd4": "7天无新增黄灯，14天红灯",
  "sh/0nut8rul": "赛马与迭代",
  "sh/q9srixs3": "看小组表现，调整资源和规则",
  "sh/ru18r2to": "从管人到管系统，让有效做法复制。",
})) setText(id, text);
presentation.resolve("nt/m90b6t0r").setText([
  "[Sources]",
  "- 家客来AI获客系统完整工作流.docx, V7.0: 老板管理驾驶舱、分渠道ROI、红黄绿灯预警、赛马排名、异常干预与制度迭代。",
  "- Inherited Mini Program screenshot from the supplied sales deck.",
].join("\n"));

const snapshot = await presentation.inspect({
  kind: "slide,textbox,shape,image,notes",
  maxChars: 200000,
});
await fs.writeFile(`${target}.inspect.ndjson`, snapshot.ndjson, "utf8");
const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(target);
