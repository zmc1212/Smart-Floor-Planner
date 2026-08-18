# 推荐人网络与预约量房闭环开发计划

状态：`Approved design / Phase 7 completed`

本文是“推荐人多企业推广、客户授权建线索、自动派单、预约量房、AI 方案、签单和三方提成”破坏式改造的持续开发入口。当前代码、PostgreSQL schema、迁移和模块清单仍是已实现能力的依据；本文中的表、接口和路由在代码落地并通过测试前都只能标记为 `Planned`。

当前旧流程合同见 [measurer-designer-acquisition.zh-CN.md](./measurer-designer-acquisition.zh-CN.md)。本计划上线时将替换旧的“测量员录入客户、绑定设计师、确认获客和旧获客提成”，不做旧流程兼容或业务数据迁移。

English mirror: [referrer-network-appointment-development-plan.md](./referrer-network-appointment-development-plan.md)

## 1. 选定设计源

### 1.1 Canonical 设计文件

- 选定稿：`design-references/referrer-network-appointment-v1/selected-option-a.png`
- 画布：`1024x1536` PNG，设计基线为 iPhone 13 Pro `390x844`。
- SHA-256：`06f20a90207e1c9deea7f3552fd22d568c19f3b05ae8fd9024710e5289f3ae55`
- 组合规则：整体使用方案 A；中间“确认领取”屏使用方案 B 的信息结构。
- 生成方式：内置图像工具不可用后由 Sub2API `gpt-image-2` 编辑，再以确定性蒙版合成，确保只替换中间手机内部。

`design-references/` 由 Git 忽略，设计图只作为本机批准源，不得进入小程序包。若文件缺失或哈希不符，应先向产品负责人确认，不得自行换成近似设计。

第 5 阶段的推荐人内部工作台使用 `design-references/referrer-network-appointment-v1/phase-5-referrer-workbench-v1.png`：`1024x1536` PNG，以 `390x844` 为构图基线；它只适用于已认证推荐人选择企业和进入服务码，不适用于客户匿名链路。该参考由 Antigravity 内置图像引擎重新生成；工具未暴露可验证的具体 Google 图像模型名，因此文档不将其误标为 `Gemini 3 Pro Image`。

第 7 阶段后台三方提成工作台的批准设计源为 `design-references/referrer-network-appointment-v1/phase-7-three-role-commission-admin-v1.png`：`1487x1058` PNG，SHA-256 为 `DAA7ED1235C474F0C6A0D7FC625A5DD0BD9D97E54F580AB4CD530CE743AB2A1C`，由 Codex 内置生图能力生成并获准落地。它只适用于 `/lead-commissions` 的三角色规则卡、台账筛选、批量标记已支付和金额汇总；该图仅为桌面后台参考，不得切片或作为运行时 UI 素材，也不改变旧获客提成页面。

### 1.2 三屏业务映射

| 设计屏 | 使用者与时机 | 生产含义 |
| --- | --- | --- |
| 左屏“免费设计服务” | 推荐人向客户展示推广码 | 公共服务码；突出“免费上门测量、免费设计师服务”；二维码只编码不可猜测短令牌。 |
| 中屏“确认领取” | 客户扫码后、手机号授权前 | 展示上门测量与设计师服务、授权流程、隐私说明和“一键授权手机号”。 |
| 右屏“服务已领取” | 授权成功且线索、派单事务提交后 | 展示已分配设计师的姓名、微信号和个人二维码；提示服务档案已建立。 |

设计板底部“线索自动入库并完成设计师派单”是实施注释，不属于客户运行界面。

### 1.3 不可变 UI 与隐私规则

1. 推广码、扫码落地页、手机号授权页和授权成功页不得出现装修公司名称、企业 Logo、企业选择器、已加入企业数量或任何可推断接收企业的文字。
2. 推荐人在内部工作台选择推广企业；该企业关系只写入短令牌对应的服务端记录，不编码到二维码明文，也不展示给扫码客户。
3. 授权成功前只记录待确认推荐来源，不创建用户业务身份或线索。
4. 授权成功后原子创建/关联客户用户、锁定首次有效归属、创建线索并执行设计师与测量员派单。
5. 成功页只展示设计师个人微信资料，不展示其雇主。微信号和二维码使用真实员工资料；设计稿中的姓名、微信号和二维码都是占位数据。
6. 已登录客户进入项目页和预约卡片后，可以按业务需要查看服务装修公司、设计师、测量员、地址和预约时间；“匿名”边界只覆盖公共推广与授权领取链路。
7. 实现必须使用原生 WXML/WXSS、语义控件和项目图标资产，不得切割、铺贴或直接显示整张设计图。
8. 所有新路由在实现后才加入中英文设计还原台账；每个运行路由只保留一行最新设计源。

