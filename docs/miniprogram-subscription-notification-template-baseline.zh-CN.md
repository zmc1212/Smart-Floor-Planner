# 小程序订阅通知模板实施基线

状态：`Limited`（八模板配置及工作流/指派/新线索/方案发布/入驻结果/推荐人签单提成/负责人签单成功运行时映射已实现；上门量房预约触发仍按事件路径有限落地）。

日期：2026-08-21

本文档是微信小程序“房屋装修”公共模板的当前实施契约。模板 ID 和关键词键均已从“订阅消息 -> 我的模板”详情页回读，并在 2026-08-21 针对 AppID `wxa7728432f59779d1` 用 `wxaapi/newtmpl/gettemplate` 复核（此前 `l`/`I` 与大小写抄错会导致微信 `40037 invalid template_id`，已废弃）。服务端必须按语义模板生成严格白名单 payload，不能继续复用旧的通用字段。

## 已确认模板

| 优先级 | 模板类型 | 模板 | 业务场景 | 模板 ID | 关键词契约 |
| --- | --- | --- | --- | --- | --- |
| 1 | `workflow_todo` | `装修待办提醒` | 跟进、量房、设计、关闭和获客提成待结算等通用任务 | `48Jvq7OjOKwRhsnh8fyvtsjxAamLOakaNtiKcO11rOc` | `thing4` 项目名称；`thing11` 负责人；`phrase12` 当前状态；`thing2` 待办事项；`thing5` 备注 |
| 2 | `lead_assignment` | `客户指派成功通知` | 线索分配给量房师或设计师 | `wItuS0LdggzpMWdSOIr6FBSKeRbOKUzqXVCqJDmLpmA` | `thing1` 客户姓名；`phrase2` 客户状态；`thing3` 备注；`time4` 时间 |
| 3 | `new_lead` | `新增客户成功通知` | 创建新线索并通知企业负责人 | `EEvg03Lsp4V0ASHWhLOMiTmDI79Z_T3Sjg4xest9GRc` | `name1` 客户名称；`date2` 添加时间；`name3` 负责人；`phone_number4` 客户号码；`time5` 选定时间 |
| 4 | `measurement_appointment` | `上门量房提醒` | 已确认的独立上门量房预约 | `CtcuQ_NWF4GOpHvstgviDPmYRISjyqTjnFAoeQR9-vI` | `thing1` 姓名；`phone_number2` 手机；`thing3` 小区；`time6` 量房时间；`thing7` 温馨提醒 |
| 5 | `design_published` | `设计案例发布提醒` | 方案对客户可见 | `XEQFWwyaIQVotG3R6FKZxWLFExf9pS7_g85r-j3Vjag` | `thing1` 内容；`time2` 发布时间；`thing3` 备注 |
| 6 | `enterprise_join_result` | `入驻申请结果通知` | 平台对企业自助入驻申请审核通过或驳回 | `wJ5K4XXpOOPnsHFcEOl5MJq7J0iG8bpxsyVLzd_G3Kk` | `time1` 通知时间；`phrase2` 结果；`thing3` 店铺联系人；`time4` 申请时间；`thing5` 店铺名称 |
| 7 | `signing_commission` | `推广奖励到账提醒` | 推荐人签单成功 / 应付提成入账 | `aY-4Rk78otCQuM-PQ6yKUt46XFWP60zP8m7QqrrX8xU` | `thing1` 奖励类型；`thing2` 备注；`amount4` 奖励金额 |
| 8 | `lead_converted` | `客户已成交提醒` | 企业负责人签单成功提醒 | `WFQg70AyoRkLpHaNNK4oywE2gMS60nHuKelkLjkK3zo` | `time1` 通知时间；`thing2` 温馨提示 |

## 运行时通知映射

| 通知类型 | 使用模板 | 当前状态 |
| --- | --- | --- |
| 新线索创建后通知企业负责人 | `new_lead` | `Implemented` |
| 派单成功通知设计师/测量员 | `lead_assignment` | `Implemented` |
| 待派单催促企业负责人 | `workflow_todo` | `Implemented` |
| 已确认的独立量房预约（创建/改期/取消/过期） | `measurement_appointment` | `Limited`：事件路径已接入，字段契约仍须严格遵守。 |
| 正式量房完成后通知设计师 | `workflow_todo` | `Implemented` |
| 方案对客户可见 | `design_published` | `Implemented` |
| 企业管理 `POST /api/admin/enterprises/[id]/status` 的 `approve` / `reject` | `enterprise_join_result` | `Implemented`：收件人为企业 `contactPerson.phone`，经 `users` → `wechat_identities.openid` 解析。缺少 openid/模板或微信拒发不得回滚状态流转。Web `/register` 未在小程序授权订阅时可能被跳过。 |
| `POST /api/leads/[id]/convert` 成功且存在 `role=referrer` 提成快照行 | `signing_commission` | `Implemented`：仅微信尽力发给推荐人受益人 openid；设计师/测量员不是该模板收件人。 |
| 同一签单提交成功后通知企业负责人 | `lead_converted` | `Implemented`：写 `staff_notifications` 并尽力发微信；设计师/测量员/客户不收。 |
| 旧企业报备 `follow_up_*` / `measure_*` / `design_*` / `conflict_pending` / `record_closed` | — | `Retired`：创建/更新报备与定时扫描均不再发送；历史 `workflow_notification_logs` 仅供查阅。 |

