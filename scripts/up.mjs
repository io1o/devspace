import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tunnelUrlRe = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const tunnelTimeoutMs = 90_000;
const watch = process.argv.includes("--dev");
const port = process.env.PORT?.trim() || "7676";
const localOrigin = `http://127.0.0.1:${port}`;

const children = [];
let shuttingDown = false;

function log(message) {
  console.error(`[devspace:up] ${message}`);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill("SIGKILL");
    }
    process.exit(code);
  }, 3000).unref();
}

function spawnTracked(command, args, options) {
  const child = spawn(command, args, options);
  children.push(child);
  child.on("exit", (exitCode, signal) => {
    if (shuttingDown) {
      if (children.every((item) => item.exitCode !== null || item.signalCode)) {
        process.exit(exitCode ?? (signal ? 1 : 0));
      }
      return;
    }
    log(`${command} exited (${signal ?? exitCode ?? "unknown"})`);
    shutdown(exitCode || 1);
  });
  return child;
}

function waitForTunnelUrl(child) {
  return new Promise((resolveUrl, reject) => {
    let settled = false;
    let buffer = "";

    const timer = setTimeout(() => {
      finish(new Error(`timed out waiting for trycloudflare.com URL after ${tunnelTimeoutMs / 1000}s`));
    }, tunnelTimeoutMs);

    function finish(error, url) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolveUrl(url);
    }

    function consume(chunk) {
      process.stderr.write(chunk);
      buffer += chunk.toString();
      if (buffer.length > 32_768) buffer = buffer.slice(-16_384);
      const match = buffer.match(tunnelUrlRe);
      if (match) finish(undefined, match[0].replace(/\/+$/, ""));
    }

    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("error", (error) => finish(error));
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

const tunnel = spawnTracked(
  "cloudflared",
  ["tunnel", "--url", localOrigin, "--no-autoupdate"],
  {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

tunnel.once("error", (error) => {
  if (error.code === "ENOENT") {
    log("cloudflared not found in PATH. Install it first.");
  } else {
    log(error.message);
  }
  shutdown(1);
});

let publicBaseUrl;
try {
  publicBaseUrl = await waitForTunnelUrl(tunnel);
} catch (error) {
  log(error.message);
  shutdown(1);
  process.exit(1);
}

log(`tunnel: ${publicBaseUrl}`);
log(`mcp:    ${publicBaseUrl}/mcp`);

const serveEnv = {
  ...process.env,
  PORT: port,
  DEVSPACE_PUBLIC_BASE_URL: publicBaseUrl,
  DEVSPACE_TRUST_PROXY: process.env.DEVSPACE_TRUST_PROXY ?? "1",
  DEVSPACE_OAUTH_ALLOWED_REDIRECT_HOSTS:
    process.env.DEVSPACE_OAUTH_ALLOWED_REDIRECT_HOSTS ??
    "chatgpt.com,localhost,127.0.0.1,www.cursor.com,cursor.com,anysphere.cursor-mcp,mcp",
};

if (watch) {
  spawnTracked(process.execPath, ["scripts/dev-server.mjs"], {
    cwd: repoRoot,
    env: serveEnv,
    stdio: "inherit",
  });
} else {
  spawnTracked("npx", ["tsx", "src/cli.ts", "serve"], {
    cwd: repoRoot,
    env: serveEnv,
    stdio: "inherit",
  });
}
