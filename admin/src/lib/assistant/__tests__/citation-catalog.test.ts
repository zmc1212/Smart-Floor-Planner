import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCitationCatalog, sourceCitationCatalog, resolveCatalogCitation, engineeringClaimText } from '../agent/citation-catalog';
import { knowledgeSynthesisSources, parseSynthesis, focusedSynthesisMessages, type SynthesisSource } from '../agent/synthesis';
import { finalToolForMessages } from '../agent/worker';
import type { ModelMessage } from '../contracts/model';

const source = (text: string, sourceId = 'K1', title = '施工指南2.0'): SynthesisSource => ({ sourceId, kind: 'knowledge', title, text });
const answer = (s: SynthesisSource, text: string, basis = 'evidence') => JSON.stringify({ kind: 'synthesis',
  segments: [{ basis, text, citations: [{ citationId: sourceCitationCatalog(s)[0].citationId }] }] });

test('one catalog protocol resolves exact original Unicode/spacing without model-written quotes or length modes', () => {
  const s = source('原句：间距不小于 310 mm；条件成立才适用。😀');
  const options = sourceCitationCatalog(s);
  assert.equal(options.length, 1); assert.deepEqual(modelCitationCatalog(s), [{ citationId: options[0].citationId }]);
  const result = parseSynthesis(answer(s, '适用条件成立时，间距要求不小于310mm。'), [s]);
  assert.deepEqual(result.segments[0].citations, [{ sourceId: s.sourceId, quote: s.text }]);
  assert.throws(() => parseSynthesis(JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '需核对间距。',
    citations: [{ sourceId: s.sourceId, quote: s.text.replace('310 mm', '310mm') }] }] }), [s]), /invalid_model_citation/);
});

test('long project originals retain complete text and late clauses beyond the former eight-hint cutoff', () => {
  const s: SynthesisSource = { ...source(Array.from({ length: 20 }, (_, i) => `合成已发布观察第${i}条：资料仍需核对，不能当作正式结果。`).join('\n'), 'Bscope'), kind: 'project' };
  const all = sourceCitationCatalog(s); assert.ok(all.length>1&&all.length<20,'Adjacent complete lines share bounded chunks rather than duplicate per-line catalog overhead');
  const hints=modelCitationCatalog(s);
  assert.equal(hints.length,all.length);
  assert.deepEqual(hints.map(c => c.range), all.map(c => [c.start, c.end]));
  assert.ok(hints.every(c=>!('quote' in c)&&(!c.hint||Array.from(c.hint).length<=25)));
  assert.ok(Buffer.byteLength(JSON.stringify(hints))<Buffer.byteLength(s.text),'Reference catalog must not duplicate the long status original in per-line hints');
  const last = all.at(-1)!;
  assert.deepEqual(resolveCatalogCitation({ citationId: last.citationId }, [s]), { sourceId: s.sourceId, quote: last.quote });
  assert.ok(last.quote.includes(s.text.split('\n')[19]),'Late original clauses remain citable');
  assert.equal(all.map(c=>c.quote).join('\n'),s.text,'Grouping preserves every original line and condition exactly');
  assert.equal(s.text.split('\n').length, 20);
  for (const item of all) { assert.equal(s.text.slice(item.start, item.end), item.quote); assert.ok(item.quote.length<=400); }
});

test('a presentation filename and resolved document title share quote identity while metadata stays separate', () => {
  const displayed=source('先核对适用条件，再解释原件要求。','Ktitle','文件名3.2.pdf');
  const resolved={...displayed,title:'负责人核对的资料名称3.2'};
  const id=sourceCitationCatalog(displayed)[0].citationId;
  assert.deepEqual(resolveCatalogCitation({citationId:id},[resolved]),{sourceId:resolved.sourceId,quote:resolved.text});
  assert.match(engineeringClaimText('未知文件9.1要求直接执行。',[resolved]),/9\.1/);
});

test('foreign, stale, ambiguous and mixed-format references cannot become authorized quotes', () => {
  const s = source('仅本企业有效的完整原文。'), id = sourceCitationCatalog(s)[0].citationId;
  for (const citation of [{ citationId: 'foreign' }, { citationId: id, quote: s.text }, { citationId: id, sourceId: s.sourceId }, { citationId: null }])
    assert.throws(() => resolveCatalogCitation(citation, [s]), /invalid_model_citation/);
  assert.throws(() => resolveCatalogCitation({ citationId: id }, [{ ...s, text: '原件已更改的新版本。' }]), /invalid_model_citation/);
  assert.throws(() => resolveCatalogCitation({ citationId: id }, [s, s]), /invalid_model_citation/);
  assert.throws(() => resolveCatalogCitation({ citationId: id }, [{ ...s, sourceId: 'K-other-enterprise' }]), /invalid_model_citation/);
});

