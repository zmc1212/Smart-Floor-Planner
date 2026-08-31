// Shared device-motion access and the heading-follow controller for the
// surveying editor canvas.
//
// The motion hub exists because WeChat exposes one global device-motion listener
// lifecycle (`startDeviceMotionListening` / `stopDeviceMotionListening`):
// the phone-angle measurement panel and the canvas heading-follow mode must
// not tear each other's listener down when one of them closes.
//
// Heading follow prefers the compass API (`startCompass` / `onCompassChange`)
// because it is reliable on real phones. Device motion remains the fallback and
// is still required by the angle-measurement panel (beta/gamma level checks).

const DEFAULT_MOTION_INTERVAL = 'game';
const DEFAULT_SMOOTHING = 0.35;
const DEFAULT_DEADBAND_DEG = 4;
const DEFAULT_HEADING_FOLLOW_ACTIVATE_DEG = 8;
const DEFAULT_HEADING_FOLLOW_SWITCH_DEG = 22;
const DEFAULT_DIRECTION_PICK_SAMPLE_COUNT = 9;
const DEFAULT_DIRECTION_PICK_ACTIVATE_DEG = 12;
const DEFAULT_DIRECTION_PICK_SWITCH_DEG = 15;

const VIEW_CARDINAL_ROTATIONS = [0, 90, 180, -90];

function pickCardinalRotationDeg(rawDeg, previousCardinalDeg, switchDeg) {
  const parsed = Number(rawDeg);
  if (!Number.isFinite(parsed)) return previousCardinalDeg || 0;

  let best = VIEW_CARDINAL_ROTATIONS[0];
  let bestDist = Infinity;
  VIEW_CARDINAL_ROTATIONS.forEach((candidate) => {
    const dist = Math.abs(shortestArcDeg(parsed - candidate));
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  });

  const previous = Number(previousCardinalDeg);
  if (!Number.isFinite(previous)) {
    return best;
  }
  if (best === previous) {
    return previous;
  }

  const currentDist = Math.abs(shortestArcDeg(parsed - previous));
  if (currentDist - bestDist < switchDeg) {
    return previous;
  }
  return best;
}

function normalizeSignedAngle(angle) {
  let normalized = Number(angle);
  if (!Number.isFinite(normalized)) return 0;
  while (normalized <= -180) normalized += 360;
  while (normalized > 180) normalized -= 360;
  return normalized;
}

function normalizeDeg(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function shortestArcDeg(delta) {
  return ((Number(delta) % 360) + 540) % 360 - 180;
}

function isWechatDevtools(wxImpl) {
  const wxApi = wxImpl || (typeof wx !== 'undefined' ? wx : null);
  if (!wxApi) return false;
  try {
    const info = wxApi.getDeviceInfo ? wxApi.getDeviceInfo() : wxApi.getSystemInfoSync();
    return !!(info && info.platform === 'devtools');
  } catch (error) {
    return false;
  }
}

function ensureHeadingSensorPrivacy(wxImpl) {
  const wxApi = wxImpl || (typeof wx !== 'undefined' ? wx : null);
  if (!wxApi) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const authorizeLocation = () => {
      if (!wxApi.authorize) {
        resolve();
        return;
      }
      wxApi.authorize({
        scope: 'scope.userLocation',
        success: () => resolve(),
        fail: () => resolve()
      });
    };

    if (!wxApi.getPrivacySetting) {
      authorizeLocation();
      return;
    }

    wxApi.getPrivacySetting({
      success(res) {
        if (res.needAuthorization && wxApi.requirePrivacyAuthorize) {
          wxApi.requirePrivacyAuthorize({
            success: authorizeLocation,
            fail: () => reject(new Error('privacy'))
          });
          return;
        }
        authorizeLocation();
      },
      fail: authorizeLocation
    });
  });
}

// Map compass direction (0=north, clockwise increase) into the same alpha
// semantics used by device-motion heading follow.
function compassDirectionToAlpha(directionDeg) {
  return normalizeDeg(360 - Number(directionDeg));
}

