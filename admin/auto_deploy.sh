#!/usr/bin/env bash
# Upload this script beside the versioned release ZIP and its .sha256 file.
# Deploy:   ./auto_deploy.sh deploy [sfp-admin-release-YYYYMMDD-NNN.zip]
# Rollback: ./auto_deploy.sh rollback [YYYYMMDD-NNN]
# Status:   ./auto_deploy.sh status

set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASES_DIR="$SCRIPT_DIR/releases"
STATE_DIR="$SCRIPT_DIR/deploy-state"
COMMAND="${1:-deploy}"
ARGUMENT="${2:-}"

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

for command in docker unzip sha256sum mktemp flock find sort tail tr sed grep mv chmod cmp; do
  command -v "$command" >/dev/null 2>&1 || fail "缺少服务器命令: $command"
done

mkdir -p "$RELEASES_DIR" "$STATE_DIR"
chmod 700 "$RELEASES_DIR" "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || fail '已有发布或回滚任务正在执行，请稍后重试。'

STAGE_DIR_CLEANUP=""
cleanup_stage() {
  if [[ -n "$STAGE_DIR_CLEANUP" && -d "$STAGE_DIR_CLEANUP" ]]; then
    case "$STAGE_DIR_CLEANUP" in
      "$SCRIPT_DIR"/.deploy-staging.*) rm -rf -- "$STAGE_DIR_CLEANUP" ;;
    esac
  fi
}
trap cleanup_stage EXIT

read_state() {
  local name="$1"
  if [[ -f "$STATE_DIR/$name" ]]; then
    tr -d '\r\n' < "$STATE_DIR/$name"
  fi
}

write_state() {
  local name="$1"
  local value="$2"
  local temporary="$STATE_DIR/.${name}.tmp"
  printf '%s\n' "$value" > "$temporary"
  mv -- "$temporary" "$STATE_DIR/$name"
}

resolve_runtime_env() {
  if [[ -n "${SFP_ENV_FILE:-}" ]]; then
    [[ -f "$SFP_ENV_FILE" ]] || fail "SFP_ENV_FILE 不存在: $SFP_ENV_FILE"
    printf '%s\n' "$(cd "$(dirname "$SFP_ENV_FILE")" && pwd)/$(basename "$SFP_ENV_FILE")"
    return
  fi
  if [[ -f "$SCRIPT_DIR/.env.production" ]]; then
    printf '%s\n' "$SCRIPT_DIR/.env.production"
    return
  fi
  if [[ -f "$SCRIPT_DIR/sfp-admin-release/.env.production" ]]; then
    echo '[WARN] 正在使用旧发布目录里的 .env.production；请尽快移动到部署根目录。' >&2
    printf '%s\n' "$SCRIPT_DIR/sfp-admin-release/.env.production"
    return
  fi
  fail "未找到服务器运行环境文件。请创建 $SCRIPT_DIR/.env.production 并 chmod 600。"
}

resolve_compose_project() {
  local discovered=""
  if [[ -n "${SFP_COMPOSE_PROJECT:-}" ]]; then
    printf '%s\n' "$SFP_COMPOSE_PROJECT"
    return
  fi
  for container in smart-floor-planner-postgres smart-floor-planner-admin; do
    if docker container inspect "$container" >/dev/null 2>&1; then
      discovered="$(docker container inspect "$container" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null || true)"
      if [[ -n "$discovered" && "$discovered" != '<no value>' ]]; then
        printf '%s\n' "$discovered"
        return
      fi
    fi
  done
  printf '%s\n' 'smart-floor-planner'
}

current_container_image() {
  if docker container inspect smart-floor-planner-admin >/dev/null 2>&1; then
    docker container inspect smart-floor-planner-admin --format '{{.Config.Image}}'
  fi
}

camera_network_name() {
  local env_file="$1" network="${SFP_CAMERA_NETWORK:-}"
  if [[ -z "$network" && -n "$env_file" && -f "$env_file" ]]; then
    network="$(sed -n 's/^[[:space:]]*SFP_CAMERA_NETWORK[[:space:]]*=[[:space:]]*//p' "$env_file" \
      | tail -n 1 | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
  fi
  printf '%s\n' "${network:-sfp-wvp-cloud_default}"
}

