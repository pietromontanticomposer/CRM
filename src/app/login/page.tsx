import LoginForm from "@/components/LoginForm";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  return (
    <div className="min-h-screen px-6 py-14 sm:px-10">
      <main className="mx-auto grid min-h-[calc(100vh-7rem)] w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.2fr_420px]">
        <section className="space-y-6">
          <p className="text-xs uppercase tracking-[0.35em] text-[var(--muted)]">
            Workspace Privato
          </p>
          <h1 className="max-w-2xl text-4xl font-semibold text-[var(--ink)] sm:text-5xl">
            CRM, TODO e calendario accessibili solo dopo login.
          </h1>
          <p className="max-w-2xl text-base leading-7 text-[var(--muted)]">
            L&apos;accesso pubblico e&apos; stato chiuso. Per entrare devi usare
            l&apos;account configurato sull&apos;app.
          </p>
          <div className="grid gap-3 text-sm text-[var(--muted)] sm:grid-cols-3">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
              Sessione firmata lato server
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
              Cookie `httpOnly`
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
              API private dietro login
            </div>
          </div>
        </section>

        <LoginForm nextPath={params.next} />
      </main>
    </div>
  );
}
