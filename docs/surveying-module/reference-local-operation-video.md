# 本地操作视频分析：测绘与构件编辑流程

> 状态：`Validated`  
> 分析日期：2026-06-01  
> 用途：记录用户提供的本地录屏中可观察到的测绘、墙体编辑、门窗/构件和 3D 材质操作，为后续需求拆解提供证据。  
> 范围：本文只记录画面可见行为，不代表当前 `surveying-editor` 已实现这些能力。

## 来源

- 本地文件：`C:\Users\Administrator\Desktop\微信视频2026-06-01_101944_190.mp4`
- 视频信息：竖屏录制，约 `02:14`，画面分辨率 `324 x 720`，`30 fps`。
- 观察方式：按 `1 fps` 从原视频抽取逐秒帧，共 `134` 张，覆盖 `00:00-02:13`；每张原图存放在 `reference-local-operation-video-frames/` 下，用于后续需求实现和验收对照。

## 抽帧资产

| 资产 | 路径 | 用途 |
| --- | --- | --- |
| 逐秒原图 | [`reference-local-operation-video-frames/frame_001.jpg`](./reference-local-operation-video-frames/frame_001.jpg) 至 [`frame_134.jpg`](./reference-local-operation-video-frames/frame_134.jpg) | `frame_001` 对应 `00:00`，之后每张递增 1 秒。 |
| 总览图 1 | [`contact_01.jpg`](./reference-local-operation-video-frames/contact_01.jpg) | `00:00-00:29`，空画布起测、绘墙和房间生成。 |
| 总览图 2 | [`contact_02.jpg`](./reference-local-operation-video-frames/contact_02.jpg) | `00:30-00:59`，构件编辑入口、2D 对象操作和 3D 窗参数输入。 |
| 总览图 3 | [`contact_03.jpg`](./reference-local-operation-video-frames/contact_03.jpg) | `01:00-01:29`，窗/门编辑、墙段选择、删除确认。 |
| 总览图 4 | [`contact_04.jpg`](./reference-local-operation-video-frames/contact_04.jpg) | `01:30-01:59`，删除反馈、3D 门材质、房间3墙体编辑。 |
| 总览图 5 | [`contact_05.jpg`](./reference-local-operation-video-frames/contact_05.jpg) | `02:00-02:13`，房间3构件编辑延续及系统通知栏误触。 |

## 逐秒抽帧功能索引

