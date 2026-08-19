export function buildConversationFallbackPrompt(input: {
  userMessage: string;
  floorPlanContext: string;
  hasBaselineImage: boolean;
}) {
  const instruction = input.hasBaselineImage
    ? 'Edit the supplied interior rendering. Keep the same camera, architecture, and furniture layout unless the designer explicitly asks to change them. Apply only the requested design change.'
    : 'Generate a photorealistic interior design rendering from the supplied measured floor-plan control image. Preserve wall topology, room adjacency, openings, and circulation.';
  return [instruction, input.userMessage.trim(), input.floorPlanContext].filter(Boolean).join('\n\n');
}

export function conversationPromptExpansionMessages(input: {
  userMessage: string;
  floorPlanContext: string;
  hasBaselineImage: boolean;
  previousPrompt?: string;
}) {
  return [
    {
      role: 'system' as const,
      content: 'You write concise English image-generation prompts for interior design renderings. Return only the prompt text, no quotes or markdown.',
    },
    {
      role: 'user' as const,
      content: [
        input.hasBaselineImage
          ? 'The next image should edit the previous rendering according to the designer request.'
          : 'The next image should be generated from a measured floor-plan control image.',
        input.previousPrompt ? `Previous prompt:\n${input.previousPrompt}` : '',
        `Designer request:\n${input.userMessage.trim()}`,
        input.floorPlanContext,
        'Preserve the measured architecture. Do not invent or remove walls, doors, or windows.',
      ].filter(Boolean).join('\n\n'),
    },
  ];
}

export function resolveConversationBaseline<T extends {
  id: bigint;
  status: string;
  output?: unknown;
}>(generations: T[], baselineGenerationId?: bigint | null) {
  if (baselineGenerationId) {
    const selected = generations.find((generation) => generation.id === baselineGenerationId);
    if (!selected) {
      throw Object.assign(new Error('指定的参考图不存在或不属于当前方案对话'), { status: 400, code: 'BASELINE_NOT_FOUND' });
    }
    if (selected.status !== 'succeeded' || !hasImageUrl(selected.output)) {
      throw Object.assign(new Error('指定的参考图尚未生成成功'), { status: 400, code: 'BASELINE_NOT_READY' });
    }
    return selected;
  }
  return generations.find((generation) => generation.status === 'succeeded' && hasImageUrl(generation.output)) || null;
}

function hasImageUrl(output: unknown) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return false;
  const imageUrl = (output as Record<string, unknown>).imageUrl;
  return typeof imageUrl === 'string' && imageUrl.trim().length > 0;
}
