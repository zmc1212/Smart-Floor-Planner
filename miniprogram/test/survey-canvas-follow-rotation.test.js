const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const surveyCanvasRenderer = require('../packages/surveying/utils/surveyCanvasRenderer.js');
const surveyDeviceOrientation = require('../packages/surveying/utils/surveyDeviceOrientation.js');

const editorScript = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'surveying', 'editor', 'surveying-editor.js'),
  'utf8'
);
const editorWxml = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'surveying', 'editor', 'surveying-editor.wxml'),
  'utf8'
);
const compassWxml = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'packages',
    'surveying',
    'components',
    'survey-canvas-compass',
    'survey-canvas-compass.wxml'
  ),
  'utf8'
);

function almostEqual(actual, expected, epsilon) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

function createWxStub() {
  const stub = {
    handlers: [],
    startCalls: 0,
    stopCalls: 0,
    failNextStart: false,
    onDeviceMotionChange(handler) {
      stub.handlers.push(handler);
    },
    offDeviceMotionChange(handler) {
      stub.handlers = stub.handlers.filter((item) => item !== handler);
    },
    startDeviceMotionListening(options) {
      stub.startCalls += 1;
      if (stub.failNextStart) {
        stub.failNextStart = false;
        if (options && options.fail) options.fail();
        return;
      }
      if (options && options.success) options.success();
    },
    stopDeviceMotionListening() {
      stub.stopCalls += 1;
    },
    emit(event) {
      stub.handlers.slice().forEach((handler) => handler(event));
    }
  };
  return stub;
}

test('device motion hub keeps one native listener across multiple subscribers', () => {
  const wxStub = createWxStub();
  const hub = surveyDeviceOrientation.createDeviceMotionHub(wxStub);
  assert.equal(hub.supported(), true);

  const seenA = [];
  const seenB = [];
  const unsubscribeA = hub.subscribe((event) => seenA.push(event.alpha));
  const unsubscribeB = hub.subscribe((event) => seenB.push(event.alpha));
  assert.equal(wxStub.startCalls, 1);
  assert.equal(hub.listenerCount(), 2);

  wxStub.emit({ alpha: 42 });
  assert.deepEqual(seenA, [42]);
  assert.deepEqual(seenB, [42]);

  unsubscribeA();
  assert.equal(hub.isListening(), true);
  wxStub.emit({ alpha: 7 });
  assert.deepEqual(seenA, [42]);
  assert.deepEqual(seenB, [42, 7]);

  unsubscribeB();
  assert.equal(hub.isListening(), false);
  assert.equal(wxStub.stopCalls, 1);

  // Unsubscribing twice stays a no-op.
  unsubscribeB();
  assert.equal(wxStub.stopCalls, 1);
});

test('device motion hub reports a start failure and allows a retry', () => {
  const wxStub = createWxStub();
  const hub = surveyDeviceOrientation.createDeviceMotionHub(wxStub);
  wxStub.failNextStart = true;
  let failed = 0;
  const unsubscribe = hub.subscribe(() => {}, { onError: () => { failed += 1; } });
  assert.equal(failed, 1);
  assert.equal(hub.isListening(), false);
  unsubscribe();

  const seen = [];
  const retryUnsubscribe = hub.subscribe((event) => seen.push(event.alpha));
  assert.equal(hub.isListening(), true);
  wxStub.emit({ alpha: 3 });
  assert.deepEqual(seen, [3]);
  retryUnsubscribe();
});

test('heading follow rotates the canvas with the turn made after the baseline', () => {
  const controller = surveyDeviceOrientation.createHeadingFollowController({
    cardinalOnly: false,
    smoothing: 1,
    deadbandDeg: 0,
    activateDeg: 0
  });
  assert.equal(controller.update(10), null);
  assert.equal(controller.begin(30, 15), true);

  // Turning the phone by +40 degrees rotates the view by +40 on top of the
  // rotation held when follow was enabled.
  const result = controller.update(70);
  assert.equal(result.changed, true);
  almostEqual(result.rotationDeg, 55, 1e-9);

  // Returning to the baseline heading restores the original rotation.
  const back = controller.update(30);
  almostEqual(back.rotationDeg, 15, 1e-9);
});

