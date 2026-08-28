const DEFAULT_PAGE_SIZE = 20;

function appendQuery(path, params) {
  const entries = Object.entries(params || {}).filter(([, value]) => (
    value !== undefined && value !== null && value !== ''
  ));
  if (!entries.length) return path;
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return path.includes('?') ? `${path}&${query}` : `${path}?${query}`;
}

function parsePagination(payload, fallbackLimit = DEFAULT_PAGE_SIZE) {
  const source = payload && payload.pagination ? payload.pagination : payload || {};
  const page = Math.max(1, Number(source.page) || 1);
  const limit = Math.max(1, Number(source.limit) || fallbackLimit);
  const total = Number(source.total);
  const reportedPages = Number(source.totalPages);
  const totalPages = Number.isFinite(reportedPages) && reportedPages > 0
    ? reportedPages
    : Number.isFinite(total)
      ? Math.max(1, Math.ceil(total / limit))
      : page;
  const hasMore = Number.isFinite(total)
    ? page * limit < total
    : page < totalPages;
  return {
    page,
    limit,
    total: Number.isFinite(total) ? total : 0,
    totalPages,
    hasMore,
  };
}

function mergePage(existing, next, reset) {
  if (reset) return Array.isArray(next) ? next.slice() : [];
  const merged = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(merged.map((item) => String(
    (item && (item.id || item.key || item._id)) || ''
  )).filter(Boolean));
  for (const item of Array.isArray(next) ? next : []) {
    const key = String((item && (item.id || item.key || item._id)) || '');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(item);
  }
  return merged;
}

function listFooterText(loadingMore, hasMore, itemCount) {
  if (loadingMore) return '正在加载...';
  if (itemCount > 0 && !hasMore) return '已经到底了';
  return '';
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  appendQuery,
  parsePagination,
  mergePage,
  listFooterText,
};
