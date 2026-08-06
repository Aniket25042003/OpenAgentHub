"use client";

import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Dashboard" },
  { href: "/browse", label: "Browse" },
  { href: "/publisher", label: "Publisher" },
  { href: "/account", label: "Account" },
];

export function SiteNav() {
  const path = usePathname();
  return (
    <nav className="nav-links">
      {TABS.map((t) => (
        <a key={t.href} href={t.href} className={path === t.href ? "active" : ""}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