# 旧发布包的 Compose 未声明摄像头外部网络，重建 Admin 后会掉网。
# 这里只给已运行的 Admin 容器补接网络，不重启摄像头网关、WVP 或 ZLM。
ensure_camera_network() {
  local env_file="$1" container=smart-floor-planner-admin network
  network="$(camera_network_name "$env_file")"
  if ! docker container inspect "$container" >/dev/null 2>&1; then
    echo "[WARN] 未找到 Admin 容器，跳过摄像头网络检查。"
    return 0
  fi
  if ! docker network inspect "$network" >/dev/null 2>&1; then
    echo "[WARN] 摄像头网络 $network 不存在，摄像头可能不可用。"
    return 0
  fi
  if docker container inspect "$container" \
    --format '{{range $name, $v := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' \
    | grep -Fxq "$network"; then
    echo "[OK] Admin 已接入摄像头网络 $network。"
    return 0
  fi
  if docker network connect "$network" "$container"; then
    echo "[OK] 已为 Admin 补接摄像头网络 $network。"
  else
    echo "[WARN] 补接摄像头网络 $network 失败，请手工核查摄像头入口。"
  fi
  return 0
}

show_status() {
  echo "Current version:  $(read_state current-version)"
  echo "Current image:    $(read_state current-image)"
  echo "Previous version: $(read_state previous-version)"
  echo "Previous image:   $(read_state previous-image)"
  echo "Compose project:  $(resolve_compose_project)"
  echo "Runtime env:      $(resolve_runtime_env)"
  echo 'Containers:'
  docker ps -a --filter 'name=smart-floor-planner-' --format '  {{.Names}}\t{{.Image}}\t{{.Status}}'
  echo 'Recent backups:'
  if [[ -d "$SCRIPT_DIR/backups/postgresql" ]]; then
    find "$SCRIPT_DIR/backups/postgresql" -maxdepth 1 -type f -name '*.dump' -printf '  %TY-%Tm-%Td %TH:%TM  %s bytes  %f\n' |
      sort | tail -n 5
  else
    echo '  none'
  fi
}

deploy_release() {
  local zip_name="$ARGUMENT" zip_path checksum_file stage_dir package_dir version release_dir
  local runtime_env compose_project old_version old_image

  if [[ -z "$zip_name" ]]; then
    zip_name="$(find "$SCRIPT_DIR" -maxdepth 1 -type f -name 'sfp-admin-release-[0-9]*-[0-9][0-9][0-9].zip' -printf '%f\n' |
      sort | tail -n 1)"
  fi
  [[ -n "$zip_name" ]] || fail '未找到版本化发布 ZIP。'
  [[ "$zip_name" == "$(basename "$zip_name")" ]] || fail 'ZIP 参数只能是部署根目录下的文件名。'
  [[ "$zip_name" =~ ^sfp-admin-release-[0-9]{8}-[0-9]{3}\.zip$ ]] || fail "发布包文件名不合法: $zip_name"
  zip_path="$SCRIPT_DIR/$zip_name"
  checksum_file="$zip_path.sha256"
  [[ -f "$zip_path" ]] || fail "发布包不存在: $zip_path"
  [[ -f "$checksum_file" ]] || fail "缺少发布包校验文件: $checksum_file"
  grep -Eq "^[0-9a-fA-F]{64}  ${zip_name}$" "$checksum_file" || fail 'ZIP SHA-256 文件格式或文件名不匹配。'
  (
    cd "$SCRIPT_DIR"
    sha256sum -c "$(basename "$checksum_file")"
  )

  stage_dir="$(mktemp -d "$SCRIPT_DIR/.deploy-staging.XXXXXX")"
  case "$stage_dir" in
    "$SCRIPT_DIR"/.deploy-staging.*) ;;
    *) fail "临时目录不在部署根目录内: $stage_dir" ;;
  esac
  STAGE_DIR_CLEANUP="$stage_dir"

  echo "[1/4] 在临时目录解压并校验 $zip_name..."
  unzip -q "$zip_path" -d "$stage_dir"
  package_dir="$stage_dir/sfp-admin-release"
  [[ -f "$package_dir/VERSION" ]] || fail '发布包内缺少 VERSION。'
  version="$(tr -d '\r\n' < "$package_dir/VERSION")"
  [[ "$version" =~ ^[0-9]{8}-[0-9]{3}$ ]] || fail "发布版本号不合法: $version"
  [[ "$zip_name" == "sfp-admin-release-$version.zip" ]] || fail 'ZIP 文件名与内部 VERSION 不一致。'
  chmod +x "$package_dir/deploy.sh"
  (
    cd "$package_dir"
    sha256sum -c SHA256SUMS
    sha256sum -c DRIZZLE_SHA256SUMS
  )

  release_dir="$RELEASES_DIR/$version"
  if [[ -e "$release_dir" ]]; then
    [[ -f "$release_dir/SHA256SUMS" ]] || fail "已存在但不完整的版本目录: $release_dir"
    cmp -s "$package_dir/SHA256SUMS" "$release_dir/SHA256SUMS" || fail "版本 $version 已存在但内容不同。"
    echo "[INFO] 复用已校验的版本目录: $release_dir"
  else
    mv -- "$package_dir" "$release_dir"
  fi
  chmod +x "$release_dir/deploy.sh"
  rm -rf -- "$stage_dir"
  STAGE_DIR_CLEANUP=""

  runtime_env="$(resolve_runtime_env)"
  compose_project="$(resolve_compose_project)"
  old_version="$(read_state current-version)"
  old_image="$(current_container_image)"

  echo "[2/4] 执行备份、迁移、启动及线上冒烟检查..."
  SFP_DEPLOY_ROOT="$SCRIPT_DIR" \
  SFP_RUNTIME_ENV_FILE="$runtime_env" \
  SFP_COMPOSE_PROJECT="$compose_project" \
    "$release_dir/deploy.sh" deploy

  ensure_camera_network "$runtime_env"

  echo '[3/4] 原子更新当前/上一版本状态...'
  if [[ -n "$old_version" && "$old_version" != "$version" ]]; then
    write_state previous-version "$old_version"
  fi
  if [[ -n "$old_image" && "$old_image" != "$(tr -d '\r\n' < "$release_dir/IMAGE_NAME")" ]]; then
    write_state previous-image "$old_image"
  fi
  write_state current-version "$version"
  write_state current-image "$(tr -d '\r\n' < "$release_dir/IMAGE_NAME")"
  write_state last-deployed-at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

  echo '[4/4] 发布完成。'
  show_status
}

