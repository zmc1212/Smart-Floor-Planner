# 抢单与赛马派单运行合同

状态：`Implemented`

## 入口与来源

- 后台 `/lead-pool` 供设计师抢单、企业负责人监控和人工指派；`/assignment-settings` 维护规则、容量和绩效视图。
- 小程序 `packages/business/lead-claim-pool/lead-claim-pool` 仅向当前企业的有效设计师展示脱敏线索；领取成功后才进入完整线索详情。设计师工作台显示待抢数量和最近窗口入口。
- 推荐人线索、后台手工录入、测量员活动码线索进入抢单/赛马链路；设计师本人活动码仍直接归出示设计师。测量员仍在新线索事务中预分配。

## 规则版本、容量与赛马

- 企业设置以不可变版本保存：抢单开关、窗口秒数、高绩效流量比例、签单率门槛、统计周期、最低有效样本及默认设计师容量。默认值为关闭、60 秒、70%、30%、180 天、10 单、20 条。
- 新线索或新抢单窗口读取当前版本并保存规则快照；已打开窗口不受后续改配置影响。员工 `leadCapacityOverride` 可覆盖企业默认容量。
- 在手量为本人负责、未归档且状态不是 `converted`/`closed` 的线索。到达容量后不能抢单，也不进入自动派单候选。
- 有效签单率为 `signed ÷ (signed + normal_lost)`。只有未失效且 `performanceEligible=true` 的结果快照进入统计；进行中、无效联系方式、重复、误录不进入分母。签单/结案时快照当时设计师，后续改派不重写历史归因。
- 达到最低样本且签单率达到门槛进入高绩效组，其他设计师和新人进入普通组。只有自动派单更新分流计数；持久化补差算法选择下一组，使累计高/普通比例最接近配置目标。组内按在手量、最早 `lastAssignedAt`、员工 ID 稳定排序；首选组为空或容量满时回退并写审计原因。

## 并发、截止与结案

- `POST /api/leads/[id]/claim` 以服务端时间、哈希幂等键和 `FOR UPDATE` 行锁裁决；同一设计师重试返回原成功结果，多人并发只有第一笔成功，其他请求返回 `409 lead_already_claimed`。
- 到达 `expiresAt` 后不能抢中，即使 worker 尚未扫描；请求会在事务内兜底执行自动派单。企业负责人可随时人工指派，并把开放窗口标记为人工结束。
- 独立 worker 每 2 秒扫描到期窗口，使用 `FOR UPDATE SKIP LOCKED` 与企业事务锁；无候选时回到 `assignment_pending/designer_unavailable`，沿用既有重试和负责人站内通知。
- 设计师可把本人线索按正常未签单原因结案；企业负责人可处理全部正常结案及无效/重复/误录分类。`other` 必须备注。签约、结案或归档会立即取消仍开放的抢单窗口。重新激活恢复结案前阶段，不恢复已取消预约；存在其他活动归属时返回冲突。归档仍只表示隐藏档案。

## 接口与租户边界

- 共享接口：`GET /api/lead-claim-pool`、`POST /api/leads/[id]/claim`、`GET/PUT /api/assignment-settings`、`GET /api/assignment-performance`、`POST /api/leads/[id]/close-lost`、`POST /api/leads/[id]/reopen`。
- 到期扫描为 `GET/POST /api/internal/lead-claim-windows/run`；只接受 `CRON_SECRET`。GET 返回进程内 worker 健康信息，POST 执行一轮扫描。
- 规则、窗口、结果快照和分流计数表全部启用并强制 RLS。业务接口从已签名会话解析企业，不接受客户端指定企业；平台任务只在平台事务中枚举到期窗口，再按企业锁定处理。
- 抢单窗口创建时始终写站内 `lead_claim_available`；仅向当时符合条件且明确授权的设计师尽力发送可选微信模板。模板缺失、未授权、微信失败都不回滚线索事务。

英文镜像：[lead-claim-racing.md](./lead-claim-racing.md)
