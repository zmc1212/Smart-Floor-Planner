# 推荐人网络与预约量房闭环开发计划

状态：`Phase 10 in progress / Phase 11 completed / Phase 16 implemented`

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

1. 推广码、扫码落地页、手机号授权页和授权成功页不得出现装修公司名称、企业 Logo、企业选择器、已加入企业数量或任何可推断接收企业的文字。该匿名边界覆盖**客户领取链路**，包括推荐人公共推广码和员工活动码扫码落地。员工活动码**出示页**仍可展示服务企业名称/品牌，方便员工确认这是哪家公司的码；成功页仍只交付设计师个人微信资料。
2. 推荐人在内部工作台选择推广企业；该企业关系只写入短令牌对应的服务端记录，不编码到二维码明文，也不展示给扫码客户。
3. 授权成功前只记录待确认推荐来源，不创建用户业务身份或线索。
4. 授权成功后原子创建/关联客户用户、锁定首次有效归属、创建线索并执行设计师与测量员派单。
5. 成功页只展示设计师个人微信资料，不展示其雇主。微信号和二维码使用真实员工资料；设计稿中的姓名、微信号和二维码都是占位数据。
6. 已登录客户进入项目页和预约卡片后，可以按业务需要查看服务装修公司、设计师、测量员、地址和预约时间；“匿名”边界只覆盖公共推广与授权领取链路。
7. 实现必须使用原生 WXML/Less、语义控件和项目图标资产，不得切割、铺贴或直接显示整张设计图。
8. 所有新路由在实现后才加入中英文设计还原台账；每个运行路由只保留一行最新设计源。

### 1.4 生成素材与生产路径映射

Antigravity 2.8.1 的内置 `generate_image` 能力按固定顺序读取选定稿、F1/F3 品牌参考和角色场景参考，生成 `design-references/referrer-network-appointment-v1/generated-assets-v1/referral-service-assets-board-v1.png`。该画板只作为设计参考；生产包只保留从六个独立素材格提取并优化后的透明 PNG，以及从推荐人工作台独立素材任务生成的服务码引导小 K PNG，不包含整页布局、控件或页面文字。

| 设计元素 | 生产路径 |
| --- | --- |
| 点赞小 K | `miniprogram/packages/business/assets/referral-service-v1/thumbs-up-xiao-k.png` |
| 已有服务小 K（设计 14 裁切） | `miniprogram/packages/business/assets/referral-service-v1/xiao-k-existing-service.png` |
| 入驻欢迎小 K（设计 16 裁切） | `miniprogram/packages/business/assets/referral-service-v1/xiao-k-onboarding-welcome.png` |
| 入驻恢复小 K（设计 17 裁切） | `miniprogram/packages/business/assets/referral-service-v1/xiao-k-onboarding-recovery.png` |
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
  -> 客户自行预约上门，或设计师微信沟通后代为预约（共用同一有效预约，互不冲突）
  -> 客户在截止时间前从真实可用时段改期
  -> 测量员进入正式量房编辑器并提交 v4 户型
  -> 设计师生成并主动发布 AI 方案
  -> 设计师或企业负责人确认签单
  -> 快照三角色规则并生成三条应付提成
```

并行的员工活动码获客轨共用同一线索主状态、正式量房、AI 发布和签单，而不是另起线索类型：

```text
设计师或测量员出示个人活动码
  -> 客户扫码授权
  -> 归属锁 + 线索 source=staff_activity（推荐人可空）
  -> 出示人锁定为 measurerId；设计师出示则兼任 assignedTo，测量员出示则自动派设计师
  -> 立刻进入正式量房，或由出示人创建首次预约
  -> 与推荐人轨合流：量房提交后 designing -> 发布方案 -> 签单
  -> 只快照设计师 + 测量员两条应付；同一人兼任则两行同一受益人
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
| `staff_activity_codes` | 阶段 16：员工 + 企业、token hash、状态、版本；每个活动设计师/测量员一份当前活动码。 |
| `promotion_scan_audits` | 扫码 token、微信会话、结果、IP/设备摘要和时间；不把 OpenID复制到线索。可关联推广码或活动码。 |
| `customer_attribution_locks` | `customer_user_id`、活动线索、推荐人成员关系、企业、锁定/释放时间；部分唯一索引保证每个客户最多一个活动锁。 |
| `leads` 扩展 | `customer_user_id`、`referrer_membership_id`（活动线索可空）、`measurer_id`、`source=referrer_network\|staff_activity\|manual_entry`、`attribution_locked_at`、派单状态/错误；保留 `assigned_to` 作为设计师。 |
| `lead_assignment_events` | 设计师/测量员的自动分配、重试、换人和失败原因。 |
| `enterprise_appointment_settings` | 周工作时段、默认时长、步长、最长预约天数、客户改期截止小时数。 |
| `staff_unavailability_periods` | 测量员请假/不可用 `tstzrange`、原因、操作者。 |
| `measurement_appointments` | 线索、设计师、测量员、地址、`time_range`、状态、版本号和当前修改人。 |
| `measurement_appointment_events` | 创建、改期、换人、取消、完成；保存前后时间、前后测量员、操作者和原因。 |
| `enterprise_commission_rules` | 企业 + `role=referrer/designer/measurer` 唯一；`fixed/percentage`、值、状态和版本。 |
| `lead_commissions` | 线索 + 角色唯一；受益人、规则快照、合同金额、应付金额、不可变的原始应付/受益人快照、最近一次调整审计（`adjusted_at`/`adjusted_by`/`adjust_reason`）、`payable/paid/voided` 和财务审计。 |
| `ai_generation_publications` | 线索/项目、AI generation、发布/撤回人和时间；客户只读取活动发布记录。 |

