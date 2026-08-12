# 小程序订阅通知模板实施基线

状态：`Limited`（四模板配置、聚合授权及前三类运行时发送已实现；独立上门量房预约触发尚未实现）。

日期：2026-08-12

本文档是第一批微信小程序“房屋装修”公共模板的当前实施契约。模板 ID 和关键词键均已从“订阅消息 -> 我的模板”详情页回读，服务端必须按语义模板生成严格白名单 payload，不能继续复用旧的通用字段。

## 已确认模板

| 优先级 | 模板类型 | 模板 | 业务场景 | 模板 ID | 关键词契约 |
| --- | --- | --- | --- | --- | --- |
| 1 | `workflow_todo` | `装修待办提醒` | 跟进、量房、设计、关闭和获客提成待结算等通用任务 | `48Jvq7OjOKwRhshn8fyvtsjxAamLOakaNtiKcO11rOc` | `thing4` 项目名称；`thing11` 负责人；`phrase12` 当前状态；`thing2` 待办事项；`thing5` 备注 |
| 2 | `lead_assignment` | `客户指派成功通知` | 线索分配给量房师或设计师 | `wltuS0LdggzpMWdSOlr6FBSKeRbOKUzqXVCqJDmLpmA` | `thing1` 客户姓名；`phrase2` 客户状态；`thing3` 备注；`time4` 时间 |
| 3 | `new_lead` | `新增客户成功通知` | 创建新线索并通知企业负责人 | `EEvg03Lsp4V0ASHWhLOMiTmDI79Z_T3Sjq4xest9GRc` | `name1` 客户名称；`date2` 添加时间；`name3` 负责人；`phone_number4` 客户号码；`time5` 选定时间 |
| 4 | `measurement_appointment` | `上门量房提醒` | 已确认的独立上门量房预约 | `CtcuQ_NWF4GOpHvstgviDPmYRlSjyqTjnFAoeQR9-vl` | `thing1` 姓名；`phone_number2` 手机；`thing3` 小区；`time6` 量房时间；`thing7` 温馨提醒 |

## 运行时通知映射

| 通知类型 | 使用模板 | 当前状态 |
| --- | --- | --- |
| `follow_up_created`、`follow_up_overdue`、`conflict_pending`、`measure_overdue`、`measure_submitted`、`design_overdue`、`design_completed`、`record_closed`、`lead_acquired_commission_pending` 及其他通用工作流提醒 | `workflow_todo` | `Implemented` |
| `measure_assigned`、`design_assigned`、`lead_assigned`、`lead_pending_acquisition` | `lead_assignment` | `Implemented` |
| 新线索创建后通知企业负责人 | `new_lead` | `Implemented` |
| 已确认的独立量房预约 | `measurement_appointment` | `Limited`：当前没有预约时间/确认状态数据模型或真实触发事件；`measureDueAt` 仅是 SLA 截止时间，不得复用。 |

`new_lead.time5` 在独立预约功能落地前采用明确的过渡口径：优先使用 `assignedAt`，没有负责人指派时间时使用 `createdAt`。该字段不得伪造未来预约时间。

## 已实现合同

- `platform_configs.notification_config` 使用 `version: 2` 的四模板映射，保存模板 ID、关键词契约及可选 `legacyTemplateId`；旧单 `miniprogramTemplateId` 读取和 PATCH 仍保留一个发布周期兼容。
- `GET/PATCH /api/platform/notification-config` 仅允许平台 `admin`/`super_admin` 读写四个非空、格式合法且互不重复的模板 ID；`/workflow-logs` 使用现有配置卡和共享操作反馈维护四项配置。
- `GET /api/miniprogram/notification-template` 向已认证员工返回有序四模板列表和旧单值别名。小程序只缓存完整 V2 配置，不再内置模板 ID；无网络时只使用最后一次成功缓存。
- 登录、“我的”和设置入口一次调用 `wx.requestSubscribeMessage` 请求四个不同标题模板。设置页保持获批的单行布局，展示全允许、部分允许、拒绝、关闭、未设置和配置不可用状态。
- 服务端 builder 只输出所选模板允许的字段键，并统一处理空值、字符长度和中国时区 `YYYY-MM-DD HH:mm:ss`。
- 工作流通知先写 `workflow_notification_logs` 站内通道；线索通知先写 `staff_notifications` 的 `in_app` 通道，再尝试微信并记录 `sent`、`failed` 或 `skipped`。微信失败、缺少 openid 或模板不得回滚业务。
- 手机号命中既有线索时继续复用原数据，不重复生成企业负责人或设计师通知。

## 交接检查清单

- [x] 四个模板均出现在“我的模板”。
- [x] 四个模板 ID 和准确关键词键已补录。
- [x] 后台配置支持四个按类型保存的模板 ID。
- [x] 小程序一次聚合授权四个模板并显示部分授权状态。
- [x] 服务端 payload 只包含所选模板接受的字段键。
- [x] 站内通知、按通道幂等和微信失败日志行为已保留。
- [x] 中英文后台、小程序、获客契约和 UI/视觉台账已同步更新。
- [ ] 独立量房预约数据/API/确认事件上线后接入 `measurement_appointment` 发送；在此之前保持禁用。
