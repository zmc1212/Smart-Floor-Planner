import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { publicDocumentPages, publicOriginalRefinement, publicReaderParser, searchPublicResearch, validPublicDocument, type PublicReadDocument, type PublicResearchState } from '../agent/public-research';
import { webEvidence, webSynthesisSources } from '../agent/web-evidence';
import { ancestorSourceMessages } from '../agent/ancestor-sources';
import { assertToolPairs } from '../agent/context-budget';
import { agentToolsForTurn, finalToolForMessages } from '../agent/worker';
import { focusedSynthesisMessages } from '../agent/synthesis';
import { compileModelRequest } from '../agent/model-request';
import { consultationAcceptanceProfile } from '../contracts/consultation';
import { matchingReviewedStandard, publicStandardMetadata, reviewedPublicStandard, unverifiedStandardStatus } from '../web-search/standards';
import { knowledgeOriginalRequested } from '../agent/read-tool-input';
import { naturalKnowledgeInstructions } from '../agent/knowledge-explanation';
import type { ModelMessage } from '../contracts/model';
const query = { query: 'synthetic floor installation', domains: [] };
const document = (url: string, pdf = false): PublicReadDocument => {
  const bytes = Buffer.from(pdf ? '%PDF labelled synthetic fixture' : '<html>labelled synthetic fixture</html>');
  return { version: 1, url, title: 'Synthetic installation conditions', parser: publicReaderParser,
    mediaType: pdf ? 'application/pdf' : 'text/html', pages: [{ page: 1,
      text: 'The model must support the intended use. Even when the model supports it, actual site conditions must still be verified.' }],
    links: [], redirects: [], original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, base64: bytes.toString('base64') },
    egress: 'upstream-v0.9.2-resolve-and-pin-proxy', tlsVerification: true };
};

test('candidate discovery follows actual anchors to the original PDF without citing search snippets', async () => {
  const read: string[] = [];
  const snapshot = await searchPublicResearch(query, { name: 'synthetic', search: async () => [{ url: 'https://maker.example/', title: 'Synthetic manufacturer' }] }, async url => {
    read.push(url); const result = document(url, url.endsWith('.pdf'));
    if (read.length === 1) result.links = [{ url: 'https://maker.example/installation.pdf', title: 'Installation original PDF' }];
    return result;
  });
  assert.deepEqual(read, ['https://maker.example/', 'https://maker.example/installation.pdf']);
  assert.equal(snapshot.status, 'ready'); assert.equal(snapshot.pages.length, 1);
  assert.equal(snapshot.pages[0].document?.mediaType, 'application/pdf');
  assert.equal(snapshot.research?.navigation[1].parent, 'https://maker.example/');
  assert.equal(snapshot.documents?.length, 2); assert.equal(snapshot.pages[0].document?.page, 1);
  assert.equal('original' in webEvidence(snapshot, '99', 1200)[0].web!, false);
});

test('the consultation discovery result is separate from reading and uses only registered candidates', async () => {
  let reads=0;
  const provider={name:'synthetic',search:async()=>[{url:'https://maker.example/',title:'Synthetic manufacturer'}]};
  const discovered=await searchPublicResearch(query,provider,async url=>{reads++;return document(url);},undefined,Infinity,{runId:'99',sequence:1200,discoverOnly:true});
  assert.equal(reads,0);assert.deepEqual(discovered.pages,[]);assert.equal(discovered.candidates![0].id,'P99:1200:0');
  const selected=discovered.candidates![0];
  const read=await searchPublicResearch(query,{name:'synthetic',search:async()=>{throw Error('No repeated discovery');}},async url=>{reads++;return document(url);},discovered.research,Infinity,{runId:'99',sequence:1210,selected});
  assert.equal(reads,1);assert.equal(read.research!.queries.length,2);assert.equal(read.research!.reads,1);assert.equal(read.pages[0].url,selected.url);
  assert.deepEqual(read.research!.queries.map(query=>query.query),['synthetic floor installation','synthetic floor 官网']);
});

