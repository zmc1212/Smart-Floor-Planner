export interface LlmModelOption {
  value: string;
  label: string;
}

export function isShorterModelPrefix(candidate: string, target: string) {
  const left = candidate.trim();
  const right = target.trim();
  return Boolean(left && right && left !== right && right.startsWith(left));
}

export function shouldShowLlmModelOption(
  input: string,
  option: LlmModelOption | undefined,
  options: LlmModelOption[],
) {
  const query = input.trim().toLowerCase();
  if (!query) return true;

  const isExactOption = options.some((item) => item.value.trim().toLowerCase() === query);
  if (isExactOption) return true;

  const haystack = `${option?.value ?? ''} ${option?.label ?? ''}`.toLowerCase();
  return haystack.includes(query);
}