### 1.4 生成素材与生产路径映射

Antigravity 2.8.1 的内置 `generate_image` 能力按固定顺序读取选定稿、F1/F3 品牌参考和角色场景参考，生成 `design-references/referrer-network-appointment-v1/generated-assets-v1/referral-service-assets-board-v1.png`。该画板只作为设计参考；生产包只保留从六个独立素材格提取并优化后的透明 PNG，以及从推荐人工作台独立素材任务生成的服务码引导小 K PNG，不包含整页布局、控件或页面文字。

| 设计元素 | 生产路径 |
| --- | --- |
| 点赞小 K | `miniprogram/packages/business/assets/referral-service-v1/thumbs-up-xiao-k.png` |
| 上门量房服务 | `miniprogram/packages/business/assets/referral-service-v1/onsite-measurement.png` |
| 设计师服务 | `miniprogram/packages/business/assets/referral-service-v1/designer-service.png` |
| 手机号授权 | `miniprogram/packages/business/assets/referral-service-v1/phone-authorization.png` |
| 设计师匹配 | `miniprogram/packages/business/assets/referral-service-v1/designer-matching.png` |
| 隐私保护锁 | `miniprogram/packages/business/assets/referral-service-v1/privacy-lock.png` |
| 推广服务码引导小 K | `miniprogram/packages/business/assets/referrer-workbench-v1/service-code-guide.png` |

## 2. 目标业务闭环

```text
公司双码入驻
  -> 推荐人加入多个企业并选择企业生成专属推广码
  -> 客户扫码，服务端只保存待确认来源
  -> 客户授权手机号
  -> 原子建用户、归属锁、线索和审计
  -> 自动分配设计师并预分配测量员
  -> 设计师录入首次预约
  -> 客户在截止时间前从真实可用时段改期
  -> 测量员进入正式量房编辑器并提交 v4 户型
  -> 设计师生成并主动发布 AI 方案
  -> 设计师或企业负责人确认签单
  -> 快照三角色规则并生成三条应付提成
```

线索主状态继续使用：

```text
new -> measuring -> designing -> converted
closed 为终止状态
```

预约状态、方案发布状态、签单事实和提成状态均使用独立字段/表，不通过扩展线索主状态表达。

## 3. 当前基线与替换边界

当前运行时为 PostgreSQL 17、Drizzle Repository 和 RLS。以下旧能力已实现，但属于本计划的下线范围：

- `measurer_designer_bindings` 测量员—设计师单向绑定。
- 测量员创建线索和设计师 `POST /api/leads/[id]/acquire` 获客确认。
- `lead_acquisition_commissions` 旧固定获客提成。
- `packages/business/acquisition-center/acquisition-center` 旧获客协作工作台。
- 后台 `acquisition-commissions` 页面和对应设置、结算接口。

替换规则：

- 不保留旧写接口的兼容层。
- 不把旧绑定或旧提成转成新关系。
- 新 schema 可先与旧 schema 并存以支持开发和测试；正式切换在生产业务数据全清后完成。
- 删除旧代码、表和菜单前，必须先证明新闭环端到端可用，并同步中英文模块清单和专项合同。

## 4. 目标身份模型

### 4.1 身份结构

- 微信用户是基础身份；OpenID/UnionID 只存放在 `wechat_identities`，业务表通过 `user_id` 关联。
- 同一用户可以同时拥有客户身份、最多一个员工企业身份，以及多个推荐人企业成员关系。
- 员工只能加入一个企业；换企业必须由平台或企业管理员完成，不能通过再次扫码覆盖。
- 推荐人加入企业上限来自平台配置，默认 `3`；退出后可以加入新企业，历史线索和提成关系不变。
- 推荐人身份和员工身份相互独立；同一微信用户可以在不同模式间切换。

### 4.2 JWT 与上下文

小程序 JWT 至少包含：

- `sub`：基础用户 ID。
- `mode`：`customer | staff | referrer`。
- `enterpriseId`：当前企业上下文，可为空。
- `staffId`：当前员工身份，可为空。
- `referrerMembershipId`：当前推荐人成员关系，可为空。
- `contextVersion`：身份或成员关系变更后使旧 token 失效。

