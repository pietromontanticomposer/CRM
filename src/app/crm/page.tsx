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
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-6 pt-6 sm:px-10">
        <Link
          href="/"
          className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-[var(--muted)] shadow-sm transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
        >
          ← Home
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() =>
              setTheme((current) => (current === "light" ? "dark" : "light"))
            }
            suppressHydrationWarning
            className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-[var(--muted)] shadow-sm transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
          >
            {theme === "light" ? "Tema scuro" : "Tema chiaro"}
          </button>
          <div>
            <LogoutButton />
          </div>
        </div>
      </div>
      <CrmApp theme={theme} />
    </div>
  );
}
