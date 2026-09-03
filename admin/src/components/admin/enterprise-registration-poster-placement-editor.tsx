'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Typography } from 'antd';

export type PosterQrPlacement = {
  centerX: number;
  centerY: number;
  diameter: number;
  shape: 'circle' | 'square';
};

type DisplayMetrics = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
};

function clampRatio(value: number) {
  return Math.min(1, Math.max(0, value));
}

function roundRatio(value: number) {
  return Math.round(clampRatio(value) * 1000) / 1000;
}

function getContainedMetrics(
  containerWidth: number,
  containerHeight: number,
  naturalWidth: number,
  naturalHeight: number
): DisplayMetrics {
  if (!containerWidth || !containerHeight || !naturalWidth || !naturalHeight) {
    return {
      offsetX: 0,
      offsetY: 0,
      width: 0,
      height: 0,
      naturalWidth,
      naturalHeight,
    };
  }
  const scale = Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    offsetX: (containerWidth - width) / 2,
    offsetY: (containerHeight - height) / 2,
    width,
    height,
    naturalWidth,
    naturalHeight,
  };
}

function pointerToPlacement(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  metrics: DisplayMetrics,
  placement: PosterQrPlacement
) {
  const localX = clientX - rect.left - metrics.offsetX;
  const localY = clientY - rect.top - metrics.offsetY;
  const centerX = metrics.width ? localX / metrics.width : placement.centerX;
  const centerY = metrics.height ? localY / metrics.height : placement.centerY;
  return {
    ...placement,
    centerX: roundRatio(centerX),
    centerY: roundRatio(centerY),
  };
}

export function EnterpriseRegistrationPosterPlacementEditor(props: {
  templateId: string;
  value: PosterQrPlacement;
  onChange: (value: PosterQrPlacement) => void;
  qrPreviewUrl?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number } | null>(null);
  const placementRef = useRef(props.value);
  const onChangeRef = useRef(props.onChange);
  const [metrics, setMetrics] = useState<DisplayMetrics>({
    offsetX: 0,
    offsetY: 0,
    width: 0,
    height: 0,
    naturalWidth: 0,
    naturalHeight: 0,
  });
  const [backgroundReady, setBackgroundReady] = useState(false);

  useEffect(() => {
    placementRef.current = props.value;
    onChangeRef.current = props.onChange;
  }, [props.value, props.onChange]);

  const backgroundUrl = `/api/platform/enterprise-registration-code-template-config/background?templateId=${encodeURIComponent(props.templateId)}`;

  const updateMetrics = useCallback(() => {
    const container = containerRef.current;
    const image = container?.querySelector('img[data-poster-background="true"]') as HTMLImageElement | null;
    if (!container || !image?.naturalWidth || !image?.naturalHeight) return;
    setMetrics(
      getContainedMetrics(
        container.clientWidth,
        container.clientHeight,
        image.naturalWidth,
        image.naturalHeight
      )
    );
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updateMetrics());
    observer.observe(container);
    return () => observer.disconnect();
  }, [updateMetrics, backgroundReady]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaY < 0 ? 0.01 : -0.01;
      const current = placementRef.current;
      onChangeRef.current({
        ...current,
        diameter: roundRatio(current.diameter + delta),
      });
    };
    overlay.addEventListener('wheel', onWheel, { passive: false });
    return () => overlay.removeEventListener('wheel', onWheel);
  }, [backgroundReady, metrics.width]);

  const overlayDiameter = metrics.width * props.value.diameter;
  const overlayLeft = metrics.offsetX + props.value.centerX * metrics.width - overlayDiameter / 2;
  const overlayTop = metrics.offsetY + props.value.centerY * metrics.height - overlayDiameter / 2;

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!metrics.width || !metrics.height) return;
    dragRef.current = { pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    props.onChange(pointerToPlacement(event.clientX, event.clientY, rect, metrics, props.value));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    props.onChange(pointerToPlacement(event.clientX, event.clientY, rect, metrics, props.value));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="space-y-3">
      <Typography.Text type="secondary">
        拖拽二维码调整位置；鼠标停在二维码上滚轮缩放大小，其余区域可正常滚动页面。调整后点「保存配置」生效。
      </Typography.Text>
      <div
        ref={containerRef}
        className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-xl bg-slate-100"
        style={{ aspectRatio: metrics.naturalWidth && metrics.naturalHeight ? `${metrics.naturalWidth} / ${metrics.naturalHeight}` : '3 / 5' }}
      >
        <img
          data-poster-background="true"
          src={backgroundUrl}
          alt="开户海报模板"
          className="block h-full w-full object-contain"
          draggable={false}
          onLoad={() => {
            setBackgroundReady(true);
            updateMetrics();
          }}
        />
        {metrics.width > 0 ? (
          <div
            ref={overlayRef}
            role="presentation"
            className="absolute touch-none cursor-grab active:cursor-grabbing"
            style={{
              left: overlayLeft,
              top: overlayTop,
              width: overlayDiameter,
              height: overlayDiameter,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <div
              className={`relative h-full w-full border-2 border-dashed border-[#00c365] bg-white/85 shadow-[0_8px_24px_rgba(24,52,38,0.12)] ${
                props.value.shape === 'circle' ? 'rounded-full' : 'rounded-xl'
              }`}
            >
              {props.qrPreviewUrl ? (
                <img
                  src={props.qrPreviewUrl}
                  alt="二维码预览"
                  className={`h-full w-full object-cover ${
                    props.value.shape === 'circle' ? 'rounded-full' : 'rounded-[10px]'
                  }`}
                  draggable={false}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-medium text-[#0a7a45]">
                  二维码
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
      <div className="grid max-w-[420px] grid-cols-3 gap-3 text-sm text-slate-600">
        <div>
          <div className="text-xs text-slate-400">中心 X</div>
          <div className="font-medium tabular-nums">{props.value.centerX.toFixed(3)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">中心 Y</div>
          <div className="font-medium tabular-nums">{props.value.centerY.toFixed(3)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">直径</div>
          <div className="font-medium tabular-nums">{props.value.diameter.toFixed(3)}</div>
        </div>
      </div>
    </div>
  );
}
