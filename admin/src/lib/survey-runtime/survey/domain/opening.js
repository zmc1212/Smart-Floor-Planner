function getOpeningRange(opening) {
  const width = Number(opening && opening.widthMm) || 0;
  const center = Number(opening && opening.centerOffsetMm) || 0;
  return { startMm: center - width / 2, endMm: center + width / 2 };
}

function normalizeOpeningToWall(opening, wall, options) {
  if (!opening || !wall) return opening;
  const opts = options || {};
  const minimumSizeMm = Number(opts.minimumSizeMm) || 100;
  const maximumWallRatio = Number(opts.maximumWallRatio) || 1;
  const bounds = opts.bounds || { startMm: 0, endMm: Number(wall.lengthMm) || 0 };
  const startMm = Math.max(0, bounds.startMm);
  const endMm = Math.min(Number(wall.lengthMm) || 0, bounds.endMm);
  const available = Math.floor(endMm - startMm);
  const junctionLimited = startMm > 0 || endMm < Number(wall.lengthMm);
  if (opts.bounds && available < minimumSizeMm) {
    const error = new Error('墙体交汇处之间的可用长度不足，无法放置门窗');
    error.code = 'OPENING_HOST_TOO_SHORT';
    throw error;
  }
  const maxWidth = Math.max(minimumSizeMm, Math.floor(available * maximumWallRatio));
  opening.widthMm = Math.max(minimumSizeMm, Math.min(maxWidth, Number(opening.widthMm) || minimumSizeMm));
  const halfWidth = opening.widthMm / 2;
  // Odd widths need an integer centre that does not cross either boundary.
  if (junctionLimited && Math.ceil(startMm + halfWidth) > Math.floor(endMm - halfWidth)) {
    opening.widthMm -= 1;
  }
  const half = opening.widthMm / 2;
  opening.centerOffsetMm = junctionLimited
    ? Math.max(Math.ceil(startMm + half), Math.min(Math.floor(endMm - half), Math.round(Number(opening.centerOffsetMm) || 0)))
    : Math.round(Math.max(half, Math.min(Math.max(half, endMm - half), Number(opening.centerOffsetMm) || 0)));
  return opening;
}

function normalizeOpeningDirection(opening) {
  if (!opening || opening.type !== 'door') return opening;
  opening.openDirection = opening.openDirection === 'outside' ? 'outside' : 'inside';
  return opening;
}

module.exports = { getOpeningRange, normalizeOpeningToWall, normalizeOpeningDirection };
