# Self-hosting on a Raspberry Pi

Tackle is built to run on small hardware: one Node.js process, one SQLite file, no native modules. A Raspberry Pi comfortably serves a small team.

## Will it be fast enough?

Numbers from a load test with a 2,000-task workspace, 15 open browser tabs receiving live updates, and 3 users editing far more often than real people do. Measured on an x86 development machine; the Pi 4 column is an estimate (a Pi 4 core is roughly 4–5× slower, a Pi 5 core about 2–3×).

| | Measured (x86) | Expected on Pi 4 |
| --- | --- | --- |
| Memory | 57 MB idle, ~100 MB under load | about the same |
| Saving an edit and pushing it to 15 tabs | 2.8 ms CPU, p95 latency 6.7 ms | ~15 ms |
| Initial load of 2,000 tasks | 30 ms, 80 KB gzipped | ~150 ms |
| Sign-in (scrypt hashing) | ~0.1 s | ~0.5 s |
| 3 users × 10 edits/s for 20 s | 8% of one core, 0 errors | ~40% of one core |

A real team of three generates well under one write per second, which is below 1% CPU on a Pi 4.

## Hardware

- **Recommended:** Raspberry Pi 4 or 5 running a 64-bit OS. 1 GB of RAM is enough.
- **Also works:** Pi 3B+ and Pi Zero 2 W. Build on another computer: building on a 512 MB board is painfully slow.
- **Not supported:** Pi 1 and the original Pi Zero (ARMv6). Node.js 22 has no official ARMv6 builds.
- **32-bit OS:** 32-bit Raspberry Pi OS (armv7l) works with Node.js 22. Node.js 24 dropped 32-bit ARM builds, so stay on 22 there.
- **Storage:** use a good A1/A2 SD card or, better, a USB SSD.
  - SQLite runs in WAL mode, so writes are small and batched.
  - After a power cut you may lose the last moments of work, but the database stays consistent.

## Option A: Node.js and systemd (recommended)

### 1. Install Node.js 22 on the Pi

`uname -m` prints `aarch64` on a 64-bit OS and `armv7l` on a 32-bit one. Pick the latest 22.x version from <https://nodejs.org/dist/latest-v22.x/>:

```bash
VER=v22.23.3          # latest 22.x
ARCH=arm64            # or armv7l on a 32-bit OS
curl -fsSLO https://nodejs.org/dist/$VER/node-$VER-linux-$ARCH.tar.xz
sudo tar -xJf node-$VER-linux-$ARCH.tar.xz -C /usr/local --strip-components=1
node -v               # must be 22.13 or newer
```

### 2. Build on your computer and copy the result

The build output is platform-independent: `dist/` contains the server (a single file with no dependencies) and the static client. The Pi doesn't need `npm install`.

```bash
npm ci && npm run build
ssh pi@raspberrypi.local 'sudo mkdir -p /opt/tackle && sudo chown $USER /opt/tackle'
rsync -a --delete dist/ pi@raspberrypi.local:/opt/tackle/dist/
scp deploy/tackle.service pi@raspberrypi.local:/tmp/
```

### 3. Run it as a service

```bash
sudo useradd --system --home /var/lib/tackle --shell /usr/sbin/nologin tackle
sudo cp /tmp/tackle.service /etc/systemd/system/tackle.service
sudo systemctl daemon-reload
sudo systemctl enable --now tackle
journalctl -u tackle -f     # "Tackle is running at http://localhost:3000"
```

Open `http://raspberrypi.local:3000`. The setup wizard creates the workspace and your admin account. Then invite teammates from *Settings → Members*.

### 4. Update to a new version

```bash
# on your computer
npm run build && rsync -a --delete dist/ pi@raspberrypi.local:/opt/tackle/dist/
# on the Pi
sudo -u tackle DATA_DIR=/var/lib/tackle node /opt/tackle/dist/server.mjs backup
sudo systemctl restart tackle
```

Database migrations run automatically on start.

