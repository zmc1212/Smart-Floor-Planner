import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const source = process.argv[2];
const output = process.argv[3];

async function writeBlob(filePath, blob) {
  await fs.writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
}

await fs.mkdir(output, { recursive: true });
const presentation = await PresentationFile.importPptx(await FileBlob.load(source));
const inspect = await presentation.inspect({
  kind: "slide,textbox,shape,image,table,chart,notes,thread,layout",
  maxChars: 200000,
});
await fs.writeFile(path.join(output, "inspect.ndjson"), inspect.ndjson, "utf8");

for (const [index, slide] of presentation.slides.items.entries()) {
  await writeBlob(
    path.join(output, `slide-${String(index + 1).padStart(2, "0")}.png`),
    await presentation.export({ slide, format: "png", scale: 2 }),
  );
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(
    path.join(output, `slide-${String(index + 1).padStart(2, "0")}.layout.json`),
    await layout.text(),
    "utf8",
  );
}

await writeBlob(
  path.join(output, "montage.webp"),
  await presentation.export({ format: "webp", montage: true, scale: 1 }),
);
