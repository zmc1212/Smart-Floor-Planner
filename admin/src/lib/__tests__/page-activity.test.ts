import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_PAGE_IDLE_MS,
  createPagePollingController,
  isPagePollingAllowed,
  LEAD_POOL_IDLE_MS,
  PAGE_ACTIVITY_EVENTS,
  type PagePollingHost,
} from '../page-activity';

function createFakeHost(initialVisible = true) {
  let now = 0;
  let visible = initialVisible;
  let nextTimerId = 1;
  const timers = new Map<number, { when: number; fn: () => void }>();
  const listeners = new Map<string, Set<() => void>>();

  const emit = (type: string) => {
    for (const listener of listeners.get(type) || []) listener();
  };

  const flushDue = () => {
    for (let guard = 0; guard < 50; guard += 1) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.when <= now)
        .sort((a, b) => a[1].when - b[1].when);
      if (!due.length) return;
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.fn();
      }
    }
  };

  const host: PagePollingHost & {
    advance(ms: number): void;
    setVisible(next: boolean): void;
    emit(type: string): void;
    pendingCount(): number;
  } = {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { when: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addListener(type, listener) {
      const set = listeners.get(type) || new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    isVisible: () => visible,
    advance(ms) {
      now += ms;
      flushDue();
    },
    setVisible(next) {
      visible = next;
      emit('visibilitychange');
    },
    emit,
    pendingCount: () => timers.size,
  };

  return host;
}

test('polling is allowed only while visible and recently active', () => {
  assert.equal(isPagePollingAllowed({ visible: true, lastActivityAt: 0 }, 1000, 2000), true);
  assert.equal(isPagePollingAllowed({ visible: false, lastActivityAt: 0 }, 1000, 2000), false);
  assert.equal(isPagePollingAllowed({ visible: true, lastActivityAt: 0 }, 2000, 2000), false);
  assert.equal(isPagePollingAllowed({ visible: true, lastActivityAt: 0 }, 1999, 2000), true);
  assert.equal(isPagePollingAllowed({ visible: true, lastActivityAt: 0 }, 60_000, 0), true);
});

test('page polling ticks on the interval while the tab is active', async () => {
  const host = createFakeHost();
  const ticks: number[] = [];
  const controller = createPagePollingController({
    intervalMs: 3000,
    idleMs: LEAD_POOL_IDLE_MS,
    onTick: () => { ticks.push(host.now()); },
    host,
  });
  controller.start();
  host.advance(2999);
  assert.deepEqual(ticks, []);
  host.advance(1);
  assert.deepEqual(ticks, [3000]);
  host.advance(3000);
  assert.deepEqual(ticks, [3000, 6000]);
  controller.stop();
  host.advance(3000);
  assert.deepEqual(ticks, [3000, 6000]);
});

test('hidden tabs pause polling and a visible resume refreshes immediately', async () => {
  const host = createFakeHost();
  const ticks: number[] = [];
  const controller = createPagePollingController({
    intervalMs: 3000,
    idleMs: LEAD_POOL_IDLE_MS,
    onTick: () => { ticks.push(host.now()); },
    host,
  });
  controller.start();
  host.advance(3000);
  assert.deepEqual(ticks, [3000]);
  host.setVisible(false);
  host.advance(12_000);
  assert.deepEqual(ticks, [3000]);
  host.setVisible(true);
  assert.deepEqual(ticks, [3000, 15000]);
  host.advance(3000);
  assert.deepEqual(ticks, [3000, 15000, 18000]);
  controller.stop();
});

test('idle timeout pauses polling and the next user action refreshes immediately', async () => {
  const host = createFakeHost();
  const ticks: number[] = [];
  const controller = createPagePollingController({
    intervalMs: 3000,
    idleMs: 5000,
    onTick: () => { ticks.push(host.now()); },
    host,
  });
  controller.start();
  host.advance(3000);
  assert.deepEqual(ticks, [3000]);
  host.advance(2000);
  assert.equal(controller.isAllowed(), false);
  host.advance(3000);
  assert.deepEqual(ticks, [3000]);
  host.emit('pointerdown');
  assert.deepEqual(ticks, [3000, 8000]);
  controller.stop();
});

test('activity events include pointer, keyboard, scroll and touch', () => {
  assert.deepEqual(
    [...PAGE_ACTIVITY_EVENTS],
    ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart'],
  );
  assert.equal(LEAD_POOL_IDLE_MS, 120_000);
  assert.equal(AI_PAGE_IDLE_MS, 300_000);
});

test('overlapping ticks wait for the in-flight request before arming the next interval', async () => {
  const host = createFakeHost();
  let resolveTick: (() => void) | undefined;
  const ticks: number[] = [];
  const controller = createPagePollingController({
    intervalMs: 1000,
    idleMs: 60_000,
    onTick: () => new Promise<void>((resolve) => {
      ticks.push(host.now());
      resolveTick = resolve;
    }),
    host,
  });
  controller.start();
  host.advance(1000);
  assert.deepEqual(ticks, [1000]);
  host.advance(5000);
  assert.deepEqual(ticks, [1000]);
  resolveTick?.();
  await Promise.resolve();
  host.advance(1000);
  assert.deepEqual(ticks, [1000, 7000]);
  resolveTick?.();
  controller.stop();
});
