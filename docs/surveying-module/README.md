# 正式量房模块

`miniprogram/packages/surveying/editor/surveying-editor.*` 是唯一正式量房页面。
小程序完整功能索引见 [小程序当前功能清单](../miniprogram-system-modules.zh-CN.md)，
正式数据合同和旧数据清理命令见 [formal-surveying.md](./formal-surveying.md)。

该唯一正式测量路由于 2026-08-12 获得用户明确批准，作为 Canvas 几何、测量、
吸附、标注和状态渲染算法的常设 HTML-first 例外：可在明确开发授权后直接修改
`packages/surveying/editor/surveying-editor` 及其原生 Canvas 渲染链路，不制作 HTML
对照原型，也不计算 HTML 相似度。该例外不扩展到其他小程序路由；设计来源核对、
正式数据合同审查、定向与完整测试、现有微信开发者工具窗口验证、中英文模块文档和
设计还原台账更新仍是完成条件。开发者工具截图遗漏原生 Canvas 时，必须补真机验证。

仓库根目录的 `research/legacy-zhouse-2d/` 是不进入小程序包的旧 APK 2D 独立还原
实验室，不是正式量房页面或运行时依赖。正式小程序与后台不得导入它；其独立研究模型、
中间绘制命令和测试输出均不得写入 `FloorPlan.layoutData`。只有经过明确审批和验证的
单向适配器才可在后续阶段把已证实的算法行为转换为 version-4 读模型或墙图操作。

## 编辑器标题与状态跟随式引导

### Canvas 引导层（2026-08-05）

小K提示是主 `survey-canvas` 的非交互绘制层，而不是覆盖在原生画布之上的
`cover-view`。对话框、浅绿描边箭头尾巴、水平居中的“小K提示”、小K图片、目标光圈、
绿色虚线贝塞尔弧线及其箭头使用同一画布坐标系重绘；指向底部控制坞时例外地由既有
`cover-view` 按钮内部的原生描边标记绘制高层高亮，未增加独立全局覆盖层。因此出现引导时，画布仍完整接收
光标拖动、平移和双指缩放，底部按钮也继续持有点击或拖拽事件。顶部“引导”仍是本机持久化开关。该表现层不改变 v4 墙图、
草稿、测量审计、API 或角色边界。

正文按 Canvas 当前字体和卡片实际内宽测量后换行，不得按固定字数造成右侧裁切；旧的 WXML
量测气泡没有 `wx:else` 回退，缺少顶部量测数据时不得显示空白浮卡；空间闭合后的等待拖放和光标拖动状态还会主动清空并隐藏该原生浮层，避免左上角残留空白矩形。下一墙链光标放置后，当前测量段只允许来自 `activeSpaceStartWallIndex` 及其后的新墙；尚未拉出新墙时不得复用上一闭合房间的末墙，以免同时绘制旧墙端点与新光标两组蓝色十字辅助线，或恢复旧量测浮层。

顶部量测卡使用白色实体表面时，实时长度必须显式使用深蓝，角度分隔线使用低对比深蓝，支持点击的角度使用深橙；禁止继承旧深色气泡的白色文字而形成“空白卡”假象。

尾巴以与卡片连续的 Canvas 轮廓绘制，填充压入卡片边缘且仅描边两侧，禁止出现拼接横线；小K每个状态均按真实目标水平位置选择左右指向。卡片高度在最后一行正文之后保留固定底部内边距。

