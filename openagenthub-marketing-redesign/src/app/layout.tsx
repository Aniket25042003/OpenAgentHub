import type { Metadata } from "next";
import { Big_Shoulders, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import MobileNav from "@/components/MobileNav";
import GithubStars from "@/components/GithubStars";

const display = Big_Shoulders({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  variable: "--font-display",
});
const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "OpenAgentHub — every agent, one hub",
  description:
    "OpenAgentHub is the open source package manager and registry for AI agents. Install, run, and publish agents like software packages — signed, verified, and sandboxed by default.",
};

const GITHUB = "https://github.com/Aniket25042003/OpenAgentHub";
const REPO = "Aniket25042003/OpenAgentHub";

function LogoMark() {
  return (
    <span className="logo-mark">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="5" r="2.4" fill="#0a0c10" />
        <circle cx="5" cy="18" r="2.4" fill="#0a0c10" />
        <circle cx="19" cy="18" r="2.4" fill="#0a0c10" />
        <path d="M12 7.4 6.4 16.2M12 7.4l5.6 8.8M6.9 18h10.2" stroke="#0a0c10" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <header className="site">
          <div className="container nav-wrap">
            <a className="logo" href="#top">
              <LogoMark />
              <span className="logo-word">
                Open<em>Agent</em>Hub
              </span>
            </a>
            <nav className="nav-links">
              <a href="#features">Features</a>
              <a href="#security">Security</a>
              <a href="#how">How it works</a>
              <a href="#install">Install</a>
            </nav>
            <div className="nav-actions">
              <GithubStars repo={REPO} />
              <a className="btn" href={GITHUB} target="_blank" rel="noreferrer">
                GitHub
              </a>
              <a className="btn btn-primary" href="#install">
                Get started
              </a>
            </div>
            <MobileNav />
          </div>
        </header>

        {children}

        <footer className="site">
          <div className="container">
            <div className="footer-grid">
              <div className="footer-brand">
                <a className="logo" href="#top">
                  <LogoMark />
                  <span className="logo-word">
                    Open<em>Agent</em>Hub
                  </span>
                </a>
                <p>
                  The open source package manager &amp; registry for AI agents. Every install
                  signed, scanned, and sandboxed — like cargo through a checkpoint.
                </p>
              </div>
              <div className="footer-col">
                <h4>Product</h4>
                <nav>
                  <a href="#features">Features</a>
                  <a href="#security">Security model</a>
                  <a href="#how">How it works</a>
                  <a href="#install">Install</a>
                </nav>
              </div>
              <div className="footer-col">
                <h4>Resources</h4>
                <nav>
                  <a href={GITHUB} target="_blank" rel="noreferrer">Source code</a>
                  <a href={`${GITHUB}#readme`} target="_blank" rel="noreferrer">Documentation</a>
                  <a href={`${GITHUB}/tree/main/docs`} target="_blank" rel="noreferrer">Architecture docs</a>
                  <a href={`${GITHUB}/tree/main/specs`} target="_blank" rel="noreferrer">Manifest spec</a>
                </nav>
              </div>
              <div className="footer-col">
                <h4>Legal</h4>
                <nav>
                  <a href={`${GITHUB}/blob/main/LICENSE`} target="_blank" rel="noreferrer">Apache-2.0 license</a>
                  <a href={`${GITHUB}/security`} target="_blank" rel="noreferrer">Security policy</a>
                </nav>
              </div>
            </div>
            <div className="footer-bottom">
              <span>© {new Date().getFullYear()} OpenAgentHub — open source under Apache-2.0</span>
              <span>Signed · Sandboxed · Self-hostable</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
