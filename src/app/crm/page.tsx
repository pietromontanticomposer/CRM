import Link from "next/link";
import CrmApp from "@/components/CrmApp";
import LogoutButton from "@/components/LogoutButton";

export default function CrmPage() {
  return (
    <div className="relative">
      <div className="pointer-events-none fixed left-4 top-4 z-50 sm:left-8 sm:top-6">
        <Link
          href="/"
          className="pointer-events-auto rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-[var(--muted)] shadow-sm transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
        >
          ← Home
        </Link>
      </div>
      <div className="pointer-events-none fixed right-4 top-4 z-50 sm:right-8 sm:top-6">
        <div className="pointer-events-auto">
          <LogoutButton />
        </div>
      </div>
      <CrmApp />
    </div>
  );
}
