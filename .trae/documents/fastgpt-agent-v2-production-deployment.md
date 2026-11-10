# FastGPT Agent V2 生产部署计划

## Context

目标：在生产服务器 `124.70.90.30` 上与 Admin 同机部署自托管 FastGPT，并把小K Agent V2 开放给全部企业。

当前状态：Agent V2 只连接开发隔离试点 `127.0.0.1:18300`，配置只接受一个企业，桥同时只允许一个活跃 run；生产发布脚本不启动 `assistant-worker`，FastGPT 的 9 个容器也从未在生产部署。用户已确认：**只迁移应用与配置，不迁移 Mongo/MinIO 历史数据；全部企业开放；知识开关全部打开。**

## 已确认决策

| 项 | 决策 |
|---|---|
| 部署位置 | 与 Admin 同机，生产服务器 `124.70.90.30` |
| 数据范围 | 只迁 FastGPT 应用/工具集/模型/配置，不迁账号、会话、MinIO 文件 |
| 企业范围 | 全部 active 企业 |
| 多企业方式 | 每企业一套 FastGPT 应用 + 独立 `bridgeKey`，同一 `18310` 监听按 key 路由（逻辑多桥） |
| 知识开关 | 全部企业打开 `enterpriseKnowledgeEnabled` |
| 服务器权限 | 需要临时 SSH 授权 |

## 关键事实（先纠正两处）

1. **桥在 Admin 容器，不在 assistant-worker。** `assistant-worker` 只是轮询 `http://admin:3005/api/internal/assistant/jobs/run` 的触发器；`processAgentV2Answer` 和 `FastGPTWorkflows` 都在 Next.js 进程内执行。因此 FastGPT 的回调地址是 `http://admin:18310`，不是 `assistant-worker:18310`。
2. **FastGPT 本身不限制多企业。** 它按“应用”管理，不识别我们的 `enterpriseId`。单企业限制来自本项目：`config.ts` 只解析一个 `agentV2`，`FastGPTAgentV2` 实例只持有一个 `bridgeKey` 和一个 ticket 槽。多桥可行，不需要改 FastGPT。

其他约束：
- `fastGPTWorkflows()` 在运行期发现配置文件 hash 变化会直接抛错（`runtime.ts:74`），所以**任何配置写入都必须重启 Admin**；不能热改。
- FastGPT 4.17.4 的 HTTP 工具节点只能带静态头，不能注入每次 run 的 token；因此回调归属只能靠每企业独立 `bridgeKey`。
- 每个 `FastGPTAgentV2` 实例内部仍是单活跃 run；多企业并发靠多实例，单企业并发仍返回 `conversation_busy`。

## Phase 0：临时授权与只读盘点（阻塞项）

用户提供临时 SSH 访问（root 或具备 docker/psql 权限的部署账号），我会：

1. 生成一次性 ed25519 密钥，只用于本次部署；公钥由用户临时加入 `authorized_keys`，部署完成后移除并验证失效。
2. 只读盘点，不改任何东西：

```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker compose ls; docker network ls; docker version; uname -m
docker inspect smart-floor-planner-admin --format '{{json .NetworkSettings.Networks}}'
free -h; df -h /datas; nproc
ss -lntp | grep -E ':(18300|18310|3005|5432)' || true
docker exec smart-floor-planner-postgres psql -U sfp_owner -d smart_floor_planner -Atc \
 "select id,name,status from app.enterprises order by id"
docker exec smart-floor-planner-postgres psql -U sfp_owner -d smart_floor_planner -Atc \
 "select enterprise_id,enabled,policy_version,active_index_profile_id,agent_config from app.assistant_enterprise_settings order by enterprise_id"
docker exec smart-floor-planner-postgres psql -U sfp_owner -d smart_floor_planner -Atc \
 "select key,(llm_config is not null) from app.platform_configs"
```

**退出标准**：冻结 active 企业 ID 清单；`/datas` 剩余 ≥ 30GB、可用内存 ≥ 8GB；`sfp-ai-net` 未被占用；18300/18310 未监听；DashScope profile 存在；确认 `assistant-worker` 当前是否运行；确认各企业知识索引 `active_index_profile_id` 是否已发布。

## Phase 1：代码改动

### 1. 多企业配置
`admin/src/lib/assistant/fastgpt/agent-v2/config.ts`
- `agentV2` 接受对象或数组，规范化为 `Map<enterpriseId, AgentV2Configuration>`；重复 enterpriseId、非法项一律 `context_changed`。
- 新增 `parseAgentV2Configurations(value)`；`fastGPTAgentV2Configuration(enterpriseId)` 改为按企业查找。
- **保留文件级 binding hash**（不改为条目级），避免改动 `policy_snapshot` 语义；配置变更统一重启 Admin。
- `protocol` 保持 `fastgpt-agent-v2-v1`。

