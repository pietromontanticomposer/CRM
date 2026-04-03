"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CrmApp, { type CrmTheme } from "@/components/CrmApp";
import LogoutButton from "@/components/LogoutButton";

const CRM_THEME_STORAGE_KEY = "crm-theme";

export default function CrmPage() {
  const [theme, setTheme] = useState<CrmTheme>(() => {
    if (typeof window === "undefined") return "light";
    const storedTheme = window.localStorage.getItem(CRM_THEME_STORAGE_KEY);
    return storedTheme === "dark" || storedTheme === "light"
      ? storedTheme
      : "light";
  });

  useEffect(() => {
    window.localStorage.setItem(CRM_THEME_STORAGE_KEY, theme);
  }, [theme]);

  return (
    <div
      suppressHydrationWarning
      className={`${theme === "light" ? "crm-light-theme" : ""} relative min-h-screen`}
    >
      <div className="pointer-events-none fixed left-4 top-4 z-50 sm:left-8 sm:top-6">
        <Link
          href="/"
          className="pointer-events-auto rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-[var(--muted)] shadow-sm transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
        >
          ← Home
        </Link>
      </div>
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex items-center gap-2 sm:right-8 sm:top-6">
        <button
          type="button"
          onClick={() =>
            setTheme((current) => (current === "light" ? "dark" : "light"))
          }
          suppressHydrationWarning
          className="pointer-events-auto rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-[var(--muted)] shadow-sm transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
        >
          {theme === "light" ? "Tema scuro" : "Tema chiaro"}
        </button>
        <div className="pointer-events-auto">
          <LogoutButton />
        </div>
      </div>
      <CrmApp theme={theme} />
    </div>
  );
}
