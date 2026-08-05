import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Signed in · OpenAgentHub",
};

export default function AuthCallbackPage() {
  return (
    <main>
      <div className="hero">
        <span className="eyebrow">Account</span>
        <h1>You are signed in</h1>
        <p>The registry set a secure session cookie on this browser.</p>
        <div className="row" style={{ marginTop: 16 }}>
          <a className="btn btn-primary" href="/account">
            Open your account
          </a>
        </div>
      </div>
    </main>
  );
}