### 2. 生产端点校验
`admin/src/lib/assistant/fastgpt/agent-v2/runtime.ts:51-63`
- 删除 `hostname ∈ {127.0.0.1, localhost}` 且 `port === 18300` 的硬校验。
- 改为：必须是 `http|https`，无 userinfo/query/hash；`host:port` 必须命中 `XIAOK_FASTGPT_ENDPOINT_ALLOWLIST`（逗号分隔；默认 `127.0.0.1:18300`；生产加 `sfp-fastgpt-app:3000`）。
- 保留 `bridgeKey.length >= 32`。

### 3. 逻辑多桥与监听地址
`admin/src/lib/assistant/fastgpt/runtime.ts`
- `Configuration.agentV2` 支持数组；构建 `FastGPTAgentV2[]`，并建立 `Map<sha256(bridgeKey), instance>`。
- `handle()` 对 `/agent-v2-tool/*` 先按 `Authorization: Bearer <key>` 摘要路由；未知 key 返回 404，不再落到单个实例。
- 监听地址读 `XIAOK_FASTGPT_BRIDGE_BIND`（默认 `127.0.0.1:18310`；生产 `0.0.0.0:18310`），不发布宿主端口。
- `knowledgeAppId`/`stageAppId` 改为在存在 `agentV2` 时可缺省；缺省时 `/knowledge-*`、`/stage-*` 返回 404，避免伪造 appId。生产只建 Agent V2 应用。

### 4. 按企业执行
`admin/src/lib/assistant/fastgpt/agent-v2/worker.ts:88-133`
- 用 `workflows.agentV2For(lease.enterpriseId)` 取企业实例；删除第 133 行全局 `busy()`，由实例内 `run()` 的 `busy()` 负责。
- 开场 `intro()` 与追问 `suggest()` 使用同一企业实例。

### 5. 多企业开场注册表
`admin/src/lib/assistant/fastgpt/agent-v2/openings.ts`
- 保持 `xiaok-openings-v1`；解析器同时接受 `{enterpriseId,scenes}`（兼容 1454 旧文件）和 `{enterprises:{id:{scenes}}}`。
- `openingScene(enterpriseId, scene)` 按企业查找；跨企业不可见。

### 6. 生产 Compose 与网络
`admin/docker-compose.yml`
- 新增 external network `sfp-ai-net`，只让 `admin` 接入（alias 即 `admin`）。
- `admin` 增加只读挂载 `${SFP_FASTGPT_CONFIG_DIR:-/datas/sfp-fastgpt-prod/config}:/config:ro`。
- `assistant-worker` 保留 `assistant` profile；`deploy.sh` 用 `--profile assistant` 显式启动。
- 新增一次性 `provision` 服务（`profiles:["provision"]`，接入默认网 + `sfp-ai-net`，挂载 `/config:rw`），运行 plain-node provisioning 脚本。

### 7. 发布与部署脚本
- `admin/deploy.sh:65-84`：Compose 服务校验加入 `assistant-worker`（校验命令补 `--profile assistant`）。
- `admin/deploy.sh:201-252`：`up -d --force-recreate admin lead-claim-worker assistant-worker`；增加 `wait_for_assistant_worker_health`；部署后校验 `/config/workflows.json`、`/config/openings.json` 在 admin 容器内可读。
- `admin/release.ps1:121-169,214-262`：发布包纳入 `deployment/fastgpt/production.compose.yml`、`production/` 模板与 `scripts/fastgpt/agent-v2-provision-prod.mjs`；仍不打包任何密钥。
- `admin/.env.example`：补 `XIAOK_FASTGPT_ENDPOINT_ALLOWLIST`、`XIAOK_FASTGPT_BRIDGE_BIND`、`SFP_FASTGPT_CONFIG_DIR`。

### 8. 新增生产资产
- `admin/deployment/fastgpt/production.compose.yml`：9 服务、Linux bind volumes、`mem_limit`、日志轮转、`app` 只发布 `127.0.0.1:18300:3000`、`app.networks=[default,sfp-ai-net]`、`CHECK_INTERNAL_IP=false`、`NO_PROXY` 含 `admin`。
- `admin/deployment/fastgpt/production/secure-root.cjs`：由 `secure-pilot-root.cjs` 改名，保留“只替换厂商初始 123456”的逻辑，要求 64 位 hex `DEFAULT_ROOT_PSW`。
- `admin/deployment/fastgpt/production/templates/agent-v2-app.json`：从 `tmp/agentv2-test-detail.json` 提取 `nodes/edges`，脱敏后入库。
- `admin/scripts/fastgpt/agent-v2-provision-prod.mjs`：plain Node（无 tsx），登录 FastGPT 管理 API，按企业创建工具集/主应用/建议应用/开场应用并发布，写 `/config/workflows.json`、`/config/openings.json`（临时文件 + rename，`root:1001 0640`）；状态存 `/config/provision-state.private.json`。