完整身份列表每次从数据库读取，不能只信任 JWT 中的历史关系。切换接口重新校验成员状态并签发新 token。

## 5. 目标数据模型

以下目标表已由阶段 1 写入 `admin/src/db/schema.ts` 和迁移 `0024_same_shockwave.sql`；后续阶段在现有约束和 Repository 命名约定上实现业务写入，不得另建平行数据模型。

| 实体/表 | 核心字段与约束 |
| --- | --- |
| `wechat_identities` | `user_id`、`openid`、可选 `unionid`；OpenID 唯一；业务表不得重复 OpenID。 |
| `enterprise_join_codes` | `enterprise_id`、`code_type=staff/referrer`、token hash、状态、版本、过期时间、创建/停用人；活动 token 唯一。 |
| `enterprise_join_code_events` | 换码、停用、扫码解析和入驻结果审计。 |
| `referrer_profiles` | 基础用户的一份推荐人资料。 |
| `referrer_enterprise_memberships` | `referrer_id`、`enterprise_id`、状态、加入/退出时间；活动关系唯一；历史不物理删除。 |
| `referrer_promotion_codes` | 成员关系、随机短令牌 hash、状态、版本；每个活动成员关系一份当前推广码。 |
| `promotion_scan_audits` | 扫码 token、微信会话、结果、IP/设备摘要和时间；不把 OpenID复制到线索。 |
| `customer_attribution_locks` | `customer_user_id`、活动线索、推荐人成员关系、企业、锁定/释放时间；部分唯一索引保证每个客户最多一个活动锁。 |
| `leads` 扩展 | `customer_user_id`、`referrer_membership_id`、`measurer_id`、`attribution_locked_at`、派单状态/错误；保留 `assigned_to` 作为设计师。 |
| `lead_assignment_events` | 设计师/测量员的自动分配、重试、换人和失败原因。 |
| `enterprise_appointment_settings` | 周工作时段、默认时长、步长、最长预约天数、客户改期截止小时数。 |
| `staff_unavailability_periods` | 测量员请假/不可用 `tstzrange`、原因、操作者。 |
| `measurement_appointments` | 线索、设计师、测量员、地址、`time_range`、状态、版本号和当前修改人。 |
| `measurement_appointment_events` | 创建、改期、换人、取消、完成；保存前后时间、前后测量员、操作者和原因。 |
| `enterprise_commission_rules` | 企业 + `role=referrer/designer/measurer` 唯一；`fixed/percentage`、值、状态和版本。 |
| `lead_commissions` | 线索 + 角色唯一；受益人、规则快照、合同金额、应付金额、`payable/paid/voided` 和财务审计。 |
| `ai_generation_publications` | 线索/项目、AI generation、发布/撤回人和时间；客户只读取活动发布记录。 |

所有企业业务表必须启用并强制 RLS，通过现有 tenant Repository helper 访问。所有 API DTO 必须显式序列化 `bigint`。

## 6. 双码与推荐人网络

阶段 2 已实现本节的服务端合同：企业管理员可查询、换新和停用员工/推荐人入驻码，换码与扫码结果写入审计；已授权手机号的小程序用户可入驻为单企业员工或加入默认最多 3 家企业的推荐人网络，并可查询、退出成员关系和重取当前推广令牌。令牌为基于服务端密钥的 192-bit 不透明值，数据库只保存 SHA-256 哈希，不编码企业明文。

阶段 2 的 `POST /api/miniprogram/codes/resolve` 负责区分入驻码/推广码、校验状态并写审计；阶段 3 已在有效推广码响应中增加 10 分钟的加密签名待确认来源。阶段 4 已将批准设计落为推广服务码展示页和客户领取页；解析本身仍不创建线索，只有客户授权接口提交该来源后才创建归属与线索。

### 6.1 企业双码

- 员工入驻码和推荐人入驻码使用不同 `code_type`，服务端拒绝跨类型调用。
- 二维码只携带至少 128 bit 熵的随机短令牌；数据库只保存 token hash。
- 换码创建新版本并在同一事务中停用旧版本；旧码随后解析为明确的 `code_rotated`。
- 员工扫码、授权手机号、选择 `designer` 或 `measurer` 后立即生效。
- 推荐人扫码授权后立即建立活动成员关系；达到平台上限返回 `membership_limit_reached`。
- 新设计师只有完成微信号与个人二维码后才进入自动派单池；测量员完成基本资料即可进入池。

### 6.2 推荐人推广码