test('six reads, depth three, three queries and the shared task deadline are hard bounds', async () => {
  let reads = 0;
  const run = () => searchPublicResearch(query, { name: 'synthetic', search: async () => Array.from({ length: 8 },(_,i)=>({ url: 'https://maker.example/'+i, title: 'Install' })) }, async url => {
    reads++; const result = document(url); result.links = [{ url: url+'/install', title: 'Installation' }]; return result;
  });
  const result = await run(); assert.equal(reads, 6); assert.ok(result.research!.navigation.every(item => item.depth <= 3));
  const prior: PublicResearchState = { ...result.research!, reads: 0, queries: [query,query,query] };
  const blocked = await searchPublicResearch(query, { name: 'synthetic', search: async () => { throw Error('Must not search'); } }, async () => { throw Error('Must not read'); }, prior);
  assert.equal(blocked.failures[0].code, 'web_research_limit');
  const stale = await searchPublicResearch(query, { name: 'synthetic', search: async () => [] }, undefined,
    { ...prior, queries: [], startedAt: new Date(Date.now()-60001).toISOString() });
  assert.equal(stale.failures[0].code, 'web_research_limit');
});

test('a public title may refine an original search; actual directory candidates replace its old aggregator frontier without authority promotion',async()=>{
  const original={query:'合成品牌 地暖 官方说明',domains:[]},providerCalls:string[]=[],readUrls:string[]=[];
  const aggregator={url:'https://directory.example/brand',title:'合成品牌ACME FLOOR品牌介绍'};
  const refined=publicOriginalRefinement(original,[aggregator]);assert.equal(refined?.query.query,'ACME FLOOR 官网');
  assert.equal(publicOriginalRefinement({query:'一般保养建议',domains:[]},[aggregator]),null);
  assert.equal(publicOriginalRefinement(original,[{...aggregator,url:'http://127.0.0.1/secret'}]),null);
  assert.equal(publicOriginalRefinement(original,[{...aggregator,title:'PDF HTML 文档'}]),null);
  const discovered=await searchPublicResearch(original,{name:'synthetic',search:async q=>{providerCalls.push(q.query);return providerCalls.length===1?[aggregator]:[
    {url:'https://maker.example/',title:'ACME FLOOR flooring'}, {url:'https://maker.example/install',title:'ACME FLOOR installation'}];}},undefined,undefined,Infinity,{runId:'99',sequence:1200,discoverOnly:true});
  assert.deepEqual(providerCalls,[original.query,'ACME FLOOR 官网']);assert.equal(discovered.research!.queries.length,2);
  assert.equal(discovered.research!.discoveries!.length,2);assert.deepEqual(discovered.research!.discoveries![0].candidates,[aggregator]);
  assert.deepEqual(discovered.pages,[]);assert.ok(discovered.candidates!.every(c=>new URL(c.url).hostname==='maker.example'));
  const read=await searchPublicResearch(original,null,async url=>{readUrls.push(url);const d=document(url,url.endsWith('.pdf'));
    if(!url.endsWith('.pdf'))d.links=[{url:'https://maker.example/floor-heating.pdf',title:'Underfloor heating original PDF'}];return d;
  },discovered.research,Infinity,{runId:'99',sequence:1210,selected:discovered.candidates![0],alternatives:discovered.candidates});
  assert.deepEqual(readUrls,['https://maker.example/','https://maker.example/floor-heating.pdf']);
  assert.equal(read.pages[0].document!.mediaType,'application/pdf');assert.equal(read.research!.reads,2);
  assert.equal(read.research!.refinements![0].from.title,aggregator.title);assert.equal('authority' in read.pages[0],false);
  const exhausted={...discovered.research!,queries:[original,original,original],reads:0};let extraCalls=0;
  const denied=await searchPublicResearch(original,{name:'synthetic',search:async()=>{extraCalls++;return[];}},undefined,exhausted,Infinity,{runId:'99',sequence:1220,discoverOnly:true});
  assert.equal(extraCalls,0);assert.equal(denied.failures[0].code,'web_research_limit');
});

