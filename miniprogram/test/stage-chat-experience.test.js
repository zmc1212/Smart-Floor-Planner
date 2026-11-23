const assert = require('node:assert/strict');
const test = require('node:test');
const { inputCandidates } = require('../packages/assistant/lib/stage-chat-experience');

test('stage input guidance replaces only the matched suffix at the caret', () => {
  const text = '明天我想问水电，再看门窗';
  const caret = text.indexOf('，');
  const suggestion = '水电点位怎么检查？';
  const match = inputCandidates(text, caret, [suggestion, '门窗进场要注意什么？']);
  assert.deepEqual(match.items, [suggestion]);
  assert.equal(text.slice(0, match.start) + match.items[0] + text.slice(match.end),
    '明天我想问水电点位怎么检查？，再看门窗');
  assert.equal(inputCandidates('', 0, [suggestion]), null);
  assert.equal(inputCandidates('水电', 2, []), null);
  assert.equal(inputCandidates('水电\n', 3, [suggestion]), null);
});


function stagePage(overrides = {}) {
  const definition = require('../packages/assistant/chat/chat-definition')();
  const page = {
    ...definition,
    data: { ...definition.data, canSend: true, ...overrides },
    setData(patch) { Object.assign(this.data, patch); },
    queueKeyboardScroll() {},
  };
  page.controller = { input: text => page.setData({ draft: text }) };
  return page;
}

test('candidate selection edits the local draft at its caret and keeps surrounding text', () => {
  const candidate = '木纹砖铺贴前要核对什么？';
  const draft = '我想问木纹砖，门口也要看。';
  const page = stagePage({ stageExperience: { lexicon: [candidate] }, inputFocused: true });
  page.input({ detail: { value: draft, cursor: draft.indexOf('，') } });
  assert.deepEqual(page.data.inputCandidates, [candidate]);

  page.fillStageQuestion({ currentTarget: { dataset: { text: candidate } } });
  assert.equal(page.data.draft, '我想问' + candidate + '，门口也要看。');
  assert.equal(page.data.stageInputCursor, '我想问'.length + candidate.length);
  assert.deepEqual(page.data.inputCandidates, []);
});

test('closing the keyboard clears candidates and keeps the existing draft', () => {
  const candidate = '木纹砖铺贴前要核对什么？';
  const draft = '木纹砖';
  const page = stagePage({ stageExperience: { lexicon: [candidate] }, inputFocused: true });
  page.input({ detail: { value: draft, cursor: draft.length } });
  page.blurInput();
  page.fillStageQuestion({ currentTarget: { dataset: { text: candidate } } });
  assert.equal(page.data.draft, draft);
  assert.equal(page.data.inputFocused, false);
  assert.deepEqual(page.data.inputCandidates, []);
  assert.equal(inputCandidates('木纹砖', 3, [candidate], 3), null);
});

test('a follow-up shortcut can send only for the current available complete reply', () => {
  const text = '门口收边要怎么核对？';
  const reply = { id: '7', authorKind: 'assistant', available: true };
  const page = stagePage({
    messages: [reply], stageExperience: { followUp: 'model' }, followMessageId: '7', followQuestions: [text],
  });
  const sent = [];
  page.pickPrompt = event => sent.push(event.currentTarget.dataset.text);
  const tap = (message, question = text) => page.pickStageFollowQuestion({ currentTarget: { dataset: { message, text: question } } });

  tap('6');
  tap('7', '旧候选');
  page.data.generating = true;
  tap('7');
  page.data.generating = false;
  reply.available = false;
  tap('7');
  reply.available = true;
  tap('7');
  page.data.stageExperience.followUp = 'off';
  tap('7');
  assert.deepEqual(sent, [text]);
});
