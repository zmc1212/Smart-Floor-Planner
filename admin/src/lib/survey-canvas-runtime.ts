import * as rendererModule from './survey-runtime/surveyCanvasRenderer.js';

type SurveyCanvasRuntime = {
  RENDER_REVISION: string;
  createSurveyRenderScene: typeof import('./survey-runtime/surveyCanvasRenderer.js')['createSurveyRenderScene'];
  drawSurveyScene: typeof import('./survey-runtime/surveyCanvasRenderer.js')['drawSurveyScene'];
};

const resolved = rendererModule as SurveyCanvasRuntime & { default?: SurveyCanvasRuntime };
const runtime = (
  typeof resolved.createSurveyRenderScene === 'function'
    ? resolved
    : resolved.default
) as SurveyCanvasRuntime | undefined;

if (!runtime?.createSurveyRenderScene || !runtime.drawSurveyScene) {
  throw new Error('Survey canvas runtime failed to load createSurveyRenderScene/drawSurveyScene');
}

export const RENDER_REVISION = runtime.RENDER_REVISION;
export const createSurveyRenderScene = runtime.createSurveyRenderScene;
export const drawSurveyScene = runtime.drawSurveyScene;
