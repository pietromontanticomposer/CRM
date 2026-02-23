"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "fixed_schedule_week_v1";

const WEEK_DAYS = [
  { key: "lunedi", label: "Lunedi" },
  { key: "martedi", label: "Martedi" },
  { key: "mercoledi", label: "Mercoledi" },
  { key: "giovedi", label: "Giovedi" },
  { key: "venerdi", label: "Venerdi" },
  { key: "sabato", label: "Sabato" },
  { key: "domenica", label: "Domenica" },
] as const;

type DayKey = (typeof WEEK_DAYS)[number]["key"];
type FixedSchedule = Record<DayKey, string>;

const EMPTY_SCHEDULE: FixedSchedule = {
  lunedi: "",
  martedi: "",
  mercoledi: "",
  giovedi: "",
  venerdi: "",
  sabato: "",
  domenica: "",
};

export default function FixedScheduleBoard() {
  const [schedule, setSchedule] = useState<FixedSchedule>(EMPTY_SCHEDULE);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    let timeoutId: number | null = null;
    try {
      const parsed = JSON.parse(raw) as Partial<FixedSchedule>;
      const nextSchedule: FixedSchedule = {
        lunedi: typeof parsed.lunedi === "string" ? parsed.lunedi : "",
        martedi: typeof parsed.martedi === "string" ? parsed.martedi : "",
        mercoledi: typeof parsed.mercoledi === "string" ? parsed.mercoledi : "",
        giovedi: typeof parsed.giovedi === "string" ? parsed.giovedi : "",
        venerdi: typeof parsed.venerdi === "string" ? parsed.venerdi : "",
        sabato: typeof parsed.sabato === "string" ? parsed.sabato : "",
        domenica: typeof parsed.domenica === "string" ? parsed.domenica : "",
      };
      timeoutId = window.setTimeout(() => {
        setSchedule(nextSchedule);
      }, 0);
    } catch {
      timeoutId = window.setTimeout(() => {
        setSchedule(EMPTY_SCHEDULE);
      }, 0);
    }
    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule));
  }, [schedule]);

  const handleDayChange = (day: DayKey, value: string) => {
    setSchedule((prev) => ({ ...prev, [day]: value }));
  };

  const clearAll = () => {
    if (!window.confirm("Vuoi svuotare tutti gli impegni fissi?")) return;
    setSchedule(EMPTY_SCHEDULE);
  };

  return (
    <div className="relative min-h-screen overflow-hidden px-6 pb-16 pt-10 sm:px-10">
      <header className="relative mx-auto mb-6 flex w-full max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-red-300/80">
              MODULO 03
            </p>
            <h1 className="text-3xl font-semibold text-[var(--ink)] sm:text-4xl">
              Impegni Fissi Settimanali
            </h1>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Inserisci i tuoi impegni fissi giorno per giorno. Salvataggio
              automatico locale.
            </p>
          </div>
          <button
            type="button"
            onClick={clearAll}
            className="rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/20"
          >
            Svuota tutto
          </button>
        </div>
      </header>

      <main className="relative mx-auto grid w-full max-w-6xl items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {WEEK_DAYS.map((day) => (
          <section
            key={day.key}
            className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 shadow-lg"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="rounded-full border border-red-400/50 bg-red-500/15 px-2 py-0.5 text-xs font-semibold uppercase text-red-200">
                {day.label}
              </span>
            </div>
            <textarea
              rows={6}
              value={schedule[day.key]}
              onChange={(event) => handleDayChange(day.key, event.target.value)}
              placeholder={`Impegni fissi di ${day.label}`}
              className="w-full border-red-500/30 bg-[#180f12]"
            />
          </section>
        ))}
      </main>
    </div>
  );
}
