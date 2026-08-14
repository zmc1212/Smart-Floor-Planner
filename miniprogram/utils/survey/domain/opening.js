function getOpeningRange(opening) {
  const width = Number(opening && opening.widthMm) || 0;
  const center = Number(opening && opening.centerOffsetMm) || 0;
  return { startMm: center - width / 2, endMm: center + width / 2 };
}

function normalizeOpeningToWall(opening, wall, options) {
  if (!opening || !wall) return opening;
  const opts = options || {};
  const minimumSizeMm = Number(opts.minimumSizeMm) || 100;
  const maximumWallRatio = Number(opts.maximumWallRatio) || 0.6;
  const maxWidth = Math.max(minimumSizeMm, Math.floor((Number(wall.lengthMm) || 0) * maximumWallRatio));
  opening.widthMm = Math.max(minimumSizeMm, Math.min(maxWidth, Number(opening.widthMm) || minimumSizeMm));
  const halfWidth = opening.widthMm / 2;
  opening.centerOffsetMm = Math.round(Math.max(
    halfWidth,
    Math.min(Math.max(halfWidth, Number(wall.lengthMm) - halfWidth), Number(opening.centerOffsetMm) || 0)
  ));
  return opening;
}

module.exports = { getOpeningRange, normalizeOpeningToWall };