function createDeviceMotionHub(wxImpl) {
  const wxApi = wxImpl || (typeof wx !== 'undefined' ? wx : null);
  let handlers = [];
  let listening = false;

  function dispatch(event) {
    handlers.slice().forEach((handler) => handler(event));
  }

  function stopNative() {
    if (!listening) return;
    listening = false;
    if (wxApi.offDeviceMotionChange) wxApi.offDeviceMotionChange(dispatch);
    if (wxApi.stopDeviceMotionListening) wxApi.stopDeviceMotionListening({ fail: () => {} });
  }

  function start(interval, onError) {
    if (listening) return;
    listening = true;
    wxApi.onDeviceMotionChange(dispatch);
    wxApi.startDeviceMotionListening({
      interval: interval || DEFAULT_MOTION_INTERVAL,
      fail: () => {
        stopNative();
        if (typeof onError === 'function') onError();
      }
    });
  }

  return {
    supported() {
      return !!(wxApi && wxApi.startDeviceMotionListening && wxApi.onDeviceMotionChange);
    },
    subscribe(handler, options) {
      if (!this.supported() || typeof handler !== 'function') return null;
      handlers.push(handler);
      start(options && options.interval, options && options.onError);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        handlers = handlers.filter((item) => item !== handler);
        if (!handlers.length) stopNative();
      };
    },
    listenerCount() {
      return handlers.length;
    },
    isListening() {
      return listening;
    }
  };
}

