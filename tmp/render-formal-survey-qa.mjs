import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const adminRequire = createRequire(new URL('../admin/package.json', import.meta.url));
const { loadEnvConfig } = adminRequire('@next/env');
const mongoose = adminRequire('mongoose');
const sharp = adminRequire('sharp');
const renderer = require('../miniprogram/utils/surveyCanvasRenderer.js');

const PLAN_ID = '6a59d32a89c78375996b51c2';
const WIDTH = 1400;
const HEIGHT = 1000;
const OUTPUT_SVG = resolve(process.cwd(), '..', 'tmp', 'formal-survey-qa.svg');
const OUTPUT_PNG = resolve(process.cwd(), '..', 'tmp', 'formal-survey-qa.png');

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function points(pointsValue) {
  return pointsValue.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}

function pathFromRings(rings) {
  return (rings || []).map((ring) => (
    `M ${ring.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')} Z`
  )).join(' ');
}

function localPoint(wall, x, y) {
  return {
    x: wall.startPoint.x + wall.direction.x * x + wall.localY.x * y,
    y: wall.startPoint.y + wall.direction.y * x + wall.localY.y * y
  };
}

function openingMarkup(opening) {
  const wall = opening.wall;
  const start = localPoint(wall, opening.startPx, opening.centerYPx);
  const end = localPoint(wall, opening.endPx, opening.centerYPx);
  const eraseWidth = Math.max(8, wall.thicknessPx + 6);
  const cut = `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#f8f8f8" stroke-width="${eraseWidth}"/>`;
  if (opening.type === 'window') {
    const rail = Math.max(3, wall.thicknessPx * 0.24);
    const rails = [-rail, 0, rail].map((offset) => {
      const railStart = localPoint(wall, opening.startPx, opening.centerYPx + offset);
      const railEnd = localPoint(wall, opening.endPx, opening.centerYPx + offset);
      return `<line x1="${railStart.x}" y1="${railStart.y}" x2="${railEnd.x}" y2="${railEnd.y}"/>`;
    }).join('');
    const jambs = [opening.startPx, opening.endPx].map((x) => {
      const jambStart = localPoint(wall, x, opening.centerYPx - rail);
      const jambEnd = localPoint(wall, x, opening.centerYPx + rail);
      return `<line x1="${jambStart.x}" y1="${jambStart.y}" x2="${jambEnd.x}" y2="${jambEnd.y}"/>`;
    }).join('');
    return `${cut}<g fill="none" stroke="#2f2f2f" stroke-width="1.5">${rails}${jambs}</g>`;
  }
  const hinge = start;
  const leafEnd = localPoint(wall, opening.startPx, opening.centerYPx + opening.widthPx);
  return `${cut}<g fill="none" stroke="#111827" stroke-width="2"><line x1="${hinge.x}" y1="${hinge.y}" x2="${leafEnd.x}" y2="${leafEnd.y}"/><path d="M ${leafEnd.x} ${leafEnd.y} Q ${(leafEnd.x + end.x) / 2} ${(leafEnd.y + end.y) / 2} ${end.x} ${end.y}" stroke-dasharray="4 3"/></g>`;
}

function dimensionMarkup(item) {
  const startExtension = item.extensionStart || item.startPoint;
  const endExtension = item.extensionEnd || item.endPoint;
  const start = item.startPoint;
  const end = item.endPoint;
  const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const fontSize = item.kind === 'opening-segment' ? 10 : 11;
  return `<g fill="none" stroke="#4b5563" stroke-width="1">
    <line x1="${startExtension.x}" y1="${startExtension.y}" x2="${start.x}" y2="${start.y}"/>
    <line x1="${endExtension.x}" y1="${endExtension.y}" x2="${end.x}" y2="${end.y}"/>
    <line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" marker-start="url(#arrow-start)" marker-end="url(#arrow-end)"/>
    <text x="${middle.x}" y="${middle.y}" fill="#111" stroke="#f8f8f8" stroke-width="4" paint-order="stroke" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}">${escapeXml(item.label)}</text>
  </g>`;
}

