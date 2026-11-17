# 企业 3 设计师 / 老板 / 施工人员三端页面验收（2026-11-17）

本轮补齐企业 3（湖北精艺智家装饰工程有限公司）员工三端的真实页面验收。测试账号见
`docs/xiaok-enterprise3-test-accounts.md`。验收在微信开发者工具中连接线上环境
`https://smartfloor.zlyun168.com` 完成，固定视口 **390×844**（`wx.getSystemInfoSync()`
返回 `windowWidth=390`、`windowHeight=844`），操作方式为真实页面输入、点击和滚动，未使用
服务层调用冒充页面验收。

## 1. 结论汇总

| 端 | 账号 | 登录 | 项目列表 | 项目详情 | 角色专属流程 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 老板（企业负责人 / 项目经理） | `13886667288` | passed | passed | passed | passed（工地管理面板、项目简报） | passed |
| 设计师 | `wx_10_4eea0a637b30` | passed | passed | passed | failed（点位与图纸 → 工地交流 404） | limited |
| 施工人员 | `staff_e3_jingyi_manager` | passed | passed | passed | failed（进入工地交流 404；阶段分工面板 passed） | limited |

三端均能登录、看到同一项目「精艺智家云工地 · 澄光里108㎡」（项目 5，当前阶段「水电」，
6 个房间），页面身份分别为 `项目经理`、`设计协作`、`施工师傅`，角色隔离在页面入口和数据
上均成立：老板有「工地管理」，设计师有按房间的「查看点位与图纸」，施工人员有「阶段分工」
和「查看工地成员」；设计师与施工人员的详情页 `manage=false`，不显示管理入口。

## 2. 老板端（passed）

真实操作路径：员工登录页输入账号密码 → 首页 → 云工地项目列表 → 点击项目卡片 → 项目详情
→ 点击「工地管理」→ 顶栏「项目简报」。

- 项目列表：1 个项目，角色标签「项目经理」，与数据库 `construction_members.role=manager` 一致。
- 项目详情：显示当前阶段「水电」、进度说明、6 个房间、阶段提醒「阶段已更新 / 已送达 · 未读」；
  进度计划为「未排期 / 资料缺口：尚未发布施工进度计划」，与接口返回一致。
- 工地管理面板：`sheet=manage`，`sheetOpen=true`。
- 项目简报页：1 个项目，待处理 0、已解决 0，生成时间「11月17日 11:59」，正文包含阶段与
  现场记录摘要，未出现内部问题泄露。
- 截图：`tmp/enterprise3-accounts/screens/boss-01-login.png`、`boss-02-landing.png`、
  `boss-03b-projects.png`、`boss-04b-detail.png`、`boss-05b-manage-sheet.png`、`boss-06b-brief.png`。

## 3. 设计师端（limited）

真实操作路径：员工登录 → 首页 → 云工地项目列表 → 项目详情 → 点击房间行「查看点位与图纸」。

- 登录、列表、详情 passed：角色标签「设计协作」，6 个房间均显示「查看点位与图纸」。
- 点位与图纸 failed：点击后进入 `packages/construction/chat/chat`，页面显示
  「工地或原材料已不可访问。」，点击「重新读取」后结果相同。
- 截图：`designer-01-login.png`、`designer-02-landing.png`、`designer-03b-projects.png`、
  `designer-04b-detail.png`、`designer-05b-point-plan.png`、`designer-05c-point-plan-retry.png`。

## 4. 施工人员端（limited）

真实操作路径：员工登录 → 首页 → 云工地项目列表 → 项目详情 → 滚动后点击「阶段分工」
→ 关闭面板 → 点击「进入工地交流」。

- 登录、列表、详情 passed：角色标签「施工师傅」，工作标签「施工经理」。
- 阶段分工 passed：面板显示 10 个阶段（前期、设计、拆改、水电、泥木、油漆、安装、软装、
  完工、入住）和 3 名成员（杨超、精艺智家简勇、精艺施工经理）；各阶段当前显示「待分配员工」，
  属于当前项目数据状态，不是页面错误。
- 工地交流 failed：与设计师端相同的 404 提示。
- 截图：`worker-01-login.png`、`worker-02-landing.png`、`worker-03b-projects.png`、
  `worker-04b-detail.png`、`worker-05b-member-sheet.png`、`worker-06b-site-chat.png`。

## 5. 失败项：工地交流 404（可复现路径与根因）

复现路径：任一端登录后进入项目 5 → 点击「进入工地交流」或房间「查看点位与图纸」→ 页面顶部
显示「工地或原材料已不可访问。」。

接口复现（三端同一结果）：

```
GET /api/miniprogram/construction/projects/5/chat?limit=30
Authorization: Bearer <任意一个上述员工 token>
→ 404 {"success":false,"error":"assistant_resource_not_found"}
```

根因（数据库只读核对）：

- `app.construction_chats` 中项目 5 的记录指向 `conversation_id=16`；
- 会话 16 的 `purpose` 是 `construction_followup`，而工地交流读取要求
  `purpose='project_collaboration'`（`site-chat.ts` 的 `AssistantRepository.conversation`），
  因此所有项目成员都被判定为「资源不存在」；
- 该会话同时承载了施工记录、阶段提醒和 4 条报告事实消息（`construction.report.facts`），
  且 `construction_site_records` 有 2 条记录通过外键引用 `(enterprise_id=3, project_id=5,
  conversation_id=16)`，直接删除或改绑会话会被外键阻止，并可能影响既有报告的读取与投递链路。

处理建议：为项目 5 建立独立的 `project_collaboration` 会话并把 `construction_chats` 与新会话
关联，同时把 2 条历史施工记录的会话外键迁移到新会话（或保留旧会话作为报告历史、仅新建交流
会话），需要产品与数据迁移确认后再执行。本轮验收未做该数据迁移，避免破坏既有报告与提醒
历史的关联，因此该项如实记为 failed/limited。

## 6. 说明与边界

- 为连接线上数据，验收期间临时把 `miniprogram/utils/api.js` 的 `ACTIVE_API_ENVIRONMENT`
  切到 `production`，验收结束后已恢复为 `local`，未提交该文件。
- 本轮只验证页面流程、接口结果、数据库归属和角色隔离；AI 回答质量、微信真机、真实语音和
  图片上传未验证，记为 `not_run`，不把接口或 DOM 检查视为真机通过。
- 项目当前没有待处理问题、已发布进度计划和已审批方案，相关区块显示 0 / 未排期 / 资料缺口，
  属于真实数据状态，未为验收造数据。
- 结构化运行结果：`tmp/enterprise3-accounts/page-acceptance.json`、
  `tmp/enterprise3-accounts/page-acceptance-2.json`；接口与账号核验：
  `tmp/enterprise3-accounts/login-check.json`、`relogin-probe.mjs` 输出。
