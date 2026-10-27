/** Bounded synthetic Word outlines; never construction advice or customer data. */
import { syntheticDocxNotesEntries } from './assistant-docx-notes-fixture';
import { syntheticZip } from './assistant-file-fixtures';

export function syntheticDocxOutlineEntries() {
  const entries = syntheticDocxNotesEntries();
  // Word can apply an outline directly without a HeadingN style. Same source
  // text/notes/table as the earlier fixture, different authoritative structure.
  entries['word/document.xml'] = entries['word/document.xml']
    .replaceAll('<w:pStyle w:val="Heading1"/>', '<w:pStyle w:val="CustomTitle"/><w:outlineLvl w:val="0"/>')
    .replaceAll('<w:pStyle w:val="Heading2"/>', '<w:outlineLvl w:val="1"/>');
  return entries;
}
export function syntheticDocxOutline() { return syntheticZip(syntheticDocxOutlineEntries()); }
