import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2] ?? 'tmp/i6.14/g-standard-01/run.json';
const run = JSON.parse(fs.readFileSync(file, 'utf8'));
const blocks = run.answer?.content?.blocks ?? [];
const citations = new Map((run.answer?.citations ?? []).map(citation => [citation.id, citation]));
const paragraphs = [];
let current = null;
for (const block of blocks) {
  if (block.type === 'text') {
    current = { text: block.text, citations: [] };
    paragraphs.push(current);
  } else if (block.type === 'citation' && current) {
    const citation = citations.get(block.citationId);
    if (citation) current.citations.push(citation);
  }
}
const quote = citation => String(citation?.quote ?? '');
const kind = citation => citation?.locator?.web?.standard?.kind;
const page = citation => citation?.locator?.web?.document?.page;
const standardId = 'GB55030-2022';
const has = (text, pattern) => pattern.test(text);
const checks = [];
const check = (name, passed, detail) => checks.push({ name, passed, detail });

const statusParagraphs = paragraphs.filter(paragraph => /现行有效|仍(?:然)?有效|目前有效|是否有效/.test(paragraph.text)
  && !/现行工程建设标准中/.test(paragraph.text));
check('现行状态有状态目录依据',
  statusParagraphs.length > 0 && statusParagraphs.every(paragraph => paragraph.citations.some(citation =>
    kind(citation) === 'status_catalog' && /现行/.test(quote(citation)) && quote(citation).includes(standardId))),
  statusParagraphs.map(paragraph => ({ text: paragraph.text.slice(0, 80), kinds: paragraph.citations.map(kind) })));

const noticeParagraphs = paragraphs.filter(paragraph => paragraph.citations.some(citation => kind(citation) === 'publication_notice'));
check('发布公告只承担发布/日期/废止事实',
  noticeParagraphs.every(paragraph => !/\d+(?:\.\d+)?\s*(?:mm|毫米|h|小时|min|分钟)/.test(paragraph.text)),
  noticeParagraphs.map(paragraph => paragraph.text.slice(0, 80)));

const numberPattern = /(\d+(?:\.\d+)?)\s*(mm|毫米|h|小时|min|分钟)/g;
const numericParagraphs = paragraphs.filter(paragraph => [...paragraph.text.matchAll(numberPattern)].length);
check('施工数值均有同段原件依据',
  numericParagraphs.length > 0 && numericParagraphs.every(paragraph => {
    const cited = paragraph.citations.map(quote).join('\n');
    return [...paragraph.text.matchAll(numberPattern)].every(match => cited.includes(match[1]));
  }), numericParagraphs.map(paragraph => paragraph.text.slice(0, 100)));

const compact = value => String(value ?? '').replace(/\s/g, '');
const idParagraphs = paragraphs.filter(paragraph => compact(paragraph.text).includes(standardId));
check('标准编号由正确来源支持',
  idParagraphs.length > 0 && idParagraphs.every(paragraph => paragraph.citations.some(citation =>
    compact(quote(citation)).includes(standardId))),
  idParagraphs.map(paragraph => paragraph.text.slice(0, 80)));

const scopeParagraphs = paragraphs.filter(paragraph => /建筑与市政工程|适用于|适用范围/.test(paragraph.text));
check('适用范围有正文/公告原文依据',
  scopeParagraphs.length > 0 && scopeParagraphs.every(paragraph => paragraph.citations.some(citation =>
    (kind(citation) === 'standard_text' && /建筑与市政工程|防水/.test(quote(citation)))
    || (kind(citation) === 'publication_notice' && /建筑与市政工程/.test(quote(citation))))),
  scopeParagraphs.map(paragraph => ({ text: paragraph.text.slice(0, 80), kinds: paragraph.citations.map(kind) })));

const statusOnlyNotice = statusParagraphs.filter(paragraph => paragraph.citations.length
  && paragraph.citations.every(citation => kind(citation) === 'publication_notice'));
check('未把公告首段当作全部条文依据', statusOnlyNotice.length === 0, statusOnlyNotice.map(paragraph => paragraph.text.slice(0, 80)));

check('不确定时明确说明不能确认或给出状态依据',
  statusParagraphs.some(paragraph => paragraph.citations.some(citation => kind(citation) === 'status_catalog'))
  || paragraphs.some(paragraph => /无法确认|不能确认|未能确认/.test(paragraph.text)), null);

check('真实模型回执', run.attempts?.length > 0 && run.attempts.every(attempt => attempt.remote_model === 'deepseek-v4.1-flash-1017'),
  run.attempts?.map(attempt => ({ status: attempt.status, model: attempt.remote_model })));

const verification = {
  source: path.resolve(file),
  runId: run.sent?.runId,
  question: run.question,
  status: run.run?.status,
  checks,
  passed: checks.every(item => item.passed),
  citations: [...citations.values()].map(citation => ({ id: citation.id, title: citation.title,
    kind: kind(citation), page: page(citation), status: citation.locator?.web?.standard?.status ?? null })),
  answer: paragraphs.map(paragraph => paragraph.text),
  checkedAt: new Date().toISOString(),
};
const output = path.join(path.dirname(file), 'verification.json');
fs.writeFileSync(output, JSON.stringify(verification, null, 2));
console.log(JSON.stringify({ passed: verification.passed, checks: checks.map(({ name, passed }) => ({ name, passed })), output }, null, 2));
if (!verification.passed) process.exitCode = 1;
