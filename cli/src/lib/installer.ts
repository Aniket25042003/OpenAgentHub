import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, basename, dirname } from "node:path";
import {
  RegistryClient,
  unpackAgent,
  verifySignatureFileStrict,
  readSignatureFile,
  loadManifestFromDir,
  checkAgentRequirements,
  detectRuntime,
  listProjectFiles,
  type Manifest,
  type SignatureFile,
} from "@openagenthub/sdk";
import {
  loadConfig,
  recordInstall,
  saveGrantedPermissions,
  requestedPermissions,
  installedAgentDir,
  REGISTRY_DEFAULT,
  agentKeyToString,
  type InstalledAgent,
  type GrantedPermissions,
} from "@openagenthub/runtime";
import { confirmAll } from "./prompt.js";

export interface InstallOptions {
  forceYes: boolean;
  noPermissions: boolean;
  registryUrl?: string;
  force?: boolean;
}

export interface ResolvedPackage {
  manifest: Manifest;
  archivePath?: string;
  signature?: SignatureFile;
  trust: "trusted" | "untrusted" | "unknown" | "local";
  source: string;
  reviewStatus?: string;
  statusCheckedAt?: string;
  archiveDigest?: string;
}

export function parseSpec(spec: string): { namespace: string; name: string; version?: string } {
  const m = spec.match(/^([a-z0-9][a-z0-9-]*[a-z0-9])\/([a-z0-9][a-z0-9_-]*[a-z0-9])(?:@(.*))?$/);
  if (!m) throw new Error(`invalid agent spec '${spec}'. Expected namespace/name[@version]`);
  return { namespace: m[1], name: m[2], version: m[3] || undefined };
}

async function resolveFromRegistry(spec: string, registryUrl: string, token?: string): Promise<ResolvedPackage> {
  const { namespace, name, version } = parseSpec(spec);
  const client = new RegistryClient(registryUrl, token);
  const detail = await client.getVersion(namespace, name, version ?? "latest");
  const { buffer, signature } = await client.downloadArchive(namespace, name, detail.manifest.version);

  const tmp = mkdtempSync(join(tmpdir(), "oah-install-"));
  const archivePath = join(tmp, `${name}-${detail.manifest.version}.ahb`);
  writeFileSync(archivePath, buffer);

  verifySignatureFileStrict(signature, archivePath);

  const blocked = ["rejected", "revoked"].includes(detail.reviewStatus ?? "");
  if (blocked) {
    throw new Error(
      `version ${namespace}/${name}@${detail.manifest.version} is ${detail.reviewStatus} by the registry: ${detail.reviewReason ?? "no reason recorded"}`,
    );
  }

  return {
    manifest: detail.manifest,
    archivePath,
    signature,
    trust: detail.security?.status === "flagged" ? "untrusted" : (detail.trust ?? "unknown"),
    reviewStatus: detail.reviewStatus,
    statusCheckedAt: new Date().toISOString(),
    source: `${registryUrl}/api/v1/agents/${namespace}/${name}/versions/${detail.manifest.version}/archive`,
  };
}

async function resolveFromFile(archivePath: string): Promise<ResolvedPackage> {
  const abs = resolve(archivePath);
  const sigPath = join(dirname(abs), `${basename(abs)}.sig.json`);
  let signature: SignatureFile | undefined;
  try {
    signature = await readSignatureFile(sigPath);
    verifySignatureFileStrict(signature, abs);
  } catch {
    signature = undefined;
  }

  const tmp = mkdtempSync(join(tmpdir(), "oah-file-"));
  const { manifest } = await unpackAgent(abs, { destDir: tmp });

  return { manifest, archivePath: abs, signature, trust: signature ? "unknown" : "unknown", source: `file:${abs}` };
}

async function resolveFromDir(dirPath: string): Promise<ResolvedPackage> {
  const abs = resolve(dirPath);
  const { manifest } = loadManifestFromDir(abs);
  return { manifest, trust: "local", source: `dir:${abs}` };
}