- 每个活动推荐人成员关系对应一个独立推广码。
- 推荐人内部工作台允许查看已加入企业、退出企业、选择推广企业和展示对应推广码。
- 对客户展示的推广码页面遵循第 1.3 节匿名规则；企业选择器不得出现在客户可见投屏/分享画面中。
- 退出成员关系只停用后续扫码能力，不修改已锁定线索、历史预约或提成受益人。

## 7. 客户授权与首次有效归属

阶段 3 已实现本节服务端合同。`POST /api/miniprogram/referrals/authorize-and-create-lead` 可使用已授权手机号的 `customer` token，或直接提交微信 `loginCode + phoneCode`；直接授权路径在同一 PostgreSQL 事务中关联基础用户、锁定归属、创建线索、写入派单事实。接口要求 `Idempotency-Key`，相同客户与相同键返回原线索；活动归属由部分唯一索引和客户级事务锁共同保护。关闭线索通过 `LeadRepository.update` 在同一事务释放活动锁。

扫码分两阶段：

1. `resolve` 只验证推广 token，建立有短 TTL 的签名待确认来源；不得创建线索。
2. 客户点击微信手机号授权后，服务端在一个事务中完成用户关联、归属锁、线索、派单事实和审计。

并发与幂等要求：

- 以基础客户用户 ID 而不是手机号或 OpenID 作为归属锁主体。
- `customer_attribution_locks` 的活动部分唯一约束是最终并发防线。
- 同一客户存在未关闭线索时，其他推广码不得覆盖企业或推荐人；返回已有项目摘要，不泄露新扫码企业。
- 原线索进入 `closed` 后，在同一事务释放锁，之后才允许新归属。
- 授权接口接受客户端幂等键；相同键重试返回同一线索。
- 通知发送在事务提交后执行，失败不回滚线索。

## 8. 自动派单

阶段 3 已实现稳定服务端派单。企业级事务锁串行化候选负载计算；设计师按未关闭线索数、最后派单时间和员工 ID 排序，测量员按待量房线索数、未来预约占用时长、最后派单时间和员工 ID 排序。缺少任一角色时线索保留为 `assignment_pending` 并通知企业负责人；服务身份重试接口以及员工入驻、创建、资料补全或恢复派单会幂等重试。

### 8.1 设计师

候选集：同企业、活动、角色为设计师、微信号和个人二维码完整、未被管理员暂停派单。

排序键：

1. 未关闭线索数量升序。
2. `last_assigned_at NULLS FIRST`。
3. 员工 ID 升序。

### 8.2 测量员

线索创建时预分配测量员。候选集为同企业活动测量员，排序键：

1. 待量房任务数量升序。
2. 未来预约占用总时长升序。
3. `last_assigned_at NULLS FIRST`。
4. 员工 ID 升序。

首次预约或改期时，优先保留预分配测量员；若时间冲突，则在该时段可用人员中按相同稳定规则换人。

分配必须在事务内锁定候选统计或通过可重试的条件更新完成，避免并发请求长期偏向同一员工。无候选人时仍保留线索，写入 `assignment_pending` 和错误码，通知企业负责人。新员工入驻、资料补全或恢复派单后触发幂等重试。

## 9. 预约与客户改期

默认企业配置：每天 `09:00-18:00`、量房 `120` 分钟、步长 `30` 分钟、最长未来 `30` 天、客户最晚提前 `2` 小时改期。

数据库冲突边界：

- 使用 `tstzrange` 保存预约和不可用区间，统一以 UTC 持久化、企业时区展示。
- 启用 `btree_gist`，对活动预约建立测量员 + 时间范围排斥约束。
- `cancelled` 和 `completed` 是否参与约束必须由部分约束条件明确，不能只靠应用层查询。
- 更新使用 `version` 乐观锁；版本不匹配返回 `appointment_version_conflict`。

流程：

1. 设计师从服务端返回的真实可用时段中选择首次预约。
2. 预约事务确认测量员可用性；冲突时自动换人并记录事件。
3. 事务提交后生成客户预约卡片并尝试发送 `measurement_appointment` 微信模板。
4. 客户必须以线索绑定的本人账号打开卡片；转发用户只能看到无权限状态。
5. 截止时间前客户只能选择服务端再次计算的可用时段，提交立即生效。
6. 截止时间后仅设计师或企业负责人可填写原因后改期。
7. 客户没有自行取消入口；取消由设计师或负责人执行。
8. 所有创建、改期、换人、取消和完成动作写入事件表。

