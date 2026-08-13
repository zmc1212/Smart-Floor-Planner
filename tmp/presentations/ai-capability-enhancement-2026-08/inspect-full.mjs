import fs from 'node:fs/promises';
import { FileBlob, PresentationFile } from '@oai/artifact-tool';

const source = 'C:/Users/Administrator/CodexTmp/ai-capability-enhancement-2026-08/source.pptx';
const presentation = await PresentationFile.importPptx(await FileBlob.load(source));
const snapshot = await presentation.inspect({
  kind: 'slide,textbox,shape,image,table,chart,notes,thread,layout',
  include: 'id,slide,name,title,text,textPreview,textChars,textLines,bbox,bboxUnit,alt,prompt,isPlaceholder,placeholders',
  maxChars: 200000,
});
await fs.writeFile('C:/Users/Administrator/CodexTmp/ai-capability-enhancement-2026-08/full-inspect.ndjson', snapshot.ndjson, 'utf8');
console.log(JSON.stringify({ chars: snapshot.ndjson.length, slides: presentation.slides.items.length }));
