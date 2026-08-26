# 客户服务首页——三项免费权益

**日期：**2026-08-25  
**状态：**已实施 / 真机运行时视觉核验待补  
**界面：**小程序客户「服务」Tab · `pages/index/index`  
**批准设计源：**`design-references/customer-service-home-three-free-v1/customer-service-home-three-free-v1.png`

## 目标

客户「服务」首页现与已批准的手机号授权页保持同一获客承诺。旧的「两项服务，全程免费」/「免费量房」/「免费设计」营销层替换为三项确定权益：

- `免费效果图` / `出到客户满意为止`
- `免费家装设计顾问` / `解答你的装修问题`
- `免费家装现场顾问` / `解答现场问题`

营销权益与真实业务阶段仍为两个独立层级。白色阶段票据继续消费真实 `serviceStage`、`nextActionKind`、`appointmentSummary`、正式户型预览、已发布方案预览和多项目数据。

## 构图与交互

1. 胶囊安全身份栏保留「家客来 · 服务向导」、专业服务标签和服务码/邀请码扫码。
2. 单一绿色 Hero 使用「三项免费权益」与「三个免费，装修更省心」。完整小 K 只出现一次，手持三张语义权益牌。
3. 跨层服务票据保留真实四步轨「匹配 / 预约 / 量房 / 方案」。存在次要档案动作时，主动作与档案动作并排；仅档案态保留单个通栏按钮。
4. 「免费效果图」进入当前线索的交付方案册 `customer-ai-schemes`（无项目时扫码领取；尚未发布时进入同一方案册空态）；「免费家装设计顾问」复用共享设计顾问微信联系流程；「免费家装现场顾问」复用现有预约/改期/档案捷径。
5. 底部保障条为「三项服务不收费」与按真实阶段派生的状态。

路由、API、权限、排序、媒体与阶段派生合同均不变。

## 生产素材映射

已批准整页设计稿不切片、不打包。生产界面使用路由专属独立素材；当整页合成稿没有可直接提取的独立图层时，使用内置 ImageGen 生成专属生产切图，不再拿通用图标代替：

| 设计元素 | 生产素材 |
| --- | --- |
| 手持三张权益牌的小 K | `miniprogram/images/customer-service-three-free/xiao-k-three-benefits.png`（`560x473`、RGBA PNG、`201267` 字节；与批准源逐字节一致的主包副本） |
| 效果图权益 | `miniprogram/images/customer-service-three-free/effect-room.jpg`（`520x390`、RGB JPEG、`25193` 字节；生成的暖调客厅效果图） |
| 家装设计顾问权益 | `miniprogram/images/customer-service-three-free/design-advisor-3d.png`（`520x390`、RGBA PNG、`118662` 字节；生成的灯泡与对话气泡透明切图） |
| 家装现场顾问权益 | `miniprogram/images/customer-service-three-free/onsite-advisor-3d.png`（`520x390`、RGBA PNG、`134840` 字节；生成的定位标、底座和卷轴透明切图） |
| 权益卡箭头 | `miniprogram/images/customer-service-three-free/chevron-right.png`（`64x64`、RGBA PNG；Lucide `chevron-right` 白色栅格，用于绿圆控件） |

全部素材均在主包内且小于 `300KB`；不透明客厅图使用 JPEG，透明切图使用 PNG。权益卡、文案、绿色箭头圆、表面和阶段票据均为原生 WXML/Less。

## 设计源校准元素台账（`390x844`）

| 元素 | 运行目标 |
| --- | --- |
| 身份栏标题 | `32rpx` |
| Hero 权益标签 | `24rpx`，最小高度 `52rpx` |
| Hero 主标题 | `56rpx`，两行阅读块 |
| Hero 辅助文案 | `26rpx` |
| 阶段标题 / 摘要 / 轨道标签 | `32rpx` / `22rpx` / `22rpx` |
| 阶段动作 | `28rpx`，最小高度 `76rpx` |
| 无媒体阶段票据 | 文案与四步进度同排，操作按钮独占第二排 |
| 权益标题 / 说明 | `34rpx` / `24rpx`（`<=360px` 标题覆盖为 `32rpx`） |
| 权益图标舞台 / 可见图形 | `214x150rpx` / `96–104rpx` |
| 权益箭头 | `58rpx` 绿圆内 `44rpx` Lucide 白色 `chevron-right` PNG |

页面仍按内容固有高度排布并可滚动，不引入按视口增长的 flex 空洞。运行时视觉核验待用户提供包含微信原生胶囊的 `390x844` 截图和高屏阅读节奏截图后关闭。
