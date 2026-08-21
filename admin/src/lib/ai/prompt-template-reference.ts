export type PromptTemplatePreviewSource = {
  previewUrl?: string;
  localPreviewUrl?: string;
};

export type PromptTemplateReferencePlan = {
  canAttach: boolean;
  keptAssetIds: string[];
  previewSrc: string;
  reason?: 'no_preview' | 'no_slots' | 'no_capacity';
};

/** Prefer the authenticated same-origin cover so apply-template does not depend on CDN CORS. */
export function promptTemplatePreviewSrc(template: PromptTemplatePreviewSource) {
  return String(template.localPreviewUrl || template.previewUrl || '').trim();
}

export function planPromptTemplateReferenceAttach(input: {
  previewSrc: string;
  maxUserRefs: number;
  currentAssetIds: string[];
  previousTemplateAssetId?: string;
}): PromptTemplateReferencePlan {
  const previewSrc = input.previewSrc.trim();
  const previous = String(input.previousTemplateAssetId || '').trim();
  const keptAssetIds = input.currentAssetIds.filter((id) => id !== previous);
  if (!previewSrc) {
    return { canAttach: false, keptAssetIds: [...input.currentAssetIds], previewSrc: '', reason: 'no_preview' };
  }
  if (input.maxUserRefs < 1) {
    return { canAttach: false, keptAssetIds, previewSrc, reason: 'no_slots' };
  }
  if (keptAssetIds.length >= input.maxUserRefs) {
    return { canAttach: false, keptAssetIds, previewSrc, reason: 'no_capacity' };
  }
  return { canAttach: true, keptAssetIds, previewSrc };
}

export function mergeTemplateReferenceAsset<T extends { id: string }>(kept: T[], uploaded: T) {
  return [uploaded, ...kept.filter((item) => item.id !== uploaded.id)];
}

export function templateReferenceFileName(templateId: string, mimeType = 'image/png') {
  const id = templateId.trim() || 'template';
  const mime = mimeType.toLowerCase();
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
  return `prompt-template-${id}.${ext}`;
}

/** Server clone endpoint: preview GET 302s to CDN and the browser fetch cannot read it. */
export function promptTemplateCoverClonePath(templateId: string) {
  const id = templateId.trim();
  return id ? `/api/ai/creation/prompt-templates/${encodeURIComponent(id)}/reference` : '';
}
