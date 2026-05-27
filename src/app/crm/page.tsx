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
  const [theme, setTheme] = useState<CrmTheme>("dark");
  const [section, setSection] = useState<CrmSection>("cinema");
  const [hydrated, setHydrated] = useState(false);

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
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--bg)]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="brand-serif text-base font-semibold tracking-tight text-[var(--gold)]"
            >
              Pietro <em className="italic font-normal">CRM</em>
            </Link>
            <span className="text-[var(--line-strong)]">/</span>
            <div
              role="tablist"
              aria-label="Sezioni"
              className="inline-flex items-center gap-0.5 rounded-md border border-[var(--line)] bg-[var(--panel)] p-0.5"
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
                    className={`rounded-[5px] px-2.5 py-1 text-xs font-medium transition ${
                      active
                        ? "bg-[var(--panel-strong)] text-[var(--ink)]"
                        : "text-[var(--muted)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {SECTION_LABELS[value]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <CrmNotificationsBell section={section} />
            <button
              type="button"
              onClick={() =>
                setTheme((current) => (current === "light" ? "dark" : "light"))
              }
              suppressHydrationWarning
              aria-label="Cambia tema"
              className="grid h-8 w-8 place-items-center rounded-md border border-[var(--line)] bg-[var(--panel)] text-[var(--muted)] transition hover:text-[var(--ink)]"
            >
              {theme === "light" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              )}
            </button>
            <LogoutButton />
          </div>
        </div>
      </header>
      <CrmApp theme={theme} section={section} />
    </div>
  );
}
