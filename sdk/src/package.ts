import {
  createReadStream,
  createWriteStream,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import * as tar from "tar";
import type { ReadEntry } from "tar";
import { assertValidManifest, loadManifestFromDir, parseManifest, type Manifest } from "./manifest.js";
import { publicKeyFingerprint, sha256Hex, signPayload, verifyPayload } from "./crypto.js";
import { ArchiveError, SignatureError } from "./errors.js";

export const ARCHIVE_EXTENSION = ".ahb";

export const IGNORE_PATTERNS = [
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  "dist",
  "coverage",
  ".DS_Store",
  "*.ahb",
  "*.sig.json",
];

export interface SignatureFile {
  schemaVersion: 1;
  algorithm: "ed25519";
  publicKey: string;
  publicKeyId: string;
  sha256: string;
  name: string;
  version: string;
  signature: string;
}

export const SIGNATURE_FILENAME = "signature.sig.json";

export function signaturePayload(name: string, version: string, sha256: string): string {
  return `openagenthub-signature-v1:${name}@${version}:${sha256}`;
}

export interface PackOptions {
  privateKeyPem: string;
  outDir?: string;
}

export interface PackResult {
  manifest: Manifest;
  archivePath: string;
  signaturePath: string;
  sha256: string;
  signature: SignatureFile;
}

export function packAgent(projectDir: string, opts: PackOptions): PackResult {
  const { manifest, path: manifestPath } = loadManifestFromDir(projectDir);
  const outDir = opts.outDir ?? projectDir;
  mkdirSync(outDir, { recursive: true });

  const filename = `${manifest.name.replace("/", "_")}-${manifest.version}${ARCHIVE_EXTENSION}`;
  const archivePath = join(outDir, filename);
  const signaturePath = join(outDir, `${filename}${".sig.json"}`);

  const files = listProjectFiles(projectDir);
  const tarArgs = ["-czf", archivePath, "--exclude=.git", ...ignoreArgs(), ...files.map((f) => f.replace(/^\.\//, ""))];

  const res = spawnSync("tar", tarArgs, { cwd: projectDir, stdio: "inherit", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new ArchiveError("failed to create archive");

  const sha256 = sha256Hex(readFileSync(archivePath));
  const payload = signaturePayload(manifest.name, manifest.version, sha256);
  const signature = signPayload(payload, opts.privateKeyPem);

  const sig: SignatureFile = {
    schemaVersion: 1,
    algorithm: "ed25519",
    publicKey: opts.privateKeyPem ? exportedPublicKey(opts.privateKeyPem) : "",
    publicKeyId: publicKeyFingerprint(exportedPublicKey(opts.privateKeyPem)),
    sha256,
    name: manifest.name,
    version: manifest.version,
    signature,
  };
  writeFileSync(signaturePath, JSON.stringify(sig, null, 2));
  return { manifest, archivePath, signaturePath, sha256, signature: sig };
}

function exportedPublicKey(privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  return createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
}

function ignoreArgs(): string[] {
  return IGNORE_PATTERNS.map((p) => `--exclude=${p}`);
}

export function listProjectFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel = "") => {
    for (const name of readdirSync(d)) {
      if (IGNORE_PATTERNS.some((p) => name === p || name.endsWith(p))) continue;
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name.startsWith(".") && name !== "." && name !== "..") continue;
        walk(full, join(rel, name));
      } else if (st.isFile()) {
        if (name.startsWith("._")) continue;
        out.push(join(rel, name));
      }
    }
  };
  walk(dir);
  return out;
}

export interface UnpackLimits {
  maxTotalBytes: number;
  maxSingleFileBytes: number;
  maxFiles: number;
}

export const DEFAULT_UNPACK_LIMITS: UnpackLimits = {
  maxTotalBytes: 200 * 1024 * 1024,
  maxSingleFileBytes: 50 * 1024 * 1024,
  maxFiles: 5000,
};

export function assertSafeArchivePath(entryPath: string, destRoot: string): void {
  if (!entryPath || entryPath.length === 0) {
    throw new ArchiveError("empty path in archive");
  }
  if (entryPath.includes("\0")) {
    throw new ArchiveError("NUL byte in archive path");
  }
  if (entryPath.startsWith("/") || entryPath.startsWith("\\") || /^[a-zA-Z]:/.test(entryPath)) {
    throw new ArchiveError(`absolute path in archive: ${entryPath}`);
  }
  const parts = entryPath.split(/[/\\]/);
  if (parts.some((p) => p === "..")) {
    throw new ArchiveError(`path traversal in archive: ${entryPath}`);
  }
  const resolved = resolve(destRoot, entryPath);
  if (resolved !== destRoot && !resolved.startsWith(destRoot + sep)) {
    throw new ArchiveError(`path escapes destination: ${entryPath}`);
  }
}

export interface UnpackOptions {
  destDir: string;
  limits?: Partial<UnpackLimits>;
}

export interface UnpackResult {
  manifest: Manifest;
  files: string[];
}

function sanitizeMode(mode: number | undefined): number {
  const m = (mode ?? 0o644) & 0o777;
  return (m & 0o111) !== 0 ? m : m | 0o600;
}

/**
 * Strict, single-pass archive extractor.
 *
 * - Rejects absolute paths, path traversal, NUL bytes, drive-letter paths.
 * - Rejects all entry types except regular files and directories.
 * - Enforces total size / per-file size / file-count limits (zip-bomb defense).
 * - Masks file modes (no setuid/setgid/sticky bits).
 * Errors are propagated reliably by destroying the parser, never by throwing
 * from inside stream callbacks.
 */
function extractArchive(
  archivePath: string,
  destRoot: string,
  limits: UnpackLimits,
): Promise<{ manifestCandidates: string[] }> {
  return new Promise((resolvePromise, reject) => {
    let totalBytes = 0;
    let fileCount = 0;
    let pendingWrites = 0;
    let settled = false;
    const manifestCandidates: string[] = [];

    const finish = (err?: Error) => {
      if (settled) return;
      if (err) {
        settled = true;
        reject(err);
        return;
      }
      if (pendingWrites === 0) {
        settled = true;
        resolvePromise({ manifestCandidates });
      }
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const parser = new tar.Parser({ strict: true });

    parser.on("entry", (entry: ReadEntry) => {
      try {
        const safe = entry.path.replace(/^\.\//, "");
        assertSafeArchivePath(safe, destRoot);

        if (entry.type === "Directory") {
          mkdirSync(join(destRoot, safe), { recursive: true });
          entry.resume();
          return;
        }

        if (entry.type !== "File") {
          throw new ArchiveError(`unsupported entry type '${entry.type}' in archive: ${safe}`);
        }

        fileCount += 1;
        if (fileCount > limits.maxFiles) throw new ArchiveError("too many files in archive");
        const entrySize = entry.size ?? 0;
        if (entrySize > limits.maxSingleFileBytes) {
          throw new ArchiveError(`file too large in archive: ${safe}`);
        }
        totalBytes += entrySize;
        if (totalBytes > limits.maxTotalBytes) throw new ArchiveError("archive exceeds total size limit");

        const dest = join(destRoot, safe);
        mkdirSync(dirname(dest), { recursive: true });
        pendingWrites += 1;

        let written = 0;
        const out = createWriteStream(dest, { mode: sanitizeMode(entry.mode), flags: "wx" });
        entry.on("data", (chunk: Buffer) => {
          written += chunk.length;
          if (written > limits.maxSingleFileBytes) {
            out.destroy(new ArchiveError(`file too large in archive: ${safe}`));
          }
        });
        entry.on("error", (e: unknown) => fail(e instanceof Error ? e : new ArchiveError(String(e))));
        out.on("error", (e: unknown) => fail(e instanceof Error ? e : new ArchiveError(String(e))));
        out.on("finish", () => {
          pendingWrites -= 1;
          const base = safe.split("/").pop() ?? "";
          if (base === "agent.yaml" || base === "manifest.yaml") manifestCandidates.push(safe);
          finish();
        });
        entry.pipe(out);
      } catch (err) {
        fail(err as Error);
      }
    });

    parser.on("error", (err: Error) => fail(err));
    parser.on("end", () => finish());

    createReadStream(archivePath)
      .on("error", (e) => fail(e))
      .pipe(parser);
  });
}

export async function unpackAgent(archivePath: string, opts: UnpackOptions): Promise<UnpackResult> {
  const limits = { ...DEFAULT_UNPACK_LIMITS, ...opts.limits };
  const destRoot = resolve(opts.destDir);
  mkdirSync(destRoot, { recursive: true });

  const { manifestCandidates } = await extractArchive(archivePath, destRoot, limits);

  if (manifestCandidates.length === 0) {
    throw new ArchiveError("archive is missing agent.yaml/manifest.yaml");
  }

  const manifestPath = join(destRoot, manifestCandidates[0]);
  const manifest = assertValidManifest(parseManifest(readFileSync(manifestPath, "utf8")));

  const files = listProjectFiles(destRoot);
  return { manifest, files };
}

export async function readSignatureFile(path: string): Promise<SignatureFile> {
  return JSON.parse(readFileSync(path, "utf8")) as SignatureFile;
}

export function verifySignatureFile(sig: SignatureFile, archivePath: string): boolean {
  const actualSha = sha256Hex(readFileSync(archivePath));
  if (actualSha !== sig.sha256) return false;
  const payload = signaturePayload(sig.name, sig.version, sig.sha256);
  return verifyPayload(payload, sig.signature, sig.publicKey);
}

export function verifySignatureFileStrict(sig: SignatureFile, archivePath: string): void {
  if (sig.schemaVersion !== 1 || sig.algorithm !== "ed25519") {
    throw new SignatureError("unsupported signature scheme");
  }
  const actualSha = sha256Hex(readFileSync(archivePath));
  if (actualSha !== sig.sha256) {
    throw new SignatureError("checksum mismatch: archive does not match signature");
  }
  const payload = signaturePayload(sig.name, sig.version, sig.sha256);
  if (!verifyPayload(payload, sig.signature, sig.publicKey)) {
    throw new SignatureError("ed25519 signature verification failed");
  }
  const expectedId = publicKeyFingerprint(sig.publicKey);
  if (sig.publicKeyId !== expectedId) {
    throw new SignatureError("public key fingerprint mismatch");
  }
}
