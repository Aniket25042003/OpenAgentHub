import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { SECRETS_DIR, MASTER_KEY_PATH } from "./config.js";

export function machineId(): string {
  if (process.env.AGENT_MACHINE_ID) return process.env.AGENT_MACHINE_ID;
  try {
    const id = readFileSync("/etc/machine-id", "utf8").trim();
    if (id) return id;
  } catch {
    /* fall through */
  }
  try {
    const mac = readFileSync("/var/lib/dbus/machine-id", "utf8").trim();
    if (mac) return mac;
  } catch {
    /* fall through */
  }
  return "default-machine";
}

const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(passphrase: string): Buffer {
  const salt = createHash("sha256").update(`openagenthub:v1:${machineId()}`).digest();
  return scryptSync(passphrase, salt, KEY_LEN);
}

interface EncryptedBlob {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob: EncryptedBlob = {
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: enc.toString("base64"),
  };
  return JSON.stringify(blob);
}

function decrypt(payload: string, key: Buffer): string {
  const blob = JSON.parse(payload) as EncryptedBlob;
  if (blob.v !== 1) throw new Error("unsupported secrets format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(blob.data, "base64")), decipher.final()]);
  return dec.toString("utf8");
}

export class SecretsVault {
  private constructor(
    private readonly key: Buffer,
    private readonly dir: string,
  ) {}

  private pathFor(agentKey: string): string {
    return join(this.dir, `${createHash("sha256").update(agentKey).digest("hex").slice(0, 32)}.json`);
  }

  static open(opts: { dir?: string; passphrase?: string } = {}): SecretsVault {
    const dir = opts.dir ?? SECRETS_DIR;
    mkdirSync(dir, { recursive: true });
    let key: Buffer;
    if (opts.passphrase) {
      key = deriveKey(opts.passphrase);
    } else if (existsSync(MASTER_KEY_PATH)) {
      key = Buffer.from(readFileSync(MASTER_KEY_PATH, "utf8"), "hex");
    } else {
      key = randomBytes(KEY_LEN);
      writeFileSync(MASTER_KEY_PATH, key.toString("hex"), { mode: 0o600 });
    }
    if (key.length !== KEY_LEN) throw new Error("invalid vault key length");
    return new SecretsVault(key, dir);
  }

  has(agentKey: string): boolean {
    return existsSync(this.pathFor(agentKey));
  }

  get(agentKey: string): Record<string, string> {
    const p = this.pathFor(agentKey);
    if (!existsSync(p)) return {};
    try {
      return JSON.parse(decrypt(readFileSync(p, "utf8"), this.key)) as Record<string, string>;
    } catch {
      return {};
    }
  }

  set(agentKey: string, values: Record<string, string>): void {
    mkdirSync(this.dir, { recursive: true });
    const current = this.get(agentKey);
    const merged = { ...current, ...values };
    for (const [k, v] of Object.entries(merged)) {
      if (v === "" || v === undefined) delete merged[k];
    }
    writeFileSync(this.pathFor(agentKey), encrypt(JSON.stringify(merged), this.key), { mode: 0o600 });
  }

  delete(agentKey: string): void {
    rmSync(this.pathFor(agentKey), { force: true });
  }

  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => f.endsWith(".json"));
  }
}
