import assert from 'node:assert/strict';
import { test } from 'node:test';
import { siteWatchIntent, siteWatchReply, unscopedSiteWatchCancel } from '@/lib/construction/site-watch-contract';

test('natural cancellation and scoped cancellation retain distinct scopes', () => {
  for (const text of ['不用提醒了', '不用再提醒了。', '先不用提醒我了', '请取消关注']) {
    assert.equal(siteWatchIntent(text)?.cancel, true, text);
    assert.equal(unscopedSiteWatchCancel(text), true, text);
  }
  for (const text of ['测试工地甲书房不用提醒了', '客厅停止提醒']) {
    assert.equal(siteWatchIntent(text)?.cancel, true);
    assert.equal(unscopedSiteWatchCancel(text), false);
  }
});

test('questions, negations, reported commands and mixed decisions never authorize cancellation', () => {
  for (const text of ['怎么取消关注？', '不用提醒了是什么意思', '如果不用提醒了', '我不是说不用提醒了',
    '不要停止提醒', '别取消关注', '不用取消关注', '书房不用提醒了，客厅继续提醒', '不用提醒了可以吗']) {
    assert.equal(siteWatchIntent(text), null, text);
  }
});

test('a clarification accepts conversational framing only around actual room and project names', () => {
  const projects = ['测试工地甲', '测试工地乙', '选择家园'];
  const rooms = [{ project: '测试工地甲', name: '书房' }, { project: '测试工地甲', name: '客厅' }];
  for (const [text, expected] of [['就书房吧', '书房'], ['那就测试工地甲吧。', '测试工地甲'],
    ['就测试工地甲的客厅吧', '测试工地甲的客厅'], ['整个工地', '整个工地'], ['选择家园', '选择家园']]) {
    assert.equal(siteWatchReply(text, projects, rooms), expected);
  }
  for (const text of ['别选书房', '书房可以吗', '书房和客厅', '书房不用了', '厨房', '我朋友的书房']) {
    assert.equal(siteWatchReply(text, projects, rooms), null, text);
  }
});