- 编辑器顶部显示关联线索的小区名称；入口已知时由 `utils/surveyNavigation.js` 传递，直接按 `floorPlanId` 打开时由 `GET /api/floorplans/[id]` 返回关联线索摘要。
- 引导模式在每台本地客户端默认开启；顶部固定的“引导”操作启用时使用绿色本地助手图标，点击可开关。显式关闭会持久化为本机偏好，重新开启时不会重播固定教程，而是从当前正式墙图、光标、BLE、选中对象和面板状态继续。
- 同一时刻只显示一个不遮罩画布的状态跟随式小K引导：它依次跟随首墙方向、待确认长度、独立墙链首墙的内外测量边、续墙、可闭合、空间闭合后的继续量房、下一空间光标吸附、门窗/墙体编辑和完成提交。小K以本地透明左指、右指、下指素材（`packages/surveying/assets/surveying-guide-k-left-v3.png`、`-right-v3.png`、`-down-v3.png`）作为测量搭档；三个运行资源统一从 `design-references/surveying-editor-v3/sub2api-20260805-075309-1.png` 单张画板裁切。完整白底浅绿边框对话框包含“小K提示”标签、绿色星芒图标（`images/mine-icons/tab-ai-active.png`）、关闭按钮和多行行动提示；页面固定壳层及引导卡的比例、图标语义、字距和间距以 `design-references/all-pages-ip-v1/ChatGPT Image 2026年8月5日 15_44_17.png` 为高保真对照。卡片和完整小 K 姿态作为一个组合共同选位并保持明确间距；绿色虚线、箭头和目标波纹从真实手势/测距仪位置连接到 Canvas 或控件。障碍集合覆盖顶部安全区、右侧工具栏、底部控制坞、顶部测量卡、对象工具栏、目标控件、全部墙体/预览墙、门窗、尺寸文字与尺寸线、房间信息；尺寸与房间文字禁止覆盖和穿线，墙体、门窗、红色测量边及尺寸线按权重避让。引导条件使用不生成原生节点的 `block`，只有气泡和关闭按钮参与触摸命中，显示时不阻断 Canvas 或其他编辑控件。面板、数字键盘、构件编辑器或测角面板打开时由面板自身说明接管。
- 引导卡按当前 Canvas 宽度相对 `390px` 基准缩放像素定位，卡片与目标之间固定保留小K及连接线空间；不显示产品未实现的编号阶段或分页教程。对话框使用明确的浅绿描边白底箭头尾巴指向目标，小K必须朝向目标，绿色弧形虚线箭头从其朝向目标的手出发并终止于真实 Canvas/控件目标。连接线先对多条贝塞尔候选采样，全部穿过硬障碍时使用平滑网格路径绕行；仍无安全路径时，本帧省略连接线而不穿过标注。上一有效布局具有稳定性偏好，避免小幅平移时跳位。底部光标和测距目标按控制坞真实 `575rpx × 108rpx` 几何与 `64rpx` 底部偏移定位；底部目标会把卡片上移、优先将小 K 排在卡片下方，并用专用直线虚线指到按钮正上方。Canvas 连接线在按钮边缘交接，按钮内部的原生描边标记显示高层高亮。该标记属于按钮自身触摸树，文字、点击与拖拽不被独立覆盖层截断。旧的纯绿色背景说明气泡不再绘制，白底小 K 对话框成为唯一教学说明；测量边切换和绿色圆形“合”操作仍保留。右侧直线/斜线工具使用本地绿色激活态 PNG，底部光标使用本地深色准星，不依赖真机可能忽略的图片滤色。
- 关闭引导只隐藏教学气泡和高亮，不影响“合”、测量边切换、吸附类型、BLE 状态、错误提示或完成提交。引导仅保存本地开关，不写入墙图、草稿或测量审计；撤销、重做和草稿恢复均重新解析当前状态。

## 能力状态

- BLE 连接体验：任一 BLE 测距入口在未连接时可确认并在当前编辑器中搜索已授权设备；连接仍受手机蓝牙、授权与兼容硬件状态限制。
- `Implemented`（已实现）：正式墙图编辑、草稿和完成保存、BLE/手动测量、测量审计、门窗编辑及门窗构件 3D 预览。
- `Limited`（有限支持）：BLE 依赖兼容且已连接的测距仪；部分保留工具仍显示规划中或暂未开放。
- 复尺错误恢复（2026-08-13）：选中墙体后 BLE 读数应用或闭合尺寸重建失败时，编辑器恢复测距前的 v4 草稿与历史，不把失败中间态写入本地自动草稿；闭合尺寸检测到物理外墙斜化时回退既有斜墙规划。入口、API、权限、审计和持久化合同不变。
- `Placeholder`（占位/未开放）：小程序当前没有真实报告导出，也没有全户型 CAD/3D 导出。
- 全户型 2D/3D 查看与 DXF 下载由后台 `FloorPlanViewer` 和 `/api/floorplans/[id]/export/dxf` 提供。

## 入口与数据合同

- 所有入口通过 `utils/surveyNavigation.js` 传递 `leadId` 和/或 `floorPlanId`；不得恢复已删除的 `pages/editor/editor`、`restoreFloorPlan` 或双入口。
- 线索详情支持继续指定正式户型、新建一份绕过旧草稿的独立量房，以及删除正式户型；删除必须同步移除线索引用和匹配的本地续测指针。关联线索一旦进入 `designing`、`converted` 或 `closed`，正式户型成为下游工作依据，`DELETE /api/floorplans/[id]` 必须返回 `409 FLOOR_PLAN_REQUIRED_FOR_LEAD_STAGE`，不得删除或将线索回退到开始量房。
- 每个线索—正式户型关联都有稳定量房序号：历史关联按正式户型创建顺序回填，新关联只追加下一序号，不因删除旧记录而重排。展示层统一以“小区名”为主标题、“客户 · 第 N 次量房”为次级身份；`FloorPlan.name` 仅保留为未关联记录的兼容回退，不写回或改名。
- `FloorPlan.layoutData` 只允许 `version: 4`、`measurementMode: 'surveying'` 和 `surveyGraph`。禁止持久化 `rooms`、`homeOutline`、`partitions`、`surveyDraft`、`prototypeOnly` 或 `surveying_prototype`。
- 墙图坐标、墙长、墙厚、门窗和层高统一使用毫米。后台、DXF、3D 和 AI 通过读适配层派生房间、面积和开口，绝不回写旧布局镜像。
- 酷家乐导入也必须落成相同正式合同：上游网络请求在数据库事务外完成，房间轮廓转换为毫米制闭合节点/墙/空间链，再与线索关系一起原子写入 PostgreSQL。上游响应尚无可靠的开口到墙体映射，因此当前不导入酷家乐门窗开口，不得猜测归属墙体。
- 小程序 `pages/mine/mine` 展示户型空间数时，只统计 `surveyGraph.floors[].spaces`
  中 `closed: true` 的空间；网络失败必须保留失败态，不得把读取失败解释成空户型。