test('catalogs do not clip oversized clauses or separate a table row from required context', () => {
  assert.deepEqual(sourceCitationCatalog(source('长'.repeat(450))), []);
  const s = source('首条完整条件。' + '长'.repeat(450) + '；最后这条仍然完整。');
  const all = sourceCitationCatalog(s); assert.equal(all.length, 2); assert.equal(all[0].quote, '首条完整条件。');
  const table = { ...s, evidence: { file: { kind: 'table_row' } } } as SynthesisSource;
  assert.deepEqual(sourceCitationCatalog(table), []);
});

test('only trusted cited document-name versions are metadata; quantities and bare numbers remain claims', () => {
  const s = source('施工前须核对适用条件。', 'Kmeta', '外部参考 · 设备安装指南3.2 · 开发测试');
  assert.doesNotMatch(engineeringClaimText('这份安装指南3.2要求先核对条件。', [s]), /3\.2/);
  assert.match(engineeringClaimText('安装指南3.2mm可以作为厚度。', [s]), /3\.2/);
  assert.match(engineeringClaimText('安装指南3.2要求先核对条件。', []), /3\.2/);
  assert.match(engineeringClaimText('厚度是3.2。', [s]), /3\.2/);
  assert.match(engineeringClaimText('未知指南4.1要求先核对条件。', [s]), /4\.1/);
  const parameter = source('需核对材料。', 'Kparameter', '厚度3.2mm参数表');
  assert.match(engineeringClaimText('厚度3.2mm可以执行。', [parameter]), /3\.2/);
  for(const [title,claim] of [['厚度3.2 mm参数表','厚度3.2可直接施工。'],['厚度3.2 毫米参数表','厚度3.2可直接施工。'],['成本3.2 元预算表','成本3.2可直接执行。']]){
    const quantity=source('施工前须核对材料参数。','Kquantity',title);
    assert.match(engineeringClaimText(claim,[quantity]),/3\.2/,'A quantity in trusted metadata cannot be retyped as a document edition');
    assert.throws(()=>parseSynthesis(answer(quantity,claim),[quantity]),/unsupported_model_commitment/);
  }
  for(const format of ['pdf','docx','xlsx']){
    const named=source('施工前须核对适用条件。','Knamed','设备安装指南3.2.'+format);
    assert.doesNotThrow(()=>parseSynthesis(answer(named,'安装指南3.2要求先核对适用条件。'),[named]),'Verified document extensions do not turn an edition into a quantity');
  }
  assert.doesNotThrow(() => parseSynthesis(answer(s, '安装指南3.2明确先核对适用条件。'), [s]));
  assert.throws(() => parseSynthesis(answer(s, '安装指南3.2mm可以作为厚度。'), [s]), /unsupported_model_commitment/);
  assert.throws(() => parseSynthesis(answer(s, '按安装指南3.2，厚度可以用3.2mm。'), [s]), /unsupported_model_commitment/);
});

test('catalog selection cannot license arithmetic, changed thresholds or formal completion', () => {
  const s = source('原件要求310mm，现场记录210mm；保留适用前提。');
  for (const text of ['可调整100mm。', '要求可以改成410mm。', '已经验收通过。'])
    assert.throws(() => parseSynthesis(answer(s, text), [s]), /unsupported_model_commitment/);
});

test('trusted edition layout spaces do not become engineering claims or license a quantity', () => {
  for (const gap of ['', ' ', '  ', '\t', '\u3000', '\u00a0']) {
    for (const title of ['设备安装指南3.2', '设备安装指南 3.2']) {
      const s = source('安装前须核对适用条件。', 'Klayout', title);
      const before = JSON.stringify(s);
      assert.doesNotThrow(() => parseSynthesis(answer(s, '安装指南' + gap + '3.2要求先核对条件。'), [s]));
      for (const suffix of ['mm', ' mm', '毫米', ' 元', '小时'])
        assert.throws(() => parseSynthesis(answer(s, '安装指南' + gap + '3.2' + suffix + '可以执行。'), [s]), /unsupported_model_commitment/);
      assert.equal(JSON.stringify(s), before);
    }
  }
  const s = source('安装前须核对适用条件。');
  assert.match(engineeringClaimText('指南\n2.0要求执行。', [s]), /2\.0/);
  assert.match(engineeringClaimText('指南 2. 0要求执行。', [s]), /2\./);
  assert.match(engineeringClaimText('未知指南 9.1要求执行。', [s]), /9\.1/);
});

