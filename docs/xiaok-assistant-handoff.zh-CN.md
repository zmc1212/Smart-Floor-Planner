# 小K助手阶段接力记录

**P5正式图纸/方案精确版本、差异及客户决定的限定闭环已完成；P5整体仍Limited。** 持续开发授权有效，下一批继续现场落实证据及正式解决/关闭，不等待人工A10、截图或逐小步确认。本轮仅定向提交和普通推送开发分支，没有合并main、部署或强推。

## 本轮结果

1. 原S04有权设计师/管理者附本人上传图纸，明确发布绑定同事项/房间/需求授权和资料hash的不可变版本、前版、差异、费用及工期变化。客户原件、AI效果方案、量房v4和普通回复均不冒充正式版本。新版本不继承预览/决定；撤回不回退旧批准。
2. 原咨询C01复用批准C05/U01组件，完整看图后对精确版本作同意、不同意、稍后或要求修改。稍后可重进，修改要说明；原操作键/内容/修订保留并核对丢失回包。版本冲突保留修改说明供当前页面重新编辑。员工不能代客决定，普通“好/可以”不批准；客户同意不自动落实、解决、关闭或验收。
3. 原Worker在真人接待期间延后，只投递原需求授权咨询一次。换版、撤回、来源/成员/客户权限变化停用旧原件、回执及派生回答。原`query_followups`接入实际收到的精确版本/影响/决定，prompt为`xiaok-renovation-v19`；沿用LangGraph、事务、租约、来源、用量及提交守卫，没有新框架或批准工具。
4. 新增原Mini bearer适配器下GET `/conversations/:cid/plans/:versionId`、GET `…/media`及POST `…/{preview,approve,decline,request-changes,defer}`；完整前缀为`/api/miniprogram/assistant`。S04沿原Mini/Admin聊天/上传API，GET versions增加plans修订。新增outbox发布/状态类型，无表/迁移/新页面/菜单，原清理覆盖。owner/admin/super_admin在所选企业继承管理权，无须成为员工或项目成员。双语二期合同、模块清单、路线图及两个受影响路由的唯一还原台账已同步；Less、插画及导航保持。

## 历史基础核查与提交

- 起点：`b9f7bc4f5f4d7352445e5c68387441b9083843e3`。仓库没有`.agents/skills`，已读根/admin指令、相关库存及已批准设计。实际已提交代码依赖大量未提交小客基础，不能因旧阶段测试通过就称干净克隆可运行。
- 必要基础提交：`148af95565defc72fe88c323779b65c171f94d27`，376个明确文件/片段。精确名单、部分文件及排除名单在[基础清单](./xiaok-assistant-foundation-manifest.json)；导入图/起点hash在`tmp/xiaok-p5/dependency-audit.json`。范围为小客/工地/作品来源、角色/会话保护、迁移、客户端入口、Worker、清理及相关自动化。三处密钥扫描命中均为明确的合成测试值；私有连接、环境、SSH、本机DevTools配置未提交。
- P5功能及文档提交：`d832c09bc8ed4840754972ea1ce4d7c0029fc71e`，35个本轮文件/片段，含打包测试的两个小客相关片段。独立源码小客分包预算1/1通过；没有把旧AI组件搬移/删除、素材压缩或其余打包断言整体纳入。
- 两个提交均已普通推送并核验远端SHA。本交接文件另作docs提交；最终完整HEAD/远端核验以`tmp/xiaok-p5/git-final.json`及`git log -1`为准。
- 原87个排除路径的工作文件内容/hash均保持，原5个AI组件删除状态保持。其中打包测试只补充暂存两段相关断言，其余原片段仍未提交。模块/台账只暂存本轮增量，未整体暂存、重置或清理工作树。

## 最终实际验证

