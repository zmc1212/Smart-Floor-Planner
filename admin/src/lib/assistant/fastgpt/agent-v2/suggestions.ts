export const suggestionLimit = 4;
export const suggestionMinimum = 3;
const maximumQuestionLength = 40;

/** One bounded generation input: this turn's delivered answer, no conversation
 * history, customer profile or internal identifiers. */
export function suggestionPrompt(answer: string) {
  const bounded = Array.from(answer.replace(/\[[^\]]*\]\(CITE\)/gu, '')).slice(0, 4000).join('');
  return `下面是本轮给客户的回答。请生成 3 条客户接着最可能问的问题，每行一条，不加序号、引号或解释，每条不超过 30 个字；只围绕回答内容和装修服务，不承诺优惠、报价、工期或企业内部信息。\n<<<回答开始>>>\n${bounded}\n<<<回答结束>>>`;
}

export function parseSuggestionQuestions(text: string): string[] {
  const questions: string[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
      .replace(/^(?:[-*•·–—]|\(?\d{1,2}[.、)）]|（\d{1,2}）)\s*/u, '')
      .replace(/^["“”'‘’「」]+|["“”'‘’「」]+$/gu, '')
      .trim();
    if (!line || line.includes('：') || Array.from(line).length > maximumQuestionLength) continue;
    if (Array.from(line).length < 2 || questions.includes(line)) continue;
    questions.push(line);
    if (questions.length === suggestionLimit) break;
  }
  return questions.length >= suggestionMinimum ? questions : [];
}

/** Stored questions cross a transaction boundary, so their shape is checked
 * again instead of trusting an older writer. */
export function storedSuggestionQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const questions = value.filter((item): item is string => typeof item === 'string' && item.trim() === item
    && Array.from(item).length >= 2 && Array.from(item).length <= maximumQuestionLength);
  return [...new Set(questions)].slice(0, suggestionLimit);
}

export type SuggestionResolution = { questions: string[]; source: 'model' | 'presets' };

export function resolveSuggestions(generated: string | null, configured: string[]): SuggestionResolution {
  const questions = generated ? parseSuggestionQuestions(generated) : [];
  return questions.length
    ? { questions, source: 'model' }
    : { questions: configured.slice(0, suggestionLimit), source: 'presets' };
}
