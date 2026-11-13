# 防水专业 Agent 第一版交付冻结（I6.12）

分支 `codex/xiaok-integration`，基线 `eb0fa3da0eba`，本阶段代码提交 `b37e24f6`。仅冻结本文件列出的能力；未通过真实业务验收的能力保持 `limited`、`draft` 或 `not_run`。

## 1. 冻结标识

| 项 | 冻结值 |
| --- | --- |
| Agent ID | `waterproof-specialist` |
| Agent Version | `1`（`active`，唯一活动版本） |
| 输入 Schema | `stage-specialist-input-v1` |
| 输出 Schema | `stage-specialist-output-v1` |
| Knowledge Scope | `enterprise` / `public_standard` / `project`；工作流节点 `authorized, topK=3` |
| Tool Permissions | `knowledge` / `public_read` / `project_progress` / `photo` / `followup` |
| 工作流模板 | `waterproof-inspection-v1` |
| 已发布版本 | `rev1 a34557dba7adee7f13a42822ab5c86dc041f08af0cee018c130ca4d369416100`（有据清单）；`rev3 44f15a212dbff19cf9ab2cdd2f02029660f3def8d9fe30d4ac2d7bbacc65059d`（补资料与直达事项） |
| 模型 | `bailian` / `deepseek-flash` / `deepseek-v4.1-flash-1017`，Responses 优先 |
| 图片协议 | `conversation-images-v1`，`final_response` 保持 `kind`/`text` |

节点版本：`trigger@1`、`project_data@1`、`knowledge_retrieval@1`、`public_search@1`、`agent@3`、`evidence_assessment@1`、`condition@1`、`checklist@1`、`request_material@1`、`create_issue@2`、`wait_event@2`、`human_review@1`、`output@1`。已发布版本不可变，新 Run 绑定启动时的 revision、digest 和节点版本。

## 2. 已交付能力（released）

| 能力 | 状态 | 依据 |
| --- | --- | --- |
| 防水专业问答（标准条件、专业解释、企业规定、项目事实、正式结论分离） | released | 固定 A–L 场景中 A、C、D、E、F、I、J、L 保存；语义守卫拒绝越界稿。见 `admin/tmp/i6.12/dialogue-03/`。 |
| 企业工艺与公开规范分别引用 | released | 企业 PPT 第 18 页、住建部公告与规范原件；公开 PDF 原件 SHA-256 与页文核对。 |
| 有据检查清单 → 现场等待 → 事项 → 经理复核 → 回传 C01 | released | 路径 A：C01 `24`、事项 `190`、Run `specialist:f2c85065-a031-4da4-98cc-8d203a8ddbeb`、revision 1。 |
| 资料不足分支 | released | 路径 B：C01 `27`、revision 3、`request_material`，缺少企业条款与同房间现场记录。 |
| 直接整改分支 | released | 路径 C：C01 `29`、事项 `233`、复核结果消息 `154`，同业主另一咨询无结果。 |
| 重复事件、错房间、非经理复核、取消跟进 | released | 路径 A 的重复 tick、厨房记录、施工员/非项目人员复核拒绝；路径 C 取消后委托 `cancelled`。 |
| 业主 C01 退出重进 | released | Stable 390×844，C01 `24` 重进仍见同一复核结果。 |
| 施工端、老板端同源业务状态 | released | Stable 项目 `10`：施工端读到管根事项，老板端读到复核结果；设计师端 0 个项目，未被强制参与。 |
| 施工端在 Stable UI 重新提交照片/记录、业主再次切换持续跟进授权 | limited | 服务端与 HTTP 提交/授权链路在 I6.12 通过；I6.13 施工端 Stable 提交因事项 `190` 已 `resolved`、无待补资料事项而 `not_run`，业主 Stable 再切换授权本轮 `not_run`。 |
| 照片观察信封（服务端结构化） | limited | 合成获权图 Run `8` 解析成功；真实工地照片 `not_run`。 |
| 公开规范原件稳定读取 | released | I6.13 生成真实 PDF 页引用 `w:99:1`（Run `99`，PDF 第27页，原件 SHA-256 `aabd71…`），Stable 业主会话 `70` 点击、退出重进再次点击，标题/页码/原文/Hash 一致；Reader 超时分类 `source_unreadable`、410 撤回分类 `source_withdrawn`。证据 `admin/tmp/i6.13/stable-pdf/`、`tmp/i6.13/pdf-reader.json`。 |

