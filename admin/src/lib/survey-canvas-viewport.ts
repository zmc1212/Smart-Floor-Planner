export const SURVEY_VIEWER_MIN_SCALE = 0.002;
export const SURVEY_VIEWER_MAX_SCALE = 4;
export const SURVEY_VIEWER_DEFAULT_SCALE = 0.05;

export type SurveyViewport = {
  scale: number;
  offsetX: number;
  offsetY: number;
  rotationRad?: number;
};

export type SurveyCanvasRect = {
  width: number;
  height: number;
};

export type SurveyCanvasPoint = {
  x: number;
  y: number;
};

export type SurveyNodeLike = {
  xMm?: number;
  yMm?: number;
};

const DEFAULT_PADDING = { x: 96, y: 96 };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rotateVector(x: number, y: number, rotationRad = 0) {
  if (!rotationRad) return { x, y };
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

export function createReadonlySurveySession() {
  return { state: 'spaceClosed' as const };
}

export function createReadonlySurveyFloor<T extends Record<string, unknown>>(floor: T) {
  return {
    ...floor,
    session: createReadonlySurveySession(),
  };
}

export function fitSurveyViewport(
  nodes: SurveyNodeLike[] | undefined,
  rect: SurveyCanvasRect,
  padding = DEFAULT_PADDING,
): SurveyViewport {
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const points = Array.isArray(nodes) ? nodes : [];
  if (!points.length) {
    return { scale: SURVEY_VIEWER_DEFAULT_SCALE, offsetX: 0, offsetY: 0 };
  }

  const xs = points.map((node) => Number(node.xMm || 0));
  const ys = points.map((node) => Number(node.yMm || 0));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const widthMm = Math.max(1000, maxX - minX);
  const heightMm = Math.max(1000, maxY - minY);
  const availableWidth = Math.max(80, width - padding.x * 2);
  const availableHeight = Math.max(80, height - padding.y * 2);
  const scale = clamp(
    Math.min(availableWidth / widthMm, availableHeight / heightMm),
    SURVEY_VIEWER_MIN_SCALE,
    SURVEY_VIEWER_MAX_SCALE,
  );

  return {
    scale,
    offsetX: -((minX + maxX) / 2) * scale,
    offsetY: -((minY + maxY) / 2) * scale,
  };
}

export function panSurveyViewport(viewport: SurveyViewport, dx: number, dy: number): SurveyViewport {
  const next: SurveyViewport = {
    scale: viewport.scale,
    offsetX: viewport.offsetX + dx,
    offsetY: viewport.offsetY + dy,
  };
  if (viewport.rotationRad) next.rotationRad = viewport.rotationRad;
  return next;
}

export function canvasPointToMm(
  point: SurveyCanvasPoint,
  rect: SurveyCanvasRect,
  viewport: SurveyViewport,
) {
  const unrotated = rotateVector(
    point.x - rect.width / 2 - viewport.offsetX,
    point.y - rect.height / 2 - viewport.offsetY,
    -(viewport.rotationRad || 0),
  );
  return {
    xMm: unrotated.x / viewport.scale,
    yMm: unrotated.y / viewport.scale,
  };
}

export function zoomSurveyViewport(
  viewport: SurveyViewport,
  rect: SurveyCanvasRect,
  localPoint: SurveyCanvasPoint,
  factor: number,
): SurveyViewport {
  const scale = clamp(viewport.scale * factor, SURVEY_VIEWER_MIN_SCALE, SURVEY_VIEWER_MAX_SCALE);
  const anchor = canvasPointToMm(localPoint, rect, viewport);
  const rotated = rotateVector(
    anchor.xMm * scale,
    anchor.yMm * scale,
    viewport.rotationRad || 0,
  );
  const next: SurveyViewport = {
    scale,
    offsetX: localPoint.x - rect.width / 2 - rotated.x,
    offsetY: localPoint.y - rect.height / 2 - rotated.y,
  };
  if (viewport.rotationRad) next.rotationRad = viewport.rotationRad;
  return next;
}