### 9. 文档同步
- `docs/xiaok-fastgpt-agent-layering.zh-CN.md`、`docs/remote-development.zh-CN.md` 的模块清单加入生产 FastGPT。
- `docs/production-deployment.zh-CN.md` 增加 FastGPT 栈的目录、网络、启动、回滚顺序。

## Phase 2：测试

- 更新 `admin/src/lib/assistant/__tests__/agent-v2-gateway.test.ts`：allowlist 内 `127.0.0.1:18300` 继续通过；新增“allowlist 外拒绝”；新增“两个 bridgeKey 各自路由、互不占 busy”。
- 新增 `admin/src/lib/assistant/__tests__/agent-v2-config.test.ts`：单对象/数组兼容、重复 ID 拒绝、未知企业返回 undefined、`langgraph-v1` 返回 undefined。
- 更新 `admin/src/lib/assistant/__tests__/agent-v2-openings.test.ts`：多企业注册表、旧单企业格式兼容、跨企业不可见；移除对 dev appId 的硬断言（生产 appId 会重建）。
- 更新 `admin/src/db/__tests__/assistant.test.ts`：两个企业同时投递均走 V2，不出现跨企业 `conversation_busy`；单企业第二个请求仍 `conversation_busy`。
- 回归：`npm run test:ai`、`npm run test:assistant`、`npm run lint`、`npm run build`。

## Phase 3：生产 FastGPT 栈

1. 建目录：`/datas/sfp-fastgpt-prod/{config,secrets,volumes,backup}`；`docker network create sfp-ai-net`。
2. 写 `/datas/sfp-fastgpt-prod/secrets.env`（0600）：全新 Mongo/vector/redis/MinIO/proxy-db/sandbox/plugin 密码，`ROOT_KEY`、`DEFAULT_ROOT_PSW`（64 hex）、`FILE_TOKEN_KEY`、`AES256_SECRET_KEY`、`INVOKE_TOKEN_SECRET`。
3. `docker compose -f production.compose.yml --env-file secrets.env up -d`，等 9 个服务全部 healthy。
4. 首次启动由 `secure-root.cjs` 把厂商默认密码替换为 `DEFAULT_ROOT_PSW`，不保留默认账号。
5. 镜像全部使用 dev compose 已验证的阿里云地址；若生产拉取失败，从 dev 主机 `docker save` 后 `docker load`（同为 linux/amd64）。
6. 资源上限：mongo 2g、vector 2g、redis 512m、minio 512m、aiproxy 512m、plugin 512m、code-sandbox 1g、app 2g；上线前确认 `free -h` 余量。

## Phase 4：应用与配置迁移

1. 从 dev 导出主应用/建议应用/开场应用详情，与 provisioning 脚本里的 prompt 比对；若存在手改，先合并进模板，避免丢失。
2. 运行 `provision` 服务：
   - 用生产 Admin 的 `platform_configs` + `AI_PROVIDER_KEY_ENCRYPTION_SECRET` 解出 DashScope key，创建 aiproxy 渠道与模型；
   - 对每个 active 企业：创建工具集（`baseUrl=http://admin:18310`，独立 32 字节 `bridgeKey`）→ 发布工具集 → 主应用（6 个工具）→ 建议应用（无工具）→ 开场应用（无工具、无数据集、`history=0`）→ 发布；
   - 发布顺序必须是“工具集先发布，再发布主应用”，否则运行期 `tool_not_exist`；
   - 写入 `workflows.json`：`baseUrl=http://sfp-fastgpt-app:3000`、`apiKey`、`agentV2` 数组（每企业 `appId/model/bridgeKey/suggestionAppId/runtime`，开场 appId 写入 `openings.json`）。
3. 不迁移 Mongo/MinIO/pgvector；生产 FastGPT 使用全新卷。`knowledgeAppId`/`stageAppId` 不写（已允许缺省）。
4. 文件权限：`root:1001 0640`；Admin 以 uid 1001 运行，需在部署检查中验证可读。

## Phase 5：项目发布与全企业开通

