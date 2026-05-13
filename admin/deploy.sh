#!/bin/bash
# g:\workspace\向总\Smart-Floor-Planner\admin\deploy.sh

set -e

if [ -f "sfp-admin.tar" ]; then
  echo "📥 检测到本地镜像包 sfp-admin.tar，正在导入..."
  docker load < sfp-admin.tar
  # 导入后可以选择是否删除包以节省空间，这里建议保留，由用户手动管理
else
  echo "📦 正在拉取最新的预构建镜像 (zmc1212/sfp-admin)..."
  docker-compose pull admin
fi

echo "🚀 正在启动/更新服务容器..."
docker-compose up -d

echo "⏳ 等待数据库就绪..."
sleep 10

echo "🗄️ 执行数据库自动化初始化..."
# 通过容器内部网络调用 API 触发初始化，带上安全密钥
docker exec -i smart-floor-planner-admin curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: sfp_internal_init_secret_2024" \
  http://127.0.0.1:3005/api/internal/seed | grep -E "message|error"

echo "------------------------------------------------"
echo "✅ 部署圆满完成！"
echo "🔗 访问地址: http://您的服务器IP:3005"
echo "------------------------------------------------"
