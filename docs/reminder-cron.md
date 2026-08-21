# 自动化提醒定时任务说明

## 目标

定期扫描并处理**上门量房预约过期**，补齐站内待办与小程序订阅（`measurement_appointment`）。  
旧企业报备的跟进/量房/设计 SLA 催办已停发，不再由本任务扫描。

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

- 仅扫描预约表中已到期的确认预约并标记过期，按现行矩阵通知设计师、测量员与客户。
- 不扫描 `promotion_enterprise_records` 的跟进/量房/设计超时，也不发送旧报备站内/微信催办。
- 微信订阅发送失败不阻断后续处理。

## 联调建议

1. 配置 `CRON_SECRET` 并使用有效平台管理员身份登录。
2. 打开后台「通知记录」观察预约过期相关 `sent` / `skipped` / `failed`。
3. 使用「执行预约过期扫描」按钮做手工联调。
