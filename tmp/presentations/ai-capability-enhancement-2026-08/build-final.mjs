import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, PresentationFile } from '@oai/artifact-tool';

const tmp = 'C:/Users/Administrator/CodexTmp/ai-capability-enhancement-2026-08';
const root = 'G:/workspace/向总/Smart-Floor-Planner';
const assetDir = `${root}/design-references/presentation-ai-demo-2026-08`;
const finalPath = `${root}/output/pdf/家客来-客户演示稿-AI能力增强版-多模板与小程序对比-图片比例修正版-2026-08.pptx`;

const plan = JSON.parse(await fs.readFile(`${tmp}/template-frame-map.json`, 'utf8'));
const sourceRecords = (await fs.readFile(`${tmp}/full-inspect.ndjson`, 'utf8'))
  .trim().split(/\r?\n/).map(JSON.parse);

const presentation = await PresentationFile.importPptx(await FileBlob.load(`${tmp}/template-starter.pptx`));
const starterInspect = await presentation.inspect({ kind: 'slide,textbox,shape,image,notes', maxChars: 180000 });
const starterNdjson = typeof starterInspect === 'string' ? starterInspect : starterInspect.ndjson;
const starterRecords = starterNdjson.trim().split(/\r?\n/).map(JSON.parse);
const sourceById = new Map(sourceRecords.map((record) => [record.id, record]));
const starterText = (slide, text) => starterRecords.filter((record) => record.slide === slide && record.kind === 'textbox' && record.text === text);
const starterImages = (slide) => starterRecords.filter((record) => record.slide === slide && record.kind === 'image');
const sourceImages = (slide) => sourceRecords.filter((record) => record.slide === slide && record.kind === 'image');
const usedTextIds = new Set();

for (const entry of plan.outputSlides) {
  for (const target of entry.editTargets) {
    const sourceRecord = sourceById.get(target.shapeId);
    if (!sourceRecord) throw new Error(`Unknown source target ${target.shapeId}`);
    if (target.action === 'rewrite') {
      const candidates = starterText(entry.outputSlide, target.oldText).filter((record) => !usedTextIds.has(record.id));
      if (candidates.length !== 1) throw new Error(`Rewrite target ${entry.outputSlide}/${target.oldText}: ${candidates.length}`);
      const shape = presentation.resolve(candidates[0].id);
      shape.text = target.newText;
      usedTextIds.add(candidates[0].id);
    } else if (target.action === 'replace') {
      const sourceIndex = sourceImages(entry.sourceSlide).findIndex((record) => record.id === target.shapeId);
      const starterRecord = starterImages(entry.outputSlide)[sourceIndex];
      if (sourceIndex < 0 || !starterRecord) throw new Error(`Image target ${entry.outputSlide}/${target.shapeId}`);
      const image = presentation.resolve(starterRecord.id);
      const oldFrame = image.frame;
      const oldCrop = image.crop;
      const oldFit = image.fit;
      const oldAlt = image.alt;
      const oldPrompt = image.prompt;
      const oldGeometry = image.geometry;
      const oldBorderRadius = image.borderRadius;
      const oldRotation = image.rotation;
      const oldFlipHorizontal = image.flipHorizontal;
      const oldFlipVertical = image.flipVertical;
      const oldLockAspectRatio = image.lockAspectRatio;
      const assetName = entry.outputSlide >= 9 && entry.outputSlide <= 12
        ? target.asset.replace(/^portrait-/, '')
        : target.asset;
      const assetPath = path.join(assetDir, assetName);
      const bytes = await fs.readFile(assetPath);
      const ext = path.extname(assetPath).toLowerCase();
      const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
      image.replace({
        blob: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        contentType,
        alt: oldAlt || `AI 演示素材：${assetName}`,
        ...(oldFit ? { fit: oldFit } : {}),
        ...(oldPrompt ? { prompt: oldPrompt } : {}),
      });
      image.frame = oldFrame;
      image.fit = 'cover';
      image.crop = undefined;
      image.geometry = oldGeometry;
      image.borderRadius = oldBorderRadius;
      image.rotation = oldRotation;
      image.flipHorizontal = oldFlipHorizontal;
      image.flipVertical = oldFlipVertical;
      image.lockAspectRatio = oldLockAspectRatio;
    }
  }
}

// Slides 9-12 inherited narrow mobile-screenshot frames, while the new AI
// examples are predominantly 16:9 or 4:3. Reuse the inherited card system but
// convert its media zone to a wider, shallower frame and show every image at
// its native aspect ratio without stretching or aggressive vertical cropping.
for (const slideNumber of [9, 10, 11, 12]) {
  const images = starterRecords.filter((record) => record.slide === slideNumber && record.kind === 'image');
  const cardXs = slideNumber === 9 ? [58, 360] : [58, 360, 662];
  const imageXs = slideNumber === 9 ? [70, 372] : [70, 372, 674];
  const cards = starterRecords.filter((record) =>
    record.slide === slideNumber &&
    record.kind === 'shape' &&
    cardXs.includes(Math.round(record.bbox?.[0] ?? -1)) &&
    Math.round(record.bbox?.[1] ?? -1) === 205 &&
    Math.round(record.bbox?.[2] ?? -1) === 274
  );
  const pills = starterRecords.filter((record) =>
    record.slide === slideNumber &&
    record.kind === 'shape' &&
    [66, 368, 670].includes(Math.round(record.bbox?.[0] ?? -1)) &&
    Math.round(record.bbox?.[1] ?? -1) === 597
  );
  const captions = starterRecords.filter((record) =>
    record.slide === slideNumber &&
    record.kind === 'textbox' &&
    [78, 380, 682].includes(Math.round(record.bbox?.[0] ?? -1)) &&
    Math.round(record.bbox?.[1] ?? -1) === 604
  );

  cards.forEach((record) => {
    const shape = presentation.resolve(record.id);
    shape.zIndex = 0;
  });
  images.forEach((record, index) => {
    if (index >= imageXs.length) return;
    const image = presentation.resolve(record.id);
    image.frame = { left: imageXs[index], top: 245, width: 250, height: 245 };
    image.fit = 'contain';
    image.crop = undefined;
    image.lockAspectRatio = false;
    image.zIndex = 20;
  });
  pills.forEach((record) => {
    const shape = presentation.resolve(record.id);
    shape.frame = { ...shape.frame, top: 507 };
  });
  captions.forEach((record) => {
    const shape = presentation.resolve(record.id);
    shape.frame = { ...shape.frame, top: 514 };
  });
}

