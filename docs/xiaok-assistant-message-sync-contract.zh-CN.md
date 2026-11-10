# 小K会话消息增量读取接口技术方案

> 状态：服务端、小程序客户端与路径级追加已实施，模块清单已同步（2026-11-10）；真机验收待完成。
> 关联修复：客户端返回页面闪回“正在读取你的装修咨询…”已由 `packages/assistant/lib/chat.js` 的 `refresh()` 静默化修复；本文解决同一条链路上的“整页重复加载”。
> 适用范围：客户小K会话、装修跟进会话（员工侧私人会话沿同一服务继承）。

## 1. 问题与目标

### 1.1 现状（代码事实）

- 进入、返回页面、发送后、运行结束以及每 7 秒轮询，都会执行一次全量快照：
  - `GET /conversations/{id}`
  - `GET /conversations/{id}/messages?limit=30`
  - 然后用 `messagesForView(items)` 整体替换 `messages`（`miniprogram/packages/assistant/lib/chat.js` 的 `snapshot()`，约 184–206 行）。
- 轮询周期：AI 模式 7 秒、人工模式 3 秒（`scheduleConversation`，约 174–182 行）。即使没有新消息，也持续整包读 30 条并整体 `setData`。
- 服务端只支持向旧翻页 `beforeSeq`，没有“读取某条之后的新消息”能力（`admin/src/lib/assistant/core/conversation.ts` 的 `ConversationService.messages`，约 351–370 行）。
- `seq` 是会话内单调递增的 bigint，追加消息时 `last_seq=last_seq+1`（同文件约 107 行）；`UNIQUE(enterprise_id,conversation_id,seq)` 已提供升降序范围扫描索引（`admin/drizzle/0058_assistant_foundation.sql` 第 81 行）。

### 1.2 目标

1. 无新消息时：不请求消息列表、不重绘消息区。
2. 有 N 条新消息时：只传输新增 N 条，不重复传输已渲染历史。
3. 顺序、权限、来源可用性投影、历史翻页语义与全量读取完全一致。
4. 服务端先上线也不影响任何旧客户端；客户端可单独回退。
5. 旧消息的来源/媒体撤回变化仍有有界兜底（≤60 秒或重进页面）。

## 2. 接口契约

### 2.1 扩展 `GET /api/miniprogram/assistant/conversations/{id}/messages`

| 参数 | 必填 | 类型/范围 | 语义 |
| --- | --- | --- | --- |
| `afterSeq` | 否 | 十进制 bigint 字符串，`1..9223372036854775807` | 严格大于该 `seq`，按 `seq` 升序返回增量 |
| `beforeSeq` | 否 | 同上 | 严格小于该 `seq`，按 `seq` 降序返回历史（现状不变） |
| `limit` | 否 | 主路由 1..100；跟进路由 1..50 | 默认 20；增量模式建议客户端传 30 |

约束：

- `afterSeq` 与 `beforeSeq` 同时出现 → `422 invalid_message`。
- 非法值（非数字、0、负数、小数、超长、超出 bigint 范围）→ `422 invalid_message`。
- 越权、跨企业、非参与者仍由现有定位器返回统一 `404`，不新增错误码。

增量模式响应（`data`）：

```json
{
  "items": [ { "id": "…", "seq": "117", "authorKind": "assistant", "…": "…" } ],
  "nextCursor": null,
  "afterCursor": "117",
  "latestSeq": "117",
  "hasMore": false,
  "reset": false
}
```

| 字段 | 语义 |
| --- | --- |
| `items` | 仅新增消息，按 `seq` 升序；字段与全量模式完全一致（含引用可用性、discovery 意图、施工提醒等投影） |
| `nextCursor` | 增量模式固定为 `null`，避免与向旧游标混用 |
| `afterCursor` | 下次请求使用的 `afterSeq`；无新增时回显请求值；客户端不得自行用 `items` 最大值推算 |
| `latestSeq` | 本次读取时会话的 `last_seq`，用于判断是否还有新消息 |
| `hasMore` | `items.length === limit`，表示可能还有更多；客户端可立即续取，最多连续 3 页，其余留到下一个轮询周期 |
| `reset` | 仅当 `afterSeq > latestSeq`（客户端游标超前，如切换数据源、保留期清理后的脏游标）为 `true`，此时 `items` 为空；客户端必须改为全量重载 |

全量模式（不传 `afterSeq`）响应保持现有 `items` 降序 + `nextCursor` 契约，仅新增 `latestSeq`、`afterCursor: null`、`hasMore: false`、`reset: false`；旧客户端忽略新增字段即可。

### 2.2 `GET /conversations/{id}` 增加 `lastSeq`