所有企业业务表必须启用并强制 RLS，通过现有 tenant Repository helper 访问。所有 API DTO 必须显式序列化 `bigint`。

## 6. 双码与推荐人网络

阶段 2 已实现本节的服务端合同：企业管理员可查询、换新、停用并生成员工/推荐人入驻码的私有微信小程序码 PNG，换码、扫码解析和码图片生成结果写入审计；已授权手机号的小程序用户可扫码进入专用入驻页，入驻为单企业员工或加入默认最多 3 家企业的推荐人网络，并可查询、退出成员关系和重取当前推广令牌。令牌为基于服务端密钥的 192-bit 不透明值，数据库只保存 SHA-256 哈希，不编码企业明文。

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

首次预约或改期时，优先保留预分配测量员；若时间冲突，则在该时段可用人员中按相同稳定规则换人。**`source=staff_activity` 例外：禁止因时段冲突自动换测量员。** 出示活动码的人必须保持 `measurerId`；冲突时返回时段不可用，由出示人另选时间。企业负责人或设计师带原因的内部换人仍保留。

分配必须在事务内锁定候选统计或通过可重试的条件更新完成，避免并发请求长期偏向同一员工。无候选人时仍保留线索，写入 `assignment_pending` 和错误码，通知企业负责人。新员工入驻、资料补全或恢复派单后触发幂等重试。活动线索重试不得改写已锁定的出示人 `measurerId`。

## 9. 预约与客户改期

默认企业配置：每天 `09:00-18:00`、量房 `120` 分钟、步长 `30` 分钟、最长未来 `30` 天、客户最晚提前 `2` 小时改期。

数据库冲突边界：

- 使用 `tstzrange` 保存预约和不可用区间，统一以 UTC 持久化、企业时区展示。
- 启用 `btree_gist`，对活动预约建立测量员 + 时间范围排斥约束。
- `cancelled` 和 `completed` 是否参与约束必须由部分约束条件明确，不能只靠应用层查询。
- 更新使用 `version` 乐观锁；版本不匹配返回 `appointment_version_conflict`。

流程：

1. 客户本人或负责设计师从服务端返回的真实可用时段中选择首次预约；先提交成功的一方占用有效预约，另一方收到已有预约。
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
- 客户项目页统一展示设计师名片、最新预约、正式户型摘要和已发布命名方案图集。
- 公共匿名领取链路不展示装修公司；进入本人项目和预约后按业务合同展示服务企业。

阶段 6 已通过仅客户本人读取的项目聚合落地：`CustomerProjectRepository` 将企业、设计师名片、当前预约、完成的 v4 正式户型摘要和活动发布方案聚合为只读项目，并分组为 `publishedSchemes`。读取强制以 `customer_user_id` 校验，不能以手机号或客户端企业上下文代替。后台工作台执行合并发布（`POST /api/leads/[id]/ai-scheme-publications`）：同一 `workflowId` 内选中图片会增量合并/更新进现有活跃发布记录，因此客户在同一方案内看到增量更新；未勾选但已确认的图片保持可见，除非被单张撤回或删轮次/删方案显式下架。小程序设计师仍可按单张成功 generation 发布。撤回保留生成记录，但立即从客户聚合和受保护图片端点隐藏。已批准的客户项目页展示服务进度、真实设计师/测量员及预约、完成的正式户型摘要，以及按方案名嵌套的效果图网格（预览队列不出该方案）。无 workflow 的小程序单图归入「其他效果图」。受保护方案图片以认证请求读取为小程序本地临时文件后才预览。正式户型卡保持摘要，因为客户 API 不暴露可编辑 graph，也不提供客户量房编辑入口。

## 11. 签单与三方提成

- 企业分别配置推荐人、设计师、测量员规则；每个角色选择固定金额或合同金额比例。
- 任一角色使用比例时，确认签单必须填写大于零的合同金额。
- 签单事务按线索 `source` 快照应付行：`referrer_network` 仍是推荐人、设计师、测量员三条 `(lead_id, role)` 唯一 `payable` 记录；`staff_activity` 与 `manual_entry` 只快照设计师和测量员两条，不要求推荐人规则启用，也不要求测量员员工的身份角色为 `measurer`。同一 `beneficiaryUserId` 可以同时出现在设计师行和测量员行。`manual_entry` 走推荐网络人员池（预约冲突可换测量员），不绑定 `customer_user_id`。
- 金额使用 decimal，不得经过 JavaScript 浮点计算；比例计算和舍入策略在 Repository 单测中固定。
- 企业线下支付后由负责人单条或批量标记 `paid`，记录操作者和时间；平台不接入支付。
- 记录仍为 `payable` 时，企业/平台管理员可调整当前 `payableAmount` 和/或 `beneficiaryUserId`（原因选填）；不可变的原始快照列与规则快照字段保持不变。`paid`/`voided` 拒绝调整。
- 撤销签单时，未支付记录改为 `voided` 并保留原因；存在任一 `paid` 记录时返回业务冲突，必须先完成线下财务更正。
- 报表按线索展示客户、推荐人、企业、设计师、测量员、预约、合同金额及三角色提成状态。
- 小程序推荐人收益（`listEarnings`）跟随当前 `beneficiaryUserId` 与 `payableAmount`；更换受益人后旧用户看不到该行，新的合格推荐人可以看到。