## Option B: Docker

Official Node images exist for arm64, armv7 and armv6, so the included `Dockerfile` builds on the Pi as is:

```bash
docker compose up -d --build     # first build takes a few minutes on a Pi 4
```

## Access from outside your home network

Pick one option:

- **Tailscale (simplest for a private team).**
  - Install Tailscale on the Pi and on teammates' devices.
  - Run `sudo tailscale serve --bg 3000`.
  - Everyone opens `https://raspberrypi.<your-tailnet>.ts.net`, with a real certificate.
  - No port forwarding is needed, and the tracker is not exposed to the internet.
- **Your own domain with Caddy.**
  - Forward ports 80 and 443 to the Pi.
  - Use a two-line `Caddyfile`; Caddy obtains the HTTPS certificate automatically:

    ```
    tackle.example.com {
        reverse_proxy 127.0.0.1:3000
    }
    ```

  - Set `TRUST_PROXY=true` in the service so sign-in rate limiting sees real client IPs.
- **Cloudflare Tunnel.** Exposes the Pi without opening ports. Also set `TRUST_PROXY=true`.

If you prefer nginx, disable buffering so live updates aren't delayed:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;        # Server-Sent Events
    proxy_read_timeout 1h;
    client_max_body_size 25m;   # attachments, match MAX_UPLOAD_MB
}
```

### Why HTTPS matters even on a home network

- **Copy buttons.** Browsers only allow the copy-link / copy-branch buttons on HTTPS (or `localhost`). On plain HTTP Tackle shows the text in a toast instead, for you to copy manually.
- **Tab limit.** Over plain HTTP/1.1 a browser keeps at most about 6 connections per site, and every open Tackle tab holds one for live updates. More than ~5 Tackle tabs in one browser will stall. HTTPS through Caddy, Tailscale or Cloudflare uses HTTP/2, which has no such limit.

When you serve over HTTPS through a proxy, Tackle marks the session cookie `Secure` automatically.

## Backups

The whole workspace is one SQLite file (`/var/lib/tackle/tackle.db`). The built-in command writes a consistent, compact copy even while the server is running:

```bash
sudo -u tackle DATA_DIR=/var/lib/tackle node /opt/tackle/dist/server.mjs backup              # → /var/lib/tackle/backups/tackle-YYYYMMDD-HHMM.db
sudo -u tackle DATA_DIR=/var/lib/tackle node /opt/tackle/dist/server.mjs backup /mnt/usb/t.db # custom path
```

To make a nightly backup and keep the last two weeks, create `/etc/cron.d/tackle-backup`:

```
15 3 * * * tackle DATA_DIR=/var/lib/tackle /usr/local/bin/node /opt/tackle/dist/server.mjs backup && find /var/lib/tackle/backups -name 'tackle-*.db' -mtime +14 -delete
```

Files attached to tasks are not in the database: they live in `/var/lib/tackle/attachments`, one file per attachment. A file never changes after it is uploaded, so keeping a copy up to date is a matter of `rsync -a /var/lib/tackle/attachments/ /mnt/usb/tackle-attachments/` (add it to the cron line above).

Copy backups off the Pi as well (another machine, a USB drive, or cloud storage), since SD cards do fail. To restore:

1. `sudo systemctl stop tackle`
2. Copy the backup over `tackle.db`, and the attachments copy back into `attachments/`.
3. Delete `tackle.db-wal` and `tackle.db-shm` if present.
4. `sudo systemctl start tackle`

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `No such built-in module: node:sqlite` on start | Node.js is older than 22.13: check `node -v`. |
| Changes from teammates arrive late or in bursts | A proxy buffers responses: use `proxy_buffering off` (nginx) or Caddy. |
| Sign-in rate limiting treats everyone as one client behind a proxy | Set `TRUST_PROXY=true` so it uses the real client IP from `X-Forwarded-For`. |
| Times look wrong | The Pi has no hardware clock. Make sure time sync is on: `timedatectl`. |