test('quoted verified filename metadata excludes its numeric prefix and extension edition without changing the original answer', () => {
  const filename = '03 金螳螂家施工工艺手册2.0.pdf';
  const s = { ...source('防水施工完毕保养48小时后进行蓄水试验，蓄水深度不小于20mm，蓄水时间不少于24小时。', 'Kfilename', '负责人核对的外部手册'),
    evidence: { file: { name: filename } } } as SynthesisSource;
  const text = '根据《' + filename + '》，防水施工完毕保养48小时后才进行蓄水试验，蓄水深度不小于20mm，时间不少于24小时。';
  const before = JSON.stringify(s), catalog = sourceCitationCatalog(s);
  assert.doesNotMatch(engineeringClaimText(text, [s]), /03|2\.0/);
  const parsed = parseSynthesis(answer(s, text), [s]);
  assert.equal(parsed.segments[0].text, text);
  assert.deepEqual(parsed.segments[0].citations, [{ sourceId: s.sourceId, quote: s.text }]);
  assert.deepEqual(sourceCitationCatalog(s), catalog); assert.equal(JSON.stringify(s), before);
});

test('exact quoted filenames support known formats, literal punctuation and paired quotation marks only', () => {
  for (const extension of ['pdf', 'DOCX', 'xlsx']) for (const [open, close] of [['《', '》'], ['“', '”'], ['"', '"'], ["'", "'"]]) {
    const filename = '03 设备[参考](复核)+3.2.' + extension, s = source('施工前须核对适用条件。', 'Kliteral', filename);
    assert.doesNotThrow(() => parseSynthesis(answer(s, open + filename + close + '明确施工前须核对适用条件。'), [s]));
    assert.match(engineeringClaimText(open + filename.replace('03 ', '04 ') + close + '要求执行。', [s]), /04/);
  }
});

test('filename metadata never licenses quantities outside the name or uncited, project, partial or altered names', () => {
  const filename = '03 设备安装指南3.2.pdf', s = source('施工前须核对适用条件。', 'Kfilename-guard', filename);
  for (const text of ['《' + filename + '》规定厚度3.2mm。', '《' + filename + '》规定必须等待48小时。', '《' + filename + '》预算03元。'])
    assert.throws(() => parseSynthesis(answer(s, text), [s]), /unsupported_model_commitment/);
  for (const text of [filename + '要求执行。', '《设备安装指南3.2.pdf》要求执行。', '《03 设备安装指南3.3.pdf》要求执行。', '《03\n设备安装指南3.2.pdf》要求执行。'])
    assert.match(engineeringClaimText(text, [s]), /03|3\.2|3\.3/);
  assert.match(engineeringClaimText('《' + filename + '》要求执行。', []), /03/);
  assert.match(engineeringClaimText('《' + filename + '》要求执行。', [{ ...s, kind: 'project' }]), /03/);
});

test('a verified filename remains metadata and cannot bypass formal completion or mutate source prose', () => {
  const s = source('施工前须核对适用条件。', 'Kfilename-action', '03 工艺3.2.pdf');
  const text = '《03 工艺3.2.pdf》说明已经验收通过。';
  assert.throws(() => parseSynthesis(answer(s, text), [s]), /unsupported_model_commitment/);
  assert.equal(s.text, '施工前须核对适用条件。');
});

test('model catalog/schema references only current sources, preserves full originals and public canonical reply shape', () => {
  const s = knowledgeSynthesisSources([{ ref: { id: '7' }, text: '原文：完整条件及 310 mm，😀不改空格。' } as never])[0];
  const messages: ModelMessage[] = [{ role: 'system', content: [{ type: 'text', text: '既有规则' }] },
    { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: '1', text: '请解释' }) }] },
    { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'search_knowledge', arguments: '{}' }] },
    { role: 'tool', callId: 'read', content: JSON.stringify({ synthesisSources: [s] }) }];
  const before = JSON.stringify(messages), view = focusedSynthesisMessages(messages, '1');
  const packet = JSON.parse(view.find(m => m.role === 'tool')!.content as string);
  assert.equal(packet.synthesisSources[0].text, s.text);
  assert.equal(packet.synthesisSources[0].fullTextCitable, undefined);
  assert.equal(packet.synthesisSources[0].citationQuotes, undefined);
  const id = packet.synthesisSources[0].citationOptions[0].citationId;
  const tool = finalToolForMessages(view); assert.match(JSON.stringify(tool), new RegExp(id));
  assert.doesNotMatch(JSON.stringify(tool), /quoteFromSource/); assert.equal(JSON.stringify(messages), before);
  const canonical = parseSynthesis(answer(s, '需按原件条件核对310mm。'), [s]);
  assert.doesNotMatch(JSON.stringify(canonical), /citationId/);
});
