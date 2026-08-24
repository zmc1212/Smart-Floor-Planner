# 已下线的测量员—设计师获客协作契约

状态：`Retired in Phase 8`

测量员绑定设计师、测量员录入线索、设计师确认获客、获客协作工作台及测量员固定获客提成，均已从运行时移除。替代合同以[推荐人网络与预约量房闭环开发计划](./referrer-network-appointment-development-plan.zh-CN.md)为准。

已移除的接口为 `/api/leads/[id]/acquire`、`/api/acquisition-tasks` 和 `/api/acquisition-commissions/*`；后台旧获客提成路由、小程序获客协作工作台及旧设计师联系入口也不再存在。站内通知已保留为共享能力，继续服务新线索派单和预约事件。

本次下线不迁移或删除历史数据库对象和业务数据。它们在第 9 阶段清理演练及生产发布获得单独批准前，不属于运行时 schema。

## 当前替代派单扩展

已退役的测量员获客协作没有恢复。推荐网络新线索、后台手工录入线索和测量员活动码线索现进入独立的[抢单与赛马派单运行合同](./lead-claim-racing.zh-CN.md)：测量员仍在事务内立即预分配，设计师位置则在开启时打开带规则版本的抢单窗口，关闭或超时后走确定性赛马派单。设计师活动码仍直接归出示设计师。抢单、人工指派和自动派单都不会创建已退役的获客任务或获客提成记录。

英文镜像：[measurer-designer-acquisition.md](./measurer-designer-acquisition.md)