## 10. 量房、AI 方案和客户项目

- 唯一正式量房入口仍是 `packages/surveying/editor/surveying-editor`，携带 `leadId` 和/或 `floorPlanId`。
- 正式户型继续使用 v4 `surveyGraph` 合同，单位为毫米；本计划不得引入旧编辑器或旧 `layoutData`。
- 正式量房提交后，线索从 `new/measuring` 推进为 `designing`。
- AI 生成任务与“客户可见发布事实”分离；只有 `ai_generation_publications` 中活动发布的方案可见。
- 客户项目页统一展示设计师名片、最新预约、正式户型摘要和已发布方案。
- 公共匿名领取链路不展示装修公司；进入本人项目和预约后按业务合同展示服务企业。

阶段 6 已通过仅客户本人读取的项目聚合落地：`CustomerProjectRepository` 将企业、设计师名片、当前预约、完成的 v4 正式户型摘要和活动发布方案聚合为只读项目；读取强制以 `customer_user_id` 校验，不能以手机号或客户端企业上下文代替。负责设计师或企业负责人只能发布/撤回属于该线索且已成功的 AI generation；撤回保留生成记录，但立即从客户聚合和受保护图片端点隐藏。已批准的客户项目页展示服务进度、真实设计师/测量员及预约、完成的正式户型摘要和主动发布的方案卡；受保护方案图片以认证请求读取为小程序本地临时文件后才预览。正式户型卡保持摘要，因为客户 API 不暴露可编辑 graph，也不提供客户量房编辑入口。

## 11. 签单与三方提成

- 企业分别配置推荐人、设计师、测量员规则；每个角色选择固定金额或合同金额比例。
- 任一角色使用比例时，确认签单必须填写大于零的合同金额。
- 签单事务快照三条规则、合同金额和受益人，生成三条 `(lead_id, role)` 唯一的 `payable` 记录。
- 金额使用 decimal，不得经过 JavaScript 浮点计算；比例计算和舍入策略在 Repository 单测中固定。
- 企业线下支付后由负责人单条或批量标记 `paid`，记录操作者和时间；平台不接入支付。
- 撤销签单时，未支付记录改为 `voided` 并保留原因；存在任一 `paid` 记录时返回业务冲突，必须先完成线下财务更正。
- 报表按线索展示客户、推荐人、企业、设计师、测量员、预约、合同金额及三角色提成状态。

第 7 阶段已实现服务端签单和提成账本切片：`LeadCommissionRepository` 为推荐网络线索在签单事务中锁定三条企业规则与三方受益人，按固定金额或比例以整数十进制单位计算并快照三条唯一 `payable` 记录。比例规则要求签约金额；撤销签单前会锁定提成记录，任何已支付记录都会阻止撤销，其余待支付记录写为 `voided` 并保留原因。提成报表为每条记录附带客户、推荐人关系、企业、设计师、测量员和当前有效预约上下文；批准的 `/lead-commissions` 工作台允许企业/平台管理员维护三条规则、按状态/角色/创建日期范围筛选真实台账、查看关联上下文并确认线下批量标记已支付。它与旧获客提成页面保持独立。旧获客线索在第 8 阶段下线前不具备推荐人/预分配测量员三方受益人时，保留其现有签单行为。

## 12. 计划 API 族

最终路由名可在实现切片内按现有 App Router 约定微调，但语义和权限不得合并丢失。

