import { cpSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sdkDir = join(here, "..");
const root = join(sdkDir, "..");
const schemaSrc = join(root, "specs", "agent.schema.json");
const schemaDest = join(sdkDir, "src", "schema");
const distSchemaDest = join(sdkDir, "dist", "schema");

for (const dest of [schemaDest, distSchemaDest]) {
  mkdirSync(dest, { recursive: true });
  rmSync(join(dest, "agent.schema.json"), { force: true });
  cpSync(schemaSrc, join(dest, "agent.schema.json"));
}

execSync("npx tsc -p tsconfig.json", { cwd: sdkDir, stdio: "inherit" });
