import type { Metadata } from "next";
import { Big_Shoulders, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

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
  title: "OpenAgentHub",
  description: "The universal package manager & registry for AI agents",
};

const GITHUB = "https://github.com/Aniket25042003/OpenAgentHub";

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
            <a className="logo" href="/">
              <LogoMark />
              <span className="logo-word">
                Open<em>Agent</em>Hub
              </span>
            </a>
            <span className="tagline">the universal package manager for AI agents</span>
            <SiteNav />
            <a className="btn btn-primary" href={GITHUB} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
