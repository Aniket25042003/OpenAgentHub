import { Command, Flags } from "@oclif/core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig, saveConfig } from "@openagenthub/runtime";
import { RegistryClient } from "@openagenthub/sdk";
import { DeviceAuthPendingError } from "@openagenthub/sdk";
import { resolveRegistryUrl, saveCredential } from "../lib/credentials.js";

const run = promisify(execFile);

function openBrowser(url: string): void {
  if (process.platform === "darwin") {
    run("open", [url]).catch(() => {});
  } else if (process.platform === "win32") {
    run("cmd.exe", ["/c", "start", "", url]).catch(() => {});
  } else {
    run("xdg-open", [url]).catch(() => {});
  }
}

export default class Login extends Command {
  static description = "Sign in to the registry (browser/device flow) or with a GitHub token";

  static examples = ["<%= config.bin %> login", "<%= config.bin %> login --token <GITHUB_TOKEN>"];

  static flags = {
    token: Flags.string({ char: "t", description: "GitHub personal access token (advanced/CI flow)" }),
    registry: Flags.string({ description: "registry URL" }),
    "no-browser": Flags.boolean({ description: "print the verification URL instead of opening the browser" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Login);
    const registryUrl = resolveRegistryUrl(flags.registry);

    if (flags.token) {
      await this.tokenFlow(registryUrl, flags.token);
      return;
    }
    await this.deviceFlow(registryUrl, flags["no-browser"]);
  }

  private async tokenFlow(registryUrl: string, token: string): Promise<void> {
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      this.error((err as Error).message, { exit: 1 });
      return;
    }
    config.registryUrl = registryUrl;
    saveConfig(config);
    saveCredential({
      accessToken: token,
      username: "",
      registryUrl,
      tokenType: "legacy-github",
      storedAt: new Date().toISOString(),
    });

    try {
      const client = new RegistryClient(registryUrl, token);
      const me = await client.me();
      const cred = {
        accessToken: token,
        username: me.username,
        registryUrl,
        tokenType: "legacy-github",
        storedAt: new Date().toISOString(),
      };
      saveCredential(cred);
      this.log(`authenticated as ${me.username} at ${registryUrl}`);
    } catch (err) {
      this.log(`token stored locally (registry ${registryUrl} not reachable: ${(err as Error).message})`);
    }
  }

  private async deviceFlow(registryUrl: string, noBrowser: boolean): Promise<void> {
    const client = new RegistryClient(registryUrl);

    let start;
    try {
      start = await client.startDeviceLogin("cli");
    } catch (err) {
      this.error(`could not start device login at ${registryUrl}: ${(err as Error).message}`, { exit: 1 });
      return;
    }

    this.log(`verification URI: ${start.verificationUri}`);
    this.log(`user code:        ${start.userCode}`);
    this.log("");
    if (noBrowser) {
      this.log(`Open ${start.verificationUri} in your browser and enter the code above.`);
    } else {
      this.log("opening your browser…");
      openBrowser(start.verificationUri);
    }
    this.log("waiting for approval (Ctrl-C to cancel)…");

    const deadline = Date.now() + start.expiresIn * 1000;
    const intervalMs = Math.max(start.interval, 5) * 1000;

    try {
      for (;;) {
        if (Date.now() > deadline) {
          this.error("device login expired. Run 'openagenthub login' to try again.", { exit: 1 });
          return;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
        try {
          const result = await client.pollDeviceToken(start.deviceCode);
          const cred = {
            accessToken: result.accessToken,
            username: result.username,
            registryUrl,
            tokenType: result.tokenType,
            storedAt: new Date().toISOString(),
          };
          saveCredential(cred);
          let config;
          try {
            config = loadConfig();
          } catch {
            config = {};
          }
          config.registryUrl = registryUrl;
          saveConfig(config);
          this.log(`authenticated as ${result.username} at ${registryUrl}`);
          this.log("credential stored in the encrypted vault (not config.json)");
          return;
        } catch (err) {
          if (err instanceof DeviceAuthPendingError) continue;
          if (err instanceof Error && err.message.includes("expired_token")) {
            this.error("device login expired. Run 'openagenthub login' to try again.", { exit: 1 });
            return;
          }
          this.error(`device login failed: ${(err as Error).message}`, { exit: 1 });
          return;
        }
      }
    } finally {
      /* keep process exit codes intact */
    }
  }
}