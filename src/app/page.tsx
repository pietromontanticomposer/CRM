import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden px-6 pb-16 pt-14 sm:px-10">
      <div className="pointer-events-none fixed right-4 top-4 z-50 sm:right-8 sm:top-6">
        <div className="pointer-events-auto">
          <LogoutButton />
        </div>
      </div>
      <main className="mx-auto grid w-full max-w-5xl gap-8">
        <header className="text-center sm:text-left">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
            Workspace
          </p>
          <h1 className="mt-2 text-4xl font-semibold text-[var(--ink)]">
            Scegli dove entrare
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">
            CRM con sezioni Cinema e Live Music.
          </p>
        </header>

        <section className="grid gap-5 md:grid-cols-1">
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
        </section>
      </main>
    </div>
  );
}
