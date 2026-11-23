function inputCandidates(text, cursor, words, maxLength = Infinity) {
  const end = Number.isInteger(cursor) && cursor >= 0 ? Math.min(cursor, text.length) : text.length;
  const prefix = text.slice(0,end).split('\n').pop();
  if (!prefix.trim() || !Array.isArray(words)) return null;
  for (let size=Math.min(prefix.length,20); size>0; size--) {
    const match=prefix.slice(-size).toLowerCase();
    const maxCandidateLength = maxLength - text.length + size;
    const items = words.filter(word => word.length <= maxCandidateLength
      && word.toLowerCase().includes(match) && word !== prefix).slice(0, 5);
    if (items.length) return { start:end-size,end,items };
  }
  return null;
}
module.exports = { inputCandidates };
