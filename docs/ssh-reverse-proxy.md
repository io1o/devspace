# SSH Reverse Proxy

DevSpace does not create or own the public tunnel. This page records how this
checkout reaches the internet through an SSH reverse tunnel and Caddy on a
server you already have, without Cloudflare.

The local process listens on `127.0.0.1:7676`. The server cannot dial that
address. The laptop opens `ssh -R` so the server can proxy to it.

```text
Internet HTTPS
  -> Caddy on the server
  -> 127.0.0.1:17676 on the server
  -> SSH reverse tunnel
  -> 127.0.0.1:7676 on this machine
```

## This checkout

| Item | Value |
| --- | --- |
| Server | `root@ea2dcabb.acrd.cc` |
| Public origin | `https://devspace.212.50.232.66.sslip.io` |
| MCP URL | `https://devspace.212.50.232.66.sslip.io/mcp` |
| Server bind | `127.0.0.1:17676` |
| Local bind | `127.0.0.1:7676` |
| Caddyfile | `/etc/caddy/Caddyfile` on the server |

The `*.sslip.io` name is DNS for the server IP. Caddy issues the certificate.
`publicBaseUrl` must be the origin only, with no `/mcp`.

The SSH tunnel and `devspace serve` both run on this machine. They do not
survive reboot, SSH drop, or a closed terminal. Bring them back in this order:

```bash
ssh -fNT -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -R 127.0.0.1:17676:127.0.0.1:7676 root@ea2dcabb.acrd.cc

cd ~/workspace/devspace
DEVSPACE_PUBLIC_BASE_URL=https://devspace.212.50.232.66.sslip.io \
DEVSPACE_TRUST_PROXY=1 \
npx tsx src/cli.ts serve
```

`ssh -f` backgrounds the tunnel. `serve` must stay in the foreground. If that
command returns to the shell, the process is not listening. Check whether
`127.0.0.1:7676` is already taken:

```bash
ss -ltnp | grep 7676
```

Do not run `npm run up` or `npm run up:dev` for this setup. Those scripts start
`cloudflared`.

Owner password stays in `~/.devspace/auth.json`.

## Caddy on the server

The site block proxies to the SSH forward, not to the laptop IP. Streaming MCP
needs an unbounded or long read timeout:

```caddy
devspace.212.50.232.66.sslip.io {
	reverse_proxy 127.0.0.1:17676 {
		flush_interval -1
		transport http {
			read_timeout 24h
			write_timeout 24h
			dial_timeout 10s
			keepalive 30s
			keepalive_idle_conns 10
		}
		header_up Host {host}
		header_up X-Real-IP {remote_host}
		header_up X-Forwarded-Proto https
	}
}
```

Reload after editing:

```bash
ssh root@ea2dcabb.acrd.cc 'caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy'
```

## Checks

Tunnel listening on the server:

```bash
ssh root@ea2dcabb.acrd.cc 'ss -ltnp | grep 17676'
```

Public MCP endpoint. `401` with a Bearer challenge is healthy; connection
refused or `502` means the tunnel or `serve` is down:

```bash
curl -sI https://devspace.212.50.232.66.sslip.io/mcp
```

Local config:

```bash
npx tsx src/cli.ts doctor
```
