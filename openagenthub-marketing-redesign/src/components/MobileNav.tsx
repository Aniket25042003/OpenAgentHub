"use client";

import { useState } from "react";

const GITHUB = "https://github.com/Aniket25042003/OpenAgentHub";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#security", label: "Security" },
  { href: "#how", label: "How it works" },
  { href: "#install", label: "Install" },
];

export default function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="mobile-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        type="button"
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
        )}
      </button>
      <div className={`mobile-panel${open ? " open" : ""}`}>
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
            {l.label}
          </a>
        ))}
        <div className="mobile-cta">
          <a className="btn" href={GITHUB} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            GitHub
          </a>
          <a className="btn btn-primary" href="#install" onClick={() => setOpen(false)}>
            Get started
          </a>
        </div>
      </div>
    </>
  );
}
