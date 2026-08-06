"use client";

import { useCallback, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function DeviceBody() {
  const search = useSearchParams();
  const userCode = search.get("user_code");
  const [approving, setApproving] = useState(false);
  const [result, setResult] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const approve = useCallback(async () => {
    if (!userCode) return;
    setApproving(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/device/approve?user_code=${encodeURIComponent(userCode)}`, {
        method: "POST",
        cache: "no-store",
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && body.ok) {
        setResult("Device authorized. Your terminal will finish signing in momentarily.");
      } else {
        setError(body.error ?? `approval failed (${res.status})`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApproving(false);
    }
  }, [userCode]);

  return (
    <main>
      <div className="hero">
        <span className="eyebrow">Account</span>
        <h1>Authorize a device</h1>
        <p>
          A CLI device is waiting for your approval. Enter the 6-character code shown in the terminal, or it is
          already filled in from the link you opened.
        </p>

        <form
          className="device-form"
          onSubmit={(e) => {
            e.preventDefault();
            const input = new FormData(e.currentTarget).get("code") as string;
            window.location.href = `/device?user_code=${encodeURIComponent(input.trim())}`;
          }}
        >
          <label htmlFor="code">6-character code</label>
          <input id="code" name="code" required maxLength={6} defaultValue={userCode ?? ""} style={{ textTransform: "uppercase", width: 180 }} />
          <div className="row" style={{ marginTop: 12 }}>
            <button type="submit" className="btn btn-primary">
              Continue
            </button>
          </div>
        </form>

        {userCode && (
          <div style={{ marginTop: 16 }}>
            <p className="stack">
              Code <strong>{userCode.toUpperCase()}</strong>
            </p>
            {result && <p className="muted">{result}</p>}
            {error && <p className="pill bad">{error}</p>}
            <div className="row" style={{ marginTop: 12 }}>
              {!result && (
                <button type="button" className="btn btn-primary" onClick={approve} disabled={approving}>
                  {approving ? "Authorizing…" : "Approve this device"}
                </button>
              )}
            </div>
            {!result && (
              <p className="muted" style={{ marginTop: 12 }}>
                Not signed in?{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    const origin = window.location.origin;
                    window.location.href = `${process.env.NEXT_PUBLIC_REGISTRY_URL ?? "http://localhost:8000"}/auth/github/start?redirect_uri=${encodeURIComponent(origin + "/auth/callback")}`;
                  }}
                >
                  Sign in with GitHub
                </a>
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function AuthorizeDevice() {
  return (
    <Suspense>
      <DeviceBody />
    </Suspense>
  );
}