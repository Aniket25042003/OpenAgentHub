"use client";

import { useEffect, useState } from "react";

export default function GithubStars({ repo }: { repo: string }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`https://api.github.com/repos/${repo}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.stargazers_count === "number") {
          setCount(data.stargazers_count);
        }
      })
      .catch(() => {
        /* silently keep placeholder */
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  return (
    <a className="gh-stars" href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2Z" /></svg>
      {count !== null ? count.toLocaleString() : "Star"}
    </a>
  );
}
