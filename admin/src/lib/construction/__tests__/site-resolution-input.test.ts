import assert from 'node:assert/strict';
import { test } from 'node:test';
import { naturalResolutionInput } from '../site-resolution-input';
const fields = { planId: '', recordId: '', excerpt: '书房按V2落实，事项已正式解决，尚未关闭。' };
const raw = '请正式解决书房底盒的问题。内部核对细节PRIVATE_INTERNAL不公开。给业主说：“书房按V2落实，事项已正式解决，尚未关闭。”只回传文字。';
test('formal resolution preserves the full internal original but selects only the explicit customer quotation and original policy', () => {
  const result = naturalResolutionInput(raw, 'resolve', '11', fields); assert.deepEqual(result.missing, []);
  assert.ok(result.command?.action === 'resolve'); assert.equal(result.command.conclusion, raw); assert.equal(result.command.excerpt, fields.excerpt); assert.equal(result.command.originals, false);
  const shared = naturalResolutionInput(raw.replace('只回传文字', '把本次落实照片原件也回传给业主'), 'close', '11', fields);
  assert.ok(shared.command?.action === 'close'); assert.equal(shared.command.originals, true);
});
test('missing, invented, conflicting or ambiguous disclosure cannot silently expose internal text or default an original policy', () => {
  for (const value of [raw.replace('只回传文字。', ''), raw + '把本次落实照片原件也回传给业主。', raw.replace('给业主说：', '对内说：'), raw + '告诉业主：“另一段”。'])
    assert.equal(naturalResolutionInput(value, 'resolve', '11', fields).command, undefined);
  assert.equal(naturalResolutionInput(raw, 'resolve', '11', { ...fields, excerpt: '模型重写的节选' }).command, undefined);
  assert.equal(naturalResolutionInput(raw, 'resolve', '11', { ...fields, planId: '2' }).command, undefined);
  assert.equal(naturalResolutionInput(raw, 'resolve', '11', fields, ['99']).command, undefined);
});
test('implementation needs selected formal objects, keeps the complete original and never adds customer disclosure', () => {
  const original = '书房已经按同意的V2完成，请记下本次现场落实。';
  const selected = { planId: '21', recordId: '31', excerpt: '' };
  const result = naturalResolutionInput(original, 'implement', '11', selected); assert.deepEqual(result.missing, []);
  assert.deepEqual(result.command, { action: 'implement', issueId: '11', planId: '21', recordId: '31', conclusion: original });
  assert.equal(naturalResolutionInput(original, 'implement', '11', { ...selected, planId: '' }).command, undefined);
  assert.equal(naturalResolutionInput(original, 'implement', '11', { ...selected, excerpt: '一并公开' }).command, undefined);
});
