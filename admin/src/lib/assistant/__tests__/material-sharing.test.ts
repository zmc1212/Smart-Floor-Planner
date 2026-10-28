import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasMaterialShareReply, materialShareReplyIntent } from '@/lib/construction/material-sharing';
import { materialShareCompletionClaim } from '@/lib/construction/material-sharing-contract';
import { materialCommand } from '@/lib/construction/site-materials';
import { agentToolsForMessage } from '../agent/worker';

test('only an explicit project-team audience can confirm a material preview', () => {
  const c = { entry_snapshot: { materialShareProposal: { id: '1', status: 'applied' } } };
  for (const text of ['停止共享书房需求。', '停止共享测试工地乙的图纸。']) assert.equal(hasMaterialShareReply(text, c), false);
  assert.equal(hasMaterialShareReply('停止共享这次资料。', c), true);
  for (const text of ['可以，把这段共享给这个项目团队，其他聊天不要发。', '让这个工地所有成员都看这份资料。', '确认共享给项目团队。'])
    assert.equal(materialShareReplyIntent(text), 'confirm', text);
  for (const text of ['好', '收到', '给设计师看看', '只给设计师看', '不要共享给项目团队。', '能不能共享给项目团队？',
    '如果共享给项目团队会怎样', '“共享给项目团队”是什么意思', '共享给项目团队，但不要让师傅看', '共享给项目团队，只有设计师能看', '别撤回共享资料',
    '我说的是测试工地乙，把这段共享给项目团队。', '共享给项目团队，只包括设计师。', '把这段共享给项目团队，但仅对设计师可见。'])
    assert.notEqual(materialShareReplyIntent(text), 'confirm', text);
  for (const text of ['取消本次共享', '不要再共享了', '停止共享这张图', '撤回共享资料123'])
    assert.equal(materialShareReplyIntent(text), 'cancel', text);
});
test('natural sharing uses the typed existing runtime without exposing write tools to history-only turns', () => {
  assert.ok(agentToolsForMessage('把书房这段需求给设计师看看', true).some(t => t.name === 'prepare_material_share'));
  assert.ok(agentToolsForMessage('停止共享刚才的点位图', true).some(t => t.name === 'revoke_material_share'));
  assert.ok(agentToolsForMessage('改成客厅', true, false, false, false, true).some(t => t.name === 'prepare_material_share'));
  assert.ok(!agentToolsForMessage('只查我以前的聊天原话', true).some(t => /material_share/.test(t.name)));
  assert.ok(!agentToolsForMessage('今天天气很好', true).some(t => /material_share/.test(t.name)));
});
test('sharing completion prose cannot substitute for a real grant or revocation receipt', () => {
  for (const text of ['已经把资料发给设计师了', '已共享给项目团队', '这次共享成功', '资料已撤回']) assert.ok(materialShareCompletionClaim(text));
  for (const text of ['当前尚未共享。', '还没有共享，先确认收件范围。', '请选择要停止共享的资料。']) assert.ok(!materialShareCompletionClaim(text));
});
test('legacy share syntax cannot bypass an explicitly restricted recipient audience', () => {
  assert.ok(materialCommand('共享工地甲·书房点位图：尚未发图'));
  assert.ok(materialCommand('共享工地甲·客厅需求：双人沙发靠窗摆放'));
  assert.equal(materialCommand('共享工地甲·书房需求：只给设计师看靠窗办公'), null);
  assert.equal(materialCommand('共享工地甲·书房需求：靠窗办公，不要让师傅看'), null);
  assert.equal(materialCommand('共享工地甲·书房需求：共享给项目团队，只包括设计师。'), null);
  for (const text of ['双人书桌，仅向张三开放。', '留两个插座，供张三查看。', '沿窗办公位，张三专享。', '双人书桌，传张三一份。'])
    assert.equal(materialCommand('共享工地甲·书房需求：' + text), null, text);
});