test('actual CMS document links outrank repeated topic pages; content type is decided by verified bytes rather than the URL suffix',async()=>{
  const read:string[]=[],cms='https://cdn.example/assets/floorheating-instructionspdf.ashx?revision=original';
  const selected={id:'P99:1200:0',url:'https://maker.example/',title:'Synthetic flooring',parent:null,depth:0};
  const menu=Array.from({length:95},(_,i)=>({url:'https://maker.example/floor/'+i,title:'Floor product '+i}));
  const topic='https://maker.example/underfloor-heating';
  const snapshot=await searchPublicResearch({query:'合成地板 地暖 官方说明',domains:[]},null,async url=>{
    read.push(url);const d=document(url,url===cms);
    if(url===selected.url)d.links=[...menu,{url:topic,title:'Underfloor heating'}];
    if(url===topic)d.links=[...menu.slice(0,80),{url:topic+'/faq',title:'Discover more'},
      {url:cms,title:'specific guidelines'}];return d;
  },undefined,Infinity,{runId:'99',sequence:1210,selected});
  assert.deepEqual(read,[selected.url,topic,cms]);assert.equal(snapshot.pages[0].document!.mediaType,'application/pdf');
  assert.equal(snapshot.documents![1].original.base64,document(cms,true).original.base64);
});

test('original discovery prioritizes actual technical-purpose routes over unrelated PDF brochures and retains complete short PDF pages',async()=>{
  const reads:string[]=[],selected={id:'P99:1200:0',url:'https://local-maker.example/',title:'Synthetic manufacturer',parent:null,depth:0};
  const directory={...selected,id:'P99:1200:1',url:'https://global-maker.example/',title:'Manufacturer flooring directory'};
  const topic=directory.url+'underfloor-heating',manual='https://cdn.example/floorheating_instructionspdf.ashx';
  const originalQuery={query:'合成地板 地暖 官方说明',domains:[]};
  const snapshot=await searchPublicResearch(originalQuery,null,async url=>{
    reads.push(url);const d=document(url,url===manual||url.endsWith('.pdf'));
    if(url===selected.url)d.links=Array.from({length:20},(_,i)=>({url:selected.url+'brochure-'+i+'.pdf',title:'Product brochure '+i}));
    if(url===directory.url)d.links=[{url:topic,title:'Underfloor heating'}];
    if(url===topic)d.links=[{url:manual,title:'Specific installation instructions'}];
    if(url===manual)d.pages=[d.pages[0],{page:2,text:'条件：含水率仍须核对。'},{page:3,text:''}];
    return d;
  },undefined,Infinity,{runId:'99',sequence:1210,selected,alternatives:[selected,directory]});
  assert.deepEqual(reads,[selected.url,directory.url,topic,manual]);
  assert.equal(snapshot.pages.length,2);assert.equal(snapshot.pages[1].text,'条件：含水率仍须核对。');
  assert.equal(snapshot.documents!.find(item => item.url === manual)?.pages[2].text, '');
  assert.equal(snapshot.research!.selection!.technicalHint,true);assert.ok(snapshot.pages.every(p=>p.url===manual));
});

test('scanned pages are retained privately and an OCR-only attachment produces no evidence', async () => {
  const scanned = { ...document('https://maker.example/scan.pdf', true), parseError: 'pdf_ocr_required',
    pages: [{ page: 1, text: '', status: 'ocr_required' as const }] };
  const result = await searchPublicResearch(query, { name: 'synthetic', search: async () => [scanned] }, async () => scanned);
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.failures, [{ url: scanned.url, code: 'pdf_ocr_required', pages: [1] }]);
  assert.deepEqual(webEvidence(result, '99', 1200), []);
  assert.equal(result.documents?.[0].original.sha256, scanned.original.sha256);
});

