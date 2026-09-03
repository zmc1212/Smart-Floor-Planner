const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const {
  createLargeGridDraft,
  surveyGraph
} = require('../test/fixtures/survey-kernel-baseline/representative-fixtures.js');

const baselinePath = path.resolve(
  __dirname,
  '../test/fixtures/survey-kernel-baseline/performance-baseline.json'
);
const DEFAULT_COLUMNS = 20;
const DEFAULT_ROWS = 12;
const ITERATIONS = Object.freeze({
  cloneDraft: 30,
  quickValidation: 30,
  fullValidation: 8,
  wallReadModels: 20,
  spaceReadModels: 8
});

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * ratio) - 1);
  return sortedValues[index];
}

function roundMetric(value) {
  return Math.round(value * 1000) / 1000;
}

function measure(name, iterations, execute) {
  execute();
  execute();
  const samplesMs = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    execute();
    samplesMs.push(performance.now() - startedAt);
  }
  samplesMs.sort((first, second) => first - second);
  return {
    name,
    iterations,
    minMs: roundMetric(samplesMs[0]),
    medianMs: roundMetric(percentile(samplesMs, 0.5)),
    p95Ms: roundMetric(percentile(samplesMs, 0.95)),
    maxMs: roundMetric(samplesMs[samplesMs.length - 1])
  };
}

function wallReadModels(floor) {
  floor.walls.forEach((wall) => {
    surveyGraph.buildWallSnapGeometry(floor, wall);
    surveyGraph.buildWallRenderGeometry(floor, wall);
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    surveyGraph.projectWallFaces(wall, start, end, wall.thicknessMm, null);
    surveyGraph.measuredReadingMm(surveyGraph.distanceMm(start, end), wall);
  });
}

function spaceReadModels(draft, floor) {
  floor.spaces.forEach((space) => {
    surveyGraph.buildSpaceBoundaryPoints(floor, space.wallIds);
    surveyGraph.buildSpaceInnerBoundaryPoints(floor, space);
    surveyGraph.buildSpaceRenderBoundaryPoints(floor, space);
    surveyGraph.buildSpaceDimensionPlan(floor, space);
    surveyGraph.calculateSpaceAreaMm2(draft, space.id);
  });
}

function deriveTimeThreshold(metric) {
  return Math.ceil(Math.max(metric.p95Ms * 4, metric.maxMs + 25));
}

function captureBenchmark() {
  const draft = createLargeGridDraft(DEFAULT_COLUMNS, DEFAULT_ROWS);
  const floor = surveyGraph.getActiveFloor(draft);
  const fullValidation = surveyGraph.validateSurveyDraft(draft, { mode: 'full' });
  if (!fullValidation.valid) {
    throw new Error(`Large-grid benchmark fixture is invalid: ${fullValidation.errors[0].code}`);
  }

  const metrics = [
    measure('cloneDraft', ITERATIONS.cloneDraft, () => surveyGraph.cloneDraft(draft)),
    measure('quickValidation', ITERATIONS.quickValidation, () => {
      const result = surveyGraph.validateSurveyDraft(draft, { mode: 'quick' });
      if (!result.valid) throw new Error('Quick validation failed during benchmark');
    }),
    measure('fullValidation', ITERATIONS.fullValidation, () => {
      const result = surveyGraph.validateSurveyDraft(draft, { mode: 'full' });
      if (!result.valid) throw new Error('Full validation failed during benchmark');
    }),
    measure('wallReadModels', ITERATIONS.wallReadModels, () => wallReadModels(floor)),
    measure('spaceReadModels', ITERATIONS.spaceReadModels, () => spaceReadModels(draft, floor))
  ];

  if (typeof global.gc === 'function') global.gc();
  const heapUsedBeforeBytes = process.memoryUsage().heapUsed;
  const retained = [];
  for (let index = 0; index < 8; index += 1) retained.push(surveyGraph.cloneDraft(draft));
  const heapUsedPeakBytes = process.memoryUsage().heapUsed;
  retained.length = 0;
  if (typeof global.gc === 'function') global.gc();
  const heapUsedAfterGcBytes = process.memoryUsage().heapUsed;
  const retainedHeapDeltaBytes = Math.max(0, heapUsedPeakBytes - heapUsedBeforeBytes);

  return {
    schemaVersion: 1,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuModel: (os.cpus()[0] && os.cpus()[0].model) || 'unknown',
      logicalCpuCount: os.cpus().length,
      gcExposed: typeof global.gc === 'function'
    },
    scenario: {
      columns: DEFAULT_COLUMNS,
      rows: DEFAULT_ROWS,
      nodes: floor.nodes.length,
      walls: floor.walls.length,
      spaces: floor.spaces.length,
      openings: floor.openings.length
    },
    metrics,
    memory: {
      retainedCloneCount: 8,
      heapUsedBeforeBytes,
      heapUsedPeakBytes,
      heapUsedAfterGcBytes,
      retainedHeapDeltaBytes
    },
    thresholds: {
      policy: 'time = max(4 x observed p95, observed max + 25 ms); retained heap = max(4 x observed delta, observed delta + 16 MiB)',
      metricsMs: Object.fromEntries(metrics.map((metric) => [metric.name, deriveTimeThreshold(metric)])),
      retainedHeapDeltaBytes: Math.ceil(Math.max(
        retainedHeapDeltaBytes * 4,
        retainedHeapDeltaBytes + 16 * 1024 * 1024
      ))
    }
  };
}