## 3. 图片分析合同（I6.12.2）

- 保持已真实验证的 `final_response` `kind`/`text` 工具合同，不扩大工具 Schema。
- 首轮由系统提示要求正文末尾输出七节固定文本；服务端 `parsePhotoObservationText` 解析。解析失败时保留原正文，Run 步骤 `agent_photo_analysis` 记为 `failed`。
- 第二轮为独立文本归一化调用（`jsonOutput`，同一网关、同一模型），只接收已保存正文，不重发图片；结果经 `parseSpecialistPhotoAnalysis` 严格 Schema 与语义校验。成功时步骤记 `succeeded`，并保存 `source=json_normalizer`、请求 ID、模型与用量。
- 图片观察字段不得出现验收、放行、合格、试验通过或精确施工量数；存在可能问题时必须人工复核并列出补充证据。
- 真实回执：图片轮 `7137305c-4075-9e54-88ef-5af2c440c974`（2155/786，缓存 1536），归一化轮 `8692e3d3-5965-956f-b5d9-f3177bd25d4f`（682/723）。均实际 `deepseek-v4.1-flash-1017`。
- 一次归一化调用在超时后状态为 `unknown`（Run 7），未重放，保留原记录。

## 4. 固定问答结果（I6.12.4）

固定配置：`bailian`、`deepseek-flash`、`deepseek-v4.1-flash-1017`、Responses 优先、`openserp`/Baidu 检索、隔离 PG17 `xiaok_r6_model_i612`。

| 场景 | 结果 | 说明 |
| --- | --- | --- |
| A 卫生间施工前注意 | passed | 企业工艺与公开依据分开，保存 1 条公开引用。 |
| B 管根为什么单独处理 | passed（I6.13） | Run `83`：区分规范原文、一般专业解释与项目缺项，2 条公开引用；复核合同承认服务端“一般建议”标签。 |
| C 基层进入防水条件 | passed | 引用规范页条件，未称本户已验收。 |
| D 完成后下一道工序 | passed | 未给统一天数。 |
| E 企业防水标准 | passed | 企业 PPT 第 18 页，未编企业量数。 |
| F 企业标准与公开规范区别 | passed | 两类依据分列。 |
| G 标准现行性 | limited（I6.13） | 根因依次为数字不在本段引用、状态结论与公告同段、`现行状态/记录` 被误判。已加精确数字/状态修复诊断与守卫豁免；Run `97` 仍失败保留，同一修复稿确定性通过，受两次试验预算未再调模型。 |
| H1/H2 厨房更正卫生间 | passed（I6.13） | 会话 `61` 五轮：厨房记录、卫生间更正、管根解释、处理条件、主卧记录分别读取；未用厨房 Evidence 支持卫生间。 |
| I 主卧实际进度 | passed | 读取主卧已发布记录，未把计划当完成。 |
| J 企业未写闭水时长 | passed | 明确企业缺项与核实路径。 |
| K 照片观察 | limited | 合成获权图保存可见现象；真实工地照片 `not_run`。 |
| L 当前项目检查清单 | passed | 绑定项目与来源，未产生「已正式复核」。 |

更早两批保留：第一批 `web_search_unconfigured` 环境失败；第二批搜索可用后 A–D/H 仍因检索与终稿守卫失败。未重放 unknown 调用。

## 5. 工作流与四端（I6.12.5–6）

