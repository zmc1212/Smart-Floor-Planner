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
  receive({ text: '这是一段已经校验过的正文', revision: 1 });
  assert.equal(seen[0], '这');
  live.sync({ id: '1', status: 'cancelled', answerStreaming: true });
  receive({ text: '过期正文', revision: 2 });
  assert.equal(seen.at(-1), '');
  assert.equal(aborted, 1);
});

test('run polling feeds the same live bubble when the host cannot consume response chunks', () => {
  const seen = [];
  const live = new LiveAnswer(text => seen.push(text), () => null);
  live.sync({ id: '1', status: 'running', answerStreaming: true, answerPreview: { text: '已核对', revision: 1 } });
  assert.ok(seen.at(-1).startsWith('已'));
  live.sync({ id: '2', status: 'queued', answerStreaming: true });
  assert.equal(seen.at(-1), '');
  live.stop();
});

test('polling can grow a live reply after an empty chunk and late frames cannot restore cleared text', t => {
  let receive;
  const live = new LiveAnswer(() => {}, (_, onFrame) => {
    receive = onFrame;
    return () => {};
  });
  t.after(() => live.stop());
  const run = { id: '1', status: 'running', answerStreaming: true };
  live.sync(run);
  receive({ text: '', revision: 0 });
  live.sync({ ...run, answerPreview: { text: '已核对第一句。', revision: 2 } });
  assert.equal(live.text, '已');
  receive({ text: '', revision: 0, initial: true });
  receive({ text: '较早的正文', revision: 1 });
  assert.equal(live.target, '已核对第一句。');
  receive({ text: '已核对第一句。再补一条。', revision: 3 });
  live.sync({ ...run, answerPreview: { text: '', revision: 3 } });
  receive({ text: '已核对第一句。再补一条。', revision: 3 });
  assert.equal(live.text, '');
  assert.equal(live.target, '');
  live.sync({ ...run, answerPreview: { text: '最新已校验正文。', revision: 4 } });
  assert.equal(live.target, '最新已校验正文。');
  receive({ text: '', revision: 0 });
  assert.equal(live.target, '');
});

test('verified reply prefixes type headings, list items and emphasis without showing Markdown markers', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const chat = new ChatController({ emit() {}, client: {}, identity: () => 'owner' });
  t.after(() => chat.dispose());
  chat.visible = true;
  chat.session = 'owner';
  chat.liveAnswer.listen = () => null;
  let revision = 0;
  const preview = text => chat.liveAnswer.sync({
    id: '5', status: 'running', answerStreaming: true, answerPreview: { text, revision: ++revision },
  });
  const drain = () => {
    for (let tick = 0; tick < 100 && chat.liveAnswer.timer; tick++) t.mock.timers.tick(24);
  };
  const heading = '## 铺贴前';
  const reply = heading + '\n\n1. **纹理方向**先试排。\n   - 门口留样\n2. 约师傅一起确认。';
  preview(heading);
  assert.equal(chat.state.liveAnswerText, '#');
  const first = chat.state.liveAnswerMarkdown[0].nodes[0];
  assert.equal(first.name, 'h2');
  assert.equal(first.children[0].text, '铺');
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

test('a saved owner reply can reveal from its first character on a live turn without stream admission', t => {
  const chat = new ChatController({ emit() {}, client: {}, identity: () => 'owner' });
  t.after(() => chat.liveAnswer.stop());
  chat.visible = true;
  chat.session = 'owner';
  const run = { id: '5', status: 'succeeded', outputMessageId: '8' };
  const conversation = { purpose: 'customer_consultation' };
  const reply = { id: '8', authorKind: 'assistant', available: true, content: { blocks: [
    { type: 'text', text: '先开两侧窗户，让空气流动。' },
  ] } };
  const window = { cache: { rawMessages: [reply] } };
  chat.finishLiveReply(run, window, conversation);
  assert.equal(chat.state.liveAnswerText, '');
  chat.set({ run: { id: '5', status: 'queued' }, generating: true });
  chat.finishLiveReply(run, window, conversation);
  assert.equal(chat.state.revealingReplyId, '8');
  assert.equal(chat.state.liveAnswerText, '先');
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
