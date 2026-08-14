# ZHouse 2D 独立还原引擎

本目录是旧 `com.zbj.zhouse_26.7.16.apk` 的独立 2D 行为还原实验室。它不属于小程序
运行包，不是第二个正式量房入口，也不会读取或写入正式 `FloorPlan.layoutData`。

## 强制边界

- `miniprogram/packages/surveying/editor/surveying-editor.*` 仍是唯一正式量房页面。
- 本目录不得被 `miniprogram/`、`admin/` 或服务端 API 导入。
- 本目录不得连接 BLE、登录态、租户数据、生产接口或数据库。
- APK 内部模型只存在于研究模块；不得把 `rooms`、`homeOutline`、`partitions` 等旧布局
  副本写回正式户型。
- 将来如需导出 version-4 `surveyGraph`，必须通过独立、显式且经过验证的适配器；当前
  阶段不提供该适配器。

## 证据规则

`provenance/method-map.json` 是方法级还原台账。状态按以下顺序推进：

1. `located`：只有类型、签名和 RVA；
2. `decompiled`：取得 native/ISIL/伪代码并核对函数边界；
3. `reconstructed`：本目录已有隔离候选实现；
4. `verified-static`：关键控制流、常量和数值分支已与 ARM64 指令核对；
5. `verified-runtime`：相同输入已与隔离旧 APK 输出核对；
6. `matched`：固定样例和差分回归均一致。

禁止根据方法名或当前小程序行为把猜测逻辑标成已还原。静态黄金轨迹只证明编排回归，
不能代替旧 APK 动态轨迹。

## 当前成果

- 已确认 APK 为 Unity `2022.3.62f2`、ARM64 IL2CPP、metadata `31.1`。
- Cpp2IL 对八个核心 Measure 类型恢复 `358/385` 个方法体，约 `93%`。
- Ghidra 已对成功和失败样本完成独立原生反编译。
- `AddWall` 两个入口、`CloseRoom`、`AddCurveWall`、`AddRoom` 和 `UpdateRoomLine` 的调用图、
  置信度和未决项已记录。
- 已实现可注入依赖的核心编排候选，不包含未经验证的处理器内部几何。
- 已建立静态黄金轨迹和隔离/溯源校验；夹具会从方法台账解析实现，防止方法与导出串位。
- 已在隔离的 `ZHouseResearch` 模拟器采集首个真实运行时矩形：`938×1531 mm`、绝对墙厚
  `200 mm`，四次 `AddWall` 返回 `NewWalls → OnWalls → OnWalls → ClosedRoom0`。
- 已采集一组完整内墙分割状态：原房间 `3300×5531 mm`，`thick=-200` 的竖向墙把它分为
  `7,743,400 mm²` 与 `9,402,700 mm²` 两间，`AddWall` 返回 `ClosedRoom5 (10)`；夹具同时
  保留方法返回瞬间和稳定后的墙/房间状态。
- 已实现首个运行时匹配的 `AddInsideWall` 几何子集：从调用前状态和同一输入重新计算两间
  房的中心、面积、内外轮廓、计算点和墙集合，并与上述旧 APK 夹具逐字段一致。
- 已补充从左到右的横向分割样本：`5156×3355 mm` 原房间被 `200 mm` 内墙分为
  `8,466,152 mm²` 与 `7,801,028 mm²`；完整 `newWall` 输出以及 `originRoom` 非空、
  `newRoom` 为空也已验证。
- 已在同一低负载采集会话补齐反向横墙、反向竖墙。四个方向均返回 `ClosedRoom5 (10)`；
  原方向拥有稳定快照，反向样本保存了方法返回状态和输出参数。`newWall` 的第二墙面会沿
  输入线段右侧偏移，不能只由 `thick=-200` 的符号固定推断。

完整规格见 [`docs/core-editing-algorithm-spec.md`](docs/core-editing-algorithm-spec.md)。

## 目录

```text
docs/               恢复规格与限制
provenance/         APK、方法地址、调用图、证据和还原状态
src/geometry/       无平台依赖的毫米制几何基础
src/model/          研究模块自己的 JSON 友好模型
src/orchestration/  从静态证据恢复的可注入编排候选
src/rendering/      与 Canvas 解耦的确定性绘制命令
src/engine/         仅允许注册已还原方法的执行容器
test/               单元测试、静态黄金轨迹和后续运行时差分夹具
tools/              溯源、调用图与隔离校验
```

## 运行验证

```powershell
cd research/legacy-zhouse-2d
npm test
npm run verify
```

## 当前状态

- `Implemented`：隔离边界、方法台账、调用图、点/线段/多边形基础运算、墙面偏移、
  JSON 研究模型、绘制命令、核心编排候选、静态黄金轨迹、校验工具，以及已采样竖向和
  横向矩形内墙分割的运行时匹配候选。
- `Limited`：`verified-runtime` 已覆盖轴对齐矩形内的四个绘制方向，且已验证 `newWall` 与
  房间输出指针是否为空，但未解码 `originRoom` 对象状态。已有未闭合 `wallSeries`、斜向、
  曲线、多房间、非矩形和正墙厚输入仍会明确拒绝。
- `Placeholder`：门窗完整状态机、曲墙完整编辑、完整运行时样本矩阵、最终行为匹配以及经
  审批的 version-4 导出适配器。
