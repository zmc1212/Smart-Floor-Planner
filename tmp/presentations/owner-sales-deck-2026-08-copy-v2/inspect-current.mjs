import fs from "node:fs/promises";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const input = "G:/workspace/向总/Smart-Floor-Planner/output/pdf/家客来-装修公司老板销售版-客户量房AI设计闭环-2026-08.pptx";
const presentation = await PresentationFile.importPptx(await FileBlob.load(input));
const snapshot = await presentation.inspect({
  kind: "slide,textbox,shape,image,notes,layout",
  include: "id,slide,name,title,text,textPreview,textChars,textLines,bbox,alt",
  maxChars: 240000,
});
await fs.writeFile("current-full-inspect.ndjson", snapshot.ndjson || "", "utf8");
