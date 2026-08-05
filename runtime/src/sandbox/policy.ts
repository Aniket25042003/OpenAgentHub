import type { Manifest, Permission } from "@openagenthub/sdk";

export type TrustLevel = "trusted" | "untrusted" | "unknown" | "local";

export interface SandboxOverride {
  sandbox: "container" | "process";
  digest: string;
  setAt: string;
}

export interface SandboxPolicyInput {
  trust: TrustLevel;
  manifest: Manifest;
  reviewStatus?: "pending" | "verified" | "warning" | "rejected" | "revoked" | string;
  statusFresh?: boolean;
  override?: SandboxOverride | null;
  archiveDigest?: string;
}

export interface SandboxDecision {
  mode: "container" | "process";
  reason: string;
  blocked?: string;
  overrideApplied?: boolean;
  staleStatus?: boolean;
}

const BLOCKED_STATUSES = new Set(["rejected", "revoked"]);

export function effectiveSandbox(input: SandboxPolicyInput): SandboxDecision {
  if (input.reviewStatus && BLOCKED_STATUSES.has(input.reviewStatus)) {
    return {
      mode: "container",
      reason: "not used",
      blocked: `this version was ${input.reviewStatus} by the registry and cannot be run`,
    };
  }

  if (input.trust === "untrusted" || input.trust === "unknown") {
    return {
      mode: "container",
      reason:
        input.trust === "untrusted"
          ? "agent is not trusted; source trust requires container isolation"
          : "agent trust is unknown; defaulting to container isolation",
    };
  }

  const statusKnown = input.reviewStatus !== undefined && input.reviewStatus !== null;
  if (statusKnown && input.reviewStatus !== "verified" && input.statusFresh !== true) {
    return {
      mode: "container",
      reason: `review status '${input.reviewStatus}' is not verified; using container isolation`,
      staleStatus: input.statusFresh === false,
    };
  }

  if (input.override) {
    if (input.archiveDigest && input.override.digest !== input.archiveDigest) {
      return {
        mode: "container",
        reason: "sandbox override is stale (archive digest changed); using container isolation",
      };
    }
    if (input.override.sandbox === "process") {
      return { mode: "process", reason: "local sandbox policy overrides to process execution", overrideApplied: true };
    }
    return { mode: "container", reason: "local sandbox policy forces container isolation", overrideApplied: true };
  }

  const requested = input.manifest.runtime.sandbox ?? "auto";
  if (requested === "container") {
    return { mode: "container", reason: "manifest requests container sandbox" };
  }
  if (requested === "isolated-process") {
    return { mode: "process", reason: "manifest requests isolated-process sandbox" };
  }
  return { mode: "process", reason: "trusted or local agent; using fast isolated-process path" };
}

export function manifestCanForceProcess(manifest: Manifest): boolean {
  return (manifest.runtime.sandbox ?? "auto") === "isolated-process";
}

export function requestedSandbox(manifest: Manifest): string {
  return manifest.runtime.sandbox ?? "auto";
}

export function grantedToEffective(granted: Permission[]): Set<Permission> {
  return new Set(granted);
}