- 小程序 AI 设计入口传递可选 `floorPlanId`、显式 `targetScope: whole_floor_plan | single_room`，仅单房间传递 `roomId`；服务端通过正式读适配层生成尺寸、层高和开口上下文。完整户型会从闭合墙体派生 1024px 控制图并保存为独立 `MediaAsset`，单房间只消费指定闭合空间；两者都不修改 `FloorPlan.layoutData`。携带客户上下文的结果可关联 `AiWorkflow`，现场照片和 AI 结果仍保存在独立媒体/生成记录中，且仅凭户型生成的图片只作为概念效果。
- AI 工作台项目索引会保留当前角色可见但资格未通过的 version-4 量房记录，并以 `survey_incomplete / invalid_formal_graph / no_closed_space / missing_usable_wall` 解释“待完善量房”；这些记录只能通过 `utils/surveyNavigation.js` 继续唯一正式量房流程。任何小程序 AI 任务在创建前仍必须通过共享资格函数：`FloorPlan.status = completed`、正式墙图有效、存在闭合空间及其可用墙体，不能因项目索引可见而绕过校验。

## 已实现编辑流程

- 启动时可从指定云端正式户型或当前本地草稿恢复；支持本地草稿、云端草稿、完成提交、撤销和清空重画。
- 支持直墙、斜墙、手输墙长、BLE 墙长、复尺、闭合空间、共享墙和从已有顶点/墙位/空白位置创建独立墙链。
- 同一未闭合墙链连续向前拖出同向共线墙段时，若墙体模式、墙厚和测量侧兼容，则延长末墙并保留原 wall ID；沿同轴方向反向回拖时可缩短当前末墙，保留相同的 wall ID 和末端节点 ID。该便捷修正仅适用于未闭合、末端未共享、非分支且无门窗的墙；矩形的第三面墙即使先落图为半墙，后续前推或反向回拖时仍会向首墙的正交轴线吸附，删除该未闭合末墙后也会保留该吸附参考。真实转向、属性变化、独立墙链、已连接分支或闭合边界仍保留独立墙。该规范化不改变 v4 数据合同、API、角色权限或测量审计队列。
- 闭合候选默认只提供提示，用户仍可从端点继续拖墙；点击“合”，或在直线模式下让最终预览端点准确吸附到当前有效闭合目标，均视为明确闭合动作。独立墙链回到首顶点、相邻房间回到共享墙闭合点时，即使真机松手坐标滞后，只要画面中的预览端点已经与闭合目标重合，松手就会按当前预览落墙并立即闭合；原始拖拽点进入目标容差也作为后备判据。只有正交投影产生了闭合候选、但最终预览端点并未真正落到目标上时，才继续保留“合”候选，避免误闭合。斜线仍保留角度/长度确认流程。
- 独立直线墙链确认第二面且与首墙正交后，立即展示两条正交补边的橙色闭合候选和绿色圆形“合”操作；补边仍只在用户确认后落成正式墙。斜线墙链和共享边闭合继续遵循各自的候选门槛。
- 直线模式的独立阶梯墙链闭合时，候选虚线与正式补边都使用正交路径：优先沿末墙方向延伸到与起点同轴的拐点，再转向回到起点。各段必须分别通过相交和重叠校验；不允许以单条斜线切回起点。若第一段闭合边与当前末墙同向共线且模式、墙厚、测量侧兼容，确认时直接延长末墙并保留原 wall ID，只为真实转角后的边新增墙体；否则仍新增独立补边。斜线模式和共享墙闭合继续使用其既有路径规则。
- 空间闭合或光标复位后，底部光标可以拖到已有顶点、墙体内边、墙体外边或画布空白处；内边顶点仍优先于邻近内边线。同一闭合边角同时出现内外顶点候选时，落点距拓扑内角不超过相邻闭合墙最大墙厚即锁定内边顶点，外边线投影不得抢占；只有落点进入可见斜接外角末端约 `40%` 墙厚带，或离开内角保护区且数值上更靠近外角时，才选择外边顶点，后续新墙链保留实际吸附边。若二维距离未命中顶点或墙边，但光标与完整闭合边界的内/外顶点在 X 或 Y 单轴上相差不超过 `350mm`，则吸附到该顶点的水平或垂直延长轴并保持另一轴自由；远距离对齐点创建独立拓扑节点，不能连接到数米之外的源顶点。直墙预览采用同一轴向规则，但共享边起点的首墙仍由其专用墙面/矩形规则控制；从第二面墙开始可使用远距离顶点轴向对齐。手输/BLE 确认长度后重新应用同一规则，确保预览辅助线、墙体端点和持久化坐标一致。矩形补边、共享边续测和闭合规则保持更高优先级。画布、独立轻量 Canvas 和底部拖放控件的光标均使用一致的细线十字与方框，放大镜分别显示“顶点吸附”“顶点延长吸附”“内边吸附”“外边吸附”或“自由放置”。拖动时左上角放大镜通过正式 Canvas 渲染器重建目标局部，墙体实体、转角、选中态和门窗样式必须与主画布一致，不得使用独立的中心线/外侧线近似；放大镜使用常驻的原生 `cover-view`，只切换可见状态，且在首帧尚未回写可见状态时继续刷新，从而不会因快速拖动、`setData` 延迟或条件节点重建而漏显；它不生成原生全屏节点，底部光标控件始终接收 `touchmove`。可闭合、测量边和其他操作均由单一白底小 K 对话框解释并按完整障碍集合自动选位，不再叠加纯绿色背景说明气泡。
- 含 `wallFaceOverrides` 的内边相邻空间闭合后，正式 Canvas 的墙体布尔合并必须继续保留共享墙实体，同时在合并轮廓上重绘所选净边界；上下新墙伸入共享墙厚并到达既有内边顶点的末段不得作为内部接缝隐藏。删除该空间另一面墙导致其转为开放墙链时，同一端点的可见位置不得变化。
- 原生 `cover-view` 未提供或上报零值的 `pageX`/`clientX` 时，光标拖放使用底部控件的实时矩形将局部触摸坐标换算为屏幕坐标，避免不同设备上丢失拖动。
- 设备遗漏中间 `touchmove` 时，起止点的有效位移仍会完成拖放；无位移点击不会触发放置。
- 画布平移和双指缩放不得在每个 `touchmove` 中更新页面数据或重建正式场景；临时 Canvas 按 `requestAnimationFrame` 合并高频事件，只绘制网格、房间填充、墙体轮廓和门窗。尺寸、房间名称、辅助线和操作提示在手势结束并一次性提交 viewport 后恢复，正式墙图和保存合同不因轻量交互帧而改变。
- 画布使用可自由探索的无限草图平面：平移不得按墙体实体或可见工作区回弹，闭合房间可以被完整移出当前视口，以便在任意方向腾出空白后新建相邻房间。双指缩放保持中心锚定，运行时只以 `0.002–4 px/mm` 的超宽范围防止数值退化，不再使用原 `0.05–0.36 px/mm` 的编辑视口限制。该交互只修改 viewport 比例与偏移，不修改闭合拓扑、毫米坐标、正式保存、API、角色或测量审计。
- 正式 Canvas 墙体必须按 `thicknessMm × viewport.scale` 绘制真实可见墙厚，不得使用与视口比例脱钩的固定像素限宽；这样外墙面、橙色外边吸附状态线、对齐辅助线和预览终点在放大或缩小后仍共用同一 Canvas 坐标。该显示规则不改写墙图坐标、持久化墙厚、API、角色或测量审计。
- 正式 Canvas 的蓝色整屏十字辅助线只表示最后一个已确认显示点：空白初始态和首墙尚未确认时不显示；下一面墙拖动期间，光标与预览终点跟手移动，但蓝线保持在上一确认点，提交后才移动到新终点。闭合路径以及墙面、顶点和轴向吸附仅把实际受约束的路径或轴绘制为橙色虚线，基础蓝色十字可同时保留；自由拖放不得生成橙线。命中闭合房间外边或外边顶点时，`outer` 只保留为新墙实体与相邻墙面对齐的吸附语义；光标、橙/红预览测量线、实时尺寸和后续活动墙统一使用操作员实际拖出的中心线工作锚点，不得平移到黑色墙线另一侧的外墙面。共享墙闭合产生 `measurementEndInsetMm` 时，有效测量终点仍负责读数，但不得再绘制第二组蓝色十字。该状态依据为 `design-references/surveying/cursor-guide-state-reference-20260812.jpg`，不改变正式墙长、闭合拓扑、API、角色或测量审计。
- 实时标注与闭合房间标注是两个独立视觉角色。当前未闭合墙链的实时标注使用蓝色 `14px` 数值、低对比中性灰底和跟随实际测量面的外侧尺寸线；闭合房间的永久派生标注使用深灰 `12px` 数值、细弱尺寸线和安静白底，建筑外包总尺寸仅以稍高字重区分。两类标注不得共用同一套蓝色大字号样式。外边续测时，实时标注必须随红线布置在房间外侧，避免压入闭合房间内部。该规则的当前批准设计来源为 `design-references/surveying/runtime-live-dimension-reference-20260812.jpg`；实现验证覆盖外角预览、已提交外边墙和左转/下转正交活动墙链。
- 闭合空间永久标注的尺寸线与墙面保持 `60px` 尺寸带留白；延伸线从尺寸线向靠墙侧固定绘制 `18px`，空间不足时在墙面前保留 `12px` 小间隙。两端约 `60°`、总长 `4px` 的平行短斜线必须等长等角，且以对应延伸线和尺寸线的交点为中心，不使用箭头。活动墙或预览墙从闭合房间向外延伸时，`createClosedDimensionPlan()` 把其可见实体角点加入同方向支撑边界，使永久标注避让到新墙之外。该避让只影响只读标注位置，不改变尺寸值、v4 墙图、API、角色、毫米坐标或 BLE/手动审计。
- 闭合空间的房间填充、净尺寸和净面积必须消费由有向墙链推导的内墙面多边形，不得直接使用拓扑节点包络或“最长横墙 × 最长竖墙”代替。共享墙在 `floor.walls` 中仍为唯一物理墙，两个空间分别选择靠近自身的墙面；被起止内缩完全消耗的墙厚连接段不属于净边界。`buildSpaceDimensionPlan()` 只读派生内/外边界、包络尺寸、净面积和墙厚段，不写入正式墙图、API 或测量审计。
- 直线相邻房间从已闭合房间的内边顶点起测并回到另一内边顶点时，首墙和末墙的 `measurementStartInsetMm`/`measurementEndInsetMm` 均为 `0`，不得再自动叠加墙厚。新空间可持久化 `wallFaceOverrides: Record<wallId, 'topology' | 'offset'>`，对实际复用的共享墙段锁定选中墙面；墙体切分时该覆盖必须传播到替换墙段。外边起测和真实墙厚错台仍使用既有内缩语义。该可选字段位于正式 version-4 `surveyGraph.floors[].spaces[]` 内，不改变顶层结构、入口、API、角色边界或测量审计。
- 从已闭合房间角点开始续测时，闭合候选允许沿既有共享边路径返回另一角点；第一或第二条直墙保留矩形正交吸附参考，手输/BLE 确认长度后再次应用吸附，避免端点重算后同时丢失正交提示和“可闭合”候选。该行为仍只写入正式 v4 墙图及既有测量审计流程，不改变入口、API 或角色边界。
- 相邻新空间存在一个墙厚的宽度错台时，闭合目标必须优先选择起算共享墙的另一端，并按当前末墙真实来向生成“继续末墙 + 墙厚连接段”的正交路径；不得因旧房间节点或等长绕行路径的写入顺序把原房间其他边界并入新空间。外边界墙继续使用末端内缩排除共享墙厚，最终空间链只追加直接共享边。该规则不改变入口、API、角色、v4 顶层合同或测量审计。
- 删除闭合空间内墙体后会清除旧光标吸附指针；重新把光标吸附到剩余边界端点时，缺失墙的正交辅助与共享边闭合候选仍可恢复，不会引用上一房间或已删除墙体。
- 删除恰好由两个有效闭合空间共同引用的唯一共用墙时，客户端会移除该墙及其门窗，并把两侧空间剩余边界重新排序为一个有向闭环；画布随后只派生一个新房间的填充、标签、永久尺寸和净面积。从共墙外墙面起测的相邻房间会在连接共墙的上、下边界保存墙厚内缩；合并成功后必须只清除落在已删除共墙两个端点上的这些失效内缩并刷新墙长，使原来由共墙实体补齐的外墙连续闭合，其他墙体和墙 ID 不得删除或合并，其门窗还必须补偿起点内缩变化以保持绝对墙上位置不动。只有剩余边界能组成唯一闭环时才自动合并；删除外墙、单空间边界或异常多空间共边仍使相关空间转回未闭合。合并仍使用现有 `spaces[]` 标准结构，不新增持久化字段，也不改变路由、API、角色、version-4 顶层合同或测量审计。

