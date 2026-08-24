function createPriorityCloudSaveQueue(run, onStateChange) {
  let active = false;
  let pending = null;

  function notify() {
    if (typeof onStateChange === 'function') {
      onStateChange({ active, pending: !!pending });
    }
  }

  function drain() {
    if (active || !pending) return;
    const request = pending;
    pending = null;
    active = true;
    notify();
    Promise.resolve()
      .then(() => run(request.status))
      .then((response) => {
        const outcome = { response, status: request.status };
        request.waiters.forEach((waiter) => waiter.resolve(outcome));
      })
      .catch((error) => {
        request.waiters.forEach((waiter) => waiter.reject(error));
      })
      .finally(() => {
        active = false;
        notify();
        drain();
      });
  }

  return {
    enqueue(status) {
      const requestedStatus = status === 'completed' ? 'completed' : 'draft';
      return new Promise((resolve, reject) => {
        if (!pending) pending = { status: requestedStatus, waiters: [] };
        else if (requestedStatus === 'completed') pending.status = 'completed';
        pending.waiters.push({ resolve, reject });
        notify();
        drain();
      });
    },
    getState() {
      return { active, pending: !!pending };
    }
  };
}

module.exports = { createPriorityCloudSaveQueue };
