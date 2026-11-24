const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chatRoot = path.join(__dirname, '..', 'packages', 'assistant', 'chat');

function chatPage(overrides = {}) {
  const definition = require('../packages/assistant/chat/chat-definition')();
  const page = {
    ...definition,
    data: { ...definition.data, messages: [{ id: '1' }], ...overrides },
    patches: [],
    setData(patch, callback) {
      this.patches.push(patch);
      Object.assign(this.data, patch);
      if (callback) callback();
    },
  };
  page._alive = true;
  page._shown = true;
  page.syncKeyboardTab = () => {};
  page.scrolls = 0;
  page.scrollBottom = () => { page.scrolls += 1; };
  return page;
}

test('iOS keyboard height bursts collapse to one settled layout update', async () => {
  const page = chatPage();
  page.keyboardChange({ detail: { height: 336.4 } });
  assert.equal(page.data.keyboardHeight, 336);
  assert.equal(page.patches.length, 1);

  page.keyboardChange({ detail: { height: 336.9 } });
  page.keyboardChange({ detail: { height: 335 } });
  assert.equal(page.patches.length, 1, 'fractional and two-pixel noise must not reflow');

  page.keyboardChange({ detail: { height: 291 } });
  assert.equal(page.data.keyboardHeight, 291);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(page.scrolls, 1, 'height bursts scroll the conversation once');
});

test('closing the keyboard clears the focused state once', () => {
  const page = chatPage({ keyboardHeight: 336, inputFocused: true });
  page.keyboardChange({ detail: { height: 0 } });
  assert.equal(page.data.keyboardHeight, 0);
  assert.equal(page.data.inputFocused, false);

  const settled = page.patches.length;
  page.keyboardChange({ detail: { height: 0 } });
  assert.equal(page.patches.length, settled);
});

test('a keyboard-shrunk window never becomes the layout height twice', () => {
  const previous = global.wx;
  let info = { windowHeight: 844, windowWidth: 390, screenHeight: 844, statusBarHeight: 47, safeArea: { bottom: 810 } };
  global.wx = {
    getWindowInfo: () => info,
    getMenuButtonBoundingClientRect: () => ({ height: 32, top: 51, left: 296 }),
  };
  try {
    const page = chatPage();
    page.measureWindow();
    assert.equal(page.data.viewportHeight, 844);

    info = { ...info, windowHeight: 508 };
    page.measureWindow();
    assert.equal(page.data.viewportHeight, 844, 'keyboard shrink is not a new viewport');

    info = { windowHeight: 390, windowWidth: 844, screenHeight: 390, statusBarHeight: 0, safeArea: { bottom: 390 } };
    page.measureWindow();
    assert.equal(page.data.viewportHeight, 390, 'a real screen change still updates the viewport');
  } finally {
    global.wx = previous;
  }
});

test('keyboard events from a hidden chat do not resize the page', () => {
  const page = chatPage();
  page._shown = false;
  page.keyboardChange({ detail: { height: 336 } });
  assert.equal(page.data.keyboardHeight, 0);
  assert.equal(page.patches.length, 0);
});

test('the composer keeps native focus ownership and the keyboard binding', () => {
  const wxml = fs.readFileSync(path.join(chatRoot, 'chat.wxml'), 'utf8');
  const textarea = wxml.match(/<textarea class="composer-input"[\s\S]*?\/>/);
  assert.ok(textarea, 'composer textarea exists');
  assert.doesNotMatch(textarea[0], /focus="\{\{/, 'a data-driven focus prop re-focuses iOS textareas');
  assert.match(textarea[0], /adjust-position="\{\{false\}\}"/);
  assert.match(textarea[0], /bindkeyboardheightchange="keyboardChange"/);
});

test('hiding the chat clears stale focus so the keyboard cannot reopen', () => {
  const page = chatPage({ keyboardHeight: 336, inputFocused: true });
  page.stopOwnerReminderRefresh = () => {};
  page.followupChatController = null;
  page.followups = { hide() {} };
  page._followupObserver = null;
  page.speechController = null;
  page.location = null;
  page.controller = { hide() {} };
  page.siteRecords = { clear() {} };
  page.recommendations = { clear() {} };
  page.publicSites = { clear() {} };
  page.plans = { clear() {} };
  page.resetDesignerCards = () => {};
  page.closeSheet = () => {};

  page.onHide();
  assert.equal(page.data.keyboardHeight, 0);
  assert.equal(page.data.inputFocused, false);
});
