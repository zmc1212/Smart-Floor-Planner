# 自动化提醒定时任务说明

## 目标

将协作自动化提醒扫描接入部署环境的定时任务，定期补齐站内待办和通知记录。

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

- 扫描超时跟进、超时测量、超时设计三类记录。
- 按企业配置的提醒间隔与最大次数执行幂等催办。
- 在站内记录通知结果；通知发送失败不阻断后续待办处理。

## 联调建议

1. 配置 `CRON_SECRET` 并使用有效平台管理员身份登录。
2. 打开后台 `提醒日志` 页面观察 `sent`、`skipped`、`failed` 状态。
3. 使用“立即执行一次提醒扫描”按钮做手工联调。
