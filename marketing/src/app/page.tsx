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
    code: "01",
    title: "One place for every agent",
    body: "See all your AI agents in a single, simple dashboard — no matter where each one came from or what it does.",
    icon: "M3 12h4l3 8 4-16 3 8h4",
  },
  {
    code: "02",
    title: "One simple file defines an agent",
    body: "Every agent is described once in a plain, easy-to-read file. It works with Python, JavaScript, and most other languages.",
    icon: "M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 5h8M8 12h8M8 16h5",
  },
  {
    code: "03",
    title: "Run agents the way you want",
    body: "Use an agent as a quick one-shot command, a long-running helper, or an online service — the setup is the same either way.",
    icon: "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M8 21H5a2 2 0 0 1-2-2v-3m18 0v3a2 2 0 0 1-2 2h-3",
  },
  {
    code: "04",
    title: "Verified before install",
    body: "Every package is signed by its author and double-checked automatically. If anything has been changed, it simply won't install.",
    icon: "M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4Zm-2 12 2-2 4 4 4-6",
  },
  {
    code: "05",
    title: "Safe by default",
    body: "Agents from the internet run inside a locked-down sandbox — no access to your files or network unless you say so.",
    icon: "M12 2l9 4v6c0 5.5-3.8 9.4-9 12-5.2-2.6-9-6.5-9-12V6l9-4Zm-3 12 2 2 5-5",
  },
  {
    code: "06",
    title: "Your secrets stay private",
    body: "API keys and passwords are encrypted and kept only on your machine. Agents only see them when they need to.",
    icon: "M8 11V7a4 4 0 0 1 8 0v4M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z",
  },
  {
    code: "07",
    title: "You stay in control",
    body: "Grant each agent only the access it needs — just like app permissions on your phone. You approve everything.",
    icon: "M4 5h16M4 12h16M4 19h7",
  },
  {
    code: "08",
    title: "A registry you can trust",
    body: "Every agent is scanned for problems before it's shared with others, so you can install with confidence.",
    icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm10 17-5.6-5.6",
  },
];

const STEPS = [
  { n: "01", title: "Find", body: "Search the registry for the agent you need." },
  { n: "02", title: "Install", body: "One simple command. It's verified and checked automatically." },
  { n: "03", title: "Run", body: "Give it your task, get your answer — the same easy way every time." },
];

const SECURITY = [
  {
    title: "Checked before it runs",
    body: "Every package is signed by its author and verified automatically before it's installed on your machine.",
  },
  {
    title: "Unpacked carefully",
    body: "Files are unpacked safely, with no dangerous paths or tricks allowed.",
  },
  {
    title: "Sandboxed by default",
    body: "Untrusted agents run in a locked-down container with no access to your computer — unless you allow it.",
  },
  {
    title: "Secrets stay encrypted",
    body: "Your keys and passwords are encrypted and never shown in a listing or a log.",
  },
];