function createHeadingSensorHub(wxImpl, deviceMotionHub) {
  const wxApi = wxImpl || (typeof wx !== 'undefined' ? wx : null);
  let subscribers = [];
  let listening = false;
  let starting = false;
  let source = '';
  let fallbackMotionUnsubscribe = null;
  let startGeneration = 0;

  function dispatchHeading(alpha, meta) {
    if (!Number.isFinite(alpha)) return;
    subscribers.slice().forEach((subscriber) => subscriber.handler({
      alpha,
      source: meta && meta.source
    }));
  }

  function onDeviceMotion(event) {
    if (source !== 'motion') return;
    const alpha = Number(event && event.alpha);
    if (!Number.isFinite(alpha)) return;
    dispatchHeading(alpha, { source: 'motion' });
  }

  function onCompass(event) {
    if (source !== 'compass') return;
    const direction = Number(event && event.direction);
    if (!Number.isFinite(direction)) return;
    dispatchHeading(compassDirectionToAlpha(direction), { source: 'compass' });
  }

  function detachNativeListeners() {
    if (wxApi.offCompassChange) wxApi.offCompassChange(onCompass);
    if (wxApi.offDeviceMotionChange) wxApi.offDeviceMotionChange(onDeviceMotion);
  }

  function stopNative() {
    startGeneration += 1;
    const stoppedSource = source;
    detachNativeListeners();
    if (fallbackMotionUnsubscribe) {
      fallbackMotionUnsubscribe();
      fallbackMotionUnsubscribe = null;
    }
    if (stoppedSource === 'compass' && wxApi.stopCompass) {
      wxApi.stopCompass({ fail: () => {} });
    }
    if (stoppedSource === 'motion' && !deviceMotionHub && wxApi.stopDeviceMotionListening) {
      wxApi.stopDeviceMotionListening({ fail: () => {} });
    }
    listening = false;
    starting = false;
    source = '';
  }

  function startDeviceMotion(onReady, onError, interval, isCurrent) {
    if (typeof isCurrent === 'function' && !isCurrent()) return;
    if (!wxApi.startDeviceMotionListening || !wxApi.onDeviceMotionChange) {
      if (typeof onError === 'function') onError();
      return;
    }
    const requestedInterval = interval || DEFAULT_MOTION_INTERVAL;
    wxApi.startDeviceMotionListening({
      interval: requestedInterval,
      success: () => {
        if (typeof isCurrent === 'function' && !isCurrent()) return;
        if (typeof onReady === 'function') onReady('motion');
      },
      fail: () => {
        if (typeof isCurrent === 'function' && !isCurrent()) return;
        if (requestedInterval === DEFAULT_MOTION_INTERVAL) {
          startDeviceMotion(onReady, onError, 'normal', isCurrent);
          return;
        }
        if (typeof onError === 'function') onError();
      }
    });
  }

  function start() {
    if (listening || starting) return;
    const generation = ++startGeneration;
    const isCurrent = () => generation === startGeneration && subscribers.length > 0;
    starting = true;
    detachNativeListeners();
    if (wxApi.stopCompass) wxApi.stopCompass({ fail: () => {} });

    const failAll = () => {
      if (!isCurrent()) return;
      const errorCallbacks = subscribers
        .map((subscriber) => subscriber.onError)
        .filter((callback) => typeof callback === 'function');
      stopNative();
      errorCallbacks.forEach((callback) => callback());
    };
    const startMotionFallback = () => {
      if (!isCurrent()) return;
      if (wxApi.stopCompass) wxApi.stopCompass({ fail: () => {} });
      if (deviceMotionHub && deviceMotionHub.supported()) {
        if (wxApi.offCompassChange) wxApi.offCompassChange(onCompass);
        source = 'motion';
        let startFailed = false;
        const unsubscribe = deviceMotionHub.subscribe(onDeviceMotion, {
          onError: () => {
            startFailed = true;
            failAll();
          }
        });
        if (startFailed || !unsubscribe) {
          if (unsubscribe) unsubscribe();
          fallbackMotionUnsubscribe = null;
          if (!startFailed) failAll();
          return;
        }
        fallbackMotionUnsubscribe = unsubscribe;
        starting = false;
        listening = true;
        return;
      }
      if (!wxApi.startDeviceMotionListening || !wxApi.onDeviceMotionChange) {
        failAll();
        return;
      }
      if (wxApi.offCompassChange) wxApi.offCompassChange(onCompass);
      wxApi.onDeviceMotionChange(onDeviceMotion);
      source = 'motion';
      startDeviceMotion(
        () => {
          if (!isCurrent()) return;
          starting = false;
          listening = true;
        },
        failAll,
        undefined,
        isCurrent
      );
    };

    if (!wxApi.startCompass || !wxApi.onCompassChange) {
      startMotionFallback();
      return;
    }

    wxApi.onCompassChange(onCompass);
    source = 'compass';
    wxApi.startCompass({
      success: () => {
        if (!isCurrent()) return;
        starting = false;
        listening = true;
      },
      fail: startMotionFallback
    });
  }

  return {
    supported() {
      return !!(
        wxApi && (
          (wxApi.startCompass && wxApi.onCompassChange) ||
          (wxApi.startDeviceMotionListening && wxApi.onDeviceMotionChange)
        )
      );
    },
    subscribe(handler, options) {
      if (!this.supported() || typeof handler !== 'function') return null;
      const subscriber = {
        handler,
        onError: options && options.onError
      };
      subscribers.push(subscriber);
      start();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscribers = subscribers.filter((item) => item !== subscriber);
        if (!subscribers.length) stopNative();
      };
    },
    listenerCount() {
      return subscribers.length;
    },
    isListening() {
      return listening;
    },
    currentSource() {
      return source;
    }
  };
}

const sharedDeviceMotionHub = createDeviceMotionHub();
const sharedHeadingSensorHub = createHeadingSensorHub(undefined, sharedDeviceMotionHub);

/**
 * View-only heading follow: the canvas rotation tracks the phone heading
 * relative to the heading captured when follow mode was enabled. Rotation is
 * kept continuous (not wrapped to 0..360) so a full physical turn never makes
 * the rendered plan snap across the 359->0 seam.
 */