const notesBySlide = new Map([
  [9, '[Sources]\n- Internal PostgreSQL AI prompt library active revision 17 (published 2026-08-01): 960 enabled templates; examples include IDs 906, 420, 642, 930, and 618.\n- Preview imagery from the same internal prompt-template records.'],
  [10, '[Sources]\n- OpenAI built-in image generation, same-space home-renovation demo set: empty room, modern cream, modern French, modern Chinese.\n- AI-generated demonstration effects; not live Mini Program screenshots.'],
  [11, '[Sources]\n- OpenAI built-in image generation, local material replacement demo.\n- Internal prompt-template preview ID 618 (living-room soft-furnishing analysis).\n- AI-generated demonstration effects; not live runtime screenshots.'],
  [12, '[Sources]\n- Internal PostgreSQL AI prompt library active revision 17 (published 2026-08-01), 960 enabled templates.\n- Shown template previews: ID 906 modern cream rough-home renovation; ID 893 French rough-home renovation; ID 642 floor-plan renovation analysis.'],
  [14, '[Sources]\n- Approved Mini Program design source: design-references/all-pages-ip-v3/15-ai-design-result-v3.png.\n- Result-stage imagery generated with OpenAI built-in image generation for modern cream, modern French, and modern Chinese comparisons.\n- Composite design demonstration; not a live runtime screenshot.'],
  [15, '[Sources]\n- Internal PostgreSQL prompt library active revision 17 and template previews.\n- OpenAI built-in image generation: before/after style and material-replacement examples.\n- AI-generated demonstration effects; not live runtime screenshots.'],
]);
for (const [slideNumber, note] of notesBySlide) {
  const slide = presentation.slides.getItem(slideNumber - 1);
  slide.speakerNotes.textFrame.setText(note);
  slide.speakerNotes.setVisible(true);
}

// The inherited slide-13 title and subtitle boxes are shorter than the revised copy.
// Keep the original typography and move only the subtitle below the two-line title.
const slide15Text = starterRecords.filter((record) => record.slide === 15 && record.kind === 'textbox');
const slide15TitleRecord = slide15Text.find((record) => record.bbox?.[1] === 72 && record.bbox?.[3] === 62);
const slide15SubtitleRecord = slide15Text.find((record) => record.bbox?.[1] === 142 && record.bbox?.[3] === 44);
if (slide15TitleRecord && slide15SubtitleRecord) {
  const title = presentation.resolve(slide15TitleRecord.id);
  const subtitle = presentation.resolve(slide15SubtitleRecord.id);
  title.frame = { ...title.frame, height: 132 };
  subtitle.frame = { ...subtitle.frame, top: 178, height: 42 };
  subtitle.text.fontSize = 22;
}

// Remove a stale small callout line on the Mini Program comparison slide and
// surface the status disclaimer as a single high-contrast note below the card.
const slide14Text = starterRecords.filter((record) => record.slide === 14 && record.kind === 'textbox');
const statusBody14 = slide14Text.find((record) => record.bbox?.[0] === 1032 && record.bbox?.[1] === 490);
if (statusBody14) presentation.resolve(statusBody14.id).text = '批准设计稿 + AI 演示效果\n非真实运行截图';

await fs.mkdir(path.dirname(finalPath), { recursive: true });
const file = await PresentationFile.exportPptx(presentation);
await file.save(finalPath);

const renderDir = `${tmp}/final-renders`;
const layoutDir = `${tmp}/final-layout`;
await fs.mkdir(renderDir, { recursive: true });
await fs.mkdir(layoutDir, { recursive: true });
for (let index = 0; index < presentation.slides.items.length; index += 1) {
  const slide = presentation.slides.getItem(index);
  const padded = String(index + 1).padStart(2, '0');
  const png = await presentation.export({ slide, format: 'png', scale: 1.5 });
  await fs.writeFile(`${renderDir}/slide-${padded}.png`, Buffer.from(await png.arrayBuffer()));
  const layout = await presentation.export({ slide, format: 'layout' });
  await fs.writeFile(`${layoutDir}/slide-${padded}.layout.json`, Buffer.from(await layout.arrayBuffer()));
}
const inspect = await presentation.inspect({ kind: 'slide,textbox,image,notes', maxChars: 150000 });
await fs.writeFile(`${tmp}/final-inspect.ndjson`, typeof inspect === 'string' ? inspect : inspect.ndjson, 'utf8');
console.log(finalPath);
