"use client";

import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Dashboard" },
  { href: "/browse", label: "Browse" },
];

export function SiteNav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <a key={t.href} href={t.href} className={path === t.href ? "active" : ""}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
