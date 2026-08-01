export class AgentHubError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "AgentHubError";
  }
}

export class ManifestValidationError extends AgentHubError {
  constructor(readonly errors: string[]) {
    super(`manifest invalid: ${errors.join("; ")}`, "MANIFEST_INVALID");
    this.name = "ManifestValidationError";
  }
}

export class SignatureError extends AgentHubError {
  constructor(message: string) {
    super(message, "SIGNATURE_INVALID");
    this.name = "SignatureError";
  }
}

export class ArchiveError extends AgentHubError {
  constructor(message: string) {
    super(message, "ARCHIVE_INVALID");
    this.name = "ArchiveError";
  }
}

export class RegistryError extends AgentHubError {
  constructor(message: string, readonly status?: number) {
    super(message, "REGISTRY_ERROR");
    this.name = "RegistryError";
  }
}
