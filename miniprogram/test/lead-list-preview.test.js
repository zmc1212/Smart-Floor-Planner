const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const {
  buildFloorPlanPreview,
  resolveProtectedPreviewEndpoint,
} = require('../components/lead-list/lead-list-model.js');
const listScript = fs.readFileSync(
  path.join(root, 'components', 'lead-list', 'lead-list.js'),
  'utf8'
);

test('lead list preview prefers formal previewUrl over external thumbnails', () => {
  const lead = {
    _id: 'lead-1',
    primaryFloorPlanId: {
      _id: 'fp-1',
      previewUrl: '/api/floorplans/fp-1/preview',
      externalSource: { previewUrl: 'https://kujiale.example/plan.png' },
      layoutData: { version: 4, measurementMode: 'surveying', surveyGraph: { floors: [] } },
    },
  };

  assert.equal(
    resolveProtectedPreviewEndpoint(lead.primaryFloorPlanId),
    '/floorplans/fp-1/preview'
  );

  const preview = buildFloorPlanPreview(lead);
  assert.equal(preview.type, 'protected');
  assert.equal(preview.previewEndpoint, '/floorplans/fp-1/preview');
  assert.equal(preview.previewUrl, '');
});

test('lead list falls back to external preview when formal previewUrl is absent', () => {
  const lead = {
    _id: 'lead-2',
    primaryFloorPlanId: {
      _id: 'fp-2',
      externalSource: { previewUrl: 'https://kujiale.example/plan.png' },
      layoutData: { version: 4, measurementMode: 'surveying', surveyGraph: { floors: [] } },
    },
  };

  const preview = buildFloorPlanPreview(lead);
  assert.equal(preview.type, 'image');
  assert.equal(preview.previewUrl, 'https://kujiale.example/plan.png');
  assert.equal(preview.previewEndpoint, '');
});

test('lead list loads protected thumbnails through fetchProtectedImage', () => {
  assert.match(listScript, /buildFloorPlanPreview/);
  assert.match(listScript, /loadProtectedPlanPreviews/);
  assert.match(listScript, /planPreview\.type === 'protected'/);
  assert.match(listScript, /fetchProtectedImage/);
  assert.match(listScript, /floorPlanCacheKey/);
});
