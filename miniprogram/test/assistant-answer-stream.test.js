const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LiveAnswer } = require('../packages/assistant/lib/answer-stream');
const { ChatController } = require('../packages/assistant/lib/chat');
const { markdownForBlock } = require('../packages/assistant/lib/message-markdown');

test('growing text appears during the run, and stopping aborts the connection and rejects late chunks', () => {
  let receive, aborted = 0;
  const seen = [];
  const live = new LiveAnswer(text => seen.push(text), (_, onText) => {
    receive = onText;
    return () => { aborted++; };
  });
  live.sync({ id: '1', status: 'running', answerStreaming: true });
  receive('这是一段已经校验过的正文');
  assert.ok(seen[0].length > 0 && seen[0].length < 12);
  live.sync({ id: '1', status: 'cancelled', answerStreaming: true });
  receive('过期正文');
  assert.equal(seen.at(-1), '');
  assert.equal(aborted, 1);
});

test('run polling feeds the same live bubble when the host cannot consume response chunks', () => {
  const seen = [];
  const live = new LiveAnswer(text => seen.push(text), () => null);
  live.sync({ id: '1', status: 'running', answerStreaming: true, answerPreview: { text: '已核对' } });
  assert.ok(seen.at(-1).startsWith('已'));
  live.sync({ id: '2', status: 'queued', answerStreaming: true });
  assert.equal(seen.at(-1), '');
  live.stop();
});

test('verified reply prefixes type headings, list items and emphasis without showing Markdown markers', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const chat = new ChatController({ emit() {}, client: {}, identity: () => 'owner' });
  t.after(() => chat.dispose());
  chat.visible = true;
  chat.session = 'owner';
  chat.liveAnswer.listen = () => null;
  const preview = text => chat.liveAnswer.sync({
    id: '5', status: 'running', answerStreaming: true, answerPreview: { text },
  });
  const drain = () => {
    for (let tick = 0; tick < 100 && chat.liveAnswer.timer; tick++) t.mock.timers.tick(24);
  };
  const heading = '## 铺贴前';
  const reply = heading + '\n\n1. **纹理方向**先试排。\n   - 门口留样\n2. 约师傅一起确认。';
  preview(heading);
  assert.equal(chat.state.liveAnswerText, '##');
  const first = chat.state.liveAnswerMarkdown[0].nodes[0];
  assert.equal(first.name, 'h2');
  assert.equal(first.children[0].text, '铺贴');
  drain();
  preview(reply);
  drain();
  assert.deepEqual(chat.state.liveAnswerMarkdown, markdownForBlock({ text: reply }));
  const list = chat.state.liveAnswerMarkdown[0].nodes[1];
  assert.equal(list.name, 'ol');
  assert.equal(list.children[0].children[0].name, 'strong');
  assert.equal(list.children[0].children.at(-1).name, 'ul');
  preview('');
  assert.equal(chat.state.liveAnswerText, '');
  assert.equal(chat.state.liveAnswerMarkdown, null);
});

test('an observed report run types the saved authorized answer once and skips withdrawn replies', t => {
  const chat = new ChatController({ emit() {}, client: {}, identity: () => 'owner' });
  t.after(() => chat.liveAnswer.stop());
  chat.visible = true;
  chat.session = 'owner';
  const run = { id: '5', status: 'succeeded', outputMessageId: '8' };
  const conversation = { reportContext: { selected: { reportId: '4' } } };
  const reply = { id: '8', authorKind: 'assistant', available: true, content: { blocks: [
    { type: 'text', text: '日报记录了客厅墙面施工，后续请与现场负责人核对。' },
    { type: 'citation', fallbackText: '原始资料' },
  ] } };
  const window = value => ({ cache: { rawMessages: [value] } });
  chat.finishLiveReply(run, window(reply), conversation);
  assert.equal(chat.state.liveAnswerText, '');
  chat.set({ run: { id: '5', status: 'running' }, generating: true });
  chat.finishLiveReply(run, window(reply), conversation);
  assert.equal(chat.state.revealingReplyId, '8');
  assert.ok(reply.content.blocks[0].text.startsWith(chat.state.liveAnswerText));
  assert.ok(chat.state.liveAnswerText.length < reply.content.blocks[0].text.length);
  assert.equal(chat.state.liveAnswerMarkdown, null);
  chat.finishLiveReply(run, window({ ...reply, available: false }), conversation);
  assert.equal(chat.state.revealingReplyId, '');
  assert.equal(chat.state.liveAnswerText, '');
});
