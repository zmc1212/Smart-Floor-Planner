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
export function syntheticPdf(empty=false,pages=1) {
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids:string[]=[];
  for(let page=1;page<=pages;page++) {
    const id=objects.length+1;kids.push(`${id} 0 R`);
    const text=empty?'q 10 0 0 10 0 0 cm Q':`BT /F1 12 Tf 40 750 Td (SYNTHETIC KB2 - page ${page}) Tj 0 -22 Td (Waterproofing checks are arranged by the project team.) Tj 0 -22 Td (A stage label does not prove inspection passed.) Tj ET`;
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