## 斜墙与测角不变量

- 斜线松手后保持待确认预览；确认长度、从预览终点继续拖拽或点击可见的“合”时才落定。继续拖拽会使用实时预览长度提交当前墙并从该终点开始下一面墙；“合”会按当前预览长度提交斜墙后立即执行闭合。
- 新斜线与上一条斜线正向相差不超过 8 度时吸附到上一方向，同时保留当前拖拽长度；超过阈值保持自由角度。
- 顶部角度值和当前拐角画布标注打开同一数字面板测角界面。只有最后一条斜墙及前墙保留可编辑角度标注；可重开的墙必须尚未闭合且没有门窗。
- 手机姿态仅提供由量房人员确认的相对角度；勾股测角依次获取两边和端点连线三条 BLE 读数，用余弦定理校验并计算夹角。
- 关闭测角面板不得改变墙体几何，并必须停止设备姿态监听；确认角度后仍回到常规墙长确认流程。

## 门窗与画布不变量

### 门窗右侧统一检查器（2026-08-06）

选中门窗时，右侧控件按
`design-references/surveying-editor-v4/surveying-opening-inspector-delete-only-v1.png`
和 iPhone 13 Pro `390x844` 基准呈现：宽度、高度、真实开启状态、绿色“编辑”和唯一的
红色“删除门窗”统一位于不透明浅灰绿检查器内，危险操作前使用短发丝线分隔。门使用
内开/外开二选一；窗口态不显示没有实际操作的“窗位 / 固定”状态行。选中门窗时不再显示拆分、添加
和布置；新增门窗仍从墙体上下文进入，规划中工具在其他位置维持原有限制。未闭合墙链的
“继续测墙”仍保留在检查器下方。该视觉还原不改变门窗毫米字段、构件编辑器、v4 墙图、
API、角色权限、持久化行为或测量审计。