test('an approval notice proves its date and limited withdrawals while status needs a current edition record', () => {
  const url = 'https://www.mohurd.gov.cn/example';
  const title = '住房和城乡建设部关于发布国家标准《合成防水规范》的公告';
  const original = '现批准《合成防水规范》为国家标准，编号为GB55000-2022，自2023年4月1日起实施。同时废止下列工程建设标准相关强制性条文：\n《旧防水规范》JGJ298-2013第4.1.2条。';
  const notice = publicStandardMetadata(url, title, original)!;
  assert.deepEqual([notice.kind, notice.effectiveAt, notice.status], ['publication_notice', '2023-04-01', 'unknown']);
  assert.equal(unverifiedStandardStatus('GB 55000-2022 仍有效。', [{ standard: notice, quote: original }], [notice]), true);
  assert.equal(unverifiedStandardStatus('GB 55000-2022 仍有效。', [], []), true);
  assert.equal(unverifiedStandardStatus('公告载明，现行工程建设标准中有关规定与本规范不一致的，以本规范的规定为准。', [{ standard: notice, quote: original }], [notice]), false);
  assert.equal(unverifiedStandardStatus('目前无法确认是否仍有效。', [], [notice]), false);
  assert.equal(unverifiedStandardStatus('这两处来源都未显示该规范已被废止或替代。', [], [notice]), false);
  assert.equal(unverifiedStandardStatus('JGJ 298-2013 整部已废止。', [{ standard: notice, quote: original }], [notice]), true);
  assert.equal(unverifiedStandardStatus('JGJ 298-2013 第4.1.2条已废止。', [{ standard: notice, quote: original }], [notice]), false);
  const catalog = { ...notice, kind: 'status_catalog' as const, status: 'current' as const };
  assert.equal(unverifiedStandardStatus('GB55000-2022 目前有效。', [{ standard: catalog, quote: 'GB55000-2022 现行' }], [catalog]), false);
  assert.equal(unverifiedStandardStatus('GB55000-2022 目前有效。', [{ standard: catalog, quote: 'GB55000-2022 现行' }],
    [catalog, { ...catalog, status: 'withdrawn' }]), true);
});

test('the public edition uses the public source path while company-only questions retain enterprise retrieval', () => {
  const q = '《建筑与市政工程防水通用规范》目前是否有效，什么时候实施？';
  const selected = matchingReviewedStandard(q, []);
  assert.equal(selected?.standard.id, 'GB55030-2022');
  assert.equal(knowledgeOriginalRequested(q), false);
  assert.equal(matchingReviewedStandard('GB 55030-2021《建筑与市政工程防水通用规范》目前有效吗？', []), undefined);
  assert.equal(knowledgeOriginalRequested('《本公司施工手册》的原文怎么说？'), true);
  assert.equal(matchingReviewedStandard('处理后什么时候可以做防水？', ['卫生间管根为什么要单独处理？']), selected);
  assert.equal(matchingReviewedStandard('公司自己的资料里有没有写闭水试验时长？', []), undefined);
  assert.equal(reviewedPublicStandard(document(selected!.origin + selected!.path, true)), undefined);
});

test('a reviewed attachment uses the existing compact model view with original citations and recent customer questions', () => {
  const time = '2026-11-13T00:00:00.000Z';
  const doc = document('https://maker.example/scan.pdf?fileName=illustration', true);
  const standard = { kind: 'standard_text', id: 'GB55000-2022', name: 'Synthetic edition', level: 'national', status: 'unknown' } as const;
  const pages = Array.from({ length: 6 }, (_, index) => {
    const page = publicDocumentPages(doc, time)[0];
    return { ...page, requestedUrl: page.url, standard, document: { ...page.document!, page: index + 1, pages: 40, reviewedTextHash: 'a'.repeat(64) } };
  });
  const synthesisSources = webSynthesisSources(webEvidence({ version: 1, provider: 'synthetic', query, status: 'ready', retrievedAt: time,
    pages, failures: [] }, '99', 1298));
  const original = (id: string, text: string): ModelMessage => ({ role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: id, text }) }] });
  const question = '处理后什么时候可以做防水？';
  const messages: ModelMessage[] = [
    { role: 'system', content: [{ type: 'text', text: naturalKnowledgeInstructions }] },
    original('100', '卫生间水管根部为什么要单独处理？'),
    { role: 'assistant', content: '此前未经核验的具体量数。' },
    original('101', question),
    { role: 'assistant', content: '', toolCalls: [{ name: 'web_fetch', id: 'server:reviewed-standard:1298', arguments: '{}' }] },
    { role: 'tool', callId: 'server:reviewed-standard:1298', content: JSON.stringify({ tool: 'web_fetch', synthesisSources }) },
  ];
  const before = JSON.stringify(messages);
  const request = compileModelRequest({ messages, question, triggerId: '101', turn: 0, purpose: 'answer', naturalKnowledge: true,
    knowledgeExplanation: true, tools: [], toolsForTurn: agentToolsForTurn });
  const packet = JSON.parse(request.modelMessages.find(message => message.role === 'tool')!.content);
  assert.equal(packet.synthesisSources.length, 6);
  assert.ok(packet.synthesisSources.every((item: typeof synthesisSources[number] & { citationOptions?: unknown[] }) =>
    item.citationOptions?.length && item.web?.document?.page && !item.evidence?.text && !item.web.document.reviewedTextHash));
  assert.match(JSON.stringify(request.modelMessages), /卫生间水管根部为什么要单独处理/);
  assert.doesNotMatch(JSON.stringify(request.modelMessages), /此前未经核验的具体量数/);
  assertToolPairs(request.modelMessages);
  assert.equal(JSON.stringify(messages), before);
});

