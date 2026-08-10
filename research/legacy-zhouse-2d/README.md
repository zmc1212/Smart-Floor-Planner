# ZHouse 2D 独立还原引擎

本目录是旧 `com.zbj.zhouse_26.7.16.apk` 的独立 2D 行为还原实验室。它不属于
小程序运行包，不是第二个正式量房入口，也不会读取或写入正式
`FloorPlan.layoutData`。

## 强制边界

- `miniprogram/packages/surveying/editor/surveying-editor.*` 仍是唯一正式量房页面。
- 本目录不得被 `miniprogram/`、`admin/` 或服务端 API 导入。
- 本目录不得连接 BLE、登录态、租户数据、生产接口或数据库。
- APK 内部模型只存在于研究模块；不得作为 `rooms`、`homeOutline`、
  `partitions` 等旧布局副本写回正式户型。
- 将来如需导出 version-4 `surveyGraph`，必须通过单独、显式且经过验证的适配器；
  第一阶段不提供该适配器。

## 证据规则

`provenance/method-map.json` 是方法级还原台账。一个方法只有在实际取得对应证据后，
才能依次从 `located` 更新为：

1. `decompiled`：已取得 native 伪代码，并核对 RVA 和函数边界；
2. `reconstructed`：已在本目录中实现独立候选；
3. `verified-static`：关键控制流、常量、取整和浮点分支已与 ARM64 指令核对；
4. `verified-runtime`：相同操作输入已与隔离环境中的旧 APK 输出核对；
5. `matched`：固定样例和差分回归均一致。

禁止根据方法名或当前小程序行为把推测逻辑标成已还原。当前阶段的几何代码只是
确定性的独立基础设施，尚不代表 APK 某个方法的行为。

## 当前目录

```text
provenance/       APK、方法地址、证据和还原状态
src/geometry/     无平台依赖的毫米制几何基础
src/model/        研究模块自己的 JSON 友好模型
src/rendering/    与 Canvas 解耦的确定性绘制命令
src/engine/       仅允许显式注册已实现方法的执行容器
test/             独立单元测试、边界测试和后续差分回归
tools/            溯源与隔离校验
```

## 运行验证

```powershell
cd research/legacy-zhouse-2d
npm test
npm run verify
```

## 第一阶段状态

- `Implemented`：独立包边界、方法溯源台账、点/线段/多边形基础运算、墙中心线
  双侧偏移、JSON 友好研究模型、绘制命令缓冲区、未实现方法保护和独立测试。
- `Limited`：目前台账方法均只完成元数据定位；没有方法被声明为 APK 算法还原完成。
- `Placeholder`：native 伪代码、真实动态调用轨迹、门窗/房间/编辑状态机以及
  经过审批的 v4 导出适配器。