rollback_release() {
  local current_version current_image target_version target_image target_dir
  local runtime_env compose_project
  current_version="$(read_state current-version)"
  current_image="$(read_state current-image)"
  target_version="$ARGUMENT"
  [[ -n "$target_version" ]] || target_version="$(read_state previous-version)"

  if [[ -n "$target_version" ]]; then
    [[ "$target_version" =~ ^[0-9]{8}-[0-9]{3}$ ]] || fail "回滚版本号不合法: $target_version"
    target_dir="$RELEASES_DIR/$target_version"
    [[ -x "$target_dir/deploy.sh" ]] || fail "找不到可回滚版本目录: $target_dir"
    target_image="$(tr -d '\r\n' < "$target_dir/IMAGE_NAME")"
  else
    target_image="$(read_state previous-image)"
    [[ -n "$target_image" ]] || fail '没有记录可回滚的上一版本或镜像。'
    target_dir="$RELEASES_DIR/$current_version"
    [[ -x "$target_dir/deploy.sh" ]] || fail '当前版本目录不可用，无法用兼容 Compose 回滚旧镜像。'
  fi
  [[ "$target_image" != "$current_image" ]] || fail '目标镜像已经是当前镜像。'

  runtime_env="$(resolve_runtime_env)"
  compose_project="$(resolve_compose_project)"
  echo "[ROLLBACK] 切换应用到 $target_image；不会逆向执行数据库迁移。"
  SFP_DEPLOY_ROOT="$SCRIPT_DIR" \
  SFP_RUNTIME_ENV_FILE="$runtime_env" \
  SFP_COMPOSE_PROJECT="$compose_project" \
  SFP_TARGET_IMAGE="$target_image" \
    "$target_dir/deploy.sh" rollback

  ensure_camera_network "$runtime_env"

  write_state previous-version "$current_version"
  write_state previous-image "$current_image"
  write_state current-version "$target_version"
  write_state current-image "$target_image"
  write_state last-deployed-at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  echo '[ROLLBACK] 应用回滚完成；数据库结构保持当前版本。'
  show_status
}

case "$COMMAND" in
  deploy) deploy_release ;;
  rollback) rollback_release ;;
  status) show_status ;;
  *) fail '用法: ./auto_deploy.sh deploy [ZIP] | rollback [VERSION] | status' ;;
esac