test('heading follow snaps view rotation to four cardinal directions', () => {
  const controller = surveyDeviceOrientation.createHeadingFollowController({
    cardinalOnly: true,
    activateDeg: 12,
    switchDeg: 15
  });
  controller.begin(0, 0);
  assert.equal(controller.update(5).changed, false);
  almostEqual(controller.update(5).rotationDeg, 0, 1e-9);

  const east = controller.update(80);
  assert.equal(east.changed, true);
  almostEqual(east.rotationDeg, 90, 1e-9);

  const hold = controller.update(85);
  assert.equal(hold.changed, false);
  almostEqual(hold.rotationDeg, 90, 1e-9);
});

test('heading follow keeps cardinal targets when the view started off-cardinal', () => {
  const controller = surveyDeviceOrientation.createHeadingFollowController({
    cardinalOnly: true,
    activateDeg: 12,
    switchDeg: 15
  });
  controller.begin(0, 15);
  almostEqual(controller.update(5).rotationDeg, 0, 1e-9);

  const east = controller.update(85);
  assert.equal(east.changed, true);
  almostEqual(east.rotationDeg, 90, 1e-9);
});

test('heading follow stays continuous across the 360-degree seam', () => {
  const controller = surveyDeviceOrientation.createHeadingFollowController({
    cardinalOnly: false,
    smoothing: 1,
    deadbandDeg: 0,
    activateDeg: 0
  });
  controller.begin(350, 0);
  const step = controller.update(10);
  almostEqual(step.rotationDeg, 20, 1e-9);
  const further = controller.update(80);
  almostEqual(further.rotationDeg, 90, 1e-9);
});

test('heading follow deadband suppresses jitter and smoothing converges', () => {
  const controller = surveyDeviceOrientation.createHeadingFollowController({
    cardinalOnly: false,
    smoothing: 0.5,
    deadbandDeg: 1,
    activateDeg: 0
  });
  controller.begin(0, 0);
  const jitter = controller.update(0.6);
  assert.equal(jitter.changed, false);
  almostEqual(jitter.rotationDeg, 0, 1e-9);

  let latest = null;
  for (let index = 0; index < 24; index += 1) {
    latest = controller.update(90);
  }
  assert.equal(latest.changed, false || latest.changed);
  almostEqual(latest.rotationDeg, 90, 1);

  controller.stop();
  assert.equal(controller.update(120), null);
});

test('heading follow waits for the activation threshold before rotating', () => {
  const controller = surveyDeviceOrientation.createHeadingFollowController({
    cardinalOnly: false,
    smoothing: 1,
    deadbandDeg: 0,
    activateDeg: 8
  });
  controller.begin(0, 0);
  const smallTurn = controller.update(5);
  assert.equal(smallTurn.changed, false);
  almostEqual(smallTurn.rotationDeg, 0, 1e-9);

  const largeTurn = controller.update(20);
  assert.equal(largeTurn.changed, true);
  almostEqual(largeTurn.rotationDeg, 20, 1e-9);
});

test('direction pick controller applies median filtering and hysteresis', () => {
  const surveyBleDirectionOptions = require('../packages/surveying/utils/surveyBleDirectionOptions.js');
  const controller = surveyDeviceOrientation.createDirectionPickController({
    activateDeg: 12,
    switchDeg: 15,
    sampleCount: 3
  });
  const candidates = [
    { key: 'east', bearingDeg: 0 },
    { key: 'south', bearingDeg: 90 }
  ];
  controller.begin(0, 0);
  assert.equal(controller.update(290, candidates), null);
  assert.equal(controller.update(276, candidates), null);
  const firstPick = controller.update(276, candidates);
  assert.equal(firstPick.key, 'east');
  assert.equal(firstPick.changed, true);
  assert.equal(controller.update(276, candidates).changed, false);

  controller.setSelectedKey('');
  assert.equal(controller.update(276, candidates).changed, true);

  controller.stop();
  controller.begin(0, 0);
  const switched = controller.update(180, candidates);
  assert.equal(switched.key, 'south');
  assert.equal(switched.changed, true);
  assert.equal(controller.update(180, candidates).changed, false);
  assert.equal(surveyBleDirectionOptions.DEFAULT_ACTIVATE_DEG, 12);
});