| 检查 | 结果与真实边界 |
| --- | --- |
| 独立源码必要基础 | 从起点归档、仅覆盖精确清单，无工作树src链接；资料服务22/22。依赖目录/隔离库连接为本机设施，不等于独立安装或完整干净克隆运行证明 |
| 正式版本服务 | 11/11，含真实图纸/版本、预览/稍后/修改/批准/拒绝、原键恢复、同事项状态、全管理角色、租户/项目/原咨询、真人/关闭开关、并发批准与换版、来源撤销及实际Agent工具来源继承。最后复验S04能显示真实“已同意”，同时明确未落实/关闭 |
| 相邻组合 | 40项：39通过、1配置跳过、0失败；与正式服务及资料专项重叠，不相加。日志为`plans-regression.log` |
| Agent/资料/节点 | 33项：24通过、9配置跳过、0失败；可选真实图像/长尾语义项未开启，不计通过。本轮两次真实正式版本问法另在原生执行 |
| Mini定向 | 109/109，含新方案卡/原件、严格回执、丢包/身份隔离、资料/图片/接续/作品/工地及当前工作树打包检查；不是全小程序套件或干净克隆打包通过 |
| Stable原生 | 最终21/21。唯一原副屏Stable2.02.2608080、SDK0.13.0、库3.17.2、9420/9431，新编译、实际控件输入/上传/原件GET/决定/重进/丢包原键核对、真人延后、换版和撤回。V1/V2图纸内容及SHA-256不同。相册选择及确认/修改模态通过SDK注入合成结果，HTTP/JWT/业务/Worker/持久回读为真实链路；不等于真实微信或真机验证 |
| 配置模型 | DeepSeek/deepseek-flash、langgraph-v1。最终run147/148为site-record-v1两次真实整理，149/150为v19两次原咨询追问；均读到精确V2、+500元/+2天、真实同意与尚未关闭。6次调用均有observed tokens，费用未知；不是通用文风/识图评分 |
| 工程 | lint0错误/30既有警告；tsc292既有诊断、触及文件无诊断。规范化隔离绝对导入路径和诊断省略显示后错误集合一致。独立源码Webpack compile模式通过；跳过类型校验及静态生成，不能称完整生产构建通过 |
| 干净源码限制 | 普通独立构建被原有AiDesignerLegacyPage等非法页面导出阻断。最终独立Mini打包12项9通过/3失败：business约2180KB、主包约2148KB超过源码预算，旧business入口断言缺项。旧素材优化、AI组件搬移及其余测试修改仍留工作树；不得宣称提交已是完整干净克隆可运行/可发布包 |
| 未覆盖 | 全小程序套件、完整宿主/光学/高屏/键盘、真机/真实微信授权/BLE、站外投递和生产环境未重测。量房Phase0既有7通过/1失败保留、本轮未修复，不转为必须用户手测或发布批准 |

首轮真实模型给出了正确版本内容，但缺少formal_plan的construction来源继承。已扩展原只读查询来源kind，补实际工具/检查点/换版撤销回归，再用相同两类真实问法复验；撤回后两条派生回答均不可用，没有靠改问题掩盖缺口。早期普通沙盒看不到用户桌面窗口；在获准实际用户环境核实同一原窗口后继续，未重开项目。一次误并发的隔离测试被安全锁拒绝，未执行测试/写入，不计通过。最终差异检查还修正了局部暂存断言的位置，再核对其独立源码结果。

## 数据、重复命令及证据

最终开发合成数据：enterprise2420/project27/lead2885，staff4994/4995/4996与user3249/3250/3251，customer3252，原咨询168，同事项490，方案504(V1)→509(V2)。两个原件hash分别见native.json，内容从左侧点位调整为右侧。最终active_staff=0、active_runs=0；context_version提升撤销临时签名，SDK/传输/会话/存储/临时文件已恢复。早期同prefix合成尝试的最终账号/任务状态见`fixtures-final.json`；不是客户数据。

admin目录：

- `node scripts/construction-plans-acceptance.mjs`
- `node scripts/construction-plans-acceptance.mjs --regression`
- `node scripts/construction-plans-acceptance.mjs --agent-regression`
- `node --import tsx scripts/construction-plans-development-acceptance.ts --development`

隔离测试固定localhost55432/xiaok_embedding_eval、非superuser/non-BYPASSRLS及共享advisory锁；DB组顺序执行。原生固定已批准localhost5432/smart_floor_planner、本地3006、既有Worker及唯一真实项目；不打开项目副本。独立源码编译使用`next build --webpack --experimental-build-mode compile`，标准构建/tsc失败另列，不能混称完整构建成功。

证据统一在`tmp/xiaok-p5/`：`stage-validation.json`、`dependency-audit.json`、`foundation-manifest.json`、`workspace-preservation.json`、`foundation-materials.log`、`plans-service.log`、`plans-regression.log`、`plans-agent-regression.log`、`p5-mini/lint/tsc/build-compile`日志/状态、`tsc-comparison.json`、`snapshot-package-budget.log`、`snapshot-packaging-full.log`、`native.json`、`native-driver.json`、`native-plan-{pending,changes,approved,followup,withdrawn}.png`、`fixtures-final.json`及Git核验。逻辑390×844、编码348×752，路由/栈已核实并看过C05批准截图；完整光学验收仍未声称。`native-first-attempt/`、`native-model-first-attempt/`和`native-first-full-pass/`保留早期/旧限定证据，不叠加通过数。证据不写凭据。

## 下一阶段

继续P5/PPT38的“现场落实证据→有权人员正式解决/关闭→原咨询结果回传”。把当前有效且获客户同意的精确版本、实际落实记录/原件、结论与负责人独立关联；拒绝、换版、撤回或成员撤权不能复用旧批准；关闭不等于验收或付款。普通回复及本次客户同意都不能代替这些事实。复用批准S04/C01/C05/U01及已有outbox/来源/原键协议，完整S05资料界面、CAD/PDF、算价排程、外部通知及生产发布另守边界。

日常继续Sol/max/fast。当前没有未定位架构阻塞；仅实际证据显示授权/撤销/租约/正式状态无法安全复用时，向父任务提供复现、冲突和方案，再考虑Astra/xhigh。不因换模型缩小验收或提前结束。
