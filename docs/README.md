# Smart Floor Planner 文档

## 常用入口

| 要查的内容 | 看这里 |
| --- | --- |
| 后台功能、路由和权限 | [后台模块清单](./admin-system-modules.zh-CN.md#模块清单) · [English](./admin-system-modules.md#module-inventory) |
| 小程序页面、角色入口和 API | [小程序页面清单](./miniprogram-system-modules.zh-CN.md#页面清单) · [English](./miniprogram-system-modules.md) |
| 小K当前交付、验收和下一步 | [小K开发计划第 2 节](./xiaok-renovation-agent-development-plan.md#2-唯一当前任务) |
| 云工地视频当前交付 | [云工地视频计划第 2 节](./cloud-construction-video-plan.zh-CN.md#2-唯一当前任务) |
| 给同事发内测材料 | [内测材料分册](./internal-test/README.md) |

## 按工作查阅

- 正式量房的数据、保存和迁移边界见[量房数据合同](./surveying-module/formal-surveying.md)和[量房模块说明](./surveying-module/README.md)。
- 推荐获客、派单和预约量房见[推荐人网络与预约量房](./referrer-network-appointment-development-plan.zh-CN.md)和[抢单与赛马派单](./lead-claim-racing.zh-CN.md)。
- 小K服务行为和跨模块边界见[二期契约](./xiaok-assistant-phase-2.zh-CN.md)和[集成合同](./xiaok-integration-contract.md)。工地围观的权限、媒体与撤回见[公开直播契约](./construction-public-live-contract.zh-CN.md)。
- 开发或发布环境见[远端开发](./remote-development.zh-CN.md)、[生产发布与回滚](./production-deployment.zh-CN.md)和[PostgreSQL 运行架构](./postgresql-migration-plan.zh-CN.md)。
- 查批准设计和视觉还原状态可打开[小程序还原台账](./miniprogram-design-restoration-ledger.zh-CN.md)、[后台 UI 约定](./admin-ui-refactor.zh-CN.md)和[品牌 IP 规范](./design/jiakelai-brand-ip-guidelines.md)。

## 历史记录

已结束的计划、手测和验收从 Git 提交 `d28c6ccb` 回查。文中的 `d28c6ccb:docs/…` 是原文的定位符，在仓库根目录用 `git show` 查看。

```powershell
git show d28c6ccb:docs/xiaok-i748-assistant-worker-diagnostics.md
```

### 小K冻结基线

2026-11-05 精简前原件 `d28c6ccb:docs/archive/xiaok-renovation-agent-development-plan-before-simplification-20261105.md`。

### 云工地冻结基线

按语言查阅 2026-11-05 精简前的计划原件。

| 语言 | Git 定位符 |
| --- | --- |
| 中文 | `d28c6ccb:docs/archive/cloud-construction-video-plan-before-simplification-20261105.zh-CN.md` |
| English | `d28c6ccb:docs/archive/cloud-construction-video-plan-before-simplification-20261105.md` |

### 迁移与安全核查

| 核查内容 | Git 定位符 |
| --- | --- |
| 0131 结构对齐与正式迁移器验收 | `d28c6ccb:docs/xiaok-i749-3-0131-migration-acceptance.md` |
| 迁移顺序、时间戳与 SHA | `d28c6ccb:docs/xiaok-i7516-migration-final-review.md` |
| Worker 租户隔离与副作用审计 | `d28c6ccb:docs/xiaok-i759-worker-side-effect-audit.md` |
| 生产安全加固与发布门禁验收 | `d28c6ccb:docs/xiaok-i7523-production-security-hardening.md` |

开发和验收以对应功能清单、当前计划及[项目指令](../AGENTS.md)为准。历史结果适用于当时的版本与验收范围。
