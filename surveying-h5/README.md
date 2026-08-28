# 正式量房 H5 算法验证台

该目录提供一个只在本地浏览器运行的正式量房验证台。它不复制拓扑算法：每次构建都
直接打包以下小程序生产源文件，因此小程序算法改动后重新构建即可同步：

- `miniprogram/packages/surveying/editor/surveying-editor.js`
- `miniprogram/packages/surveying/utils/surveyWallGraph.js`
- `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js`

`surveyWallGraph.js` 现在是兼容门面，构建器会继续解析并打包其
`miniprogram/packages/surveying/utils/survey/` 依赖。H5 可调用新增的
`validateSurveyDraft(draft, { mode: 'quick' | 'full' })` 做显式诊断；Face shadow 只在
`full` 中运行，不会自动重建或持久化空间。生产编辑器也只在 `completed` 云端保存前运行
`full`，页面加载和拖动帧不会执行它。H5 使用同一事务内核和 SnapEngine，不维护分叉实现。

`src/main.js` 只实现浏览器平台桥，包括 `Page/setData`、本地存储、Canvas 查询、鼠标/
Pointer 事件、Toast、Fetch 请求适配和可控 BLE 读数注入。正式页面路由、业务 API、
租户权限及云端保存不是该实验台的测试目标，默认不会调用或写入生产服务。

## 启动

```powershell
cd surveying-h5
npm install
npm run dev
```

默认地址为 `http://localhost:4173`。可用 `npm run dev -- --port=4180` 指定端口。

## 可验证范围

- 直墙/斜墙拖动、平移与滚轮缩放；
- 当前生产墙图的吸附、闭合、尺寸、墙体实体及房间面积渲染；
- 点选已有墙后用画布右上角「删墙」删除；两个闭合房间的共用墙会打通合并成一个闭合房间。右侧「共墙多空间」里的删除合并场景可直接回放该结果；
- 浏览器不渲染小程序原生 `cover-view` 浮动栏，所以正式页上的「添门 / 复尺 / 删除」胶囊不会出现在 H5 画布上，删墙请用画布右上角工具栏；
- 模拟 BLE 毫米读数写入当前待测墙或最近已确认墙；
- 撤销、重做、本地草稿、version-4 JSON 导入/导出；
- 39 个代表场景按单空间轮廓、连续测量、共墙多空间、交点与分支、墙体与构件分组回放；
- 场景覆盖矩形/L/U/错台/梯形/切角/飘窗位、正交或斜向开放墙链、等高/上下/错层共墙双房、
  单房分割、横排三房、T 型三房、十字四房、直墙/斜墙 T 型与十字交点、门窗迁移及不同墙厚；
- 用户提供的错层共墙双房截图映射为 `staggered-adjacent`，其两房尺寸固定回归为
  `2761×3223 mm` 与 `3082×4120 mm`；
- 场景自动适配会按固定测距栏的实际占用高度预留底部安全区，闭合墙和尺寸链不会被控件遮挡；
- T 型三房按左房、右上房、右下房的现场顺序沿共墙逐间闭合，并由三向共享交点回归约束，
  避免隔墙内缩语义在交点墙面形成三角缺口；
- `window.__surveyingH5` 提供给浏览器自动化的只读快照和受控场景入口。

每个场景都由 `src/scenarios.js` 调用生产 `surveyWallGraph.js` 构造，并在
`test/scenarios.test.js` 中执行 `full` 墙图校验及墙数/闭合空间数/开口数断言。场景目录
覆盖当前正式墙图支持的代表拓扑族，不表示曲墙、圆弧、独立楼栋或楼层高差已进入
version-4 二维墙图合同。

浏览器不会模拟真实微信 BLE、原生 `cover-view`、设备运动传感器、微信页面栈或真机
Canvas 差异。相关结论仍必须用现有微信开发者工具窗口与真机验证；H5 主要用于把算法、
状态机和浏览器 Canvas 回归从微信运行环境中分离出来。