- 路径 A：有据清单，C01 `24`、Run `specialist:f2c85065-a031-4da4-98cc-8d203a8ddbeb`、revision 1、digest `a34557…`、事项 `190`、经理复核、C01 结果；重复 tick 不新增事项，错房间记录不触发，施工员与非项目人员不能复核。
- 路径 B：资料不足，C01 `27`、revision 3、digest `44f15a…`、`request_material`，等待 `site_record`，缺少企业条款与同房间已发布记录。
- 路径 C：直达整改，C01 `29`、事项 `233`、revision 3、结果消息 `154`，同业主另一咨询无结果；Run 完成后绑定 digest 不变。
- 取消：C01 `33`，委托状态 `cancelled`，等待任务不继续。
- Stable：DevTools `390×844`、基础库 `3.5.8`；业主 C01 `24` 结果与重进通过；施工端项目 `10` 读到管根事项；老板端读到复核结果；设计师端 0 个项目。截图与 `verification.json` 在 `admin/tmp/i6.12/stable-04/`。施工端在 Stable UI 重新提交照片/记录、业主再次切换持续跟进授权本轮未重跑，标 `limited`（服务/HTTP 证据见路径 A/B/C）。
- 真机、BLE、真实微信登录未执行：`not_run`。

## 6. 公开原件（I6.12.3）

- 已保存引用 `w:40:0` 可重开，HTML 快照 Hash `c57f9f01…` 稳定；HTML 快照不触发 Reader 重读。
- Reader 故障分类：`web_timeout`、`web_http_410`、`web_http_412`、`web_http_403` 均按原错误码返回；恢复 Reader 后同一引用再次可用。
- 防水 PDF 原件 SHA-256 `aabd71d70809673a4009fcdbcfc0c759f3a22b1c3566f8022dfea9a7a529dc80`，与 I6.10 一致；本轮可复核页 `[5,27,28,31]`，`36/37` 未出现在本轮已核页集合，标记 `limited`。
- 页文被改写后 `publicDocumentPages` 拒绝为原文证据；重读同一 URL 得到同一 SHA-256。
- I6.12 未能保存一条 PDF 页引用（标准原文引用终稿被 `unsupported_model_commitment` 拒绝）。I6.13 已补齐：Run `99` 的 `w:99:1` 为真实 PDF 第 27 页引用，Stable 会话 `70` 点击、退出重进通过；见第 12 节。

## 7. 模型用量

- 隔离库 `xiaok_r6_model_i612` 共 143 次供应商尝试，143 次实际 `deepseek-v4.1-flash-1017`；观察用量 363,328 输入 / 30,347 输出 tokens，缓存输入按各回执；金额未返回。
- 1 次 `unknown`：照片归一化调用超时（Run 7），未重放。
- 所有请求保存 provider、实际模型、协议、请求 ID、用量和结果；未保存 API Key 或图片访问凭证。
- 历史 I6.11 的 20 次调用与失败保持原记录，不计入本轮通过。

## 8. 不支持与生产限制

- 不支持仅凭照片宣布防水合格、放行、闭水试验通过或给出精确施工量数。
- 不支持无原文依据的规范条件、企业条款或项目完成断言；守卫拒绝时返回明确错误码，不自动改写为通过。
- 不支持真实工地照片验收（无合法真实照片）；不支持真机、BLE、真实微信登录。
- 不支持托管 RAG（缺专用工作空间与凭据，仍为 `retrieval_unavailable`）。
- 生产默认模型、生产部署、真实客户写入未改变；生产调度保持关闭。

## 9. 历史版本兼容

- 已发布工作流版本不可变；旧 Run 按启动时的 revision、digest 与节点版本恢复，发布新版本只影响后续委托。
- 历史清单按原 Run/版本保留；来源撤回或房间变化后由后续运行重新评估，不删除历史失败与 `unknown`。
- 旧回复缺少结构化信封时保留原正文；照片步骤明确标记 `failed`，不补造信封。

