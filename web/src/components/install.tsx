"use client";

import { useState } from "react";

export function InstallCommand({ spec }: { spec: string }) {
  const [copied, setCopied] = useState(false);
  const install = `agent install ${spec}`;
  const run = `echo '{"prompt": "..."}' | agent run ${spec} --model openai`;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div>
      <div className="row">
        <code className="code" style={{ flex: 1 }}>
          {install}
        </code>
        <button className="btn" onClick={() => copy(install)}>
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <code className="code" style={{ flex: 1 }}>
          {run}
        </code>
        <button className="btn" onClick={() => copy(run)}>
          copy run
        </button>
      </div>
    </div>
  );
}
