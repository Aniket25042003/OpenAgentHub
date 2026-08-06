import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { RegistryClient, DeviceAuthPendingError } from "../dist/registry.js";

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

  it("starts a device login and returns the user code", async () => {
    let body = "";
    const server = await startServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        body = raw;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            deviceCode: "dev-123",
            userCode: "ABCDEF",
            verificationUri: "http://localhost:8000/device?user_code=ABCDEF",
            expiresIn: 1800,
            interval: 5,
          }),
        );
      });
    });
    try {
      const client = new RegistryClient(server.url);
      const start = await client.startDeviceLogin("cli");
      assert.equal(start.deviceCode, "dev-123");
      assert.equal(start.userCode, "ABCDEF");
      assert.equal(start.verificationUri.includes("ABCDEF"), true);
      assert.ok(body.includes('"clientName"'), body);
      assert.ok(body.includes("cli"), body);
    } finally {
      await server.close();
    }
  });

  it("polls a pending device token and surfaces DeviceAuthPendingError", async () => {
    const server = await startServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.statusCode = 400;
      res.end(JSON.stringify({ detail: "authorization_pending" }));
    });
    try {
      const client = new RegistryClient(server.url);
      await assert.rejects(() => client.pollDeviceToken("dev-123"), (err: unknown) => {
        assert.ok(err instanceof DeviceAuthPendingError, `expected pending error, got ${err}`);
        return true;
      });
    } finally {
      await server.close();
    }
  });

  it("resolves a completed device login to a credential", async () => {
    const server = await startServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.statusCode = 200;
      res.end(JSON.stringify({ accessToken: "sess-token", username: "octocat", tokenType: "bearer" }));
    });
    try {
      const result = await new RegistryClient(server.url).pollDeviceToken("dev-123");
      assert.equal(result.accessToken, "sess-token");
      assert.equal(result.username, "octocat");
    } finally {
      await server.close();
    }
  });

  it("lists and revokes sessions", async () => {
    const calls: string[] = [];
    const server = await startServer((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      res.setHeader("content-type", "application/json");
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          sessions: [{ id: 7, audience: "cli", deviceLabel: "mac", createdAt: "x", lastUsedAt: "x", expiresAt: "x", revoked: false }],
        }),
      );
    });
    try {
      const client = new RegistryClient(server.url, "tok");
      const sessions = await client.mySessions();
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].id, 7);
      await client.revokeSession(7);
      await client.logoutMe();
      assert.ok(calls.some((c) => c.startsWith("DELETE /api/v1/sessions/7")), calls.join("\n"));
      assert.ok(calls.some((c) => c.startsWith("DELETE /api/v1/sessions/me")), calls.join("\n"));
    } finally {
      await server.close();
    }
  });

  it("reads publisher console overview and namespaces", async () => {
    let seenUrl = "";
    const server = await startServer((req, res) => {
      seenUrl = req.url ?? "";
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          req.url?.startsWith("/api/v1/me/overview")
            ? {
                namespaceCount: 2,
                packageCount: 3,
                keyCount: 1,
                activeSessions: 1,
                publishesUsed: 1,
                publishesLimit: 10,
                publishesUnlimited: false,
                pendingScans: 0,
                flaggedVersions: 0,
              }
            : [{ name: "acme", role: "owner", memberCount: 1, packageCount: 3, createdAt: "2026-01-01T00:00:00Z" }],
        ),
      );
    });
    try {
      const client = new RegistryClient(server.url, "tok");
      const overview = await client.publisherOverview();
      assert.equal(overview.namespaceCount, 2);
      const namespaces = await client.publisherNamespaces();
      assert.equal(namespaces.length, 1);
      assert.equal(namespaces[0].role, "owner");
    } finally {
      await server.close();
    }
  });

  it("reads version identity and submits reviews", async () => {
    const calls: string[] = [];
    const server = await startServer((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      res.setHeader("content-type", "application/json");
      if (req.method === "POST") {
        res.end(JSON.stringify({ status: "verified" }));
        return;
      }
      res.end(
        JSON.stringify({
          identity: {
            namespace: "acme",
            name: "hello",
            version: "1.0.0",
            digest: "d",
            publishedBy: "tester",
            downloadCount: 0,
            reviewStatus: "pending",
            securityStatus: "clean",
            securityFindings: [],
            yanked: false,
            blocked: false,
            trust: "unknown",
          },
          manifest: { name: "acme/hello" },
          securityDiff: { fields: [], addedPermissions: [], removedPermissions: [], addedSecrets: [], removedSecrets: [] },
          reviewHistory: [],
        }),
      );
    });
    try {
      const client = new RegistryClient(server.url, "tok");
      const detail = await client.versionIdentity("acme", "hello", "1.0.0");
      assert.equal(detail.identity.digest, "d");
      const result = await client.reviewVersion("acme", "hello", "1.0.0", "verify", "approved");
      assert.equal(result.status, "verified");
      assert.ok(calls.some((c) => c.startsWith("POST /api/v1/admin/agents/acme/hello/versions/1.0.0/review")));
    } finally {
      await server.close();
    }
  });

  it("reads the admin review queue", async () => {
    let seenUrl = "";
    const server = await startServer((req, res) => {
      seenUrl = req.url ?? "";
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          items: [
            {
              id: 1,
              namespace: "acme",
              name: "hello",
              version: "1.0.0",
              digest: "abc",
              publishedAt: "2026-01-01T00:00:00Z",
              publisher: "tester",
              reviewStatus: "pending",
              securityStatus: "clean",
              riskScore: 80,
              permissions: ["network"],
              secrets: [],
              downloads: 0,
            },
          ],
        }),
      );
    });
    try {
      const client = new RegistryClient(server.url, "tok");
      const queue = await client.reviewQueue();
      assert.equal(queue.length, 1);
      assert.equal(queue[0].riskScore, 80);
      assert.ok(seenUrl.includes("/api/v1/admin/review-queue"));
    } finally {
      await server.close();
    }
  });

  it("reads and accepts agreements", async () => {
    const server = await startServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.statusCode = 200;
      const body =
        req.method === "POST"
          ? { tos: "accepted", privacy: "accepted", publisher: "accepted" }
          : { tos: "pending", privacy: "pending", publisher: "pending" };
      res.end(JSON.stringify(body));
    });
    try {
      const client = new RegistryClient(server.url, "tok");
      const before = await client.myAgreements();
      assert.equal(before.tos, "pending");
      const after = await client.acceptAgreements(true, true, true);
      assert.equal(after.publisher, "accepted");
    } finally {
      await server.close();
    }
  });
});