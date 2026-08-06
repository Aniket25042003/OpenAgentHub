import { Command, Flags, Args } from "@oclif/core";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { packAgent, generateKeyPair, RegistryClient, publicKeyFingerprint } from "@openagenthub/sdk";
import { loadConfig, KEYS_DIR, REGISTRY_DEFAULT } from "@openagenthub/runtime";
import { resolveRegistryUrl, resolveToken } from "../lib/credentials.js";

export default class Publish extends Command {
  static description = "Package, sign and publish an agent to the registry";

  static args = { path: Args.string({ required: false, description: "project directory (default: .)" }) };

  static flags = {
    registry: Flags.string({ description: "registry URL" }),
    "public-only": Flags.boolean({ description: "package and sign locally, do not upload" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Publish);
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
      return;
    }
    const registryUrl = resolveRegistryUrl(flags.registry);

    const projectDir = resolve(args.path ?? ".");
    const { privateKey, publicKey } = this.signingKey();

    this.log("packaging + signing agent...");
    const pkg = packAgent(projectDir, { privateKeyPem: privateKey, outDir: projectDir });
    this.log(`archive: ${pkg.archivePath}`);
    this.log(`sha256:  ${pkg.sha256}`);
    this.log(`signature by key ${pkg.signature.publicKeyId}`);

    if (flags["public-only"]) return;

    const token = resolveToken(registryUrl);
    if (!token) {
      this.error("not authenticated. Run: openagenthub login", { exit: 1 });
    }
    const client = new RegistryClient(registryUrl, token);

    try {
      const me = await client.me();
      this.log(`authenticated as ${me.username}`);
    } catch (err) {
      this.error(`authentication failed at ${registryUrl}: ${(err as Error).message}`, { exit: 1 });
    }

    await client.uploadPublicKey(publicKey);
    this.log(`registered public key ${pkg.signature.publicKeyId}`);

    const { namespace, name, version } = parseNameVersion(pkg.manifest.name, pkg.manifest.version);
    const result = await client.publish(namespace, name, version, readFileSync(pkg.archivePath), pkg.signature);
    this.log(`published ${pkg.manifest.name}@${pkg.manifest.version}`);
    if (result.security === "flagged") {
      this.log(`warning: security scan flagged the archive: ${result.findings.join("; ")}`);
    } else {
      this.log(`security scan: ${result.security}`);
    }
  }

  private signingKey(): { privateKey: string; publicKey: string } {
    const privPath = join(KEYS_DIR, "id_ed25519");
    const pubPath = join(KEYS_DIR, "id_ed25519.pub");
    if (existsSync(privPath) && existsSync(pubPath)) {
      const privateKey = readFileSync(privPath, "utf8").trim();
      const publicKey = readFileSync(pubPath, "utf8").trim();
      if (publicKeyFingerprint(publicKey)) {
        return { privateKey, publicKey };
      }
    }
    mkdirSync(KEYS_DIR, { recursive: true });
    const kp = generateKeyPair();
    writeFileSync(privPath, kp.privateKey, { mode: 0o600 });
    writeFileSync(pubPath, kp.publicKey, { mode: 0o600 });
    this.log(`generated new signing key (${publicKeyFingerprint(kp.publicKey)}) in ${KEYS_DIR}`);
    return kp;
  }
}

function parseNameVersion(name: string, version: string): { namespace: string; name: string; version: string } {
  const [namespace, agentName] = name.split("/");
  return { namespace, name: agentName, version };
}