export async function installAgent(
  spec: string,
  source: { kind: "registry" | "file" | "dir"; path?: string },
  opts: InstallOptions,
): Promise<void> {
  const config = loadConfig();
  const registryUrl = opts.registryUrl ?? config.registryUrl ?? REGISTRY_DEFAULT;

  let resolved: ResolvedPackage;
  if (source.kind === "registry") {
    resolved = await resolveFromRegistry(spec, registryUrl, config.token);
  } else if (source.kind === "file") {
    resolved = await resolveFromFile(source.path!);
  } else {
    resolved = await resolveFromDir(source.path!);
  }

  const { namespace, name } = parseSpec(spec);
  const manifest = resolved.manifest;
  if (manifest.name !== `${namespace}/${name}`) {
    throw new Error(`manifest name '${manifest.name}' does not match requested spec '${namespace}/${name}'`);
  }

  const already = config.installed?.[`${namespace}/${name}@${manifest.version}`];
  if (already && !opts.force) {
    throw new Error(
      `${namespace}/${name}@${manifest.version} is already installed (reinstall with: openagenthub install ${namespace}/${name}@${manifest.version} --force)`,
    );
  }

  console.log(`agent: ${manifest.name}@${manifest.version}`);
  console.log(`author: ${manifest.author} | license: ${manifest.license}`);
  console.log(`trust: ${resolved.trust} | source: ${resolved.source}`);
  if (resolved.trust === "untrusted" || resolved.trust === "unknown") {
    console.log("warning: agent is not from a verified publisher; it will run in a container sandbox");
  }
  if (resolved.trust === "local") {
    console.log("info: local development install; running without sandbox isolation");
  }

  const detected = detectRuntime();
  const req = checkAgentRequirements(manifest, detected);
  for (const msg of req.messages) console.log("  check:", msg);
  if (!req.satisfied) {
    console.log("missing:", req.missing.join(", "));
    if (!opts.forceYes) {
      const [ok] = await confirmAll([`missing runtime components (${req.missing.join(", ")}). install anyway?`], false);
      if (!ok) throw new Error("aborted: missing runtime requirements");
    }
  }

  const perms = requestedPermissions(manifest);
  const granted: GrantedPermissions = {};
  if (perms.length === 0 || (perms.length === 1 && perms[0] === "none")) {
    for (const p of perms) granted[p] = true;
  } else if (opts.noPermissions) {
    for (const p of perms) granted[p] = false;
  } else {
    const answers = await confirmAll(
      perms.map((p) => `grant '${p}' permission to ${manifest.name}?`),
      opts.forceYes,
    );
    perms.forEach((p, i) => (granted[p] = answers[i]));
  }
  const grantedList = Object.entries(granted).filter(([, v]) => v).map(([k]) => k);
  console.log(`permissions granted: ${grantedList.join(", ") || "none"}`);

  const dest = installedAgentDir({ namespace, name, version: manifest.version });
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  let fileCount = 0;
  if (resolved.archivePath) {
    const res = await unpackAgent(resolved.archivePath, { destDir: dest });
    fileCount = res.files.length;
    if (resolved.signature) {
      writeFileSync(join(dest, "signature.sig.json"), JSON.stringify(resolved.signature, null, 2), { mode: 0o600 });
      writeFileSync(join(dest, "archive.ahb"), readFileSync(resolved.archivePath));
    }
  } else if (resolved.source.startsWith("dir:")) {
    const srcDir = resolved.source.slice(4);
    for (const f of listProjectFiles(srcDir)) {
      const srcPath = join(srcDir, f);
      const destPath = join(dest, f);
      mkdirSync(dirname(destPath), { recursive: true });
      cpSync(srcPath, destPath);
    }
    fileCount = listProjectFiles(srcDir).length;
  }
  console.log(`installed ${fileCount} files to ${dest}`);

  const agentKey: InstalledAgent = {
    namespace,
    name,
    version: manifest.version,
    author: manifest.author,
    trust: resolved.trust,
    installedAt: new Date().toISOString(),
    source: resolved.source,
    signatureKeyId: resolved.signature?.publicKeyId,
    reviewStatus: resolved.reviewStatus,
    statusCheckedAt: resolved.statusCheckedAt,
    archiveDigest: resolved.archiveDigest ?? (resolved.archivePath ? archiveDigest(resolved.archivePath) : undefined),
  };
  recordInstall(config, agentKey);
  saveGrantedPermissions(config, `${namespace}/${name}@${manifest.version}`, granted);
  console.log(`done: ${agentKeyToString({ namespace, name, version: manifest.version })}`);
}

function archiveDigest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