function median(values) {
  if (!values || !values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function circularMedianDeg(values) {
  if (!values || !values.length) return null;
  const normalized = values
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .map(normalizeDeg);
  if (!normalized.length) return null;
  const unwrapped = [normalized[0]];
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = unwrapped[index - 1];
    unwrapped.push(previous + shortestArcDeg(normalized[index] - normalizeDeg(previous)));
  }
  return normalizeDeg(median(unwrapped));
}

function createHeadingFollowController(options) {
  const opts = options || {};
  const cardinalOnly = opts.cardinalOnly !== false;
  const smoothing = Number.isFinite(Number(opts.smoothing)) && Number(opts.smoothing) > 0
    ? Math.min(1, Number(opts.smoothing))
    : DEFAULT_SMOOTHING;
  const deadbandDeg = Number.isFinite(Number(opts.deadbandDeg)) && Number(opts.deadbandDeg) >= 0
    ? Number(opts.deadbandDeg)
    : DEFAULT_DEADBAND_DEG;
  const activateDeg = Number.isFinite(Number(opts.activateDeg)) && Number(opts.activateDeg) >= 0
    ? Number(opts.activateDeg)
    : DEFAULT_HEADING_FOLLOW_ACTIVATE_DEG;
  const switchDeg = Number.isFinite(Number(opts.switchDeg)) && Number(opts.switchDeg) >= 0
    ? Number(opts.switchDeg)
    : DEFAULT_HEADING_FOLLOW_SWITCH_DEG;

  let active = false;
  let lastAlpha = null;
  let continuousAlpha = 0;
  let baselineAlpha = 0;
  let baseRotationDeg = 0;
  let smoothedRotationDeg = 0;
  let appliedRotationDeg = 0;
  let hasCardinalLock = false;

  return {
    begin(alphaDeg, rotationDeg) {
      const alpha = Number(alphaDeg);
      if (!Number.isFinite(alpha)) return false;
      active = true;
      lastAlpha = normalizeDeg(alpha);
      continuousAlpha = lastAlpha;
      baselineAlpha = lastAlpha;
      baseRotationDeg = Number(rotationDeg) || 0;
      smoothedRotationDeg = baseRotationDeg;
      appliedRotationDeg = cardinalOnly
        ? pickCardinalRotationDeg(baseRotationDeg, null, switchDeg)
        : baseRotationDeg;
      hasCardinalLock = false;
      return true;
    },
    update(alphaDeg) {
      if (!active) return null;
      const alpha = Number(alphaDeg);
      if (!Number.isFinite(alpha)) return null;
      const normalized = normalizeDeg(alpha);
      continuousAlpha += shortestArcDeg(normalized - lastAlpha);
      lastAlpha = normalized;

      if (cardinalOnly) {
        const signedDelta = normalizeSignedAngle(continuousAlpha - baselineAlpha);
        if (!hasCardinalLock && Math.abs(signedDelta) < activateDeg) {
          return { rotationDeg: appliedRotationDeg, changed: false };
        }
        hasCardinalLock = true;
        const rawTargetDeg = normalizeSignedAngle(baseRotationDeg + signedDelta);
        const targetRotationDeg = pickCardinalRotationDeg(
          rawTargetDeg,
          appliedRotationDeg,
          switchDeg
        );
        const changed = targetRotationDeg !== appliedRotationDeg;
        appliedRotationDeg = targetRotationDeg;
        smoothedRotationDeg = targetRotationDeg;
        return { rotationDeg: appliedRotationDeg, changed };
      }

      const deltaFromBaseline = Math.abs(continuousAlpha - baselineAlpha);
      const hasStartedFollowing = Math.abs(appliedRotationDeg - baseRotationDeg) > deadbandDeg;
      if (deltaFromBaseline < activateDeg && !hasStartedFollowing) {
        return { rotationDeg: appliedRotationDeg, changed: false };
      }
      const targetRotationDeg = baseRotationDeg + (continuousAlpha - baselineAlpha);
      smoothedRotationDeg += smoothing * (targetRotationDeg - smoothedRotationDeg);
      if (Math.abs(smoothedRotationDeg - appliedRotationDeg) < deadbandDeg) {
        return { rotationDeg: appliedRotationDeg, changed: false };
      }
      appliedRotationDeg = smoothedRotationDeg;
      return { rotationDeg: appliedRotationDeg, changed: true };
    },
    isCardinalMode() {
      return cardinalOnly;
    },
    isActive() {
      return active;
    },
    stop() {
      active = false;
      lastAlpha = null;
      continuousAlpha = 0;
      baselineAlpha = 0;
      hasCardinalLock = false;
    }
  };
}

function createDirectionPickController(options) {
  const surveyBleDirectionOptions = require('./surveyBleDirectionOptions.js');
  const opts = options || {};
  const activateDeg = Number.isFinite(Number(opts.activateDeg))
    ? Number(opts.activateDeg)
    : DEFAULT_DIRECTION_PICK_ACTIVATE_DEG;
  const switchDeg = Number.isFinite(Number(opts.switchDeg))
    ? Number(opts.switchDeg)
    : DEFAULT_DIRECTION_PICK_SWITCH_DEG;
  const sampleCount = Number.isFinite(Number(opts.sampleCount)) && Number(opts.sampleCount) > 0
    ? Math.round(Number(opts.sampleCount))
    : DEFAULT_DIRECTION_PICK_SAMPLE_COUNT;

  let active = false;
  let viewRotationDeg = 0;
  let baselineOffsetDeg = 0;
  let samples = [];
  let selectedKey = '';

  return {
    begin(rotationDeg, offsetDeg) {
      active = true;
      viewRotationDeg = Number(rotationDeg) || 0;
      baselineOffsetDeg = Number(offsetDeg) || 0;
      samples = [];
      selectedKey = '';
      return true;
    },
    update(alphaDeg, candidates) {
      if (!active || !Array.isArray(candidates) || !candidates.length) return null;
      const alpha = Number(alphaDeg);
      if (!Number.isFinite(alpha)) return null;

      samples.push(alpha);
      if (samples.length > sampleCount) samples.shift();
      const filteredAlpha = circularMedianDeg(samples);
      if (!Number.isFinite(filteredAlpha)) return null;

      const worldBearing = surveyBleDirectionOptions.mapDeviceHeadingToWorldBearing(
        filteredAlpha,
        viewRotationDeg,
        baselineOffsetDeg
      );
      const nextKey = surveyBleDirectionOptions.pickDirectionWithHysteresis(
        candidates,
        worldBearing,
        selectedKey,
        { activateDeg, switchDeg }
      );
      if (!nextKey) return null;
      const changed = nextKey !== selectedKey;
      selectedKey = nextKey;
      return { key: nextKey, changed, worldBearing };
    },
    getSelectedKey() {
      return selectedKey;
    },
    setSelectedKey(key) {
      selectedKey = key || '';
    },
    isActive() {
      return active;
    },
    stop() {
      active = false;
      samples = [];
      selectedKey = '';
    }
  };
}

module.exports = {
  DEFAULT_MOTION_INTERVAL,
  DEFAULT_SMOOTHING,
  DEFAULT_DEADBAND_DEG,
  DEFAULT_HEADING_FOLLOW_ACTIVATE_DEG,
  DEFAULT_HEADING_FOLLOW_SWITCH_DEG,
  DEFAULT_DIRECTION_PICK_SAMPLE_COUNT,
  normalizeDeg,
  shortestArcDeg,
  circularMedianDeg,
  pickCardinalRotationDeg,
  compassDirectionToAlpha,
  isWechatDevtools,
  ensureHeadingSensorPrivacy,
  createDeviceMotionHub,
  createHeadingSensorHub,
  sharedDeviceMotionHub,
  sharedHeadingSensorHub,
  createHeadingFollowController,
  createDirectionPickController
};
