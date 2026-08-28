const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_PAGE_SIZE,
  appendQuery,
  parsePagination,
  mergePage,
  listFooterText,
} = require('../utils/list-pagination.js');

test('appendQuery skips empty params and encodes values', () => {
  assert.equal(appendQuery('/items', { page: 2, limit: 20, q: '' }), '/items?page=2&limit=20');
  assert.equal(appendQuery('/items?status=active', { q: '张 三' }), '/items?status=active&q=%E5%BC%A0%20%E4%B8%89');
});

test('parsePagination prefers nested metadata and derives hasMore from total', () => {
  assert.equal(DEFAULT_PAGE_SIZE, 20);
  assert.deepEqual(
    parsePagination({ pagination: { page: 1, limit: 20, total: 45 } }),
    { page: 1, limit: 20, total: 45, totalPages: 3, hasMore: true }
  );
  assert.equal(parsePagination({ page: 3, limit: 20, total: 45 }).hasMore, false);
  assert.equal(parsePagination({ page: 1, limit: 20, totalPages: 2 }).hasMore, true);
});

test('mergePage replaces on reset and de-duplicates by id on append', () => {
  const first = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(mergePage(first, [{ id: 'c' }], true), [{ id: 'c' }]);
  assert.deepEqual(
    mergePage(first, [{ id: 'b' }, { id: 'c' }], false),
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  );
});

test('listFooterText matches lead-list helper copy', () => {
  assert.equal(listFooterText(true, true, 20), '正在加载...');
  assert.equal(listFooterText(false, false, 20), '已经到底了');
  assert.equal(listFooterText(false, true, 20), '');
  assert.equal(listFooterText(false, false, 0), '');
});