门的内开/外开使用等宽轨道和显式居中的文字行；窗口检查器按 `design-references/surveying-editor-v5/surveying-window-inspector-continue-wall-v1.png` 在高度字段后直接进入编辑操作，不为无功能状态保留空位。“继续测墙”与检查器等宽但使用绿色描边次操作样式，并以 `28rpx` 间距和本地绿色“墙段向前延伸”图标与绿色“编辑”主操作保持明确层级。该原生按钮的最终表面和图文布局必须直接定义在简单的 `opening-resume-*` 类上，不得依赖祖先/子级复合选择器反转旧基础样式，以免真机保留纯绿色背景并吞掉深绿色图文。

- 闭合空间填充必须分别尝试首墙正向和反向，只接受每面墙逐段相连且最终回到起点的完整闭环；禁止用“最近端点”补接断链，以免生成自交多边形和斜切空白。
- 墙体外壳必须由单侧墙体矩形和连接节点补面执行全局实体合并；Canvas 按闭合墙、开放墙两个颜色组分别消费分类后的并集闭环，每组只执行一次复合环 `fill()`，完整实体并集只执行一次闭环 `stroke()`。禁止再逐个绘制输入矩形、连接补片、设备像素扫描线或独立边界段，因为这些路径会在闭合墙与开放墙的 T/边角处争夺颜色和抗锯齿像素。正式重绘、平移/缩放轻量帧和放大镜必须投影同一组并集闭环；连接节点、L/T 型接入和重合分段不得出现随机白洞、浅色掏空、内部端帽、对角斜缝或叠加方框。
- 门窗切口必须沿墙体实际外法线覆盖完整墙厚和实测开口宽度，切口两侧不得残留墙体轮廓。
- 门窗在二维画布中按完整实测开口宽度绘制 CAD 风格符号：平开门的开启门扇与门套间关闭位窄条均为完整细长描边矩形，关闭位窄条位于开启弧相反一侧的墙面，门扇和 90 度开启弧连接对侧门框；窗使用细线三轨窗框。
- 点击门窗优先选中开口而不是父墙；开口 `touchend` 后到达的原生 Canvas `tap` 不得清除刚选中的开口。
- 未闭合墙链选中门窗时，详情卡必须提供从当前墙链末端继续测墙的动作；“新建房间起点”只创建独立墙链。
- 门窗构件编辑器 V1 仅开放真实规格、数字键盘、Three.js 尺寸预览和由底部常驻控制坞触发的 BLE 参数测距；面板内不得重复渲染“测距”，翻转、模型选择、模型库和入户门附加入口暂不在 V1 界面开放。门态显示门宽、门高、墙厚、距左、距右，窗态额外显示窗台高；“同步更改墙体厚度”只在墙厚参数激活时出现。规格面板必须避开固定撤销/重画控件；编辑器开启时隐藏父级量房标题栏、右侧工具轨和门窗检查器，避免原生覆盖层重叠。已有开向/模型字段继续保留在正式墙图和内部实现中，该隐藏不改变 v4 数据合同、API、角色权限、持久化或测量审计。
- 工具栏收起、退出构件编辑器或点击空白画布会清除墙体/门窗选择并恢复对应测量状态。

