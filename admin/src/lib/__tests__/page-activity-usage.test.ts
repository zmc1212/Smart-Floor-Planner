import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(__dirname, '../..');

function source(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('lead-pool uses visibility and idle gated polling instead of a raw interval', () => {
  const page = source('app/(admin)/(merchant)/lead-pool/page.tsx');
  assert.match(page, /usePagePolling/);
  assert.match(page, /LEAD_POOL_POLL_INTERVAL_MS/);
  assert.match(page, /LEAD_POOL_CLOCK_INTERVAL_MS/);
  assert.match(page, /LEAD_POOL_IDLE_MS/);
  assert.doesNotMatch(page, /window\.setInterval\(\(\) => void loadPool/);
  assert.doesNotMatch(page, /window\.setInterval\(\(\) => setClock/);
});

test('AI creation and workbench status polls share the same tab-activity gate', () => {
  const creation = source('components/ai-creation/creation-workspace.tsx');
  const workbench = source('components/ai-studio/workbench-workspace.tsx');
  const floorPlanStatus = source('app/(admin)/(merchant)/ai-studio/floor-plan/[id]/page.tsx');
  assert.match(creation, /usePagePolling/);
  assert.match(creation, /AI_CREATION_POLL_INTERVAL_MS/);
  assert.match(creation, /AI_PAGE_IDLE_MS/);
  assert.doesNotMatch(creation, /setTimeout\(poll,/);
  assert.match(workbench, /usePagePolling/);
  assert.match(workbench, /AI_WORKBENCH_POLL_INTERVAL_MS/);
  assert.match(workbench, /AI_PAGE_IDLE_MS/);
  assert.doesNotMatch(workbench, /setTimeout\(poll,/);
  assert.match(floorPlanStatus, /usePagePolling/);
  assert.match(floorPlanStatus, /AI_STATUS_POLL_INTERVAL_MS/);
  assert.doesNotMatch(floorPlanStatus, /setInterval\(fetchStatus/);
});
