# 精艺智家（企业 3）四端验收测试账号

记录日期：2026-11-17（Asia/Shanghai）。分支 `codex/xiaok-integration`。环境为线上
`https://smartfloor.zlyun168.com`，企业为 **湖北精艺智家装饰工程有限公司（企业 ID 3）**，
唯一在建试点项目为 **项目 5「精艺智家云工地 · 澄光里108㎡」**（当前阶段 `utilities` 水电）。
本文件只记录测试员工账号和登录方式，不包含数据库连接串、服务器口令或其他生产密钥。

## 1. 登录入口

| 端 | 入口 | 说明 |
| --- | --- | --- |
| 小程序员工登录 | 小程序「我的 → 员工登录 → 账号密码」 | 页面路由 `packages/business/login/login?mode=password`，接口 `POST /api/auth/miniprogram`（`type=password`） |
| 后台 | `https://smartfloor.zlyun168.com/login` | 同一 `admin_users` 账号密码；老板（`enterprise_admin`）可进入企业管理，设计师和施工人员按菜单权限受限 |

## 2. 验收账号

| 端 | 姓名 / 显示名 | staffId | 登录账号 | 密码 | 角色 | 所属企业 | 项目角色 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 老板（企业负责人） | 杨超 | 9 | `13886667288` | `JingyiTest2026!` | `enterprise_admin` | 企业 3 | 项目 5 `manager`（项目经理） |
| 设计师 | 精艺智家简勇 | 10 | `wx_10_4eea0a637b30` | `JingyiTest2026!` | `designer` | 企业 3 | 项目 5 `designer` |
| 施工人员 | 精艺施工经理 | 31 | `staff_e3_jingyi_manager` | `JingyiTest2026!` | `construction_staff` | 企业 3 | 项目 5 `worker` |
| 工人 | 精艺水电工 | 32 | `staff_e3_jingyi_worker` | `JingyiTest2026!` | `construction_staff` | 企业 3 | 项目 5 `worker`，工作标签「水电」，工种「水电」 |

辅助身份与账号说明：

| 身份 | 说明 |
| --- | --- |
| 业主 高容海（用户 2，手机号 `15997671595`） | 使用微信手机号快捷登录，无密码；已绑定企业 3 与项目 5 的客户可见范围 |
| 施工经理账号 | staffId 31 同时承担施工人员端与现场施工经理职责，项目成员角色为 `worker` |
| 一线工人账号 | staffId 32 为带工种的一线工人（水电），用于施工人员端与「阶段分工」的普通工人场景；与 staffId 31 的区别是工作标签和工种，不是新角色 |

## 3. 凭据处理说明（如实记录）

- 老板（id 9）原密码哈希无已知明文，本轮按现有账号体系重置为上述测试密码：写入 bcrypt
  cost 10 哈希，并将 `must_change_password` 置为 `false`；未修改企业、角色、手机号、项目成员
  关系或其他字段。
- 设计师（id 10）原初始密码为 `123456`，登录后被 `must_change_password` 拦截（接口返回
  `construction_password_required`）。本轮通过小程序既有接口
  `PUT /api/miniprogram/account/password` 由账号本人完成改密为上述测试密码，未直接改库。
- 施工人员（id 31）原 `password_hash` 为空，无法密码登录；本轮重置密码，并补齐测试手机号
  `13907170031`（未验证的开发占位号，不可用于短信、拨号或真实微信手机号授权）。
  原因是 `app.construction_miniprogram_access()` 要求关联用户 `phone` 非空，否则返回
  `construction_forbidden`。
- 工人（id 32）于 2026-11-18 通过后台员工创建接口 `POST /api/staff` 新建：角色
  `construction_staff`、工种「水电」、测试手机号 `13907170032`（与 13907170031 同批的未验证
  开发占位号，不可用于短信、拨号或真实微信手机号授权）。创建时 `must_change_password`
  为 `true`，随后由账号本人经小程序 `PUT /api/miniprogram/account/password` 改为上述测试
  密码，未直接改库；再以管理员会话 `POST /api/construction/projects/5/member` 加入项目 5，
  角色 `worker`、`work_label=水电`，项目版本 2→3。验证：密码登录返回 `staffId=32`、
  `requiresPasswordChange=false`；项目列表仅项目 5、`my_role=worker`、`my_work_label=水电`；
  详情 `manage=false`、6 个房间；工地交流
  `GET /api/miniprogram/construction/projects/5/chat` 返回 200、`conversationId=25`。
  证据见 `tmp/worker-account-20261118/02-create.json`、`03-member.json`、`04-verify.json`。
- 2026-11-17 的三个账号在登录后均可读取项目 5，且 `my_role` 分别为 `manager`、`designer`、`worker`；
  证据见 `tmp/enterprise3-accounts/login-check.json` 与 `tmp/enterprise3-accounts/relogin-probe.mjs`
  的运行输出。
- 上述 2026-11-17 的改动只影响这三个测试员工账号；2026-11-18 新增的工人（id 32）只新增
  员工账号、项目 5 的成员关系与一条成员变更审计（项目版本 2→3）。两者均未修改业主、其他
  员工、报告、提醒或通知配置，未发送真实外部通知。

## 4. 使用注意

- 这四个账号用于企业 3 的试点验收与回归，不要用于真实客户沟通或对外演示以外的用途。
- 工人账号可在项目详情「阶段分工」中被分配到具体阶段；当前项目 5 各阶段尚未分配员工，
  属于项目数据现状，不是账号问题。
- 若后续需要恢复初始状态，按现有员工重置密码流程重新生成临时密码即可；不要删除账号或
  项目成员关系，否则会破坏已有报告、提醒和聊天归属。
- 设计师、施工人员、工人走小程序员工登录；老板既可走小程序员工登录，也可登录后台。
