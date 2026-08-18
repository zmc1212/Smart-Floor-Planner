# 测量员—设计师获客协作与提成闭环

本文档是测量员、设计师、线索、通知和获客提成之间的专项业务与数据契约。后续继续细化本功能时，以当前代码、数据库 schema、迁移和本文档共同作为工作入口；如果实现与本文档冲突，应先更新契约并说明兼容策略。

## 未来替换计划

新的推荐人网络与预约量房闭环已经完成设计选定、Schema/身份、双码推荐人网络、客户授权自动派单、匿名推广码/客户领取、推荐人工作台与预约阶段；第 6 阶段已实现客户项目聚合、AI 发布/撤回和客户只读后端，但正式户型/发布方案界面及后续流程仍在开发中，也未替换本文件描述的生产旧获客流程。后续破坏式开发以
[推荐人网络与预约量房闭环开发计划](./referrer-network-appointment-development-plan.zh-CN.md)
为入口；完整替换完成前，本文件继续描述当前已实现的旧获客流程，不能作为后续新流程阶段的实现证明。

## 1. 目标与范围

本闭环解决以下业务问题：

1. 企业管理员为每个测量员绑定一个设计师。
2. 设计师账户维护微信号和个人微信二维码。
3. 测量员在小程序录入客户线索后，系统自动把线索归属到绑定设计师。
4. 设计师确认已经通过微信加到客户后，只写入独立获客确认事实，不改变线索业务状态。
5. 确认成功后，按企业当前固定金额为测量员生成一条待结算获客提成。
6. 设计师和测量员通过站内通知获得状态变化提醒；微信订阅消息作为增强通道，不作为事务成功条件。

本功能不改变现有订单提成的结算语义，也不替代后续量房、设计和成交流程。获客确认与线索业务状态相互独立，量房、设计和签约均不以微信交接确认为前置条件。

## 2. 当前状态

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 测量员绑定设计师 | `Implemented` | 一个测量员只能有一条当前绑定；一个设计师可以绑定多个测量员。 |
| 设计师微信资料 | `Implemented` | `wechat_id` 和个人二维码均由设计师角色必填；二维码通过 `media_assets` 保存。 |
| 测量员创建线索 | `Implemented` | 服务端忽略客户端传入的负责人和状态，按绑定关系写入测量员、设计师和 `new`。 |
| 设计师确认获客 | `Implemented` | 仅负责设计师可在开放业务阶段确认；条件更新只写 `acquired_at/acquired_by`，不改变主状态。 |
| 角色化获客协作工作台 | `Implemented` | 设计师处理待确认交接；测量员通过一个页面级设计师名片入口查看当前绑定，并在任务卡查看等待状态、确认回执和提成摘要。 |
| 获客提成 | `Implemented` | 独立于订单提成，确认时快照企业固定金额，初始状态为 `pending_settlement`。 |
| 站内/微信通知 | `Implemented` | 先可靠写入站内通知；线索交接使用 `lead_assignment`，获客提成提醒使用 `workflow_todo`，微信 `sent`/`failed`/`skipped` 结果均不回滚线索或提成。 |
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
- `PUT /api/leads/[id]` 拒绝写入 `assignedTo`；线索创建时的设计师归属只读，员工管理中的换绑只影响后续新线索。
- 新建线索状态固定为 `new`。
- 保留现有手机号去重逻辑：命中已有线索时返回已有数据，不重复发通知，也不重复生成提成。
- 没有绑定设计师时，测量员不能创建新线索，接口必须返回明确的绑定缺失错误。

产品展示统一使用一条主流程状态：`new`（新线索）→
`measuring`（量房中）→ `designing`（方案设计）→ `converted`（已签约）。
`closed`（已关闭）是主流程之外的终止状态。历史值 `contacted`、`measured`、
`assigned`、`quoting` 继续可读，并在 API 筛选和客户端文案中归并到新线索或方案设计；
新写入和户型驱动的状态流转使用上述规范值。

关联草稿户型时，`new` 线索进入 `measuring`；关联已完成正式户型时，
未关闭的 `new` 或 `measuring` 线索进入 `designing`。状态推进后仍保留
`acquired_at` 和 `acquired_by` 作为获客审计记录。

### 3.3 设计师确认

- `POST /api/leads/[id]/acquire` 仅允许 `designer` 调用。
- 设计师只能确认 `assigned_to` 等于自己的线索。
- `new`、`measuring`、`designing`、`converted` 及其兼容历史值均可确认一次；未确认的 `closed` 拒绝普通设计师补录。
- 条件更新只写入 `acquired_at`、`acquired_by` 和 `updated_at`，不修改 `status`。
- 线索更新与唯一获客提成创建必须在同一事务中完成；并发请求只能成功一次。

