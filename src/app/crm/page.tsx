"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CrmApp, { type CrmTheme, type CrmSection } from "@/components/CrmApp";
import CrmNotificationsBell from "@/components/CrmNotificationsBell";
import LogoutButton from "@/components/LogoutButton";

const CRM_THEME_STORAGE_KEY = "crm-theme";
const CRM_SECTION_STORAGE_KEY = "crm-section";

const SECTION_LABELS: Record<CrmSection, string> = {
  cinema: "Cinema",
  live_music: "Live Music",
};

const isCrmSection = (value: unknown): value is CrmSection =>
  value === "cinema" || value === "live_music";
const isCrmTheme = (value: unknown): value is CrmTheme =>
  value === "light" || value === "dark";

export default function CrmPage() {
  // Always render the same defaults on server + first client render to
  // avoid hydration mismatches; the persisted values land in a useEffect
  // after mount.
  const [theme, setTheme] = useState<CrmTheme>("light");
  const [section, setSection] = useState<CrmSection>("cinema");
  const [hydrated, setHydrated] = useState(false);

  // Sync state from localStorage on mount. setState in an effect is the
  // canonical way to read browser-only state without breaking SSR.
  useEffect(() => {
    const storedTheme = window.localStorage.getItem(CRM_THEME_STORAGE_KEY);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (isCrmTheme(storedTheme)) setTheme(storedTheme);
    const storedSection = window.localStorage.getItem(CRM_SECTION_STORAGE_KEY);
    if (isCrmSection(storedSection)) setSection(storedSection);
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(CRM_THEME_STORAGE_KEY, theme);
  }, [theme, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(CRM_SECTION_STORAGE_KEY, section);
  }, [section, hydrated]);

  const sections: CrmSection[] = ["cinema", "live_music"];

  return (
    <div
      suppressHydrationWarning
      className={`${theme === "light" ? "crm-light-theme" : ""} relative min-h-screen`}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-6 pt-6 sm:px-10">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-[var(--muted)] shadow-sm transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
          >
            ← Home
          </Link>
          <div
            role="tablist"
            aria-label="Sezioni CRM"
            className="inline-flex rounded-full border border-[var(--line)] bg-[var(--panel)] p-0.5 shadow-sm"
          >
            {sections.map((value) => {
              const active = section === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSection(value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    active
                      ? "bg-[var(--accent)] text-white shadow-sm"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {SECTION_LABELS[value]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <CrmNotificationsBell section={section} />
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
      <CrmApp theme={theme} section={section} />
    </div>
  );
}