loadEnvConfig(process.cwd());
await mongoose.connect(process.env.MONGODB_URI);
try {
  const plan = await mongoose.connection.collection('floorplans').findOne(
    { _id: new mongoose.Types.ObjectId(PLAN_ID) },
    { projection: { name: 1, layoutData: 1 } }
  );
  if (!plan) throw new Error(`Floor plan ${PLAN_ID} was not found.`);
  const graph = plan.layoutData && plan.layoutData.surveyGraph;
  const floor = graph && ((graph.floors || []).find((item) => item.id === graph.activeFloorId) || graph.floors[0]);
  if (!floor) throw new Error('The formal survey graph has no floor.');

  const xs = floor.nodes.map((node) => Number(node.xMm));
  const ys = floor.nodes.map((node) => Number(node.yMm));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(0.085, (WIDTH - 360) / Math.max(1, maxX - minX), (HEIGHT - 280) / Math.max(1, maxY - minY));
  const viewport = {
    scale,
    offsetX: -((minX + maxX) / 2) * scale,
    offsetY: -((minY + maxY) / 2) * scale
  };
  const session = { ...(floor.session || {}), selectedWallId: '', selectedOpeningId: '', state: 'spaceClosed' };
  const scene = renderer.createSurveyRenderScene({ floor, session, viewport, rect: { width: WIDTH, height: HEIGHT } });
  const benchmarkRuns = 50;
  const benchmarkStart = performance.now();
  for (let index = 0; index < benchmarkRuns; index += 1) {
    renderer.createSurveyRenderScene({ floor, session, viewport, rect: { width: WIDTH, height: HEIGHT } });
  }
  const averageRenderPlanMs = (performance.now() - benchmarkStart) / benchmarkRuns;

  const roomFills = scene.closedSpaceFills.map((space) => `<polygon points="${points(space.points)}" fill="#d1d1cf"/>`).join('');
  const walls = `<path d="${pathFromRings(scene.wallSolidPlan.rings)}" fill="#8e8e8c" fill-rule="nonzero" stroke="#1f1f1f" stroke-width="2" stroke-linejoin="miter"/>`;
  const openings = scene.openings.map(openingMarkup).join('');
  const dimensions = scene.dimensions.filter((item) => item.startPoint && item.endPoint).map(dimensionMarkup).join('');
  const labels = scene.closedSpaceLabels.map((label) => `<g text-anchor="middle" fill="#111">
    <text x="${label.centroid.x}" y="${label.centroid.y - 10}" font-size="14" font-weight="700">${escapeXml(label.roomName)}</text>
    <text x="${label.centroid.x}" y="${label.centroid.y + 7}" font-size="10">H=${label.ceilingHeightMm}mm</text>
    <text x="${label.centroid.x}" y="${label.centroid.y + 21}" font-size="10">S=${label.areaM2}m2</text>
  </g>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M 25 0 L 0 0 0 25" fill="none" stroke="#e6e7e8" stroke-width="0.7"/></pattern>
      <marker id="arrow-start" markerWidth="6" markerHeight="6" refX="1" refY="3" orient="auto"><path d="M 6 0 L 0 3 L 6 6 Z" fill="#374151"/></marker>
      <marker id="arrow-end" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M 0 0 L 6 3 L 0 6 Z" fill="#374151"/></marker>
    </defs>
    <rect width="100%" height="100%" fill="#f8f8f8"/>
    <rect width="100%" height="100%" fill="url(#grid)"/>
    <text x="30" y="36" font-family="sans-serif" font-size="18" font-weight="700" fill="#111">${escapeXml(plan.name)} - renderer QA</text>
    <g font-family="sans-serif">${roomFills}${walls}${openings}${dimensions}${labels}</g>
  </svg>`;
  await writeFile(OUTPUT_SVG, svg, 'utf8');
  await sharp(Buffer.from(svg)).png().toFile(OUTPUT_PNG);
  console.log(JSON.stringify({
    output: OUTPUT_PNG,
    rings: scene.wallSolidPlan.rings.length,
    dimensions: scene.dimensions.length,
    openings: scene.openings.length,
    averageRenderPlanMs: Number(averageRenderPlanMs.toFixed(2))
  }));
} finally {
  await mongoose.disconnect();
}