### 3.4 获客提成

- 企业配置字段：`enterprises.measurer_acquisition_fixed_commission`，默认 `0.00`。
- 仅企业负责人可通过获客提成规则接口读取和修改该配置；它属于企业经营规则，不属于员工资料。
- 提成金额在设计师确认时快照，之后修改企业配置不影响历史记录。
- 每条线索最多一条获客提成，由 `lead_id` 唯一约束保证幂等。
- 状态：`pending_settlement`（待结算）、`paid`（已发放）、`voided`（作废）。当前业务只允许 `pending_settlement -> paid`，作废需后续明确业务入口和审计要求。
- `paid` 必须记录 `settled_at` 和 `settled_by`。

### 3.5 客户签约标记

- 签约是线索业务生命周期事实，与微信获客确认和获客提成相互独立；标记或撤销签约都不创建订单、不扣款，也不生成、结算或冲销获客提成。
- 同企业 `enterprise_admin` 可标记任意在用、未关闭线索；`designer` 只能标记 `assigned_to` 等于自己的线索。测量员和普通员工无此权限。
- `new`、`measuring`、`designing` 及兼容历史状态均可标记为 `converted`。从早期阶段直接签约仅在确认界面提示跳过中间阶段，不阻断操作；`closed` 必须先重新打开，已归档线索必须先恢复。
- 签约日期必填，按中国时区校验且不能晚于当天；合同金额和签约备注可选。金额仅是线索快照，不是订单或财务台账。
- 旧获客线索的转换事务写入 `converted_on`、`converted_at`、`converted_by`、`converted_from_status`、`contract_amount` 和 `conversion_note`，并创建 `converted` 生命周期事件。具有推荐成员、预分配测量员和设计师三方受益人的推荐网络线索还会在同一事务中按新三方规则生成提成快照；该新合同以 `referrer-network-appointment-development-plan.zh-CN.md` 为准。
- 只有同企业 `enterprise_admin` 可以撤销签约，且必须填写原因；撤销恢复签约前状态、清空当前签约摘要，并创建 `conversion_reverted` 生命周期事件保留审计原因。
- 通用 `POST /api/leads` 不允许直接创建 `converted`，`PUT /api/leads/[id]` 和户型导入/关联也不能进入或离开 `converted`；仓库层在持有行锁后再次校验，避免并发普通更新覆盖签约事实。客户端必须使用专用签约/撤销接口，避免绕过权限、输入校验和审计。
- 专用动作必须存在企业上下文；无论详情还是创建/去重响应，普通微信客户都只能读取签约状态和日期，不返回内部签约金额、备注、操作人或精确操作时间。

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
- `status`：规范当前状态为 `new`、`measuring`、`designing`、
  `converted`、`closed`；历史状态仍可读取，并在 API 筛选和客户端标签中归一化。
- `converted_on`、`converted_at`、`converted_by`、`converted_from_status`、`contract_amount`、`conversion_note`：当前签约日期、操作审计、撤销恢复点和可选合同摘要；金额不进入订单、扣款或提成账本。
- `acquired_at`、`acquired_by`：设计师确认时间和确认人。
- API DTO 从 `acquired_at` 派生 `acquisitionStatus`，并返回独立的 `acquisitionCommissionStatus`；不新增持久化获客状态列。
- `archived_at`、`archived_by`、`archive_reason`、`archive_note` 是独立的可见性生命周期。归档线索保留户型、正式量房、AI 工作流/生成、获客事实、提成、通知和跟进记录，可恢复且不改变负责人或结算事实；归档线索从获客任务隐藏，所有新增写入统一返回 `409 LEAD_ARCHIVED`。

### `lead_acquisition_commissions`

- `lead_id` 唯一。
- `enterprise_id`、`measurer_id`、`designer_id`：确认时的归属快照。
- `commission_amount`：企业固定金额快照，金额类型为 `numeric(14,2)`。
- `status`、`generated_at`、`settled_at`、`settled_by`：结算状态和审计字段。

### `staff_notifications`

- 接收员工、企业、线索、通知类型、站内状态、微信发送状态、错误信息、去重键和跳转参数均需落库。
- 发送顺序固定为“先写站内、再尝试微信、最后记录结果”。缺少 OpenID、模板或授权，以及网络失败、微信错误码，分别记录为 `skipped` 或 `failed`，业务接口仍返回成功。
- 新线索交给设计师使用 V2 `lead_assignment` 模板；通知测量员获客提成待结算使用 `workflow_todo`；企业负责人收到真正的新线索时使用 `new_lead`。手机号命中既有线索时两个通道均不得重复创建。
- 去重键按 `(dedupe_key, channel)` 建立部分唯一索引；通知写入的冲突目标使用同一
  `dedupe_key IS NOT NULL` 条件，确保 PostgreSQL 能应用该去重规则，防止重复手机号、重复确认或重试造成重复通知。
