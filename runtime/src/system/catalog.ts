import type { KnownAgentSpec } from "./types.js";

export const KNOWN_AGENTS: KnownAgentSpec[] = [
  {
    id: "openclaw",
    displayName: "OpenClaw",
    description: "Full-system personal AI agent with messaging channels",
    homepage: "https://openclaw.ai",
    processPatterns: ["openclaw"],
    binaries: ["openclaw"],
    configPaths: [".openclaw/openclaw.json"],
    containerNamePatterns: ["openclaw"],
    containerImagePatterns: ["openclaw"],
    ports: [18789],
  },
  {
    id: "hermes",
    displayName: "Hermes Agent",
    description: "Nous Research agentic terminal assistant",
    homepage: "https://hermes-agent.nousresearch.com",
    processPatterns: ["hermes"],
    binaries: ["hermes"],
    configPaths: [".hermes/config.yaml", ".hermes/.env"],
    containerNamePatterns: ["hermes"],
    containerImagePatterns: ["hermes-agent", "nousresearch/hermes"],
    ports: [8642, 8643, 9119],
  },
];
