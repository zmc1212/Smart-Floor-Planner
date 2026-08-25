export const LEAD_POOL_POLL_INTERVAL_MS = 3000;
export const LEAD_POOL_CLOCK_INTERVAL_MS = 1000;
export const LEAD_POOL_IDLE_MS = 2 * 60 * 1000;

export const AI_CREATION_POLL_INTERVAL_MS = 4500;
export const AI_WORKBENCH_POLL_INTERVAL_MS = 4000;
export const AI_STATUS_POLL_INTERVAL_MS = 3000;
export const AI_PAGE_IDLE_MS = 5 * 60 * 1000;

export const PAGE_ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart'] as const;

export type PageActivitySnapshot = {
  visible: boolean;
  lastActivityAt: number;
};

export type PagePollingHost = {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  addListener(type: string, listener: () => void): void;
  removeListener(type: string, listener: () => void): void;
  isVisible(): boolean;
};

export function isPagePollingAllowed(
  snapshot: PageActivitySnapshot,
  now: number,
  idleMs: number,
) {
  if (!snapshot.visible) return false;
  if (idleMs > 0 && now - snapshot.lastActivityAt >= idleMs) return false;
  return true;
}

export function createBrowserPagePollingHost(): PagePollingHost {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    addListener(type, listener) {
      if (type === 'visibilitychange') {
        document.addEventListener('visibilitychange', listener);
        return;
      }
      window.addEventListener(type, listener, { capture: true, passive: true });
    },
    removeListener(type, listener) {
      if (type === 'visibilitychange') {
        document.removeEventListener('visibilitychange', listener);
        return;
      }
      window.removeEventListener(type, listener, { capture: true });
    },
    isVisible: () => document.visibilityState === 'visible',
  };
}

export function createPagePollingController(options: {
  intervalMs: number;
  idleMs?: number;
  runOnResume?: boolean;
  onTick: () => void | Promise<void>;
  host: PagePollingHost;
}) {
  const idleMs = options.idleMs ?? 0;
  const runOnResume = options.runOnResume ?? true;
  const { host, onTick, intervalMs } = options;

  let stopped = true;
  let inFlight = false;
  let pollTimer: number | undefined;
  let idleTimer: number | undefined;
  let lastActivityAt = 0;
  const listeners: Array<{ type: string; listener: () => void }> = [];

  const snapshot = (): PageActivitySnapshot => ({
    visible: host.isVisible(),
    lastActivityAt,
  });

  const allowed = () => isPagePollingAllowed(snapshot(), host.now(), idleMs);

  const clearPollTimer = () => {
    if (pollTimer !== undefined) host.clearTimeout(pollTimer);
    pollTimer = undefined;
  };

  const clearIdleTimer = () => {
    if (idleTimer !== undefined) host.clearTimeout(idleTimer);
    idleTimer = undefined;
  };

  const armIdle = () => {
    clearIdleTimer();
    if (stopped || idleMs <= 0 || !host.isVisible()) return;
    const remaining = idleMs - (host.now() - lastActivityAt);
    idleTimer = host.setTimeout(() => {
      idleTimer = undefined;
      clearPollTimer();
    }, Math.max(0, remaining));
  };

  const armPoll = () => {
    clearPollTimer();
    if (stopped || inFlight || !allowed()) return;
    pollTimer = host.setTimeout(() => {
      pollTimer = undefined;
      void run();
    }, intervalMs);
  };

  const run = async () => {
    if (stopped || inFlight || !allowed()) return;
    inFlight = true;
    try {
      const result = onTick();
      if (result && typeof result.then === 'function') await result;
    } finally {
      inFlight = false;
      armPoll();
    }
  };

  const resume = () => {
    lastActivityAt = host.now();
    armIdle();
    if (runOnResume) void run();
    else armPoll();
  };

  const onVisibility = () => {
    if (stopped) return;
    if (host.isVisible()) resume();
    else {
      clearPollTimer();
      clearIdleTimer();
    }
  };

  const onActivity = () => {
    if (stopped || !host.isVisible()) return;
    const wasBlocked = !allowed();
    lastActivityAt = host.now();
    armIdle();
    if (wasBlocked && runOnResume) void run();
    else if (!pollTimer && !inFlight) armPoll();
  };

  const listen = (type: string, listener: () => void) => {
    host.addListener(type, listener);
    listeners.push({ type, listener });
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      lastActivityAt = host.now();
      listen('visibilitychange', onVisibility);
      for (const type of PAGE_ACTIVITY_EVENTS) listen(type, onActivity);
      armIdle();
      armPoll();
    },
    stop() {
      stopped = true;
      clearPollTimer();
      clearIdleTimer();
      for (const item of listeners) host.removeListener(item.type, item.listener);
      listeners.length = 0;
    },
    isAllowed: allowed,
  };
}
