import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { RegistryClient } from "../dist/registry.js";

function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise((r) => server.close(() => r())) });
      }
    });
  });
}

describe("RegistryClient.catalog", () => {
  afterEach(() => {});

  it("requests catalog with filters and returns items with nextCursor", async () => {
    let seenUrl = "";
    const server = await startServer((req, res) => {
      seenUrl = req.url ?? "";
      res.setHeader("content-type", "application/json");
      res.setHeader("etag", `"abc"`);
      res.setHeader("cache-control", "public, max-age=30");
      res.end(
        JSON.stringify({
          schemaVersion: 1,
          watermark: "2026-01-01T00:00:00Z",
          items: [
            {
              namespace: "acme",
              name: "hello",
              version: "1.0.0",
              digest: "deadbeef",
              author: "tester",
              description: "a test agent",
              license: "MIT",
              runtime: "python",
              interfaces: ["cli:python app.py"],
              permissions: ["network", "filesystem"],
              secrets: [],
              downloads: 0,
              publisher: "tester",
              signerVerified: true,
              reviewStatus: "pending",
              securityStatus: "clean",
              yanked: false,
              publishedAt: "2026-01-01T00:00:00Z",
            },
          ],
          nextCursor: "abc123",
        }),
      );
    });
    try {
      const client = new RegistryClient(server.url);
      const page = await client.catalog({ limit: 20, permission: "network" });
      assert.ok(seenUrl.includes("/api/v1/catalog"), `url=${seenUrl}`);
      assert.ok(seenUrl.includes("limit=20"), `url=${seenUrl}`);
      assert.ok(seenUrl.includes("permission=network"), `url=${seenUrl}`);
      assert.equal(page.schemaVersion, 1);
      assert.equal(page.watermark, "2026-01-01T00:00:00Z");
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].name, "hello");
      assert.equal(page.items[0].signerVerified, true);
      assert.equal(page.nextCursor, "abc123");
    } finally {
      await server.close();
    }
  });
});