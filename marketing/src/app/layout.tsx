import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "OpenAgentHub — The npm for AI agents",
  description:
    "Publish, discover, install, and run AI agents like software packages. Signed, verified, and sandboxed by default.",
};

const GITHUB = "https://github.com/Aniket25042003/OpenAgentHub";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <header className="site">
          <div className="container" style={{ display: "flex", alignItems: "center", gap: 24, padding: 0, flex: 1 }}>
            <a className="logo" href="#top">
              Open<span>Agent</span>Hub
            </a>
            <nav>
              <a href="#features">Features</a>
              <a href="#how">How it works</a>
              <a href="#install">Install</a>
            </nav>
            <div className="actions">
              <a className="btn" href={GITHUB} target="_blank" rel="noreferrer">
                GitHub
              </a>
              <a className="btn btn-primary" href="#install">
                Get started
              </a>
            </div>
          </div>
        </header>
        {children}
        <footer className="site">
          <div className="container">
            <div className="grid">
              <div className="brand">
                <a className="logo" href="#top">
                  Open<span>Agent</span>Hub
                </a>
                <p>The universal package manager &amp; registry for AI agents — the npm for agents.</p>
              </div>
              <div>
                <h4>Product</h4>
                <nav>
                  <a href="#features">Features</a>
                  <a href="#how">How it works</a>
                  <a href="#install">Install</a>
                </nav>
              </div>
              <div>
                <h4>Resources</h4>
                <nav>
                  <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
                  <a href={`${GITHUB}#readme`} target="_blank" rel="noreferrer">Documentation</a>
                  <a href={`${GITHUB}/tree/main/docs`} target="_blank" rel="noreferrer">Architecture docs</a>
                </nav>
              </div>
              <div>
                <h4>Legal</h4>
                <nav>
                  <a href={`${GITHUB}/blob/main/LICENSE`} target="_blank" rel="noreferrer">License</a>
                  <a href={GITHUB} target="_blank" rel="noreferrer">Security</a>
                </nav>
              </div>
            </div>
            <div className="bottom">
              <span>© {new Date().getFullYear()} OpenAgentHub</span>
              <span>Signed · Sandboxed · Open source</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
