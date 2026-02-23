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

type WeeklyTask = {
  id: string;
  title: string;
  isDone: boolean;
  createdAt: string;
};

type FixedSchedule = Record<DayKey, WeeklyTask[]>;
type DraftByDay = Record<DayKey, string>;

const createEmptySchedule = (): FixedSchedule => ({
  lunedi: [],
  martedi: [],
  mercoledi: [],
  giovedi: [],
  venerdi: [],
  sabato: [],
  domenica: [],
});

const EMPTY_DRAFTS: DraftByDay = {
  lunedi: "",
  martedi: "",
  mercoledi: "",
  giovedi: "",
  venerdi: "",
  sabato: "",
  domenica: "",
};

const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeTasks = (value: unknown): WeeklyTask[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const task = entry as Partial<WeeklyTask>;
        const title = typeof task.title === "string" ? task.title.trim() : "";
        if (!title) return null;
        return {
          id: typeof task.id === "string" ? task.id : makeId(),
          title,
          isDone: Boolean(task.isDone),
          createdAt:
            typeof task.createdAt === "string"
              ? task.createdAt
              : new Date().toISOString(),
        };
      })
      .filter((task): task is WeeklyTask => Boolean(task));
  }

  if (typeof value === "string") {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((title) => ({
        id: makeId(),
        title,
        isDone: false,
        createdAt: new Date().toISOString(),
      }));
  }

  return [];
};

const loadScheduleFromStorage = (): FixedSchedule => {
  if (typeof window === "undefined") return createEmptySchedule();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return createEmptySchedule();

  try {
    const parsed = JSON.parse(raw) as Partial<Record<DayKey, unknown>>;
    return {
      lunedi: normalizeTasks(parsed.lunedi),
      martedi: normalizeTasks(parsed.martedi),
      mercoledi: normalizeTasks(parsed.mercoledi),
      giovedi: normalizeTasks(parsed.giovedi),
      venerdi: normalizeTasks(parsed.venerdi),
      sabato: normalizeTasks(parsed.sabato),
      domenica: normalizeTasks(parsed.domenica),
    };
  } catch {
    return createEmptySchedule();
  }
};

const sortTasks = (a: WeeklyTask, b: WeeklyTask) => {
  if (a.isDone !== b.isDone) return Number(a.isDone) - Number(b.isDone);
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
};

export default function FixedScheduleBoard() {
  const [schedule, setSchedule] = useState<FixedSchedule>(() =>
    loadScheduleFromStorage()
  );
  const [draftByDay, setDraftByDay] = useState<DraftByDay>(EMPTY_DRAFTS);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule));
  }, [schedule]);

  const handleAddTask = (day: DayKey) => {
    const title = draftByDay[day].trim();
    if (!title) return;

    const task: WeeklyTask = {
      id: makeId(),
      title,
      isDone: false,
      createdAt: new Date().toISOString(),
    };

    setSchedule((prev) => ({
      ...prev,
      [day]: [task, ...prev[day]].sort(sortTasks),
    }));
    setDraftByDay((prev) => ({ ...prev, [day]: "" }));
  };

  const handleToggleTask = (day: DayKey, taskId: string) => {
    setSchedule((prev) => ({
      ...prev,
      [day]: prev[day]
        .map((task) =>
          task.id === taskId ? { ...task, isDone: !task.isDone } : task
        )
        .sort(sortTasks),
    }));
  };

  const handleDeleteTask = (day: DayKey, taskId: string) => {
    setSchedule((prev) => ({
      ...prev,
      [day]: prev[day].filter((task) => task.id !== taskId),
    }));
  };

  const clearAll = () => {
    if (!window.confirm("Vuoi svuotare tutti i task del calendario?")) return;
    setSchedule(createEmptySchedule());
  };

  return (
    <div className="relative min-h-screen overflow-hidden px-6 pb-16 pt-10 sm:px-10">
      <header className="relative mx-auto mb-6 flex w-full max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
              MODULO 03
            </p>
            <h1 className="text-3xl font-semibold text-[var(--ink)] sm:text-4xl">
              Calendario
            </h1>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Ogni giorno contiene task fissi come nel TODO.
            </p>
          </div>
          <button
            type="button"
            onClick={clearAll}
            className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
          >
            Svuota tutto
          </button>
        </div>
      </header>

      <main className="relative mx-auto grid w-full max-w-6xl items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {WEEK_DAYS.map((day) => {
          const dayTasks = schedule[day.key];
          return (
            <section
              key={day.key}
              className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-lg"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-2 py-0.5 text-xs font-semibold uppercase text-[var(--ink)]">
                  {day.label}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {dayTasks.length}
                </span>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  handleAddTask(day.key);
                }}
                className="mb-3 grid gap-2"
              >
                <input
                  value={draftByDay[day.key]}
                  onChange={(event) =>
                    setDraftByDay((prev) => ({
                      ...prev,
                      [day.key]: event.target.value,
                    }))
                  }
                  placeholder={`Nuovo task per ${day.label}`}
                />
                <button
                  type="submit"
                  className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[var(--accent-strong)]"
                >
                  + Aggiungi task
                </button>
              </form>

              <div className="grid gap-2">
                {dayTasks.length === 0 && (
                  <div className="rounded-xl border border-dashed border-[var(--line)] p-2 text-xs text-[var(--muted)]">
                    Nessun task
                  </div>
                )}

                {dayTasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2"
                  >
                    <p
                      className={`text-sm font-semibold ${task.isDone ? "text-[var(--muted)] line-through" : "text-[var(--ink)]"}`}
                    >
                      {task.title}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleTask(day.key, task.id)}
                        className="rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-1 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/20"
                      >
                        {task.isDone ? "Riapri" : "Completato"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTask(day.key, task.id)}
                        className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
                      >
                        Elimina
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