## 尺寸与审计不变量

- 空间未闭合时，当前墙链只显示内测边尺寸并以红线高亮；预览墙使用顶部实时读数。光标放到画布空白处创建独立墙链后，该墙链第一面墙确认时可选择内/外测量边；小 K 对话框会随对应真实目标重新求解位置，内/外墙切换控件和红线继续指示实际测量边，后续墙保持锁定。光标吸附到未闭合墙体或顶点后仍继承既有边界，不显示该提示，也不能重新切换首墙测量侧。从已闭合房间边角续测时，外边命中继续决定新墙实体与相邻墙面的对齐侧；但手输/BLE 长度、红线、预览墙和光标终点统一使用操作员实际拖出的中心线工作位置，避免在黑色墙线旁绘制平行的外边线。预览及首墙确认后均显示“当前测量位置”切换按钮，切换不改变起算面或长度；按钮的双向矢量箭头沿墙体法线绘制，竖墙为左右、横墙为上下、斜墙随法线旋转。
- 墙对象可选保存 `measurementStartInsetMm` 和 `measurementEndInsetMm`；旧数据缺失时均按 `0` 处理。内边或外边续测都保留墙体交点处的共享拓扑节点，并用测量内缩排除交点覆盖的完整墙厚；`lengthMm` 是拓扑节点跨度扣除两端内缩后的净测距读数，墙厚独立标注。复尺、墙体延长/缩短、开口偏移和墙体切分均保留该语义。
- 闭合墙与既有墙共线且光标落在墙中段时，光标只表示目标墙；闭合点必须取沿拖动方向最先遇到的既有拓扑端点。非共线相交仍在实际交点切分。
- 从既有墙中段起测新墙时，吸附确认立即将源墙切为两条同源原子边，并把既有空间的 `wallIds` 替换为两段；新墙提交后与两段源墙复用同一节点，形成度数为 3 的 T 型连接。切分不等待房间闭合，开放分支不生成新空间；只读填充边界可折叠同源共线中间点，但持久化拓扑仍保留切分节点和 `topologySourceWallId`。
  源墙两段的红色测量边必须在分支墙实体处留下完整墙厚空档；分支墙自身的红线也从源墙远侧墙面开始。哪一侧源墙段需要端点内缩由分支墙实体所在法线侧决定，不允许两段继续共享一条穿过交点墙体的测量红线。墙体实体的开口/闭合仍只按拓扑节点判断，不能因红线内缩而误画端帽。
  本轮光标/拓扑与 Canvas 两个直接回归套件 `105/105` 通过；小程序全量测试 `300/303` 通过，3 条既有失败分别是获客通知路径、本地 API 端口 `3005/3006` 不一致和离线调试开关默认值，均与本轮拓扑变更无关。WXML/WXSS、路由、API、角色和 version-4 合同不变。
