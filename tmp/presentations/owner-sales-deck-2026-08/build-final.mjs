import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const workspace = "Z:/";
const root = "G:/workspace/向总/Smart-Floor-Planner";
const assetDir = `${root}/design-references/presentation-ai-demo-2026-08`;
const finalPath = `${root}/output/pdf/家客来-装修公司老板销售版-客户量房AI设计闭环-2026-08.pptx`;

const plan = JSON.parse(await fs.readFile(`${workspace}template-frame-map.json`, "utf8"));
const sourceRecords = (await fs.readFile(`${workspace}source-inspect.ndjson`, "utf8"))
  .trim()
  .split(/\r?\n/)
  .map(JSON.parse);
const sourceById = new Map(sourceRecords.map((record) => [record.id, record]));
const bboxKey = (bbox = []) => bbox.map((value) => Math.round(Number(value))).join(",");

const presentation = await PresentationFile.importPptx(
  await FileBlob.load(`${workspace}template-starter.pptx`),
);
const starterSnapshot = await presentation.inspect({
  kind: "slide,textbox,image",
  include: "id,slide,name,title,text,textPreview,textChars,textLines,bbox,alt",
  maxChars: 180000,
});
const starterRecords = (starterSnapshot.ndjson || "")
  .trim()
  .split(/\r?\n/)
  .map(JSON.parse);

function resolveStarterRecord(outputSlide, sourceRecord) {
  const matches = starterRecords.filter((record) =>
    record.slide === outputSlide &&
    record.kind === sourceRecord.kind &&
    bboxKey(record.bbox) === bboxKey(sourceRecord.bbox)
  );
  if (matches.length !== 1) {
    throw new Error(`Starter target mismatch for output ${outputSlide}, source ${sourceRecord.id}, ${sourceRecord.kind}, ${bboxKey(sourceRecord.bbox)}: ${matches.map((item) => item.id).join(", ")}`);
  }
  return matches[0];
}

for (const entry of plan.outputSlides) {
  for (const target of entry.editTargets) {
    const sourceRecord = sourceById.get(target.shapeId);
    if (!sourceRecord) throw new Error(`Missing source record ${target.shapeId}`);
    const starterRecord = resolveStarterRecord(entry.outputSlide, sourceRecord);
    const element = presentation.resolve(starterRecord.id);

    if (target.action === "rewrite") {
      element.text = target.newText;
      continue;
    }

    if (target.action === "replace") {
      const assetPath = path.join(assetDir, target.asset);
      const bytes = await fs.readFile(assetPath);
      const oldFrame = element.frame;
      const oldGeometry = element.geometry;
      const oldBorderRadius = element.borderRadius;
      const oldRotation = element.rotation;
      const oldFlipHorizontal = element.flipHorizontal;
      const oldFlipVertical = element.flipVertical;
      const oldLockAspectRatio = element.lockAspectRatio;
      // Imported slides may reuse the same underlying media part on multiple
      // slides. Replacing that part in place can unintentionally change every
      // linked occurrence, so create a new slide-local image element instead.
      element.delete();
      const slide = presentation.slides.getItem(entry.outputSlide - 1);
      const replacement = slide.images.add({
        blob: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        contentType: "image/jpeg",
        alt: `AI 演示效果：${target.asset}`,
        fit: "cover",
        position: oldFrame,
        geometry: oldGeometry,
        borderRadius: oldBorderRadius,
      });
      replacement.rotation = oldRotation;
      replacement.flipHorizontal = oldFlipHorizontal;
      replacement.flipVertical = oldFlipVertical;
      replacement.lockAspectRatio = oldLockAspectRatio;
      continue;
    }

    throw new Error(`Unsupported action ${target.action}`);
  }
}