| API 族 | 计划接口 |
| --- | --- |
| 身份 | `GET /api/miniprogram/identity-contexts`、`POST /api/miniprogram/identity-contexts/switch`；阶段 1 已实现。 |
| 扫码解析 | `POST /api/miniprogram/codes/resolve`；阶段 3 已实现令牌类型/状态解析、审计和有效推广码的 10 分钟加密签名待确认来源；解析不创建线索。 |
| 双码管理 | `GET /api/enterprise/join-codes`、`POST /api/enterprise/join-codes/[type]/rotate`、`POST /api/enterprise/join-codes/[type]/disable`；阶段 2 已实现。 |
| 入驻 | `POST /api/miniprogram/onboarding/staff`、`POST /api/miniprogram/onboarding/referrer`；阶段 2 已实现。 |
| 推荐人 | `GET /api/miniprogram/referrer-memberships`、`DELETE /api/miniprogram/referrer-memberships/[id]`、`GET /api/miniprogram/referrer-memberships/[id]/promotion-code`；阶段 2 已实现。 |
| 服务码图片 | `GET /api/miniprogram/referrer-memberships/[id]/promotion-code/image`；阶段 4 已实现，校验当前推荐人关系后在事务外调用微信小程序码接口，返回不缓存的 PNG。 |
| 客户建线索 | `POST /api/miniprogram/referrals/authorize-and-create-lead`；阶段 3 已实现客户上下文/微信手机号直接授权、幂等归属、原子建线索和派单。 |
| 派单 | `POST /api/internal/lead-assignments/[leadId]/retry`；阶段 3 已实现且仅接受至少 32 字符的 `INTERNAL_SECRET` 服务身份。 |
| 可用时段 | `GET /api/appointments/availability`；第 5 阶段已完成，按企业排班、时长/步长、活动预约与不可用时间返回候选测量员可用时段，以及企业时区、时长、步长和最远可预约天数边界。 |
| 预约 | `GET/POST /api/appointments`、`POST /api/appointments/[id]/customer-reschedule`、`POST /api/appointments/[id]/internal-reschedule`、`POST /api/appointments/[id]/cancel`、`POST /api/appointments/[id]/complete`；第 5 阶段已完成，已接通版本乐观锁、客户/设计师/测量员/企业负责人边界、自动换测量员、事件审计，以及创建、改期、取消后的事务后员工和已授权客户订阅消息尝试。客户读取和改期仅在请求线索或预约确属本人后推导企业范围，不接受 token 或请求声明的企业 ID。 |
| 日历与配置 | `GET/PUT /api/appointment-settings`、`GET/POST/DELETE /api/measurer-unavailability`；第 5 阶段已完成。 |
| 客户项目与方案发布 | `GET /api/miniprogram/customer-projects/[leadId]`、`GET /api/miniprogram/customer-projects/[leadId]/published-generations/[generationId]/image`、`POST /api/leads/[id]/ai-publications`、`DELETE /api/leads/[id]/ai-publications/[generationId]`；阶段 6 后端切片已实现。客户读取只允许本人项目，设计师仅能发布/撤回自己负责线索的已成功 generation，企业负责人可管理本企业线索；已撤回或已删除 generation 绝不出现在客户聚合或图片端点。 |
| 提成 | `GET/PUT /api/commission-rules`、`GET /api/lead-commissions?status=&role=&fromDate=&toDate=`、`POST /api/lead-commissions/mark-paid`；第 7 阶段服务端已实现。规则只允许企业管理员/平台管理角色按租户读取和以版本乐观锁更新；报表和付款 API 只返回或修改本企业记录。 |

所有企业接口使用现有 tenant route/context helper 和 RLS；内部重试接口必须使用服务身份，不能暴露给普通客户端。

## 13. 计划小程序与后台界面

阶段 4 已实现并写入设计还原台账的运行路由：

- `packages/business/promotion-service-code/promotion-service-code`：选定设计左屏，供推荐人展示给客户；服务码图片通过受保护接口生成。
- `packages/business/free-design-service/free-design-service`：选定设计中屏和右屏，承载扫码解析、手机号授权、幂等建线索和设计师微信结果。

第 5 阶段运行路由已按各自已批准的第 5 阶段设计源写入两份设计还原台账：

- `packages/business/referrer-workbench/referrer-workbench`：推荐人企业关系、内部企业选择和推广码入口。
- `packages/business/customer-project/customer-project`：已批准的第 6 阶段客户项目服务册展示真实预约、设计师/测量员、完成正式户型摘要和主动发布方案；受保护方案图片读取为小程序本地文件后再供客户预览。该页面刻意不提供客户量房编辑入口或可编辑户型查看器。
- `packages/business/appointment-reschedule/appointment-reschedule`：服务端计算客户可用时段与即时改期。
- `packages/business/appointment-booking/appointment-booking`：负责设计师从无有效预约的线索详情进入，填写上门地址、选择服务端实时计算的可用时段并创建首次预约。
- `packages/business/measurer-calendar/measurer-calendar`：已确认的测量员日程，提供不可用时间编辑入口。
- `packages/business/measurer-unavailability/measurer-unavailability`：测量员仅维护本人不可用时段；使用原生日期/时段 picker、原因、保存和删除，API 仍在服务端强制角色和本人边界。

第 7 阶段商户路由 `/lead-commissions` 已按批准后台设计源实现三条规则卡、状态/角色/日期台账筛选、真实关联报表列、带确认的批量标记已支付和金额汇总。它新增独立的 `lead-commissions` 导航与权限边界，不替换 `/acquisition-commissions`。其余后台工作仍需复用商户路由边界，并在可见实现前检查批准设计源。

