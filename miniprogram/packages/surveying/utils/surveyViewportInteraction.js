function createLatestFrameQueue(options) {
  const requestFrame = options && options.requestFrame;
  const cancelFrame = options && options.cancelFrame;
  const onFrame = options && options.onFrame;
  let frameId = null;
  let latestValue = null;

  function queue(value) {
    latestValue = value;
    if (frameId !== null || typeof requestFrame !== 'function') return;

    frameId = requestFrame(() => {
      frameId = null;
      const nextValue = latestValue;
      latestValue = null;
      if (typeof onFrame === 'function') onFrame(nextValue);
    });
  }

  function cancel() {
    if (frameId !== null && typeof cancelFrame === 'function') {
      cancelFrame(frameId);
    }
    frameId = null;
    latestValue = null;
  }

  return {
    queue,
    cancel,
    hasPendingFrame() {
      return frameId !== null;
    }
  };
}

module.exports = {
  createLatestFrameQueue
};