| 时间 | 帧图 | 可见功能/状态 | 后续需求含义 |
| --- | --- | --- | --- |
| `00:00-00:01` | [`frame_001`](./reference-local-operation-video-frames/frame_001.jpg)-[`frame_002`](./reference-local-operation-video-frames/frame_002.jpg) | 空白网格画布、橙色十字光标、顶部 2D/3D/漫游/楼层/保存入口、右侧测墙工具、底部蓝牙/光标移动/添加入口。 | 新版工作台需要支持空画布起测，并保持核心工具常驻。 |
| `00:02-00:05` | [`frame_003`](./reference-local-operation-video-frames/frame_003.jpg)-[`frame_006`](./reference-local-operation-video-frames/frame_006.jpg) | 从光标拖出第一段竖向墙，顶部浮层显示长度，墙侧出现切换提示。 | 光标是墙段方向和接续点的主交互对象；红线/墙侧提示要及时反馈。 |
| `00:06-00:09` | [`frame_007`](./reference-local-operation-video-frames/frame_007.jpg)-[`frame_010`](./reference-local-operation-video-frames/frame_010.jpg) | 第一墙确认后继续生成矩形房间，显示蓝色虚线轴、尺寸标注和红色测量线。 | 连续绘墙不应弹出方向选择流程；尺寸、光标轴线和红线要同步更新。 |
| `00:10-00:15` | [`frame_011`](./reference-local-operation-video-frames/frame_011.jpg)-[`frame_016`](./reference-local-operation-video-frames/frame_016.jpg) | 房间1闭合，显示房间名称、层高 `H=2800mm` 和面积；画布保留多方向尺寸线。 | 闭合空间需要展示基础空间信息，后续正式数据阶段再定义保存来源。 |
| `00:16-00:23` | [`frame_017`](./reference-local-operation-video-frames/frame_017.jpg)-[`frame_024`](./reference-local-operation-video-frames/frame_024.jpg) | 从既有墙附近继续绘制，生成房间2，画布显示外部总尺寸和局部墙段尺寸。 | 多房间阶段需要端点/墙段接续和共享边界能力。 |
| `00:24-00:29` | [`frame_025`](./reference-local-operation-video-frames/frame_025.jpg)-[`frame_030`](./reference-local-operation-video-frames/frame_030.jpg) | 选中墙/构件后出现对象浮层；右侧工具切为编辑、材质、锁定、复制、镜像、修正、隐藏、删除。 | 选中态需要上下文工具栏，工具能力按对象类型切换。 |
| `00:30-00:33` | [`frame_031`](./reference-local-operation-video-frames/frame_031.jpg)-[`frame_034`](./reference-local-operation-video-frames/frame_034.jpg) | 进入“构件编辑”3D 页面，显示门模型、墙地面预览和底部参数页签。 | 构件编辑是独立语境，但仍应与 2D 对象共享同一数据。 |
| `00:34-00:36` | [`frame_035`](./reference-local-operation-video-frames/frame_035.jpg)-[`frame_037`](./reference-local-operation-video-frames/frame_037.jpg) | 在 3D 构件页打开数字键盘，长度参数以 `mm` 输入并确认。 | 构件尺寸输入沿用毫米单位，但提交目标是构件属性而非墙段长度。 |
| `00:37-00:43` | [`frame_038`](./reference-local-operation-video-frames/frame_038.jpg)-[`frame_044`](./reference-local-operation-video-frames/frame_044.jpg) | 回到 2D，选中房间1内墙/门窗附近对象，红色定位线和对象浮层显示，右侧对象工具常驻。 | 2D 选中态要明确对象边界、定位线和可操作动作。 |
| `00:44-00:51` | [`frame_045`](./reference-local-operation-video-frames/frame_045.jpg)-[`frame_052`](./reference-local-operation-video-frames/frame_052.jpg) | 持续编辑墙上对象，画布出现删除拖拽区/删除提示，右侧仍提供对象操作。 | 删除应是显式危险动作，并进入后续撤销/确认规则设计。 |
| `00:52-00:59` | [`frame_053`](./reference-local-operation-video-frames/frame_053.jpg)-[`frame_060`](./reference-local-operation-video-frames/frame_060.jpg) | 切换到 3D 窗构件，底部页签包含长度、宽度、高度、距地、边距1、边距2，数字键盘输入 `1500`、`900` 等值。 | 门窗/构件合同必须定义尺寸、距地、边距字段和参考方向。 |
| `01:00-01:05` | [`frame_061`](./reference-local-operation-video-frames/frame_061.jpg)-[`frame_066`](./reference-local-operation-video-frames/frame_066.jpg) | 3D 窗参数编辑后回到 2D，墙上对象仍保留红线定位和边距尺寸。 | 3D 参数修改必须回写同一 2D 对象，避免双状态。 |
| `01:06-01:14` | [`frame_067`](./reference-local-operation-video-frames/frame_067.jpg)-[`frame_075`](./reference-local-operation-video-frames/frame_075.jpg) | 右侧出现转线线、打断、添加、排布、删除等构件/墙段编辑工具；对象浮层和红色定位线持续存在。 | 这些工具需要单独定义语义、适用对象和几何影响。 |
| `01:15-01:21` | [`frame_076`](./reference-local-operation-video-frames/frame_076.jpg)-[`frame_082`](./reference-local-operation-video-frames/frame_082.jpg) | 房间3被选中或新增，墙段高亮，顶部浮层显示长度/墙厚/分段信息。 | 房间级选中、墙级选中和构件级选中需要明确层级优先级。 |
| `01:22-01:29` | [`frame_083`](./reference-local-operation-video-frames/frame_083.jpg)-[`frame_090`](./reference-local-operation-video-frames/frame_090.jpg) | 房间3墙体对象编辑，出现数字键盘和删除确认弹窗。 | 删除/尺寸修改都应进入文档化确认、撤销和数据影响规则。 |
| `01:30-01:34` | [`frame_091`](./reference-local-operation-video-frames/frame_091.jpg)-[`frame_095`](./reference-local-operation-video-frames/frame_095.jpg) | 删除确认后出现顶部反馈提示，随后返回房间3画布。 | 用户触发的危险操作需要明确结果反馈，不能静默失败或静默成功。 |
| `01:35-01:39` | [`frame_096`](./reference-local-operation-video-frames/frame_096.jpg)-[`frame_100`](./reference-local-operation-video-frames/frame_100.jpg) | 房间3中继续选中墙/构件，右侧工具和对象浮层恢复。 | 删除后对象选择状态需要可恢复且不污染其他房间。 |
| `01:40-01:45` | [`frame_101`](./reference-local-operation-video-frames/frame_101.jpg)-[`frame_106`](./reference-local-operation-video-frames/frame_106.jpg) | 进入 3D 门构件材质视图，底部材质分类包含最近、相册、木料、石材、涂料、布料等，并有公有素材入口。 | 材质库属于 Phase 8/展示能力，需要与构件对象属性绑定。 |
| `01:46-01:53` | [`frame_107`](./reference-local-operation-video-frames/frame_107.jpg)-[`frame_114`](./reference-local-operation-video-frames/frame_114.jpg) | 回到 2D 房间3，选中墙段并显示红色定位线、尺寸标注、对象浮层。 | 2D/3D 切换后选中对象与定位关系应保持一致。 |
| `01:54-02:03` | [`frame_115`](./reference-local-operation-video-frames/frame_115.jpg)-[`frame_124`](./reference-local-operation-video-frames/frame_124.jpg) | 房间3墙上对象持续编辑，右侧对象工具、删除拖拽区、边距尺寸反复出现。 | 构件编辑需要稳定的对象状态机和误操作保护。 |
| `02:04-02:09` | [`frame_125`](./reference-local-operation-video-frames/frame_125.jpg)-[`frame_130`](./reference-local-operation-video-frames/frame_130.jpg) | 仍停留在房间3对象编辑态；随后出现系统通知中心。 | 通知栏属于录屏外部干扰，不应作为产品功能证据。 |
| `02:10-02:13` | [`frame_131`](./reference-local-operation-video-frames/frame_131.jpg)-[`frame_134`](./reference-local-operation-video-frames/frame_134.jpg) | 录屏进入系统控制中心并结束。 | 仅作为视频尾帧保留，不进入需求范围。 |

