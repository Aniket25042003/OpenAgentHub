import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import {
  generateKeyPair,
  packAgent,
  unpackAgent,
  verifySignatureFileStrict,
  readSignatureFile,
  ArchiveError,
  SignatureError,
} from "../dist/index.js";

const VALID_MANIFEST = `
manifestVersion: 1
name: acme/hello
version: 1.0.0
author: alice
description: Hello agent
license: MIT
runtime:
  language: python
models:
  supported: [local]
interfaces:
  cli:
    command: python hello.py
`;

function makeProject(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agent.yaml"), VALID_MANIFEST);
  writeFileSync(join(dir, "hello.py"), "print('hello')\n");
  mkdirSync(join(dir, "data"));
  writeFileSync(join(dir, "data", "file.txt"), "nested\n");
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "node_modules", "junk.js"), "should be excluded\n");
  writeFileSync(join(dir, "hello.py"), "print('hello')\n");
}

describe("package pack/unpack", () => {
  let dirs: string[] = [];

  function tmp() {
    const d = mkdtempSync(join(tmpdir(), "oah-"));
    dirs.push(d);
    return d;
  }

  beforeEach(() => { dirs = []; });
  afterEach(() => { for (const d of dirs) void d; });

  it("round-trips a project through pack and unpack", async () => {
    const kp = generateKeyPair();
    const proj = tmp();
    makeProject(proj);
    const out = tmp();
    const pkg = packAgent(proj, { privateKeyPem: kp.privateKey, outDir: out });

    assert.ok(existsSync(pkg.archivePath));
    assert.ok(existsSync(pkg.signaturePath));
    assert.equal(pkg.manifest.name, "acme/hello");

    const dest = tmp();
    const res = await unpackAgent(pkg.archivePath, { destDir: dest });
    assert.equal(res.manifest.name, "acme/hello");
    assert.ok(existsSync(join(dest, "hello.py")));
    assert.ok(existsSync(join(dest, "data", "file.txt")));
    assert.ok(!existsSync(join(dest, "node_modules")), "node_modules must be excluded");

    const sig = await readSignatureFile(pkg.signaturePath);
    verifySignatureFileStrict(sig, pkg.archivePath);
  });

  it("rejects a tampered archive after packing", async () => {
    const kp = generateKeyPair();
    const proj = tmp();
    makeProject(proj);
    const pkg = packAgent(proj, { privateKeyPem: kp.privateKey, outDir: tmp() });

    const tampered = join(tmp(), "tampered.ahb");
    const original = readFileSync(pkg.archivePath);
    original[10] ^= 0xff;
    writeFileSync(tampered, original);

    const sig = await readSignatureFile(pkg.signaturePath);
    assert.throws(() => verifySignatureFileStrict(sig, tampered), SignatureError);
  });

  it("rejects signature with wrong public key", async () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const proj = tmp();
    makeProject(proj);
    const pkg = packAgent(proj, { privateKeyPem: kp1.privateKey, outDir: tmp() });
    const sig = await readSignatureFile(pkg.signaturePath);
    const forged = { ...sig, publicKey: kp2.publicKey, publicKeyId: "0000000000000000" };
    assert.throws(() => verifySignatureFileStrict(forged, pkg.archivePath), SignatureError);
  });

  it("rejects path traversal entries", async () => {
    const evil = join(tmp(), "evil.ahb");
    const outer = tmp();
    writeFileSync(join(outer, "..", "escape.txt"), "pwn\n");
    await tar.c({ gzip: true, file: evil, cwd: outer }, ["../escape.txt"]);
    await assert.rejects(() => unpackAgent(evil, { destDir: tmp() }), ArchiveError);
  });

  it("rejects absolute paths in archives", async () => {
    const evil = join(tmp(), "abs.ahb");
    const outer = tmp();
    writeFileSync(join(outer, "etc-passwd"), "pwn\n");
    await tar.c({ gzip: true, file: evil, cwd: outer, absolute: true }, ["etc-passwd"]);
    await assert.rejects(() => unpackAgent(evil, { destDir: tmp() }), ArchiveError);
  });

  it("rejects symlinks in archives", async () => {
    const evil = join(tmp(), "link.ahb");
    const outer = tmp();
    symlinkSync("/etc/passwd", join(outer, "agent.yaml"));
    writeFileSync(join(outer, "other.txt"), "hello\n");
    await tar.c({ gzip: true, file: evil, cwd: outer }, ["agent.yaml", "other.txt"]);
    await assert.rejects(() => unpackAgent(evil, { destDir: tmp() }), ArchiveError);
  });

  it("rejects archives without a manifest", async () => {
    const evil = join(tmp(), "nomanifest.ahb");
    const outer = tmp();
    writeFileSync(join(outer, "readme.txt"), "hi\n");
    await tar.c({ gzip: true, file: evil, cwd: outer }, ["readme.txt"]);
    await assert.rejects(() => unpackAgent(evil, { destDir: tmp() }), ArchiveError);
  });

  it("rejects oversized archives", async () => {
    const evil = join(tmp(), "big.ahb");
    const outer = tmp();
    const big = Buffer.alloc(2 * 1024 * 1024, 0x61);
    writeFileSync(join(outer, "agent.yaml"), VALID_MANIFEST);
    writeFileSync(join(outer, "big.bin"), big);
    await tar.c({ gzip: true, file: evil, cwd: outer }, ["agent.yaml", "big.bin"]);
    await assert.rejects(
      () => unpackAgent(evil, { destDir: tmp(), limits: { maxTotalBytes: 1024 * 1024 } }),
      ArchiveError,
    );
  });

  it("rejects a manifest that fails validation after unpack", async () => {
    const evil = join(tmp(), "invalid.ahb");
    const outer = tmp();
    writeFileSync(join(outer, "agent.yaml"), "manifestVersion: 1\nname: bad\n");
    await tar.c({ gzip: true, file: evil, cwd: outer }, ["agent.yaml"]);
    await assert.rejects(() => unpackAgent(evil, { destDir: tmp() }), /manifest invalid/);
  });

  it("excludes secret files when packing", async () => {
    const kp = generateKeyPair();
    const proj = tmp();
    makeProject(proj);
    writeFileSync(join(proj, ".env"), "TOKEN=secret\n");
    writeFileSync(join(proj, ".env.local"), "TOKEN=secret\n");
    writeFileSync(join(proj, "master.key"), "secret\n");
    writeFileSync(join(proj, "id_ed25519"), "secret\n");
    writeFileSync(join(proj, "deploy.pem"), "secret\n");
    writeFileSync(join(proj, "credentials.json"), "secret\n");
    mkdirSync(join(proj, ".openagenthub"));
    writeFileSync(join(proj, ".openagenthub", "master.key"), "secret\n");

    const pkg = packAgent(proj, { privateKeyPem: kp.privateKey, outDir: tmp() });
    const dest = tmp();
    const res = await unpackAgent(pkg.archivePath, { destDir: dest });
    for (const secret of [".env", ".env.local", "master.key", "id_ed25519", "deploy.pem", "credentials.json", ".openagenthub"]) {
      assert.ok(!existsSync(join(dest, secret)), `${secret} must not be packed`);
    }
    assert.ok(existsSync(join(dest, "hello.py")));
    assert.ok(!res.files.some((f) => f.endsWith("master.key") || f === ".env"));
  });
});
