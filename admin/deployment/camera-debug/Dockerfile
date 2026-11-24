ARG NODE_IMAGE=node:24-alpine
ARG FFMPEG_IMAGE
FROM ${NODE_IMAGE} AS node-runtime

USER root
RUN mkdir -p /opt/sfp-node/lib \
    && cp -L /usr/local/bin/node /opt/sfp-node/node \
    && cp -L /lib/ld-musl-x86_64.so.1 /usr/lib/libstdc++.so.6 /usr/lib/libgcc_s.so.1 /opt/sfp-node/lib/

# Reuse the deployed FFmpeg image's binaries without starting its media service.
FROM ${FFMPEG_IMAGE}
USER root
COPY --from=node-runtime /opt/sfp-node /opt/sfp-node
RUN printf '%s\n' '#!/bin/sh' 'exec /opt/sfp-node/lib/ld-musl-x86_64.so.1 --library-path /opt/sfp-node/lib /opt/sfp-node/node "$@"' > /usr/local/bin/node \
    && chmod 755 /usr/local/bin/node
WORKDIR /app
COPY source.mjs ./
USER 10001:10001

HEALTHCHECK NONE
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["/app/source.mjs"]
