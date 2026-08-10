# 测量员—设计师获客协作与提成闭环

本文档是测量员、设计师、线索、通知和获客提成之间的专项业务与数据契约。后续继续细化本功能时，以当前代码、数据库 schema、迁移和本文档共同作为工作入口；如果实现与本文档冲突，应先更新契约并说明兼容策略。

## 1. 目标与范围

本闭环解决以下业务问题：

1. 企业管理员为每个测量员绑定一个设计师。
2. 设计师账户维护微信号和个人微信二维码。
3. 测量员在小程序录入客户线索后，系统自动把线索归属到绑定设计师。
4. 设计师确认已经通过微信加到客户后，把线索从 `new` 标记为 `acquired`（已获客）。
5. 确认成功后，按企业当前固定金额为测量员生成一条待结算获客提成。
6. 设计师和测量员通过站内通知获得状态变化提醒；微信订阅消息作为增强通道，不作为事务成功条件。

本功能不改变现有订单提成的结算语义，也不替代后续量房、设计和成交流程。`acquired` 只是线索转化中的一个新状态，已获客线索仍可进入现有 `measuring` 等流程。

## 2. 当前状态

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 测量员绑定设计师 | `Implemented` | 一个测量员只能有一条当前绑定；一个设计师可以绑定多个测量员。 |
| 设计师微信资料 | `Implemented` | `wechat_id` 和个人二维码均由设计师角色必填；二维码通过 `media_assets` 保存。 |
| 测量员创建线索 | `Implemented` | 服务端忽略客户端传入的负责人和状态，按绑定关系写入测量员、设计师和 `new`。 |
| 设计师确认获客 | `Implemented` | 仅本人负责且处于 `new` 的线索可确认，使用条件更新避免重复确认。 |
| 获客提成 | `Implemented` | 独立于订单提成，确认时快照企业固定金额，初始状态为 `pending_settlement`。 |
| 站内/微信通知 | `Implemented` | 站内通知可靠落库；微信发送失败不回滚线索或提成。 |
| 自动发放提成 | `Limited` | 当前只支持后台人工把待结算记录标记为 `paid`，不包含支付渠道或银行代发。 |

## 3. 核心业务规则

### 3.1 员工关系

- 测量员必须绑定同一企业内、状态为 `active`、角色为 `designer` 的设计师。
- 一个测量员只能绑定一个设计师；一个设计师可以绑定多个测量员。
- 换绑只影响之后新建的线索，历史线索保留创建时的 `assigned_to` 和设计师快照。
- 仍有测量员绑定的设计师不能直接删除或停用，必须先完成换绑。
- 设计师必须填写微信号并上传个人微信二维码；二维码只通过带签名的访问地址提供给同企业授权用户，不把 Base64 长期写入账户表。

### 3.2 线索状态与创建

- 测量员小程序提交线索时，服务端以当前登录员工为准写入 `promoter_id`。
- 服务端从 `measurer_designer_bindings` 解析设计师并写入 `assigned_to`，客户端不能覆盖负责人或状态。
- 新建线索状态固定为 `new`。
- 保留现有手机号去重逻辑：命中已有线索时返回已有数据，不重复发通知，也不重复生成提成。
- 没有绑定设计师时，测量员不能创建新线索，接口必须返回明确的绑定缺失错误。

产品展示统一使用一条主流程状态：`new`（新线索）→ `acquired`（已获客）→
`measuring`（量房中）→ `designing`（方案设计）→ `converted`（已签约）。
`closed`（已关闭）是主流程之外的终止状态。历史值 `contacted`、`measured`、
`assigned`、`quoting` 继续可读，并在 API 筛选和客户端文案中归并到新线索或方案设计；
新写入和户型驱动的状态流转使用上述规范值。

关联草稿户型时，`new` 或 `acquired` 线索进入 `measuring`；关联已完成正式户型时，
未关闭的 `new`、`acquired` 或 `measuring` 线索进入 `designing`。状态推进后仍保留
`acquired_at` 和 `acquired_by` 作为获客审计记录。

### 3.3 设计师确认

- `POST /api/leads/[id]/acquire` 仅允许 `designer` 调用。
- 设计师只能确认 `assigned_to` 等于自己的线索。
- 只允许从 `new` 确认一次；已确认、非本人负责或其他状态均拒绝。
- 线索原子更新为 `acquired`，同时写入 `acquired_at` 和 `acquired_by`。
- 线索更新与唯一获客提成创建必须在同一事务中完成；并发请求只能成功一次。

### 3.4 获客提成

- 企业配置字段：`enterprises.measurer_acquisition_fixed_commission`，默认 `0.00`。
- 提成金额在设计师确认时快照，之后修改企业配置不影响历史记录。
- 每条线索最多一条获客提成，由 `lead_id` 唯一约束保证幂等。
- 状态：`pending_settlement`（待结算）、`paid`（已发放）、`voided`（作废）。当前业务只允许 `pending_settlement -> paid`，作废需后续明确业务入口和审计要求。
- `paid` 必须记录 `settled_at` 和 `settled_by`。

## 4. 数据模型

### `admin_users`

- `wechat_id`：设计师微信号。
- `wechat_qr_asset_id`：指向 `media_assets` 的个人二维码资产 ID。
- DTO 对测量员返回 `boundDesignerId`；设计师资料按权限返回微信号和签名二维码地址。

### `measurer_designer_bindings`

- `measurer_id`：主键，同时保证一个测量员只有一个当前绑定。
- `designer_id`：绑定设计师。
- `enterprise_id`：租户边界和同企业校验依据。
- `created_at`、`updated_at`：关系审计时间。

### `leads`

