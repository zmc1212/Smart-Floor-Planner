import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectFinalChatStream } from '../providers/final-chat-stream';

const encode = new TextEncoder();
const data = (value: unknown) => encode.encode('data: ' + JSON.stringify(value) + '\r\n\r\n');

test('the answer callback sees a split UTF-8 delta before the provider ends and usage stays on the terminal result', async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
  const first = Promise.withResolvers<string>();
  const result = collectFinalChatStream(new Response(readable), async text => { first.resolve(text); });
  const fragment = data({ choices: [{ index: 0, delta: { content: '先确认铺贴方向。\n\n', reasoning_content: '内部信息' } }] });
  for (let index = 0; index < fragment.length; index += 3) source.enqueue(fragment.slice(index, index + 3));
  assert.equal(await first.promise, '先确认铺贴方向。\n\n');
  source.enqueue(data({ choices: [{ index: 0, delta: { content: '和师傅核对收边。' }, finish_reason: 'stop' }] }));
  source.enqueue(data({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 9 } }));
  source.enqueue(encode.encode('data: [DONE]\n\n'));
  source.close();
  const output = await result;
  assert.equal(output.choices[0].message.content, '先确认铺贴方向。\n\n和师傅核对收边。');
  assert.deepEqual(output.usage, { prompt_tokens: 7, completion_tokens: 9 });
  assert.doesNotMatch(JSON.stringify(output), /内部信息/);
});

test('tool output on a final text stream fails before exposing the frame', async () => {
  const readable = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(data({ choices: [{ index: 0, delta: { tool_calls: [{ id: 'unexpected' }], content: 'invalid' } }] }));
    controller.close();
  } });
  const seen: string[] = [];
  await assert.rejects(collectFinalChatStream(new Response(readable), async delta => { seen.push(delta); }), /incomplete/);
  assert.deepEqual(seen, []);
});
