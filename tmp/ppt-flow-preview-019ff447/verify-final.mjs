import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const base = "G:/workspace/向总/Smart-Floor-Planner/customer-materials/家客来-三角色接力流程图预览";
const deckPath = `${base}/家客来-三角色接力流程图预览.pptx`;
const qa = "G:/workspace/向总/Smart-Floor-Planner/tmp/ppt-flow-preview-019ff447/final-qa";
async function writeBlob(path, blob) {
  await fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}
const deck = await PresentationFile.importPptx(await FileBlob.load(deckPath));
await fs.mkdir(qa, { recursive: true });
const slide = deck.slides.items[0];
await writeBlob(`${qa}/roundtrip-slide-1.png`, await deck.export({ slide, format: "png", scale: 2 }));
await fs.writeFile(`${qa}/inspect.ndjson`, (await deck.inspect({ kind: "slide,textbox,shape,image,notes,layout", maxChars: 20000 })).ndjson, "utf8");
await fs.writeFile(`${qa}/slide-1.layout.json`, await (await slide.export({ format: "layout" })).text(), "utf8");