第 7 阶段已实现服务端签单和提成账本切片：`LeadCommissionRepository` 为推荐网络线索在签单事务中锁定三条企业规则与三方受益人，按固定金额或比例以整数十进制单位计算并快照三条唯一 `payable` 记录（同时写入匹配的原始应付/受益人）。比例规则要求签约金额；待支付行后续可调整金额和/或本企业合格受益人并写入最近一次调整审计，`markPaid` 仍只接受 `payable` 并按当前金额记账。撤销签单前会锁定提成记录，任何已支付记录都会阻止撤销，其余待支付记录写为 `voided` 并保留原因。提成报表为每条记录附带客户、推荐人关系、企业、设计师、测量员、当前有效预约上下文以及原始/调整审计字段；批准的 `/lead-commissions` 工作台允许企业/平台管理员维护三条规则、按状态/角色/创建日期范围筛选真实台账、查看关联上下文、调整待支付行并确认线下批量标记已支付。它与旧获客提成页面保持独立。旧获客线索在第 8 阶段下线前不具备推荐人/预分配测量员三方受益人时，保留其现有签单行为。

## 12. 计划 API 族

最终路由名可在实现切片内按现有 App Router 约定微调，但语义和权限不得合并丢失。

| API 族 | 计划接口 |
| --- | --- |
| 身份 | `GET /api/miniprogram/identity-contexts`、`POST /api/miniprogram/identity-contexts/switch`；阶段 1 已实现。 |
| 扫码解析 | `POST /api/miniprogram/codes/resolve`；阶段 3 已实现令牌类型/状态解析、审计和有效推广码的 10 分钟加密签名待确认来源；解析不创建线索。 |
| 双码管理 | `GET /api/enterprise/join-codes`、`POST /api/enterprise/join-codes/[type]/rotate`、`POST /api/enterprise/join-codes/[type]/disable`、`POST /api/enterprise/join-codes/[type]/image`；阶段 2/10 已实现。图片接口受租户授权、写入审计、私有且禁止缓存，保留微信返回的 PNG/JPEG 类型，并始终通过 `getwxacodeunlimit` 生成 `develop` 小程序码。 |
| 入驻 | `POST /api/miniprogram/onboarding/staff`、`POST /api/miniprogram/onboarding/referrer`；阶段 2 已实现。 |
| 推荐人 | `GET /api/miniprogram/referrer-memberships`、`DELETE /api/miniprogram/referrer-memberships/[id]`、`GET /api/miniprogram/referrer-memberships/[id]/promotion-code`；阶段 2 已实现。 |
| 服务码图片 | `GET /api/miniprogram/referrer-memberships/[id]/promotion-code/image`；阶段 4 已实现，校验当前推荐人关系后在事务外调用微信小程序码接口，返回不缓存的 PNG/JPEG 字节；其 `getwxacodeunlimit` `develop` 环境与企业入驻码保持一致。 |
| 客户建线索 | `POST /api/miniprogram/referrals/authorize-and-create-lead`；阶段 3 已实现客户上下文/微信手机号直接授权、幂等归属、原子建线索和派单。阶段 16 接受推荐人待确认来源或员工活动待确认来源；活动线索 `source=staff_activity`，出示人锁定为 `measurerId`。 |
| 员工活动码 | `GET /api/miniprogram/staff-activity-code`、`GET /api/miniprogram/staff-activity-code/image`；阶段 16 已实现。仅活动设计师/测量员可取码；设计师须微信号和个人二维码完整。`POST /api/miniprogram/codes/resolve` 增加 `kind: staff_activity`，活动落地可返回企业名称。 |
| 派单 | `POST /api/internal/lead-assignments/[leadId]/retry`；阶段 3 已实现且仅接受至少 32 字符的 `INTERNAL_SECRET` 服务身份。 |
| 可用时段 | `GET /api/appointments/availability`；第 5 阶段已完成，按企业排班、时长/步长、活动预约与不可用时间返回候选测量员可用时段，以及企业时区、时长、步长和最远可预约天数边界。 |
| 预约 | `GET/POST /api/appointments`、`POST /api/appointments/[id]/customer-reschedule`、`POST /api/appointments/[id]/internal-reschedule`、`POST /api/appointments/[id]/address`、`POST /api/appointments/[id]/cancel`、`POST /api/appointments/[id]/complete`；第 5 阶段已完成，已接通版本乐观锁、客户/设计师/测量员/企业负责人边界、自动换测量员、事件审计，以及创建、改期、取消后的事务后员工和已授权客户订阅消息尝试。地址接口允许已分配设计师或测量员在预约创建后补充服务地址，并写入 `address_updated` 事件。完成预约还要求线索关联已完成的正式 v4 量房户型且至少存在一个闭合空间；否则接口返回 `appointment_survey_required`（409）。客户读取和改期仅在请求线索或预约确属本人后推导企业范围，不接受 token 或请求声明的企业 ID。 |
| 日历与配置 | `GET/PUT /api/appointment-settings`、`GET/POST/DELETE /api/measurer-unavailability`；第 5 阶段已完成。 |
| 客户项目与方案发布 | `GET /api/miniprogram/customer-projects/[leadId]`、`GET /api/miniprogram/customer-projects/[leadId]/published-generations/[generationId]/image`、`POST /api/leads/[id]/ai-publications`、`DELETE /api/leads/[id]/ai-publications/[generationId]`、`POST /api/leads/[id]/ai-scheme-publications`、`DELETE /api/leads/[id]/ai-scheme-publications/[workflowId]`。客户读取仍只允许本人项目。后台设计师执行合并发布：同一 `workflowId` 内选中图片增量合并/更新进活跃发布记录，因此客户在同一方案内看到增量更新；未勾选但已确认的图片保持可见，除非被单张撤回或删轮次/删方案显式下架；小程序设计师仍可按单张成功 generation 发布。客户 DTO 将活动发布分组为 `publishedSchemes`（对话方案套，无 workflow 的单图归入「其他效果图」）。已撤回或已删除 generation 绝不出现在客户聚合或图片端点。 |
| 启动与身份外壳 | `GET /api/miniprogram/bootstrap`；第 11 阶段实现。服务端按当前签名 JWT 实时校验 `contextVersion`、活动员工/推荐人关系，返回当前角色、有效角色组、企业/成员上下文、落点、能力白名单和服务端徽标摘要；无效上下文返回 `identity_context_invalid`，不回退客户身份。 |
| 提成 | `GET/PUT /api/commission-rules`、`GET /api/lead-commissions?status=&role=&fromDate=&toDate=&source=`（列表 DTO 含原始/调整审计字段）、`GET /api/lead-commissions/beneficiaries?role=`、`PATCH /api/lead-commissions/[id]`（仅 `payable` 可改金额和/或受益人，原因选填）、`POST /api/lead-commissions/mark-paid`；第 7 阶段服务端切片加待支付人工调整。规则只允许企业管理员/平台管理角色按租户读取和以版本乐观锁更新；报表、调整和付款 API 只返回或修改本企业记录。 |