const notes = [
  "[Sources]\n- Current repository module inventories for customer records, formal surveying, AI design, team roles, and product boundaries.\n- Brand hero and logo inherited from the supplied source deck.",
  "[Sources]\n- Current repository customer-record and surveying module inventories.\n- This slide describes operating pain and does not claim measured financial or conversion outcomes.",
  "[Sources]\n- Current customer-stage, formal-floor-plan, AI workflow, and role-handoff contracts in the repository module inventories.\n- 张女士 is the deck's illustrative customer identity, not a claimed customer case study.",
  "[Sources]\n- Product screenshots inherited from the supplied source deck.\n- Current Mini Program customer-record and formal-plan association contracts.",
  "[Sources]\n- Product screenshots inherited from the supplied source deck.\n- docs/surveying-module/README.md and formal-surveying.md: millimetre wall graph, manual/BLE input, doors/openings, closed spaces, and formal-plan persistence.",
  "[Sources]\n- AI-generated demonstration images produced with OpenAI built-in image generation from the same empty-room reference: owner-sales-modern-cream-v2.jpg, owner-sales-modern-french-v2.jpg, owner-sales-modern-chinese-v2.jpg.\n- Images demonstrate concept comparison only; they are not runtime screenshots or construction drawings.",
  "[Sources]\n- AI demonstration assets inherited from the supplied source deck: empty-room to modern-cream comparison and local material replacement.\n- Current AI workflow contract: successful results remain in the customer/formal-plan workflow and may be continued by supported stages.\n- Demonstration images are not construction drawings.",
  "[Sources]\n- Product screenshots inherited from the supplied source deck.\n- Current Mini Program AI contract: required inputs, target context, progress, enterprise credits, success deduction, failure release, and retry behavior.",
  "[Sources]\n- Current role, permission, customer-stage, formal-plan, and AI workflow contracts in the repository module inventories.",
  "[Sources]\n- Product screenshot inherited from the supplied source deck.\n- Current Mini Program and Admin module inventories for field execution, organization, permissions, customers, formal plans, and AI workflow management.",
  "[Sources]\n- Proposed pilot and purchasing checklist for customer discussion.\n- Product facts grounded in current enterprise-account, role-permission, AI-credit, optional BLE-device, and service-configuration contracts.\n- No fixed price, duration, or performance outcome is claimed.",
  "[Sources]\n- Proposed next-step and observable pilot acceptance criteria.\n- No customer outcome or conversion metric is claimed.",
  "[Sources]\n- Current Mini Program and Admin AI capabilities: reference recreation, whole-space style transformation, formal-floor-plan concept rendering, and soft-furnishing refinement.",
  "[Sources]\n- Internal PostgreSQL prompt-library active revision published 2026-08-01 with 960 enabled templates.\n- Shown inherited preview assets correspond to modern-cream rough-home renovation, French rough-home renovation, and floor-plan problem diagnosis examples.",
  "[Sources]\n- Current repository product boundaries: valid enterprise account and services; optional compatible authorized BLE device or manual entry; completed valid version-4 formal plan with closed space; AI permission and credits; concept-only AI output; role-scoped data access.",
];

for (let index = 0; index < presentation.slides.items.length; index += 1) {
  const slide = presentation.slides.getItem(index);
  slide.speakerNotes.textFrame.setText(notes[index]);
  slide.speakerNotes.setVisible(true);
}

await fs.mkdir(path.dirname(finalPath), { recursive: true });
const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(finalPath);

const renderDir = `${workspace}final-renders`;
const layoutDir = `${workspace}final-layout`;
await fs.mkdir(renderDir, { recursive: true });
await fs.mkdir(layoutDir, { recursive: true });

for (let index = 0; index < presentation.slides.items.length; index += 1) {
  const slide = presentation.slides.getItem(index);
  const padded = String(index + 1).padStart(2, "0");
  const png = await presentation.export({ slide, format: "png", scale: 1.5 });
  await fs.writeFile(`${renderDir}/slide-${padded}.png`, Buffer.from(await png.arrayBuffer()));
  const layout = await presentation.export({ slide, format: "layout" });
  await fs.writeFile(`${layoutDir}/slide-${padded}.layout.json`, Buffer.from(await layout.arrayBuffer()));
}

const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile(`${workspace}final-montage.webp`, Buffer.from(await montage.arrayBuffer()));

const inspect = await presentation.inspect({
  kind: "slide,textbox,image,notes",
  include: "id,slide,name,title,text,textPreview,textChars,textLines,bbox,alt",
  maxChars: 240000,
});
await fs.writeFile(`${workspace}final-inspect.ndjson`, inspect.ndjson || "", "utf8");

console.log(JSON.stringify({ finalPath, slides: presentation.slides.items.length }));
