import fs from "node:fs/promises";

const rows = (await fs.readFile("current-full-inspect.ndjson", "utf8"))
  .trim()
  .split(/\r?\n/)
  .map(JSON.parse);

const byId = new Map(rows.map((row) => [row.id, row]));
const rewrite = (shapeId, newText) => {
  if (!byId.has(shapeId)) throw new Error(`Unknown source element: ${shapeId}`);
  return { action: "rewrite", shapeId, newText };
};
const replace = (shapeId, asset) => {
  if (!byId.has(shapeId)) throw new Error(`Unknown source element: ${shapeId}`);
  return { action: "replace", shapeId, asset };
};

const edits = new Map([
  [8, [
    rewrite("sh/lgbepgvm", "07 / AI 生产可控"),
    rewrite("sh/18byd4zy", "AI 不是黑盒：进度看得见，失败不白扣点"),
    rewrite("sh/g72x4zyd", "老板关心的是稳定交付：提交前知道要什么，生成中知道到哪，失败有原因，成功才扣点。"),
    rewrite("sh/id0fu50z", "提交前：需求一次说清"),
    rewrite("sh/n6pwfmd8", "生成中：进度随时可查"),
    rewrite("sh/1k7edwv2", "老板能管"),
    rewrite("sh/ehgvihwr", "素材齐不齐\n进度到哪步\n本次耗几点\n失败为何"),
    rewrite("sh/kfixwbe1", "成功才扣点\n失败释放 · 随时重试"),
  ]],
  [10, [
    rewrite("sh/cva9k7a9", "09 / 一线轻、老板清"),
    rewrite("sh/xc3mho32", "一线少填表，老板仍能看清客户、方案与进度"),
    rewrite("sh/cbu58j2h", "员工在小程序完成高频动作；后台沉淀组织、权限和全局数据，扩店时不用重新搭流程。"),
    rewrite("sh/725onyl4", "小程序 · 一线执行"),
    rewrite("sh/d87uxg3m", "接待与量房"),
    rewrite("sh/q5gb21kb", "客户建档、正式量房，一次完成。"),
    rewrite("sh/0bit8b2d", "方案与跟进"),
    rewrite("sh/1cru1g3y", "查看户型、发起设计，继续当前客户。"),
    rewrite("sh/ozitcv29", "企业后台 · 老板看全局"),
    rewrite("sh/wvetgbud", "客户进展"),
    rewrite("sh/bu5cnqd8", "谁在跟、走到哪、是否停滞"),
    rewrite("sh/kjytkvup", "团队与权限"),
    rewrite("sh/jypcrqd4", "成员、岗位与数据边界"),
    rewrite("sh/0nut8rul", "方案与成本"),
    rewrite("sh/q9srixs3", "任务记录、结果版本与 AI 点数"),
    rewrite("sh/ru18r2to", "一线操作更轻，老板管理更清，门店复制更容易。"),
  ]],
  [14, [
    replace("im/vm9g3yl4", "owner-sales-modern-cream-v2.jpg"),
  ]],
]);

const plan = {
  outputSlides: Array.from({ length: 15 }, (_, index) => ({
    outputSlide: index + 1,
    sourceSlide: index + 1,
    narrativeRole: index + 1 === 8 ? "AI production control" : index + 1 === 10 ? "field efficiency and owner visibility" : "preserve source narrative",
    reuseMode: "duplicate-slide",
    editTargets: edits.get(index + 1) || [],
  })),
  omittedSourceSlides: [],
};

await fs.writeFile("template-frame-map.json", JSON.stringify(plan, null, 2), "utf8");