`new_lead.time5` 在独立预约功能落地前采用明确的过渡口径：优先使用 `assignedAt`，没有负责人指派时间时使用 `createdAt`。该字段不得伪造未来预约时间。

## 点击跳转深链

订阅消息点击后的 `page` 目标：

| 模板 / 投递路径 | 收件人 | 深链 |
| --- | --- | --- |
| `lead_assignment` | 设计师 / 测量员 | `/packages/business/lead-detail/lead-detail?id={leadId}` |
| `new_lead` | 企业负责人 | 同上客户详情 |
| `workflow_todo`（待派单 / 量房完成） | 企业负责人 / 设计师 | 同上客户详情 |
| `measurement_appointment`（员工） | 设计师 / 测量员 | 同上客户详情 |
| `measurement_appointment`（客户） | 客户 | `/packages/business/customer-project/customer-project?leadId={leadId}` |
| `design_published` | 客户 | 同上客户项目册 |
| `signing_commission` | 推荐人 | `/packages/business/referrer-earnings/referrer-earnings` |
| `lead_converted` | 企业负责人 | `/packages/business/enterprise-commissions/enterprise-commissions` |
| `enterprise_join_result` | 入驻联系人 | `/pages/mine/mine` |

员工侧线索类通知不得只打开无 `leadId` 的 `leads-management` 列表。

## 已实现合同

- `platform_configs.notification_config` 使用 `version: 2` 的八模板映射，保存模板 ID、关键词契约及可选 `legacyTemplateId`；旧单 `miniprogramTemplateId` 读取和 PATCH 仍保留一个发布周期兼容。
- `GET/PATCH /api/platform/notification-config` 仅允许平台 `admin`/`super_admin` 读写八个非空、格式合法且互不重复的模板 ID；`/workflow-logs` 使用现有配置卡和共享操作反馈维护配置。
- `GET /api/miniprogram/notification-template` 向已认证小程序用户返回有序八模板列表和旧单值别名。小程序只缓存完整 V2 配置，不再内置模板 ID；无网络时只使用最后一次成功缓存。
- 登录、“我的”和设置入口按身份一次调用 `wx.requestSubscribeMessage`（最多三项）：客户 2 项、设计师/测量员 3 项、企业负责人 3 项（`new_lead` + `workflow_todo` + `lead_converted`）、推荐人 1 项（`signing_commission`）。企业开户页（`enterprise-register`）在提交前安静请求 `enterprise_join_result`；用户拒绝不影响提交。
- 服务端 builder 只输出所选模板允许的字段键，并统一处理空值、字符长度和中国时区 `YYYY-MM-DD HH:mm:ss`。入驻结果 `phrase2` 为「审核通过」或「审核不通过」。签单提成 `amount4` 使用 `¥xx.xx`。
- 旧企业报备工作流通知已停发。线索/预约/签单通知先写 `staff_notifications` 的 `in_app`（适用时），再尝试微信并记录 `sent`、`failed` 或 `skipped`。入驻结果与推荐人签单提成为仅微信尽力发送，且在提交成功后异步触发。微信失败、缺少 openid 或模板不得回滚业务。
- `/api/automation/reminders/run` 仅跑现行矩阵的预约过期；不再扫描报备跟进 / `measureDueAt` / `designDueAt` / 保护期公海催办。
- 手机号命中既有线索时继续复用原数据，不重复生成企业负责人或设计师通知。

## 交接检查清单

- [x] 八个模板均出现在“我的模板”。
- [x] 八个模板 ID 和准确关键词键已补录。
- [x] 后台配置支持八个按类型保存的模板 ID。
- [x] 小程序按身份聚合授权，并在开户页单独授权入驻结果。
- [x] 服务端 payload 只包含所选模板接受的字段键。
- [x] 适用场景下站内通知、按通道幂等和微信失败日志行为已保留。
- [x] 中英文后台/小程序清单与本基线双语对已同步。
- [ ] 持续按生产预约事件路径核验 `measurement_appointment` 投递。
