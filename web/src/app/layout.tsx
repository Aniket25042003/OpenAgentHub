import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "OpenAgentHub",
  description: "The universal package manager & registry for AI agents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <header className="site">
          <a className="logo" href="/">
            Open<span>Agent</span>Hub
          </a>
          <span className="tagline">the universal package manager for AI agents</span>
          <SiteNav />
        </header>
        {children}
      </body>
    </html>
  );
}
