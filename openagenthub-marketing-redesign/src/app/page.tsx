import Reveal from "@/components/Reveal";
import ClearanceStamp from "@/components/ClearanceStamp";
import CodeBlock from "@/components/CodeBlock";

const GITHUB = "https://github.com/Aniket25042003/OpenAgentHub";

/* ---------------------------------------------------------- */

function Icon({ d, extra }: { d: string; extra?: React.ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
      {extra}
    </svg>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Cross({ className }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/* ---------------------------------------------------------- */

const FEATURES = [
  {
    code: "ITM-01",
    title: "One dashboard for every agent on your machine",
    body: "The homepage is a live system dashboard — installed agents, running Docker containers, and third-party agents that are already on your machine, auto-detected by process, config, and port.",
    icon: "M3 12h4l3 8 4-16 3 8h4",
    extra: (
      <div className="mini-panel">
        <div className="mp-row"><span className="dot" /><span className="mp-name">openagenthub</span><span className="mp-tag">installed</span></div>
        <div className="mp-row"><span className="dot" /><span className="mp-name">openclaw</span><span className="mp-tag">detected · pid 41213</span></div>
        <div className="mp-row"><span className="dot" /><span className="mp-name">hermes</span><span className="mp-tag">detected · port 8642</span></div>
      </div>
    ),
  },
  {
    code: "ITM-02",
    title: "One manifest, any language, any framework",
    body: "Every agent is declared once in agent.yaml — framework-agnostic, validated strictly against a JSON Schema. Python, Node, Go, Rust; LangGraph, CrewAI, AutoGen, or nothing at all.",
    icon: "M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 5h8M8 12h8M8 16h5",
    extra: (
      <div className="row-code-block">
        <span className="k">runtime</span>:{"\n"}
        {"  "}<span className="k">language</span>: <span className="v">python</span>{"\n"}
        <span className="k">interfaces</span>:{"\n"}
        {"  "}<span className="k">cli</span>:{"\n"}
        {"    "}<span className="k">command</span>: <span className="v">&quot;python main.py&quot;</span>
      </div>
    ),
  },
  {
    code: "ITM-03",
    title: "Three execution interfaces",
    body: "Every agent runs as a one-shot CLI (JSON in, JSON out), a long-running MCP server, or a deployable HTTP endpoint — from the same manifest.",
    icon: "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M8 21H5a2 2 0 0 1-2-2v-3m18 0v3a2 2 0 0 1-2 2h-3",
  },
  {
    code: "ITM-04",
    title: "Signed with Ed25519",
    body: "Agents are packed into signed .ahb archives. The signature binds the SHA-256 hash, name, and version — re-verified by the registry on publish and the CLI on install.",
    icon: "M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4Zm-2 12 2-2 4 4 4-6",
  },
  {
    code: "ITM-05",
    title: "Sandboxed by default",
    body: "Untrusted agents run in a hardened container: capabilities dropped, no network unless granted, read-only root, and strict CPU, memory, and process limits.",
    icon: "M12 2l9 4v6c0 5.5-3.8 9.4-9 12-5.2-2.6-9-6.5-9-12V6l9-4Zm-3 12 2 2 5-5",
  },
  {
    code: "ITM-06",
    title: "Encrypted secrets vault",
    body: "Agent env values are encrypted with AES-256-GCM and keyed to your machine, then injected at runtime — never committed to a manifest or a repo.",
    icon: "M8 11V7a4 4 0 0 1 8 0v4M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z",
  },
  {
    code: "ITM-07",
    title: "Android-style permissions",
    body: "Agents declare the capabilities they need — network, filesystem, github, terminal, browser, camera, microphone — and you grant them explicitly at install.",
    icon: "M4 5h16M4 12h16M4 19h7",
  },
  {
    code: "ITM-08",
    title: "Scanned registry, self-hostable",
    body: "Every published version is statically scanned for unsafe archive paths and oversized members before it's marked clean. Run the registry, dashboard, and CLI on your own infrastructure.",
    icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm10 17-5.6-5.6",
  },
];

const LIFECYCLE = [
  { n: "01", title: "Author", body: "Write agent.yaml plus your code — any language, any framework.", code: "agent init acme/pr-reviewer" },
  { n: "02", title: "Pack & sign", body: "Pack the project into a .ahb archive and sign it with Ed25519.", code: "agent publish ./acme --public-only" },
  { n: "03", title: "Registry", body: "Upload it; the registry re-verifies the signature and scans the archive.", code: "PUT /agents/{ns}/{name}/versions/{v}" },
  { n: "04", title: "Install", body: "Fetch, re-verify SHA-256 + signature + key fingerprint, then unpack.", code: "agent install acme/pr-reviewer" },
  { n: "05", title: "Run", body: "Inject model + secrets, execute in the right sandbox, get JSON back.", code: "agent run acme/pr-reviewer --model openai" },
];

const CLI_ROWS = [
  ["agent init <ns/name>", "Scaffold a new agent project"],
  ["agent validate [dir]", "Validate the manifest & runtime"],
  ["agent publish [dir]", "Package, sign, and publish"],
  ["agent login --token", "Authenticate with the registry"],
  ["agent search [query]", "Search the registry"],
  ["agent install <spec>", "Install from registry or file"],
  ["agent verify <spec>", "Verify signature & integrity"],
  ["agent run <spec>", "Run an installed agent"],
  ["agent env <spec>", "Manage encrypted secrets"],
  ["agent list", "List installed agents"],
  ["agent status", "System + agent diagnostics"],
  ["agent ps", "List Docker containers"],
];

const SECURITY = [
  {
    title: "Signed & verified",
    body: "Every artifact is Ed25519-signed by its publisher. The signature binds the archive's SHA-256 hash to its name and version — a single changed byte breaks it.",
  },
  {
    title: "Strict extraction",
    body: "The CLI refuses to unpack absolute paths, directory traversal, NUL bytes, symlinks, or device nodes, with size and count caps against zip bombs.",
  },
  {
    title: "Sandboxed by trust tier",
    body: "Trusted and local agents get a fast isolated-process path. Untrusted agents run in a hardened container with no capabilities and no network by default.",
  },
  {
    title: "Secrets vault",
    body: "Agent env values are encrypted with AES-256-GCM, keyed to a machine-bound file at $AGENT_HOME/master.key. Values are never printed in a listing.",
  },
];

const METHODS = [
  { tag: "npm", title: "npm", body: "Install the CLI globally from the npm registry.", code: "npm install -g @openagenthub/cli" },
  { tag: "brew", title: "Homebrew", body: "Install via the OpenAgentHub tap on macOS.", code: "brew install openagenthub/tap/agent" },
  {
    tag: "bin",
    title: "Binary",
    body: "Download the prebuilt binary for your platform.",
    code: "curl -fsSL https://github.com/Aniket25042003/OpenAgentHub/releases/latest/download/agent -o agent\nchmod +x agent && sudo mv agent /usr/local/bin/agent",
  },
];

/* ---------------------------------------------------------- */

export default function LandingPage() {
  return (
    <>
      {/* HERO */}
      <section className="hero" id="top">
        <div className="hero-bg" />
        <div className="hero-glow" />
        <div className="container hero-inner">
          <div>
            <span className="eyebrow">Open source &middot; Apache-2.0</span>
            <h1>
              Every agent.
              <br />
              <span className="hl">One hub.</span>
            </h1>
            <p className="lead">
              Trying OpenClaw, Hermes, Codex, and Claude Code today means four different install
              guides and no common way to run any of them. OpenAgentHub installs, runs, and
              publishes AI agents the way <b>npm handles packages</b> — one manifest, one CLI,
              every agent signed, verified, and sandboxed before it touches your machine.
            </p>
            <div className="hero-cta">
              <a className="btn btn-primary btn-lg" href="#install">
                Install the CLI
              </a>
              <a className="btn btn-lg" href={GITHUB} target="_blank" rel="noreferrer">
                View source
              </a>
            </div>
            <div className="trust-row">
              <span><Check /> Ed25519 signed</span>
              <span><Check /> Sandboxed containers</span>
              <span><Check /> AES-256 secrets vault</span>
              <span><Check /> Apache-2.0</span>
            </div>
          </div>

          <div className="hero-visual">
            <div className="terminal">
              <div className="term-bar">
                <i /><i /><i />
                <span>~ — agent</span>
              </div>
              <pre className="term-body">
                <div className="term-line" style={{ "--d": "0.05s" } as React.CSSProperties}>
                  <span className="pr">$</span> agent install acme/pr-reviewer
                </div>
                <div className="term-line" style={{ "--d": "0.25s" } as React.CSSProperties}>
                  <span className="cm"># sha256 verified &middot; signature ok &middot; sandbox: container</span>
                </div>
                <div className="term-line" style={{ "--d": "0.45s" } as React.CSSProperties}>
                  <span className="ok">&#10003;</span> installed acme/pr-reviewer@1.4.2
                </div>
                <div className="term-line" style={{ "--d": "0.6s" } as React.CSSProperties}> </div>
                <div className="term-line" style={{ "--d": "0.7s" } as React.CSSProperties}>
                  <span className="pr">$</span> printf {`'{"repo":"acme/app","pr":42}'`} | agent run acme/pr-reviewer
                </div>
                <div className="term-line" style={{ "--d": "0.95s" } as React.CSSProperties}>
                  <span className="amb">&rarr;</span> <span className="out">&quot;Looks good &mdash; one nit in docs/changelog.md.&quot;</span>
                </div>
                <div className="term-line" style={{ "--d": "1.1s" } as React.CSSProperties}> </div>
                <div className="term-line" style={{ "--d": "1.25s" } as React.CSSProperties}>
                  <span className="pr">$</span> agent status --all
                </div>
                <div className="term-line" style={{ "--d": "1.45s" } as React.CSSProperties}>
                  <span className="ok">&#9679;</span> <span className="dim">openclaw</span>&nbsp;&nbsp;&nbsp;&nbsp;detected&nbsp;&nbsp;pid 41213
                </div>
                <div className="term-line" style={{ "--d": "1.6s" } as React.CSSProperties}>
                  <span className="ok">&#9679;</span> <span className="dim">hermes</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;running&nbsp;&nbsp;&nbsp;port 8642
                </div>
                <div className="term-line" style={{ "--d": "1.75s" } as React.CSSProperties}>
                  <span className="ok">&#9679;</span> <span className="dim">codex</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;installed&nbsp;v0.9.1
                  <span className="term-cursor" />
                </div>
              </pre>
            </div>
            <ClearanceStamp />
          </div>
        </div>
      </section>

      {/* PROBLEM / SOLUTION */}
      <section className="band raised" id="why">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <span className="eyebrow">The problem</span>
              <h2>Installing agents shouldn&apos;t feel like customs paperwork.</h2>
              <p>
                Every agent ships its own way — a pip install here, a global npm package there, a
                Docker image somewhere else. Multiply that by every agent you want to try.
              </p>
            </div>
          </Reveal>
          <div className="ledger-grid">
            <Reveal delay={0}>
              <div className="ledger-sheet rejected">
                <span className="sheet-stamp">Rejected</span>
                <h3>Without OpenAgentHub</h3>
                <ul className="sheet-list">
                  <li><Cross /> A different install guide for OpenClaw, Hermes, Codex, and Claude Code &mdash; and whatever comes next</li>
                  <li><Cross /> Manual runtime juggling: Python venvs, Node versions, prebuilt binaries</li>
                  <li><Cross /> No standard way to run one &mdash; is it a CLI, a server, or an API you curl?</li>
                  <li><Cross /> Installing someone else&apos;s code means trusting it blindly &mdash; no signature, no scan</li>
                  <li><Cross /> Secrets scattered across .env files and shell profiles</li>
                </ul>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <div className="ledger-sheet cleared">
                <span className="sheet-stamp">Cleared</span>
                <h3>With OpenAgentHub</h3>
                <ul className="sheet-list">
                  <li><Check /> One CLI installs and runs every agent, whatever language it&apos;s written in</li>
                  <li><Check /> One manifest (agent.yaml) declares the contract &mdash; no framework lock-in</li>
                  <li><Check /> Every agent picks an interface: one-shot CLI, MCP server, or HTTP endpoint</li>
                  <li><Check /> Every package is Ed25519-signed and re-verified before it ever runs</li>
                  <li><Check /> Secrets live once, encrypted, in a machine-keyed vault</li>
                </ul>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* PROOF STRIP */}
      <section className="band" style={{ paddingTop: 56, paddingBottom: 56 }}>
        <div className="container">
          <Reveal>
            <div className="proof-strip">
              <span><b>78</b> automated tests</span>
              <span><b>3</b> reference agents</span>
              <span><b>Apache-2.0</b> licensed</span>
              <span><b>100%</b> self-hostable</span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FEATURES */}
      <section className="band raised" id="features">
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">What&apos;s inside</span>
              <h2>The full manifest.</h2>
              <p>Eight things OpenAgentHub handles so every agent behaves the same way on your machine.</p>
            </div>
          </Reveal>
          <div className="manifest-list">
            {FEATURES.map((f, i) => (
              <Reveal key={f.code} delay={Math.min(i, 4) * 60}>
                <div className="manifest-row">
                  <span className="row-code">{f.code}</span>
                  <span className="row-icon"><Icon d={f.icon} /></span>
                  <div className="row-body">
                    <h3>{f.title}</h3>
                    <p>{f.body}</p>
                    {f.extra}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* LIFECYCLE / HOW IT WORKS */}
      <section className="band" id="how">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <span className="eyebrow">How it works</span>
              <h2>From written to running &mdash; verified at every step.</h2>
              <p>The same five-stage pipeline handles every agent, no matter who wrote it.</p>
            </div>
          </Reveal>
          <div className="lifecycle-track">
            {LIFECYCLE.map((s, i) => (
              <Reveal key={s.n} delay={i * 90}>
                <div className="life-step">
                  <span className="life-num">{s.n}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  <code>{s.code}</code>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* MANIFEST SHOWCASE */}
      <section className="band raised">
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">The manifest</span>
              <h2>One file is the entire contract.</h2>
              <p>agent.yaml is validated strictly against a JSON Schema &mdash; no undeclared fields, no ambiguity about what an agent can do.</p>
            </div>
          </Reveal>
          <div className="manifest-code-grid">
            <Reveal>
              <ul className="rules-list">
                <li><Check className="tick" /><span><b>permissions</b> is an array &mdash; <b>&quot;none&quot;</b> alone is the default.</span></li>
                <li><Check className="tick" /><span><b>secrets</b> holds env-var names only; values live in the vault, never the manifest.</span></li>
                <li><Check className="tick" /><span><b>interfaces</b> needs at least one of cli, mcp, or http.</span></li>
                <li><Check className="tick" /><span><b>framework</b> is informational &mdash; the registry only stores the name.</span></li>
                <li><Check className="tick" /><span><b>runtime.sandbox</b> can force auto, container, or isolated-process.</span></li>
              </ul>
            </Reveal>
            <Reveal delay={100}>
              <CodeBlock
                label="agent.yaml"
                raw={`manifestVersion: 1
name: acme/pr-reviewer            # namespace/name, lowercase slug
version: 1.0.0                    # SemVer
author: acme
description: Reviews GitHub pull requests
license: MIT

runtime:
  language: python                # python | node | go | rust | other
  python: ">=3.10"
  sandbox: auto                   # auto | container | isolated-process

models:
  supported: [openai, anthropic, deepseek, ollama, local]

interfaces:                       # at least one required
  cli:
    command: "python main.py"
    input: json
    output: json
  mcp:
    entrypoint: "python mcp_server.py"
    transport: stdio

permissions: [network]            # filesystem | network | github | ...
secrets: [GITHUB_TOKEN]           # env-var NAMES only, never values
tags: [github, code-review]`}
              >
                <span className="k">manifestVersion</span>: <span className="v">1</span>{"\n"}
                <span className="k">name</span>: <span className="v">acme/pr-reviewer</span>            <span className="cm"># namespace/name, lowercase slug</span>{"\n"}
                <span className="k">version</span>: <span className="v">1.0.0</span>                    <span className="cm"># SemVer</span>{"\n"}
                <span className="k">author</span>: <span className="v">acme</span>{"\n"}
                <span className="k">description</span>: <span className="v">Reviews GitHub pull requests</span>{"\n"}
                <span className="k">license</span>: <span className="v">MIT</span>{"\n\n"}
                <span className="k">runtime</span>:{"\n"}
                {"  "}<span className="k">language</span>: <span className="v">python</span>                <span className="cm"># python | node | go | rust | other</span>{"\n"}
                {"  "}<span className="k">python</span>: <span className="v">&quot;&gt;=3.10&quot;</span>{"\n"}
                {"  "}<span className="k">sandbox</span>: <span className="v">auto</span>                   <span className="cm"># auto | container | isolated-process</span>{"\n\n"}
                <span className="k">models</span>:{"\n"}
                {"  "}<span className="k">supported</span>: <span className="v">[openai, anthropic, deepseek, ollama, local]</span>{"\n\n"}
                <span className="k">interfaces</span>:                       <span className="cm"># at least one required</span>{"\n"}
                {"  "}<span className="k">cli</span>:{"\n"}
                {"    "}<span className="k">command</span>: <span className="v">&quot;python main.py&quot;</span>{"\n"}
                {"    "}<span className="k">input</span>: <span className="v">json</span>{"\n"}
                {"    "}<span className="k">output</span>: <span className="v">json</span>{"\n"}
                {"  "}<span className="k">mcp</span>:{"\n"}
                {"    "}<span className="k">entrypoint</span>: <span className="v">&quot;python mcp_server.py&quot;</span>{"\n"}
                {"    "}<span className="k">transport</span>: <span className="v">stdio</span>{"\n\n"}
                <span className="k">permissions</span>: <span className="v">[network]</span>            <span className="cm"># filesystem | network | github | ...</span>{"\n"}
                <span className="k">secrets</span>: <span className="v">[GITHUB_TOKEN]</span>           <span className="cm"># env-var NAMES only, never values</span>{"\n"}
                <span className="k">tags</span>: <span className="v">[github, code-review]</span>
              </CodeBlock>
            </Reveal>
          </div>
        </div>
      </section>

      {/* SECURITY MODEL */}
      <section className="band" id="security">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <span className="eyebrow clear">Security model</span>
              <h2>Every package clears the same checkpoint.</h2>
              <p>Nothing skips the line &mdash; not even agents you wrote yourself.</p>
            </div>
          </Reveal>
          <div className="security-grid">
            {SECURITY.map((s, i) => (
              <Reveal key={s.title} delay={i * 80}>
                <div className="security-card">
                  <span className="sec-badge"><Check /></span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CLI REFERENCE */}
      <section className="band raised">
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">CLI reference</span>
              <h2>Everything through one binary.</h2>
              <p>agent wraps the entire lifecycle &mdash; scaffold, validate, publish, install, run, and inspect.</p>
            </div>
          </Reveal>
          <Reveal>
            <div className="cli-grid">
              {CLI_ROWS.map(([cmd, desc]) => (
                <div className="cli-row" key={cmd}>
                  <code>{cmd}</code>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal>
            <a className="cli-more" href={`${GITHUB}#cli-reference-agent`} target="_blank" rel="noreferrer">
              Full CLI reference on GitHub &rarr;
            </a>
          </Reveal>
        </div>
      </section>

      {/* INSTALL */}
      <section className="band" id="install">
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">Install</span>
              <h2>Pick a channel.</h2>
              <p>After installing, the agent CLI is available everywhere on your machine.</p>
            </div>
          </Reveal>
          <div className="install-grid">
            {METHODS.map((m, i) => (
              <Reveal key={m.title} delay={i * 90}>
                <div className="method-card">
                  <h3><span className="m-tag">{m.tag}</span>{m.title}</h3>
                  <p>{m.body}</p>
                  <CodeBlock label={m.title.toLowerCase()} raw={m.code}>{m.code}</CodeBlock>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal>
            <CodeBlock
              label="quickstart"
              raw={`# authenticate
agent login --token <github-token>

# find an agent
agent search pr-reviewer

# install, then run it
agent install acme/pr-reviewer
echo '{"repo":"acme/app","pr":42}' | agent run acme/pr-reviewer`}
            >
              <span className="cm"># authenticate</span>{"\n"}
              <span className="st">$</span> agent login --token &lt;github-token&gt;{"\n\n"}
              <span className="cm"># find an agent</span>{"\n"}
              <span className="st">$</span> agent search pr-reviewer{"\n"}
              <span className="v">acme/pr-reviewer</span>  v1.4.2  trusted  1.2k downloads{"\n\n"}
              <span className="cm"># install, then run it</span>{"\n"}
              <span className="st">$</span> agent install acme/pr-reviewer{"\n"}
              <span className="st">$</span> echo {`'{"repo":"acme/app","pr":42}'`} | agent run acme/pr-reviewer{"\n"}
              <span className="k">&rarr;</span> &quot;Approved &mdash; ready to merge.&quot;
            </CodeBlock>
          </Reveal>
        </div>
      </section>

      {/* CTA BAND */}
      <section className="cta-band">
        <div className="cta-glow" />
        <div className="container">
          <Reveal>
            <h2>Every agent. One hub.</h2>
            <p>Signed, sandboxed, and scriptable from the first install.</p>
            <div className="hero-cta">
              <a className="btn btn-primary btn-lg" href="#install">
                Install OpenAgentHub
              </a>
              <a className="btn btn-lg" href={GITHUB} target="_blank" rel="noreferrer">
                Star on GitHub
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