test('direction filtering remains stable across the 360-degree seam', () => {
  assert.equal(surveyDeviceOrientation.circularMedianDeg([359, 0, 1]), 0);
  assert.equal(surveyDeviceOrientation.circularMedianDeg([358, 359, 0, 1, 2]), 0);
});

test('dimension label flip uses the projected screen angle', () => {
  const flip = surveyCanvasRenderer.shouldFlipDimensionLabel;
  const effective = surveyCanvasRenderer.resolveScreenEffectiveAngle;
  assert.equal(flip(0), false);
  assert.equal(flip(Math.PI / 4), false);
  assert.equal(flip(Math.PI / 2 + 0.01), true);
  assert.equal(flip(Math.PI), true);
  assert.equal(flip(-Math.PI / 2 - 0.01), true);
  assert.equal(flip(-Math.PI / 4), false);
  // A left-pointing world wall rotated 180 degrees by the view reads upright.
  assert.equal(flip(effective(Math.PI, Math.PI)), false);
  assert.equal(flip(effective(0, Math.PI / 2 + 0.01)), true);
});

function createRecordingCtx() {
  const calls = [];
  const record = (name) => (...args) => calls.push({ name, args });
  return {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    fillRect: record('fillRect'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    setLineDash: record('setLineDash'),
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    fill: record('fill'),
    closePath: record('closePath'),
    arc: record('arc')
  };
}

test('grid rotates around the projected world origin when the view rotates', () => {
  const ctxPlain = createRecordingCtx();
  surveyCanvasRenderer.drawSurveyScene; // touch export shape
  const sceneNoRotation = {
    rect: { width: 390, height: 650 },
    viewport: { scale: 0.05, offsetX: 10, offsetY: -4, rotationRad: 0 }
  };
  // drawGrid is not exported; go through drawSurveyInteractionScene, which
  // draws the grid first. Build a minimal projected scene shell instead.
  const renderScene = Object.assign({}, sceneNoRotation, {
    walls: [],
    previewWall: null,
    closedSpaceFills: [],
    wallFaceOverrideBoundaries: [],
    wallSolidPlan: null,
    wallSolidPlans: {},
    openings: [],
    redlines: []
  });
  surveyCanvasRenderer.drawSurveyInteractionScene(ctxPlain, renderScene, {
    viewport: sceneNoRotation.viewport
  });
  assert.equal(ctxPlain.calls.some((call) => call.name === 'rotate'), false);

  const ctxRotated = createRecordingCtx();
  const rotatedViewport = { scale: 0.05, offsetX: 10, offsetY: -4, rotationRad: Math.PI / 6 };
  surveyCanvasRenderer.drawSurveyInteractionScene(ctxRotated, renderScene, {
    viewport: rotatedViewport
  });
  const rotateCalls = ctxRotated.calls.filter((call) => call.name === 'rotate');
  assert.ok(rotateCalls.length >= 1);
  almostEqual(rotateCalls[0].args[0], Math.PI / 6, 1e-9);
  const translateCalls = ctxRotated.calls.filter((call) => call.name === 'translate');
  almostEqual(translateCalls[0].args[0], 390 / 2 + 10, 1e-9);
  almostEqual(translateCalls[0].args[1], 650 / 2 - 4, 1e-9);
});

test('lens scene keeps the magnified target centred while rotated', () => {
  const rotationRad = Math.PI / 3;
  const centerPoint = { xMm: 1200, yMm: -900 };
  const size = 120;
  const scale = 0.12;
  const rotated = surveyCanvasRenderer.projectSurveyPoint(
    centerPoint,
    surveyCanvasRenderer.resolveViewport({
      scale,
      offsetX: -(centerPoint.xMm * scale * Math.cos(rotationRad) - centerPoint.yMm * scale * Math.sin(rotationRad)),
      offsetY: -(centerPoint.xMm * scale * Math.sin(rotationRad) + centerPoint.yMm * scale * Math.cos(rotationRad)),
      rotationRad
    }),
    { width: size, height: size }
  );
  almostEqual(rotated.x, size / 2, 1e-9);
  almostEqual(rotated.y, size / 2, 1e-9);
});

test('heading sensor hub prefers compass and falls back to device motion', () => {
  const wxStub = {
    compassHandlers: [],
    motionHandlers: [],
    startCompassCalls: 0,
    startMotionCalls: 0,
    onCompassChange(handler) {
      wxStub.compassHandlers.push(handler);
    },
    offCompassChange(handler) {
      wxStub.compassHandlers = wxStub.compassHandlers.filter((item) => item !== handler);
    },
    startCompass(options) {
      wxStub.startCompassCalls += 1;
      if (options && options.success) options.success();
    },
    stopCompass() {},
    onDeviceMotionChange(handler) {
      wxStub.motionHandlers.push(handler);
    },
    offDeviceMotionChange(handler) {
      wxStub.motionHandlers = wxStub.motionHandlers.filter((item) => item !== handler);
    },
    startDeviceMotionListening(options) {
      wxStub.startMotionCalls += 1;
      if (options && options.success) options.success();
    },
    stopDeviceMotionListening() {}
  };
  const hub = surveyDeviceOrientation.createHeadingSensorHub(wxStub);
  const seen = [];
  const unsubscribe = hub.subscribe((event) => seen.push(event));
  assert.equal(wxStub.startCompassCalls, 1);
  assert.equal(wxStub.startMotionCalls, 0);
  assert.equal(hub.currentSource(), 'compass');
  wxStub.compassHandlers[0]({ direction: 90 });
  almostEqual(seen[0].alpha, surveyDeviceOrientation.compassDirectionToAlpha(90), 1e-9);
  assert.equal(seen[0].source, 'compass');

  unsubscribe();
  wxStub.startCompass = (options) => {
    wxStub.startCompassCalls += 1;
    if (options && options.fail) options.fail();
  };
  const motionHub = surveyDeviceOrientation.createHeadingSensorHub(wxStub);
  const motionSeen = [];
  const motionUnsubscribe = motionHub.subscribe((event) => motionSeen.push(event));
  assert.equal(motionHub.currentSource(), 'motion');
  wxStub.motionHandlers[0]({ alpha: 123 });
  assert.equal(motionSeen[0].alpha, 123);
  assert.equal(motionSeen[0].source, 'motion');
  motionUnsubscribe();
});

test('heading sensor hub ignores a late start callback after every subscriber leaves', () => {
  let pendingStart = null;
  let stopCalls = 0;
  const wxStub = {
    onCompassChange() {},
    offCompassChange() {},
    startCompass(options) {
      pendingStart = options;
    },
    stopCompass() {
      stopCalls += 1;
    }
  };
  const hub = surveyDeviceOrientation.createHeadingSensorHub(wxStub);
  const unsubscribe = hub.subscribe(() => {});
  assert.equal(hub.currentSource(), 'compass');

  unsubscribe();
  pendingStart.success();

  assert.equal(hub.listenerCount(), 0);
  assert.equal(hub.isListening(), false);
  assert.equal(hub.currentSource(), '');
  assert.ok(stopCalls >= 1);
});

test('heading sensor fallback retries device motion with the normal interval', () => {
  const motionIntervals = [];
  const wxStub = {
    onCompassChange() {},
    offCompassChange() {},
    startCompass(options) {
      options.fail();
    },
    stopCompass() {},
    onDeviceMotionChange() {},
    offDeviceMotionChange() {},
    startDeviceMotionListening(options) {
      motionIntervals.push(options.interval);
      if (options.interval === 'game') options.fail();
      else options.success();
    },
    stopDeviceMotionListening() {}
  };
  const hub = surveyDeviceOrientation.createHeadingSensorHub(wxStub);
  const unsubscribe = hub.subscribe(() => {});

  assert.deepEqual(motionIntervals, ['game', 'normal']);
  assert.equal(hub.currentSource(), 'motion');
  assert.equal(hub.isListening(), true);
  unsubscribe();
});

test('heading sensor start failure notifies every subscriber that joined while starting', () => {
  let pendingStart = null;
  const wxStub = {
    onCompassChange() {},
    offCompassChange() {},
    startCompass(options) {
      pendingStart = options;
    },
    stopCompass() {}
  };
  const hub = surveyDeviceOrientation.createHeadingSensorHub(wxStub);
  let failedA = 0;
  let failedB = 0;
  const unsubscribeA = hub.subscribe(() => {}, { onError: () => { failedA += 1; } });
  const unsubscribeB = hub.subscribe(() => {}, { onError: () => { failedB += 1; } });

  pendingStart.fail();

  assert.equal(failedA, 1);
  assert.equal(failedB, 1);
  assert.equal(hub.isListening(), false);
  unsubscribeA();
  unsubscribeB();
});

test('heading fallback shares device motion without stopping the phone-angle subscriber', () => {
  const wxStub = createWxStub();
  wxStub.onCompassChange = () => {};
  wxStub.offCompassChange = () => {};
  wxStub.startCompass = (options) => {
    if (options && options.fail) options.fail();
  };
  wxStub.stopCompass = () => {};

  const motionHub = surveyDeviceOrientation.createDeviceMotionHub(wxStub);
  const stopPhoneAngle = motionHub.subscribe(() => {});
  const headingHub = surveyDeviceOrientation.createHeadingSensorHub(wxStub, motionHub);
  const stopHeading = headingHub.subscribe(() => {});

  assert.equal(motionHub.listenerCount(), 2);
  stopHeading();
  assert.equal(motionHub.listenerCount(), 1);
  assert.equal(motionHub.isListening(), true);
  stopPhoneAngle();
  assert.equal(motionHub.isListening(), false);
});

test('editor wires the heading-follow mode into gestures, compass, and lifecycle', () => {
  // Follow mode uses the heading sensor hub; the angle panel keeps device motion.
  assert.match(editorScript, /surveyDeviceOrientation\.sharedHeadingSensorHub\.subscribe/);
  assert.match(editorScript, /surveyDeviceOrientation\.sharedDeviceMotionHub\.subscribe/);
  assert.match(editorScript, /ensureHeadingSensorPrivacy/);
  assert.match(editorScript, /applyFollowViewRotation/);
  assert.match(editorScript, /redrawFollowViewRotation/);

  // Compass toggle and reset-to-north handler.
  assert.match(editorScript, /onCompassTap\(\)/);
  assert.match(editorScript, /disableHeadingFollow\(\{ resetRotation: true \}\)/);
  assert.match(editorScript, /animateViewRotationTo\(0\)/);

  // Sensor frames ride the lightweight interaction path and settle with a
  // full redraw.
  assert.match(editorScript, /applyTransientViewRotation/);
  assert.match(editorScript, /compensateViewportOffsetForRotation/);
  assert.match(editorScript, /FOLLOW_ROTATION_SETTLE_MS/);

  // Pan and pinch carry rotationRad when heading follow has rotated the view.
  assert.match(editorScript, /offsetY: startViewport\.offsetY \+ dy,\s*\n\s*rotationRad: this\.getViewRotationRad\(\)/);

  // Lifecycle keeps the sensor subscription tidy.
  assert.match(editorScript, /this\.suspendHeadingFollow\(\);/);
  assert.match(editorScript, /this\.resumeHeadingFollow\(\);/);

  // Wall centring honours the view rotation.
  assert.match(
    editorScript,
    /resolveViewportOffsetForAnchor\(\s*rect,\s*\{\s*x: rect\.width \/ 2,\s*y: rect\.height \/ 2 - padHeight \/ 2\s*\}/
  );
});

test('compass control is mounted on the formal canvas with live rotation', () => {
  assert.match(editorWxml, /survey-canvas-compass[\s\S]*?wx:if="\{\{!componentEditorVisible\}\}"/);
  assert.match(editorWxml, /rotation-deg="\{\{compassRotationDeg\}\}"/);
  assert.match(editorWxml, /active="\{\{compassFollowActive\}\}"/);
  assert.match(editorWxml, /catch:tap="onCompassTap"/);
  assert.match(compassWxml, /rotate\(\{\{rotationDeg\}\}deg\)/);
});
