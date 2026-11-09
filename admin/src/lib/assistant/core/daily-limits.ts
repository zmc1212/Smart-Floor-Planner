/** Daily spending ceilings are opt-in. Usage and unknown-outcome accounting
 * remain active even when these admission limits are disabled. */
export function assistantDailyLimitsEnabled(environment: Record<string, string | undefined> = process.env) {
  return environment.ASSISTANT_DAILY_LIMITS_ENABLED === '1';
}