- `promoter_id`：录入线索的测量员。
- `assigned_to`：创建时绑定的设计师；历史线索不随换绑迁移。
- `status`：规范当前状态为 `new`、`acquired`、`measuring`、`designing`、
  `converted`、`closed`；历史状态仍可读取，并在 API 筛选和客户端标签中归一化。
- `acquired_at`、`acquired_by`：设计师确认时间和确认人。

### `lead_acquisition_commissions`

- `lead_id` 唯一。
- `enterprise_id`、`measurer_id`、`designer_id`：确认时的归属快照。
- `commission_amount`：企业固定金额快照，金额类型为 `numeric(14,2)`。
- `status`、`generated_at`、`settled_at`、`settled_by`：结算状态和审计字段。

### `staff_notifications`

- 接收员工、企业、线索、通知类型、站内状态、微信发送状态、错误信息、去重键和跳转参数均需落库。
- 去重键按 `(dedupe_key, channel)` 建立部分唯一索引；通知写入的冲突目标使用同一
  `dedupe_key IS NOT NULL` 条件，确保 PostgreSQL 能应用该去重规则，防止重复手机号、重复确认或重试造成重复通知。
- 线索通知跳转参数必须包含线索 ID，目标路径为：
  `/pages/leads-management/leads-management?leadId=<leadId>`。

## 5. API 契约

| API | 权限 | 关键行为 |
| --- | --- | --- |
| `POST /api/staff`、`PUT /api/staff/[id]` | 企业负责人、`admin`、`super_admin` | 设计师微信资料必填；测量员绑定同企业启用设计师；换绑保留历史线索归属。 |
| `POST /api/staff/wechat-qr` | 员工管理权限 | `multipart/form-data` 上传图片，写入 `media_assets`，返回资产 ID 和短期图片地址。 |
| `POST /api/leads` | 小程序测量员或既有线索创建权限 | 自动写入测量员、绑定设计师和 `new`，保留手机号去重。 |
| `POST /api/leads/[id]/acquire` | 负责该线索的设计师 | 原子确认 `new -> acquired`，创建唯一待结算提成并通知测量员。 |
| `GET /api/acquisition-commissions` | 测量员仅自己；企业负责人/平台管理员按企业 | 支持企业、测量员、状态筛选和汇总。 |
| `POST /api/acquisition-commissions/[id]/settle` | 企业负责人、`admin`、`super_admin` | 仅允许 `pending_settlement -> paid`。 |
| `GET /api/miniprogram/notifications` | 已认证小程序员工 | 查询自己的站内通知和未读数量。 |
| `POST /api/miniprogram/notifications/read` | 已认证小程序员工 | 仅能把自己的通知标记为已读。 |
| `PATCH /api/admin/enterprises/[id]` | 企业配置权限 | 修改之后确认生效的固定获客提成金额。 |

所有租户 API 必须继续使用共享 tenant helpers、RLS transaction 和当前员工上下文，禁止手写跨企业查询。

## 6. 客户端入口

### Admin

- `/staff`：设计师微信号/二维码、测量员绑定设计师、企业固定获客提成配置。
- `/acquisition-commissions`：按状态和测量员查看获客提成，人工确认发放。
- `/leads`：后台线索列表、五步规范状态和 `closed` 终止筛选。

### Mini Program

- `pages/leads-management/leads-management`：规范状态筛选、绑定设计师微信资料，以及设计师确认获客。
- `packages/business/lead-detail`：规范状态时间线、下一步提示和设计师确认操作。
- `packages/business/commission-records`：测量员查看获客提成汇总、明细和结算状态。
- `pages/mine`：未读通知入口和提醒。

测量员才显示设计师二维码与获客提成入口；设计师不显示测量员获客提成入口。小程序页面须保留微信原生胶囊安全区，并遵守项目规定的最小字号。

## 7. 事务、幂等与安全边界

1. 线索创建事务提交后再发送通知；微信发送失败只能更新通知失败状态，不能回滚已提交线索。
2. 设计师确认使用条件更新和唯一索引，防止双击、重试和并发请求生成重复提成。
3. 设计师只能确认自己负责的线索；测量员只能读取自己录入的线索、绑定设计师资料和自己的提成。
4. 二维码访问必须校验企业归属并生成签名 URL，不能暴露原始存储密钥或不受限公共 URL。
5. 删除/停用设计师前必须检查绑定关系；历史线索和已生成提成不能因为换绑被改写。

## 8. 后续细化清单

- 明确 `voided` 作废入口、原因字段、审计日志和是否允许已发放记录冲正。
- 确认企业配置的金额精度、负数/上限校验和批量导入方式。
- 完善微信订阅消息模板、授权失效重试和管理员可见的发送失败监控。
- 明确测量员更换企业、员工停用、设计师离职时的迁移与结算策略。
- 补充绑定变更审计记录，支持按时间查询“谁在何时把谁绑定给谁”。
- 为手机号去重、并发确认、跨租户访问和通知去重补齐 PostgreSQL 集成测试。

## 9. 相关实现位置

- Migration：`admin/drizzle/0016_measurer_designer_acquisition.sql`
- Schema：`admin/src/db/schema.ts`
- 员工 API：`admin/src/app/api/staff/`、`admin/src/app/api/staff/wechat-qr/`
- 线索 API：`admin/src/app/api/leads/`、`admin/src/app/api/leads/[id]/acquire/`
- 提成 API：`admin/src/app/api/acquisition-commissions/`
- 通知 API：`admin/src/app/api/miniprogram/notifications/`
- Admin 页面：`admin/src/app/(admin)/(merchant)/staff/`、`admin/src/app/(admin)/(merchant)/acquisition-commissions/`
- Mini Program 页面：`miniprogram/pages/leads-management/`、`miniprogram/pages/mine/`、`miniprogram/packages/business/commission-records/`
