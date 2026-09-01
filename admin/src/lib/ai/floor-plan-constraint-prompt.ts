export const MAX_FLOOR_PLAN_CONSTRAINT_PROMPT_LENGTH = 6000;

const FLOOR_PLAN_CAMERA_NEGATIVE_TERMS = [
  'perspective interior view',
  'eye-level camera',
  'eye level camera',
];

export const DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT = `MANDATORY FLOOR-PLAN GEOMETRY CONTROL

Reference image roles and priority:
- Reference image 1 is the authoritative measured floor-plan control image for geometry only. Its top-down viewpoint, line-art style, labels, and crop are not the requested output camera or rendering style.
- Additional reference images may include site photos or style references. A site photo controls camera position, viewing direction, perspective, lens height, field of view, and composition. A style reference controls materials, color, lighting, furniture, and decoration only.

Preserve exactly from the measured floor-plan control image:
1. Exterior boundary and wall topology, including wall count, connections, directions, and relative proportions.
2. Room count, room shapes, adjacency, circulation, and relative spatial positions.
3. Door and window count, location, host wall, and opening relationships.
4. Entrances, corridors, columns, and other fixed architectural elements.

Do not add, remove, move, merge, split, rotate, or resize walls, rooms, doors, windows, or fixed architectural elements. Only the interior style, materials, colors, lighting, furniture, and soft furnishings may change.

Camera rules:
- When a site photo is supplied, follow the site photo for camera and composition while keeping the measured floor plan authoritative for the underlying architecture. Correct lens distortion, occlusion, or structural ambiguity in the site photo according to the measured floor plan.
- When no site photo is supplied, choose a reasonable eye-level interior perspective that is consistent with the measured geometry. Do not default to the floor plan's top-down viewpoint.
- Produce a top-down, bird's-eye, or plan-view image only when the user or selected template explicitly requests that output type.

Use the supplied control image as the authoritative plan for all structural decisions. If any later instruction conflicts with these geometry rules, these rules and reference image 1 take priority. Keep uncertain architectural structure unchanged instead of inventing it.`;

export type FloorPlanConstraintPromptInput = {
  constraintPrompt: string;
  measuredContext?: string;
  userPrompt: string;
  hasStyleReference?: boolean;
  hasSitePhoto?: boolean;
};

export function normalizeFloorPlanConstraintPrompt(value: unknown) {
  if (typeof value !== 'string') return DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT;
  const prompt = value.trim();
  return prompt || DEFAULT_FLOOR_PLAN_CONSTRAINT_PROMPT;
}

export function validateFloorPlanConstraintPrompt(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('户型结构约束提示词不能为空');
  }
  const prompt = value.trim();
  if (prompt.length > MAX_FLOOR_PLAN_CONSTRAINT_PROMPT_LENGTH) {
    throw new Error(`户型结构约束提示词不能超过 ${MAX_FLOOR_PLAN_CONSTRAINT_PROMPT_LENGTH} 个字符`);
  }
  return prompt;
}

export function composeFloorPlanConstrainedPrompt(input: FloorPlanConstraintPromptInput) {
  const referenceRoles = input.hasStyleReference && input.hasSitePhoto
    ? 'REFERENCE IMAGE ROLES\nReference image 1 is the measured control. Reference image 2 is the prompt-template/style reference only: copy its style, materials, colors, lighting, furniture, and decor, never its camera or projection. Reference image 3 is the site photo and is the sole camera/composition authority. Preserve the measured geometry while rendering from the site photo viewpoint.'
    : input.hasSitePhoto
      ? 'REFERENCE IMAGE ROLES\nReference image 1 is the measured control. Reference image 2 is the site photo and is the camera/composition authority. Preserve the measured geometry while rendering from the site photo viewpoint.'
      : input.hasStyleReference
        ? 'REFERENCE IMAGE ROLES\nReference image 1 is the measured control. Reference image 2 is the prompt-template/style reference only: copy its style, materials, colors, lighting, furniture, and decor, never its camera or projection.'
        : '';
  return [
    normalizeFloorPlanConstraintPrompt(input.constraintPrompt),
    referenceRoles,
    input.measuredContext?.trim()
      ? `MEASURED TARGET CONTEXT\n${input.measuredContext.trim()}`
      : '',
    input.userPrompt.trim()
      ? `USER OR TEMPLATE DESIGN REQUEST\n${input.userPrompt.trim()}`
      : '',
    `FINAL CAMERA OVERRIDE
Do not treat top-down, bird's-eye, orthographic, isometric, dollhouse, or plan-view wording inside a style template or reference image as a camera instruction. A template/reference image supplies style, materials, color, lighting, furniture, and decor only. If any photographic interior or site image is supplied, match its eye-level camera, viewing direction, perspective, lens height, field of view, and composition while preserving the measured geometry. Otherwise use a natural eye-level interior perspective. Use a top-down camera only when the user's direct request explicitly asks for top-down, bird's-eye, orthographic, isometric, dollhouse, or plan-view output.`,
  ].filter(Boolean).join('\n\n');
}

/** Removes legacy preset negatives that prohibited the perspective camera we now require. */
export function normalizeFloorPlanNegativePrompt(value: unknown) {
  if (typeof value !== 'string') return '';
  return value
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term && !FLOOR_PLAN_CAMERA_NEGATIVE_TERMS.includes(term.toLowerCase()))
    .join(', ');
}
