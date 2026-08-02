import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  KNOWN_AGENTS,
  containerMatches,
  isOahContainer,
  parseContainerLine,
  parsePsLine,
  processMatches,
  type ContainerInfo,
} from "../dist/index.js";

const openclaw = KNOWN_AGENTS.find((a) => a.id === "openclaw")!;
const hermes = KNOWN_AGENTS.find((a) => a.id === "hermes")!;

function container(partial: Partial<ContainerInfo>): ContainerInfo {
  return {
    id: "abc123def456",
    name: "test",
    image: "test:latest",
    command: "",
    state: "running",
    status: "Up 5 minutes",
    ports: "",
    created: "",
    labels: "",
    mounts: "",
    ...partial,
  };
}

describe("system ps parser", () => {
  it("parses pid and command", () => {
    const p = parsePsLine("  751  /usr/bin/node openclaw.mjs gateway --port 18789");
    assert.deepEqual(p, { pid: 751, command: "/usr/bin/node openclaw.mjs gateway --port 18789" });
  });

  it("returns null for junk", () => {
    assert.equal(parsePsLine("no pid here"), null);
  });
});

describe("system container parser", () => {
  it("parses docker --format json line", () => {
    const line = JSON.stringify({
      ID: "a1b2c3d4",
      Names: "hermes-gateway",
      Image: "nousresearch/hermes-agent:latest",
      Command: "gateway",
      State: "running",
      Status: "Up 2 hours",
      Ports: "0.0.0.0:8642->8642/tcp",
      CreatedAt: "2026-07-01 00:00:00",
      Labels: "hermes-profile=default",
      Mounts: "source=hermes_data",
    });
    const c = parseContainerLine(line);
    assert.ok(c);
    assert.equal(c!.name, "hermes-gateway");
    assert.equal(c!.image, "nousresearch/hermes-agent:latest");
    assert.equal(c!.ports, "0.0.0.0:8642->8642/tcp");
  });

  it("returns null for malformed json", () => {
    assert.equal(parseContainerLine("not json"), null);
  });
});

describe("system agent matching", () => {
  it("matches openclaw by process name", () => {
    assert.ok(processMatches(openclaw, "node /tmp/openclaw/openclaw.mjs gateway"));
  });

  it("matches hermes by process name", () => {
    assert.ok(processMatches(hermes, "/usr/local/bin/hermes gateway run"));
    assert.ok(processMatches(hermes, "python -m hermes_agent"));
  });

  it("does not match unrelated processes", () => {
    assert.ok(!processMatches(openclaw, "node server.js"));
  });

  it("matches hermes container by name", () => {
    assert.ok(containerMatches(hermes, container({ name: "hermes-gateway", image: "whatever:1" })));
  });

  it("matches hermes container by image", () => {
    assert.ok(containerMatches(hermes, container({ name: "laughing_turing", image: "ghcr.io/nousresearch/hermes-agent:latest" })));
  });

  it("matches openclaw container", () => {
    assert.ok(containerMatches(openclaw, container({ name: "openclaw", image: "openclaw/openclaw:1" })));
  });

  it("does not match unrelated containers", () => {
    assert.ok(!containerMatches(hermes, container({ name: "postgres", image: "postgres:16" })));
  });

  it("flags openagenthub-managed containers by volume", () => {
    assert.ok(isOahContainer(container({ name: "mystery", mounts: "local,source=oah-deps-a1b2c3d4e5f6,destination=/deps" })));
    assert.ok(!isOahContainer(container({ name: "postgres", mounts: "local,source=pgdata" })));
  });
});
