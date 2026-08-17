import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

test("DEVSPACE_AUTH=off serves /mcp without a bearer token", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "devspace-auth-off-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "config.json"),
    JSON.stringify({ host: "127.0.0.1", allowedRoots: [root], auth: "off" }),
  );

  const config = loadConfig({
    DEVSPACE_CONFIG_DIR: root,
    DEVSPACE_ALLOWED_ROOTS: root,
    DEVSPACE_STATE_DIR: join(root, "state"),
    DEVSPACE_AUTH: "off",
  });
  assert.equal(config.authMode, "off");

  const { app, close } = createServer(config);
  const httpServer = app.listen(0, "127.0.0.1");
  t.after(async () => {
    httpServer.close();
    await close();
  });
  await once(httpServer, "listening");
  const port = (httpServer.address() as AddressInfo).port;

  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "okapi-test", version: "0" },
      },
    }),
  });
  assert.notEqual(response.status, 401);
  assert.ok(response.ok, `initialize status ${response.status}: ${await response.text()}`);
});
