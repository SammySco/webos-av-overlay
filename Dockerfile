FROM node:20-alpine

# util-linux provides /usr/bin/script (needed to give luna-send a PTY via SSH)
# openssh-client provides ssh and ssh-keyscan
RUN apk add --no-cache openssh-client util-linux

WORKDIR /app

# Only the runtime is needed — watcher.js uses only built-in Node modules
COPY runtime/ ./runtime/
COPY scripts/docker/ ./scripts/docker/
RUN chmod +x /app/scripts/docker/luna-send-tv.sh /app/scripts/docker/entrypoint.sh

VOLUME ["/data"]

# 41101 TCP: HTTP status/control API
# 41100 UDP: Yamaha MusicCast event subscription (amp → watcher)
EXPOSE 41101/tcp
EXPOSE 41100/udp

ENV EARC_SETTINGS=/data/earc-overlay.json \
    EARC_PLEX_CONFIG=/data/earc-plex.json \
    EARC_LUNA_SEND=/app/scripts/docker/luna-send-tv.sh

ENTRYPOINT ["/app/scripts/docker/entrypoint.sh"]
CMD ["node", "/app/runtime/watcher.js"]
