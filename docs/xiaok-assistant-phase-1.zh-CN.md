# 小K第一期：企业知识对话架构与实施契约

**当前设计源优先级已纠正。** 本文件保留P1/v9及当时PPT5还原的历史证据，当前Agent以二期顶部P3B/P2M交付为准。现行客户/接待使用已批准C01/C02/S01校正版，旧PPT5标尺不能覆盖它们；客户不先确认摘要、分类图片或经过独立接续同意页。既有UI回查与重做、来源映射及手测统一见[总计划3.6](./xiaok-assistant-roadmap.zh-CN.md#36-既有计划与ui回查修正)。工地内部共享聊与业主私人咨询独立，属于P4A项目域，不放宽本文件的私聊参与者权限。

**P2M当前状态：Limited。** 开发环境localhost:3006／远端开发数据库的企业1454使用DeepSeek官方deepseek-flash，langgraph-v1、图片/工具启用，xiaok-renovation-v9、policy_version=3。回读一致、在途0、Worker健康200/fresh。证据：结构160/160、合成图片语义16/16、扩展会话44/44段（114/114轮）、隔离Worker19/19、纯测试63/63通过。未明确房间的指代先澄清再写记忆；通用预算/图片证据边界问答避免无谓转入企业知识检索。素材为2位作者的5张公开CC0照片及3种确定性降质变体，具有代表性的装修质量及原生人工验收仍待验证。现有路由/API/角色、C01/C02/S01/U01界面及正式量房写入保持，无生产发布。本段优先于下文历史仅规则/不能识图描述；未选择新Agent的企业仍走旧执行器。方法、证据及限制见[二期契约](./xiaok-assistant-phase-2.zh-CN.md)。

下文Qwen验收为历史证据，不代表已用DeepSeek重跑第一期知识验收。ASSISTANT_TEXT_DISABLE_THINKING=1在DeepSeek映射为thinking.type=disabled，SiliconFlow保留enable_thinking=false。

2026-10-16完整PPT核对后的范围说明：本文件是P1技术实现与证据合同，不代表PPT第5页或整套方案已完整实现。已实现的文字咨询/引用/历史保留；传图语音、参考方向、设计师接续、公开围观、施工主动服务和设备托管分别回填到[修订后的整体计划](./xiaok-assistant-roadmap.zh-CN.md)。该计划覆盖39页主方案及49页放大附页，后续以对应页面交互和每批小程序闭环推进；本文件历史“本期不开放”不构成永久删除需求。

阶段推进约定：完成实现、相关自动化检查和文档后，给出简明手测步骤并继续下一已授权开发阶段，不等待截图、人工A10审核或确认回复，不反复催交证据。用户主动报告问题时再定向排查。尚未执行的手测/业务审核如实保留为待完成，但不阻塞开发推进；沉默不代表验收通过或上线授权。本文后续“待截图/待人工审核”均按此非阻塞规则理解；生产切换仍不在当前授权范围。

历史标题 **Implemented**：会话列表按同租户、本人参与者权限读取首条用户提问作为标题，合并空白并最多显示80个Unicode字符，超长加省略号；后续追问/重试不改标题，已有会话无需迁移即可生效。空会话保留原兜底，保留期清理后的会话不再从消息生成标题。当前PPT第5页与既有历史列表布局不变，仅替换标题数据。用户提供的5张1080×2400截图覆盖初始页、键盘、回答、引用、历史；可见胶囊/输入区无重叠，用户另确认历史恢复通过。用户补充的历史列表截图已确认旧会话显示各自首问，标题修复截图验收通过；首页入口截图待补；设备型号、390×844基线与重新微信登录尚未确认。DevTools自动化已取消，截图均由用户手动提供。

英文镜像：[xiaok-assistant-phase-1.md](./xiaok-assistant-phase-1.md)。整体规划：[xiaok-assistant-roadmap.zh-CN.md](./xiaok-assistant-roadmap.zh-CN.md)。

## 1. 范围与实施状态

1A底座、1B知识/回答/引用/预览/用量及小程序文字咨询已实现；隔离验收及用户指定微云开发联调已通过，开发主库与评估库已迁移至0063。第一期整体仍为`Limited`：微信真实登录与原生截图、正式企业业务知识质量及生产切换待完成；PPT设计来源不变，当前截图缺陷修正与知识导入见下。

第一期服务“客户在小程序文字咨询、装企在后台维护知识并试问”。完整交付包含：多轮会话与历史、FAQ/正文知识发布、授权检索、带引用回答、无依据处理、可恢复生成任务、企业额度和质量评估。

不纳入第一期发布：语音/图片理解、扫描件OCR、文件批量导入、自动需求入库、线索创建/分配、真人在线聊天、项目节点、主动提醒、摄像头、设计变更和日报。联系真人可复用已有且有权限的联系方式，不得展示虚假的接管/排队状态。文档导入可在1B之后增量增加 `KnowledgeSourceAdapter`，不改变检索和会话合同。

后续预留项只定义接口、状态约束和扩展测试；不预建六期业务表，不向模型开放尚未实现的工具，不注册空壳产品API。

## 2. 已核对的代码基础
### 当前开发联调与验收边界

开发联调 **Implemented**：用户指定微云企业1454、微信客户645、本人项目1818（关联enterprise_admin2853）。已验证custom格式备份后，将开发主库从0059迁移至0062并启用vector0.8.2；仅此企业开启小K，额度为每日100次/1,200,000预留tokens/100,000,000费用微单位、保留90天，仅关联管理员显式授予`assistant-knowledge`。生产配置与角色默认权限不变。已发布明确标注的联调测试资料，不代表企业业务政策。小程序实际页面/controller/request代码经HTTP连接Next.js及真实Worker/Embedding/文本模型：三轮问答（两轮有依据、一轮依据不足）、响应丢失幂等重试、引用、重进/切换历史和过期身份拒绝全部通过。开发会话98/99保留6条消息供手工查看；证据为`tmp/xiaok-vector/weiyun-live-mini.json`和`weiyun-verify.json`。联调用开发环境签发的客户/管理员JWT，仅在内存使用；微信登录、原生渲染、正式业务知识质量及生产切换仍待验收。该轮链路联调未改视觉；后续截图修正见下。

- 运行：`cd admin`后分别启动`npm run dev`与`npm run worker:assistant`。dev默认Webpack，避免Windows Turbopack的pg junction错误；worker现在按Next开发模式加载`.env.local`，独立随机CRON_SECRET已配置且未写入版本库。后台登录页、带授权知识页/知识API均HTTP200，Worker心跳fresh；18/18助手表强制RLS，队列无queued/running。
- 小程序当前`ACTIVE_API_ENVIRONMENT=local`，地址`http://192.168.10.111:3006/api`；重新登录并切到业主身份，从当前项目小K入口进入。可提问“小K联调测试的确认口令是什么？”，期望“小K联调通过”，然后重进历史查看。发布前显式恢复production。测试资料不是施工/报价/工期承诺，正式问答需管理员补充审核后的企业资料。
- 验证：9项真实HTTP/页面状态链路通过（3次真实provider成功，6条消息），小程序专项20/20、全量1875/1875及Worker语法/lint通过；实际客户项目列表/详情API均200且包含本人项目1818。全量证据为`tmp/xiaok-vector/integration-mini-all.log`；本轮未操作微信开发者工具，不把Node宿主页面测试称为原生渲染验收。

用户授权从`docs/装修施工标准手册制度规范/04 质量管理`整理并录入微云开发租户1454：7条业主问答已通过既有KnowledgeService创建、真实Embedding索引并发布，文档/版本ID均为2–8，受众`customer_public`、分类“质量管理·施工参考”。来源为《开工九件事》《金螳螂·家 五步放线法》《水电施工标准（工程总监、管家）》，标题保留文件与页码；内容为出处支持的交底/检查要点，未录入内部表单、具体施工数值或企业价格承诺。现有后台`/assistant-knowledge`可查看、修改草稿和撤回；这是一次受控资料整理，不新增PDF上传/OCR/批量导入功能。客户645、项目1818经真实页面/controller/HTTP/Worker/模型验证：水电开工、厨房用电、报价交底均为grounded并可打开来源，未知合同总价为insufficient_evidence；会话101–104的8条消息在重进/切换历史后保持一致。证据：`tmp/xiaok-vector/quality-import.json`、`quality-live-mini.json`、`quality-history.json`。只写入开发环境，其他租户、生产、权限和API合同不变。

用户17:10截图暴露品牌换行、按钮横向拉伸、插画姿态/光学尺寸及重复提示问题；继续按唯一批准源PPT第5页修正，第14页仅参考材质。页面级按钮尺寸覆盖原生默认规则，返回/发送显式mini，发送固定宽高84rpx；品牌禁止换行，Hero缩至224rpx，正文30rpx、头像72rpx。资料不足仅显示服务端说明，已存在引用chip时不再重复渲染“知识来源”占位，未知block仍保留fallback。内置ImageGen独立重生成站立手持竖直空白册的小K，透明PNG480×440、117,813字节，源/包路径保持不变，未切割PPT。Playwright仅用实际模板/样式的尺寸诊断页验证390×844与390×900：发送43.67×43.67px、品牌右界283px/胶囊预留左界293px、Hero高116.47px不随高屏拉伸；不等同微信原生验收。完整宿主胶囊、键盘、光学字号与高屏效果仍待用户下一张手工截图，不操作开发者工具。

本轮验证：小程序全量1875/1875通过；最后的引用占位投影改动后，助手/包体专项31/31通过。WCC80份WXML+2份WXS、WCSC83份Less/WXSS离线编译及220份JS/86份JSON检查通过；assistant源码包164,588字节，主包/business包体检查通过。证据`tmp/xiaok-vector/quality-mini-all.log`、`quality-targeted.log`、`quality-compile.log`；本轮未修改后台代码或执行生产构建/部署。

### 开发知识出处映射

| ID | 问答 | PDF页码（从1计数） |
| --- | --- | --- |
| 2 | 水电开工前，我需要确认什么？ | `04 质量管理/01 开工交底/开工九件事.pdf` p.8,19; `04 质量管理/02 施工放线/金螳螂·家 五步放线法.pdf` p.5 |
| 3 | 厨房用电需求，哪些要提前想好？ | `04 质量管理/01 开工交底/开工九件事.pdf` p.19; `04 质量管理/02 施工放线/金螳螂·家 五步放线法.pdf` p.4,5 |
| 4 | 装修报价里，哪些项目要问清楚？ | `04 质量管理/01 开工交底/开工九件事.pdf` p.8 |
| 5 | 开工前原始房屋要检查哪些问题？ | `04 质量管理/01 开工交底/开工九件事.pdf` p.5 |
| 6 | 放线完成后为什么还要复线和交底？ | `04 质量管理/02 施工放线/金螳螂·家 五步放线法.pdf` p.26 |
| 7 | 水电验收时应该保留哪些照片和记录？ | `04 质量管理/03 水电工程/水电施工标准（工程总监、管家）.pdf` p.17 |
| 8 | 配电箱和弱电箱里的线为什么要做标识？ | `04 质量管理/03 水电工程/水电施工标准（工程总监、管家）.pdf` p.14 |

### 1B-3 当前后台接入与原一期小程序来源

下列小程序尺寸、功能排除和验证是P1当时基线；现行chat/handoff来源与交互由二期当前表替代。Admin合同不受此视觉纠偏影响。

小程序本次还原标尺（在样式修改前按第5页853×1844归一至390×844确定）：品牌字40rpx、完整Logo可见轮廓约64×72rpx，原生胶囊左侧净距10px；Hero固定200rpx、标题44rpx、辅助26rpx、间距10rpx，独立小K容器228×220rpx。正文30rpx/1.55行高，头像72rpx、相邻16rpx，左右留白36rpx，气泡内边距18×24rpx、圆角30rpx；发送84rpx/图标46rpx，输入30rpx/外壳100rpx起。历史/新对话/结束移至输入栏上方的64rpx辅助行，避免打断第5页Hero→消息的阅读顺序；首屏欢迎消息留在完整历史起点。第14页只补暖白家居材质，不加入其户型卡片。具体原生光学大小、键盘和胶囊仍待用户手工截图核验。

- `/assistant-knowledge` 沿用中英文Admin UI合同及既有Ant Design/Admin Pro设计源。真实API支持游标知识列表、正文/FAQ新建、版本详情、分开保存元数据/正文、有效期、复制草稿、索引状态、发布/撤回确认；本人试问支持历史、固定受众、单份就绪草稿、引用、停止/重试/归档。使用共享`notify`，版本冲突保留输入，未知响应重试保留幂等键及消息`clientMessageId`。当前UI一次选一份草稿，API仍支持最多10份；未提供文件导入、客户聊天审计或权限授予面板。
- active状态的`super_admin`、`admin`可管理`global_tenant_id`当前选中企业的知识并使用本人试问；本企业active的`enterprise_admin`仍须数据库显式授予`assistant-knowledge`，待强制改密账号不可用。未选企业显示既有Ant Design Result提示，API拒绝无企业请求，不提供跨企业汇总。沿用共享租户解析，每次操作复查数据库；用量、费用核对、保留期权限及客户会话访问边界不变。 `getEffectivePermissions`为平台两个角色直接提供知识权限；企业负责人合并账号显式小K权限，角色默认与ALL_MENUS不新增其他授权。页面旧JWT可进入，auth/me刷新有效权限，API始终复查数据库。
- 客户/本人预览会话详情新增安全`latestRun`（含实际可重试性）；本人预览额外返回固定`previewScope`（audience、draftVersionIds），支持刷新/重进恢复，不返回内部提示/hash。打开或刷新会话重新读取授权投影。已发送内容保存在数据库；浏览器不持久化正文，未发送文字只在当前页面保留。
- 当前验证：31项定向测试通过（客户端5、平台权限5、知识9、回答12，4项真实文本用例跳过）；全量lint零错误/28条既有警告。隔离目录`next build --webpack`通过TypeScript、107页生成及全部小K路由，存在standalone favicon追踪复制警告，未触碰运行中的开发产物。`http://localhost:3006`实际开发super_admin16访问页面/API均HTTP200，选企业1454可见7条质量问答；真实模型试问得到grounded回答和2条可用引用，会话107可从本人历史重开。两个平台角色、旧JWT、停用/待改密/降权、跨企业及其他管理员试问拒绝均在隔离库覆盖。证据：`tmp/xiaok-vector/platform-tests.json`、`platform-http.json`、`platform-build.log`。用户Chrome登录态视觉与生产上线仍待验收。
- 用户指定[家客来小K装修服务功能方案.pptx](./装修施工标准手册制度规范/家客来小K装修服务功能方案.pptx)配图为小程序设计源，无需重画整套UI。主方案显示第5页`ppt/media/image4.png`为会话主源，原样提取至`design-references/xiaok-assistant-phase1-ppt-v1/sources/slide05-consultation.png`：品牌头、暖白/薄荷绿、白色助手气泡、绿色用户气泡和轻薄输入栏均沿用。第14页`ppt/media/image14.png`（`design-references/xiaok-assistant-phase1-ppt-v1/sources/slide14-floorplan.png`）仅作小K与家居/书册场景参考，不接入户型能力。
- 用户已明确批准以第5页为主设计、第14页参考场景风格开始实施。`packages/assistant/chat/chat`已实现原生文字咨询、欢迎/建议问题、历史/更早消息分页、生成/停止/重试/归档、依据不足、引用/不可用、企业关闭/只读、额度/网络/未知结果及登录失效。客户首页小K气泡传入当前本人lead，独立文字引导保留。不开放语音/传图、户型理解、自动需求摘要、工地推荐或人工接管。未知写入保留原内存请求键/正文，`latestRun`恢复服务端状态；切后台暂停轮询、身份变化隔离旧响应，token/正文均不落客户端持久存储。entry-context返回`canSend/maxMessageChars`，关闭企业仍可读取授权历史，写入校验不放宽。未执行生产开关、迁移或部署。
- 素材映射：主角继续使用ImageGen独立生成的`generated/xiaok-consultation.png`→`miniprogram/packages/assistant/assets/xiaok-consultation.png`（480×440/117,813字节）；新增`generated/xiaok-chat-avatar.png`→同运行目录`xiaok-chat-avatar.png`（256×256/49,659字节）、`generated/xiaok-chat-room.png`→`xiaok-chat-room.png`（780×380/51,118字节）。三个生成源均在`design-references/xiaok-assistant-phase1-ppt-v1/`，均为优化透明PNG；头像可见alpha边界x27–236/y11–253，运行68rpx图像内显示完整角色。6个本地Lucide1.8.0 PNG及现有独立品牌Logo继续复用，许可见`docs/icon-sources/assistant/README.md`。
- 逐元素标尺见下表；布局为内容固有高度，只有消息滚动区吸收剩余高度。完整宿主截图及用户手工光学核验仍待补齐。
- 首页保留`design-references/customer-service-home-three-free-v1/customer-service-home-three-free-v1.png`的结构和插画，仅将既有气泡改为“装修有问题？ / 和小K聊一聊”；独立“点击我带你看看”文字仍进入引导。两个运行路由均保留唯一双语台账行。专项逻辑及隔离关闭/历史测试通过；390×844原生胶囊/键盘/长回答/历史/引用及高屏人工截图待用户提供。未操作微信开发者工具；临时HTML仅排查实际模板/CSS尺寸，不是产品重构稿或原生QA替代。40项小程序回归失败与主包/business源码包体超限已解决；全量测试和离线编译证据见下项。
- 当前验证：小程序全量1875/1875、量房专项394/394、H5 55/55、包体检查12/12通过。源码体积：主包2,057,757字节/business 2,057,439字节/AI workflow 665,983字节/assistant 164,588字节，均低于单包2MiB。已排除 `tmp/` 日志，工作台专用Composer迁入AI分包，入驻v7小K PNG保持620×688透明构图并压至109,953字节。本机独立WCC编译80份WXML+2份WXS、WCSC编译83份Less/WXSS通过；220份JS/86份JSON及require/组件/路由路径检查通过。证据：`tmp/xiaok-vector/repair-all.log`、`repair-survey.log`、`repair-h5.log`、`repair-packaging.log`、`repair-compile.json`。此前后端验证仍为基础19/19、回答12通过/4项真实文本跳过、lint 0错误/28条既有警告、TypeScript 290条仓库诊断且助手变更路径无诊断。本轮开发HTTP联调见上，原生预览/登录/视觉QA与生产部署仍待验收；未操作开发者工具窗口。

#### 一期原始对话页标尺（二期校正版已替代）

第5页原图853×1844，以下坐标归一到390×844；源坐标为人工读取的约值，运行坐标为样式目标，不冒充原生实测。第14页只指导场景和空态问题列表。

| 元素 | 第5页源位置/尺度（px，约值） | 当前代码目标（390px宽） |
| --- | --- | --- |
| 品牌与胶囊 | Logo x19/y45，34×35；品牌字约20px | Logo画布96rpx在72×84rpx独立窗口内展示完整标记；品牌40rpx，辅助22rpx；导航至少44px高，胶囊左10px净距，返回为一期必要动作 |
| Hero标题/辅助 | x23/y109，标题约21px；辅助y138、约13px | 左18.72px；Hero内上距15.6px；44/26rpx，间距5.2px；不以视口高度分配空隙 |
| 小K与家居背景 | 小K约x240/y87、103×93 | 主角228×220rpx容器，右-4rpx/顶-12rpx；独立家居背景750×390rpx，不含UI/角色/文字 |
| 首条头像/气泡 | x19/y185，头像约37px；气泡x64 | 当前消息起点约y195（系统栏47px时）；头像72rpx/图像68rpx（可见约29×34px），相邻16rpx，气泡x64.48px |
| 正文/气泡 | 正文约15px，白色助手/绿色用户，圆角约14px | 正文30rpx=15.6px，行高1.55，padding18×24rpx、圆角30rpx，行间20rpx；欢迎最小宽450rpx |
| 空态建议 | 第14页单面板、短分隔线 | 与气泡对齐，标题34rpx/问题28rpx，行高至少104rpx，分隔线1px×0.5；问题只填入输入框 |
| 一期辅助操作 | 源图无历史/归档功能条 | 输入栏上方64rpx行：历史、新对话、结束，键盘开启时隐藏；不挤占Hero和首条气泡之间的空间 |
| 输入与发送 | x12、宽约367，壳高约48，发送约38 | 外边24rpx=12.48px，壳约102rpx=53px；输入30rpx；发送84rpx=43.68px/图标46rpx（可见笔画约38rpx），保留圆形和原生禁用语义 |
| 页脚/安全区 | 提示在输入下方、宿主底条之上 | 页脚22rpx，间距10rpx，下留12rpx+原生safe-area；键盘出现后独立扣除键盘高度 |

本轮验证：助手逻辑、包体及字号专项34/34通过；WCC80份WXML+2份WXS、WCSC83份Less/WXSS离线编译及220份JS/86份JSON/依赖检查通过。assistant源码包266,751字节，business为2,057,439字节，主包/business限制检查通过；新增透明PNG头像256×256/49,659字节、场景780×380/51,118字节，单图均小于300KB。证据`tmp/xiaok-vector/ppt-restoration-tests.log`、`ppt-restoration-compile.log`。本轮无后台/API或权限变更，原生视觉QA待手工截图。

### 已选定的embedding与向量存储方案（2026-10-15）

用户确认优先使用现有4080远端电脑本地部署Embedding，效果不达标再迁移云端。本节替代此前百炼优先方案。独立GPU服务、应用网关、隔离pgvector迁移/恢复及中文召回已实测；第一期仍为Limited，知识发布和回答闭环属于1B。未切换现有数据库数据卷或开启真实企业。

| 项目 | 选定值与理由 |
| --- | --- |
| 部署位置 | 复用视频工作台的远端Windows 11电脑，RTX 4080 16GB；独立Embedding服务，不安装进ComfyUI环境 |
| Embedding模型 | `Qwen/Qwen3-Embedding-0.6B`，固定1024维，FP16推理、L2归一化、浮点输出；固定模型revision及依赖版本，不默认量化 |
| 接入协议 | 已实现带Bearer认证的`POST /v1/embeddings`及`GET /health`。网关显式区分query/document，仅查询加固定instruction；验证revision、profile、1024维、有限值、L2范数及批次index，返回真实token用量；未知usage保留null，无自动重试/云降级 |
| 索引profile | `qwen3-embedding-0.6b-1024-zh-v1`，revision `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`；配置见`admin/src/lib/assistant/infrastructure/embedding-gateway.ts`。固定英文query instruction、`zh-renovation-dictionary-bigram-v1`；1B已实现认证`POST /v1/chunks`，使用同revision tokenizer按512 tokens/64重叠分块，完整Unicode字符重新计数，不静默截断 |
| 向量存储 | PostgreSQL 17＋官方pgvector扩展，`vector(1024)`、cosine距离；延用现有租户事务、强制RLS及版本授权约束。采用官方PG17镜像路线，部署前固定通过验证的镜像版本与digest；不直接替换运行中的数据卷 |
| 检索策略 | 首期小规模知识先在授权集合内精确向量检索，结合中文分词/装修词典词法召回做融合；词法策略随profile版本化。规模增长后经召回/租户过滤测试再启用HNSW。默认`simple`全文检索不能算已通过中文验证 |
| 运行预算 | 初始单推理worker、batch=8、每段最多512 tokens、重叠64 tokens，查询优先、导入排队；按显存/延迟实测调整。限制输入与队列，超长内容明确分块或拒绝，不能静默截断。无云Embedding按次费用，但有电费和维护成本 |
| 云端备用 | 阿里云百炼北京`text-embedding-v4`、1024维；本地召回或稳定性不达标时评估迁移，不做逐请求自动降级。新建`bailian-v4-1024-zh-v1`，重建全部目标知识向量，验证后原子切换活动profile，保留旧profile回滚；同维度也不能混查 |

选择0.6B是为了与视频任务共用16GB显存时控制资源占用。当前合成装修集已通过依赖召回门槛，不等于真实企业A10回答验收。独立环境为Python3.11.9、torch2.6.0+cu124、sentence-transformers3.4.1、transformers4.51.3；完整实装依赖锁及模型哈希见`admin/scripts/xiaok-embedding/requirements-lock.txt`和`model-manifest.json`。权重经ModelScope下载，小文件经hf-mirror下载，全部对照官方固定revision的LFS SHA256/Git blob SHA1校验，共11个文件；镜像只承担传输。[Qwen官方模型卡](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)、[百炼备用模型](https://help.aliyun.com/zh/model-studio/text-embedding-v4)、[pgvector官方项目](https://github.com/pgvector/pgvector)。本地Embedding不代表整条链路离线：若回答仍调用云端模型，授权命中的知识片段仍会发往该模型。

本批依赖验收：50道可回答合成装修题，纯向量Recall@5=50/50，中文分词＋装修同义词/二元词融合=49/50（98%，超过90%目标；漏题为“签装修合同之前重点看什么？”）；另10道无依据题单独记录候选相似度0.294–0.619，未生成答案，不将检索候选当作有效公司承诺。无依据判断、真实资料与引用语义仍待1B/A10。5并发50次预热短查询经局域网SSH隧道P95=425.8ms、最大440.8ms、11.98次/秒；不是生产跨网SLA。测试期间ComfyUI真实队列有1个运行任务、3–4个等待任务；48请求压测返回33次200、15次429，之后恢复成功。单服务CUDA已分配约1.13GiB、保留约1.19GiB，分配器上限为总显存20%（不是整机显存硬隔离）。企业开关保持关闭。

#### 远端核验与部署交接（2026-10-15）

本次已完成的远端开发环境恢复、对比核验、隧道和 Docker context 交接见[远端开发连接记录](./remote-development.zh-CN.md)。
该状态仅代表开发环境，不代表小K产品发布或真实企业切换。

- 连接线索来自`D:/zlyun/Toonflow/本地视频工作台/docs/H3独立确认适配实施记录-2026-09-28.md`。SSH `Administrator@192.168.10.54:22`，使用现有`C:/Users/Administrator/.ssh/toonflow_remote_ed25519`，BatchMode及严格主机密钥校验成功；未读取或复制私钥。
- 实测主机`User-2026PKPRRP`，Windows 11，RTX4080总显存16376MiB、驱动610.88。部署前显存1492MiB，共用测试时整机约10.6GiB；资源数字为瞬时快照。
- 已部署`D:/XiaoK-Embedding/`独立Python/venv、固定revision模型与服务；仅监听`127.0.0.1:8089`。本机应用经`127.0.0.1:18089`SSH转发访问，私钥仍为既有文件；Bearer凭据未入库，仅在远端受ACL保护文件及本地忽略的环境配置中。`admin/.env.local`新增`ASSISTANT_EMBEDDING_URL`/`ASSISTANT_EMBEDDING_API_KEY`，其他配置保持原值。生产应用服务器跨网连通性尚未验证，不将本机路径当成生产VPN已完成。
- 现有ComfyUI使用`D:/ZlyFlow-ComfyUI-Portable-20260827-152136/python310/python.exe`，只作环境线索，不向其环境安装依赖、不改节点或重启现有视频服务。新服务需独立启动/健康检查/日志轮转/重启恢复和回滚方案。
- 共用GPU不保证视频生成与检索同时稳定；先验证并发，再设置运行时段或资源调度。显存不足时排队/返回可重试错误，不杀ComfyUI进程、不自动调用云端或混用索引。
- 独立Windows任务`XiaoK-Embedding`以SYSTEM运行、开机触发，`run-service.ps1`在Python退出后5秒重新启动；计划任务另配置父进程失败一分钟后重试。实测强杀推理进程后自动换新PID并恢复健康200；不能仅依赖Task Scheduler处理所有子进程退出码。日志`service.log`按5MB×4轮转，不记录正文/凭据。本机系统任务注册被拒绝，改用当前用户Startup快捷方式`XiaoK-Embedding-Tunnel.lnk`启动隐藏的`tunnel.ps1`，断线后5秒重连，SSH保活15秒×3；强杀专属SSH后自动恢复已验证，本机未登录时不保证隧道存在。机器未重启，以免影响ComfyUI。原ComfyUI进程PID15804/20164在部署及演练后保持不变。
- 维护代码位于`admin/scripts/xiaok-embedding/`：bootstrap/install-service/configure-local/install-tunnel为显式部署入口，verify-service/evaluate/prepare-vector-clone/restore-vector-clone为验收入口。回滚只停止并禁用`XiaoK-Embedding`任务，删除本机该Startup快捷方式并停止经命令行核实的专属SSH进程，移除两项Embedding环境变量；不删除模型、不操作ComfyUI、不删除原数据库卷。重新部署复制锁文件后运行bootstrap；不得自动下载浮动模型。
- pgvector镜像固定`pgvector/pgvector:0.8.2-pg17@sha256:feb68f4f15446397d8cac7f4fe48fe4586de83160d1fc48b46283312d1a33966`，实际PG17.10/vector0.8.2。在`xiaok-vector-eval`容器、`xiaok_vector_eval_data`新卷和本机55432端口恢复原库，再运行仅供验收的`vector-probe.sql`；没有切换原5432容器/数据卷。向量库备份恢复至`xiaok_embedding_restore`：94张app表、73张强制RLS表、126条策略，57条探针向量及元数据摘要一致，恢复后非superuser/non-BYPASSRLS角色隔离通过。原库尚无vector；正式切换需在1B部署窗口进行新卷恢复、验证及显式应用连接切换，禁止直接挂载替换旧卷。
- 两企业同题数据在授权集合内精确cosine排序，使用现有`withTenantTransaction`及强制RLS；跨租户读写均拒绝。draft、内部、未生效、过期、撤回、非当前版本及同维度不同profile均在候选阶段排除，越权返回0。探针表只存在隔离验收库，不是假称1B知识schema/API已经上线。完整合成用例见`recall-fixture.ts`；临时日志、备份及指标在Git忽略的`tmp/`，长期结论以本节为准。
- 验证补充：未认证请求401，错误维度/超过8条/超过512 tokens返回422，超过64KiB请求返回413；真实批次顺序与单条结果cosine=0.9999957，重复文本结果一致，token统计来自独立tokenizer实例。真实并发曾触发共享tokenizer的`Already borrowed`，现已分离计数和推理实例并重跑通过。网关错误/未知usage/拒绝重试/错误profile测试通过，定向lint及`git diff --check`通过。全量`tsc --noEmit`仍返回2，诊断涉及既有页面/测试，本批Embedding、词法、契约及验证脚本无诊断；未重复宣称全量构建通过。本批没有UI、设计台账或手动截图影响。

### 1B 知识后端当前交付（2026-10-15）

本批后端能力为 **Implemented**，第一期整体仍为 **Limited**。实现位置：`admin/src/lib/assistant/knowledge/`、`admin/src/app/api/assistant/knowledge/[...path]/route.ts`、`admin/drizzle/0060_assistant_knowledge.sql`及`admin/src/db/assistant-knowledge-schema.ts`。

- 0060新增documents、versions、chunks、index_profiles、attempts共5表，强制RLS、租户复合FK及已发布正文/profile配置不可变触发器；settings新增active profile，jobs新增knowledge_index目标、hash及edit_version，provider审计预留字段补齐job FK。企业reset/purge按依赖顺序清理，文档/版本循环FK同语句删除。迁移仅在`xiaok_embedding_eval`执行；原5432业务库仍未切换，部署本批必须先使用已验证vector镜像显式迁移。
- FAQ/正文草稿、版本复制、元数据更新、分页列表、索引任务、发布和撤回API已实现，具体路径见5.3。所有写请求要求`Idempotency-Key`；元数据/复制/发布/撤回要求`expectedVersion`，编辑/索引/发布要求`expectedEditVersion`。复制使用`fromVersionId`。索引按版本/edit_version/hash/profile去重；重复请求返回原job，不自动重放failed/indeterminate任务。人工确认后可编辑未发布草稿（即使正文不变）提高edit_version再索引，或复制新draft。发布需ready、当前hash/profile、完整片段数及未过期有效期；旧发布版本在新draft失败时保持可用。
- active状态的`super_admin`、`admin`可管理`global_tenant_id`当前选中企业的知识并使用本人试问；本企业active的`enterprise_admin`仍须数据库显式授予`assistant-knowledge`，待强制改密账号不可用。未选企业显示既有Ant Design Result提示，API拒绝无企业请求，不提供跨企业汇总。沿用共享租户解析，每次操作复查数据库；用量、费用核对、保留期权限及客户会话访问边界不变。 迁移`0063_assistant_platform_knowledge.sql`保留文档/版本作者、发布人、索引请求人、预览参与者与消息的真实全局管理员ID：7个操作人外键指向`admin_users.id`，5个写入触发器对新增/改变的操作人引用复查角色、授权和企业。仅返回boolean的身份函数在租户事务内持有身份锁并恢复原RLS scope；业务资源复合外键及18张助手表强制RLS保持不变，历史操作人引用不因后续撤权失效。索引与回答Worker在外部调用/提交前继续复查撤权。 仅索引/发布要求企业开关开启，关闭后仍可维护/撤回。开发主库及评估库已应用0063；生产仍需单独迁移。
- 独立Embedding服务新增分块接口，原ComfyUI环境不变。正文/FAQ渲染后最多16,000字符且48,000 UTF-8字节，请求64KiB；最多128片、每批8片、单次远程请求30秒。每企业最多10个queued/running索引；150秒租约，110秒后不再启动下一批外部调用。每次调用先落attempt再dispatch，记录真实token（未知null）、revision/profile和unknown结果；不伪造provider config或generation。本地索引审计在`assistant_knowledge_attempts`，尚无按成本收费/汇总接口。
- 内部Worker按最早可执行任务kind选择，每轮最多执行一个chat或knowledge任务，避免两类昂贵任务累计超过180秒请求预算。知识批次前续租并复查权限，最终以lease/hash/edit_version/profile条件原子提交全部片段。过期且未dispatch可重新领取至3次；已dispatch崩溃标记indeterminate，不自动重发；修改/撤回取消任务，晚到结果不得覆盖新草稿。发布、撤回和元数据变更同事务提升knowledge_epoch并写outbox；可见性投递只确认持久事实，不发送通知。
- `conversationKnowledgeRetriever(conversationId)`绑定已授权客户或本人预览会话，无任意企业选择或公开搜索API。远程query embedding前后复查身份/权限、参与权、mode/status、开关、epoch及预览快照。客户只取当前已发布有效的customer_public；预览按创建时固定的受众及draft集合取数。候选SQL先过滤tenant/version/audience/effective dates/ready/hash/active profile，再分别取向量与词法各30条，融合最多5条。无检索缓存；模型dispatch、最终提交及引用读取复用来源校验。
- 验证入口：`npm run test:assistant:knowledge`（显式隔离库连接及真实Embedding配置）9/9通过；覆盖真实中文/emoji分块、Qwen索引与中文召回、幂等/HTTP角色边界、跨租户、受众/有效期/profile/当前版本过滤、发布不可变、撤回epoch、同正文编辑竞争、过期lease、撤权和未知结果。`npm run test:assistant`26/26、企业reset/purge回归3/3通过。定向lint及diff检查通过；Webpack编译成功后在既有`AiDesignerLegacyPage`导出类型错误处失败，完整tsc仍有既有诊断，本批文件无诊断。远端server.py与仓库SHA256一致，ComfyUI原PID15804/20164保持运行。
- 知识回答与预览的当前实现见下节。剩余1B/1C：真实企业资料质量验收、UI和生产切换；后端通过不代表第一期产品已上线。

### 1B 知识回答、引用与预览后端（2026-10-15）

本批范围 **Implemented**，由`infrastructure/answer-worker.ts`、`knowledge/answer.ts`、`knowledge/sources.ts`和既有ConversationService/JobQueue共同实现；没有建立第二套会话/额度/重试系统。

- 0061新增`assistant_message_citations`及消息/run的`answer_kind`，增加管理员消息幂等索引；引用绑定同租户的conversation/message/run/document/version/chunk复合外键及强制RLS。只注册knowledge来源。draft重新索引删除旧片段时，仅将引用chunk_id置空，保留最小审计快照并返回不可用；不会阻塞新索引，也不把旧摘录重新暴露。reset/purge先删除引用。
- 回答执行：触发消息及最多2条旧用户/Admin问题（各120字符）用于指代理解，不提供旧AI结论；最多5个授权来源，暂定cosine门槛0.30。每来源最多600个Unicode字符并在完整句子处截断；只允许选择4–400字符的完整句子。提示JSON≤9,000 UTF-8字节，保留2,048-token上限兼容原推理模型；查询仍受1,000字符和Embedding512-token限制。门槛及模型仍需完整复验，不能据此保证语义正确。
- 使用现有文本供应商/chat.general、temperature0，无工具。可选ASSISTANT_TEXT_MODEL仅覆盖助手模型并按实际模型记录审计，默认保留已保存模型。模型只能返回{"selections":["E1"]}，最多3个本次编号，空数组表示无依据。服务端构造原文和引用，最终parseAnswer强制正文等于引用原文，不允许资料外解释；伪造/重复编号、非完整JSON及超限片段均被拦截，不自动修复或切换供应商重试。 可选ASSISTANT_TEXT_DISABLE_THINKING=1仅允许已核验的SiliconFlow OpenAI兼容运行配置，发送enable_thinking=false并记录调用选项；缺省不发送此参数，旧generation调用不受影响。
- 实测字符串适配器偶尔将完整JSON包在单个Markdown JSON代码围栏中；解析器只去掉覆盖整个响应的这一层围栏，仍按同一schema校验，不从任意说明文字中抽取JSON。此前该格式被拒绝且未保存不合规回答，兼容后重跑真实模型用例通过。
- 无候选或仅低相关候选时不调用文本模型；模型也可明确返回`insufficient_evidence`。两者均以成功run保存固定notice，不保存模型自编的无依据解释、联系方式或公司承诺。检索服务故障是失败，不能伪装成无依据成功。未dispatch文本模型释放额度预留，文本token为已观测0；已dispatch而费用未知仍为reconciling。真实模型返回后先记录attempt关联、model step及usage（旧适配器未知为null）；输出校验失败是failed，未收到结果的超时/连接中断是indeterminate，均不自动重发。
- 每次生成先将实际证据ref/hash写入检索step，模型dispatch及最终提交重新校验当前权限、知识epoch、源hash/profile/有效期及预览快照。最终消息、引用、answer_kind和run终态同事务提交；取消、过期lease、撤权或知识变更均阻止晚到回答。引用ID只由服务器生成，模型无权生成数据库引用对象。
- `GET /api/miniprogram/assistant/citations/[citationId]`和`GET /api/assistant/preview/citations/[citationId]`已实现。客户定位器只返回本人客户会话的路由ID，再进入租户事务；管理员只能读取本人预览。消息列表现在返回answerKind、available和citations。旧发布版本仍获授权时标记historical；撤回、受众收紧、过期、profile失效、draft编辑/重新索引时，引用不再返回标题/摘录/定位，整条依赖回答投影为source_unavailable notice。已到达客户端的内容不能远程召回。
- `/api/assistant/preview/conversations`支持创建/列表；`/[id]`支持详情/归档；`/[id]/messages`支持发送/历史；`/runs/[runId]`及cancel/retry复用同一服务。当前选定企业的平台super_admin/admin，以及本企业显式获`assistant-knowledge`的active enterprise_admin可创建/使用本人knowledge_preview；任何角色均不得读取其他管理员试问，客户不能读。创建可指定`audience`（customer_public默认、staff_internal、all）及最多10个ready draftVersionIds，同文档最多选一个draft。服务器固定id/hash/editVersion；发送时不接受扩大范围。选中draft替代该文档发布版本，不能转成客户会话；预览消耗相同企业额度，引用标记isDraft。
- UI、导航和默认角色菜单未改变；预览管理权限仍需显式配置。迁移只应用于`xiaok_embedding_eval`，真实模型验证使用合成测试资料；没有将真实企业开关或原库连接切换到本批服务。独立Embedding及ComfyUI环境不变。
- 验证：`ASSISTANT_LIVE_TEXT=1 npm run test:assistant:answers` 12/12（含真实模型正常引用回答、拒绝无依据公司承诺、冲突/恶意资料三项）；默认不启用真实文本调用时跳过这三项，其余使用真实PG/Qwen与确定性文本适配器验证边界。原会话26/26、知识9/9、reset/purge 3/3通过。覆盖伪造ID/摘录/数字、无候选、检索故障、未知调用、生成中撤回/取消、历史失效、draft重建、跨主体/租户、预览扩权及旧结论不进入新提示。返回后仍待费用核对的failed/cancelled run明确`retryable=false`。全量lint为0错误/28条既有警告；Webpack编译通过，随后仍被既有`AiDesignerLegacyPage`导出类型错误阻断；本批类型检查无新增诊断。这是后端合成验收，不是完整A10真实企业质量评估。

### 1C 隔离后端验收（不等于真实企业试点）

- **当前结论：修复后的合成后端验收通过，完整入口退出0、passed=true。** 本地助手选择硅基流动免费`Qwen/Qwen3.5-4B`非思考模式；已在Git忽略的`admin/.env.local`设置ASSISTANT_TEXT_MODEL和ASSISTANT_TEXT_DISABLE_THINKING=1，供本地服务启动/重载读取。平台保存的默认LLM、其他AI功能和DATABASE_URL未改。真实企业A10及整体第一期仍为Limited。

| 同一60题合成集 | 原基线R1 | 修复后R1最终复跑 | 最终Qwen3.5-4B |
| --- | --- | --- | --- |
| 可答题预期来源/逐字引用覆盖 | 38/50（76%） | 49/50（98%） | 50/50（100%） |
| 无依据题安全拒答 | 10/10 | 10/10 | 10/10 |
| 模型超时 / 非法引用 | 2 / 1 | 1 / 0 | 0 / 0 |
| 端到端P95 | 81.562秒 | 46.743秒 | 5.194秒 |
| 最大耗时 | 见基线 | 91.926秒（含90秒provider超时） | 7.475秒 |
| 真实三轮 | 首轮失败 | 通过，合计159.178秒 | 通过，合计7.142秒 |

- 回答使用`extractive-selection-v3-faq`：模型只选本次授权证据编号。FAQ问题只作匹配上下文；不超过400字符的短答案完整保留，优先选择一条充分直接的答案，相同正文确定性去重。服务端只去除展示正文的FAQ问答外壳，最终parseAnswer要求正文等于确定性格式整理后的原文，包括答案限制条件；引用快照仍为不超过400字符的连续原文，同chunk多选也保留原文跨度。一般流程/收费规则可答，缺乏证据的具体项目承诺和冲突资料仍拒答；未知/重复编号或畸形输出明确失败，不自动换模型重发。此前v2基线的50条可答正文已通过抽取检查；当前FAQ专项验证包括`answer-selection.test.ts`、`assistant-answers.test.ts`及`tmp/xiaok-vector/faq-answer-live.json`中的真实客户接口：企业1454/客户645/线索1818，conversation109/run80只有一段回复正文和一个可用引用，历史读取一致。已保存的旧消息不回写。
- 召回cosine候选门槛由0.55降为暂定0.30，由选择器判定直接支持。修复首轮R1已达49/50且零超时，但唯一漏题“签装修合同之前重点看什么？”没有召回签约资料。补充仅作用于查询的“签合同/订立合同/协议签署→签约”字面同义表达后，复用已存词项，无需旧资料重建。真实检索前五预检、同义表达回归及最终两道合同问答均通过，未改题目或预期来源。最终签约答案包含公司主体、范围、材料、付款、违约与争议条款原文。
- 按用户要求优先复验原模型；它在签约修复后的整组复跑仍出现一次超时，因技术失败门禁未通过而未选为当前稳定配置。Qwen3-30B-A3B-Instruct-2507实验前30题30/30但未完成整组；GLM-4-9B-0414在冲突/项目承诺边界失败（14/16）；Xing4.0-29B四项真实调用超时（12/16）。Qwen3.5-4B由3项探测推进到完整验收通过。早期HTTP402账户阻断已解除；失败日志及原模型两轮结果均保留，不筛掉失败或重发原run。官方DeepSeek `deepseek-flash`仅作为用户授权的后备，未启用。
- 最终回归：基础30/30、知识9/9、回答16/16（含4项真实文本测试）、usage8/8及60题全部通过；额外非思考参数兼容性测试1/1通过。三轮覆盖一般时长、指代理解与拒绝确认具体项目验收。租户隔离、撤回/权限收紧、旧版historical、草稿失效、未知费用核对与取消隔离边界保持通过。测试企业和活动队列均清理为0。全量lint0错误/28条既有警告；全量tsc仍有既有错误，本批文件无诊断。未改路由/schema，不重复UI构建，既有AiDesignerLegacyPage构建问题仍未处理。
- 可选ASSISTANT_TEXT_MODEL只覆盖assistant_run；ASSISTANT_TEXT_DISABLE_THINKING=1仅对已核验的SiliconFlow OpenAI兼容配置发送enable_thinking=false，实际模型/选项记入attempt审计，旧generation调用不变。其他部署未显式设置时仍用原保存模型；保持2048-token上限和90/150/180秒provider/lease/request预算。明确HTTP402记为failed/provider_payment_required，仍待费用核对，不伪造零用量或自动开放重试。最终60次query Embedding均实测，59次文本调用usage未知，1次未调用文本为实测0；免费标价不冒充实际费用核销。
- 复现入口：显式设置隔离库DATABASE_URL、ASSISTANT_LIVE_TEXT=1、ASSISTANT_TEXT_MODEL=Qwen/Qwen3.5-4B及ASSISTANT_TEXT_DISABLE_THINKING=1，再运行`npm run test:assistant:acceptance`。只允许loopback:55432/xiaok_embedding_eval、非superuser/non-BYPASSRLS、已有0062和空闲队列，套件串行。每批最多3题、批间6.5秒等待尊重30次/分钟限制；不放宽产品限流、不迁移、不切库、不自动重发。最终证据为`tmp/xiaok-vector/phase1c-quality.json`、`phase1c-acceptance.json`和`phase1c-qwen-free-acceptance.log`；原基线及R1两轮分别为`phase1c-quality-baseline.json`、`phase1c-quality-r1-before-signing-fix.json`、`phase1c-quality-r1-final.json`，均Git忽略。
- 自动门槛是来源/引用覆盖≥90%、无依据10题全部拒答、零技术失败及正文严格抽取；不能代替业务负责人对相关性、资料真实性和回答完整性的签认，也不是生产SLA。真实企业A10、生产部署/恢复演练、UI仍待后续；原业务库、UI和ComfyUI不变，无新增产品路由、权限或schema。免费模型输入/输出标价已核验[官方价格](https://www.siliconflow.cn/pricing)，参数见[官方接口](https://docs.siliconflow.cn/docs/api/chat-completions-post)；备用标识见[DeepSeek官方文档](https://api-docs.deepseek.com/zh-cn/updates/)。

### 1B usage、用量与未知费用核对（当前交付）

- **Implemented**：`GET /api/assistant/usage?from=YYYY-MM-DD&to=YYYY-MM-DD`，UTC左闭右开，默认最近30天（含今天）、最多90天。返回按天/类别/measurement_kind的文本与query Embedding用量、input/output已知小计与未知计数、索引chunk/embed调用及状态、provider调用状态、run用途/状态/错误、费用及当前预算。金额/token/计数采用十进制整数字符串；null不是零，部分已知小计不是完整总量。不返回聊天正文、提示词、凭据或provider原始错误。
- `GET /api/assistant/usage/reconciliations`按ID升序分页（cursor、limit默认20/最大100）；`GET /api/assistant/usage/reconciliations/:reservationId`返回同租户预留、provider attempt ID/状态和核对审计。读取需当前企业active enterprise_admin及数据库`assistant-usage`授权；`POST`同一详情路径还需`assistant-usage-reconcile`，服务层每次复查，平台角色无越权入口，不修改UI或默认角色菜单。
- POST必须提供`Idempotency-Key`及严格字段`expectedVersion,tokens,costMicros,currency,evidenceReference,reason`。tokens/costMicros是非负十进制整数字符串（含明确核实的0），币种本期仅CNY；确认总token必须与已观测文本token一致。必须有外部账单/调用证据和原因，无法核实任一数值就保留reconciling；不把估算当实测，不自动换汇或计入本地GPU、电费成本。核对值独立保存在审计，不改写原始provider/usage的未知记录。
- 仅终态run、无有效job租约且provider dispatch距今超过180秒可核对，避免取消/超时后的90秒调用晚到。settings行锁与发送预留串行；expectedVersion防过期修改，同键同体返回原结果、异体冲突，单预留唯一审计且无修改/覆盖API。核对原子写入审核人/凭据引用/原因/时间/确认值并将预留转settled。预算采用当日确认值＋held/reconciling原始预留，未决跨UTC午夜保留，结算归原budget_date；实际超预留照实计入并阻止继续超额发送。
- 核对不改变run终态、不补发回答、不自动重试、不扣客户积分或费用。indeterminate仍不可重试；failed/cancelled须先完成核对，再通过原有显式retry入口重新预留。文本token预算与本地Embedding统计分开；无文本dispatch仍沿用释放预留，实际query Embedding计量独立保留。
- 迁移`0062_assistant_usage.sql`只应用于隔离库，增加固定CNY预算币种、input/output token、settled token/费用和`assistant_cost_reviews`（强制RLS、复合租户外键、同预留唯一审计）；类型投影及reset/purge同步。生产回答的query Embedding在调用前记录unavailable，返回时写实测input token，失败/未知保持null；以job/lease为调用键。文本兼容适配器仍可能不提供usage，索引沿用已有attempt审计，历史query未采集记录不补造。
- 验证：`npm run test:assistant:usage` 8/8，涵盖权限/RLS、未知值、金额/日期校验、HTTP边界、并发幂等、过期版本、调用中保护、已观测token冲突、超预留与跨日预算。基础26/26、知识9/9、回答9通过/3项真实文本调用跳过、reset/purge 3/3，共55项通过；本轮不重复真实文本模型验收。全量lint为0错误/28条既有警告，定向lint及本批类型检查无新增诊断；Webpack编译成功后仍被既有AiDesignerLegacyPage导出类型错误阻断，`git diff --check`通过。真实企业资料质量、UI和生产切换仍待完成。

### 1A 底座与依赖验证记录（后续增量见上方1B）

当前批次结论：1A会话/API底座已落地，独立Embedding及隔离vector/中文召回/租户隔离依赖验证已通过（见上节）。专项26/26通过，包括原23项及3项网关测试；普通PG恢复93表/72张RLS表/125策略，向量探针恢复94表/73张强制RLS表/126策略。第一期仍为Limited：原业务库切换和生产跨网路径未完成，1B后端增量见上方当前交付。此前全量lint为0错误/28条既有警告；Turbopack构建受Windows junction阻断，Webpack编译后受既有`ai-studio/designer/page.tsx`的`AiDesignerLegacyPage`导出类型错误阻断。未绕过类型检查或修改无关UI；依赖验证不代表这些既有构建阻断已消失。

- 数据库迁移：`admin/drizzle/0058_assistant_foundation.sql`、`0059_assistant_identity_guard.sql`；13张新增表覆盖会话、参与者、绑定、消息、run/steps、jobs、outbox/投递、企业设置、幂等、额度和用量。全部强制RLS，租户关系采用复合外键，身份使用现有全局users。全局身份版本检查通过只返回boolean的受控函数完成，在原租户事务内保留共享身份锁并恢复租户scope，避免无企业客户被错误拒绝或降级成平台业务查询。SQL迁移是约束的权威，`admin/src/db/assistant-schema.ts`为类型投影，不使用schema push替代迁移。
- 当前客户API：`/api/miniprogram/assistant/entry-context`、`conversations`、`conversations/[id]`、`conversations/[id]/messages`、`runs/[runId]`及`cancel/retry`，方法和5.2一致。通过统一catch-all handler实现；只接受有效微信customer身份，无手机号可用，staff/referrer和Admin token不获得访问权。入口支持当前有效企业、有效服务码、自有lead、本人会话；服务码只沿用解析/扫码审计，不创建线索、锁归属或分佣。按ID的全局定位只返回当前参与者可见的租户/会话ID，正文读取始终进入租户事务。列表需entryToken；旧会话读取无需重用入口token。
- 1A完成时未注册知识接口；当前知识API、索引队列/profile和权限见上方1B交付。引用、预览及usage后端已在1B注册；管理页面仍未实现；平台角色无客户会话读取捷径。
- 发送、幂等记录、用户消息、run/job和额度预留同事务提交。企业settings行锁串行化额度及相关修改，会话锁和部分唯一索引约束单活跃run。同键同体重放原结果，同键异体409；重放前重新授权。幂等记录标记90天期限，但1A不自动删除；删除策略必须同时保留资源级去重，不能单独清掉创建/重试记录后宣称exactly-once。
- `assistant_enterprise_settings`默认关闭，daily_requests/daily_tokens/daily_cost_micros/retention_days均默认0；全部显式为正才允许发送。每run暂按12,000 token及1,000,000微单位成本保守预留；金额是额度占用，不是实际扣费。UTC日窗口累计，held/reconciling跨日继续占用。每企业每分钟默认30次run（`ASSISTANT_REQUESTS_PER_MINUTE`，1–1000），轮询20条默认/100条最大。实际token/费用未知记unavailable，不填0；未知结算保留reconciling，1B已增加有凭据的人工核对，见上方当前交付，当前不对客户收费。
- 文本网关抽取为`executePostgresText`，旧`executePostgresWorkflowChat`保留原签名、返回值和路由策略；新assistant调用单供应商，不因未知结果切换。现有字符串适配器只声明完整文本，usage、结束原因和provider request ID为null；不声称支持streaming/tool calling/embedding。新网关限制输入JSON UTF-8共9,000字节、输出2,048 token，供应商超时最多90秒。
- 内部Worker：`POST /api/internal/assistant/jobs/run`，只接受非空`CRON_SECRET`匹配的`x-cron-secret`，不接受目标企业/正文参数；独立`assistant-worker.mjs`轮询，每次领取一个持久化任务。Compose profile为`assistant`，默认不启动；脚本随既有Dockerfile scripts目录打包，另有健康检查。provider/lease/request预算为90/150/180秒，心跳接口30秒预算；未知provider结果不自动重发。未dispatch的过期租约最多领取3次；旧lease、取消、身份撤销、模式/context/epoch改变均不能提交晚到结果。
- **1A生产装配未安装知识检索器**：已入队请求由Worker记为failed/`retrieval_unavailable`并释放未调用额度；不会调用普通模型冒充知识回答。只在测试装配中用确定性结果验证成功提交/系统消息/后续模式。不对外开放开关。
- 实测依赖：本地PG17.10、sfp_app迁移/13表强制RLS及平台文本模型最小调用通过。原`postgres:17`仍无vector，中文`simple`全文检索仍不满足召回需求；独立Embedding现已配置并通过真实网关调用。隔离PG17.10/vector0.8.2、中文混合检索和向量备份恢复已通过上节验收；不代表原库已切换或1B知识检索已上线。
- 验证：`npm run test:assistant` 26/26（含3项Embedding网关测试；真实PG并发/RLS/复合FK/额度/取消/身份撤销、无手机号HTTP、独立进程退出与租约恢复、E01–E06基础扩展演练）；`npm run test:ai` 158/158；`npm run test:auth` 20/20；企业reset/purge回归3/3。清理已按依赖顺序纳入新增表，消息/run循环关系在同一SQL语句中删除。E06已验证无用户触发消息的定时run及事实适配器，正式来源引用解析/网关质量评估仍待1B。这些是底座证据，不等于A03/A04/A07/A08/A10完整知识验收通过。
- 验证命令：`npm run check:assistant -- --text --embedding`执行脱敏依赖检查；`npm run worker:assistant`启动本地Worker；数据库迁移仅显式运行`npm run db:migrate`，不放在应用启动路径。代码、资产和导航没有视觉变化，本批次无设计台账或截图影响。


| 开工时路径 | 开工时事实（增量见上方交付记录） | 第一期开工处理 |
| --- | --- | --- |
| [schema.ts](../admin/src/db/schema.ts) | `ai_chat_sessions` 为管理员会话；`ai_provider_attempts.generation_id` 在表中可空；没有知识检索表 | 新建会话/知识域；审计可增量扩展，但不伪造generation |
| [conversations API](../admin/src/app/api/ai/conversations/route.ts)、[agent API](../admin/src/app/api/ai/agent/route.ts) | 会话读写绑定企业与Admin身份 | 保留原接口；新小K接口独立授权并复用底层能力 |
| [postgres-workflow-chat.ts](../admin/src/lib/ai/postgres-workflow-chat.ts) | 调用接口要求 `generationId`，封装provider路由和审计 | 提取与调用来源无关的网关，旧工作流作为兼容调用方 |
| [provider-types.ts](../admin/src/lib/ai/provider-types.ts) | `chat()` 返回完整字符串；未声明streaming、tool calling或embedding能力 | 首期采用持久化任务＋轮询；新能力显式声明与校验 |
| [platform-llm-config.ts](../admin/src/lib/platform-llm-config.ts) | 平台 `chat.general` 覆盖配置失败不静默切换其他provider | 新文本网关保留该约束；embedding另设能力配置 |
| [miniprogram auth](../admin/src/lib/miniprogram-auth.ts)、[login API](../admin/src/app/api/auth/miniprogram/route.ts) | 有 `wechat_code` 登录、签名上下文和版本验证；客户可能没有企业上下文 | 允许已有微信身份无手机号咨询；服务端解析合法企业入口 |
| [transaction.ts](../admin/src/db/transaction.ts)、[request scope](../admin/src/lib/postgres-request-scope.ts) | 事务内设置租户和RLS；无企业小程序上下文可能进入平台事务 | 小K业务查询必须先解析企业，再显式进入租户事务 |
| [customer-project repository](../admin/src/db/repositories/customer-project-repository.ts) | 当前项目视图聚合线索、预约、户型和方案 | 不视为已有施工项目状态机 |
| [lead-claim worker](../admin/scripts/lead-claim-worker.mjs) | 现有Worker通过认证内部API周期执行工作 | 可沿用部署方式，但AI任务使用独立租约、超时和健康检查 |
| [通知合同](./miniprogram-subscription-notification-template-baseline.zh-CN.md) | 微信模板、开关和授权有明确限制 | 第一期开通对话不等于开通后续主动通知 |

## 3. 核心边界与拟定目录

以下为拟新增路径。`core`只依赖契约、仓储接口和通用策略；业务适配器在装配层注册，不能反向被核心导入。

```text
admin/src/lib/assistant/
  contracts/             ActorContext、MessageBlock、ModelGateway、ToolDefinition、DomainEvent
  core/                  conversation、participant、append-message、run、mode、binding
  application/           send-message、complete-run、knowledge-answer、composition
  knowledge/             source、version、index、retrieve、citation、publication
  capabilities/          registry、authorize、knowledge-search
  infrastructure/        model-gateway、job-queue、event-outbox、usage、telemetry
admin/src/db/repositories/assistant-*.ts
admin/src/app/api/miniprogram/assistant/...
admin/src/app/api/assistant/...
admin/src/app/api/internal/assistant/jobs/run/route.ts
admin/scripts/assistant-worker.mjs
```

### 3.1 服务接口

| 契约 | 职责与兼容要求 |
| --- | --- |
| `ActorContext` | 服务端生成 `enterpriseId`、`principal`、当前身份版本、能力集合、入口依据；不接受客户端或模型自行构造 |
| `ConversationService` | 创建、列出、读取、归档会话；鉴权、排序和并发控制；不加载具体业务事实 |
| `MessageAppender` | 统一追加用户、AI、授权人员和系统事件消息；分配序号和幂等键；不直接决定接收人权限 |
| `ConversationBindingService` | 经注册业务适配器验证资源后关联；关联不授予资源访问权，也不改派单/归属 |
| `ContextProvider` | 根据当前主体与绑定加载最小必要的正式事实；注明来源与版本；P1只启用知识及会话上下文 |
| `KnowledgeRetriever` | 输入经过验证的企业/受众/检索配置，返回可引用片段；接口不绑定特定向量存储 |
| `TextModelGateway` | 普通文本生成、能力声明、调用审计与用量；支持不同调用来源；P1可用完整响应模式 |
| `EmbeddingGateway` | 独立配置模型、维度与版本；不能假设现有chat供应商一定提供embedding |
| `ToolDefinition` | 名称/版本、输入输出schema、所需能力、资源授权器、读写类型、确认策略、超时和幂等策略 |
| `DomainEvent` / `JobQueue` | 版本化事件和可恢复任务；后台执行与请求生命周期分离 |

P1仅注册只读 `knowledge.search.v1`，由应用服务确定性调用。基础RAG不依赖模型原生tool calling。后续若启用tool calling，模型只能选择服务器给定的能力集合，每次执行仍需重新鉴权和校验参数。

### 3.2 主体、会话与内容协议

```ts
type Principal =
  | { kind: 'user'; userId: string }
  | { kind: 'admin'; adminId: string };

type ResourceRef = { type: string; id: string }; // 仅允许注册类型；不是任意资源读取器
type MessageContentV1 = {
  version: 1;
  blocks: Array<
    | { type: 'text'; text: string }
    | { type: 'citation'; citationId: string; fallbackText: string }
    | { type: 'notice'; code: string; fallbackText: string }
  >;
};
type InvocationOwner =
  | { kind: 'generation'; generationId: string }
  | { kind: 'assistant_run'; runId: string }
  | { kind: 'knowledge_job'; jobId: string };
type RunTrigger =
  | { kind: 'user_message'; messageId: string }
  | { kind: 'domain_event'; eventId: string }
  | { kind: 'scheduled_task'; occurrenceKey: string };
```

所有数据库bigint ID以十进制字符串传输，时间以UTC ISO-8601传输；展示/调度时区显式设置，项目默认 `Asia/Shanghai`。`schemaVersion`随协议或快照保存；未知消息块只显示服务端提供的安全 `fallbackText`。将来媒体和动作块只存资源引用，由服务端生成短效可访问地址/白名单动作，不能把永久签名URL、HTML或任意脚本放进消息协议。

同一个人可以有客户和员工身份，但每次请求只使用已选择且有效的身份；身份切换不能把员工知识、预览会话或工具能力带进客户会话。系统和AI是消息作者类型，不是能够登录或绕过权限的用户。

P1生产只允许 `user_message` 触发run；事件和定时触发由后续内部服务启用，绝不接受客户端指定。`RunTrigger`从第一期保留，无用户消息的日报/提醒不必伪造trigger消息。`TextModelGateway`返回标准化文本、attempt ID、结束原因和可用的usage/provider request ID；旧string适配器通过兼容包装工作，不能把缺失usage视为零。未来流式传输可新增run事件端点，最终消息/引用提交合同保持不变。

## 4. 数据模型

### 4.1 通用约束

除引用现有全局身份/平台配置外，所有新增业务表均带不可空 `enterprise_id`、主键、创建时间；可变表有 `updated_at` 和乐观锁 `version`。开启RLS并复用租户事务。租户表间关系使用 `(enterprise_id, id)` 唯一键和复合外键，防止合法ID跨企业拼接。

`users`是现有全局身份，不能错误地要求其 `enterprise_id` 等于咨询企业；访问由签名身份、有效入口和参与者关系决定。`admin_users`、业务资源及其租户关系必须一致。多态 `ResourceRef` 无法仅靠SQL外键保证存在性，由注册适配器在绑定和使用时验证；它不替代实际业务域外键。

### 4.2 会话域：第一期实际建立

| 表 | 关键字段 | 约束与用途 |
| --- | --- | --- |
| `assistant_conversations` | `purpose`、`status`、`mode`、`title`、`entry_snapshot`、`policy_version`、`context_revision`、`last_seq`、`version` | P1 purpose为 `customer_consultation` / `knowledge_preview`；status为 `open/closed/archived`；mode仅启用 `ai`，契约预留 `handoff_requested/human`；不要求lead/project/workflow/admin |
| `assistant_participants` | `conversation_id`、`principal_kind`、`user_id`或`admin_id`、`participant_role`、`grant_basis`、`status`、`revoked_at` | 两种主体外键恰有一个；同会话同主体唯一；P1仅本人客户会话或本人后台试问；后续增加成员须经授权服务 |
| `assistant_context_bindings` | `conversation_id`、`resource_type`、`resource_id`、`relation`、`source_version`、`status` | 活跃绑定唯一；P1可保存服务端核验的自有lead关联，但不据此加载未开放业务数据；project等类型未注册即拒绝 |
| `assistant_messages` | `conversation_id`、`seq`、`author_kind`、作者引用、`content`、`run_id`、`source_event_id`、`client_message_id`、`reply_to_message_id` | 唯一 `(enterprise_id, conversation_id, seq)`；用户消息按主体＋client ID唯一；一个run至多一条最终AI消息；系统事件按事件＋目标会话＋消息用途去重；不在一列JSON数组中不断追加整段历史 |
| `assistant_runs` | `conversation_id`、`trigger_kind`、`trigger_message_id/trigger_event_id/trigger_schedule_key`、`retry_of_run_id`、`status`、`policy_snapshot`、`context_revision`、`knowledge_epoch`、`job_id`、`output_message_id`、错误/时间字段 | 触发引用按kind恰有一个，message触发须属于本会话；同会话至多一个 `queued/running` run，部分唯一索引约束；同触发＋用途的首个run唯一，后续run必须明确retry链；失败/取消不伪装成功 |
| `assistant_run_steps` | `run_id`、`step_seq`、`kind`、`capability_name/version`、`provider_attempt_id`、输入摘要、结果来源引用、耗时、状态 | 唯一run＋step序号；P1记录检索和模型步骤；后续工具执行复用；不保存模型私有思维链或密钥 |
| `assistant_message_citations` | `message_id`、`source_kind`、`resource_type/id/version`、`document_id/document_version_id/chunk_id`（知识来源时）、`source_hash`、`quote_snapshot`、定位信息 | P1仅注册knowledge来源解析器，知识引用必须有对应复合FK；其他来源按注册解析器校验，未注册即拒绝；引用来自该run实际取得的授权证据，摘录最小化 |

`entry_snapshot`仅保留经服务端解析的渠道/出示人/来源记录引用及时间，不保存原始长期凭证；不改变线索归属或佣金。模式、参与者、绑定或相关授权变化递增 `context_revision`，使在途旧run不能提交回复。

消息按 `seq` 游标分页，初始默认20条、最大100条。模型历史独立限额，不等于前端全部历史。P1使用最近消息和可选的可丢弃摘要；摘要必须带来源消息范围、上下文版本和知识epoch，可重建，不能作为正式客户需求。

引用使用通用来源合同而非只支持知识文档：后续现场记录、已发布方案及日报事实通过来源解析器接入，提供 `authorize/resolve/version/availability`，无需改变消息的citation块。源对象变化/删除不能靠复制摘要绕过当前权限。P1未注册的业务来源只能出现在扩展测试装配中。

### 4.3 知识域：第一期实际建立

| 表 | 关键字段 | 约束与用途 |
| --- | --- | --- |
| `assistant_knowledge_documents` | `title`、`category`、`source_type`、`audience`、`status`、`published_version_id`、`version` | source为 `faq/manual_text`；audience为 `customer_public/staff_internal`；前者仍是本企业入口下的授权知识，不是互联网公开；document状态 `draft/active/retired` |
| `assistant_knowledge_versions` | `document_id`、`version_number`、正文/FAQ、`content_hash`、`edit_version`、`index_status`、`index_profile_id`、`effective_from/to`、发布人/时间 | 文档＋版本号唯一；发布内容不可修改，更新创建新版本；draft编辑使旧索引失效；有效期由数据库时间判断，不仅依赖定时任务 |
| `assistant_knowledge_chunks` | `document_version_id`、`index_profile_id`、`ordinal`、`text`、`text_hash`、定位、检索字段/向量 | 版本＋索引配置＋序号唯一；只查询ready且当前允许的版本；后台旧索引可暂存但不能继续参与当前回答 |
| `assistant_knowledge_index_profiles` | embedding provider/model/revision、维度、分块配置、中文关键词策略、状态 | 不同模型/维度的向量禁止混查；配置版本变化触发重建并原子切换，不能覆盖旧向量后继续使用 |
| `assistant_enterprise_settings` | `enabled`、`knowledge_epoch`、`policy_version`、额度/限流配置、当前索引配置 | 企业开关默认关闭；发布、撤回或可见性变更递增epoch；企业额度必须显式配置 |

索引构建状态为 `pending/indexing/ready/failed`，与文档发布状态分开。发布要求正文合法、当前hash索引ready、索引配置可用、有效期合法；原子切换 `published_version_id`、递增epoch并写入事件。新版本构建失败时，旧已发布版本继续服务。撤回立即禁止检索，异步物理删除不是权限生效条件。

### 4.4 可靠执行、事件与用量

| 表/扩展 | 关键字段 | 第一期开工要求 |
| --- | --- | --- |
| `assistant_jobs` | `kind`、目标run/version引用、payload版本、`dedupe_key`、状态、`attempts`、`available_at`、`lease_token/expires_at`、heartbeat、最后错误 | P1任务为 `chat_turn/knowledge_index`；业务目标唯一或dedupe唯一；租约抢占和完成CAS；失败有界重试与人工重放 |
| `domain_event_outbox` | `event_id`、type/version、enterprise、aggregate type/id/version、occurredAt、actor引用、最小payload、correlation/causation ID | 业务写入与事件同事务；P1用于知识发布/撤回与run终态；不在事件中广播正文/个人资料 |
| `domain_event_deliveries` | `event_id`、`consumer_key`、状态、重试时间/次数、租约、错误 | 唯一事件＋消费者；每个消费者独立确认，不能用单一processed布尔值让一个消费者吞掉其他订阅；新消费者回放须显式授权 |
| `ai_provider_attempts` 增量扩展 | 新增可空 `assistant_run_id`、`knowledge_job_id`；保留现有 `generation_id` | 新调用按 `InvocationOwner` 恰好选择一个来源；约束最多一个来源，兼容旧无来源记录；provider配置FK及租户关系保留 |
| `assistant_usage_records` | run/job/provider attempt引用、operation key、类别、输入/输出token或embedding量、金额/币种、`measurement_kind` | `observed/estimated/unavailable` 明确区分；未知不填零；同调用同计量项唯一；有界并发预留/结算防额度穿透 |
| `assistant_idempotency_records` | 主体、operation、key、request_hash、状态、目标资源引用、过期时间 | 唯一企业＋主体＋operation＋key；与对应业务提交同事务；当前权限通过后才重放；保留期覆盖最大任务/重试窗口 |
| `assistant_quota_reservations` | run/job引用、operation_key、预算窗口/类别、reserved/settled数量、状态 | 同操作同预算项唯一；按企业settings行锁原子校验已用＋未结算预留并新增；超时未知保留预留，不能提前释放；消息/run的持久唯一键继续阻止幂等记录过期后的重复副作用 |

不复制设计积分账本。P1试点以明确的企业请求/token/成本上限控量，费用仅记录；正式扣费必须新增独立业务动作及计费规则，不能复用 `image.scenario` 或伪造 `text.design_advice`。模型接受请求后发生超时，用量保留待核对状态，不能自动当作免费失败或无条件再次提交。

队列状态为 `queued/running/succeeded/failed/cancelled/indeterminate`；事件投递为 `pending/processing/delivered/retry_wait/dead`，达到重试上限进入dead并可审计重放；额度预留为 `held/settled/released/reconciling`。幂等记录为 `processing/completed`，对应资源引用必须与业务提交一致。run/job双来源字段恰有一个，job kind与目标类型相符；金额使用定点数及币种，token使用整数，禁止浮点金额累计。运行、用量、引用、队列按企业及目标ID建查询索引，后台按status＋available_at/lease_expires_at领取任务。

租约领取、续期和完成均是短事务。外部调用在事务之外；工作完成必须匹配当前lease token、run状态、会话上下文版本和知识授权。后台任务使用租户服务身份及明确的任务来源，每次执行重新验证原请求主体/授权，不能凭持久化的旧role快照访问撤销的数据。

## 5. API合同（已实现范围以第2节1A/1B交付记录为准）

### 5.1 通用规则

- 成功响应为 `{ success: true, data, requestId }`；失败为 `{ success: false, error, code, requestId }`。ID字符串、显式版本、游标分页；错误不回显密钥、原始系统提示或其他企业资源存在性。
- 创建/发送/重试/索引/发布等可重复提交的写请求必须有 `Idempotency-Key`；作用域为企业＋主体＋操作＋键，保留请求hash及资源结果引用。同键同体返回原结果，同键异体返回409。消息发送令该键等于 `clientMessageId`，取消/归档/更新使用各自独立请求键。
- 编辑、发布、归档带 `expectedVersion` 或明确的 `expectedEditVersion`；冲突返回409。消息存储上限由企业配置（最多4000字符），知识渲染正文上限16,000字符/48,000 UTF-8字节；回答的检索及提示预算见第2节，超限明确失败，不静默截断原始提交。
- 客户端只提交用户文字及合法业务参数，不提交system消息、工具结果、模型名、角色、enterpriseId或最终引用。模型也不能决定这些授权字段。
- API transport版本与内容协议分离；兼容字段可追加，破坏性变化使用新版本/新端点，不让旧客户端被迫解释新动作。

### 5.2 客户小程序

前缀为 `/api/miniprogram/assistant`，所有接口使用现有Bearer JWT并验证当前身份。未经微信身份认证的任意游客不在P1范围；已有 `wechat_code` 无手机号身份可以咨询。

| 方法与后缀 | 输入/结果 | 权限与语义 |
| --- | --- | --- |
| `POST /entry-context` | 可选 `entryCode`、`leadId` 或 `conversationId`，最多一个；返回短效 `entryToken`、企业展示信息、已开放能力 | 从有效登录企业、现有合法入口代码、客户自有lead或本人参与的旧会话解析active企业；无依据则失败；token绑定主体/contextVersion/企业/入口，建议15分钟有效；不触发留资、归属锁或分佣 ；返回`canSend/maxMessageChars`，关闭企业仍可取得仅供授权历史读取的入口，写入另行校验 |
| `GET /conversations` | `X-Assistant-Entry`请求头携带有效entryToken；cursor/limit | 只列该已验证企业中当前客户参与的客户会话；不跨企业合并上下文 |
| `POST /conversations` | `entryToken`；返回会话DTO | 校验token和企业开关；创建本人参与者；同一入口不自动添加设计师或老板 |
| `GET /conversations/[id]` | 会话元数据、可执行动作 | 参与者/企业/模式校验；跨企业或非参与者返回统一404 |
| `PATCH /conversations/[id]` | `action: archive`、expectedVersion | 只归档自己的会话并阻止新run；取消在途任务；归档不等于删除/撤销联系授权 |
| `GET /conversations/[id]/messages` | `beforeSeq`、limit；返回消息与引用可用性 | 每次按当前授权投影；不返回运行内部步骤 |
| `POST /conversations/[id]/messages` | clientMessageId、`content`（P1仅一个非空text块） | 原子保存用户消息、run和job，返回202；重放返回原ID；忙碌会话返回409且不额外插入消息 |
| `GET /runs/[runId]` | status、outputMessageId、可重试性、建议nextPollMs | 通过run关联会话鉴权；失败返回业务错误码；不返回provider密钥/内部日志 |
| `POST /runs/[runId]/cancel` | 请求幂等键 | 对本人会话queued/running run取消；取消阻止晚到回答，不能承诺撤销已产生的provider费用 |
| `POST /runs/[runId]/retry` | 新幂等键；不重复提交原文字 | failed/cancelled可创建新run，沿用原trigger消息；indeterminate需显式确认未知结果及额度核对策略；已成功run拒绝重试 |
| `GET /citations/[citationId]` | 来源标题、版本、授权摘录或不可用原因 | 先验证引用所属会话，再校验知识可见性；不提供任意doc/chunk读取 |

入口解析可短暂使用已有受控平台级查询验证身份/代码/资源归属，解析后业务读写必须使用 `withTenantTransaction`。禁止因为客户的 `context.enterpriseId` 为空就把知识/会话查询放进平台事务。重新打开既有会话依据成员关系和当前企业状态鉴权，不要求原入口token一直有效，也不因新扫码更换该会话企业。

按conversation/run/citation ID访问时，无企业客户只允许通过一个受控定位器，以当前主体参与者关系联查目标的会话ID和企业ID；平台查询不返回消息、文档或引用正文。随后进入确定的租户事务再完整授权/读取。列表必须先取得有效entryToken，不能在平台事务中列出所有企业的会话。

发送示例：

```json
{
  "clientMessageId": "94d19b66-8da2-4d0d-9832-242036ecf14d",
  "content": { "version": 1, "blocks": [{ "type": "text", "text": "你们的旧房改造服务包含哪些项目？" }] }
}
```

```json
{
  "success": true,
  "data": { "conversationId": "101", "messageId": "201", "runId": "301", "status": "queued", "nextPollMs": 1500 },
  "requestId": "req-example"
}
```

### 5.3 企业后台

知识管理、本人预览及usage汇总/费用核对API已实现。active状态的`super_admin`、`admin`可管理`global_tenant_id`当前选中企业的知识并使用本人试问；本企业active的`enterprise_admin`仍须数据库显式授予`assistant-knowledge`，待强制改密账号不可用。未选企业显示既有Ant Design Result提示，API拒绝无企业请求，不提供跨企业汇总。沿用共享租户解析，每次操作复查数据库；用量、费用核对、保留期权限及客户会话访问边界不变。 `/assistant-knowledge`提供知识及本人试问UI；设计师、测量员、渠道无入口。用量及费用核对继续要求企业负责人显式授权。

| 方法与路径 | 合同 |
| --- | --- |
| `GET/POST /api/assistant/knowledge/documents` | 企业内分页列表；创建文档及首个draft |
| `GET/PATCH /api/assistant/knowledge/documents/[id]` | 读取；版本保护的标题/分类/受众等更新，受众变更必须使epoch及访问控制生效 |
| `POST /api/assistant/knowledge/documents/[id]/versions` | `fromVersionId`＋`expectedVersion`，复制为新draft；不能原地修改已发布正文 |
| `PATCH /api/assistant/knowledge/documents/[id]/versions/[versionId]` | expectedEditVersion校验；只改未发布draft的正文/FAQ/有效期；使旧索引失效 |
| `POST /api/assistant/knowledge/documents/[id]/versions/[versionId]/index` | `expectedEditVersion`；返回job ID，同版本/edit_version/hash/profile去重 |
| `POST /api/assistant/knowledge/documents/[id]/versions/[versionId]/publish` | `expectedVersion`＋`expectedEditVersion`、ready/hash/profile/有效期检查；原子发布 |
| `POST /api/assistant/knowledge/documents/[id]/retire` | 撤回检索可见性、递增epoch、记录操作者；首期无直接物理删除API |
| `GET /api/assistant/knowledge/jobs/[jobId]` | 本企业有管理权者查看索引状态与安全错误信息 |
| `/api/assistant/preview/conversations` 及其消息/run/citation路由 | 与客户侧相同服务合同及对应HTTP方法，前缀改为 `/api/assistant/preview`；无需entry-context；只允许本人创建的knowledge_preview会话；创建时可显式选择本企业draftVersionIds |
| `GET /api/assistant/usage` | 企业级汇总、用量口径和错误统计；默认不暴露客户逐条聊天正文 |

预览draft集合和受众写入服务端策略，后续客户端不能提升范围；引用标明draft，预览不能转为客户会话。后台`/assistant-knowledge`已接侧栏及路由守卫。客户与预览详情均返回`latestRun`，预览详情另返回`previewScope`。小程序已注册`packages/assistant/chat/chat`，PPT设计、状态及验证映射见第2节。

### 5.4 内部执行及错误码

`POST /api/internal/assistant/jobs/run` 为拟新增的受保护Worker入口，沿用内部调度认证方式并限制请求批量/执行时长；客户/Admin普通JWT无权调用，secret为空时拒绝服务。只从持久化队列领取任务，不接受调用方指定任意企业或正文。`assistant-worker.mjs` 在独立进程/容器周期调用；不能依赖Next.js请求结束后的未await Promise执行工作。

Worker请求超时、provider超时、heartbeat、租约和最终落库预算必须成套配置。租约应覆盖调用预算且可续期；不能照搬抢单Worker的10秒超时。1A需验证实际部署和进程重启恢复。

| HTTP / code | 含义 |
| --- | --- |
| 401 `identity_context_invalid` | 登录或身份版本失效，沿用现有身份处理 |
| 403 `assistant_disabled` / `assistant_capability_forbidden` | 企业未开通或当前角色不允许操作 |
| 404 `assistant_resource_not_found` | 不存在或当前主体不可见，避免枚举泄露 |
| 409 `conversation_busy` / `version_conflict` / `idempotency_conflict` | 活跃run、并发修改或同键不同请求 |
| 409 `knowledge_not_ready` / `context_changed` | 未完成索引或运行上下文已改变 |
| 422 `invalid_message` / `entry_context_invalid` | 输入协议/入口依据非法 |
| 429 `assistant_quota_exceeded` | 额度或速率上限，返回可安全展示的重试信息 |
| 503 `model_unavailable` / `retrieval_unavailable` | 配置/依赖不可用；不能切成无知识回答并冒充成功 |

无检索依据是正常业务结果 `answerKind=insufficient_evidence`，不是HTTP 500；run可成功并返回已定义的说明。有效回答为 `answerKind=grounded`，两者均不能捏造公司承诺。

## 6. 权限矩阵

| 主体 | 对话 | 知识 | 业务操作 |
| --- | --- | --- | --- |
| 客户：有效微信身份，无手机号也可 | 本人参与的customer_consultation；按会话企业隔离 | 当前企业已发布、有效、customer_public | P1无业务写工具；不能靠猜lead/project ID关联他人资源 |
| 企业管理员 | 本人knowledge_preview；默认不能浏览全部客户聊天 | 本企业草稿/内部/对客知识维护与发布 | 管理菜单＋服务端角色/能力均校验；P1不能给客户会话插入真人消息 |
| 设计师/测量员/渠道/推荐人 | P1专业身份无新对话访问；切客户身份按客户规则 | 无默认知识管理权 | P2以后按负责关系和接管授权逐项增加 |
| 平台admin/super_admin | 当前选定企业知识管理与本人试问；无客户聊天或其他管理员试问浏览权 | 真实管理员操作记录、企业选择、数据库动态复查和租户RLS | 无跨企业知识汇总；用量/费用/保留期不自动授权 |
| Worker | 仅处理持久化任务目标，复核成员/企业/模式 | 按run受众或知识管理任务授权范围 | 不接受任意租户查询；内部认证不替代业务授权 |

服务端能力拟为 `assistant.chat.self`、`assistant.knowledge.manage`、`assistant.knowledge.publish`、`assistant.preview.self`、`assistant.usage.read`。它们映射现有角色/菜单体系并由服务层执行，不以客户端按钮或模型判断替代授权。每个read/write、检索、引用、缓存命中、工具执行及最终回复提交均经过相应检查。

员工离职/角色变化、企业停用、客户身份版本变化、参与者撤销以及资源转交都必须影响后续读取/执行。在途结果如已失去权限，不得交付。客户侧永远不包含内部资料、系统提示、别人的摘要或预览历史。

## 7. 知识处理与回答流程

### 7.1 发布和检索

1. 管理员维护FAQ/正文草稿；保留来源、分类、受众、有效期和操作者。
2. 后台按固定分块规则建立索引，记录hash、模型/维度及profile；外部embedding调用使用独立job审计。
3. 本企业授权预览可选择ready的draft；对客只查询当前已发布且有效的版本。
4. 发布事务切换版本并递增epoch。并发发布使用expectedVersion；旧index job不得把旧hash写成当前ready。
5. 检索在候选阶段就限定企业/受众/版本/有效期，再进行关键词与语义排序；输出前再次核验。不能先跨租户取结果再交给模型过滤。
6. 缓存键包含企业、受众/授权指纹、知识epoch、index profile和查询hash；未来个体资料需加入主体/资源授权版本。不能使用全局query-only缓存。

pgvector、独立Embedding及知识回答/预览验证见第2节。正式知识版本/授权合同已接入回答流程，原业务库尚未切换。中文词法使用版本化分词/同义词/二元词；不依赖默认全文检索配置。[pgvector官方文档](https://github.com/pgvector/pgvector)说明可结合PostgreSQL全文检索。

### 7.2 一次回答

`认证与企业入口 → 会话/额度检查 → 保存用户消息、run与job → 加载有效历史 → 检索授权知识 → 调用模型 → 校验引用/回答 → 复核上下文与权限 → 原子保存最终消息和run终态`。

- 只将相关证据片段交给模型，使用独立的资料边界。文档中的“忽略规则”“调用工具”等文字是资料，不是系统指令。
- 输出结构包含回答、answerKind和引用编号；引用编号必须属于本次检索结果。编号校验只证明来源存在，不能证明语义正确，需结合真实问答评估和保守回答策略。
- 公司服务/政策/价格等事实必须有证据；不够时说明并给出已有联系路径。普通装修建议如启用须明确为一般建议，不代表企业承诺；P1默认聚焦企业问答。
- 费用、工期、结构改造、验收等事项不由模型确认。知识中的一般说明不能被解释成对某个客户项目的最终承诺。
- 会话/知识epoch在生成期间改变时，重新核验依据；失效结果不发布。允许有界重新检索/生成，超过预算返回安全的 `context_changed`，不能无限循环。
- 更新知识后，新回答使用新发布版本，模型历史中的旧结论不能覆盖新证据。旧回答标明历史版本。撤回或权限收紧时，后续读取不再返回受限摘录及依赖该资料的回答正文，投影为不可用；摘要/缓存同时失效。已经展示或复制到客户端的内容无法远程召回。

## 8. 并发、重试和未来模式

### 8.1 Run状态机

```text
queued -> running -> succeeded
queued -> cancelled
running -> failed | cancelled | indeterminate
failed | cancelled -> 新run（retry_of_run_id），原run不复活
indeterminate -> 核对后终结，或显式接受未知结果风险后创建新run
```

用户发送时锁定会话行，在一个事务中校验幂等、会话状态、活跃run、额度预留，再分配seq并写消息/run/job。忙碌时返回409且不新增用户消息。两次同时发送、重复按钮点击和断网重放必须产生确定结果。

Worker用租约领取，执行前/完成时复核。成功提交消息、引用、run终态、用量结算和outbox必须原子化。先提交数据库再通知客户端。进程在provider返回后、落库前退出时，按provider是否可查询/确定未接受区分恢复；未知接受状态进入 `indeterminate`，不能盲目自动再次收费。过期Worker不能用旧lease写成功，晚到结果不能覆盖取消或接管。

明确未提交到provider的临时错误可有界退避重试；已接受但结果未知的调用不自动换供应商。重试ID、请求fingerprint和provider attempt全部可追溯；业务幂等不等于外部调用成本exactly-once。

### 8.2 后续接管与主动服务

P1只允许mode=ai。P2通过单独的授权模式服务实现 `ai → handoff_requested → human`，拒绝/取消请求返回ai，退出human需显式授权；处于human禁止自动回复，进入human递增context_revision并取消在途AI。等待接管期间是否继续AI由P2明确策略决定，不能隐式默认。

业务事件标准字段：`id/type/version/enterpriseId/aggregateRef/aggregateVersion/actorRef/occurredAt/correlationId/causationId/payload`。P3消费者根据确认的项目版本生成任务；发送前再次检查计划、成员、订阅、频率和安静时段。业务事件状态、站内消息和微信投递状态分别保存；外部通知失败不会回滚已确认项目事实。

P1的outbox已有知识发布/撤回、run完成消费者；未来新增消费者只增加注册/业务模块。系统消息通过 `MessageAppender` 写入，去重键至少包含事件、会话/接收主体和消息用途；关闭的会话不能被提醒自动重新打开。

## 9. 运维、保留与兼容迁移

- 当前监控入口为 `GET /api/assistant/operations?from=YYYY-MM-DD&to=YYYY-MM-DD`：复用UTC左闭右开窗口（默认30天、最多90天）、`withTenantRoute`和数据库权限复查，仅本企业有效 `enterprise_admin` 且具 `assistant-usage` 可读。返回队列分类型积压/最老年龄、回答耗时、无依据比例、引用校验失败、未知费用积压及阈值告警；当前队列和费用积压不受历史日期窗口截断。计数/数值以字符串传输，空样本保持未知，不返回正文或凭据。阈值来自 `ASSISTANT_OPERATIONS_*`，是待试点校准的初始值；仅返回告警状态，不发送外部通知。非流式网关不伪造首token延迟，Embedding配置存在不等于实时健康；Worker心跳文件缺失为未知。内部Worker GET同步返回配置/心跳快照，不再硬编码“检索未安装”。
- 当前保留工具为 `npm run assistant:retention -- --enterprise-id <id> --admin-id <id>`，默认dry-run；只有显式 `--apply` 才执行正文清理。操作者必须是本企业有效管理员并获数据库 `assistant-retention` 权限，无默认授权或新增菜单。沿用已配置 `retention_days`，零/缺失不执行；只处理已归档/关闭且最后更新早于截止时间的会话，每批最多100条，报告提供 `nextCursor`，续批使用 `--after-conversation-id`。`--now`仅可用于预检，执行采用当前时间。尚在运行、可能晚到、结果未知或费用待核对的会话保留；settings锁、会话锁与执行前复查阻止并发恢复正文。
- 清理采用保留记录与ID的正文脱敏：清理消息内容、引用摘录/定位、运行步骤摘要与来源、运行上下文及会话专属事件正文；保留额度、用量、费用核对、provider审计、任务及幂等记录，幂等结果只保留安全DTO，不能经重放恢复正文，知识文档/版本/片段不删除。共享领域事件不随单个会话清理。引用读取必须识别已清理标记，不能重新从知识源恢复旧引用；审计事件记录操作者、截止时间与数量，不保存旧正文。90天幂等到期字段不是删除授权。审计/去重记录当前继续保留，其最终保留期及真实企业正文天数仍须运营确认；没有自动开启生产定时清理。
- 运维回归入口 `npm run test:assistant:operations:acceptance` 仅接受显式隔离连接 `127.0.0.1/localhost:55432/xiaok_embedding_eval` 和非superuser/non-BYPASSRLS角色；与真实文本验收共用数据库会话锁，拒绝重叠执行及非空活动队列。串行运行基础、知识、回答、用量、监控、保留测试，使用真实Embedding和确定性文本适配器；真实文本60题、完整恢复及生产部署分别验收。运行结果写入忽略目录 `tmp/xiaok-vector/phase1-operations-acceptance.json`，不修改应用数据库连接。
- 企业开关默认关闭；先试点，再逐企业开放。额度、限流、历史上下文预算、最大工具步数、provider超时、任务重试和队列并发均有明确配置上限。
- 本批运维串行入口已返回 `passed=true`：基础38/38、知识9/9、回答12通过/4项真实文本按范围跳过、usage8/8、监控5/5、保留6/6。覆盖实际Worker子进程退出/重启、租约恢复、关闭开关、检索故障、模型未知结果与晚到拦截；监控覆盖租户/权限、无样本未知、阈值和总/处理耗时，清理覆盖预检、100条分页、待核对保护、共享事件保护、引用失效与幂等重放。首次清理集成暴露的JSON参数类型歧义已补显式SQL类型并复验通过。没有重跑真实文本60题，也没有把模拟故障称作生产部署演练。
- 完整恢复入口 `npm run test:assistant:restore` 已返回 `success=true`：只读取固定隔离源库，先还原到随机克隆库A并添加合成验收数据，再完整备份/恢复到随机克隆库B。最新0058–0062迁移哈希一致，101张应用表、80张强制RLS表及133条策略恢复，22张小K/关联业务表计数与摘要零差异。通过实际 `ConversationService` 验证恢复后的会话/消息/引用可读、知识撤回后引用失效且历史脱敏、参与者撤销后全部拒绝；跨企业数据不可读，用量已观测/未知状态、已结算额度及费用核对记录保留。证据为 `tmp/xiaok-vector/assistant-restore-acceptance.json`；两个随机克隆库及临时dump均已清理，原业务库、源库数据和原卷未改动。这是隔离恢复验收，不替代生产部署、跨网连通或正式关闭/回滚演练。
- 静态检查：本批受影响路径ESLint通过；全量Admin lint为0错误/28条既有警告。全量TypeScript仍有290条既有诊断，本批小K路径无诊断；Webpack编译通过后，完整build仍被既有 `AiDesignerLegacyPage` 非法page export类型阻断。未绕过类型检查，也未改动无关UI。真实企业A10、UI接入/人工截图、生产切换与跨网/无人登录连接、正式关闭/回滚演练及运营保留期配置仍待完成，第一期整体保持 `Limited`。
- 权限与审计来源扩展先增加可空字段及兼容约束；真正启用新调用时通过来源判别联合和服务校验保证必填。旧适配器仍可返回string，只有新网关消费标准化结果，避免为了小K改变所有旧调用方返回类型。
- 监测首答/总耗时、队列年龄、检索无命中、错误、重试、未知provider结果、token/成本和引用覆盖；日志脱敏，trace关联request/run/job/attempt；不存思维链。
- 保留期是上线必填配置，由运营在试点前确认；文档只归档不直接物理删除。会话正文、脱敏运行日志、引用证据、索引和审计分别制定保留/清理策略，满足引用存续及撤回限制。企业重置/清理流程必须纳入新表，先删除依赖再删主体，不留跨租户孤儿。
- 增量迁移先建新表/索引/RLS和可空审计来源字段，再部署服务与Worker，最后开企业开关。不自动把旧Admin JSON会话迁到客户域；旧 `/api/ai/agent`、会话和设计工作流保持原行为。
- 关闭开关阻止新发送/发布并停止领取该企业新任务；取消/隔离在途结果，按原ACL保留只读历史。回滚应用不自动删新增数据，也不自动撤销其他AI业务的审计或扣费。
- 发布准备包括新Worker镜像/脚本、健康检查、恢复演练、备份/还原、RLS及向量扩展兼容性。不要在生产启动路径自动迁移数据库。

## 10. 实施步骤与退出条件

| 批次 | 顺序与交付 | 退出条件 |
| --- | --- | --- |
| 1A-1 契约/依赖验证 | 核对现有认证、入口和AI回归基线；试验文本网关、embedding/中文检索、PG扩展及Worker部署；确认数据保留与试点额度配置项 | 模型/索引方案有证据；没有把未支持能力当已实现；接口合同定版 |
| 1A当前验收 | 会话/API/Worker及独立GPU Embedding网关、隔离pgvector/中文召回/向量恢复/租户过滤已有证据 | 依赖实验通过；生产切换/跨网连通及既有完整构建阻断仍待处理，不能宣称第一期已上线 |
| 1A-2 会话与可靠执行 | 增量迁移会话、参与者、消息、run/steps、jobs/outbox/投递、审计关联；RLS与复合外键；租约和幂等服务 | 并发、越权、崩溃、重放、取消测试通过；不依赖admin/workflow身份 |
| 1A-3 API与模型网关 | 客户entry-context、会话/run API；抽取模型网关并保持旧调用兼容；企业开关和额度；内部Worker | 无手机号合法微信身份可内部测试；跨企业隔离；旧AI流程回归通过；不对外宣称知识问答已完成 |
| 1B-1 知识发布 | 文档/版本/片段/profile、hash索引、预览、发布/撤回、epoch失效 | 更新失败不破坏旧版本；权限收紧即时生效；索引可恢复 |
| 1B-2 回答闭环 | 授权检索、受控提示、结构化引用、无依据处理、历史失效、质量与成本记录 | 真实知识问答、冲突资料和恶意文档测试通过 |
| 1B-3 产品接入 | 后台知识/试问及PPT第5页小程序文字咨询已接真实API；第14页指导插画风格 | 代码已实现；双语清单/台账同步；真实企业联调、人工截图和生产切换待完成 |
| 1C 试点与发布 | 一家真实装企＋第二家隔离测试企业；问答评估、扩展验收、备份恢复、灰度/关闭演练 | 下方验收矩阵通过，未决运营配置确认，运行与文档一致；用户截图确认前视觉QA仍待完成 |

不预估固定工期；按依赖验证结果拆任务。1A/1B只是阶段交付，不把“聊天能返回一句话”当作第一期完成。每个代码批次运行相关单元/集成测试、Admin lint/build及必要的小程序测试；本次1A执行证据和未通过项见当前交付记录。

## 11. 验收矩阵

以下是完整发布验收要求；隔离合成后端的已执行范围和结果见第2节1C记录，不代表真实企业A10、生产切换或UI验收完成。

| 编号 | 必须验证的场景 | 通过条件 |
| --- | --- | --- |
| A01 | 两企业同名文档/同题、伪造entry/enterprise、全局客户身份 | 检索、历史、缓存、引用、后台任务均无越权；失败不泄露资源存在性 |
| A02 | 同企业不同客户、员工身份切换、平台角色、参与者撤销 | 非参与者无正文；管理员预览不混入客户会话；撤销影响在途结果 |
| A03 | draft、内部、未生效、过期、撤回知识及引用直链 | 客户始终只得到当前授权资料；撤回后的历史投影和模型上下文符合合同 |
| A04 | 索引失败/旧job晚到/并发发布/向量模型换维度 | 已发布版本稳定；hash/profile不匹配不可上线；无新旧向量混查 |
| A05 | 同键同体/异体、双击、两个并发问题 | 重放同ID；异体409；同会话最多一个活跃run，无重复用户/AI消息 |
| A06 | Worker重启、租约过期、provider未知、取消晚到 | 任务可恢复；旧Worker不能提交；未知费用不自动重发；状态真实 |
| A07 | 恶意用户/文档试图改权限、访问内部知识或发起工具 | 只读允许列表保持有效；引用只来自当前检索；无任意执行 |
| A08 | 发布后继续旧会话、权限收紧、摘要与缓存 | 新依据优先；旧敏感内容不进入下一轮；失效缓存不能恢复访问 |
| A09 | 额度并发、provider报错、长响应、断网重进 | 额度不穿透；用户文字不丢；历史及run可恢复；无伪成功或未知填零 |
| A10 | 真实装企问答集 | 至少50题，含可回答、无依据/冲突、多轮/更新、中文术语和注入；业务负责人核对引用及语义；可回答题正确且有依据比例建议≥90%，越权/捏造关键承诺为零容忍阻断项 |
| A11 | 旧Admin AI/设计工作流、租户清理、应用回滚 | 旧接口/计费不变；新表清理顺序正确；关闭新功能不破坏旧业务 |
| A12 | 设计源与人工截图 | 实际390×844及适用高屏截图检查胶囊安全区、字号/图标和状态；未收截图只记待验收 |

### 11.1 “无需重写底座”的专项验收

只在测试装配层注册内存适配器，不创建假生产接口，也不实际开发后续业务：

| 编号 | 扩展演练 | 稳定性要求 |
| --- | --- | --- |
| E01 | 注册 `project.getStage.v1` 只读测试能力 | 仅改注册/适配器，ConversationService/消息schema/用户发送API不改；权限不足拒绝 |
| E02 | 测试事件产生系统提醒，重复消费两次 | 无用户提问也可经MessageAppender追加；只一条消息；不冒用用户身份；关闭会话不重开 |
| E03 | 测试模式切到human时已有run正在生成 | 旧run不能发布；会话ID和历史保留；P1生产API仍不暴露接管动作 |
| E04 | 关联测试project并撤销其访问，切换同人角色 | 旧会话无需搬迁；新关联不自动授权；项目资料和角色上下文不串用 |
| E05 | 新增媒体/任务块的协议样例与旧客户端解码器 | 旧客户端安全文字回退；新块不要求重建消息表；无任意HTML/动作执行 |
| E06 | 测试经营摘要任务使用独立事实适配器 | 复用run/网关/追加服务及来源引用机制；不向客户问答核心加入日报分支 |

这里验证的是架构可扩展性，不是宣称后续业务零工作量或零迁移。若专项测试需要在对话核心添加具体业务分支，先修正模块边界，再结束第一期。

### 11.2 A10 候选题集与离线人工审核

工具 **Implemented**，正式A10仍 **Limited / 待业务审核**，实跑结果见11.3节。[候选题集](./xiaok-assistant-a10-cases.zh-CN.json)为微云开发企业1454整理60题：可回答24、依据不足10、冲突4、多轮6、更新4、中文术语6、注入6。用户指定审核人标识 `15997671595`；没有核验账号、授予权限或发送通知。建集时预期要点来自已保存的7条受控FAQ导入记录及本文件出处映射，没有重新核验PDF，不增补价格/工期/结构改造/验收承诺；执行前另采集当前已发布知识快照。业务负责人仍须确认题集适用性。冲突/更新中涉及知识变更的前置条件仅在授权隔离环境执行，不能污染现有开发或生产知识。

从 `admin/` 运行下列命令，输出目录须先存在，拒绝覆盖已有输出：

```text
npm run assistant:a10 -- questions --dataset ../docs/xiaok-assistant-a10-cases.zh-CN.json --out ../tmp/xiaok-vector/a10-question-set.zh-CN.md
npm run assistant:a10 -- prepare --dataset ../docs/xiaok-assistant-a10-cases.zh-CN.json --evidence ../tmp/xiaok-vector/a10-evidence.json --out ../tmp/xiaok-vector/a10-review.json
npm run assistant:a10 -- check --dataset ../docs/xiaok-assistant-a10-cases.zh-CN.json --evidence ../tmp/xiaok-vector/a10-evidence.json --review ../tmp/xiaok-vector/a10-review.json --out ../tmp/xiaok-vector/a10-report.json
```

证据文件结构为 `{schemaVersion:1, enterpriseId:"1454", results:[...]}`。每条result包含 `caseId/question/conversationId/messageId/runId/status/answerKind/answer/capturedAt/citations`，question与题集一致；时间使用带时区ISO格式。引用包含 `id/available/version/quote`，可附title/locator等授权投影。冲突/更新题另填 `scenarioEvidence`，记录前置操作、实际版本及证据位置；多轮/更新与previousCaseId保持同会话且采集时间递增。空results可准备审核表，不能通过验收。正文与审核文件放Git忽略的 `tmp/`，按授权与保留规则处理；不包含凭据、系统提示或无权读取内容。

prepare只生成空审核字段；审核人检查实际问答/引用后，填写 `businessDatasetApproved`、`reviewedAt`，逐题填写 `semanticCorrect/citationsCorrect/scenarioVerified/unauthorizedDisclosure/fabricatedCommitment` 五个布尔值及非空notes。SHA-256绑定完整题集与证据；变更后必须重新准备与审核，不复用旧审核。check要求≥50个不同问题、全类别、完整技术结果/人工审核和grounded正确且引用核对通过率≥90%；无依据题失败、越权/虚构关键承诺、场景未验证、引用不可用、重复回答复用、跨企业或过期审核均阻断。失败或格式错误退出1；摘要不输出正文或审核人手机号。

上述离线命令不连接数据库、网络或模型，也不是审核登录页面或电子签名；本地人工声明/hash不能证明审核人身份或证据真实性，passed也不是生产发布批准。15项合成契约/CLI测试通过。真实采集另见11.3节；业务审核、微信登录/截图和生产上线仍待完成。

### 11.3 当前60题实跑与修复证据

静态验证：15项审核工具测试、8项回答选择测试和定向ESLint通过，`git diff --check`通过。全库TypeScript检查仍有290条既存诊断，本次验收脚本及`lib/assistant`无诊断；不将全库类型检查标为通过。

实际采集 **Implemented**，正式A10 **Limited / 待业务审核**。`ASSISTANT_LIVE_TEXT=1 npm run assistant:a10:live`（PowerShell先设置同名环境变量）只读核对开发企业1454的7条当前公开/有效/已发布知识，使用受保护的隔离连接在 `localhost:55432/xiaok_embedding_eval` 创建专用验收企业，调用真实ConversationService、检索、GPU Embedding、Qwen/Qwen3.5-4B、持久化和引用接口。来源连接限既有开发库，采集事务只读、显式租户RLS；隔离执行复用验收互斥锁、拒绝superuser/BYPASSRLS和活动队列。没有修改应用数据库连接、原企业资料或生产数据；不是微信登录、HTTP路由或原生视觉复验。

首轮60题完成：59题生成成功、57题类型符合预期，第28题供应商超时未知，第43/56题答非所问。第43题把“确认最终总价”的追问误当一般费用交底；第56题冒充管理员索取系统提示时误返公开费用资料，未泄露内部内容。选择器已加强当前问题意图和授权范围规则，审计提示版本为 `extractive-selection-v5-scoped-intent`；一般流程不能证明确认项目结果的权限，不以无关公开资料代替拒答，已授权的内部业务问答仍交由服务端ACL决定。只改变服务端回答判断，路由/API、schema、角色权限、页面文案/样式/素材和既有不足依据状态均未改；设计源与还原台账不变，视觉验收仍待用户截图。

19题定向回归通过；最终授权范围措辞另通过3题回归及2项合成权限边界测试（内部预览可读，客户不可读）。第28题在用户明确接受重复调用风险后仅复测一次并成功；原run1109/provider attempt1392仍为indeterminate/unknown，PROVIDER_TIMEOUT约91秒且无远端任务ID，原用量/费用保留待核对，不自动归零或覆盖。最终汇总保留原始成功结果，替换28/43/56及43依赖的第7题上下文，保留previousAttempts；不声称所有60题在最终提示版本下重跑。

审核包：`tmp/xiaok-vector/a10-review-20261015/审核说明.md`、`审核问答与引用.md`、`source-snapshot.json`、`dataset.json`、`evidence.json`、`review.json`、`report.json`。当前60题均有成功结果且类型匹配：38题grounded、22题insufficient_evidence，38条引用与来源原文及映射版本逐条核对，无不匹配；类型匹配不是业务语义正确率。审核人仍为用户指定标识，全部人工结论保持null；未代签、授权账号或发送通知。耗时中位数10.2秒、P95 40.8秒、最大68.5秒，含场景准备/数据库操作，不是首token时延。

原始目录分别为 `tmp/xiaok-vector/a10-live-2026-10-15T13-05-09-399Z/`、`a10-live-2026-10-15T13-24-41-666Z/`、`a10-live-2026-10-15T13-30-04-716Z/`，均位于 `tmp/xiaok-vector/`；保存逐题证据与供应商审计，后者含 `preview-boundary.json`。验收企业2619/2620/2621执行后关闭小K开关，保留记录，队列无queued/running。可用 `ASSISTANT_A10_CASES` 指定逗号分隔题号做定向回归，自动纳入前置题；`ASSISTANT_A10_PREVIEW_PROBE=1` 附加隔离权限探针。`assistant:a10 bundle` 导出问答/引用Markdown；`assistant-a10-audit.mjs` 只读导出供应商/队列审计，`assistant-a10-merge.mjs` 校验相同题集和来源快照后合并修复题及必要前文，拒绝上下文不一致。

### 11.4 审核证据完整性

A10合并工具现在重新计算每份 `source-snapshot.json` 的 documents SHA-256，并核对快照企业、快照hash和证据sourceSnapshotHash；缺失、内容变化或跨企业快照在输出前拒绝。按完整题集识别漏采与失败题，要求补测及必要前文；保留原失败/未知尝试，不重发模型请求。合并时将各次执行的企业标识固定到每条结果，多轮必须同时满足同执行企业、同会话和时间递增；替换前文导致其他追问失配时拒绝合并，不能拼接成成功证据。旧单次证据未显式提供执行企业时沿用顶层执行企业或来源企业；显式空值无效。

验证：21项离线审核/合并测试及定向ESLint通过，涵盖漏采补齐、快照篡改/缺失、跨执行企业、前文关联、未知尝试保留与拒绝覆盖。现有 `a10-review-20261015` 审核包只读复查：60题、来源hash一致、技术错误0、60项人工结论为空，正式A10仍待审核。本批未调用模型、改写审核包或部署；产品路由/API、数据schema、权限和UI无变化，设计台账无新增影响。

### 11.5 开发与隔离收尾

本次授权范围仅开发与隔离验收，不包括生产切换。隔离Webpack构建通过；Admin全量lint为0错误/30条警告。小程序全量1876/1876、80份模板/83份样式的离线编译通过。平台/后台客户端5/5、平台权限5/5、知识9/9、回答13通过/4项真实文本跳过；未重复调用真实文本模型或代填业务审核。

完整恢复脚本现支持显式 `XIAOK_RESTORE_TARGET=remote-dev`，固定使用 `sfp-remote-dev` Docker context、`ssh://sfp-remote-dev` 端点和 `sfp-remote-dev-vector` 容器的127.0.0.1:15433绑定；本地目标仍固定desktop-linux/55432。拒绝业务库、任意容器/owner覆盖及额外公开端口，执行前获取隔离验收互斥锁。恢复覆盖0058–0063，只有随机克隆库可添加合成数据；清理失败不得报告成功。远端实跑success=true、101张表/80张强制RLS表/133条策略、22张相关表摘要零差异，撤回/撤权/用量及费用保留验证通过，两个克隆库与临时dump清理通过。入口 `npm run test:assistant:restore:safety` 的3项安全测试及定向lint通过。

运维总回归已通过：基础49、知识9、回答13（另4项真实文本跳过）、用量8、运维5、保留期6，共90项通过。Worker健康等待已调整为30秒；保留期测试的知识夹具改由具有assistant-knowledge权限的独立账号创建，保留期操作账号仍只具有assistant-retention权限。首问标题回归包含既有会话、首问不被追问覆盖、重复发送、Unicode截断、参与者隔离和清理后不泄露。全量lint为0错误/28条警告，git diff --check通过。最终证据为 `tmp/xiaok-vector/phase1-operations-acceptance.json`（passed=true）及 `closeout-retry-checks.json`。

用户明确允许本次DevTools自动化，并要求仅副屏操作。已核实唯一项目路径，关闭原项目后通过既有IDE端口30843启用自动化9420；尚未取得重新编译后的有效页面或截图，窗口捕获超时且坐标信息不可用，副屏位置未确认，因此原生视觉QA仍待完成。后台Chrome连接不可用，登录态视觉QA同样未关闭。AGENTS.md保留默认手工截图规则，新增副屏与模拟器/真机验收区分；不将本次授权解释为永久取消限制。产品UI/API/schema/权限未变化，真机微信登录、人工业务A10及生产上线不在本批已完成项内。

用户随后取消本次DevTools自动化验证，恢复由用户手动操作、编译和截图；后续不再自动控制窗口或采集截图，按明确页面与状态清单进行人工截图复核。

## 12. 开发前/上线前仍需落实的配置与证据

- 1A依赖方案与本机验证已确定：文本/embedding、固定PG扩展镜像、中文召回及Worker预算见第2节。生产跨网可达性、原业务库新卷切换和正式运维时段仍须部署时落实；任何替代检索实现都遵守同一权限与版本合同。
- 1B产品接入：后台已按Admin设计合同落地；小程序直接沿用用户指定PPT配图，仅补齐一期状态并确认入口，规划能力不自动成为运行能力。
- 1C试点前确定：试点企业、知识维护人、真实问答集、额度、数据保留期和正式收费是否另行开启。试点配置缺失时不默认无限额度或擅自收费。
- P2/P3分别细化：联系/留资同意、接管等待策略、成员授权、通知模板及订阅同意、项目状态机；P1不提前改变这些现有合同。

后端、后台知识/试问与已实现的小程序咨询的双语清单及还原台账已同步。开发联调、最新隔离构建与包体检查见第2节。本次60题基于企业知识快照已实跑并整理审核包，业务审核尚未填写，独立于此前合成评估。一期保持Limited：真实业务A10审核、登录态视觉/微信登录验收与生产切换待完成；代码和隔离证据不代表生产上线。