1. 更新 `/datas/smartfloor/.env.production`：
   ```
   XIAOK_FASTGPT_WORKFLOWS_FILE=/config/workflows.json
   XIAOK_OPENINGS_FILE=/config/openings.json
   XIAOK_FASTGPT_ENDPOINT_ALLOWLIST=sfp-fastgpt-app:3000
   XIAOK_FASTGPT_BRIDGE_BIND=0.0.0.0:18310
   SFP_FASTGPT_CONFIG_DIR=/datas/sfp-fastgpt-prod/config
   ```
2. 构建新发布包并部署：`auto_deploy.sh deploy`，确认 `admin`、`lead-claim-worker`、`assistant-worker` 均 healthy。
3. 从 FastGPT 容器验证回调：`docker exec sfp-fastgpt-prod-app-1 curl -s -o /dev/null -w '%{http_code}' http://admin:18310/agent-v2-tool/x` 应为 404/409，不是超时。
4. 分批打开知识开关（先 1 家，再全部）：
   ```sql
   update app.assistant_enterprise_settings
   set agent_config=jsonb_set(coalesce(agent_config,'{}'::jsonb),'{enterpriseKnowledgeEnabled}','true'::jsonb),
       policy_version=policy_version+1, version=version+1, updated_at=now()
   where enterprise_id = ANY($1);
   ```
   打开前确认该企业 `active_index_profile_id` 有已发布文档；没有索引的企业先补索引，否则 V2 回答会缺证据。
5. 全部企业配置完成后，`workflows.json` 不再改动；如需改动，重启 Admin。

## Phase 6：验收

- FastGPT 9 服务 healthy；Admin/worker healthy；桥监听 0.0.0.0:18310。
- 单企业：真实会话走 V2，工具回调成功，`[id](CITE)` 引用可打开，usage 记录 `agent-v2-*` 四类齐全。
- 开场：`site.public` 场景返回受限字数文本，不调用工具。
- 追问：建议应用生成 3 条，不带工具。
- 并发：两个企业同时提问均成功；同一企业第二个请求返回 `conversation_busy`。
- 隔离：用企业 A 的 key 调企业 B 的 appId 工具应 404/409，不返回 B 的数据。
- 回归：关闭知识开关后，新 run 回退内置 LangGraph，不报错。

## 回滚

1. **停新流量**：目标企业 `enterpriseKnowledgeEnabled=false` 并 bump `policy_version`，新 run 走内置运行时。
2. **确定性回退**：`workflows.json` 中该企业 `runtime:"langgraph-v1"`，原子写文件，重启 Admin。
3. **整栈回退**：`auto_deploy.sh rollback` 回上一镜像；FastGPT 栈可保留不动（不参与内置链路）。
4. 已产生的消息、引用、usage 都在 PostgreSQL，不受 FastGPT 回滚影响；不反向迁移数据。

## 风险（高→低）

1. **资源争抢/OOM**：9 个 FastGPT 容器与现有约 30 个容器同机；必须设 mem_limit、先测峰值。
2. **跨企业串数据**：任何两个企业复用 bridgeKey 都会越权；provision 必须断言全局唯一，路由按 key 精确匹配。
3. **配置热改 500**：`fastGPTWorkflows()` 检测到 hash 变化直接抛错；所有配置写入后必须重启 Admin。
4. **文件权限**：`root:0600` 会导致 Admin 读不到，V2 静默关闭；必须 `root:1001 0640` 并在部署检查中验证。
5. **工具集发布顺序**：先发工具集再发主应用，否则 `tool_not_exist`。
6. **知识未就绪即全开**：检索为空或 `missing_citation`；按企业检查 `active_index_profile_id`。
7. **生产端点/网络**：`CHECK_INTERNAL_IP=false` 接受私网回调；只把 FastGPT `app` 接入 `sfp-ai-net`，桥不发布宿主端口。
8. **发布脚本漏改**：`assistant-worker` 不启动则所有助手任务不执行；新 compose 不进包则生产无文件。

## 需要你提供/确认

1. 临时 SSH 公钥授权（`124.70.90.30`，部署完成后移除）。
2. 生产 active 企业清单以 Phase 0 查询结果为准；若有“暂不对客”的企业，请指出，否则按全部打开。
3. 各企业知识库是否已完成审核并可对客；未就绪的企业先补索引再开开关。
4. DashScope key 在生产 `platform_configs` 中可解密（需要 `AI_PROVIDER_KEY_ENCRYPTION_SECRET`）；若已轮换，请提供新 key。
5. 是否允许运维通过 SSH 隧道访问 FastGPT 控制台（默认不开放公网端口）。
