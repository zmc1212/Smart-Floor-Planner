import { fromMarkdown } from 'mdast-util-from-markdown';

const headingPattern = /^(第[一二三四五六七八九十百零〇两\d]+)([篇章节])[\s　：:、]+(.+)$/u;
const headingLevels = { 篇: 1, 章: 2, 节: 3 };
export function chapterLevel(text) {
  return headingLevels[headingPattern.exec(text)?.[2]] ?? 0;
}

function columns(line) {
  return line.trim().replace(/^\||(?<!\\)\|$/g, '').split(/(?<!\\)\|/u).map(cell => cell.trim());
}

export function parseText(bytes, format) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) throw new Error('knowledge_file_invalid');
  const lines = text.split(/\r\n|\n|\r/u);
  const blocks = [], headings = [];
  let title, table = 0;
  const push = (kind, value, line, endLine, extra = {}) => {
    if (blocks.length >= 128 || value.length > 6000) throw new Error('knowledge_file_block_limit');
    blocks.push({ id: 'b' + (blocks.length + 1), kind, text: value, section: headings.map(heading => heading.title), line, endLine, ...extra });
  };
  const heading = (value, level, line, endLine) => {
    while (headings.length && headings.at(-1).level >= level) headings.pop();
    headings.push({ title: value, level });
    if (!title && level === 1 && value.length <= 200) title = value;
    push('heading', value, line, endLine);
  };
  if (format === 'md') {
    const nodes = fromMarkdown(text).children;
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index], { start } = node.position;
      let { end } = node.position;
      const next = nodes[index + 1];
      if (node.type === 'paragraph' && next?.type === 'list' && /[:：]$/u.test(text.slice(start.offset, end.offset).trim())) {
        end = next.position.end;
        index++;
      }
      const value = text.slice(start.offset, end.offset).trim();
      if (node.type === 'heading') {
        const first = lines[start.line - 1].trim();
        const label = first.replace(/^#{1,6}\s+|\s+#+\s*$/gu, '').trim();
        if (label) heading(label, node.depth, start.line, end.line);
        continue;
      }
      const rows = lines.slice(start.line - 1, end.line);
      if (node.type === 'paragraph' && rows[0].includes('|') && rows[1]?.includes('|')
        && columns(rows[1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
        const headers = columns(rows[0]);
        if (headers.length !== columns(rows[1]).length || headers.length > 12) throw new Error('knowledge_file_complex_table');
        table++;
        for (const [index, row] of rows.entries()) {
          if (index === 1) continue;
          const cells = columns(row);
          if (cells.length !== headers.length) throw new Error('knowledge_file_complex_table');
          push('table_row', row.trim(), start.line + index, start.line + index, {
            table, row: index + 1, headers: [rows[0].trim()],
            cells: cells.map((text, column) => ({ text, column: column + 1, span: 1 })),
          });
        }
      } else if (value) push('paragraph', value, start.line, end.line);
    }
  } else {
    let start = 0;
    const paragraph = end => {
      if (end > start) {
        const value = lines.slice(start, end).join('\n').trim();
        if (value) push('paragraph', value, start + 1, end);
      }
    };
    for (const [index, line] of lines.entries()) {
      const value = line.trim(), level = chapterLevel(value);
      if (!value || level) {
        paragraph(index);
        if (level) heading(value, level, index + 1, index + 1);
        start = index + 1;
      }
    }
    paragraph(lines.length);
  }
  if (!blocks.some(block => block.kind !== 'heading')) throw new Error('knowledge_file_no_text');
  return { parser: 'xiaok-file-v1:' + format + ':structured-lines-v1', blocks, warnings: [], ...(title ? { title } : {}) };
}