所有企业接口使用现有 tenant route/context helper 和 RLS；内部重试接口必须使用服务身份，不能暴露给普通客户端。

## 13. 计划小程序与后台界面

阶段 4 已实现并写入设计还原台账的运行路由：

- `packages/business/promotion-service-code/promotion-service-code`：选定设计左屏，供推荐人展示给客户；服务码图片通过受保护接口生成。
- `packages/business/free-design-service/free-design-service`：选定设计中屏和右屏，承载扫码解析、手机号授权、幂等建线索和设计师微信结果。

第 5 阶段运行路由已按各自已批准的第 5 阶段设计源写入两份设计还原台账：

- `packages/business/referrer-workbench/referrer-workbench`：推荐人企业关系、内部企业选择和推广码入口。
- `packages/business/customer-project/customer-project`：已批准的第 6 阶段客户项目服务册展示真实预约、设计师/测量员、完成正式户型摘要和按方案名分组的主动发布图集；受保护方案图片读取为小程序本地文件后再供客户预览。该页面刻意不提供客户量房编辑入口或可编辑户型查看器。
- `packages/business/appointment-detail/appointment-detail`：真实服务调度记录及按岗位限制的内部改期、取消、完成和服务地址补录动作；已分配设计师与测量员都可在预约详情中补充或修正地址。
- `packages/business/appointment-reschedule/appointment-reschedule`：服务端计算可用时段，支持客户改期或调整原因选填的内部改期。
- `packages/business/appointment-booking/appointment-booking`：客户在测量员已匹配后从「服务」首屏或项目册进入，负责设计师也可从无线索详情进入；双方填写上门地址、选择服务端实时计算的可用时段并创建首次预约，先提交成功的一方占用有效预约。若首次预约时地址未完整确认，后续由预约详情补录。
- `packages/business/measurer-calendar/measurer-calendar`：已确认的测量员日程，提供不可用时间编辑入口。
- `packages/business/measurer-unavailability/measurer-unavailability`：测量员仅维护本人不可用时段；使用原生日期/时段 picker、原因、保存和删除，API 仍在服务端强制角色和本人边界。
- `packages/business/onboarding/onboarding`：员工/推荐人入驻码落地页；它在手机号授权前解析码类型，收集授权，员工只选择 `designer` 或 `measurer`，推荐人在手机号授权后必须填写真实姓名，再调用既有入驻接口并切换到返回身份上下文。
- `packages/business/identity-switch/identity-switch`：列出服务端活动身份上下文，交换签名上下文令牌，刷新完整会话，并重新进入所选客户/员工/推荐人界面。

第 7 阶段商户路由 `/lead-commissions` 已按既有 Admin UI 方向实现 Ant Design/Admin Pro 规则卡（`Card`、`Segmented`、`InputNumber`、`Switch`）、`ProTable` 状态/角色/来源/日期台账筛选、真实关联报表列、带确认的批量标记已支付、按线索主行展开台账（子表三角色明细，默认展开）与待支付行「调整」弹窗（金额和/或受益人；受益人与原因选填）和 `Statistic` 金额汇总。它新增独立的 `lead-commissions` 导航与权限边界，不替换 `/acquisition-commissions`。其余功能型后台工作遵循双语 Admin UI 重构约定及既有 Ant Design/Admin Pro 路由模式。

### 13.1 第 10 阶段：后台运营与全流程验收工作台（In progress）

当前双码、员工/推荐人入驻、派单资格和全流程业务合同均已具备服务端能力，但后台缺少运营人员无需调用 API 的可视化入口。第 10 阶段提供 `/referrer-network-operations`、`/join-codes`、`/referrers`、`/appointment-settings` 及按登录角色渲染的首页员工工作台，供管理角色在现有租户边界内完成运营验收，并供设计师/测量员处理本人任务：

1. 在 `/join-codes` 选择当前企业，查看员工码与推荐人码的状态、版本、失效时间、创建/停用审计；在确认后换码、停用、展示或下载可扫码的入驻二维码。令牌不会离开服务端进入后台页面、普通日志或公开页面。
2. 在 `/staff` 检查设计师和测量员的入驻、账号状态、`assignmentPaused`、设计师微信号/二维码完整性及当前派单资格；运营枢纽只展示资格计数和跳转。只复用现有员工资料和派单重试合同，不新增手工接单或跨企业派单。
3. 在 `/referrer-network-operations` 提供面向测试人员的“完整工作流准备清单”：推荐人已入驻、已生成推广服务码、可派单设计师/测量员、预约设置、三角色提成规则及外部微信能力。`/referrers` 是推荐人姓名/手机号名册与停用后续扫码入口。清单只呈现真实状态和跳转入口，不伪造客户、线索、预约、量房、AI 或签单数据。
4. 以真实小程序账号依次完成推荐人入驻、展示服务码、客户领取、自动派单、预约、正式量房、AI 发布、签单及提成台账的人工验收；工作台只展示已发生的审计/状态，不绕过手机号授权、匿名边界或客户所有权校验。