- `conversationDto` 增加 `lastSeq: String(c.last_seq)`。
- 客户端据此在无新消息时直接跳过消息请求；不暴露新敏感信息，不改变定位器与 RLS。
- 跟进会话复用同一 DTO 时自动获得。

## 3. 服务端实现

### 3.1 路由层 `admin/src/lib/assistant/application/http.ts`

- 在现有 `cursor()`/`limit` 解析后读取 `afterSeq`，校验与 `beforeSeq` 互斥。
- 分发：

```ts
else if (path[2] === 'messages' && method === 'GET') {
  const after = cursor('afterSeq');
  if (after !== undefined && params.has('beforeSeq')) fail('invalid_message', 422);
  data = after !== undefined
    ? await service.messageDelta(target, after, limit)
    : await service.messages(target, cursor('beforeSeq'), limit);
}
```

### 3.2 服务层 `admin/src/lib/assistant/core/conversation.ts`

- 保留现有 `messages(conversationId, beforeSeq, limit)` 签名，避免改动 20 余处既有调用与测试；新增：

```ts
messageDelta(conversationId: string, afterSeq: string, limit = 20) {
  return this.readMessages(conversationId, { afterSeq, limit });
}
```

- 抽出私有 `readMessages`，两条路径共用：
  - `repo.conversation(conversationId)` 鉴权与 `last_seq` 读取；
  - `syncConstructionReminders`；
  - `construction_followup` 的 `purpose is distinct from 'construction.report.facts'` 过滤；
  - 逐条 `projectMessage`；
  - `customer_consultation` 且主体为用户的 discovery 意图；
  - 组装 `latestSeq`、`afterCursor`、`hasMore`、`reset`。
- 增量 SQL：

```sql
select id,seq,author_kind,content,answer_kind,created_at,purpose
from app.assistant_messages
where enterprise_id = $1
  and conversation_id = $2
  and seq > $3
  and (purpose 过滤)
order by seq asc
limit $4
```

- 不使用 `offset`，不按 `created_at` 排序（时钟与同毫秒不可靠）。
- 不加 `seq <= last_seq` 上界：读取期间并发追加的消息允许本次返回，下次游标自然收敛。
- `latestSeq = max(读取时的 c.last_seq, 本次返回的最大 seq)`，避免返回的可视消息比 `latestSeq` 新、下一轮重复下发。
- `reset` 判定：`BigInt(afterSeq) > BigInt(c.last_seq)`。

### 3.3 跟进会话 `admin/src/lib/construction/followup-conversation.ts`

- 查询参数白名单由 `['beforeSeq','limit']` 扩为 `['afterSeq','beforeSeq','limit']`，仅 `messages` 资源可带。
- 沿用现有 bigint 正则校验，新增互斥判断；委派 `messageDelta`。

### 3.4 数据库

- 无新迁移：`UNIQUE(enterprise_id,conversation_id,seq)` 已覆盖 `seq >` 范围扫描。
- 实施时用 `explain` 断言命中该唯一索引，避免退化为会话内全表扫描。

## 4. 客户端接入

### 4.1 第一步：跳读 + 增量合并（推荐先落地）

`ChatController` 新增四个内部状态（不进入 `data`，避免无谓渲染）：

- `latestSeq`：已同步到的最新 `seq`（优先取响应 `latestSeq`，分页推进用 `afterCursor`）。
- `rawMessages`：最新窗口的原始投影缓存，用于合并后重新执行 `messagesForView`。
- `lastFullSyncAt`：最近一次全量窗口读取时间，驱动 60 秒兜底。
- `seqSupported`：最近一次 `conversation` 响应是否带 `lastSeq`；不带时客户端不具备增量能力，始终全量（服务端先行部署的兼容路径）。

`snapshot()` 改为“先元数据、后按需取消息”：

1. 读取 `GET /conversations/{id}`。
2. 若 `conversation.lastSeq === latestSeq`：不请求消息、不 emit `messages`，仅应用会话/运行态补丁。
3. 否则读取 `messages?afterSeq={latestSeq}&limit=30`：
   - `reset === true` → 退化为现有全量读取（`limit=30`，替换缓存）。
   - 正常 → 按 `id` 去重、按 `seq` 升序合并 `rawMessages` → `messagesForView(merged)`，再与 `state.messages` 中早于该窗口的已加载历史拼接 → 一次 `set({ messages })`。
   - 若新增消息包含 `planDecision` 或 `publicConsent`：改为全量快照（这两类字段会改变旧消息卡片的“最新一条”归属，整窗重算最稳妥）。
4. `latestSeq = max(data.latestSeq, 本次 items 的最大 seq)`。