const METHODS = [
  { tag: "npm", title: "npm", body: "Install the CLI with npm — works on any computer with Node.js.", code: "npm install -g @openagenthub/cli" },
  { tag: "brew", title: "Homebrew", body: "The easiest way to install and update on macOS.", code: "brew install openagenthub/tap/agent", upcoming: true },
  {
    tag: "bin",
    title: "Binary",
    body: "Download the ready-to-run file for your platform.",
    code: "curl -fsSL https://github.com/Aniket25042003/OpenAgentHub/releases/latest/download/agent -o agent\nchmod +x agent && sudo mv agent /usr/local/bin/agent",
    upcoming: true,
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
            <span className="eyebrow">Open source &middot; free to use</span>
            <h1>
              Every agent.
              <br />
              <span className="hl">One hub.</span>
            </h1>
            <p className="lead">
              AI agents are everywhere these days — but installing them can be a mess. OpenAgentHub makes it
              simple: <b>find</b> an agent, <b>install</b> it in one command, and <b>run</b> it safely. All your
              agents, in one place.
            </p>
            <div className="hero-cta">
              <a className="btn btn-primary btn-lg" href="#install">
                Get started
              </a>
              <a className="btn btn-lg" href="#how">
                See how it works
              </a>
            </div>
            <div className="trust-row">
              <span><Check /> Verified before install</span>
              <span><Check /> Runs in a safe sandbox</span>
              <span><Check /> Your secrets stay private</span>
              <span><Check /> Free &amp; open source</span>
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
                  <span className="pr">$</span> openagenthub install acme/pr-reviewer
                </div>
                <div className="term-line" style={{ "--d": "0.25s" } as React.CSSProperties}>
                  <span className="cm"># checked &middot; verified &middot; sandboxed</span>
                </div>
                <div className="term-line" style={{ "--d": "0.45s" } as React.CSSProperties}>
                  <span className="ok">&#10003;</span> installed acme/pr-reviewer@1.4.2
                </div>
                <div className="term-line" style={{ "--d": "0.6s" } as React.CSSProperties}> </div>
                <div className="term-line" style={{ "--d": "0.7s" } as React.CSSProperties}>
                  <span className="pr">$</span> openagenthub run acme/pr-reviewer
                </div>
                <div className="term-line" style={{ "--d": "0.95s" } as React.CSSProperties}>
                  <span className="amb">&rarr;</span> <span className="out">&quot;Looks good — one nit in docs/changelog.md.&quot;</span>
                </div>
                <div className="term-line" style={{ "--d": "1.1s" } as React.CSSProperties}> </div>
                <div className="term-line" style={{ "--d": "1.25s" } as React.CSSProperties}>
                  <span className="pr">$</span> openagenthub status
                </div>
                <div className="term-line" style={{ "--d": "1.45s" } as React.CSSProperties}>
                  <span className="ok">&#9679;</span> <span className="dim">OpenClaw</span>&nbsp;&nbsp;&nbsp;&nbsp;running
                </div>
                <div className="term-line" style={{ "--d": "1.6s" } as React.CSSProperties}>
                  <span className="ok">&#9679;</span> <span className="dim">Hermes</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;running
                </div>
                <div className="term-line" style={{ "--d": "1.75s" } as React.CSSProperties}>
                  <span className="ok">&#9679;</span> <span className="dim">Codex</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;installed
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
              <h2>Installing AI agents shouldn&apos;t be so complicated.</h2>
              <p>
                Every agent has its own way to install and run — different steps, different tools, no single
                place to manage them all. OpenAgentHub fixes that.
              </p>
            </div>
          </Reveal>
          <div className="ledger-grid">
            <Reveal delay={0}>
              <div className="ledger-sheet rejected">
                <span className="sheet-stamp">Rejected</span>
                <h3>Without OpenAgentHub</h3>
                <ul className="sheet-list">
                  <li><Cross /> A different install guide for every agent — and the next one will be different too</li>
                  <li><Cross /> Manual setup: virtual environments, version conflicts, missing files</li>
                  <li><Cross /> No shared way to run an agent — is it a command, a service, or an app?</li>
                  <li><Cross /> Installing code from the internet means trusting it blindly</li>
                  <li><Cross /> API keys and tokens scattered across files and profiles</li>
                </ul>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <div className="ledger-sheet cleared">
                <span className="sheet-stamp">Cleared</span>
                <h3>With OpenAgentHub</h3>
                <ul className="sheet-list">
                  <li><Check /> One simple command installs and runs any agent</li>
                  <li><Check /> Agents are described once in a plain, simple file — no lock-in</li>
                  <li><Check /> Every openagenthub runs the same way: one command, in and out</li>
                  <li><Check /> Every package is checked and verified before it ever runs</li>
                  <li><Check /> Secrets are stored once, encrypted, on your machine</li>
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
              <span><b>Open source</b> &amp; free</span>
              <span><b>Any</b> AI agent</span>
              <span><b>100%</b> runs on your machine</span>
              <span><b>Private</b> by default</span>
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
              <h2>Everything you need, nothing to worry about.</h2>
              <p>Eight things OpenAgentHub handles for you, so every agent is simple and safe on your machine.</p>
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
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="band" id="how">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <span className="eyebrow">How it works</span>
              <h2>Three simple steps.</h2>
              <p>No complicated setup, no long guides — just find, install, and run.</p>
            </div>
          </Reveal>
          <div className="lifecycle-track">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 90}>
                <div className="life-step">
                  <span className="life-num">{s.n}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* SECURITY */}
      <section className="band raised" id="security">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <span className="eyebrow clear">Safety first</span>
              <h2>Safe to try, safe to run.</h2>
              <p>Every package goes through the same safety checks before it touches your machine.</p>
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

      {/* INSTALL */}
      <section className="band" id="install">
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">Install</span>
              <h2>Ready in minutes.</h2>
              <p>Pick the way that works for you. After that, the agent CLI is available everywhere on your computer.</p>
            </div>
          </Reveal>
          <div className="install-grid">
            {METHODS.map((m, i) => (
              <Reveal key={m.title} delay={i * 90}>
                <div className="method-card">
                  <h3><span className="m-tag">{m.tag}</span>{m.title}</h3>
                  <p>{m.body}</p>
                  <CodeBlock label={m.title.toLowerCase()} raw={m.code}>{m.code}</CodeBlock>
                  {m.upcoming ? <p className="m-upcoming">Coming soon — not yet published</p> : null}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA BAND */}
      <section className="cta-band">
        <div className="cta-glow" />
        <div className="container">
          <Reveal>
            <h2>Every agent. One hub.</h2>
            <p>Simple to install. Safe to run. Yours to keep.</p>
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