- 线索通知跳转参数必须包含线索 ID，目标路径为：
  `/packages/business/acquisition-center/acquisition-center?leadId=<leadId>`。

## 5. API 契约

| API | 权限 | 关键行为 |
| --- | --- | --- |
| `POST /api/staff`、`PUT /api/staff/[id]` | 企业负责人、`admin`、`super_admin` | 设计师微信资料必填；测量员绑定同企业启用设计师；换绑保留历史线索归属。 |
| `POST /api/staff/wechat-qr` | 员工管理权限 | `multipart/form-data` 上传图片，使用当前启用的默认媒体存储 Provider 写入 `media_assets`，返回资产 ID 和短期图片地址；历史资源仍按自身记录的 Provider 读取。 |
| `POST /api/leads` | 小程序测量员或既有线索创建权限 | 自动写入测量员、绑定设计师和 `new`，保留手机号去重。 |
| `POST /api/leads/[id]/acquire` | 负责该线索的设计师 | 原子写入获客确认事实，保持业务状态不变，创建唯一待结算提成并通知测量员。 |
| `POST /api/leads/[id]/convert` | 本企业负责人或负责该线索的设计师 | 把在用开放线索原子标记为 `converted`，校验非未来签约日期，并写入可选金额/备注和生命周期审计。 |
| `POST /api/leads/[id]/revert-conversion` | 本企业负责人 | 必填撤销原因，恢复签约前状态并写入撤销审计；不改变订单、扣款或获客提成。 |
| `GET /api/leads?archiveState=archived` | `leads.archive_manage` | 读取归档区；普通列表默认只返回在用线索。 |
| `POST /api/leads/archive-preview`、`POST /api/leads/archive` | `leads.archive_manage` + 行级访问 | 预检并归档最多 100 条线索，保留全部业务资产；运行中的 AI 任务只阻止受影响条目。 |
| `POST /api/leads/[id]/restore` | `leads.archive_manage` + 行级访问 | 恢复可见性、原业务状态和关联关系。 |
| `GET /api/leads/[id]/purge-preview`、`DELETE /api/leads/[id]` | 仅企业/平台管理角色 | 预检并在名称完全匹配后永久删除已归档空线索；存在受保护关系返回 `409`，不提供强制级联删除。 |
| `GET /api/acquisition-tasks` | 当前小程序设计师或测量员 | 按角色隔离返回待确认/已完成任务、分页、时间筛选及真实摘要；测量员响应额外在页面级返回一次当前绑定 `designerProfile`，任务条目不重复返回微信号或二维码。 |
| `GET /api/acquisition-commissions` | 测量员仅自己；企业负责人/平台管理员按企业 | 支持企业、测量员、状态筛选和汇总。 |
| `POST /api/acquisition-commissions/[id]/settle` | 企业负责人、`admin`、`super_admin` | 仅允许 `pending_settlement -> paid`。 |
| `GET/PATCH /api/acquisition-commissions/settings` | 本企业企业负责人 | 读取或修改之后获客确认生效的固定提成金额。 |
| `GET /api/miniprogram/notifications` | 已认证小程序员工 | 查询自己的站内通知和未读数量。 |
| `POST /api/miniprogram/notifications/read` | 已认证小程序员工 | 仅能把自己的通知标记为已读。 |

所有租户 API 必须继续使用共享 tenant helpers、RLS transaction 和当前员工上下文，禁止手写跨企业查询。

## 6. 客户端入口

### Admin

- `/staff`：设计师微信号/二维码、测量员绑定设计师，不再承载获客提成配置。
- `/acquisition-commissions`：按状态和测量员查看获客提成、人工确认发放；`/acquisition-commissions/settings` 是仅企业负责人可见的企业固定提成规则页。
- `/leads`：后台线索列表、四步业务状态、独立获客确认筛选和 `closed` 终止筛选；详情抽屉按服务端权限提供单条签约及负责人撤销，不提供批量签约。

### Mini Program