全量快照保留在：

- 首次进入、切换会话、身份变化；
- `reset`；
- 发送/接待/方案或公开决定等写操作之后（与现状一致）；
- 页面可见期间每 60 秒一次（记录 `lastFullSyncAt`），兜底旧消息的来源/媒体撤回（`available` 变化不产生新 `seq`）。

积压策略：若 `latestSeq - afterSeq > 200`，直接全量重载最新窗口，避免为补齐历史翻几十页；单轮询周期内增量续取最多 3 页。

上拉历史（`beforeSeq` + `messageCursor`）逻辑不变，与增量游标互不影响。

### 4.2 第二步（可选）：路径级追加

- 当新增项不改变既有项派生字段时，用 `messages[n]` 数据路径 `setData` 追加，避免整数组序列化。
- 页面 `chat-definition.js` 中 `patch.messages` 的副作用（`siteRecords`、`publicSites`、`plans`、`designerCards`、`loadMessageImages`）继续传合并后的完整数组，防止卡片/图片被清空。
- 该步只做性能优化，不改变契约；第一步已能消除“整页重复加载”。

### 4.3 预期行为

- 空闲 7 秒 tick：0 次消息请求，0 次 `messages` 重绘，只有 1 次轻量会话元数据请求。
- 新回答到达：1 次增量请求，`items` 仅 1–2 条。
- 返回页面：1 次元数据 + 0–1 次增量，无全屏 loading、无历史重传。
- 长会话上拉历史后，增量不丢已加载旧页；60 秒兜底全量后回到最新 30 条（与现状一致）。

## 5. 兼容、灰度与回滚

- 服务端先行：`afterSeq` 为可选参数，`lastSeq` 为新增字段，旧客户端行为不变。
- 客户端以 `conversation.lastSeq` 是否存在做能力探测：不存在时自动回退原全量 `snapshot`，异常时同样回退，无需服务端回滚。
- 无 schema 变更、无数据迁移；回滚只涉及客户端读取路径。
- 明确不做：WebSocket/SSE/长轮询推送、发送幂等与 run 状态机改动、消息编辑/删除、跨会话合并、运行内部步骤透出。

## 6. 测试

### 6.1 服务端

- 仅返回 `seq > afterSeq`，升序；`seq == afterSeq` 不返回。
- `limit` 截断、`afterCursor`、`hasMore` 真/假；空结果回显游标。
- `reset`：`afterSeq > last_seq`；不存在的超大值。
- `afterSeq + beforeSeq` → 422；`0`/负数/小数/非数字/超长/越界 → 422；`limit` 越界 → 422。
- 跨租户、非参与者 → 404；入口 token 失效沿用原错误。
- `construction_followup` 的 `purpose` 过滤、discovery 意图、引用/媒体可用性在增量模式与全量一致。
- `lastSeq` 出现在 detail DTO，且不改变现有字段。
- 执行 `cd admin && npm run test:assistant`。

### 6.2 客户端

- 无新消息：消息请求 0 次、`messages` 未 `setData`。
- 增量：合并去重、升序、`latestSeq` 推进、`hasMore` 连续取页。
- `reset` 回退全量；含 `planDecision`/`publicConsent` 时回退全量。
- 上拉历史与增量共存；60 秒兜底全量。
- 返回页面无 loading 闪烁（已有回归用例）。
- 执行 `cd miniprogram && node --test test/assistant-chat.test.js`。

### 6.3 真实链路

- 发送问题 → 离开页面 → 回答完成 → 返回：只发生增量读取，消息保持可见。
- 引用撤权/媒体撤回后：重进页面立即不可用；停留页面时最长 60 秒更新。
- 上拉历史后再收到新回答：旧页不丢失、无重复气泡。

## 7. 验收标准

- 空闲轮询的消息请求数为 0。
- 单条新消息只传输该条（`items.length === 1`），不重复 30 条历史。
- 顺序、权限、投影、游标语义与全量读取一致，无重复/丢失气泡。
- 旧客户端完全不受影响。
- 撤回/不可用最长 60 秒内生效，重进页面立即生效。
- 实施完成后同步更新 `docs/admin-system-modules.zh-CN.md` 与 `docs/miniprogram-system-modules.zh-CN.md` 的对应接口/行为条目。

## 8. 实施顺序（每步可独立提交）

1. 服务端：`conversationDto.lastSeq` + `messages` 的 `afterSeq` + 跟进路由白名单 + 单测。
2. 客户端：`latestSeq` 跳读 + 增量合并 + `reset`/决定类消息回退全量 + 单测。
3. 可选：路径级追加 `setData`。
4. 真机/DevTools 验证与模块清单同步。
