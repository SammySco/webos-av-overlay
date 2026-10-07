#!/bin/sh
set -e

# Set up SSH for the TV connection.
# The SSH private key is mounted read-only at /run/secrets/tv_ssh_key.
mkdir -p /root/.ssh
chmod 700 /root/.ssh

# ControlMaster: reuse one TCP connection for all SSH calls so the 2-second
# foreground-app polling (profiles.js) doesn't hammer the TV with new handshakes.
cat > /root/.ssh/config << 'SSHEOF'
Host *
    ControlMaster auto
    ControlPath /tmp/ssh-mux-%r@%h:%p
    ControlPersist 120s
    ServerAliveInterval 15
    ServerAliveCountMax 3
    ConnectTimeout 5
    BatchMode yes
    StrictHostKeyChecking accept-new
    IdentityFile /run/secrets/tv_ssh_key
SSHEOF
chmod 600 /root/.ssh/config

# Persist the TV's host key in the data volume so it survives container restarts.
if [ -n "${EARC_TV_HOST:-}" ]; then
    TV_IP=$(printf '%s\n' "${EARC_TV_HOST}" | sed 's/^[^@]*@//')

    # Restore a previously saved known_hosts from the data volume.
    if [ -f /data/tv_known_hosts ]; then
        cp /data/tv_known_hosts /root/.ssh/known_hosts
        chmod 600 /root/.ssh/known_hosts
    fi

    # Scan the TV's host key if not already known.
    if ! grep -q "^${TV_IP}[, ]" /root/.ssh/known_hosts 2>/dev/null; then
        printf 'Scanning SSH host key for %s...\n' "${TV_IP}"
        ssh-keyscan -T 10 "${TV_IP}" >> /root/.ssh/known_hosts 2>/dev/null || true
        chmod 600 /root/.ssh/known_hosts
        # Save to the volume so the next start skips the scan.
        cp /root/.ssh/known_hosts /data/tv_known_hosts 2>/dev/null || true
    fi
fi

exec "$@"
