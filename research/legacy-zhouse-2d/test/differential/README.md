# 差分测试夹具

后续从隔离环境采集旧 APK 方法轨迹时，每次调用保存一份符合
`../fixtures/method-trace.schema.json` 的 JSON。夹具必须引用
`provenance/method-map.json` 中的 `methodId`，并保留调用顺序、输入、输出以及必要的
调用前后状态。

夹具不得包含真实账号、Token、生产地址、客户资料、设备授权信息或其他凭据。坐标和
长度保留 APK 实际值，不为通过测试提前取整。数组顺序视为业务语义；对象键由
`src/differential/canonicalize.js` 规范化，以消除 JSON 属性顺序造成的假差异。

只有同时具备静态证据和动态夹具的方法，才能进入 `verified-runtime`；截图只能作为
渲染补充证据，不能替代几何和状态输出。