function compareWithBaseline(actual, baseline) {
  const failures = [];
  const thresholds = baseline.thresholds || {};
  const timeThresholds = thresholds.metricsMs || {};
  actual.metrics.forEach((metric) => {
    const threshold = Number(timeThresholds[metric.name]);
    if (!Number.isFinite(threshold)) {
      failures.push(`${metric.name}: missing threshold`);
    } else if (metric.p95Ms > threshold) {
      failures.push(`${metric.name}: p95 ${metric.p95Ms} ms > ${threshold} ms`);
    }
  });
  const memoryThreshold = Number(thresholds.retainedHeapDeltaBytes);
  if (!Number.isFinite(memoryThreshold)) {
    failures.push('retainedHeapDeltaBytes: missing threshold');
  } else if (actual.memory.retainedHeapDeltaBytes > memoryThreshold) {
    failures.push(
      `retainedHeapDeltaBytes: ${actual.memory.retainedHeapDeltaBytes} > ${memoryThreshold}`
    );
  }
  return failures;
}

function summarize(result) {
  const lines = [
    `Scenario: ${result.scenario.nodes} nodes / ${result.scenario.walls} walls / ${result.scenario.spaces} spaces`
  ];
  result.metrics.forEach((metric) => {
    lines.push(`${metric.name}: median ${metric.medianMs} ms, p95 ${metric.p95Ms} ms, max ${metric.maxMs} ms`);
  });
  lines.push(`Retained-clone heap delta: ${result.memory.retainedHeapDeltaBytes} bytes`);
  return lines.join('\n');
}

function main() {
  const actual = captureBenchmark();
  if (process.argv.includes('--write')) {
    fs.writeFileSync(baselinePath, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
    process.stdout.write(`${summarize(actual)}\nWrote ${path.relative(process.cwd(), baselinePath)}\n`);
    return;
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  if (!fs.existsSync(baselinePath)) {
    process.stderr.write(`Missing ${path.relative(process.cwd(), baselinePath)}; run with --write once.\n`);
    process.exitCode = 1;
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const failures = compareWithBaseline(actual, baseline);
  process.stdout.write(`${summarize(actual)}\n`);
  if (failures.length) {
    process.stderr.write(`Performance baseline exceeded:\n- ${failures.join('\n- ')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Survey kernel Phase 0 performance thresholds pass.\n');
}

if (require.main === module) main();

module.exports = {
  baselinePath,
  captureBenchmark,
  compareWithBaseline,
  deriveTimeThreshold,
  main
};
