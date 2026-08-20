'use client';

// Read-only canvas host. Later Admin editing should reuse this component and
// add a surveying-editor controller; do not put wall/BLE tools here in v1.

import { useCallback, useEffect, useRef } from 'react';
import { createSurveyRenderScene, drawSurveyScene } from '@/lib/survey-canvas-runtime';
import {
  createReadonlySurveyFloor,
  fitSurveyViewport,
  panSurveyViewport,
  zoomSurveyViewport,
  type SurveyCanvasRect,
  type SurveyViewport,
} from '@/lib/survey-canvas-viewport';

type SurveyCanvasFloor = {
  nodes?: Array<{ xMm?: number; yMm?: number }>;
  [key: string]: unknown;
};

type SurveyCanvasHostProps = {
  floor: SurveyCanvasFloor | null;
  className?: string;
};

type PointerPanState = {
  pointerId: number;
  lastX: number;
  lastY: number;
};

function readCanvasRect(canvas: HTMLCanvasElement): SurveyCanvasRect {
  const bounds = canvas.getBoundingClientRect();
  return {
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  };
}

function localPointFromEvent(canvas: HTMLCanvasElement, event: PointerEvent | WheelEvent) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

export default function SurveyCanvasHost({ floor, className }: SurveyCanvasHostProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<SurveyViewport | null>(null);
  const panRef = useRef<PointerPanState | null>(null);
  const floorRef = useRef(floor);

  useEffect(() => {
    floorRef.current = floor;
  }, [floor]);

  const paint = useCallback((nextViewport?: SurveyViewport) => {
    const canvas = canvasRef.current;
    const currentFloor = floorRef.current;
    if (!canvas || !currentFloor) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = readCanvasRect(canvas);
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const readonlyFloor = createReadonlySurveyFloor(currentFloor);
    const viewport = nextViewport
      || viewportRef.current
      || fitSurveyViewport(readonlyFloor.nodes, rect);
    viewportRef.current = viewport;
    const scene = createSurveyRenderScene({
      floor: readonlyFloor,
      session: readonlyFloor.session,
      viewport,
      rect,
    });
    drawSurveyScene(ctx, scene, { dpr });
  }, []);

  const fitToCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const currentFloor = floorRef.current;
    if (!canvas || !currentFloor) return;
    const viewport = fitSurveyViewport(currentFloor.nodes, readCanvasRect(canvas));
    viewportRef.current = viewport;
    paint(viewport);
  }, [paint]);

  useEffect(() => {
    viewportRef.current = null;
    fitToCanvas();
  }, [floor, fitToCanvas]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(() => {
      if (!viewportRef.current) {
        fitToCanvas();
        return;
      }
      paint();
    });
    observer.observe(canvas);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const viewport = viewportRef.current;
      if (!viewport) return;
      const factor = event.deltaY > 0 ? 0.92 : 1.08;
      const nextViewport = zoomSurveyViewport(
        viewport,
        readCanvasRect(canvas),
        localPointFromEvent(canvas, event),
        factor,
      );
      viewportRef.current = nextViewport;
      paint(nextViewport);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      observer.disconnect();
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [fitToCanvas, paint]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      data-survey-canvas="readonly"
      aria-label="正式量房只读画布"
      onDoubleClick={(event) => {
        event.preventDefault();
        fitToCanvas();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        panRef.current = {
          pointerId: event.pointerId,
          lastX: event.clientX,
          lastY: event.clientY,
        };
      }}
      onPointerMove={(event) => {
        const pan = panRef.current;
        const viewport = viewportRef.current;
        if (!pan || pan.pointerId !== event.pointerId || !viewport) return;
        const nextViewport = panSurveyViewport(
          viewport,
          event.clientX - pan.lastX,
          event.clientY - pan.lastY,
        );
        pan.lastX = event.clientX;
        pan.lastY = event.clientY;
        viewportRef.current = nextViewport;
        paint(nextViewport);
      }}
      onPointerUp={(event) => {
        if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
      }}
      onPointerCancel={() => {
        panRef.current = null;
      }}
    />
  );
}
