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
  camera_storage_low:'云录像存储空间不足，已启用录制保护；恢复安全空间后自动核对原录像设置。直播和已有录像仍可查看。',
  camera_storage_unavailable:'暂时无法核对云录像存储空间，已启用录制保护。请联系管理员检查，直播和已有录像仍可查看。',
  camera_recording_clock_unavailable:'录像时间暂无法核对，请联系管理员处理。',
  camera_recording_busy:'请先关闭云端录像，并确认状态为“已停止”后再解绑。',
  camera_recording_not_configured:'云端录像服务尚未配置，请联系管理员。',camera_recording_conflict:'摄像头已有其他录像计划，未覆盖原设置，请联系管理员核对。',
  camera_invalid_retention:'请填写当前节点允许范围内的整数保留天数。',construction_camera_recordings_require_cleanup:'请先关闭录像并完成该企业私有录像文件清理，再删除企业数据。',
  camera_unavailable: '摄像头不存在或已停用，请刷新后重试。', camera_already_assigned: '该通道已分配，不能重复认领。',
  camera_already_bound: '摄像头已绑定其他工地，请先在原工地解绑。', camera_invalid_channel: '请核对 WVP 设备和视频通道编号。',
  camera_forbidden: '当前身份没有此摄像头操作权限。', camera_not_configured: '视频服务尚未配置，请联系管理员。',
  camera_service_unavailable: '摄像头服务暂不可用，请稍后重试。', camera_control_busy: '云台仍在核对停止状态，请稍后重试。',
  camera_project_unavailable: '工地已停用或访问权限已变化，请重新进入。',
  service_order_camera_limit: '本工地托管订单的摄像头路数已全部绑定，请先解绑或调整订单后再试。',
  service_order_not_confirmed: '托管订单确认后才能绑定摄像头，请先完成报价确认。',
  service_order_ended: '托管服务已退场，请先在“托管服务”Tab建立并确认新的托管订单后再绑定摄像头。',
  service_order_devices_active: '退场前须先在“工地视频”Tab解除全部摄像头绑定（并停止录像）。',
  service_order_repairs_open: '仍有未关闭的报修事项，请先登记解决或取消后再办理退场。',
  service_order_deposit_exceeds: '押金退回与扣减合计不能超过已确认报价的押金。',
  service_order_extension_limit: '服务期（含延期）不能超过 3650 天。',
  service_order_repair_not_found: '报修事项不存在或已不属于当前订单。',
  service_order_repair_conflict: '报修事项已处理，请刷新后查看最新状态。',
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
  service_order_forbidden: '当前身份没有托管订单管理权限。', service_order_project_unavailable: '工地不存在、已停用或已失去访问权限。',
  service_order_project_inactive: '项目已暂停或归档，不能新建托管订单。', service_order_open_exists: '该工地已有一张未结束的托管订单，请先处理原订单。',
  service_order_conflict: '订单状态已有变化，请刷新后核对。', service_order_quote_changed: '报价已有新版本，请核对最新报价后重新确认。',
  service_order_installer_unavailable: '请选择本工程地在职成员作为安装人员。', service_order_room_unavailable: '所选房间不属于本项目，请刷新后重新选择。',
  service_order_points_locked: '点位已开始安装或验收，不能再更换点位清单。', service_order_point_not_installed: '该点位尚未登记安装，不能直接验收。',
  service_order_point_conflict: '点位状态已有变化，请刷新后核对。', service_order_point_not_found: '点位不存在或不属于本订单。',
  service_order_not_found: '托管订单不存在或已失去访问权限。', service_order_schedule_past: '安装日期不能早于今天。',
  invalid_service_order: '请核对摄像头路数、保留天数、服务期、金额和点位后重试。',
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
export const errorText = (error: unknown) => error instanceof Error ? error.message : error&&typeof error==='object'&&'code' in error ? messages[String(error.code)]||'操作失败，请重试。' : '操作失败，请重试。';