test('a long PDF retains complete relevant pages and original locators under the context limit', () => {
  const original = document('https://maker.example/spec.pdf', true);
  original.pages = Array.from({ length: 40 }, (_, i) => ({ page: i + 1,
    text: (i === 35 ? '卫生间管根与基层交接部位。' : '未涉及本查询的合成条文。').repeat(100) }));
  const pages = publicDocumentPages(original, new Date().toISOString(), '卫生间管根基层交接部位');
  assert.ok(pages.reduce((total, page) => total + page.textBytes, 0) <= 18000);
  const clause = pages.find(page => page.document?.page === 36);
  assert.equal(clause?.text, original.pages[35].text);
  assert.equal(clause?.document?.hash, original.original.sha256);
});

test('unsafe anchors, changed domains, corrupt originals and oversized pages never gain Evidence', async () => {
  const result = await searchPublicResearch({ ...query, domains: ['maker.example'] }, { name: 'synthetic', search: async () => [{ url: 'https://maker.example/', title: 'Install' }] }, async () => document('https://another.example/install.pdf', true));
  assert.equal(result.status, 'unavailable'); assert.equal(result.failures[0].code, 'web_domain_changed');
  const original = document('https://maker.example/install.pdf', true);
  assert.equal(validPublicDocument({ ...original, original: { ...original.original, sha256: 'corrupt' } }), false);
  assert.equal(validPublicDocument({ ...original, redirects: Array.from({length:4},()=>({from:original.url,to:original.url,status:302})) }), false);
  assert.equal(validPublicDocument({ ...original, pages: Array.from({length:51},(_,i)=>({page:i+1,text:'x'})) }), false);
  const long = { ...original, pages: [{ page: 1, text: 'An unbroken complete condition '.repeat(1000) }] };
  assert.deepEqual(publicDocumentPages(long,new Date().toISOString()), []);
  assert.equal(long.pages[0].text.length, 31000);
});

test('ancestor Evidence enters through a paired read result and receives the current final catalog', () => {
  const page = publicDocumentPages(document('https://maker.example/install.pdf',true),new Date().toISOString())[0];
  const evidence = webEvidence({version:1,provider:'synthetic',query,status:'ready',retrievedAt:page.retrievedAt,pages:[page],failures:[]},'99',1200)[0];
  const messages = ancestorSourceMessages({version:1,knowledge:[],snapshots:[],sources:[{sourceId:'W'+evidence.ref.id,kind:'web',title:page.title,text:page.text,evidence,web:evidence.web}]});
  assertToolPairs(messages);
  const original = {role:'user' as const,content:[{type:'text' as const,text:JSON.stringify({sourceMessageId:'100',text:'沿刚才的依据解释条件'})}]};
  const projected = focusedSynthesisMessages([original,...messages],'100');
  assert.match(JSON.stringify(projected),/citationOptions/);
  const tool = finalToolForMessages(projected);
  assert.deepEqual((tool.parameters.properties as Record<string,{enum?:string[]}>).kind.enum,['synthesis']);
  const firstTurn = compileModelRequest({ question: '沿刚才的依据解释条件', triggerId: '100', turn: 0, purpose: 'answer',
    profile: consultationAcceptanceProfile.id, messages: [original,...messages], tools: [],
    toolsForTurn: (_question, current) => [finalToolForMessages(current)] });
  assert.match(JSON.stringify(firstTurn.modelMessages), /citationOptions/);
  assert.equal(JSON.stringify(firstTurn.dispatchTools), JSON.stringify([tool]));
});
