import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const source = process.argv[2];
const target = process.argv[3];

const presentation = await PresentationFile.importPptx(await FileBlob.load(source));
const snapshot = await presentation.inspect({
  kind: "slide,shape,textbox,image,notes",
  maxChars: 200000,
});
await fs.writeFile(`${target}.inspect-before.ndjson`, snapshot.ndjson, "utf8");

function move(id, frame) {
  const item = presentation.resolve(id);
  item.frame = frame;
}

// Slide 4: complete product pages in two proportional evidence frames.
move("im/q5onm50v", { left: 60, top: 210, width: 238, height: 423 });
move("im/m1s7e9k3", { left: 320, top: 210, width: 196, height: 423 });
presentation.resolve("im/q5onm50v").crop = { left: 0, top: 0, right: 0, bottom: 0 };
presentation.resolve("im/m1s7e9k3").crop = { left: 0, top: 0, right: 0, bottom: 0 };

move("sh/3ihk3et8", { left: 560, top: 210, width: 660, height: 423 });
for (const [id, frame] of Object.entries({
  "sh/ih8ju9sn": { left: 606, top: 252, width: 11, height: 11 },
  "sh/kbm987y5": { left: 630, top: 247, width: 540, height: 28 },
  "sh/5cva1cfq": { left: 630, top: 281, width: 540, height: 54 },
  "sh/i94r6xgz": { left: 606, top: 364, width: 11, height: 11 },
  "sh/jadsz2xk": { left: 630, top: 359, width: 540, height: 28 },
  "sh/w72947yt": { left: 630, top: 393, width: 540, height: 54 },
  "sh/x8vaxsfe": { left: 606, top: 476, width: 11, height: 11 },
  "sh/a5kr2xg3": { left: 630, top: 471, width: 540, height: 28 },
  "sh/v6tsv2xo": { left: 630, top: 505, width: 540, height: 54 },
})) move(id, frame);

// Keep the supplied inspiration traceable in the affected slide's source notes.
const slide4Notes = presentation.resolve("nt/jyx0ra1s");
slide4Notes.setText([
  "[Sources]",
  "- Product screenshots inherited from the supplied source deck.",
  "- Current Mini Program customer-record and formal-plan association contracts.",
  "- User-supplied layout reference: https://www.zcool.com.cn/work/ZNjUwMjI4NzI=.html (composition inspiration only; no asset reused).",
].join("\n"));

// Slide 5: retain the complete measurement-page canvases and navigation bars.
move("im/uhkvq14z", { left: 54, top: 210, width: 198, height: 430 });
move("im/yt0f21or", { left: 276, top: 210, width: 199, height: 430 });
move("im/zu9wb6pc", { left: 499, top: 210, width: 199, height: 430 });
for (const id of ["im/uhkvq14z", "im/yt0f21or", "im/zu9wb6pc"]) {
  presentation.resolve(id).crop = { left: 0, top: 0, right: 0, bottom: 0 };
}
move("sh/m5kbi1oj", { left: 742, top: 228, width: 478, height: 396 });
for (const [id, frame] of Object.entries({
  "sh/w32dkbuh": { left: 776, top: 266, width: 410, height: 30 },
  "sh/x4vedgvm": { left: 776, top: 324, width: 410, height: 34 },
  "sh/ahkvi1cb": { left: 788, top: 331, width: 386, height: 20 },
  "sh/v2twb6dw": { left: 776, top: 372, width: 410, height: 34 },
  "sh/k7mxovud": { left: 788, top: 379, width: 386, height: 20 },
  "sh/58vehgvy": { left: 776, top: 438, width: 410, height: 0 },
  "sh/i54fmlc7": { left: 776, top: 466, width: 410, height: 26 },
  "sh/j6dwfqds": { left: 776, top: 510, width: 410, height: 76 },
})) move(id, frame);

const after = await presentation.inspect({
  kind: "slide,shape,textbox,image,notes",
  maxChars: 200000,
});
await fs.writeFile(`${target}.inspect-after.ndjson`, after.ndjson, "utf8");
const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(target);
