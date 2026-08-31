export const RENDER_REVISION: string;

export function createSurveyRenderScene(input: {
  floor?: unknown;
  session?: unknown;
  viewport?: { scale?: number; offsetX?: number; offsetY?: number; rotationRad?: number };
  rect?: { width?: number; height?: number };
}): {
  walls?: Array<{ id?: string; selected?: boolean }>;
  openings?: unknown[];
  previewWall?: unknown;
  [key: string]: unknown;
};

export function drawSurveyScene(
  ctx: unknown,
  scene: unknown,
  options?: { dpr?: number },
): void;
