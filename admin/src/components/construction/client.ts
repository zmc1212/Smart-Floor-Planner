import type { NeedFollowUp } from '@/lib/construction/stages';

export const labels: Record<string, string> = { active: '进行中', paused: '已暂停', archived: '已归档', manager: '项目经理', designer: '设计协作', worker: '施工协作', observer: '只读成员' };
export type Project = { id: string; lead_id?: string; name: string; status: string; customer_access: boolean; version: number; current_stage_key: string | null; progress_note: string };
export type Staff = { id: string; display_name: string; role: string; construction_trades: string[] };
export type ConstructionLead = { id: string; name: string; community_name: string | null };
export type Stage = { key: string; name: string; visitReminder: boolean; visitReason: string; watchPoints: string; followUps?: NeedFollowUp[] };
export const followUpFieldLabels: Record<NeedFollowUp['field'], string> = { housing: '房屋情况', household: '居住成员', style: '风格', budget: '预算意向', timeline: '时间意向', daylight: '房间采光', desk: '房间办公', storage: '房间收纳', use: '房间用途', devices: '房间设备', other: '房间其他需求' };
export type StageSettings = { stages: Stage[]; version: number; owner: boolean };
export type Detail = { project: Project; owner: boolean; manage: boolean; rooms: Array<{ id: string; name: string }>; stages: Stage[]; settingsVersion: number; staff: Staff[]; assignments: Array<{ stage_key: string; admin_id: string; is_primary: boolean; display_name: string; staff_status: string }>; members: Array<{ admin_id: string; role: string; active: boolean; work_label: string; display_name: string; staff_status: string }>; audits: Array<{ action: string; created_at: string }> };
export type Pending = { path: string; method: string; body: object; key: string };
const messages: Record<string, string> = {
  public_source_unavailable: '原始材料已有变化或访问已撤销，请读取最新材料；当前编辑保留。',
  public_consent_required: '须由业主查看完整预览并明确同意这一版，再由企业审核公开。', public_preview_required: '业主尚未查看这一版完整预览。',
  public_state_conflict: '公开材料状态已变化，请读取最新材料后重新核对。', public_material_sensitive: '节选或名称仍有联系方式或门牌，请完成脱敏。',
  invalid_public_material: '请检查名称、真实片区、原文节选和照片遮挡范围。',
  construction_forbidden: '当前账号无施工项目权限，请联系企业管理员。', construction_not_found: '项目不存在或已失去访问权限。',
  construction_staff_unavailable: '请选择本企业在职员工。', construction_member_required: '请先将员工加入本工地，再分配阶段。', construction_lead_unavailable: '客户线索不存在或不属于本企业，请返回客户线索重新选择。',
  construction_lead_inactive: '客户线索已归档或结案，请先恢复或重新激活后再建立工地。', construction_customer_required: '该线索尚未关联小程序客户账号，请完成客户关联后再建立工地。',
  construction_project_inactive: '项目已暂停或归档，不能确认新的安排。', construction_customer_unavailable: '客户关联或访问范围已变化，请刷新核对。',
  construction_manager_required: '项目至少保留一位有效项目经理。',
  construction_stage_in_use: '该节点仍是项目的当前节点，请先调整项目节点再删除。', construction_stage_unavailable: '节点配置已有变化，请刷新后选择。',
  invalid_construction_phone: '请同时填写联系人和有效电话，或同时清空。', construction_reminder_disabled: '该节点尚未开启到场提醒，请先配置提醒内容。',
  invalid_construction: '请核对必填项、长度与状态后重试。', version_conflict: '项目或安排已有更新，请刷新核对；当前输入保留。',
  idempotency_conflict: '本次请求与原操作不一致，请先核对原提交。', Unauthorized: '登录已失效，请重新登录。', Forbidden: '当前账号无权访问。',
  'Please select an enterprise first': '请先在顶部选择企业。',
};
export class ConstructionRequestError extends Error { constructor(readonly uncertain: boolean, message: string, readonly statusCode?: number, readonly code?: string) { super(message); } }
export async function constructionRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch('/api/construction/' + path, { ...init, cache: 'no-store', signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) }); }
  catch (error) { if (init.signal?.aborted) throw error; throw new ConstructionRequestError(true, '连接中断，提交结果待核对。请核对同一次操作。'); }
  let payload;
  try { payload = await response.json(); } catch { throw new ConstructionRequestError(true, '回执不完整，请核对同一次操作。'); }
  if (!response.ok || !payload.success) throw new ConstructionRequestError(response.status >= 500, messages[payload.error] || '施工计划服务暂不可用，请稍后重试。', response.status, payload.error);
  return payload.data as T;
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
