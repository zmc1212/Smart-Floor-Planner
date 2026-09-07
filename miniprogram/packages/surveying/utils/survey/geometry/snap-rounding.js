// Fast integer determinants for ordinary plans, exact fallback for large
// coordinates. BigInt is used only internally and is never persisted.
function orientation(a, b, c) {
  const dx = b.xMm - a.xMm, dy = b.yMm - a.yMm;
  const px = c.xMm - a.xMm, py = c.yMm - a.yMm;
  const first = dx * py, second = dy * px;
  if ([dx, dy, px, py, first, second, first - second].every(Number.isSafeInteger)) {
    return Math.sign(first - second);
  }
  const exact = (BigInt(b.xMm) - BigInt(a.xMm)) * (BigInt(c.yMm) - BigInt(a.yMm)) -
    (BigInt(b.yMm) - BigInt(a.yMm)) * (BigInt(c.xMm) - BigInt(a.xMm));
  return exact > BigInt(0) ? 1 : exact < BigInt(0) ? -1 : 0;
}

function roundedIntersection(a, b) {
  const dx = BigInt(a.end.xMm) - BigInt(a.start.xMm);
  const dy = BigInt(a.end.yMm) - BigInt(a.start.yMm);
  const ex = BigInt(b.end.xMm) - BigInt(b.start.xMm);
  const ey = BigInt(b.end.yMm) - BigInt(b.start.yMm);
  const ox = BigInt(b.start.xMm) - BigInt(a.start.xMm);
  const oy = BigInt(b.start.yMm) - BigInt(a.start.yMm);
  const denominator = dx * ey - dy * ex, numerator = ox * ey - oy * ex;
  const round = (origin, delta) => {
    let n = BigInt(origin) * denominator + delta * numerator, d = denominator;
    if (d < BigInt(0)) { n = -n; d = -d; }
    // floor(n/d + 1/2), including negative half-grid ties. BigInt division
    // truncates towards zero, so explicitly floor a negative remainder.
    n = BigInt(2) * n + d;
    d *= BigInt(2);
    return Number(n / d - (n < BigInt(0) && n % d !== BigInt(0) ? BigInt(1) : BigInt(0)));
  };
  return { xMm: round(a.start.xMm, dx), yMm: round(a.start.yMm, dy) };
}

function exactHotPixelIntersects(start, end, pixel) {
  const zero = BigInt(0), one = BigInt(1), two = BigInt(2);
  let lower = [zero, one], upper = [one, one], lowerOpen = false, upperOpen = false;
  const compare = (a, b) => a[0] * b[1] - b[0] * a[1];
  for (const axis of ['xMm', 'yMm']) {
    const delta = two * (BigInt(end[axis]) - BigInt(start[axis]));
    const low = two * (BigInt(pixel[axis]) - BigInt(start[axis])) - one, high = low + two;
    if (delta === zero) {
      if (low > zero || high <= zero) return false;
      continue;
    }
    const positive = delta > zero;
    const enter = positive ? [low, delta] : [-high, -delta];
    const leave = positive ? [high, delta] : [-low, -delta];
    const lo = compare(enter, lower), hi = compare(leave, upper);
    if (lo > zero) { lower = enter; lowerOpen = !positive; }
    else if (lo === zero) lowerOpen = lowerOpen || !positive;
    if (hi < zero) { upper = leave; upperOpen = positive; }
    else if (hi === zero) upperOpen = upperOpen || positive;
    const order = compare(lower, upper);
    if (order > zero || (order === zero && (lowerOpen || upperOpen))) return false;
  }
  return true;
}

