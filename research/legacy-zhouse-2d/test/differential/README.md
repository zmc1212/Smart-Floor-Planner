# 差分测试夹具

## 静态黄金轨迹

`static/*.json` 来自 Cpp2IL ISIL、ILSpy C# 和 Ghidra 伪代码确认的调用顺序。它们由
`src/differential/static-fixture-runner.js` 执行，用于防止候选编排在后续清理中退化。
执行器通过 `provenance/method-map.json` 的 `file#export` 查找实现，而不是维护第二份方法映射；
因此台账指向错误导出时，静态回归会直接失败。
这类夹具的 `fixtureKind` 固定为 `static-orchestration`，只允许支持
`reconstructed`，不能把方法提升为 `verified-runtime`。

## 旧 APK 运行时轨迹

后续从隔离环境采集旧 APK 方法轨迹时，每次调用保存一份符合
`../fixtures/method-trace.schema.json` 的 JSON。夹具必须引用
`provenance/method-map.json` 中的 `methodId`，并保留调用顺序、输入、输出以及必要的
调用前后状态。

夹具不得包含真实账号、Token、生产地址、客户资料、设备授权信息或其他凭据。坐标和
长度保留 APK 实际值，不为通过测试提前取整。数组顺序视为业务语义；对象键由
`src/differential/canonicalize.js` 规范化，以消除 JSON 属性顺序造成的假差异。

只有同时具备静态证据和动态夹具的方法，才能进入 `verified-runtime`；截图只能作为
渲染补充证据，不能替代几何和状态输出。

## 首个运行时样本

`runtime/rectangle-wall-01.json` 至 `rectangle-wall-04.json` 来自独立雷电 9
`ZHouseResearch` 实例中的合成空白户型。Frida 以 `emulated` ARM64 realm 只读记录
`AddWall.points` 和嵌套 `CloseRoom` 的入口/返回，没有替换参数、返回值或方法实现。

样本坐标为 `(0,0) → (938,0) → (938,-1531) → (0,-1531) → (0,0)`。原 APK 传入
`thick=-200`；夹具同时保留 `absoluteThicknessMm=200`，但不得丢弃负号，因为尚不能排除
它携带墙厚方向语义。该样本证明真实调用顺序和结果枚举，尚未包含墙/房间完整前后状态，
因此不能单独把方法提升到 `verified-runtime`。

## 内墙分割状态样本

`runtime/internal-wall-split.json` 来自同一隔离模拟器中的合成矩形。原房间中心线轮廓为
`(0,0) → (-3300,0) → (-3300,-5531) → (0,-5531)`；输入墙为
`(-1700,200) → (-1700,-5531)`、`thick=-200`。原 APK 返回 `ClosedRoom5 (10)`，并将
一个 `18,252,300 mm²` 房间分成 `7,743,400 mm²` 和 `9,402,700 mm²` 两间。减少的
`1,106,200 mm²` 恰好等于 `200 × 5531`，对应新增内墙占用的房间面积。

夹具按 `../fixtures/runtime-state-transition.schema.json` 保存三个时间点：

- `beforeState`：进入 `AddWall` 前的单房间及四面墙；
- `returnState`：`AddWall` 返回时已产生两个房间，但两个 `roomWalls` 列表暂为空；
- `afterState`：界面稳定后的两个房间，每间均恢复为四面墙。

规范化过程移除进程地址、对象指针和调用耗时，仅保留毫米坐标、类型、房间面积、轮廓、
墙体字段与数组顺序。原始只读采集保留在忽略提交的 `.codex-tmp/zhouse-runtime/traces/`。
`src/geometry/rectangular-inside-wall.js#addInsideWall` 已从 `beforeState` 和同一输入独立重算
`returnState`/`afterState`，并在 `test/rectangular-inside-wall.test.js` 中逐字段匹配。完整
`AddWall.points` 编排也确认按静态调用顺序进入该候选并返回 `ClosedRoom5`。因此这两个方法
提升为 `verified-runtime`，但仅代表这一固定几何类别已经运行时验证，不代表完整方法覆盖。
随后采集的 `runtime/horizontal-wall-split.json` 使用从左到右的
`(-5356,-1642) → (0,-1642)`、`thick=-200`，将 `17,298,380 mm²` 房间分为
`8,466,152 mm²` 与 `7,801,028 mm²`。减少的 `1,031,200 mm²` 等于 `200 × 5156`。
该夹具还从 `Nullable<HouseWall2D>` 输出缓冲区解码出裁剪后的完整 `newWall`，并规范化记录
`originRoom` 非空、`newRoom` 为空，不保留进程地址。候选已逐字段匹配横向的三个状态和
输出参数。

在反向样本加入前，当前匹配范围限于从上到下竖向与从左到右横向；尚未解码 `originRoom`
指向对象的内容。
同一会话的 `runtime/horizontal-wall-split-reverse.json` 与
`runtime/vertical-wall-split-reverse.json` 补齐了反向调用。它们采用 `runtime-state-return`
格式（见 `../fixtures/runtime-state-return.schema.json`），因为用户在各次验证后立即撤销，
所以保存方法返回状态和输出参数，不伪造稳定快照。

两条反向样本确认：`newWall.P0/P1` 按调用者的方向保留，但 `P2/P3` 总向输入线段的右侧偏移
一个绝对墙厚。候选已经按该规则匹配四个轴对齐方向。已有未闭合 `wallSeries`、斜向、曲线、
多房间、非矩形和正墙厚输入仍会明确拒绝；`originRoom` 指向对象的内容尚未解码。
