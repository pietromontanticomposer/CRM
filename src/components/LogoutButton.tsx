export default function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="post">
      <button
        type="submit"
        className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-[var(--muted)] shadow-sm transition hover:border-rose-400/60 hover:text-[var(--ink)]"
      >
        Esci
      </button>
    </form>
  );
}
