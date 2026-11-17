# 家属云工地一期真实验收报告

日期：2026-11-17
工作区分支：`codex/xiaok-integration`
范围：家属只读进度 + 只看直播摄像头 + 一次性分享卡片授权 + 放宽家属账号企业限制

## 结论

**服务端真实 HTTP + 真实 PostgreSQL 验收到通过（34/34）。** 使用本地开发数据库中的独立合成企业/项目/用户，启动真实 Next.js 开发服务，通过真实接口和签名小程序令牌完成授权、进度、摄像头会话、直播限制、撤销和幂等检查。验收后夹具已全部清理。

小程序真机/开发者工具验收 **not_run**：开发者工具 CLI 服务端口未开启，无法在无人值守模式下启动自动化；本轮客户端证据为页面级测试 3/3。

## 环境与安全边界

- 数据库：`localhost:5432/smart_floor_planner`，PostgreSQL 17.10，本地开发库。
- 使用唯一前缀的合成企业、3 个客户账号、1 个意向/工地、1 个摄像头及绑定；未读写企业 1454 的真实业务数据。
- 真实服务：`http://127.0.0.1:3006`，仅启动 Next.js，不启动 Assistant Worker，不发送任何真实通知。
- 摄像头上游：本地 39999 端口假网关，只统计是否被调用；未连接真实 WVP/摄像头。
- 验收结束后核对：企业、项目、用户、线索、outbox、幂等记录、摄像头、绑定、授权、会话、entry 计数均为 0。

## 结果明细

| 类别 | 检查 | 结果 |
| --- | --- | --- |
| 列表 | 业主可见项目；家属授权前不可见；无关客户不可见 | passed |
| 邀请 | 业主生成签名卡片；无关客户不能生成 | passed |
| 接受 | 家属接受卡片后获得 `family_view` | passed |
| 单次使用 | 另一账号复用同一卡片返回 409 `family_invite_used` | passed |
| 进度 | 家属返回 `family_view` 且不含 `issues`；业主返回 `owner` 且含 `issues` | passed |
| 家属管理 | 业主可看到家属列表；家属不能管理家属 | passed |
| 摄像头列表 | 家属 `liveOnly=true`、`canCapture=false`、`canControl=false`、`canViewSnapshots=false`；业主保持完整能力 | passed |
| 摄像头入口 | 家属和业主均可取得 entry | passed |
| 摄像头会话 | 家属和业主均可 exchange 并读取 state | passed |
| 回放限制 | 家属回放查询 403 `camera_forbidden`；业主回放查询 200 | passed |
| 抓拍限制 | 家属抓拍 403，且假网关收到 0 次请求 | passed |
| 云台限制 | 家属云台 403，且假网关收到 0 次请求 | passed |
| 撤销 | 业主撤销成功；家属进度/列表/摄像头入口 404；现有摄像头会话 401 | passed |
| 撤销后卡片 | 已消费卡片不能重新授权（409） | passed |
| 撤销后列表 | 业主家属列表为空 | passed |
| 独立性 | 无关客户始终不能读取进度 | passed |

## 客户端与静态检查

- 家属页面测试：3/3 通过（路由权限、业主加载进度/摄像头/分享卡片、家属接受卡片）。
- 邀请签名测试：2/2 通过（签名往返、篡改/错误受众拒绝）。
- 小程序全量测试：2263/2266 通过。剩余 3 项与本功能无关：`ai-design-tab` 两项和 `survey-kernel-phase0-baseline` 一项；这三项在改动前即存在/由其他工作区改动引起，本轮未修改对应页面、Tab 或测绘内核。
- 受本轮改动影响的样式与分包清单测试：16/16 通过（家属页样式使用 `.less`，分包清单包含 `family/family`）。
- `npx tsc --noEmit -p tsconfig.json`：通过。
- 定向 ESLint：通过。

## 验收中发现并修复的问题

**家属账号跨企业时被 `users` 表 FORCE RLS 拦住。** 家属账号按设计可以不属于项目企业，`users.enterprise_id` 可能为空或指向其他企业，原租户事务内查询不到该用户，导致接受邀请返回 404。已增加只读的用户身份平台作用域读取，并在查询后立即恢复租户作用域；只读取指定用户 ID，不扩大业务查询范围。

**家属页样式违反仓库 Less 约定。** 新增页面最初使用 `.wxss`，被 `style-utilities` 测试拦截；已改为 `family.less`，与现有页面一致。分包清单测试同步加入 `family/family` 页面。

## 未覆盖 / 限制

- **真机 / 微信开发者工具：not_run。** 开发者工具 CLI 服务端口关闭，开启需要 GUI 安全设置；无真实微信登录态。
- **真实摄像头直播流：not_run。** 没有 WVP/真实摄像头设备，只验证了 entry、exchange、state 和权限拒绝；未验证实际 HLS/FLV 解码。
- **完整进度计划：limited。** 合成项目没有发布施工计划，验证了 `family_view` 访问和响应隔离，但未渲染真实节点/颜色。
- **多家属同时加入：limited。** 卡片为一次性，每张卡片对应一位家人；本轮只验证了一位家属，未验证同一业主生成多张卡片后的并发接受。

## 证据与文件

- 验收报告 JSON：`admin/tmp/family-camera-acceptance-2026-11-17T05-57-26-235Z/report.json`
- 可重复脚本：`admin/scripts/family-camera-acceptance.mjs`
- 授权服务：[family-progress.ts](../admin/src/lib/construction/family-progress.ts)
- 摄像头鉴权：[access.ts](../admin/src/lib/construction/camera/access.ts)
- 家属页面：[family.js](../miniprogram/packages/construction/family/family.js)
- 页面测试：[construction-family.test.js](../miniprogram/test/construction-family.test.js)