这是功能型后台 UI，直接遵循双语 Admin UI 重构约定及既有 Ant Design/Admin Pro 路由方向，不需要独立桌面设计源；不得复用客户匿名领取页设计，也不得把二维码、令牌或审计数据切片为界面素材。实现后需在中英文 Admin UI 路由台账和模块清单中登记最终路由、权限、视觉证据和限制。

当前切片已将 `/referrer-network-operations` 收为就绪枢纽，并为每项验收提供真实入口；`/join-codes` 负责双码作业与完整审计，`/referrers` 负责推荐人姓名/手机号名册与停用后续扫码，`/appointment-settings` 明确区分系统自动默认值与管理员已确认策略。商户侧栏将这四条路由归入「推荐网络」分组。推广服务码就绪项会分别读取已持久化的活动码数量与活动成员关系，不再把成员关系当作服务码仍可用的证明。同时补齐此前仅有接口的客户端缺口：预约详情/内部动作、AI 结果发布/撤回及身份切换。普通双码列表继续不返回活动令牌，受租户授权并写入审计的图片接口保持私有、禁止缓存。后台首页现按 Cookie 会话中的 `designer`/`measurer` 角色渲染独立员工工作台，`GET /api/workbench/staff` 在租户事务内返回本人线索、预约和量房交接；测量员工作台只提供任务与既有后台入口，正式 BLE 量房仍以小程序编辑器为唯一生产入口。小程序现在在启动/回到前台时刷新保存的 JWT，校验 `contextVersion` 并统一选择角色落点；推荐人登录和冷启动会重新进入推广工作台，不再回到登录前的 Tab，失效上下文会清理本地会话。带 JWT 的员工线索列表无需 legacy OpenID 也会加载。认证 Chrome 已在 `http://localhost:3006` 完成核验；真实登录态推荐人已在 `390x844` 完成登录完成与重新编译后冷启动核验，并保存包含原生胶囊的宿主截图。后台设计师/测量员角色登录态视觉核验、预约与方案发布动作仍需真实业务数据。

第 11 阶段已完成身份启动与权限外壳：`GET /api/miniprogram/bootstrap` 以当前签名上下文为唯一输入，返回当前角色、有效角色组、企业/成员关系、默认落点、能力白名单和服务端徽标摘要；冷启动、登录、入驻、身份切换和客户领取成功后的会话均在进入落点前重新刷新并校验 bootstrap。上下文撤权、停用或版本变化会清理 token 并保留明确的恢复原因，不再生成本地伪造身份。`identity-navigation` 提供角色能力与深链守卫，越权路由统一回到当前有效角色落点；未知身份不会静默回落客户页。第 12 阶段已获沿用当前小程序风格的实施授权，bootstrap 角色白名单导航和身份失效恢复页已开始落地；完整角色业务工作台仍依赖后续阶段的数据合同。

### 13.2 第 11-15 阶段：五角色完整小程序体验（Planned）

当前服务端已经能够创建并切换 `customer/staff/referrer` 上下文，客户端也已在 JWT 冷启动、重新登录和入驻后恢复推荐人推广工作台；推荐人工作台在服务端确认存在多个身份时提供切换入口，并始终保留退出当前账号。首页、线索、量房、设计和“我的”仍以旧的“员工/非员工”二分法组织。静态 TabBar 还会向不相关角色暴露线索、量房或 AI 入口，其他角色的身份切换仍主要位于设置页，多企业推荐人成员关系又在身份列表和推广工作台重复表达。这些属于第 11-15 阶段必须消除的产品缺口，现有路由不能作为闭环已经完成的证据。

#### 13.2.1 已批准的角色与职责边界

小程序只为五类业务角色提供工作台：客户、推荐人、设计师、测量员和企业负责人。平台管理员及旧 `salesperson` 不进入本轮小程序信息架构，继续使用后台。一个基础微信账号可以拥有多个角色，但任一时刻只激活一个签名上下文；同一用户若同时是设计师、推荐人或企业负责人，必须主动切换身份，权限不得合并。

| 当前身份 | 默认落点与导航 | 必须完成的核心任务 | 明确禁止出现 |
| --- | --- | --- | --- |
| 客户 | `服务 / 我的` | 查看本人服务进度、当前预约、正式户型摘要和已发布命名方案图集；匹配测量员后预约上门，并在允许窗口内改期 | 员工线索池、正式量房编辑器、BLE、AI 生产工具、签单/提成管理 |
| 推荐人 | `推广 / 进度 / 收益 / 我的` | 在工作台内选择服务企业、展示推广服务码、查看脱敏后的客户服务里程碑和本人提成状态 | 客户手机号、精确地址、可编辑户型、预约内部原因、员工调度和企业规则 |
| 设计师 | `工作台 / 客户 / 设计 / 收益 / 我的` | 处理本人被派线索、创建或协调预约、查看正式量房结果、生成并发布方案、推进签约协作，并查看本人提成 | 测量员请假维护、他人线索、企业级提成配置、无项目约束的自由量房入口 |
| 测量员 | `工作台 / 客户 / 收益 / 我的` | 先进入角色工作台查看今日预约；通过“客户”Tab查看已量房完成客户与相关交接状态；通过“收益”Tab查看本人提成；正式量房编辑器仍仅从任务上下文深链进入 | 设计发布、签约、推荐人收益、企业规则和未指派客户数据 |
| 企业负责人 | `经营 / 客户 / 预约 / 提成 / 我的` | 查看本企业异常与关键指标、处理派单/预约异常、查看客户全流程、确认线下提成打款、执行现有受权签约和移动审批 | 以负责人身份直接继承设计师或测量员工具；需要实操时必须切换到对应员工身份 |

