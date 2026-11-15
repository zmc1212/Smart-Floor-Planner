# 家客来 1.0 I7.5.5 十阶段知识问答闭环验收

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`a593a9c6`（开始前 `git fetch origin`，本地与远端 HEAD 一致）
> 日期：`2026-11-16`（Asia/Shanghai）
> 结论：**阶段知识问答 `limited` 已解除**。十阶段普通知识问题全部通过正式 C01 对话入口确定性回答，未调用模型；未知阶段、多项目歧义、项目链接优先、客户/施工人员权限隔离、企业知识缺失标注与来源引用均通过；真实百炼 `deepseek-v4.1-flash-1017` 仅在项目事实问题调用，记录模型 ID、Token 与结果。

## 1. 验收环境

| 项 | 值 |
| --- | --- |
| 数据库 | 隔离 PostgreSQL 17，`127.0.0.1:55432/i745_f1_accept` |
| 业务账号 | `sfp_app`，`rolsuper=false`、`rolbypassrls=false` |
| 合成企业 | 每轮新建 `I7.5.5 十阶段知识问答合成企业-<时间戳>`，未连接微云 1454 |
| 真实 1454 | 未连接业务库、未修改配置、未执行迁移 |
| 真实通知 | 未发送微信/订阅消息 |
| 模型凭据 | 仅 `--llm-source=development` 时从开发库平台配置只读复制；验收结束在 `finally` 恢复隔离库原值，API Key 不输出 |
| 证据 | `tmp/xiaok-i755-stage-knowledge/run-4/result.json`（含 run-2、run-3 原始轮次） |

验收脚本：`admin/scripts/xiaok-i755-stage-knowledge-acceptance.ts`

```powershell
cd admin
npx tsx scripts/xiaok-i755-stage-knowledge-acceptance.ts --llm-source=development
```

## 2. 实现改动

| 文件 | 改动 |
| --- | --- |
| `admin/src/lib/xiaok-v1/stage-router.ts` | 新增 `isStageKnowledgeQuestion`：仅普通阶段知识意图进入知识包；进度、状态、待办、提醒、周报与深度专业问题保留原路由 |
| `admin/src/lib/xiaok-v1/stage-chat-service.ts` | 正式 C01 入口改为结构化项目解析（会话链接 → 客户绑定 → 唯一可访问项目）；多项目歧义与无项目明确澄清；企业知识可用时经既有 `retrieveKnowledge` 关键词模式读取并保留真实标题/原句 |
| `admin/src/lib/xiaok-v1/stage-answer.ts` | 新增 `unresolvedProjectAnswer`：无项目/多项目时明确停止，不猜测阶段 |
| `admin/src/lib/assistant/infrastructure/answer-worker.ts` | 将当前 run 的 actor 与 `knowledge_epoch` 传入阶段问答，用于企业知识授权读取 |
| `admin/src/lib/xiaok-v1/__tests__/stage-answer.test.ts` | 新增十阶段覆盖、意图边界、专业转交、企业知识缺失/引用、未知/歧义项目测试 |

复用既有阶段知识包、Stage Agent、防水/水电专业 Agent 与 C01 Worker，未新增重复问答实现，未降低事实、数值、完成声明和证据校验强度。

## 3. 检查结果

| 检查 | 状态 | 说明 |
| --- | --- | --- |
| `env.pg17_rls` | passed | 隔离 PG17 非超级用户，阶段问答相关核心表强制 RLS |
| `qa.ten_stage_c01` | passed | 十个装修阶段均通过 `appendMessage → newRun → claimJob → processAnswer` 正式链路回答；`purpose=construction.stage_knowledge`，正文含当前阶段名 |
| `qa.no_model_for_knowledge` | passed | 十轮普通知识问答无任何 provider attempt，Token 用量为 0 |
| `qa.unknown_stage_c01` | passed | 当前项目阶段为未知键时明确“阶段未知、不猜测”，索引阶段名不出现 |
| `qa.multi_project_ambiguity_c01` | passed | 同一业主两个在施项目且会话无链接时，列出两个项目名并请用户选择，不猜阶段 |
| `qa.project_link_precedence` | passed | 会话原有项目链接优先于多项目回退，回答使用链接项目的泥木阶段 |
| `qa.enterprise_knowledge_missing` | passed | 企业知识未配置时正文标注“本次未核实企业施工标准，以下为通用装修常识，不代表公司规定” |
| `qa.enterprise_knowledge_citations` | passed | 企业知识可用时保留真实来源标题与原句，不再降级为通用知识 |
| `qa.specialist_handoff_routing` | passed | “卫生间闭水试验要怎么做？”进入既有防水专业 Agent 路由，不借用阶段知识包 |
| `qa.permission_isolation` | passed | 非本人业主返回 `construction_not_found`；未加入项目的施工人员返回 `construction_forbidden` |
| `qa.real_model_turn` | passed | 仅项目事实问题调用真实百炼；记录模型 ID、Token 与结果 |
| `unified.knowledge_answer` | passed | 上述九项业务检查全部通过 |

