# 水电阶段专业 Agent（I7.0）

`electrical-specialist@1` 是继防水专业 Agent 之后第二个真正可运行的专业 Agent。它复用现有 `AgentModelGateway`、Responses API 适配层、Evidence、Knowledge Scope、Native Workflow、Construction 事项与人工复核，不新增模型网关、RAG、PDF Reader 或第二套状态机。防水 `waterproof-specialist@1` 仍为 Active，防水 V1.1 `@2` 仍为 Candidate，历史版本与已发布 Workflow 不变。

## 注册与范围

| 项 | 值 |
| --- | --- |
| agentId | `electrical-specialist` |
| 版本 | `1` |
| 状态 | `active`（离线校验通过后启用；阻断性领域失败时回退 candidate） |
| 名称 | 水电阶段专业 Agent |
| 平台阶段 | `utilities` |
| 阶段细分 | 水电施工准备、水电施工、水电隐蔽工程、水电检查及整改、水电阶段交付 |
| 知识范围 | enterprise、public_standard、project |
| 知识域 | strong_current、weak_current、water_supply、drainage、concealment |
| Workflow 模板 | `electrical-inspection-v1` |
| 公开标准 | `GB55020-2021`（仅已核对的给排水章节） |
| 工具权限 | knowledge、public_read、project_progress、photo、drawing、followup |
| 真实模型 | `bailian / deepseek-flash / deepseek-v4.1-flash-1017`，Responses API |

注册表位于 [registry.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/assistant/specialists/registry.ts)。水电与防水各自拥有独立的 `knowledgeDomains`、检查清单分类和 Workflow 模板；没有把防水知识 Scope 复制给水电 Agent。

## 专业知识分类

- 强电：配电箱及回路、照明回路、普通插座回路、厨房电器、空调等专用设备、开关插座点位、强弱电分区与交叉、接地保护。
- 弱电：网络、电视、无线设备位置、智能家居预留、弱电箱及线路、与强电点位协调。
- 给水：冷热水管路、用水设备接口、厨卫给水点位、走向、连接固定、水压试验资料。
- 排水：排水点位、走向、连接、坡度标高、地漏与排水接口、检查记录。
- 隐蔽工程：施工前图纸核对、现场记录、管线回路照片、试验记录、隐蔽前检查、整改复核、后续工序衔接。

分类只是能力范围，不代表已经取得企业施工标准。没有正式企业资料时，回答必须写明“本次未核实企业水电施工工艺”，不得把公开规范或通用做法写成公司规定。没有对应规范原文时，不编造线径、管径、间距、回路数量、压力、坡度、标高、测试时长或验收数值。涉及带电作业、配电箱内部操作、漏电接地等高风险施工时，不提供让业主自行操作的危险步骤，要求由具备相应资质和权限的专业人员现场处理。

## 回答与语义边界

- 企业做法只来自获权企业水电原文；公开条文只按所引原文的对象和条件解释。
- 图纸只代表设计内容，不等于现场已经安装完成；照片只支持可见现象，不等于工程测量或验收；模型推测不等于正式验收。
- 项目进度只来自本轮获权 Construction 记录；阶段节点不等于完工。
- 没有企业或公开原文时，仍先直接回答用户问到的点位、回路或管路，用模型常识给出标明“一般建议”的有条件做法，不能只写检索失败说明。
- 引用载体沿用现有 `final_response` 合同；不新增或放宽引用校验。
- 回答正文不复述“已登记跟进/已订阅/到时会通知你/一核对就告诉你”等承诺句式；跟进状态只写“本轮以服务端回执为准，核对结果由原会话回传”。

专业提示词与路由在 [consultation.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/assistant/specialists/consultation.ts)。

## 主 Agent 路由

`specialistDomain()` 先判断防水词（防水、闭水、蓄水、淋水、管根、阴阳角、涂膜、卷材、防水层、止水），命中即保持防水范围；否则判断水电词（水电、强电、弱电、插座、开关、配电箱、回路、照明、电线、线管、穿线、布线、网络点位、网线、电视点位、智能家居、接地、漏电、给水管、给排水、排水管、冷热水、水压、地漏、存水弯、点位图、电气图、给排水图、隐蔽工程）。`水管` 单独出现时不抢防水历史路由；`给水管/排水管/给排水/水电` 等明确词才进入水电。