TabBar 使用角色白名单生成，不保留所有身份共用的固定中心“量房”按钮。只有测量员身份显示量房主入口；设计师和企业负责人只能从有权限的线索/户型上下文进入只读结果或现有业务动作，客户和推荐人永远不显示量房编辑入口。客户端隐藏、深链守卫和服务端授权必须三层一致，不能把“页面上看不到”当成权限控制。

#### 13.2.2 身份启动、恢复与两级切换

1. 新增或扩展统一启动合同 `GET /api/miniprogram/bootstrap`，返回当前签名上下文、可用角色组、当前企业/成员关系、允许的导航能力、默认落点和必要徽标摘要；页面不得各自根据 `role === 'staff'` 猜测身份。
2. 冷启动、热启动、手机号登录、密码登录、入驻成功和身份切换后都先刷新并校验当前上下文，再进入该角色落点。上次上下文仍有效时保持不变；失效时进入明确的恢复/选择状态，禁止静默回落为客户界面。
3. “我的”首屏始终显示当前角色和企业，并提供可发现的身份切换入口；不再要求先猜到设置齿轮。只有一个角色时显示当前身份但不制造无意义的切换流程。
4. 推荐人在角色层只出现一个“推荐人”身份。进入推广工作台后再选择企业；企业选择会通过现有签名切换合同更新 `referrerMembershipId`，后续数据、推广码和提成始终绑定当前成员关系。
5. 成员退出、员工停用、企业停用或 `contextVersion` 变化后，旧 token 立即失效；恢复页解释原因并只列出仍有效身份，不泄露已失效企业数据。

#### 13.2.3 五角色界面设计合同

全部新设计延续 `miniprogram/DESIGN.md`、设计 token 和 F1 小K + F3 空间变形机制，不建立第二套视觉系统。每种身份只给小K一个业务角色：客户为服务向导、推荐人为推广管家、设计师为方案协调者、测量员为测量搭档、企业负责人为调度观察员，“我的”为身份管家。品牌 IP 必须进入真实信息结构或任务隐喻，不能重复贴图或暗示不存在的能力。

第 12 阶段必须先为角色外壳、五种默认落点、动态 TabBar、身份选择/失效恢复及关键空状态形成明确设计源，并获得用户批准后才开发生产 UI。每个运行路由只在实现和 `390x844` 原生宿主核验完成后更新中英文设计还原台账；本计划本身不构成视觉实施批准。既有已批准的客户项目、推广服务码、预约和正式量房设计继续作为对应深层路由的权威来源，不因外壳重构而被通用卡片替换。

第 12 阶段当前设计源为 [`miniprogram-role-shell-design-v1.zh-CN.md`](./miniprogram-role-shell-design-v1.zh-CN.md) 及其英文镜像。用户已批准沿用当前小程序风格实施；现阶段只将服务端 bootstrap 的角色白名单映射为已存在的真实路由，并在 token 失效时进入不泄露失效企业信息的恢复页。客户项目索引、推荐人进度/收益、测量任务聚合和企业经营移动入口仍由第 13/14 阶段补齐，不使用空白或模拟 Tab。还原台账仍须等待各运行路由的 `390x844` 原生宿主核验后才可更新。

#### 13.2.4 端到端角色闭环

```text
推荐人选择企业并展示服务码
  -> 客户匿名查看服务并授权手机号
  -> 系统锁定归属、创建线索并自动派设计师/测量员
  -> 客户自行预约上门，或设计师沟通后代为预约
  -> 测量员按本人日程进入正式量房并完成交接
  -> 设计师消费正式户型、生成并主动发布方案
  -> 客户在本人项目中查看预约、户型摘要和已发布方案
  -> 企业负责人确认签约并形成三方提成
  -> 推荐人只查看脱敏服务里程碑与本人应付/已付收益
```

跨角色交接必须由真实业务事件驱动：派单、预约创建/改期/完成、正式户型完成、方案发布、签约和提成状态分别产生可重试通知与站内事实。角色首页只聚合当前身份可执行的下一步，不复制完整业务表，也不把 API、脚本、假数据或手工改库作为验收路径。

#### 13.2.5 状态、数据范围与隐私

- 所有角色覆盖首次进入、正常有数据、空状态、加载、可重试错误、会话失效、权限撤销和长列表分页；推荐人还覆盖零/一/多企业及成员退出。
- 客户项目列表以 `customer_user_id` 为唯一所有权；设计师只读本人负责线索；测量员只读本人当前/历史任务；企业负责人仅在当前租户；推荐人按当前成员关系读取脱敏归属与本人提成。
- 推荐人进度只展示足以证明服务发生的阶段、脱敏客户标识、归属企业、更新时间和提成状态；不得返回手机号、微信号、精确地址、户型 graph、内部预约原因或设计文件。
- 深链进入不属于当前身份的路由时显示清晰的无权限恢复状态并返回角色首页，不得渲染旧界面、空白页或借其他角色 token 继续请求。
- 首页和 TabBar 的徽标必须来自服务端角色范围内的真实待办计数；未知或失败时显示可恢复状态，不以本地模拟数字占位。

## 14. 通知与可靠性

