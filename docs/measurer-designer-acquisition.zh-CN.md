# 已下线的测量员—设计师获客协作契约

状态：`Retired in Phase 8`

测量员绑定设计师、测量员录入线索、设计师确认获客、获客协作工作台及测量员固定获客提成，均已从运行时移除。替代合同以[推荐人网络与预约量房闭环开发计划](./referrer-network-appointment-development-plan.zh-CN.md)为准。

已移除的接口为 `/api/leads/[id]/acquire`、`/api/acquisition-tasks` 和 `/api/acquisition-commissions/*`；后台旧获客提成路由、小程序获客协作工作台及旧设计师联系入口也不再存在。站内通知已保留为共享能力，继续服务新线索派单和预约事件。

本次下线不迁移或删除历史数据库对象和业务数据。它们在第 9 阶段清理演练及生产发布获得单独批准前，不属于运行时 schema。

英文镜像：[measurer-designer-acquisition.md](./measurer-designer-acquisition.md)
