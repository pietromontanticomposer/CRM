import Link from "next/link";
import TodoBoard from "@/components/TodoBoard";

export default function TodoPage() {
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
      <TodoBoard />
    </div>
  );
}
