import fs from "node:fs/promises";
import path from "node:path";

const dir = process.argv[2];
const files = (await fs.readdir(dir)).filter((name) => name.endsWith(".layout.json"));
const report = [];
for (const file of files.sort()) {
  const data = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
  const overflow = [];
  const crops = [];
  const textProblems = [];
  for (const element of data.elements ?? []) {
    const [left, top, width, height] = element.bbox ?? [];
    if ([left, top, width, height].every(Number.isFinite) && (left < 0 || top < 0 || left + width > 1280 || top + height > 720)) {
      overflow.push({ aid: element.aid, kind: element.kind, bbox: element.bbox });
    }
    if (element.kind === "image") {
      const crop = element.imageCrop ?? {};
      if (Object.values(crop).some((value) => Math.abs(value) > 0.0001)) crops.push({ aid: element.aid, bbox: element.bbox, crop });
    }
    if (element.kind === "shape" && element.textLayout?.lineCount > 1 && element.resolvedTextStyle?.autoFitScale && element.resolvedTextStyle.autoFitScale < 0.999) {
      textProblems.push({ aid: element.aid, bbox: element.bbox, autoFitScale: element.resolvedTextStyle.autoFitScale });
    }
  }
  report.push({ slide: data.slide.slide, file, overflow, imageCrops: crops, textAutoFitShrink: textProblems });
}
console.log(JSON.stringify(report, null, 2));