- `pages/leads-management/leads-management`：四步业务状态筛选；仅测量员在胶囊安全内容通道看到轻量“我的设计师”入口。
- `packages/business/acquisition-center/acquisition-center`：设计师确认微信交接；测量员在汇总后通过唯一“我的设计师 / 查看微信”入口查看当前绑定，任务卡只显示等待、回执和提成摘要。任务列表支持原生 `scroll-view` 手动下拉刷新；仅在页面可见时每 30 秒刷新当前状态，隐藏或卸载时清理定时器，并复用在途请求保护。
- `packages/business/lead-detail`：四步业务状态时间线下方提供独立的签约进度区和安全区底部确认层；按服务端权限允许负责人/负责设计师标记签约及负责人撤销，仍不重复实现获客确认动作。
- `components/designer-contact-sheet/designer-contact-sheet`：线索页、详情和协作工作台复用的只读设计师名片底部抽屉。它通过 `wx.request` 获取受保护二维码的图片字节，写入小程序本地临时文件后再交给 `<image>` 渲染；保留既有签名和企业范围校验，同时避开远程图片下载域名/缓存通道。加载失败后，重试会卸载失败图片并显示有时限的刷新状态，先刷新按角色裁剪的父级设计师资料；每次请求还会在签名负载之外附加仅客户端使用的缓存标识。
- `packages/business/commission-records`：测量员查看获客提成汇总、明细和结算状态。
- `pages/mine`：未读通知入口和提醒。

测量员才显示设计师二维码与获客提成入口；设计师不显示测量员获客提成入口。小程序页面须保留微信原生胶囊安全区，并遵守项目规定的最小字号。

## 7. 事务、幂等与安全边界

1. 线索创建事务提交后再按“站内落库 → 尝试微信 → 记录 `sent`/`failed`/`skipped`”发送通知；微信失败不能回滚已提交线索或提成。
2. 设计师确认使用 `assigned_to + acquired_at IS NULL + 可确认业务状态` 条件更新和唯一索引，防止双击、重试和并发请求生成重复提成。
3. 设计师只能确认自己负责的线索；测量员只能读取自己录入的线索、页面级当前绑定设计师资料和自己的提成。任务条目仍保留历史负责人身份事实，但不得逐条重复暴露微信号或二维码。
4. 二维码访问必须校验企业归属并生成签名 URL，不能暴露原始存储密钥或不受限公共 URL。
5. 删除/停用设计师前必须检查绑定关系；历史线索和已生成提成不能因为换绑被改写。
6. 归档和删除事务锁定线索并在提交前重查关联数据；存在任意当前或历史签约事实的线索不能按“空白线索”永久删除。生命周期事件记录操作者、时间、线索 ID、动作、原因和影响统计，不包含客户 PII，永久删除后仍保留。手机号录入命中归档档案时返回 `409 ARCHIVED_LEAD_EXISTS`，不会创建替代线索或重复提成。

## 8. 后续细化清单

- 明确 `voided` 作废入口、原因字段、审计日志和是否允许已发放记录冲正。
- 确认企业配置的金额精度、负数/上限校验和批量导入方式。
- 补充订阅次数耗尽、授权失效和重新授权的运营指引与监控。
- 明确测量员更换企业、员工停用、设计师离职时的迁移与结算策略。
- 补充绑定变更审计记录，支持按时间查询“谁在何时把谁绑定给谁”。
- 为手机号去重、并发确认、跨租户访问和通知去重补齐 PostgreSQL 集成测试。

## 9. 相关实现位置

- Migration：`admin/drizzle/0016_measurer_designer_acquisition.sql`、`admin/drizzle/0017_acquisition_workbench.sql`、`admin/drizzle/0019_lead_archive_lifecycle.sql`、`admin/drizzle/0020_lead_lifecycle_actor_indexes.sql`、`admin/drizzle/0023_lead_conversion.sql`
- Schema：`admin/src/db/schema.ts`
- 员工 API：`admin/src/app/api/staff/`、`admin/src/app/api/staff/wechat-qr/`
- 线索 API：`admin/src/app/api/leads/`、`admin/src/app/api/leads/[id]/acquire/`、`admin/src/app/api/leads/[id]/convert/`、`admin/src/app/api/leads/[id]/revert-conversion/`
- 获客任务/提成 API：`admin/src/app/api/acquisition-tasks/`、`admin/src/app/api/acquisition-commissions/`
- 通知 API：`admin/src/app/api/miniprogram/notifications/`
- Admin 页面：`admin/src/app/(admin)/(merchant)/staff/`、`admin/src/app/(admin)/(merchant)/acquisition-commissions/`
- Mini Program 页面：`miniprogram/pages/leads-management/`、`miniprogram/pages/mine/`、`miniprogram/packages/business/acquisition-center/`、`miniprogram/packages/business/lead-detail/`、`miniprogram/packages/business/commission-records/`
