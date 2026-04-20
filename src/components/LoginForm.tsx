"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type LoginFormProps = {
  nextPath?: string;
  resetToken?: string;
  verified?: string;
};

type LoginResponse = {
  ok?: boolean;
  redirectTo?: string;
  message?: string;
  error?: string;
};

type AuthMode = "login" | "register" | "forgot" | "reset";

export default function LoginForm({
  nextPath,
  resetToken,
  verified,
}: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<AuthMode>(resetToken ? "reset" : "login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    verified === "0" ? "Link verifica non valido o scaduto." : null
  );
  const [message, setMessage] = useState<string | null>(null);

  const endpoint =
    mode === "register"
      ? "/api/auth/register"
      : mode === "forgot"
        ? "/api/auth/forgot-password"
        : mode === "reset"
          ? "/api/auth/reset-password"
          : "/api/auth/login";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        next: nextPath,
        token: resetToken,
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
      setError(payload?.error || "Operazione fallita.");
      setLoading(false);
      return;
    }

    if (payload?.redirectTo) {
      router.replace(payload.redirectTo);
      router.refresh();
      return;
    }

    setMessage(payload?.message || "Fatto. Controlla la tua email.");
    setLoading(false);
  };

  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_30px_80px_-50px_rgba(15,23,42,0.85)] sm:p-7">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
          {mode === "register"
            ? "Nuovo account"
            : mode === "forgot"
              ? "Reset password"
              : mode === "reset"
                ? "Nuova password"
                : "Login"}
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-[var(--ink)]">
          {mode === "register"
            ? "Crea il tuo workspace"
            : mode === "forgot"
              ? "Ricevi il link"
              : mode === "reset"
                ? "Imposta la password"
                : "Accedi al workspace"}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
        {mode !== "reset" && (
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
        )}

        {mode !== "forgot" && (
          <div className="grid gap-2">
            <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Password
            </label>
            <input
              type="password"
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                mode === "register" ? "minimo 8 caratteri" : "password"
              }
            />
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
        >
          {loading
            ? mode === "register"
              ? "Creo..."
              : mode === "forgot"
                ? "Invio..."
                : mode === "reset"
                  ? "Salvo..."
              : "Accesso..."
            : mode === "register"
              ? "Crea account"
              : mode === "forgot"
                ? "Invia link"
                : mode === "reset"
                  ? "Salva password"
              : "Entra"}
        </button>
      </form>
      <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold text-[var(--accent)]">
        {mode !== "login" && (
          <button type="button" onClick={() => setMode("login")}>
            Ho gia un account
          </button>
        )}
        {mode !== "register" && (
          <button type="button" onClick={() => setMode("register")}>
            Crea account
          </button>
        )}
        {mode !== "forgot" && mode !== "reset" && (
          <button type="button" onClick={() => setMode("forgot")}>
            Password dimenticata
          </button>
        )}
      </div>
    </section>
  );
}