- 站内通知/任务日志是可靠事实；微信订阅消息是尽力而为增强。
- 业务事务提交后通过 outbox 或现有可重试通知日志发送。
- 员工订阅投递在 `admin_users.openid` 为空时经 `userId` 读取 `wechat_identities`，不回写旧字段。
- 关键点矩阵（派生服务阶段，不写入 `leads.status`）：
  - 新线索派单成功：设计师/测量员收 `lead_assignment`，企业负责人收 `new_lead`；待派单失败只通知负责人 `workflow_todo`。
  - 预约创建、改期、取消、过期/重约：设计师、测量员与客户收 `measurement_appointment`；过期催办不刷客户，负责人进经营异常不刷订阅。
  - 正式 v4 量房完成：设计师收 `workflow_todo`（生成并发布方案）。
  - 方案对客户可见：客户收 `design_published`（设计案例发布提醒）；撤回与发布者本人不刷。
  - 签单/关闭/推荐人不发微信订阅。
- 平台配置五个订阅模板；小程序按身份一次最多授权 3 项（客户 2、设计师/测量员 3、负责人 2、推荐人 0）。
- 预约创建、改期、换人、取消、失败重试、方案发布都要有独立事件键或 generation 去重，避免重复消息。
- `measurement_appointment` 仅作用于真实预约表事件；不得复用 `measureDueAt`。
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
| 5. 预约与日历 | `Completed` | 租户预约设置、不可用时间、工作时段、首次预约、客户/内部改期、取消/完成、事件审计、乐观版本和排斥约束均已实现。后台设置单可确认默认策略；线索详情和测量员日程进入真实预约调度页，每个岗位只显示被允许的动作，取消原因必填，内部改期原因选填并在填写时写入审计。既有预约状态保留 `390x844` 证据；新增详情与内部动作状态待刷新截图。 |
| 6. 客户项目、量房与 AI 发布 | `Completed` | 项目聚合、仅客户本人读取、完成正式户型摘要和受保护预览均已实现。后台工作台对话发送命名多图方案；小程序设计师仍可按单张成功 generation 发布。客户服务册按方案名分组（无 workflow 单图归入「其他效果图」），不提供量房编辑或 graph 编辑路径。第 6 阶段视觉语言仍为设计源；分组相册的原生胶囊重截待补。 |
| 7. 签单与三方提成 | `Completed` | 已实现三规则 Repository、签单原子快照、三条唯一提成、待支付金额/受益人调整与审计、已付/作废约束、RLS 报表、批量付款 API 及批准的 `/lead-commissions` 规则/报表/调整工作台。聚焦 PostgreSQL 提成与调整测试、生产构建及认证 `localhost:3006` 对批准桌面工作台的视觉核验均已完成。 |
| 8. 旧流程下线 | `Completed` | 运行时 schema、接口、菜单、旧工作台和小程序旧联系入口均已删除。PostgreSQL 合同测试和小程序测试通过；历史数据库对象和业务数据保留至第 9 阶段清理演练获得单独批准后处理。 |
| 9. 清理演练与生产发布 | `Completed` | 已在用户确认的本地 Docker 正式 volume 完成：只读 dry-run、目标指纹和空七牛清单确认、清理前完整备份、单事务业务数据清理、JSON/Markdown 审计以及清理前备份的恢复演练。平台管理员、角色权限、套餐、平台/媒体/AI 配置、提示词及迁移记录均保留；业务表已清空，七牛无候选对象。 |
| 10. 后台运营与全流程验收工作台 | `In progress` | `/referrer-network-operations` 现为就绪枢纽；`/join-codes` 负责双码作业与审计；`/referrers` 列出推荐人姓名/手机号并支持停用后续扫码；`/appointment-settings` 已进「推荐网络」侧栏分组并展示/确认企业预约策略。后台线索详情现已通过 Cookie 会话取消/完成预约、重新预约，以及发布/撤回 AI 方案，与小程序岗位边界一致；`GET /api/miniprogram/bootstrap` 现按当前身份返回真实 Tab 徽标，失败显示「暂时无法读取」。认证后台视觉核验已在 `http://localhost:3006` 完成，仅 JWT 的设计师线索空态及真实登录态推荐人登录/冷启动工作台均已在 `390x844` 完成原生宿主胶囊核验；预约和方案发布的登录态动作、徽标与五角色首页仍需真实已派线索数据复核。 |
| 11. 身份启动与权限外壳 | `Completed` | `GET /api/miniprogram/bootstrap` 返回当前签名角色、有效角色组、企业/成员上下文、落点、能力白名单和服务端徽标摘要；冷启动、登录、入驻、领取和切换均先刷新校验；撤权/停用/版本变化清理会话并保留恢复原因；身份导航拒绝未知身份和越权深链，不静默回落客户界面。上下文撤权、停用、多角色恢复及深链负向测试通过。 |
| 12. 角色信息架构与设计批准 | `In progress` | 用户已批准沿用当前小程序风格。`docs/miniprogram-role-shell-design-v1.*` 定义五角色目标、白名单、恢复状态和安全区；生产已实现 bootstrap 驱动的当前真实路由导航、不泄露失效企业数据的恢复页，以及按身份待办计数的 Tab 徽标（失败显示「暂时无法读取」）。各路由还原台账待 `390x844` 核验。 |
| 13. 客户与推荐人闭环 | `In progress` | 已实现客户项目索引 `GET /api/miniprogram/customer-projects`，仅按当前 JWT 客户读取本人未归档项目的阶段摘要；项目册将已发布图片分组为命名方案图集（`publishedSchemes`），无 workflow 的小程序单图归入「其他效果图」。推荐人工作台选择其他企业时会先交换签名 `referrerMembershipId` 上下文并刷新会话，故服务码与 `GET /api/miniprogram/referrer-progress` 使用同一当前成员关系边界；`GET /api/miniprogram/referrer-earnings` 仍校验该成员关系，并按当前提成行的 `beneficiaryUserId`/`payableAmount` 列出收益。聚合只返回脱敏客户标识、服务阶段/更新时间及本人应付、已付或作废收益。客户服务 Tab 徽标统计待预约/待改期/待重约，推荐人进度/收益徽标统计未完结里程碑与待付收益。客户/推荐人负向权限测试与小程序聚焦测试通过；分组相册的原生胶囊核验待补。 |
| 14. 设计师、测量员与企业负责人闭环 | `In progress` | `GET /api/miniprogram/workbench` 现于租户事务中从签名员工上下文推导角色、企业和员工范围；企业负责人经营台返回待派失败、过期未重约和人员缺口，预约 Tab 进入 `enterprise-appointments` 真实列表（含过期），不再占用 `pages/ai-design`。测量员进入角色工作台，再由其中的日程入口打开 `measurer-calendar`；过期或已完成预约离开已确认列表。正式 v4 户型完成后也不再回到工作台待上门队列和「待量房任务」计数。客户服务首屏消费共享 `serviceStage`/`nextActionKind`（测量员匹配后下一步为预约上门，设计师仍可代约）。设计师可在 `profile-edit` 自助维护微信号和二维码。bootstrap 徽标分别统计设计师待跟进与过期、测量员工作台今日/任务、负责人异常（含过期未重约）。后台新增 `GET /api/workbench/staff`。聚焦导航/徽标测试已通过，后台角色登录态与小程序登录态 `390x844` 原生胶囊核验、真实多角色数据验收待完成。 |
| 15. 五角色真实全流程验收 | `Planned` | 使用真实微信账号或同一账号的真实多上下文，从推广码到客户授权、派单、预约、量房、发布、签约和三方提成逐步验收；覆盖冷启动、切换、撤权、通知失败、分页和深链负向场景，并完成每个受影响路由的 `390x844` 原生胶囊证据与双语文档收口。 |
| 16. 员工活动码获客轨 | `Completed` | 新增 `staff_activity_codes`、扫码解析第三种码、可空推荐人归属锁、出示人锁定 `measurerId`、设计师兼任或自动派设计师、户型 `measurerId` 授权、活动线禁止自动换测量员、无预约待量房工作台任务、按来源快照 2/3 条提成。小程序活动码页沿用推荐人服务码视觉语言并允许企业品牌；`390x844` 原生胶囊核验待补。 |

