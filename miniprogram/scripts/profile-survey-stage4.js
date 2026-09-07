// Run this script in a device-capable JS host (or Node for a desktop baseline)
// with a prepared version-4 floor graph. It intentionally measures only pure
// graph/render work; Canvas and WeChat bridge time must be supplied by device QA.
const { performance } = require('node:perf_hooks');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const renderer = require('../packages/surveying/utils/surveyCanvasRenderer.js');

function profile(draft, options = {}) {
  const floor = surveyGraph.getActiveFloor(draft);
  const frames = Math.max(1, Number(options.frames || 60));
  const samples = [];
  const viewport = options.viewport || { scale: 0.08, offsetX: 0, offsetY: 0 };
  const rect = options.rect || { width: 390, height: 844 };
  for (let i = 0; i < frames; i += 1) {
    const started = performance.now();
    renderer.createSurveyRenderScene({ floor, session: floor.session, viewport, rect });
    samples.push(performance.now() - started);
  }
  const sorted = samples.slice().sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    frames,
    frameP50Ms: percentile(0.5),
    frameP95Ms: percentile(0.95),
    frameMaxMs: sorted[sorted.length - 1],
    heapUsedBytes: typeof process !== 'undefined' && process.memoryUsage
      ? process.memoryUsage().heapUsed : null,
    deviceCanvasBridgeMeasured: false
  };
}

module.exports = { profile };
