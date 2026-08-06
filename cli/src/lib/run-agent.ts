import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadManifestFromDir, type Manifest, type Permission } from "@openagenthub/sdk";
import {
  AgentRuntime,
  SecretsVault,
  grantedPermissions,
  grantedSecretNames,
  loadConfig,
  sandboxOverride,
  saveSecretGrant,
  type InstalledAgent,
  type OpenAgentHubConfig,
  type RunAgentResult,
  type SandboxOverride,
  installedAgentDir,
} from "@openagenthub/runtime";
import { checkRevocationBeforeRun } from "./revocation.js";
import { resolveToken } from "./credentials.js";
import { parseSpec } from "./installer.js";
import { installedMatches, resolveInstalledOrThrow } from "./resolve.js";

export interface ParsedSpec {
  namespace: string;
  name: string;
  version?: string;
}

export interface RunContext {
  agentKey: string;
  namespace: string;
  name: string;
  version: string;
  agentDir: string;
  manifest: Manifest;
  installed: InstalledAgent;
  config: OpenAgentHubConfig;
  granted: Permission[];
  exposedSecrets: string[];
  sandboxOverride: SandboxOverride | null;
  reviewStatus?: string;
  statusFresh: boolean;
  vault: SecretsVault;
}

export interface PrepareOptions {
  allowSecrets?: boolean;
  onNote?: (msg: string) => void;
  confirmSecrets?: (names: string[]) => Promise<boolean[]>;
}

export async function prepareRunContext(spec: string | ParsedSpec, opts: PrepareOptions = {}): Promise<RunContext> {
  const parsed = typeof spec === "string" ? parseSpec(spec) : spec;
  const { namespace, name, version } = parsed;
  const note = opts.onNote ?? ((): void => {});

  const config = loadConfig();

  const match = resolveInstalledOrThrow(config, namespace, name, version);
  const [agentKey, installed] = [match.key, match.record];
  if (!version && installedMatches(config, namespace, name).length > 1) {
    note(`note: multiple versions installed; running ${namespace}/${name}@${installed.version}`);
  }
  const dir = installedAgentDir({ namespace, name, version: installed.version });

  if (!existsSync(dir)) {
    throw new Error(`agent directory missing for ${agentKey} (reinstall with: openagenthub install ${namespace}/${name}@${installed.version})`);
  }

  const { manifest } = loadManifestFromDir(dir);

  const revCheck = await checkRevocationBeforeRun(
    agentKey,
    installed,
    config.registryUrl ?? "https://registry.openagenthub.dev",
    resolveToken(config.registryUrl ?? "https://registry.openagenthub.dev"),
  );
  if (revCheck.blocked) {
    throw new Error(`blocked: ${revCheck.blocked}`);
  }
  if (revCheck.staleWarning) {
    note(revCheck.staleWarning);
  }

  const vault = SecretsVault.open();
  const requestedSecrets = (manifest.secrets ?? []) as string[];
  const vaultSecrets = vault.get(agentKey);
  const grantedSecrets = grantedSecretNames(agentKey, config);
  const toAsk = requestedSecrets.filter((s) => s in vaultSecrets && !grantedSecrets.has(s));

  if (toAsk.length > 0 && opts.allowSecrets) {
    for (const s of toAsk) saveSecretGrant(config, agentKey, s);
  } else if (toAsk.length > 0 && opts.confirmSecrets) {
    const answers = await opts.confirmSecrets(toAsk.map((s) => `expose stored secret '${s}' to ${manifest.name}?`));
    toAsk.forEach((s, i) => {
      if (answers[i]) saveSecretGrant(config, agentKey, s);
    });
  } else if (toAsk.length > 0) {
    note(`not exposing stored secrets (${toAsk.join(", ")}) in non-interactive mode; pass --allow-secrets to grant them`);
  }
  const exposedSecrets = requestedSecrets.filter((s) => grantedSecretNames(agentKey, config).has(s));

  const granted = Object.entries(grantedPermissions(config, agentKey))
    .filter(([, v]) => v)
    .map(([k]) => k)
    .filter((k) => k !== "none") as Permission[];

  return {
    agentKey,
    namespace,
    name,
    version: installed.version,
    agentDir: dir,
    manifest,
    installed,
    config,
    granted,
    exposedSecrets,
    sandboxOverride: (sandboxOverride(config, agentKey) ?? null) as SandboxOverride | null,
    reviewStatus: installed.reviewStatus,
    statusFresh: revCheck.statusFresh,
    vault,
  };
}

export interface ExecuteOptions {
  interfaceName: "cli" | "mcp" | "http";
  input?: string;
  timeoutMs?: number;
  interactive?: boolean;
  model?: string;
  runId?: string;
  streamOutput?: boolean;
  usageFilePath?: string;
}

export async function executeAgentRun(ctx: RunContext, opts: ExecuteOptions): Promise<RunAgentResult> {
  const runtime = new AgentRuntime(ctx.vault);
  return runtime.runAgent({
    agentDir: ctx.agentDir,
    manifest: ctx.manifest,
    agentKey: ctx.agentKey,
    interfaceName: opts.interfaceName,
    input: opts.input === "" ? undefined : opts.input,
    granted: ctx.granted,
    trustLevel: ctx.installed.trust,
    model: opts.model,
    timeoutMs: opts.timeoutMs,
    interactive: opts.interactive,
    streamOutput: opts.streamOutput,
    reviewStatus: ctx.reviewStatus,
    statusFresh: ctx.statusFresh,
    sandboxOverride: ctx.sandboxOverride,
    archiveDigest: ctx.installed.archiveDigest,
    runId: opts.runId,
    usageFilePath: opts.usageFilePath,
  });
}
