import { Fragment } from "react";

const GITHUB = "https://github.com/Aniket25042003/OpenAgentHub";

const FEATURES = [
  {
    title: "One manifest",
    body: "Declare an agent once in a single framework-agnostic agent.yaml — name, version, interfaces, permissions, and secrets.",
    icon: "M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 5h8M8 12h8M8 16h5",
  },
  {
    title: "Three interfaces",
    body: "Every agent runs as a one-shot CLI, a long-running MCP server, or a deployable HTTP endpoint — from the same manifest.",
    icon: "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M8 21H5a2 2 0 0 1-2-2v-3m18 0v3a2 2 0 0 1-2 2h-3",
  },
  {
    title: "Signed packages",
    body: "Agents are packed into .ahb archives and signed with Ed25519. Signatures bind the SHA-256, name, and version.",
    icon: "M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4Zm-2 12 2-2 4 4 4-6",
  },
  {
    title: "Sandboxed by default",
    body: "Untrusted agents run in a hardened container with all capabilities dropped, no network, and strict resource limits.",
    icon: "M12 2l9 4v6c0 5.5-3.8 9.4-9 12-5.2-2.6-9-6.5-9-12V6l9-4Zm-3 12 2 2 5-5",
  },
  {
    title: "Secrets vault",
    body: "Agent env values are encrypted with AES-256-GCM and keyed to your machine. Never committed to manifests or repos.",
    icon: "M8 11V7a4 4 0 0 1 8 0v4M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z",
  },
  {
    title: "Registry & search",
    body: "Publish, discover, and install agents from a self-hostable registry with per-version security scanning.",
    icon: "M3 12h4l3 8 4-16 3 8h4",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Write",
    body: "Scaffold a project from a manifest template and drop in your agent code — any language, any framework.",
    code: "agent init acme/pr-reviewer",
  },
  {
    n: "02",
    title: "Publish",
    body: "Pack, sign, and upload to the registry. The archive is scanned and verified before it goes live.",
    code: "agent publish",
  },
  {
    n: "03",
    title: "Run",
    body: "Install anywhere — signature and SHA-256 are verified before unpacking — then run in any interface.",
    code: 'echo \'{"prompt":"..."}\' | agent run acme/pr-reviewer',
  },
];

const METHODS = [
  {
    icon: "npm",
    title: "npm",
    body: "Install the CLI globally from the npm registry.",
    code: "npm install -g @openagenthub/cli",
  },
  {
    icon: "🍺",
    title: "Homebrew",
    body: "Install via the OpenAgentHub tap on macOS.",
    code: "brew install openagenthub/tap/agent",
  },
  {
    icon: "↗",
    title: "Binary",
    body: "Download the prebuilt binary for your platform.",
    code:
      "curl -fsSL https://github.com/Aniket25042003/OpenAgentHub/releases/latest/download/agent -o agent &&\nchmod +x agent && sudo mv agent /usr/local/bin/agent",
  },
];

function Pre({ lines }: { lines: React.ReactNode[] }) {
  return (
    <pre>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {line}
          {i < lines.length - 1 ? "\n" : ""}
        </Fragment>
      ))}
    </pre>
  );
}

