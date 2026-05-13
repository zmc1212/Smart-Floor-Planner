#!/bin/bash
# 在本地执行构建并尝试推送

IMAGE_NAME="zmc1212/sfp-admin:latest"
SAVE_PATH="./sfp-admin.tar"

echo "🏗️ 正在本地构建 Docker 镜像..."
docker build -t $IMAGE_NAME .

echo "📤 正在尝试推送到 Docker Hub..."
if docker push $IMAGE_NAME; then
    echo "✅ 推送成功！现在可以去服务器运行 deploy.sh 了。"
else
    echo "❌ 推送失败 (可能是网络代理问题)。"
    echo "📦 正在执行备选方案：将镜像打包为本地文件..."
    
    # 导出镜像到本地
    docker save -o $SAVE_PATH $IMAGE_NAME
    
    echo "------------------------------------------------"
    echo "✨ 本地打包完成！"
    echo "📄 文件路径: $(pwd)/sfp-admin.tar"
    echo "💡 下一步操作："
    echo "  1. 将 sfp-admin.tar 上传到服务器"
    echo "  2. 在服务器运行: docker load -i sfp-admin.tar"
    echo "  3. 然后运行 deploy.sh 启动容器"
    echo "------------------------------------------------"
fi