## 10. 复制到其他专业 Agent

1. 在 `specialists/registry.ts` 注册新 `agentId`、阶段、意图、知识范围、工具权限、模板 ID 和公开规范 ID，先置 `draft`。
2. 复用 `createSpecialistInspectionDefinition(agent)`，只替换 Agent 标识、阶段、知识范围与公开规范；节点、端口、条件与回传合同保持。
3. 复用现有 `KnowledgeRetriever`、Evidence、Construction 事项、Durable Task、Outbox、人工复核与投递；不新建事实库或第二套网关。
4. 为新阶段补充固定问答、路径 A/B/C、四端和照片/PDF 证据，通过后再置 `active`；未通过的阶段保持 `draft`。
5. 水电、泥木、油漆、安装、竣工本轮未开发，保持 `draft`。

## 11. 证据索引

| 内容 | 路径 |
| --- | --- |
| 百炼目录与结构化探针 | `tmp/i6.12/bailian-capability.json`、`photo-structured-probe.json` |
| 照片观察 | `tmp/i6.12/photo-01/`、`tmp/i6.12/photo-structured-probe.json` |
| 固定问答 | `tmp/i6.12/dialogue-01/`、`dialogue-02/`、`dialogue-03/` |
| 工作流 A/B/C/取消 | `tmp/i6.12/workflow-a/`、`workflow-b/`、`workflow-c/`、`workflow-cancel/` |
| PDF 与引用稳定性 | `tmp/i6.12/pdf-read-02.json` |
| 四端 Stable | `admin/tmp/i6.12/stable-04/verification.json` 及截图 |
| I6.13 固定问答 | `tmp/i6.13/dialogue/`、`dialogue-02/`、`dialogue-03/` |
| I6.13 PDF 页引用 | `tmp/i6.13/pdf-cite/result.json`、`tmp/i6.13/pdf-reader.json` |
| I6.13 Stable PDF 点击/重进 | `admin/tmp/i6.13/stable-pdf/verification.json` 及 `01-chat.png`、`02-citation.png`、`03-reentry.png` |
| 隔离库 | `sfp-xiaok-i67-test` / `xiaok_r6_model_i612`，PG17 |

## 12. I6.13 复核增量

- 代码提交 `9156e9a0`：知识解释的 `unsupported_model_commitment` / `standard_status_unverified` 修复反馈现在精确到段号、缺失数字/量数与同轮 citationId 候选；状态守卫不再把“现行状态/情况/结论/信息/记录”当作现行断言；语义复核承认服务端 `advice` 的“一般建议”标识。
- B：Run `83` passed；H：会话 `61` 五轮 passed；G：Run `84`/`91`/`97` 的失败链保留，修复稿确定性通过，因两次真实试验预算标 `limited`。
- PDF：Run `99` 生成 `w:99:1`，Stable 会话 `70` 点击与退出重进通过；Reader 超时/撤回分类通过。任务书要求的 3.5.8 基础库本轮实际为 DevTools `3.17.2`，未改项目基础库。
- 施工端 Stable 重新提交：`not_run`（事项 `190` 已 `resolved`，无待补资料事项；项目未发布进度计划，`quickRooms` 为空）。业主 Stable 再切换持续跟进：`not_run`。真实工地照片：`not_run`。四端完整旅程本轮 `limited`，I6.12 同源读取仍为 passed。
- V1 Agent 标识、版本、工作流、digest、节点版本、Schema、权限与事项/复核/回传合同未修改；旧 Run 继续绑定原 revision/digest。
- 回归：知识解释/公开研究/综合守卫 65/65、Specialist 20/20、Construction 108/108、Native Workflow 477/504（27 skipped）、Assistant 1063/1069（6 个历史失败）、小程序 2242/2245（2 个范围外未提交改动 + 1 个历史测绘基线）、TypeScript/ESLint/生产构建通过。
