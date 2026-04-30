# 企业微信催办定时任务说明

## 目标

将协作自动化提醒扫描接入部署环境的定时任务，定期触发企业微信催办与站内待办补齐。

## 调度入口

- 接口地址：`/api/automation/reminders/run`
- 请求方法：`POST` 或 `GET`
- 鉴权 Header：`x-cron-secret: <CRON_SECRET>`

## 环境变量

在部署环境中配置：

```bash
CRON_SECRET=replace-with-a-strong-secret
```

## 推荐频率

- 每 30 分钟执行一次

## 调用示例

```bash
curl -X POST "https://your-domain.example.com/api/automation/reminders/run" \
  -H "x-cron-secret: replace-with-a-strong-secret"
```

## 预期行为

- 扫描超时跟进、超时测量、超时设计三类记录
- 按企业配置的提醒间隔与最大次数执行幂等催办
- 企业微信缺配置或员工未填写 `wecomUserId` 时，不阻断站内待办，只记录日志

## 联调建议

1. 先在后台企业管理页填写 `CorpID / AgentID / Secret`
2. 在员工管理页为地推员、测量员、设计师、企业负责人填写 `wecomUserId`
3. 打开后台 `提醒日志` 页面观察 `sent / skipped / failed`
4. 使用 `立即执行一次提醒扫描` 按钮做手工联调
