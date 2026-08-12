import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const source = "G:/workspace/向总/Smart-Floor-Planner/customer-materials/家客来-客户推广会-系统思维导图版.pptx";
const out = "G:/workspace/向总/Smart-Floor-Planner/tmp/ppt-flow-preview-019ff447/source-review";

async function writeBlob(path, blob) {
  await fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}

const presentation = await PresentationFile.importPptx(await FileBlob.load(source));
await fs.mkdir(out, { recursive: true });
const inspect = await presentation.inspect({
  kind: "slide,textbox,shape,image,notes,layout",
  maxChars: 60000,
});
await fs.writeFile(`${out}/inspect.ndjson`, inspect.ndjson, "utf8");
for (let index = 0; index < presentation.slides.items.length; index += 1) {
  const slide = presentation.slides.items[index];
  await writeBlob(`${out}/slide-${index + 1}.png`, await presentation.export({ slide, format: "png", scale: 1.5 }));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(`${out}/slide-${index + 1}.layout.json`, await layout.text(), "utf8");
}
await writeBlob(`${out}/montage.webp`, await presentation.export({ format: "webp", montage: true, scale: 1 }));
