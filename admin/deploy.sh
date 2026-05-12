#!/bin/bash
# g:\workspace\向总\Smart-Floor-Planner\admin\deploy.sh

set -e

echo "📦 正在拉取最新的预构建镜像 (zmc1212/sfp-admin)..."
docker-compose pull admin

echo "🚀 正在启动/更新服务容器..."
docker-compose up -d

echo "⏳ 等待数据库就绪..."
sleep 10

echo "🗄️ 执行数据库自动化初始化..."
# 注意：scripts 目录已经通过 Dockerfile 打包在镜像内部了
docker exec -i smart-floor-planner-admin node scripts/seed-admin.js

echo "------------------------------------------------"
echo "✅ 部署圆满完成！"
echo "🔗 访问
