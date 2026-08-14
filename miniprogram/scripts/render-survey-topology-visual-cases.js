const path = require('node:path');
const sharp = require('../../admin/node_modules/sharp');
const { RECT, buildVisualCases } = require('../test/helpers/surveyTopologyVisualCases.js');

const outputPath = path.resolve(
  __dirname,
  '../../tmp/survey-topology-visual-regression.png'
);
const panelScale = 0.72;
const panelWidth = Math.round(RECT.width * panelScale);
const panelHeight = Math.round(RECT.height * panelScale);
const headerHeight = 42;
const gutter = 18;

function escape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function linePath(start, end) {
  return `M${start.x.toFixed(3)} ${start.y.toFixed(3)} L${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

function polygonMarkup(polygons, fill) {
  return (polygons || []).map((polygon) => (
    `<polygon points="${polygon.map((point) => `${point.x},${point.y}`).join(' ')}" fill="${fill}"/>`
  )).join('');
}

function renderScene(caseItem, index) {
  const column = index % 3;
  const row = Math.floor(index / 3);
  const x = gutter + column * (panelWidth + gutter);
  const y = gutter + row * (panelHeight + headerHeight + gutter);
  const scene = caseItem.scene;
  const closedPolygons = polygonMarkup(scene.wallSolidPlans.closed.polygons, '#8e8e8c');
  const unionUnderpaint = polygonMarkup(scene.wallSolidPlan.polygons, '#e2e2e0');
  const outlineSegments = (scene.wallSolidPlan.segments || []).map((segment) => (
    `<path d="${linePath(segment.start, segment.end)}" fill="none" stroke="#1f1f1f" stroke-width="1.5" stroke-linecap="butt"/>`
  )).join('');
  const redlines = scene.walls.filter((wall) => wall.isActiveMeasurement).map((wall) => {
    const start = wall.measurementStartPoint || wall.startPoint;
    const end = wall.measurementEndPoint || wall.endPoint;
    return `<path d="${linePath(start, end)}" fill="none" stroke="#e94b50" stroke-width="2"/>`;
  }).join('');
  const roomFills = (scene.closedSpaceFills || []).map((space) => (
    `<polygon points="${space.points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="#d1d1cf" fill-opacity="0.86"/>`
  )).join('');

  return `
    <g transform="translate(${x} ${y + headerHeight}) scale(${panelScale})">
      <rect x="0" y="0" width="${RECT.width}" height="${RECT.height}" rx="12" fill="#fcfffc" stroke="#d7ded8" stroke-width="1.5"/>
      ${roomFills}
      ${unionUnderpaint}
      ${closedPolygons}
      ${outlineSegments}
      ${redlines}
      <circle cx="${caseItem.junctionPx.x}" cy="${caseItem.junctionPx.y}" r="24" fill="none" stroke="#00b864" stroke-width="1.5" stroke-dasharray="5 4"/>
    </g>
    <text x="${x}" y="${y + 26}" fill="#18221c" font-family="Arial, sans-serif" font-size="15" font-weight="700">${escape(caseItem.name)}</text>
  `;
}

async function main() {
  const cases = buildVisualCases();
  const columns = 3;
  const rows = Math.ceil(cases.length / columns);
  const width = gutter + columns * (panelWidth + gutter);
  const height = gutter + rows * (panelHeight + headerHeight + gutter);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#f2f5f2"/>
      ${cases.map(renderScene).join('')}
    </svg>
  `;
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
