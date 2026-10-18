/** Provider-specific wire shape; never infer a provider from the model name. */
export function thinkingBody(baseUrl: string, enabled?: boolean) {
  if (enabled === undefined) return {};
  return new URL(baseUrl).origin === 'https://api.deepseek.com'
    ? { thinking: { type: enabled ? 'enabled' : 'disabled' } }
    : { enable_thinking: enabled };
}