## 4. 十阶段实际回答

十个阶段均使用各自知识包，回答包含阶段说明、常见问题或业主注意事项、下一阶段建议和边界；企业知识未配置时统一加通用知识声明。

| 阶段 | 当前阶段键 | 正式 C01 结果 | 模型调用 |
| --- | --- | --- | --- |
| 前期 | `preparation` | succeeded / `construction.stage_knowledge` | 0 |
| 设计 | `design` | succeeded / `construction.stage_knowledge` | 0 |
| 拆改 | `demolition` | succeeded / `construction.stage_knowledge` | 0 |
| 水电 | `utilities` | succeeded / `construction.stage_knowledge` | 0 |
| 泥木 | `masonry_carpentry` | succeeded / `construction.stage_knowledge` | 0 |
| 油漆 | `painting` | succeeded / `construction.stage_knowledge` | 0 |
| 安装 | `installation` | succeeded / `construction.stage_knowledge` | 0 |
| 软装 | `furnishing` | succeeded / `construction.stage_knowledge` | 0 |
| 完工 | `completion` | succeeded / `construction.stage_knowledge` | 0 |
| 入住 | `move_in` | succeeded / `construction.stage_knowledge` | 0 |

## 5. 真实模型记录

模型只在确实需要项目事实时调用；普通阶段知识问答不触发模型。

| 项 | 值 |
| --- | --- |
| runId | `198` |
| 问题 | “工地现在有照片或记录吗？”（项目事实，非阶段知识） |
| 模型 ID | `deepseek-v4.1-flash-1017`（2 次 attempt 均为该模型） |
| Token | 输入 5,871 / 输出 98 |
| 耗时 | 1,429 ms / 1,607 ms |
| 请求 ID | 供应商回执未返回；attempt 已记录 provider、模型、状态与耗时 |
| 结果 | succeeded，正文正确说明项目进行中、当前节点泥木、联系电话待补充 |
| Mock | 未使用 |

## 6. limited 是否真正解除

**阶段知识问答的 limited 已解除。** 依据：

1. 十个装修阶段的普通知识问题均通过正式 C01 对话入口回答，不再依赖模型与企业知识库配置。
2. 之前被 `ungrounded_response_scope` 拒绝的根因是“无企业知识来源时让模型回答通用阶段知识”；现在普通阶段知识不进入模型，因此该拒绝不再发生在知识问答链路上。
3. 未降低既有校验强度：完成声明、数值参数、企业规定、证据与权限校验保持原样；专业问题仍走既有专业 Agent。
4. 未知阶段不猜测，多项目不猜测，企业知识缺失明确标注，企业知识存在保留真实引用。

仍然保留的边界（不计入阶段知识问答 limited）：

- 企业知识的数据库级发布、索引与引用读取本次使用注入来源验证；隔离库没有真实企业知识文档与 pgvector 环境，未跑完整企业知识库发布链路。
- 项目状态、进度、待办、照片等事实问题继续走既有 Agent/模型路由；本次只验证“确实需要时才调用”，未改变既有事实问答的产品合同。
- 真实 1454 环境仍为 `not_run`：未连接业务库、未执行迁移、未部署生产。

## 7. 代码与定向测试

```powershell
cd admin
npx tsc --noEmit
npx eslint src/lib/xiaok-v1/stage-chat-service.ts src/lib/xiaok-v1/stage-answer.ts `
  src/lib/xiaok-v1/stage-router.ts src/lib/xiaok-v1/__tests__/stage-answer.test.ts `
  scripts/xiaok-i755-stage-knowledge-acceptance.ts src/lib/assistant/infrastructure/answer-worker.ts
npx tsx --test src/lib/xiaok-v1/__tests__/stage-answer.test.ts
```

结果：TypeScript 通过；定向 ESLint 通过；`stage-answer.test.ts` 12 passed / 0 failed；隔离 PG17 验收 12 passed / 0 failed（`run-4`）。
