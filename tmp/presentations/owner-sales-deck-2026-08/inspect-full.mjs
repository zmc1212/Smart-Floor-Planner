import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const presentation = await PresentationFile.importPptx(await FileBlob.load("Z:/source.pptx"));
const snapshot = await presentation.inspect({
  kind: "slide,textbox,shape,image,notes,layout",
  include: "id,slide,name,title,text,textPreview,textChars,textLines,bbox,alt,isPlaceholder,placeholders",
  maxChars: 500000,
});
await fs.writeFile("Z:/full-inspect.ndjson", snapshot.ndjson || "", "utf8");

const layouts = await presentation.inspect({ kind: "layout", maxChars: 120000 });
await fs.writeFile("Z:/layout-inspect.ndjson", layouts.ndjson || "", "utf8");

const masterSummary = presentation.masters.items.map((master) => ({
  id: master.id,
  name: master.name,
  placeholderSummary: master.placeholders?.summary?.() || [],
  elementCount: master.elements?.items?.length ?? master.elements?.length ?? null,
}));
await fs.writeFile("Z:/master-summary.json", `${JSON.stringify(masterSummary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ slides: presentation.slides.items.length, masters: masterSummary.length }));
