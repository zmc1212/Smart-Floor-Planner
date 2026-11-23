# 小K后台阶段 Agent 与工作流编排交互设计

**已获准用于正式开发的交互稿 · 2026-11-23。** 在浏览器打开 HTML，从微云的水电阶段进入。已打开上一版的标签页可以直接刷新。每个阶段的配置保存在本机浏览器，调试使用固定对话示例。[打开样稿](../../design-references/xiaok-agent-studio-20261123/index.html) · [应用配置](../../design-references/xiaok-agent-studio-20261123/01-agent.png) · [对话体验](../../design-references/xiaok-agent-studio-20261123/03-chat-experience.png) · [工作流画布](../../design-references/xiaok-agent-studio-20261123/02-workflow.png)

## 创建和调试阶段 Agent

现有入口为 `/assistant-knowledge?tab=stage-agents`。原有表单把基本资料、模板版本和问题卡集中在弹窗中，首屏之外才有保存操作。这次以用户提供的 FastGPT 小K对照应用、两张截图与官方编辑器源码为参照，沿用家客来的绿色、现有阶段权限和已发布模板版本。[现有阶段表单](../../admin/src/components/assistant/stage-agent-manager.tsx) · [原有表单截图](../../tmp/stage-agent-workflows-20261123/ui-2a6719f9/01-agent-form.png) · [FastGPT 应用配置源码](https://github.com/labring/FastGPT/blob/5b88c2e63c3a0f6cec86fc19f2e96f1355de531a/projects/app/src/pageComponents/app/detail/Edit/ChatAgent/EditForm.tsx)

- 顶部阶段选择器列出十个阶段及其配置状态。从应用资料卡右上角可编辑名称、职责和启用状态。顶部固定显示保存操作与修改状态。阶段应用可单独创建，也可在「工作流」区关联多个已发布模板并选择默认项。
- 左栏独立滚动。「AI 配置」「工具与知识」「对话体验」「工作流」直接定位对应设置。右栏保留完整聊天记录和底部输入框。窄屏提供「配置面板」「调试预览」切换，草稿和当前轮次均可保留。
- 模型和参数、系统提示词、工具、知识库范围与检索方式均可在草稿中调整。提示词支持输入 `/` 或通过按钮插入变量。调试区可选择本机附件并查看文件名。虚拟机、语音输入显示当前接入状态。样稿的模型、工具和检索参数只参与配置回读，聊天回答取自本机示例。
- 「发布渠道」展示本机已保存版本对应的小程序阶段入口。「对话日志」能查看当前标签页内各阶段的调试对话。「编辑历史」记录阶段配置的本机保存版本。企业管理员可选用已发布模板，平台管理员可进入模板画布。

## 三项对话设置

| 设置 | 管理员操作 | 在右侧调试的结果 |
| --- | --- | --- |
| 对话开场白 | 直接编辑欢迎语，可插入 `{{施工阶段}}` 或自定义变量。添加、编辑、上移、移除最多三张预设问题卡。 | 空会话立即显示展开后的欢迎语。卡片显示完整问法，点选即发送。自定义卡位不满三个时沿用小K当前阶段的系统问题。点「新对话」可以重新检查开场。 |
| 猜你想问 | 单独开启或关闭，可配置生成模型与追问提示词。 | 一轮示例回答完成后，列出与该轮话题对应的追问。点选直接进入下一轮。切换话题会换一组，关闭后隐藏。样稿覆盖现场核对、留照及变更记录等示例。 |
| 输入引导 | 单独开启，可逐行编辑或批量粘贴词库，重复问法合并。启用时至少需有一条。 | 边打字边匹配。上下键选候选，点文字、Tab 或首次 Enter 将候选补到光标处，可继续改写。再按 Enter 或点候选旁的发送图标发出。Escape 收起候选。 |

阶段预设卡沿用现有标题、副标题、完整问题的 8、10、200 字上限。正式系统已有阶段卡配置及独立的回答后推荐逻辑。正式后台在企业阶段配置中保存开场白、词库和参数。原生会话读取对应阶段并沿用现有回答后推荐与企业资料授权。模型选择受企业已授权的对话模型约束。[阶段数据合同](../../admin/src/lib/xiaok-v1/stage-workflow-settings.ts) · [小程序欢迎页](../../miniprogram/packages/assistant/lib/owner-site-context.js) · [小K回答后推荐](../../admin/src/lib/assistant/fastgpt/agent-v2/suggestions.ts)

FastGPT 分别在开场配置、回答完成后的推荐请求及输入框候选组件处理这三种交互。源码对词条回填和直接发送使用两个不同的事件。小K样稿采用相同的交互时机，输入引导使用本机词库。[开场预设问题源码](https://github.com/labring/FastGPT/blob/5b88c2e63c3a0f6cec86fc19f2e96f1355de531a/projects/app/src/components/core/app/WelcomeQuestionsConfig.tsx) · [回答后推荐源码](https://github.com/labring/FastGPT/blob/5b88c2e63c3a0f6cec86fc19f2e96f1355de531a/projects/app/src/components/core/chat/ChatContainer/ChatBox/hooks/useQuestionGuide.ts) · [输入引导候选源码](https://github.com/labring/FastGPT/blob/5b88c2e63c3a0f6cec86fc19f2e96f1355de531a/projects/app/src/components/core/chat/ChatContainer/ChatBox/Input/InputGuideBox.tsx) · [FastGPT 输入引导说明](https://doc.fastgpt.cn/zh-CN/guide/build/general/chat_input_guide)

## 编排可复用模板

- 平台入口 `/native-workflow` 按中文名、用途、已发布版本和调用阶段列出模板。「从模板新建」可从「现场核对清单」或「阶段知识问答」起草。
- 在 `/native-workflow/[definitionId]` 点连线上的「＋」插入条件，或从条件的出口补接返回节点。顺序箭头与虚线取值引用分开显示。可以拖动知识输出到返回节点，也可在节点面板选择所需字段。「查找节点」支持按名称、用途或能力标识定位。
- 阶段模板可以被多个阶段复用。在触发节点点「查看调用阶段」，可按绑定版本回到对应阶段的「对话体验」。每个阶段单独保存自己的开场白、追问设置和词库。
- 「试运行」可以在同一画布查看草稿或已发布版本的返回文本、经过的节点及条件分支。修改过的草稿支持「保存并试运行」。发布新模板版本后，已有阶段继续使用各自绑定的版本，升级在对应阶段保存。[阶段模板能力](../../admin/src/lib/native-workflow/stage-consultation-template.ts) · [固定模拟样例](../../admin/src/lib/native-workflow/fixtures/catalog.ts) · [FastGPT 画布搜索源码](https://github.com/labring/FastGPT/blob/5b88c2e63c3a0f6cec86fc19f2e96f1355de531a/projects/app/src/pageComponents/app/detail/Workflow/components/SearchButton.tsx)

## 状态与验证

| 情况 | 反馈与恢复 |
| --- | --- |
| 配置缺项 | 名称、职责、预设问题或启用的空词库定位到具体字段。弹窗中的取消操作可放弃本次编辑。 |
| 没有可调用的模板 | 可以先保存阶段配置，之后在「工作流」关联已发布版本。 |
| 条件出口缺失 | 试运行指出缺少的出口，可定位节点、补接并重试。 |
| 同一阶段有并发修改 | 保留当前输入并提示版本冲突，支持读取本机最新配置。旧版样稿中已保存的问题卡和版本继续可用。 |
| 上线接入 | 正式保存、资料检索、模型调用和渠道启用以现有服务端鉴权、持久化与真实回执为准。 |

配置全景图按用户提供的 1920×863 桌面视口导出，对话联动与工作流图使用 1536×864。另检查 1366×768、1024×768、390×844 下的主要操作。验证记录中的结果仅对应本机 HTML 样稿。[浏览器交互检查](../../tmp/xiaok-agent-studio-design-20261123/interaction-check.json) · [前期画布视觉探索](../../tmp/xiaok-agent-studio-design-20261123/canvas-receipt.json) · [前期创建页视觉探索](../../tmp/xiaok-agent-studio-design-20261123/agent-receipt.json)
