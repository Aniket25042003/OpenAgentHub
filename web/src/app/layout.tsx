import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenAgentHub",
  description: "The universal package manager & registry for AI agents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <a className="logo" href="/">
            Open<span>Agent</span>Hub
          </a>
          <span className="tagline">the universal package manager for AI agents</span>
        </header>
        {children}
      </body>
    </html>
  );
}