## 14. 通知与可靠性

- 站内通知/任务日志是可靠事实；微信订阅消息是尽力而为增强。
- 业务事务提交后通过 outbox 或现有可重试通知日志发送。
- 预约创建、改期、换人、取消和失败重试都要有独立事件键，避免重复消息。
- `measurement_appointment` 只有在真实预约表和确认事件上线后启用；不得复用 `measureDueAt`。
- 微信发送的 `sent/failed/skipped` 结果不回滚用户、线索、预约或提成事务。

## 15. 正式库全清与对象存储清理

清理程序独立于普通 Drizzle migration，禁止部署时自动运行。必须具备：

- `dry-run`，输出每张表保留/删除数量和七牛对象候选清单。
- 数据库指纹校验：环境、数据库名、schema、迁移 head、管理员数量和平台配置摘要。
- 完整备份、恢复演练和恢复时间记录。
- 明确的生产确认参数，至少包含目标指纹和一次性确认 token。
- 删除顺序清单、事务/分批边界、失败恢复方式和最终审计 JSON/Markdown。
- 七牛先生成对象清单并人工确认；数据库提交后再异步删除对象，失败可重试。

保留：平台管理员、角色权限、套餐价格、通知平台配置、七牛配置、GRS/AI 供应商与模型、提示词和分类/映射、预览素材、AI 风格预设、迁移记录。

删除：企业、员工、普通用户、推荐关系、线索、户型、量房、预约、AI 业务任务与结果、签约、提成、业务通知/报备及企业媒体。提示词模板素材不得进入七牛删除清单。

执行正式清理必须另行获得用户明确批准；开发本文档不构成执行授权。

## 16. 分阶段实施顺序

每个阶段完成时更新本节状态、两份模块清单和受影响专项合同。不得一次性把所有阶段标记完成。

| 阶段 | 状态 | 交付物与退出条件 |
| --- | --- | --- |
| 0. 计划与设计锁定 | `Completed` | 选定设计文件和本计划中英文版；未修改生产运行界面。 |
| 1. Schema 与身份基础 | `Completed` | 目标表、`leads` 扩展、强制 RLS、Repository、数据库实时身份列表/切换、`contextVersion` 失效及普通客户手机号登录已实现；数据库合同测试通过。旧 OpenID 字段仅为第 8 阶段前的旧流程并存兼容。 |
| 2. 双码与推荐人网络 | `Completed` | 双码换码/停用审计、员工单企业、推荐人默认三家上限与退出、可重取的不透明推广令牌已实现；Repository 数据库合同测试通过。 |
| 3. 客户授权与自动派单 | `Completed` | 两阶段扫码、原子用户关联/建线索、首次有效归属、稳定最小负载派单、无候选保留、事务后通知、服务身份及员工池变化重试已实现；Repository/RLS/并发测试通过。 |
| 4. 选定设计生产实现 | `Completed` | `promotion-service-code` 与 `free-design-service` 两条路由按 `390x844` 实现三屏状态；服务码图片接口、扫码解析、手机号授权、幂等建线索、设计师二维码交付和无设计师待分配状态已接通。Antigravity 2.8.1 通过内置 `generate_image` 按固定 `3x2` prompt 和有序参考图生成画板，六个独立透明 PNG 已裁切、优化并接入 `packages/business/assets/referral-service-v1/`，均不超过 300KB。聚焦测试通过；真实微信开发者工具 automator 在 iPhone 12/13 Pro `390x844` 模拟器上完成精确路由、元素边界和包含原生胶囊的整窗截图核验。 |
| 5. 预约与日历 | `Completed` | 已实现租户预约设置、测量员不可用时间、工作时段校验、首次预约、客户/内部改期、取消/完成、事件审计、版本乐观锁和数据库排斥约束；推荐人可在内部工作台查询活动企业关系、选择企业、展示受保护服务码，并以确认流程退出关系（历史归属不变）。负责设计师在尚无有效预约时可从线索详情进入预约页，填写地址并从服务端实时可用时段创建首次预约。Repository/RLS/并发集成测试及客户预约、改期、测量员日程、本人不可用时间编辑器和推荐人工作台路由已实现；首次预约和客户改期在 iPhone 12/13 Pro `390x844` 自动化模拟器中核验通栏 CTA 的窗口计算宽度与左右边距。创建、改期、取消在事务后尝试向员工和已授权客户投递订阅消息；首次预约入口、推荐人工作台、客户预约卡、客户改期、首次预约、测量员日程与不可用时间编辑器均已在真实微信开发者工具 `390x844` 模拟器逐路由确认顶层路由和包含原生胶囊的整窗截图。 |
| 6. 客户项目、量房与 AI 发布 | `Completed` | 项目聚合 API、AI 发布/撤回事实、仅客户本人读取边界、完成正式户型摘要和受保护已发布方案预览均已实现。客户服务册不提供客户量房编辑入口或 graph 编辑路径。Repository/RLS 集成测试与小程序合同测试通过；真实微信开发者工具自动化已在 `390x844` 确认精确的 customer-project 顶层路由，并保存应用层截图及包含原生胶囊的宿主整窗截图。 |
| 7. 签单与三方提成 | `Completed` | 已实现三规则 Repository、签单原子快照、三条唯一提成、已付/作废约束、RLS 报表、批量付款 API 及批准的 `/lead-commissions` 规则/报表工作台。聚焦 PostgreSQL 提成测试、生产构建及认证 `localhost:3005` 对批准桌面工作台的视觉核验均已完成。 |
| 8. 旧流程下线 | `Not started` | 删除旧绑定、获客确认、旧工作台和旧获客提成；文档与权限清单一致。 |
| 9. 清理演练与生产发布 | `Not started` | dry-run、备份恢复演练、指纹确认、审计报告和独立批准。 |

