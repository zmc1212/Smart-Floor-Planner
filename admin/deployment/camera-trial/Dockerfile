ARG ADMIN_RUNTIME_IMAGE=zmc1212/sfp-admin:20260905-001
FROM ${ADMIN_RUNTIME_IMAGE}
WORKDIR /app
COPY --chown=nextjs:nodejs gateway.cjs /app/camera-trial/gateway.cjs
COPY --chown=nextjs:nodejs public/construction-camera /app/public/construction-camera
USER nextjs
ENTRYPOINT []
CMD ["node", "/app/camera-trial/gateway.cjs"]
