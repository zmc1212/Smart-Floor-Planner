'use client';

import { useEffect, useRef } from 'react';
import {
  createBrowserPagePollingHost,
  createPagePollingController,
} from '@/lib/page-activity';

export function usePagePolling(
  onTick: () => void | Promise<void>,
  options: {
    enabled?: boolean;
    intervalMs: number;
    idleMs?: number;
    runOnResume?: boolean;
  },
) {
  const onTickRef = useRef(onTick);
  const enabled = options.enabled ?? true;
  const { intervalMs, idleMs, runOnResume } = options;

  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const controller = createPagePollingController({
      intervalMs,
      idleMs,
      runOnResume,
      onTick: () => onTickRef.current(),
      host: createBrowserPagePollingHost(),
    });
    controller.start();
    return () => controller.stop();
  }, [enabled, intervalMs, idleMs, runOnResume]);
}