export default function LandingPage() {
  return (
    <>
      <section className="hero" id="top">
        <div className="container inner">
          <div>
            <span className="eyebrow">✦ The npm for agents</span>
            <h1>
              Install, run, and publish AI agents <span className="grad">like software packages.</span>
            </h1>
            <p className="lead">
              OpenAgentHub is a universal package manager &amp; registry for AI agents. One manifest declares
              the agent; the CLI runs it as a one-shot command, an MCP server, or an HTTP endpoint — signed,
              verified, and sandboxed by default.
            </p>
            <div className="cta">
              <a className="btn btn-primary btn-lg" href="#install">
                Get started
              </a>
              <a className="btn btn-lg" href="#features">
                Explore features
              </a>
            </div>
            <div className="trust">
              <span>
                <CheckIcon /> Signed with Ed25519
              </span>
              <span>
                <CheckIcon /> Sandboxed containers
              </span>
              <span>
                <CheckIcon /> Encrypted secrets
              </span>
            </div>
          </div>
          <div className="terminal">
            <div className="bar">
              <i />
              <i />
              <i />
              <span>terminal — openagenthub</span>
            </div>
            <Pre
              lines={[
                <>
                  <span className="p">$</span> agent install acme/pr-reviewer
                </>,
                <>
                  <span className="c"># signature verified · sha256 ok · sandbox: container</span>
                </>,
                <>✓ installed acme/pr-reviewer@1.4.2</>,
                <></>,
                <>
                  <span className="p">$</span>{" "}
                  {'printf \'{"repo":"acme/app","pr":42}\' | agent run acme/pr-reviewer'}
                </>,
                <>
                  <span className="g">→</span>{" "}
                  <span className="b">"Looks good. One nit: docs/changelog.md needs a line."</span>
                </>,
                <></>,
                <>
                  <span className="p">$</span> agent status
                </>,
                <>
                  <span className="g">●</span> OpenClaw     running  (port 18789)
                </>,
                <>
                  <span className="g">●</span> Hermes       running  (port 8642)
                </>,
              ]}
            />
          </div>
        </div>
      </section>

      <section className="block alt" id="features">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Features</span>
            <h2>Everything you need to ship agents safely</h2>
            <p>
              Built for the way real agent workflows run: trusted by default, verifiable end-to-end, and
              frictionless to share.
            </p>
          </div>
          <div className="features">
            {FEATURES.map((f) => (
              <div className="feature" key={f.title}>
                <div className="icon">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={f.icon} />
                  </svg>
                </div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="block" id="how">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">How it works</span>
            <h2>From manifest to running agent in three steps</h2>
            <p>No special frameworks, no lock-in. If it&apos;s code, it&apos;s an OpenAgentHub agent.</p>
          </div>
          <div className="steps">
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <span className="n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <code>{s.code}</code>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="block alt" id="install">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Install</span>
            <h2>Get OpenAgentHub in minutes</h2>
            <p>Pick your platform. After installation, the agent CLI is available everywhere on your machine.</p>
          </div>
          <div className="install-grid">
            {METHODS.map((m) => (
              <div className="method" key={m.title}>
                <h3>
                  <span className="badge-ic">{m.icon}</span>
                  {m.title}
                </h3>
                <p>{m.body}</p>
                <pre>{m.code}</pre>
              </div>
            ))}
          </div>

          <div className="quickstart">
            <h3>Try it now</h3>
            <Pre
              lines={[
                <>
                  <span className="c"># point the CLI at the registry</span>
                </>,
                <>
                  <span className="p">$</span> agent login --token &lt;github-token&gt;
                </>,
                <></>,
                <>
                  <span className="c"># find an agent</span>
                </>,
                <>
                  <span className="p">$</span> agent search pr-reviewer
                </>,
                <>
                  <span className="b">acme/pr-reviewer</span>  v1.4.2  trusted  1.2k downloads
                </>,
                <></>,
                <>
                  <span className="c"># install, then run it</span>
                </>,
                <>
                  <span className="p">$</span> agent install acme/pr-reviewer
                </>,
                <>
                  <span className="p">$</span>{" "}
                  {'echo \'{"repo":"acme/app","pr":42}\' | agent run acme/pr-reviewer'}
                </>,
                <>
                  <span className="g">→</span> <span className="b">"Approved — ready to merge."</span>
                </>,
              ]}
            />
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="container">
          <h2>Ready to run agents the npm way?</h2>
          <p>Signed, sandboxed, and scriptable from day one.</p>
          <div className="cta" style={{ justifyContent: "center" }}>
            <a className="btn btn-primary btn-lg" href="#install">
              Install OpenAgentHub
            </a>
            <a className="btn btn-lg" href={GITHUB} target="_blank" rel="noreferrer">
              Star on GitHub
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

function CheckIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
