import Link from "next/link";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden px-6 pb-16 pt-14 sm:px-10">
      <main className="mx-auto grid w-full max-w-5xl gap-8">
        <header className="text-center sm:text-left">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
            Workspace
          </p>
          <h1 className="mt-2 text-4xl font-semibold text-[var(--ink)]">
            Scegli dove entrare
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">
            Due moduli separati: CRM per i contatti e TODO per le attivita.
          </p>
        </header>

        <section className="grid gap-5 md:grid-cols-2">
          <Link
            href="/crm"
            className="group rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-7 shadow-lg transition hover:-translate-y-1 hover:border-[var(--accent)]"
          >
            <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
              Modulo 01
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-[var(--ink)]">
              CRM
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Contatti, email, follow-up e stato pipeline.
            </p>
            <p className="mt-6 text-sm font-semibold text-[var(--accent)] transition group-hover:translate-x-0.5">
              Apri CRM →
            </p>
          </Link>

          <Link
            href="/todo"
            className="group rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-7 shadow-lg transition hover:-translate-y-1 hover:border-emerald-400/50"
          >
            <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
              Modulo 02
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-[var(--ink)]">
              TODO
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Lista task semplice, chiara e indipendente dal CRM.
            </p>
            <p className="mt-6 text-sm font-semibold text-emerald-300 transition group-hover:translate-x-0.5">
              Apri TODO →
            </p>
          </Link>
        </section>
      </main>
    </div>
  );
}
