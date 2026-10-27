import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBailianSearchStream, nativeSearchCandidates, nativeSearchUsage } from '@/lib/ai/providers/bailian-offline';

function response(events:unknown[],split=7) {
  const bytes=Buffer.from(events.map(event=>'data: '+JSON.stringify(event)+'\r\n\r\n').join(''));
  return new Response(new ReadableStream<Uint8Array>({start(controller){
    for(let i=0;i<bytes.length;i+=split)controller.enqueue(bytes.subarray(i,i+split));controller.close();
  }}),{headers:{'Content-Type':'text/event-stream'}});
}
const source={title:'国家标准原文',url:'https://openstd.samr.gov.cn/standard'};
test('native multimodal SSE preserves early sources, final usage, Unicode and terminal truncation',async()=>{
  const value=await parseBailianSearchStream(response([
    {request_id:'native-stream',output:{search_info:{search_results:[source]}}},
    {request_id:'native-stream',output:{choices:[{finish_reason:'null',message:{content:[{text:'不用于引用的模型片段'}]}}]}},
    {request_id:'native-stream',output:{choices:[{finish_reason:'length',message:{content:[{text:'截断的模型回答仍不用于原文证据'}]}}]},usage:{input_tokens:140,output_tokens:20}},
  ]));
  assert.equal(nativeSearchCandidates(value)[0].title,source.title);
  assert.deepEqual(nativeSearchUsage(value),{inputTokens:140,outputTokens:20});
  assert.equal(value.request_id,'native-stream');
});
test('broken/error/unterminated native streams cannot silently become successful zero-usage searches',async()=>{
  await assert.rejects(parseBailianSearchStream(response([{code:'InvalidParameter',message:'Do not expose upstream private text'}])),/search_stream_error/);
  await assert.rejects(parseBailianSearchStream(response([{output:{search_info:{search_results:[source]}}}])),/incomplete/);
  await assert.rejects(parseBailianSearchStream(new Response('data: {bad}\n\n',{headers:{'Content-Type':'text/event-stream'}})),/invalid/);
  await assert.rejects(parseBailianSearchStream(new Response('{}',{headers:{'Content-Type':'application/json'}})),/content_type/);
});
