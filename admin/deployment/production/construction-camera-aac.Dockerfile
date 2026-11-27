ARG GATEWAY_IMAGE
ARG FFMPEG_IMAGE
FROM ${FFMPEG_IMAGE} AS encoder
USER root
RUN set -eu; \
    mkdir -p /sfp-ffmpeg/lib; \
    ldd /usr/bin/ffmpeg > /tmp/sfp-ffmpeg-dependencies; \
    if grep -q 'not found' /tmp/sfp-ffmpeg-dependencies; then exit 1; fi; \
    awk '{for (i=1; i<=NF; i++) if ($i ~ /^\//) print $i}' /tmp/sfp-ffmpeg-dependencies | sort -u | \
      while IFS= read -r file; do cp -L "$file" /sfp-ffmpeg/lib/; done; \
    cp /usr/bin/ffmpeg /sfp-ffmpeg/ffmpeg; \
    printf '%s\n' '#!/bin/sh' 'exec /opt/sfp-ffmpeg/lib/ld-linux-x86-64.so.2 --library-path /opt/sfp-ffmpeg/lib /opt/sfp-ffmpeg/ffmpeg "$@"' > /sfp-ffmpeg/run; \
    chmod 755 /sfp-ffmpeg/run

FROM ${GATEWAY_IMAGE}
COPY --from=encoder /sfp-ffmpeg /opt/sfp-ffmpeg
COPY --chown=nextjs:nodejs gateway.cjs /app/gateway.cjs
COPY --chown=nextjs:nodejs public/construction-camera /app/public/construction-camera
USER nextjs
ENV CAMERA_LIVE_AAC_FFMPEG=/opt/sfp-ffmpeg/run
CMD ["/app/gateway.cjs"]