- 重置光标重新吸附到开放墙链的悬空端点时，内边与外边顶点都必须恢复源墙的有向测量侧：从源墙终点续画保持原侧，从源墙起点反向续画则翻转左右侧。重置后的下一转角必须与不重置时连续拖出的拓扑、墙体侧向、净长度及既有墙端点内缩完全一致，禁止因重新推导测量侧而给源墙额外写入一个墙厚的末端内缩。该规则不适用于闭合边界起测或墙中 T 型连接，不新增 version-4 字段，也不改变路由、API、角色或测量审计。
- T 型/十字节点的测量内缩与实体几何必须分层：内缩只影响红色测量边、尺寸读数和门窗沿墙坐标，墙体实体、选择命中和实体并集始终使用原始拓扑节点。斜墙连接点在实体并集中允许按不可见的亚像素容差归并，避免浮点法线产生开环；删除分支后必须根据节点剩余墙体重算同源切分段内缩，不能保留已删除墙造成的扣减。系统矩阵必须覆盖开放/闭合、外墙/共墙、直墙/斜墙、内外边、旋转、非等厚、门窗、删除、十字、保存恢复及固定种子回放。
- 拓扑回归之外必须执行最终 Canvas 场景的视觉回归：在交点像素区域对各墙体 `bodyPolygon` 的期望覆盖与 `wallSolidPlan` 最终复合轮廓做高密度采样，禁止出现完整背景像素；最终描边段两侧若都属于墙体实体，则判定为内部端帽/接缝并失败。代表场景还必须输出 `tmp/survey-topology-visual-regression.png` 供人工检查墙体连续性、轮廓、红线和删除恢复效果。
- 真机交点稳定性回归必须锁定上一稳定 Git 版本的绘制契约：每个非空颜色组恰好一次并集环填充，完整墙体恰好一次闭合并集环描边；不得出现墙色 `fillRect()` 扫描线、逐输入多边形填充或逐边界段描边。测试同时验证正式帧与平移帧投影相同 `rings`，以及混合闭合/开放 T 型交点保持独立颜色所有权。`joinPolygons` 只保留为实体并集的诊断输入，不再作为额外着色层。
- 正式 Canvas 与平移/缩放轻量帧不得同时拥有主画布：每次场景构建都分配递增代次，过期 `setData` 回调必须丢弃；手势期间到达的正式重绘只能挂起，并在手势结束后由最新场景一次性交接。画布尺寸查询、主 Canvas 初始化和拖拽 Canvas 初始化同样必须校验各自代次，页面卸载后不得接受迟到回调。
- 闭合房间角点续测的第一、第二面新墙均不产生闭合候选、橙色闭合虚线或“合”按钮；第二面直角墙只做正交吸附，光标按距离分别命中对侧内墙拓扑角点或斜接后的外墙角点。从第三面新墙开始才允许进入闭合判断；橙色闭合虚线必须从当前测量墙轴线连续绘制到确认闭合实际采用的墙面终点，不得为了显示斜接外角而横向错位。无论命中内边还是外边，首墙和末墙都通过 `measurementStartInsetMm`/`measurementEndInsetMm` 排除交点覆盖的完整墙厚；同向共线的闭合延伸归并到当前末墙，不额外生成重复墙段。
- 从唯一已闭合房间某面内部墙的中段开始画直线分隔墙时，预览和手输/BLE 确认都必须在对侧首个边界交点停止，不能让光标或预览墙穿过对侧内部墙。确认会按需切分两端边界墙，复用该实测分隔墙作为共享墙，并把原房间墙链替换为两个闭合空间；该局部拓扑操作不新增旧版 `rooms` 数据、不改变 v4 顶层结构、入口、API、角色、毫米读数或测量审计。
- 空间明确闭合后，`createClosedDimensionPlan()` 从完整墙体实体、闭合空间有向墙链和建筑外轮廓生成统一只读尺寸计划。正交户型的尺寸项按由近到远固定为门洞定位 `opening-segment`、建筑外侧房间净尺寸 `room-clear`、真实外包总尺寸 `building-overall`；没有门洞的方向由净尺寸占第一层。房间净尺寸从对应空间的物理内墙面合并同轴相邻段，只保留能映射到建筑外轮廓的段，共享墙和完全内部墙不得向外生成尺寸线。外包总尺寸直接使用墙体实体最外层正向环的几何跨度，不再用净墙测量值与坐标长度比例反推；每个方向的延伸起点来自该方向外轮廓段的真实角点，尺寸线和标签均布置在建筑外包范围之外，不得穿过房间或墙体。窗口只保留 CAD 图形，不生成门洞定位链。单矩形、并排空间、错台空间和 L/U/阶梯形正交边界使用该规则；只要建筑外边界含斜墙，整套尺寸回退现有 `createExteriorDimensionPlan()`，避免臆造角度尺寸语义。
- `miniprogram/packages/surveying/utils/surveyDimensionPlan.js` 与 `miniprogram/packages/surveying/utils/surveyWallSolidPlan.js` 分别是尺寸和墙体实体规划算法源；后台在 `predev`/`prebuild` 阶段从该目录同步到 `admin/src/lib` 的同名镜像，并校验镜像内容一致，禁止为共享算法扩大 Turbopack 仓库监控根目录。
- 任意临时接管 BLE 回调的面板关闭时必须恢复常规回调。每条有效正式读数都写入测量审计。
- 首次云端保存前取得的读数进入当前会话队列；正式 `floorPlanId` 创建后补写，失败记录保留到下次成功重试。

## 运维

### Geometry runtime rollback (2026-08-13)

