/** Clearly synthetic originals for KB-2. No real documents/customer material. */
import { deflateRawSync } from 'node:zlib';
import { crc32 } from 'node:zlib';

export function syntheticZip(entries: Record<string, string>) {
  const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
  for(const [name,text]of Object.entries(entries)) {
    const n=Buffer.from(name),data=Buffer.from(text),compressed=deflateRawSync(new Uint8Array(data)),crc=crc32(new Uint8Array(data)),head=Buffer.alloc(30),dir=Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(8,8);head.writeUInt32LE(crc,14);head.writeUInt32LE(compressed.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(n.length,26);
    dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt16LE(8,10);dir.writeUInt32LE(crc,16);dir.writeUInt32LE(compressed.length,20);dir.writeUInt32LE(data.length,24);dir.writeUInt16LE(n.length,28);dir.writeUInt32LE(offset,42);
    local.push(head,n,compressed);central.push(dir,n);offset+=head.length+n.length+compressed.length;
  }
  const directory=Buffer.concat(central.map(b=>new Uint8Array(b))),end=Buffer.alloc(22),count=Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end].map(b=>new Uint8Array(b)));
}
const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function syntheticDocx(options:{second?:boolean;unsafe?:boolean;image?:boolean}={}) {
  const p=(s:string,heading=false)=>`<w:p>${heading?'<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>':''}<w:r><w:t>${esc(s)}</w:t></w:r></w:p>`;
  const cell=(s:string,span=1)=>`<w:tc><w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>${p(s)}</w:tc>`;
  const row=(cells:string[],header=false)=>`<w:tr>${header?'<w:trPr><w:tblHeader/></w:trPr>':''}${cells.join('')}</w:tr>`;
  return syntheticZip({
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml':`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p('合成资料：铺贴材料核对',true)}${p('这是合成测试文件，数值仅用于验证原文引用，不是施工规范。')}${p('铺贴前由团队核对材料型号、适用基层和检查记录；资料缺失或说法不一致时先向负责人核实。')}
      <w:tbl>${row([cell('材料'),cell('核对要求',2)],true)}${row([cell('型号'),cell('示例厚度'),cell('前提与例外')],true)}${row([cell(options.second?'TEST-B':'TEST-A'),cell(options.second?'3 mm':'2 mm'),cell('仅合成定位数据。须先核对该型号厂家资料与实际基层；地暖场景不能直接套用。')])}</w:tbl>
      ${p('注：表中示例值不代表本项目检测结果，不据此确认验收。')}
      <w:p><w:r><w:t>核对原件后再讨论具体排版。😀</w:t><w:footnoteReference w:id="1"/></w:r>${options.image?'<w:r><w:drawing/></w:r>':''}</w:p><w:sectPr/></w:body></w:document>`,
    'word/footnotes.xml':'<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>合成脚注：由设计师和师傅核对，不形成正式方案决定。</w:t></w:r></w:p></w:footnote></w:footnotes>',
    ...(options.unsafe?{'../escape.xml':'forbidden'}:{}),
  });
}
export function syntheticPdf(empty=false,pages=1,lines?:string[]) {
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids:string[]=[];
  for(let page=1;page<=pages;page++) {
    const id=objects.length+1;kids.push(`${id} 0 R`);
    const text=empty?'q 10 0 0 10 0 0 cm Q':lines?`BT /F1 12 Tf 40 750 Td ${lines.map((s,i)=>`${i?'0 -16 Td ':''}(${s.replace(/[\\()]/g,'\\$&')}) Tj`).join(' ')} ET`:`BT /F1 12 Tf 40 750 Td (SYNTHETIC KB2 - page ${page}) Tj 0 -22 Td (Waterproofing checks are arranged by the project team.) Tj 0 -22 Td (A stage label does not prove inspection passed.) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id+1} 0 R >>`,`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
  }
  objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  let result='%PDF-1.7\n';const offsets=[0];
  for(const[i,o]of objects.entries()){offsets.push(Buffer.byteLength(result));result+=`${i+1} 0 obj\n${o}\nendobj\n`;}
  const at=Buffer.byteLength(result);result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  return Buffer.from(result);
}
export function syntheticChinesePdf() {
  const text='合成测试：防水施工和检查由团队安排。阶段标签不代表检查通过。';
  const hex=Array.from(text).map(c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
  const stream=`BT /F1 12 Tf 40 750 Td <${hex}> Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let result='%PDF-1.7\n';const offsets:number[]=[];for(const[i,o]of objects.entries()){offsets.push(Buffer.byteLength(result));result+=`${i+1} 0 obj\n${o}\nendobj\n`;}
  const at=Buffer.byteLength(result);result+=`xref\n0 7\n0000000000 65535 f \n${offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;return Buffer.from(result);
}

/** Minimal conventional OOXML, with real shared/inline strings, numeric cells and merges. */
export function syntheticXlsxEntries(second = false): Record<string,string> {
  const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const shared=['材料型号','合成示例厚度与单位','适用与例外','数值','单位','mm','仅合成定位数据。须先核对厂家资料与实际基层；地暖场景不能直接套用。','TEST-B','注：合成示例不是施工规范或本项目检测结果，不据此确认验收。😀'];
  const s=(ref:string,index:number)=>`<c r="${ref}" t="s"><v>${index}</v></c>`;
  return {
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="book" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="材料核对" sheetId="1" r:id="one"/><sheet name="检查安排" sheetId="2" r:id="two"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="one" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="two" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="strings" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    'xl/sharedStrings.xml':`<sst xmlns="${main}" count="11" uniqueCount="${shared.length}">${shared.map(t=>`<si><t>${esc(t)}</t></si>`).join('')}</sst>`,
    'xl/styles.xml':`<styleSheet xmlns="${main}"><cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" xfId="0"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="${main}"><sheetData><row r="1">${s('A1',0)}${s('B1',1)}${s('D1',2)}</row><row r="2">${s('B2',3)}${s('C2',4)}</row><row r="3"><c r="A3" t="inlineStr"><is><r><t>TEST-</t></r><r><t>${second?'B':'A'}</t></r><rPh sb="0" eb="4"><t>not-source</t></rPh></is></c><c r="B3"><v>${second?'3':'2'}</v></c>${s('C3',5)}${s('D3',6)}</row><row r="4">${s('A4',7)}<c r="B4"><v>3.5</v></c>${s('C4',5)}${s('D4',6)}</row><row r="5">${s('A5',8)}</row></sheetData><mergeCells count="4"><mergeCell ref="A1:A2"/><mergeCell ref="B1:C1"/><mergeCell ref="D1:D2"/><mergeCell ref="A5:D5"/></mergeCells></worksheet>`,
    'xl/worksheets/sheet2.xml':`<worksheet xmlns="${main}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>事项</t></is></c><c r="B1" t="inlineStr"><is><t>执行说明</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>防水检查</t></is></c><c r="B2" t="inlineStr"><is><t>合成资料：由获权团队按实际记录安排，阶段标签不证明检查通过。</t></is></c></row></sheetData></worksheet>`,
  };
}
export function syntheticXlsx(second = false) { return syntheticZip(syntheticXlsxEntries(second)); }

/** Display values differ intentionally from raw values; never a real policy. */
export function syntheticFormattedXlsxEntries(): Record<string,string> {
  const entries = syntheticXlsxEntries();
  entries['xl/styles.xml'] = entries['xl/styles.xml']
    .replace('<cellStyleXfs', '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00&quot; mm&quot;"/></numFmts><cellStyleXfs')
    .replace('<cellXfs count="1"><xf numFmtId="0" xfId="0"/></cellXfs>', '<cellXfs count="3"><xf numFmtId="0" xfId="0"/><xf numFmtId="10" xfId="0"/><xf numFmtId="164" xfId="0"/></cellXfs>');
  entries['xl/sharedStrings.xml'] = entries['xl/sharedStrings.xml']
    .replace('合成示例厚度与单位', '合成示例比例与用量').replace('>数值<', '>参考比例<').replace('>单位<', '>参考用量<');
  entries['xl/worksheets/sheet1.xml'] = entries['xl/worksheets/sheet1.xml']
    .replace('<c r="B3"><v>2</v></c>', '<c r="B3" s="1"><v>0.125</v></c>')
    .replace('<c r="C3" t="s"><v>5</v></c>', '<c r="C3" s="2"><v>2.345</v></c>')
    .replace('<c r="B4"><v>3.5</v></c>', '<c r="B4" s="1"><v>0.075</v></c>')
    .replace('<c r="C4" t="s"><v>5</v></c>', '<c r="C4" s="2"><v>3.1</v></c>');
  return entries;
}
export function syntheticFormattedXlsx() { return syntheticZip(syntheticFormattedXlsxEntries()); }

/** Explicit dates are labelled sample dates, never an actual project schedule. */
export function syntheticDateXlsxEntries(dateSystem: '1900' | '1904' = '1900', compact = false): Record<string,string> {
  const entries = syntheticXlsxEntries();
  entries['xl/workbook.xml'] = entries['xl/workbook.xml'].replace('<sheets>', `<workbookPr date1904="${dateSystem === '1904' ? '1' : '0'}"/><sheets>`);
  entries['xl/styles.xml'] = entries['xl/styles.xml']
    .replace('<cellStyleXfs', '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy&quot;年&quot;m&quot;月&quot;d&quot;日&quot;"/></numFmts><cellStyleXfs')
    .replace('<cellXfs count="1"><xf numFmtId="0" xfId="0"/></cellXfs>', '<cellXfs count="3"><xf numFmtId="0" xfId="0"/><xf numFmtId="164" xfId="0"/><xf numFmtId="165" xfId="0"/></cellXfs>');
  entries['xl/sharedStrings.xml'] = entries['xl/sharedStrings.xml']
    .replace('合成示例厚度与单位', '合成参考日期').replace('>数值<', '>参考日期一<').replace('>单位<', '>参考日期二<');
  const serial = dateSystem === '1904' ? 44852 : 46314; // 2026-10-19, 1,462 days apart.
  entries['xl/worksheets/sheet1.xml'] = entries['xl/worksheets/sheet1.xml']
    .replace('<c r="B3"><v>2</v></c>', `<c r="B3" s="1"><v>${serial}</v></c>`)
    .replace('<c r="C3" t="s"><v>5</v></c>', `<c r="C3" s="2"><v>${serial + 1}</v></c>`)
    .replace('<c r="B4"><v>3.5</v></c>', `<c r="B4" s="1"><v>${serial + 2}</v></c>`)
    .replace('<c r="C4" t="s"><v>5</v></c>', `<c r="C4" s="2"><v>${serial + 3}</v></c>`);
  if (compact) {
    // A separate two-row live-model case; broad merged/multi-sheet coverage
    // remains in the original fixture and service suite, not silently dropped.
    entries['xl/workbook.xml'] = entries['xl/workbook.xml'].replace(/<sheet name="检查安排"[^>]+\/>/, '');
    entries['xl/_rels/workbook.xml.rels'] = entries['xl/_rels/workbook.xml.rels'].replace(/<Relationship Id="two"[^>]+\/>/, '');
    entries['[Content_Types].xml'] = entries['[Content_Types].xml'].replace(/<Override PartName="\/xl\/worksheets\/sheet2.xml"[^>]+\/>/, '');
    delete entries['xl/worksheets/sheet2.xml'];
    const inline = (ref:string,text:string)=>`<c r="${ref}" t="inlineStr"><is><t>${esc(text)}</t></is></c>`;
    entries['xl/worksheets/sheet1.xml'] = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${inline('A1','合成材料')}${inline('B1','参考日期一')}${inline('C1','参考日期二')}${inline('D1','适用与例外')}</row><row r="3">${inline('A3','TEST-A')}<c r="B3" s="1"><v>${serial}</v></c><c r="C3" s="2"><v>${serial+1}</v></c>${inline('D3','合成示例日期，不代表项目安排或检查结果；地暖场景不能直接套用，须核对厂家资料与实际基层。')}</row></sheetData></worksheet>`;
  }
  return entries;
}
export function syntheticDateXlsx(dateSystem: '1900' | '1904' = '1900', compact = false) { return syntheticZip(syntheticDateXlsxEntries(dateSystem, compact)); }

/** Local reference clocks, never an actual appointment, duration or timezone. */
export function syntheticTimeXlsxEntries(dateSystem: '1900' | '1904' = '1900'): Record<string,string> {
  const entries = syntheticDateXlsxEntries(dateSystem);
  entries['xl/styles.xml'] = entries['xl/styles.xml']
    .replace('formatCode="yyyy-mm-dd"', 'formatCode="yyyy-mm-dd hh:mm:ss"')
    .replace('formatCode="yyyy&quot;年&quot;m&quot;月&quot;d&quot;日&quot;"', 'formatCode="hh:mm:ss"');
  entries['xl/sharedStrings.xml'] = entries['xl/sharedStrings.xml']
    .replace('合成参考日期', '合成参考时刻').replace('参考日期一', '参考日期时刻').replace('参考日期二', '参考时间');
  const serial = dateSystem === '1904' ? 44852 : 46314;
  entries['xl/worksheets/sheet1.xml'] = entries['xl/worksheets/sheet1.xml']
    .replace(`<v>${serial}</v>`, `<v>${serial}.395833333336</v>`)
    .replace(`<v>${serial + 1}</v>`, '<v>0.5625</v>')
    .replace(`<v>${serial + 2}</v>`, `<v>${serial + 2}.375</v>`)
    .replace(`<v>${serial + 3}</v>`, '<v>0.5</v>');
  return entries;
}
export function syntheticTimeXlsx(dateSystem: '1900' | '1904' = '1900') { return syntheticZip(syntheticTimeXlsxEntries(dateSystem)); }
