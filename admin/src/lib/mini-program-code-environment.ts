export const MINI_PROGRAM_CODE_ENVIRONMENTS = ['develop', 'trial', 'release'] as const;

export type MiniProgramCodeEnvironment =
  (typeof MINI_PROGRAM_CODE_ENVIRONMENTS)[number];

export function isMiniProgramCodeEnvironment(
  value: unknown
): value is MiniProgramCodeEnvironment {
  return typeof value === 'string' && MINI_PROGRAM_CODE_ENVIRONMENTS.includes(
    value as MiniProgramCodeEnvironment
  );
}