## 17. 测试与验收矩阵

- 身份：普通客户可创建账号；角色切换不能伪造企业；旧 token 在关系变化后失效。
- 双码：类型隔离、换码立即失效、员工单企业、推荐人默认三家上限、退出不改历史。
- 匿名推广：四个公共/授权状态不包含装修公司名称、Logo、企业选择或明文 ID。
- 归属：扫码不建线索；授权才创建；重复与并发授权只产生一个活动锁和一条线索。
- 派单：最小负载、稳定 tie-break、无人员保留线索、新员工入驻自动重试、无手动接单。
- 预约：工作时间、步长、范围、请假、排斥约束、客户截止、内部原因、自动换人、版本冲突。
- 权限：转发卡片不能越权；客户只读本人项目；员工和推荐人不能跨企业；设计师微信二维码受保护。
- 通知：创建、改期、换人、取消、失败重试；微信失败不影响业务事务。
- 量房/AI：只有正式 v4 户型；只有主动发布的 AI 方案对客户可见。
- 签单：比例规则要求合同金额；一个事务生成三条记录；已支付提成阻止撤销。
- 清理：备份可恢复；业务表为空；平台配置与提示词素材完整；七牛删除清单与审计一致。

验证命令按实际改动范围执行：

```powershell
cd admin
npm test
npm run build

cd ..\miniprogram
npm test

cd ..
git diff --check
```

小程序视觉阶段必须复用当前已打开的微信开发者工具窗口，先重新编译，再核对页面栈和目标路由；不得打开同一项目的第二个窗口。

## 18. 持续开发交接规则

后续会话开始时按顺序执行：

1. 阅读根目录 `AGENTS.md`、本计划及受影响模块的嵌套指令。
2. 阅读中英文模块清单、当前旧流程合同和相应正式量房合同。
3. 检查第 16 节阶段状态，只选择第一个未完成阶段，不跨阶段假设依赖已存在。
4. 检查当前代码和迁移；计划不是实现证据。
5. 先补 Repository/RLS/并发测试，再接路由，最后接界面和通知。
6. 改变接口、权限或用户流程时同步更新中英文文档。
7. 实现新小程序路由后，把选定设计映射写入两份设计还原台账，并记录 `390x844` 与原生胶囊证据。
8. 每次交接写清本阶段已完成项、剩余项、验证命令和已知限制，不使用模糊的“基本完成”。

## 19. 已锁定默认业务口径

以下决定无需后续重复确认，除非产品负责人明确修改：

- 客户手机号必须主动授权，扫码不能自动获取。
- 个人微信不能自动添加，只展示微信号和个人二维码。
- 推荐人最多加入三家企业，平台可调整。
- 员工和推荐人扫码入驻立即生效，不走审核。
- 测量员先预分配，预约或改期冲突时自动换人。
- 客户只能选择服务端确认的真实可用时段，改期立即生效。
- 客户不能自行取消预约。
- 提成只形成企业线下发放台账，平台不参与支付。
- 正式生产业务数据全清不通过普通迁移执行，且必须获得单独明确批准。
