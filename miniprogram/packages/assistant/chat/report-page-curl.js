const SPINE = 18;
const shades = [
  [0, [247, 243, 233]], [.18, [230, 222, 204]], [.48, [255, 252, 240]],
  [.63, [251, 246, 231]], [.85, [243, 235, 217]], [1, [236, 226, 206]],
];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function topCornerAngle(page, dy = 0) {
  return (page ? 1 : -1) * clamp(.36 + dy * .28, .27, .43);
}

function restrict(points, boundary, before) {
  const inside = point => before ? point.q <= boundary : point.q >= boundary;
  const result = [];
  for (const [index, point] of points.entries()) {
    const previous = points[(index + points.length - 1) % points.length];
    if (inside(previous) !== inside(point)) {
      const fraction = (boundary - previous.q) / (point.q - previous.q);
      result.push({ x: previous.x + (point.x - previous.x) * fraction,
        y: previous.y + (point.y - previous.y) * fraction, q: boundary });
    }
    if (inside(point)) result.push(point);
  }
  return result;
}

function outline(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
}

function fill(ctx, points, color) {
  if (points.length < 3) return;
  outline(ctx, points);
  ctx.fillStyle = color;
  ctx.fill();
}

function light(turn) {
  const end = shades.findIndex(([position]) => position >= turn);
  if (end <= 0) return 'rgb(' + shades[0][1].join(',') + ')';
  const [from, low] = shades[end - 1], [to, high] = shades[end];
  const fraction = (turn - from) / (to - from);
  return 'rgb(' + low.map((channel, index) => Math.round(channel + (high[index] - channel) * fraction)).join(',') + ')';
}

function fold(width, height, progress, angle) {
  const nx = Math.cos(angle), ny = Math.sin(angle);
  const page = [[SPINE, 0], [width, 0], [width, height], [SPINE, height]]
    .map(([x, y]) => ({ x, y, q: nx * x + ny * y }));
  const near = Math.min(...page.map(point => point.q)), far = Math.max(...page.map(point => point.q));
  const bend = Math.sin(Math.PI * progress) ** .64;
  const radius = Math.max(1, Math.min(29, width * .074) * bend);
  const crease = far - (far - near) * progress - (radius + 17) * progress ** 4;
  return { page, nx, ny, far, bend, radius, crease, front: restrict(page, crease, true) };
}

function printThrough(ctx, points, nx, ny, shift, width, data) {
  const report = data.reportBoardView;
  const heading = data.navigationTop + data.navigationHeight + 45;
  ctx.save();
  outline(ctx, points);
  ctx.clip();
  const diagonal = -2 * nx * ny;
  ctx.transform(1 - 2 * nx * nx, diagonal, diagonal, 1 - 2 * ny * ny, nx * shift, ny * shift);
  ctx.globalAlpha = .13;
  ctx.fillStyle = '#174435';
  ctx.font = 'bold 25px serif';
  ctx.fillText('小K', 72, data.navigationTop + 29);
  ctx.font = 'bold 27px serif';
  ctx.fillText(data.reportBoardTitle || '工地日报与周报', 34, heading + 43, width - 52);
  ctx.font = '13px sans-serif';
  ctx.fillText(report?.subtitle || '', 34, heading + 68, width - 52);
  if (report?.period) {
    ctx.textAlign = 'right';
    ctx.fillText(report.period, width - 18, heading + 68, width - 52);
  }
  ctx.textAlign = 'center';
  for (const [index, stat] of (report?.stats || []).entries()) {
    const x = 34 + (width - 52) * (index + .5) / report.stats.length;
    ctx.font = 'bold 29px sans-serif';
    ctx.fillText(stat.value, x, heading + 125);
    ctx.font = '13px sans-serif';
    ctx.fillText(stat.label, x, heading + 146);
  }
  ctx.restore();
}

/** Project a curved paper surface over the live report. Only the fold and shadow
 * are drawn here. The front and next page remain native, scrollable views. */
function drawPageCurl(surface, amount, angle, data) {
  const { context: ctx, width, height, density } = surface;
  const { page, nx, ny, far, bend, radius, crease, front } = fold(width, height, amount, angle);
  const arc = Math.PI * radius, backStarts = crease + arc;
  const gradient = (from, to) => ctx.createLinearGradient(nx * from, ny * from, nx * to, ny * to);
  const project = (point, q) => ({ x: point.x + nx * (q - point.q), y: point.y + ny * (q - point.q) });
  const back = restrict(page, backStarts, false);
  const reflected = back.map(point => project(point, crease + backStarts - point.q));

  ctx.clearRect(0, 0, width, height);
  const shadow = gradient(crease - 7, crease + radius + 40);
  shadow.addColorStop(0, 'rgba(65,52,37,0)');
  shadow.addColorStop(.36, 'rgba(65,52,37,' + .19 * bend + ')');
  shadow.addColorStop(.55, 'rgba(65,52,37,' + .26 * bend + ')');
  shadow.addColorStop(1, 'rgba(65,52,37,0)');
  ctx.fillStyle = shadow;
  ctx.fillRect(0, 0, width, height);

  if (reflected.length >= 3) {
    ctx.save();
    ctx.shadowColor = 'rgba(69,53,30,' + .27 * bend + ')';
    ctx.shadowBlur = 12 * bend * density;
    ctx.shadowOffsetY = 3 * bend * density;
    fill(ctx, reflected, light(1));
    ctx.restore();
  }
  const bands = 22;
  for (let index = 0; index < bands; index++) {
    const a = index / bands, b = (index + 1) / bands;
    const strip = restrict(restrict(page, crease + b * arc + .18, true), crease + a * arc - .18, false);
    if (strip.length < 3) continue;
    const curved = [];
    for (const [i, point] of strip.entries()) {
      const next = strip[(i + 1) % strip.length];
      const pieces = Math.max(1, Math.ceil(Math.abs(next.y - point.y) / 72));
      for (let j = 0; j < pieces; j++) {
        const t = j / pieces;
        const y = point.y + (next.y - point.y) * t, q = point.q + (next.q - point.q) * t;
        const wave = radius + 7 * bend * Math.sin(Math.PI * y / height);
        curved.push(project({ x: point.x + (next.x - point.x) * t, y, q }, crease + wave * Math.sin((q - crease) / radius)));
      }
    }
    const from = crease + radius * Math.sin(a * Math.PI), to = crease + radius * Math.sin(b * Math.PI);
    if (Math.abs(from - to) < .25) fill(ctx, curved, light((a + b) / 2));
    else {
      const tone = gradient(from, to);
      tone.addColorStop(0, light(a));
      tone.addColorStop(1, light(b));
      fill(ctx, curved, tone);
    }
  }
  if (reflected.length >= 3) {
    const backing = gradient(crease + backStarts - far, crease);
    backing.addColorStop(0, '#fbf7ed');
    backing.addColorStop(.6, '#f3ead7');
    backing.addColorStop(1, light(1));
    fill(ctx, reflected, backing);
    printThrough(ctx, reflected, nx, ny, crease + backStarts, width, data);
  }
  return front.length >= 3
    ? 'polygon(' + front.map(point => point.x.toFixed(1) + 'px ' + point.y.toFixed(1) + 'px').join(',') + ')'
    : 'inset(0 100% 0 0)';
}

module.exports = { clamp, topCornerAngle, drawPageCurl, fold };
