#!/bin/bash
# 在本地执行
echo "🏗️ 正在本地构建 Docker 镜像..."
docker build -t zmc1212/sfp-admin:latest .

echo "📤 正在推送到 Docker Hub..."
docker push zmc1212/sfp-admin:latest

echo "✅ 发布完成！现在可以去服务器运行 deploy.sh 了。"
