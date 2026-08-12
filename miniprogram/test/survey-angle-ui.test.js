const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pageDir = path.join(__dirname, '..', 'packages', 'surveying', 'editor');
const wxml = fs.readFileSync(path.join(pageDir, 'surveying-editor.wxml'), 'utf8');
const pageScript = fs.readFileSync(path.join(pageDir, 'surveying-editor.js'), 'utf8');

test('angle measurement uses one sheet for phone, manual, and Pythagorean states', () => {
  assert.match(wxml, /<view wx:if="\{\{numberPadVisible && angleMeasureVisible\}\}" class="number-pad-panel angle-sheet-panel">/);
  assert.match(wxml, /<cover-view wx:if="\{\{numberPadVisible && !angleMeasureVisible\}\}" class="number-pad-panel native-canvas-overlay">/);
  assert.doesNotMatch(wxml, /<cover-view[^>]*angle-sheet-panel/);
  assert.match(wxml, />手机测量</);
  assert.match(wxml, />勾股定理</);
  assert.match(wxml, /wx:if="\{\{!angleManualInputVisible\}\}" class="angle-measure-tools"/);
  assert.match(wxml, /bindtap="onAngleManualInput"/);
  assert.match(wxml, /bindtap="onAngleManualInputBack"/);
  assert.match(wxml, /angleTriangleMeasuringSide === 'a'/);
  assert.match(wxml, /angleTriangleResult \|\| '--'/);
  assert.match(wxml, /wx:if="\{\{!numberPadVisible\}\}" class="history-action-bar/);
  assert.match(wxml, /wx:if="\{\{!numberPadVisible\}\}" class="bottom-fab-bar/);
  assert.match(wxml, /cursorPlacementState === 'dragging' && cursorLensVisible \? 'cursor-lens-visible' : 'cursor-lens-hidden'/);
});

test('angle measurement keeps real sensor and BLE lifecycle handlers', () => {
  assert.match(pageScript, /onAngleManualInput\(\)[\s\S]*stopPhoneAngleMeasurement\(\)/);
  assert.match(pageScript, /onAngleMeasureTab\(e\)[\s\S]*clearBleMeasureTimers\(\)/);
  assert.match(pageScript, /if \(target === 'ignore'\) return/);
  assert.match(pageScript, /angleTriangleAmm: nextTriangle\.a \? String\(Math\.round\(nextTriangle\.a \* 1000\)\)/);
  assert.match(pageScript, /onNumberClose\(\)[\s\S]*stopPhoneAngleMeasurement\(\)/);
});

test('angle sheet raster icons are valid PNG files within the product budget', () => {
  const iconDir = path.join(__dirname, '..', 'packages', 'surveying', 'assets', 'icons', 'angle');
  const iconNames = ['bluetooth.png', 'circle-check.png', 'crosshair.png', 'phone-level.png', 'refresh-cw.png'];
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  iconNames.forEach((name) => {
    const bytes = fs.readFileSync(path.join(iconDir, name));
    assert.equal(bytes.subarray(0, 8).equals(pngSignature), true, `${name} must be a PNG`);
    assert.ok(bytes.length <= 10 * 1024, `${name} must stay within the 10KB icon budget`);
  });
});