The experimental `surveyGeometryPipeline.js`, startup `normalizeTopology()`,
draft-update auditing, committed-crossing normalization, and physical-wall
segment derivation were removed from the Mini Program runtime. Their synchronous
whole-graph work blocked formal-surveying page startup on real devices. The
runtime `surveyWallGraph.js` now matches the pre-integration backup at
`research/survey-geometry-poc/backups/surveyWallGraph.js.backup-20260813-194929`.
Routes, version-4 persistence, APIs, roles, BLE measurement audits, and existing
UI remain unchanged. The V1/V2 sections below are historical experiment notes,
not current runtime capability.

### Historical experiment: geometry pipeline bridge (rolled back)

`miniprogram/utils/surveyWallGraph.js` now exposes the read-only
`buildGeometryPipelineInput(floorOrDraft)` adapter. It converts the current
version-4 `nodes/walls` graph into integer-millimetre centerlines while
preserving `wall.id` as `sourceWallId`; it does not alter closure behavior,
openings, measurement audits, or persisted layout data. The isolated
`research/survey-geometry-poc/src/production-bridge.js` consumes this adapter
and runs Turf polygonization, JSTS topology diagnostics, and Clipper2 wall
solid/clear-face derivation against real `surveyWallGraph` drafts. The bridge
is Node-side research tooling only: JSTS and Clipper2 WASM are not Mini Program
runtime dependencies. The original graph implementation is backed up at
`research/survey-geometry-poc/backups/surveyWallGraph.js.backup-20260813-194929`.
The production graph remains the active interaction implementation until real
multi-room replay data is validated.

The Mini Program also contains a dependency-free counterpart at
`miniprogram/utils/surveyGeometryPipeline.js`. The editor subpackage
runs it after draft updates for diagnostics and uses the same noded half-edge
result when a committed wall crosses another wall or the derived face count no
longer matches persisted spaces. Proper crossings are valid graph junctions:
both source walls are split at the intersection, the original wall ID stays on
the first atomic segment, additional segments retain `topologySourceWallId`, openings
move to the segment containing their absolute wall position, and every bounded
face becomes a closed `spaces[]` entry. The top-level version-4 contract,
millimetre units, API, roles, and measurement audits are unchanged.

Normalization also runs when a formal draft is restored and after explicit
closure. Missing T/crossing nodes are always materialized, but existing spaces
are updated locally rather than rebuilt when the derived face count still
equals the persisted closed-space count; this preserves historical wall order
and `wallFaceOverrides`. Cross/T junction normalization is idempotent.

Open continuation walls are exported as `topologyRole: 'active-chain'`, while
walls referenced by closed spaces are `closed-boundary`. Degree-one endpoints
on an active chain remain available as `openEnds` telemetry but are not
reported as `DANGLE`; a degree-one closed boundary remains an error. This keeps
multi-room face validation active while an operator starts the next wall.
The editor emits one console summary per changed audit state: valid states use
`console.info`, while invalid states use `console.warn`.

### Historical experiment: pure frontend geometry V1 (rolled back)

Topology split points are no longer treated as physical wall ends during the
read-only render derivation. Collinear, contiguous segments with equal wall
thickness resolve one consistent physical-wall side before the existing Canvas
solid union runs, so a room junction does not add an internal end cap or make
one continuous wall look like separate short walls. IDs, openings, version-4
persistence, and measurement audits remain unchanged.

`confirmClosure()` now also accepts a new wall chain that borrows one point on
an existing closed boundary and returns independently to that same point via
the approved closure path. It no longer demands a nonexistent shared-boundary
path in that case; closures between two different existing boundary points
still require a connected shared path. The pre-change snapshot is
`research/survey-geometry-poc/backups/frontend-v1-20260813-205333/`.

### Historical experiment: planar topology V2 (rolled back)

Room recognition no longer depends only on the operator's recording-order wall
chain. `normalizeFloorTopology()` nodes every centerline intersection, persists
the resulting atomic wall segments, walks the directed half-edge graph, and
rebuilds bounded rooms from faces. A cross junction inside one outer boundary
therefore yields four rooms, and a full divider joined to opposite boundaries
yields two rooms regardless of the number or order of incident walls. The
runtime remains dependency-free; Turf/JSTS/Clipper2 stay research-only.

The user-supplied multi-room screenshots on 2026-08-13 are the behavioral
reference for intersection splitting and stable room adjacency; no WXML/WXSS or
visible control was changed. Focused graph, Canvas, dimension, formal-layout,
closure, and package-boundary tests pass `148/148`, including cross,
T-junction, idempotence, opening-remap, and main-package import cases. The
existing WeChat DevTools window was detected but has
no compatible Mini Program Automator endpoint, so a fresh compile, confirmed
`packages/surveying/editor/surveying-editor` page stack, and native Canvas
`390x844` capture remain pending; no duplicate window was opened.

旧户型清理会删除不符合正式墙图合同的数据及其关联测量日志。必须先按
[formal-surveying.md](./formal-surveying.md) 执行 dry run，再考虑使用 `--execute`。

## 开发前后门禁

修改正式量房页面、墙图工具、BLE 流程、门窗构件或任何墙图消费适配器前，
必须先阅读根 `AGENTS.md`、小程序功能清单和本文档。完成后在同一次修改中
同步更新小程序中英文清单及本文档，说明入口、数据合同、审计、角色限制和
未开放能力；若仅为无行为影响的文档/样式整理，也要在交接中明确说明。