## 17. 测试与验收矩阵

内测材料（推荐分册）：全员先看 [internal-test/00-所有人先看.md](./internal-test/00-所有人先看.md)（含流程图），再按角色阅读 `internal-test/角色-*.md`。发给非技术同事用 Word：`internal-test/装修服务内测-所有人先看.docx` 与 `internal-test/装修服务内测-角色-*.docx`。旧合订本入口：[referrer-network-internal-test-handbook.zh-CN.md](./referrer-network-internal-test-handbook.zh-CN.md)。

- 身份：普通客户可创建账号；角色切换不能伪造企业；旧 token 在关系变化后失效。
- 双码：类型隔离、换码立即失效、员工单企业、推荐人默认三家上限、退出不改历史。
- 匿名推广：四个公共/授权状态不包含装修公司名称、Logo、企业选择或明文 ID。
- 归属：扫码不建线索；授权才创建；重复与并发授权只产生一个活动锁和一条线索。
- 派单：最小负载、稳定 tie-break、无人员保留线索、新员工入驻自动重试、无手动接单。
- 预约：工作时间、步长、范围、请假、排斥约束、客户截止、内部原因、自动换人、版本冲突。
- 权限：转发卡片不能越权；客户只读本人项目；员工和推荐人不能跨企业；设计师微信二维码受保护。
- 角色启动：冷启动、重新登录、入驻完成和身份切换都进入当前有效角色落点；上下文失效不能静默变成客户。
- 角色导航：五种身份只出现其白名单 Tab 和主动作；客户/推荐人无量房入口，测量员无设计发布，企业负责人不自动继承专业岗位工具。
- 多角色：同一基础账号切换后 token、角色首页、TabBar、缓存和请求范围同步更新；推荐人角色内企业切换同步更新成员关系上下文。
- 推荐人隐私：进度与收益可核对，但手机号、精确地址、户型 graph、内部预约原因和设计文件不可见。
- 角色深链：复制或转发其他角色页面时由服务端拒绝，客户端显示恢复路径且不闪现越权内容。
- 通知：创建、改期、换人、取消、失败重试；微信失败不影响业务事务。
- 量房/AI：只有正式 v4 户型；只有主动发布的命名方案图集对客户可见。
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
- 小程序角色工作台固定为客户、推荐人、设计师、测量员和企业负责人；平台管理员与旧 `salesperson` 留在后台。
- 推荐人只显示一个角色入口，多企业选择在推广工作台内完成并切换签名成员关系上下文。
- 客户不使用员工线索、正式量房编辑或 AI 生产工具；企业负责人不因管理角色自动获得设计师/测量员实操入口。
- 任一时刻只激活一个身份上下文；上下文失效必须显式恢复，不得静默回落普通用户界面。
- 员工和推荐人扫码入驻立即生效，不走审核。
- 测量员先预分配，预约或改期冲突时自动换人；`staff_activity` 线索禁止自动换测量员。
- 员工身份仍是单一 `designer` / `measurer`。`measurerId` 可以指向设计师员工，这是任务指派，不是第二身份。企业负责人仍必须切到设计师/测量员身份才能实操。
- 员工活动码由客户扫码授权建档，不恢复测量员手工录客户。
- 活动线索不写入推荐人进度/收益，不自动生成假预约。
- 客户只能选择服务端确认的真实可用时段，改期立即生效。
- 客户不能自行取消预约。
- 提成只形成企业线下发放台账，平台不参与支付。
- 正式生产业务数据全清不通过普通迁移执行，且必须获得单独明确批准。
