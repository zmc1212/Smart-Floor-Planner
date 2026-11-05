import fs from 'node:fs';
import assert from 'node:assert/strict';

const limits = Object.freeze({ lines: 160, characters: 8000, currentCharacters: 2400 });
const fields = ['交付与负责人', '用户入口与结果', '已证缺口', '已完成', '下一动作', '必要验收', '失败与调用边界', '环境与资源', '证据与后继'];

export function checkPlan(source) {
  const text = source.replace(/\r\n/g, '\n');
  const errors = [];
  const characters = Array.from(text).length;
  const lines = text.trimEnd().split('\n').length;
  if (characters > limits.characters) errors.push(`全文${characters}字符，超过${limits.characters}；移除重复记录并链接原证据。`);
  if (lines > limits.lines) errors.push(`全文${lines}行，超过${limits.lines}。`);
  const sections = [...text.matchAll(/^## 2\. 唯一当前任务\s*$/gm)];
  if (sections.length !== 1) errors.push('必须且只能有一个“## 2. 唯一当前任务”。');
  if (sections.length === 1) {
    const start = sections[0].index + sections[0][0].length;
    const remainder = text.slice(start);
    const next = remainder.search(/^## /m);
    const current = next < 0 ? remainder : remainder.slice(0, next);
    if (Array.from(current).length > limits.currentCharacters) errors.push(`第2节超过${limits.currentCharacters}字符；只保留当前结论及证据链接。`);
    const content = current.split('\n').filter(line => line.trim());
    if (content.some(line => !line.startsWith('|'))) errors.push('第2节只允许一张当前记录表，不追加本轮/历史/交接段落。');
    if (content[0]?.replace(/\s/g, '') !== '|字段|当前记录|' || !/^\|\s*-+\s*\|\s*-+\s*\|$/.test(content[1] || ''))
      errors.push('第2节须使用“字段 / 当前记录”表头。');
    const entries = content.slice(2).map(line => line.split('|')[1]?.trim());
    if (entries.length !== fields.length || new Set(entries).size !== fields.length || fields.some(field => !entries.includes(field)))
      errors.push('第2节须恰有9个约定字段；替换现值，不追加补丁或旧“下一步”行。');
    if (content.slice(2).some(line => !line.split('|').slice(2, -1).join('|').trim())) errors.push('当前记录字段不能为空；未知项应明确说明。');
    if (!content.some(line => line.startsWith('| 交付与负责人 |') && line.includes('方法约束：先验证真实回答，禁止补丁循环')))
      errors.push('当前负责人记录须保留用户方法约束：先验证真实回答，禁止补丁循环。');
  }
  if (!text.includes('禁止自动新建或交接聊天') || !text.includes('仅用户明确要求才新建/转移'))
    errors.push('用户已撤销容量自动交接授权；计划须保留禁止自动交接、仅按明确要求新建/转移的规则。');
  if (!text.includes('### 6.3 防止方法偏离')) errors.push('不得遗漏防止方法偏离的当前约束。');
  return { errors, lines, characters };
}

const source = fs.readFileSync(new URL('../docs/xiaok-renovation-agent-development-plan.md', import.meta.url), 'utf8');
if (process.argv.includes('--self-test')) {
  assert.deepEqual(checkPlan(source).errors, []);
  const probes = [
    [source + '\n' + 'x'.repeat(8001), '超长全文'],
    [source + '\n'.repeat(160) + 'tail', '超长行数'],
    [source.replace('## 3.', 'extra prose\n\n## 3.'), '当前记录追加段落'],
    [source.replace('| 下一动作 |', '| 旧下一动作 |'), '当前字段被替换/遗漏'],
    [source.replace('## 3.', '| 本轮新增 | 不得追加 |\n\n## 3.'), '追加历史行'],
    [source + '\n## 2. 唯一当前任务\n', '多个当前任务区'],
    [source.replace('| 下一动作 |', '| 下一动作 | ' + 'x'.repeat(2401)), '超长当前记录'],
    [source.replace('方法约束：先验证真实回答，禁止补丁循环', '继续排查内部规则'), '遗漏最新方法约束'],
    [source.replaceAll('禁止自动新建或交接聊天', '自动开启后继'), '恢复自动交接'],
    [source.replace('### 6.3 防止方法偏离', '### 6.3 历史记录'), '遗漏防偏离规则'],
  ];
  for (const [invalid, name] of probes) assert.ok(checkPlan(invalid).errors.length, `${name}必须被发现`);
  console.log(`PASS：有效计划及${probes.length}类膨胀反例。`);
} else {
  const result = checkPlan(source);
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`PASS：小K计划${result.lines}/${limits.lines}行、${result.characters}/${limits.characters}字符；唯一当前记录符合限制。`);
}
