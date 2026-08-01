import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import addFormatsPkg from "ajv-formats";
import yaml from "js-yaml";
import { ManifestValidationError } from "./errors.js";

const addFormats = addFormatsPkg as unknown as (ajv: Ajv2020) => Ajv2020;

export type ModelProvider =
  | "openai" | "anthropic" | "google" | "deepseek" | "ollama"
  | "mistral" | "xai" | "groq" | "local" | "custom";

export type Permission =
  | "filesystem" | "network" | "github" | "terminal"
  | "browser" | "camera" | "microphone" | "none";

export type RuntimeLanguage = "python" | "node" | "go" | "rust" | "other";

export interface RuntimeSpec {
  language: RuntimeLanguage;
  python?: string;
  node?: string;
  sandbox?: "auto" | "container" | "isolated-process";
}

export interface CliInterface {
  command: string;
  input?: "json" | "args" | "stdin";
  output?: "json" | "text";
}

export interface McpInterface {
  entrypoint: string;
  transport?: "stdio" | "http" | "sse";
  tools?: string[];
}

export interface HttpInterface {
  endpoint: string;
  methods?: ("GET" | "POST")[];
}

export interface AgentInterfaces {
  cli?: CliInterface;
  mcp?: McpInterface;
  http?: HttpInterface;
}

export interface Manifest {
  manifestVersion: 1;
  name: string;
  version: string;
  author: string;
  description: string;
  license: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  runtime: RuntimeSpec;
  framework?: { name: string; version?: string };
  models: { supported: ModelProvider[] };
  interfaces: AgentInterfaces;
  permissions?: Permission[];
  dependencies?: { pip?: string[]; npm?: string[]; system?: string[] };
  tools?: string[];
  tags?: string[];
  secrets?: string[];
}

let validateFn: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (validateFn) return validateFn;
  const schemaPath = new URL("./schema/agent.schema.json", import.meta.url);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const validator = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(validator);
  validateFn = validator.compile(schema);
  return validateFn;
}

export function parseManifest(content: string): unknown {
  return yaml.load(content, { json: true, schema: yaml.JSON_SCHEMA });
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateManifest(input: unknown): ValidationResult {
  const fn = getValidator();
  const ok = fn(input);
  if (ok) return { valid: true, errors: [] };
  const errors: string[] = [];
  for (const err of fn.errors ?? []) {
    errors.push(`${err.instancePath || "/"} ${err.message ?? "invalid"}${err.params ? ` (${JSON.stringify(err.params)})` : ""}`);
  }
  return { valid: false, errors };
}

export function assertValidManifest(input: unknown): Manifest {
  const res = validateManifest(input);
  if (!res.valid) throw new ManifestValidationError(res.errors);
  return input as Manifest;
}

export function manifestToYaml(m: Manifest): string {
  return yaml.dump(m, { noRefs: true, lineWidth: 120 });
}

export const MANIFEST_FILENAMES = ["agent.yaml", "manifest.yaml"] as const;

export function loadManifestFromDir(dir: string): { manifest: Manifest; path: string } {
  for (const name of MANIFEST_FILENAMES) {
    try {
      const p = join(dir, name);
      const content = readFileSync(p, "utf8");
      const manifest = assertValidManifest(parseManifest(content));
      return { manifest, path: p };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  throw new ManifestValidationError([`no manifest found in ${dir} (expected agent.yaml or manifest.yaml)`]);
}
