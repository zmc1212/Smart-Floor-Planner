# 家客来 1.0 试点项目范围（I7.4.4）

企业管理员通过管理端 API 提交第一批试点的明确项目 ID。每个企业可以维护多个 `pilotId`，预检每次读取指定试点的最新版本。

## 范围合同

| 字段 | 约束 |
| --- | --- |
| `enterpriseId` | 从管理端会话取得当前企业，正 bigint 字符串。 |
| `pilotId` | 同一企业内的试点标识，1–128 个英文字母、数字或 `._:-`。 |
| `projectIds` | 非空、无重复的正 bigint 字符串数组。每个项目必须属于当前企业，项目和关联线索均未归档。已暂停项目可被显式选中，预检按其实际状态报告。 |
| `createdBy` | 服务端记录保存该版本的管理端账号 ID。 |
| `createdAt` | 数据库生成的版本时间，接口返回 UTC ISO 8601。 |
| `scopeVersion` | 每个企业、每个试点独立从 1 递增。 |
| `status` | `active` 供预检读取，`inactive` 停用该试点。停用沿用最新版本的项目清单，即使项目后来已归档或删除。 |

迁移 `0130` 新建 `app.xiaok_pilot_project_scopes`。每次保存追加版本，校验 `expectedVersion`，并在同一试点内串行写入。数据库触发器在写入有效范围时核对项目和线索归属，跨企业、未知或已归档的引用统一返回 `pilot_project_unavailable`。范围表启用并强制 RLS。项目后续生命周期由 Construction 管理，预检会重新核对已选项目是否可用。

## 管理端 API

- `GET /api/construction/pilot-scopes/{pilotId}` 读取最新版本。未知试点返回 404。
- `PUT /api/construction/pilot-scopes/{pilotId}` 提交 `projectIds`、`expectedVersion`、`status`。首次保存传 `expectedVersion: 0` 和 `status: "active"`。后续保存传当前版本，冲突返回 409，读取后再提交。停用时传当前项目清单及其原顺序。

使用管理端会话，沿用选定企业、施工管理角色和实时 `construction_actor_access='owner'` 核验。企业负责人只能管理本企业。平台 `admin`、`super_admin` 沿用选定企业管理权限。施工人员、项目经理、设计师、需改密账号和小程序身份均无配置权限。项目状态、成员权限、企业跨项目权限及报告设置继续由各自的业务服务管理。

以下为合成示例请求体。

```json
{"projectIds":["101","205"],"expectedVersion":0,"status":"active"}
```

## 只读预检

```powershell
cd admin
npm run check:pilot-readiness -- --enterprise-id 123 --pilot-id first-pilot
npm run check:pilot-readiness -- --enterprise-id 123 --project-ids 101,205
```

- `--pilot-id` 检查已保存的最新版本。缺失、停用、不可用 ID、空范围均为 `blocked`。部分 ID 不可用时整组判为无效。
- `--project-ids` 供只读试算。有效名单至少产生一条 `pilot.scope` warning，因为它尚无企业管理员保存的记录。
- 只提供企业 ID 时返回企业检查及缺少范围的 blocker。诊断整个企业的历史项目可显式传 `--enterprise-audit`。
- 企业检查包括 Assistant、全局 Worker、迁移 0128–0130、业务账号和强制 RLS。试点项目检查分别给出缺阶段、缺有效计划、角色覆盖不完整和 C01 缺失的 ID。部分 C01 缺失沿用 warning，没有任何可用 C01 时阻断。
- `outsideScope.activeProjects` 列出范围外 active 项目。范围外项目资料缺项独立于试点项目就绪结果。

## 通知边界

`active` 状态供预检选择配置版本。保存和检查均无投递入口。现有提醒 Worker 仍按有效 active 项目和阶段事实运作，周报仍按 `construction_report_settings.project_ids`、`stage_keys`、项目生命周期和收件权限计算。空的企业周报项目清单表示全部符合条件的项目。

预检列出现有规则可能覆盖的范围外项目及未完成提醒，另读取周报待发或挂起事实快照中引用的范围外项目。候选覆盖和排队记录都不是发送回执。已有规则或存量投递涉及范围外项目时会给出 `pilot.outside_delivery`。范围外原有规则继续运行，启用试点触达前须另行核定运行时范围及存量投递。详见[预检工具](xiaok-pilot-readiness-checker.md)和[首家试点记录](xiaok-first-pilot-enterprise-readiness.md)。
