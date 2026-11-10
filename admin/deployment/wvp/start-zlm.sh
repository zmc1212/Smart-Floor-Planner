#!/bin/sh
set -eu
case "$ZLM_SECRET" in *[!a-f0-9]*|'') exit 1;; esac
for port in "$MEDIA_HTTP_PORT" "$RTP_MIN" "$RTP_MAX"; do
  case "$port" in *[!0-9]*|'') exit 1;; esac
done
umask 077
cat > /tmp/zlm.ini <<EOF
[general]
mediaServerId=wvp-zlm-01
[api]
secret=$ZLM_SECRET
apiDebug=0
downloadRoot=/opt/media/www/record
[http]
port=$MEDIA_HTTP_PORT
sslport=0
rootPath=/opt/media/www
[rtsp]
port=554
sslport=0
[rtmp]
port=1935
sslport=0
[rtc]
port=0
tcpPort=0
[rtp_proxy]
port=10000
port_range=$RTP_MIN-$RTP_MAX
[hook]
enable=1
admin_params=secret=$ZLM_SECRET
on_server_started=
on_server_keepalive=http://wvp:18080/index/hook/on_server_keepalive
on_stream_changed=http://wvp:18080/index/hook/on_stream_changed
on_stream_none_reader=http://wvp:18080/index/hook/on_stream_none_reader
on_stream_not_found=http://wvp:18080/index/hook/on_stream_not_found
on_play=http://wvp:18080/index/hook/on_play
on_publish=http://wvp:18080/index/hook/on_publish
on_record_mp4=http://wvp:18080/index/hook/on_record_mp4
[record]
appName=record
filePath=/opt/media/www
[protocol]
enable_hls=1
enable_rtmp=1
enable_rtsp=1
enable_mp4=0
mp4_save_path=/opt/media/www
EOF
# New shared media directories inherit the WVP group from the setgid media root.
umask 002
cd /opt/media/bin
exec ./MediaServer -c /tmp/zlm.ini -m 3 -l 2
