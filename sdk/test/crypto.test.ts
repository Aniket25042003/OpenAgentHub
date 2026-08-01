import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPair,
  signPayload,
  verifyPayload,
  publicKeyFingerprint,
  sha256Hex,
} from "../dist/index.js";

describe("crypto", () => {
  it("signs and verifies with ed25519", () => {
    const kp = generateKeyPair();
    const payload = "openagenthub-signature-v1:github/pr-reviewer@1.0.3:abc123";
    const sig = signPayload(payload, kp.privateKey);
    assert.ok(sig.length > 0);
    assert.equal(verifyPayload(payload, sig, kp.publicKey), true);
  });

  it("rejects a tampered payload", () => {
    const kp = generateKeyPair();
    const payload = "payload";
    const sig = signPayload(payload, kp.privateKey);
    assert.equal(verifyPayload(payload + "x", sig, kp.publicKey), false);
  });

  it("rejects a signature from a different key", () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const sig = signPayload("data", kp1.privateKey);
    assert.equal(verifyPayload("data", sig, kp2.publicKey), false);
  });

  it("rejects malformed public key / signature", () => {
    assert.equal(verifyPayload("data", "not-base64!!!", "garbage"), false);
  });

  it("produces stable fingerprints", () => {
    const kp = generateKeyPair();
    assert.equal(publicKeyFingerprint(kp.publicKey), publicKeyFingerprint(kp.publicKey));
    assert.match(publicKeyFingerprint(kp.publicKey), /^[0-9a-f]{16}$/);
  });

  it("sha256 matches node crypto", () => {
    assert.equal(sha256Hex("hello"), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});