- 普通问答直接回答，不强制创建工作流。
- 项目进度必须读取 Construction；阶段只作为当前节点，不作为完工。
- 图纸问题必须绑定当前项目图纸；`query_materials` 只在电气图纸问题且 `photo` 工具权限下提供。
- 房间更正后重新绑定房间；多个房间无法唯一确定时不猜房间。
- 水电与防水 Evidence 不混用；多个 Agent 都适用时由主 Agent 选择最合适的一个。
- 不允许模型自行创建正式业务 ID。

## 检查清单

检查清单由 `specialistChecks()` 从已保存、已校验的专业回答段落及服务端重验来源生成，并绑定：`checkId`、`projectId`、`roomId`、`stage`、`agentId`、`agentVersion`、`workflowRunId`、`workflowRevision`、`workflowDigest`、`drawingRefs`、`evidenceRefs`、`evidenceVersions`、`sourceType`、`applicability`、`currentProjectState`、`checkStatus`、`needsHumanReview`。

水电十二类：施工前图纸核对、强电点位、弱电点位、配电箱及回路、给水管路、排水管路、管线连接及固定、现场照片和施工记录、试验及检查依据、隐蔽工程前确认、整改及复核、后续工序衔接。

状态：企业标准明确、公开规范明确、项目记录支持、当前图纸支持、通用建议、资料缺失、不适用、待现场核实、待人工复核、已正式复核。没有 Construction 正式复核回执，不得标记为验收通过。图纸派生的检查项始终 `needsHumanReview: true`：有明确要素时为“当前图纸支持”，图纸存在不确定项时为“待现场核实”，并明确“图纸设计点位不代表现场已完成”。

## 图纸合同

统一图纸信息合同包含：`projectId`、`roomId`、`drawingId`、`drawingType`、`drawingVersion`、`revision`、`sourceHash`、`pageNumber`、`coordinateReference`、`extractedElements`、`uncertainty`、`verificationStatus`。

实现位于 [drawing.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/assistant/specialists/drawing.ts)：

- 只读取当前项目、精确房间最新一份未撤回的共享图纸授权；旧授权、跨房间、跨项目、撤回或替换后的图纸不可读。
- PDF 使用 `pdfjs-dist` 提取文本；每条识别结果保留页号与 `page:N:x:X:y:Y` 坐标，无法识别时标 `unknown`。
- 图片图纸当前不做 OCR，标 `verificationStatus: unreadable`，并写入“图片图纸未做文字识别，点位和尺寸需现场核实”。
- 图纸设计内容与现场已施工内容分开；模型不能把设计点位认定为实际安装完成。
- 需要精确测量时明确要求现场核实；图纸修改后重新读取并重新评估，旧要素不得冒充当前有效版。

当前产品 `assistant_media` 只接受 PNG/JPEG，因此真实共享图纸路径为图片，PDF 解析能力由确定性测试覆盖。企业公开标准只配置了 `GB55020-2021` 的给排水章节；强电/弱电公开条文本次未核实，回答必须如实说明。

## 现场照片

复用 [photo-analysis.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/assistant/specialists/photo-analysis.ts) 与现有图片授权链路。照片只描述可见线路、管线、点位、与已授权图纸的可辨认差异、需要补充的角度和无法确认的隐蔽信息。照片观察不等于工程测量，图纸设计不等于现场完成，模型推测不等于正式验收。没有真实照片时标记 `not_run`；合成图片不冒充真实工地验收。

## 版本与隔离

- Agent 版本与 Workflow 版本独立绑定；Run 启动时固定 `agentId/agentVersion/templateId/revision/digest`，旧 Run 不受新版本影响。
- 检查项只在 `isChecklistAgentVersion()` 命中的版本上写入 Workflow revision/digest；防水 V1 等其他历史版本继续按原合同读取。
- 水电与防水共享 Runtime，但知识域、检查分类、Workflow 模板和公开标准读取各自独立；防水任务不能被水电 Agent 读取。
- 普通知识咨询不会自动创建持续委托；只有业主明确授权后才进入 Workflow。

## 当前边界

- 企业托管 RAG 未配置，企业水电工艺检索返回 `retrieval_unavailable`，回答明确“本次未核实”。
- 强电/弱电公开规范原文未纳入已核对目录；`GB55020-2021` 仅用于给排水。
- 真实共享图纸为图片时不做 OCR；PDF 解析由确定性测试覆盖。
- 真实工地照片、真机、真实微信登录、BLE 未验证。
- 模型仍存在单段引用超限、字面 `<think>` 和供应商修复轮截断等 I6.18 已暴露限制；本轮不放宽校验来通过。

真实验收证据见 [水电工作流](xiaok-electrical-workflow.md) 与 `admin/tmp/i7.0/final/`。
