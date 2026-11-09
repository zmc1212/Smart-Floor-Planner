import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryIntent } from '../core/discovery';

test('discovery requires a current request to browse, rather than a related subject', () => {
  const none = { sites: false, works: false };
  for (const text of [
    '哑光瓷砖怎么保养？',
    '你们工地的瓷砖怎么验收？',
    '给我看看工地的铺砖验收标准。',
    '我家工地能不能去看看？',
    '工地验收工具有哪些推荐？',
    '我比较喜欢原木风。',
    '设计师推荐我看看哑光砖。',
    '先不看工地和设计师作品了。',
    '朋友问我“想看看附近工地吗”，我在想瓷砖怎么选。',
  ]) assert.deepEqual(discoveryIntent(text), none, text);
});

test('discovery selects just the requested category, including requests for both', () => {
  const sites = { sites: true, works: false };
  const works = { sites: false, works: true };
  const both = { sites: true, works: true };
  const cases = [
    ['附近有没有正在贴砖的工地可以看看？', sites],
    ['我家在杭州，想看看附近已经公开的工地。', sites],
    ['想看看做原木风的设计师作品。', works],
    ['不想看工地，想看看几套原木风作品。', works],
    ['想先看看附近的工地，也了解一下设计师。', both],
    ['附近工地和设计师作品都想看看。', both],
  ] as const;
  for (const [text, expected] of cases) assert.deepEqual(discoveryIntent(text), expected, text);
});
