const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLatestFrameQueue } = require('../packages/surveying/utils/surveyViewportInteraction.js');

test('latest frame queue coalesces repeated viewport updates into one frame', () => {
  const callbacks = [];
  const rendered = [];
  const queue = createLatestFrameQueue({
    requestFrame(callback) {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancelFrame() {},
    onFrame(viewport) {
      rendered.push(viewport);
    }
  });

  queue.queue({ offsetX: 10 });
  queue.queue({ offsetX: 20 });
  queue.queue({ offsetX: 30 });

  assert.equal(callbacks.length, 1);
  assert.equal(rendered.length, 0);
  callbacks[0]();
  assert.deepEqual(rendered, [{ offsetX: 30 }]);
  assert.equal(queue.hasPendingFrame(), false);
});

test('latest frame queue cancels a pending viewport frame', () => {
  const callbacks = [];
  const cancelled = [];
  const rendered = [];
  const queue = createLatestFrameQueue({
    requestFrame(callback) {
      callbacks.push(callback);
      return 42;
    },
    cancelFrame(frameId) {
      cancelled.push(frameId);
    },
    onFrame(viewport) {
      rendered.push(viewport);
    }
  });

  queue.queue({ offsetY: 80 });
  queue.cancel();

  assert.deepEqual(cancelled, [42]);
  assert.equal(queue.hasPendingFrame(), false);
  assert.deepEqual(rendered, []);
});

test('editor keeps pan unrestricted and exposes a broad pinch zoom range', () => {
  const editorSource = fs.readFileSync(
    path.join(__dirname, '../packages/surveying/editor/surveying-editor.js'),
    'utf8'
  );

  assert.match(editorSource, /const MIN_SCALE = 0\.002;/);
  assert.match(editorSource, /const MAX_SCALE = 4;/);
  assert.doesNotMatch(editorSource, /constrainViewportToWorkspace/);
  assert.doesNotMatch(editorSource, /constrainViewportToSafeArea/);
  assert.match(editorSource, /offsetX: startViewport\.offsetX \+ dx/);
  assert.match(editorSource, /offsetY: startViewport\.offsetY \+ dy/);
});
