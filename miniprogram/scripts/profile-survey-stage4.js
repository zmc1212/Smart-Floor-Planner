// Run this script in a device-capable JS host (or Node for a desktop baseline)
// with a prepared version-4 floor graph. It intentionally measures only pure
// graph/render work; Canvas and WeChat bridge time must be supplied by device QA.
const { performance } = require('node:perf_hooks');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const renderer = require('../packages/surveying/utils/surveyCanvasRenderer.js');

const STAGE4_BUDGET = Object.freeze({
  frameP95Ms: 33.3,
  frameMaxMs: 50,
  heapDeltaBytes: 8 * 1024 * 1024
});

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
  const result = {
    frames,
    frameP50Ms: percentile(0.5),
    frameP95Ms: percentile(0.95),
    frameMaxMs: sorted[sorted.length - 1],
    heapUsedBytes: typeof process !== 'undefined' && process.memoryUsage
      ? process.memoryUsage().heapUsed : null,
    deviceCanvasBridgeMeasured: false,
    budget: evaluateBudget({
      frameP95Ms: percentile(0.95),
      frameMaxMs: sorted[sorted.length - 1],
      heapDeltaBytes: null
    })
  };
  return result;
}

function evaluateBudget(sample, budget = STAGE4_BUDGET) {
  const checks = {
    frameP95: Number.isFinite(sample.frameP95Ms) && sample.frameP95Ms <= budget.frameP95Ms,
    frameMax: Number.isFinite(sample.frameMaxMs) && sample.frameMaxMs <= budget.frameMaxMs,
    heap: sample.heapDeltaBytes == null || sample.heapDeltaBytes <= budget.heapDeltaBytes
  };
  return { checks, passed: Object.values(checks).every(Boolean), budget };
}

function evaluateDeviceSample(sample, budget = STAGE4_BUDGET) {
  if (!sample || !Number.isFinite(sample.canvasBridgeP95Ms) || !Number.isFinite(sample.canvasBridgeMaxMs)) {
    return { status: 'incomplete', reason: 'canvasBridgeSamplesRequired', checks: null, passed: false, budget };
  }
  const checks = {
    canvasBridgeP95: sample.canvasBridgeP95Ms <= budget.frameP95Ms,
    canvasBridgeMax: sample.canvasBridgeMaxMs <= budget.frameMaxMs,
    heap: Number.isFinite(sample.heapDeltaBytes) && sample.heapDeltaBytes <= budget.heapDeltaBytes,
    sustainedFrames: Number.isFinite(sample.frames) && sample.frames >= 300
  };
  return { status: 'complete', checks, passed: Object.values(checks).every(Boolean), budget };
}

module.exports = { STAGE4_BUDGET, evaluateBudget, evaluateDeviceSample, profile };