## 已确认的操作能力

1. 空白测绘、已有房间编辑和构件编辑共用同一类网格工作台信息结构。
2. 顶部工作台入口保持常驻，但在构件编辑页会切换为“构件编辑”标题与 3D 预览语境。
3. 墙体编辑态存在对象上下文浮层，包含对齐/切换/复制类快捷动作。
4. 右侧工具栏会根据选中对象切换为编辑、材质、锁定、复制、镜像、修正、隐藏、删除等对象操作。
5. 门窗/构件尺寸面板以 `mm` 为输入单位，至少包含长度、宽度、高度、距地、边距1、边距2。
6. 门窗/构件在 2D 墙体上显示红色定位线、端点控制点和边距尺寸标注。
7. 3D 构件编辑页可以显示构件模型、墙地面预览，并进入材质分类选择。

## 仍需产品确认的事项

- 门窗/构件是先从素材入口放置，还是先选墙后选择类型；当前录屏只确认了已有对象编辑。
- 边距1/边距2分别对应墙段起点、终点、开向侧还是当前参考边；需要后续录屏或产品定义。
- “转线线”“打断”“排布”“修正”的精确定义、可用对象和数据效果仍需确认。
- 3D 材质选择后是否立即写回 2D 对象，以及是否影响报告、CAD 或报价数据。
- 删除、复制、镜像和锁定是否进入撤销/重做历史，以及跨楼层复制时的行为。

## 阶段边界

- Phase 1-3 继续只验证墙体测绘闭环，不实现门窗/构件、3D 材质或正式数据写入。
- Phase 8 开始前必须先把门窗/构件交互合同写清楚，至少覆盖墙段挂靠、尺寸输入、边距语义、2D/3D 同步和撤销历史。
- 本录屏已经证明门窗/构件并非从零开始，但仍不足以直接编码完整功能；相关能力在库存中标为局部已观察、完整流程待确认。
