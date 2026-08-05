import { ReactNode } from "react";
import CopyButton from "./CopyButton";

export default function CodeBlock({
  label,
  raw,
  children,
}: {
  label: string;
  raw: string;
  children: ReactNode;
}) {
  return (
    <div className="code-block">
      <div className="cb-bar">
        <span className="cb-label">{label}</span>
        <CopyButton text={raw} />
      </div>
      <pre>{children}</pre>
    </div>
  );
}