// A unit hot pixel owns [x - .5, x + .5) × [y - .5, y + .5).
// Clip the ORIGINAL line, retaining open interval ends. In particular, a
// bottom-left corner touch counts, but the other three corner touches do not.
// No UI tolerance, rounded projection, or rounded fragment participates here.
function hotPixelIntersects(start, end, pixel) {
  // Envelope rejection also avoids exact arithmetic for distant pixels.
  if (pixel.xMm < Math.min(start.xMm, end.xMm) || pixel.xMm > Math.max(start.xMm, end.xMm) ||
      pixel.yMm < Math.min(start.yMm, end.yMm) || pixel.yMm > Math.max(start.yMm, end.yMm)) return false;
  if ([start, end, pixel].some(p => Math.abs(p.xMm) > 1000000 || Math.abs(p.yMm) > 1000000)) {
    return exactHotPixelIntersects(start, end, pixel);
  }
  let lower = 0, upper = 1, lowerOpen = false, upperOpen = false;
  for (const axis of ['xMm', 'yMm']) {
    const delta = end[axis] - start[axis];
    const low = pixel[axis] - 0.5 - start[axis];
    const high = pixel[axis] + 0.5 - start[axis];
    if (delta === 0) {
      if (low > 0 || high <= 0) return false;
      continue;
    }
    const enter = (delta > 0 ? low : high) / delta;
    const leave = (delta > 0 ? high : low) / delta;
    const enterOpen = delta < 0, leaveOpen = delta > 0;
    if (enter > lower) { lower = enter; lowerOpen = enterOpen; }
    else if (enter === lower) lowerOpen = lowerOpen || enterOpen;
    if (leave < upper) { upper = leave; upperOpen = leaveOpen; }
    else if (leave === upper) upperOpen = upperOpen || leaveOpen;
    if (lower > upper || (lower === upper && (lowerOpen || upperOpen))) return false;
  }
  return true;
}

const pointKey = point => `${point.xMm},${point.yMm}`;
const comparePoints = (a, b) => a.xMm - b.xMm || a.yMm - b.yMm;

// Pure arrangement-wide plan. Inputs are the formal graph's integer-mm
// endpoints; all intersection pixels are collected before ANY line is bent.
// Multiple crossings in one pixel and non-crossing third lines traversing it
// therefore share the same node. Overlapping physical walls remain ambiguous.
function snapRoundSegments(lines) {
  const pixels = new Map();
  const addPixel = point => {
    const rounded = { xMm: Math.round(point.xMm) || 0, yMm: Math.round(point.yMm) || 0 };
    pixels.set(pointKey(rounded), rounded);
  };
  lines.forEach(line => { addPixel(line.start); addPixel(line.end); });
  for (let i = 0; i < lines.length; i += 1) {
    const a = lines[i];
    for (let j = i + 1; j < lines.length; j += 1) {
      const b = lines[j];
      const signs = [orientation(a.start, a.end, b.start), orientation(a.start, a.end, b.end),
        orientation(b.start, b.end, a.start), orientation(b.start, b.end, a.end)];
      const axis = a.start.xMm !== a.end.xMm ? 'xMm' : 'yMm';
      if (signs.every(value => value === 0) &&
          Math.min(Math.max(a.start[axis], a.end[axis]), Math.max(b.start[axis], b.end[axis])) >
          Math.max(Math.min(a.start[axis], a.end[axis]), Math.min(b.start[axis], b.end[axis]))) {
        return { conflict: { code: 'OVERLAPPING_WALLS', wallIds: [a.id, b.id] } };
      }
      if (signs[0] * signs[1] < 0 && signs[2] * signs[3] < 0) {
        addPixel(roundedIntersection(a, b));
      }
    }
  }
  const orderedPixels = [...pixels.values()].sort(comparePoints);
  const paths = lines.map(line => {
    const dx = line.end.xMm - line.start.xMm, dy = line.end.yMm - line.start.yMm;
    // Dominant-axis order is monotone along the original segment; the minor
    // axis resolves adjacent pixels at a corner, including reverse traversal.
    const useX = Math.abs(dx) >= Math.abs(dy);
    const major = useX ? 'xMm' : 'yMm', minor = useX ? 'yMm' : 'xMm';
    const majorSign = Math.sign(useX ? dx : dy), minorSign = Math.sign(useX ? dy : dx);
    const compare = (a, b) => majorSign * (a[major] - b[major]) || minorSign * (a[minor] - b[minor]);
    let points = orderedPixels.filter(pixel => hotPixelIntersects(line.start, line.end, pixel)).sort(compare);
    // Stabilize against the SAME finite pixel set. A first bend can bring a
    // fragment into another endpoint pixel; leaving it there makes the next
    // commit alter the already-committed graph. Each pass only adds vertices,
    // so at most pixels.length additions are possible for a source path.
    const visited = new Set(points.map(pointKey));
    let changed = true;
    while (changed) {
      changed = false;
      for (const pixel of orderedPixels) {
        if (visited.has(pointKey(pixel))) continue;
        if (!points.slice(1).some((end, i) => hotPixelIntersects(points[i], end, pixel))) continue;
        visited.add(pointKey(pixel));
        changed = true;
      }
      if (changed) points = orderedPixels.filter(pixel => visited.has(pointKey(pixel))).sort(compare);
    }
    return { id: line.id, points };
  });
  return { pixels: orderedPixels, paths };
}

module.exports = { hotPixelIntersects, snapRoundSegments };
