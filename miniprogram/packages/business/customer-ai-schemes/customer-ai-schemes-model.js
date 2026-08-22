function schemeFirstPublishedTime(scheme) {
  const first = scheme && scheme.firstPublishedAt;
  if (first) {
    const time = new Date(first).getTime();
    if (!Number.isNaN(time)) return time;
  }
  return new Date((scheme && scheme.publishedAt) || 0).getTime();
}

function sortSchemesByFirstPublished(schemes) {
  const list = Array.isArray(schemes) ? schemes.slice() : [];
  list.sort((left, right) => {
    const timeDiff = schemeFirstPublishedTime(left) - schemeFirstPublishedTime(right);
    if (timeDiff !== 0) return timeDiff;
    return String((left && left.id) || '').localeCompare(String((right && right.id) || ''));
  });
  return list;
}

module.exports = {
  schemeFirstPublishedTime,
  sortSchemesByFirstPublished,
};
