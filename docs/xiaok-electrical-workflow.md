# 水电专业 Agent 与工作流（I7.0）

`electrical-inspection-v1` revision 1，digest `7265f7a0ac6cab306e557820740bd486b93da3e82e8c8972da388dd2db801a60`。定义由 [specialist-template.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/native-workflow/specialist-template.ts) 的活动注册装配，使用现有 Node 执行器、Durable Task、PostgreSQL Runtime、WAIT_EVENT、Outbox、Construction 事项与原始 C01 回传，不建立第二套状态机。

## 节点图

```text
START (specialist_followup)
  ↓
PROJECT_DATA (read.specialist_project，含当前房间图纸)
  ↓
KNOWLEDGE_RETRIEVAL (read.specialist_knowledge，企业水电工艺)
  ↓
PUBLIC_WEB_SEARCH (read.specialist_public_standard，GB55020 给排水章节)
  ↓
AGENT (compose.stage_specialist.v3，electrical-specialist@1)
  ↓
EVIDENCE_ASSESSMENT (read.specialist_evidence)
  ↓
CONDITION (condition.specialist_evidence，evidencePolicy=any_evidence)
  ├─ 依据完整 → CHECKLIST → WAIT_EVENT
  ├─ 资料不足 → REQUEST_MATERIAL → WAIT_EVENT
  └─ 现场问题 → CREATE_ISSUE → HUMAN_REVIEW → OUTPUT
```

与防水模板的差异：

- `PROJECT_DATA` 额外读取当前项目、精确房间的最新共享图纸，输出 `drawings` 合同；旧 Run 没有该字段时保持原读取。
- `CONDITION` 使用 `any_evidence` 策略，同时读取 `hasEnterprise`、`hasPublic`、`hasDrawing` 和 `hasIssue`。图纸只有解析出明确要素时才计为可用依据；图片未 OCR 不算依据，进入补资料分支。
- `compose.stage_specialist.v3` 与 `read.specialist_evidence` 的 Agent、版本、Workflow revision/digest 独立绑定。
- 图纸要素在 `EVIDENCE_ASSESSMENT` 重新读取并核对 `drawingId/sourceHash/version`；读取后被替换或撤回的图纸不进入检查项。
- `save.specialist_issue.v2`、`wait.specialist_review` 与 `deliver.specialist_result` 继续使用既有 Construction 合同。

## 发布

模板已加入 `nativeWorkflowTemplateIds` 与后台“从模板新建草稿”选项。发布使用现有文件存储与不可变版本：

```powershell
cd admin
node tmp/i7.0/environment.mjs publish
```

输出记录在 `tmp/i7.0/electrical-definition.json`。发布顺序与防水一致：先发布模板，再按需编辑草稿并发布新 revision；已发布 revision 与 digest 不再修改。Agent 版本和 Workflow revision 分开升级，旧 Run 按启动时绑定恢复。

## 真实运行（K/L/M）

固定场景：业主在 C01 明确要求持续跟进厨房插座点位；施工人员提交同房间现场记录并上传照片；项目经理通过正式 Construction 服务复核；正式结果回到原始 C01。

| 步骤 | 真实结果 |
| --- | --- |
| 业主委托 | C01 回执“厨房 · 插座点位：已登记，等待核对当前资料”；委托绑定 `electrical-specialist@1` 与 Workflow revision 1 digest `7265f7…`。 |
| 专业分析 | Run 83 成功；Agent 读取项目、企业检索失败状态、当前房间图片图纸和 Construction 快照，输出检查清单素材。 |
| 依据分支 | 图片图纸未 OCR、企业检索不可用、公开标准不适用于插座 → `any_evidence=false`，进入 `REQUEST_MATERIAL`，等待现场资料。 |
| 施工记录 | 施工人员提交厨房记录 3（含照片），项目经理发布给业主；Workflow 接受该记录并创建事项 260。 |
| 经理复核 | 负责人回复、开始整改；施工人员用完成记录 4 提交落实；项目经理复核后由企业管理者正式解决（resolution 299，state=resolved）。 |
| C01 回传 | 消息 205（purpose=`construction.result`）返回公开节选“厨房插座点位已由项目经理现场复核，处理记录已存档；不代表工程整体验收或付款”。 |
| 四端一致 | 施工人员、项目经理、老板读取同一事项 revision 6，状态 `resolved`；内部结论未泄露给业主。 |

证据文件：`admin/tmp/i7.0/final/case-K2.json`、`delegation-K2.json`、`manager-review-K2.json`、`verify-result-K2.json`、`site-record.private.json`、`completion-record.private.json`。

## 幂等、恢复与权限

- 同一 Run 的重复 tick 不重复创建事项、复核或投递；K2 第二次 tick 返回 `completed` 且无新增业务写入。
- `wait.specialist_site_record` 只接受当前项目、精确房间、已发布给该业主且含有效原件的记录；`wait.specialist_review` 只接受当前有效复核事件。
- 施工人员、项目经理、企业管理者分别按现有 `constructionMembers` 与复核权限读取同一事实；撤销成员、撤权或来源撤回后旧结论停止沿用。
- Workflow revision/digest、Agent 版本、检查项来源版本均绑定在 Run；重进原会话重新核对当前成员、授权和原始消息。
- 失败或中断保留在途检查点与错误码；未知结果不自动重放。

## 当前限制

- `assistant_media` 只接受 PNG/JPEG，真实共享图纸路径为图片，不做 OCR；检查清单分支在真实运行中因图纸不可读进入补资料分支。PDF 解析、坐标和要素抽取由确定性测试覆盖。
- 已核对的公开标准只有 `GB55020-2021` 的给排水章节；强电/弱电公开条文未核实，回答如实说明。
- 企业托管 RAG 未配置，企业水电工艺持续 `retrieval_unavailable`。
- 真实工地照片、真机、真实微信登录、BLE 未验证。
- 普通咨询的图纸问句首次真实运行曾因引用载体/修复轮字面 `<think>` 失败；同一 Run 首稿已正确引用共享图纸，限制沿用 I6.18，不放宽引用校验。
