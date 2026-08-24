const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createLatestFrameQueue,
  resolveFormalDrawDecision
} = require('../packages/surveying/utils/surveyViewportInteraction.js');

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

test('formal draw decisions reject stale callbacks and defer during gesture ownership', () => {
  assert.equal(resolveFormalDrawDecision({
    expectedRevision: 4,
    currentRevision: 5,
    viewportInteractionActive: false
  }), 'stale');
  assert.equal(resolveFormalDrawDecision({
    expectedRevision: 5,
    currentRevision: 5,
    viewportInteractionActive: true
  }), 'defer');
  assert.equal(resolveFormalDrawDecision({
    expectedRevision: 5,
    currentRevision: 5,
    viewportInteractionActive: false
  }), 'draw');
  assert.equal(resolveFormalDrawDecision({
    disposed: true,
    expectedRevision: 5,
    currentRevision: 5
  }), 'drop');
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

test('editor rejects stale formal and canvas-init callbacks during viewport interaction', () => {
  const editorSource = fs.readFileSync(
    path.join(__dirname, '../packages/surveying/editor/surveying-editor.js'),
    'utf8'
  );

  assert.match(editorSource, /const renderRevision = this\.surveySceneRevision;/);
  assert.match(editorSource, /renderRevision !== this\.surveySceneRevision \|\| this\.surveyCanvasDisposed/);
  assert.match(editorSource, /this\.viewportInteraction && this\.transientCanvasMode === 'viewport'/);
  assert.match(editorSource, /this\.formalCanvasDrawPending = true;/);
  assert.match(editorSource, /initRevision !== this\.surveyCanvasInitRevision/);
  assert.match(editorSource, /initRevision !== this\.cursorCanvasInitRevision/);
  assert.match(editorSource, /rectRevision !== this\.canvasRectRevision/);
});

test('editor owns viewport frames from the primary Canvas and coalesces fallback sync', () => {
  const editorSource = fs.readFileSync(
    path.join(__dirname, '../packages/surveying/editor/surveying-editor.js'),
    'utf8'
  );

  assert.match(editorSource, /this\.initViewportInteractionFrameQueue\(canvas\);/);
  assert.match(editorSource, /canvas\.requestAnimationFrame\(onFrame\)/);
  assert.match(editorSource, /this\.scheduleViewportDraftSync\(\);/);
  assert.match(editorSource, /this\.flushViewportDraftSync\(\{ sync: true \}\);/);
  assert.match(editorSource, /this\.cancelViewportDraftSync\(\);/);
  assert.match(editorSource, /if \(!this\.surveyCtx \|\| !this\.canvasRect \|\| !this\.surveyRenderScene \|\| !this\.viewportInteractionFrameQueue\)/);

  const cursorInit = editorSource.match(/initCursorDragCanvas\(\) \{[\s\S]*?\n  \},\n\n  initViewportInteractionFrameQueue/);
  assert.ok(cursorInit, 'cursor Canvas initializer should remain separate from viewport frame ownership');
  assert.doesNotMatch(cursorInit[0], /viewportInteractionFrameQueue/);
});
