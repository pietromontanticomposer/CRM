"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type LoginFormProps = {
  nextPath?: string;
};

type LoginResponse = {
  ok?: boolean;
  redirectTo?: string;
  error?: string;
};

export default function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        next: nextPath,
      }),
    }).catch(() => null);

    if (!response) {
      setError("Il server non risponde.");
      setLoading(false);
      return;
    }

    const payload = (await response.json().catch(() => null)) as
      | LoginResponse
      | null;

    if (!response.ok) {
      setError(payload?.error || "Login fallito.");
      setLoading(false);
      return;
    }

    router.replace(payload?.redirectTo || "/crm");
    router.refresh();
  };

  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_30px_80px_-50px_rgba(15,23,42,0.85)] sm:p-7">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
          Login
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-[var(--ink)]">
          Accedi al workspace
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
        <div className="grid gap-2">
          <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Email
          </label>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="tuo account"
          />
        </div>

        <div className="grid gap-2">
          <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Password
          </label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="password"
          />
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
        >
          {loading ? "Accesso..." : "Entra"}
        </button>
      </form>
    </section>
  );
}
