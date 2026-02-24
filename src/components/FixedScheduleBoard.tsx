"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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

type TaskLink = {
  url: string;
  label: string;
};

type TodoTaskMeta = {
  meanwhile: string;
  learning: string;
  note: string;
  links: TaskLink[];
};

type WeeklyTask = {
  id: string;
  title: string;
  isDone: boolean;
  createdAt: string;
  source?: "manual" | "todo";
  todoTaskId?: string;
  timeSlot?: string;
};

type FixedSchedule = Record<DayKey, WeeklyTask[]>;
type DraftByDay = Record<DayKey, string>;
type TodoMetaById = Record<string, TodoTaskMeta>;

const TASK_META_PREFIX = "__todo_meta_v1__:";

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
    return value.reduce<WeeklyTask[]>((acc, entry) => {
      if (!entry || typeof entry !== "object") return acc;
      const task = entry as Partial<WeeklyTask>;
      const title = typeof task.title === "string" ? task.title.trim() : "";
      if (!title) return acc;
      acc.push({
        id: typeof task.id === "string" ? task.id : makeId(),
        title,
        isDone: Boolean(task.isDone),
        createdAt:
          typeof task.createdAt === "string"
            ? task.createdAt
            : new Date().toISOString(),
        source: (task.source === "todo" ? "todo" : "manual") as
          | "manual"
          | "todo",
        ...(typeof task.todoTaskId === "string"
          ? { todoTaskId: task.todoTaskId }
          : {}),
        ...(typeof task.timeSlot === "string" ? { timeSlot: task.timeSlot } : {}),
      });
      return acc;
    }, []);
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
        source: "manual" as const,
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

const parseTodoTaskMeta = (value?: string | null): TodoTaskMeta => {
  if (!value) {
    return { meanwhile: "", learning: "", note: "", links: [] };
  }

  if (!value.startsWith(TASK_META_PREFIX)) {
    return {
      meanwhile: value,
      learning: "",
      note: "",
      links: [],
    };
  }

  try {
    const parsed = JSON.parse(
      value.slice(TASK_META_PREFIX.length)
    ) as Partial<TodoTaskMeta> & {
      link?: unknown;
      linkUrl?: unknown;
      linkLabel?: unknown;
      links?: unknown;
    };

    const parsedLinks = Array.isArray(parsed.links)
      ? parsed.links
          .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const link = entry as Partial<TaskLink>;
            const url = typeof link.url === "string" ? link.url.trim() : "";
            const label =
              typeof link.label === "string" ? link.label.trim() : "";
            if (!url) return null;
            return { url, label };
          })
          .filter((entry): entry is TaskLink => Boolean(entry))
      : [];

    const legacyLinkUrl =
      typeof parsed.linkUrl === "string"
        ? parsed.linkUrl.trim()
        : typeof parsed.link === "string"
          ? parsed.link.trim()
          : "";
    const legacyLinkLabel =
      typeof parsed.linkLabel === "string" ? parsed.linkLabel.trim() : "";
    const legacyLinks = legacyLinkUrl
      ? [{ url: legacyLinkUrl, label: legacyLinkLabel }]
      : [];

    return {
      meanwhile: typeof parsed.meanwhile === "string" ? parsed.meanwhile : "",
      learning: typeof parsed.learning === "string" ? parsed.learning : "",
      note: typeof parsed.note === "string" ? parsed.note : "",
      links: parsedLinks.length > 0 ? parsedLinks : legacyLinks,
    };
  } catch {
    return {
      meanwhile: value,
      learning: "",
      note: "",
      links: [],
    };
  }
};

const toTaskHref = (rawLinkUrl: string) => {
  const link = rawLinkUrl.trim();
  if (!link) return null;
  const lowered = link.toLowerCase();
  if (lowered.startsWith("javascript:") || lowered.startsWith("data:")) {
    return null;
  }
  if (
    link.startsWith("/") ||
    link.startsWith("#") ||
    lowered.startsWith("mailto:") ||
    lowered.startsWith("tel:") ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(link)
  ) {
    return link;
  }
  return `https://${link}`;
};

const isExternalHref = (href: string) =>
  /^(https?:\/\/|mailto:|tel:)/i.test(href);

const toDisplayLinks = (links: TaskLink[]) =>
  links
    .map((link) => {
      const href = toTaskHref(link.url);
      if (!href) return null;
      return {
        href,
        label: link.label.trim() || "Apri link",
      };
    })
    .filter((entry): entry is { href: string; label: string } =>
      Boolean(entry)
    );

export default function FixedScheduleBoard() {
  const [schedule, setSchedule] = useState<FixedSchedule>(() =>
    loadScheduleFromStorage()
  );
  const [draftByDay, setDraftByDay] = useState<DraftByDay>(EMPTY_DRAFTS);
  const [multiTitle, setMultiTitle] = useState("");
  const [multiDays, setMultiDays] = useState<DayKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyById, setBusyById] = useState<Record<string, boolean>>({});
  const [todoMetaById, setTodoMetaById] = useState<TodoMetaById>({});

  const setTaskBusy = (taskId: string, busy: boolean) => {
    setBusyById((prev) => ({ ...prev, [taskId]: busy }));
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule));
  }, [schedule]);

  useEffect(() => {
    let active = true;
    const loadTodoMeta = async () => {
      const { data, error: fetchError } = await supabase
        .from("todo_tasks")
        .select("id,notes");

      if (!active || fetchError || !data) return;

      const next = (data as Array<{ id: string; notes: string | null }>).reduce<
        TodoMetaById
      >((acc, row) => {
        acc[row.id] = parseTodoTaskMeta(row.notes);
        return acc;
      }, {});

      setTodoMetaById(next);
    };

    void loadTodoMeta();
    return () => {
      active = false;
    };
  }, []);

  const handleAddTask = (day: DayKey) => {
    const title = draftByDay[day].trim();
    if (!title) return;
    setError(null);

    const task: WeeklyTask = {
      id: makeId(),
      title,
      isDone: false,
      createdAt: new Date().toISOString(),
      source: "manual",
    };

    setSchedule((prev) => ({
      ...prev,
      [day]: [task, ...prev[day]].sort(sortTasks),
    }));
    setDraftByDay((prev) => ({ ...prev, [day]: "" }));
  };

  const toggleMultiDay = (day: DayKey) => {
    setMultiDays((prev) =>
      prev.includes(day)
        ? prev.filter((currentDay) => currentDay !== day)
        : [...prev, day]
    );
  };

  const handleAddMultiTask = () => {
    const title = multiTitle.trim();
    if (!title) {
      setError("Inserisci il titolo della stessa azione.");
      return;
    }
    if (multiDays.length === 0) {
      setError("Seleziona almeno un giorno.");
      return;
    }
    setError(null);
    const createdAt = new Date().toISOString();

    setSchedule((prev) => {
      const next = { ...prev };
      multiDays.forEach((day) => {
        const task: WeeklyTask = {
          id: makeId(),
          title,
          isDone: false,
          createdAt,
          source: "manual",
        };
        next[day] = [task, ...next[day]].sort(sortTasks);
      });
      return next;
    });

    setMultiTitle("");
    setMultiDays([]);
  };

  const handleToggleTask = async (day: DayKey, task: WeeklyTask) => {
    if (busyById[task.id]) return;
    setError(null);

    if (task.source === "todo" && task.todoTaskId) {
      setTaskBusy(task.id, true);
      const { error: updateError } = await supabase
        .from("todo_tasks")
        .update({ is_done: !task.isDone })
        .eq("id", task.todoTaskId);

      if (updateError) {
        setError("Impossibile aggiornare il task collegato al TODO.");
        setTaskBusy(task.id, false);
        return;
      }
      setTaskBusy(task.id, false);
    }

    setSchedule((prev) => ({
      ...prev,
      [day]: prev[day]
        .map((currentTask) => {
          if (currentTask.id !== task.id) return currentTask;
          return { ...currentTask, isDone: !currentTask.isDone };
        })
        .sort(sortTasks),
    }));
  };

  const handleEditTask = async (day: DayKey, task: WeeklyTask) => {
    if (busyById[task.id]) return;
    const nextTitleRaw = window.prompt("Titolo task", task.title);
    if (nextTitleRaw === null) return;
    const nextTitle = nextTitleRaw.trim();
    if (!nextTitle) {
      setError("Il titolo non puo essere vuoto.");
      return;
    }
    setError(null);

    if (task.source === "todo" && task.todoTaskId) {
      setTaskBusy(task.id, true);
      const { error: updateError } = await supabase
        .from("todo_tasks")
        .update({ title: nextTitle })
        .eq("id", task.todoTaskId);

      if (updateError) {
        setError("Impossibile modificare il task collegato al TODO.");
        setTaskBusy(task.id, false);
        return;
      }
      setTaskBusy(task.id, false);
    }

    setSchedule((prev) => ({
      ...prev,
      [day]: prev[day]
        .map((currentTask) =>
          currentTask.id === task.id
            ? { ...currentTask, title: nextTitle }
            : currentTask
        )
        .sort(sortTasks),
    }));
  };

  const handleDeleteTask = async (day: DayKey, task: WeeklyTask) => {
    if (busyById[task.id]) return;
    if (!window.confirm("Eliminare questo task?")) return;
    setError(null);

    if (task.source === "todo" && task.todoTaskId) {
      setTaskBusy(task.id, true);
      const { error: deleteError } = await supabase
        .from("todo_tasks")
        .delete()
        .eq("id", task.todoTaskId);

      if (deleteError) {
        setError("Impossibile eliminare il task collegato al TODO.");
        setTaskBusy(task.id, false);
        return;
      }
      setTodoMetaById((prev) => {
        const next = { ...prev };
        delete next[task.todoTaskId as string];
        return next;
      });
      setTaskBusy(task.id, false);
    }

    setSchedule((prev) => ({
      ...prev,
      [day]: prev[day].filter((currentTask) => currentTask.id !== task.id),
    }));
  };

  const clearAll = () => {
    if (!window.confirm("Vuoi svuotare tutti i task del calendario?")) return;
    setError(null);
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
        {error && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </header>

      <main className="relative mx-auto grid w-full max-w-6xl items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <section className="sm:col-span-2 xl:col-span-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-lg">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
            Stessa azione su piu giorni
          </p>
          <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_auto]">
            <input
              value={multiTitle}
              onChange={(event) => setMultiTitle(event.target.value)}
              placeholder="Titolo azione da aggiungere su piu giorni"
            />
            <button
              type="button"
              onClick={handleAddMultiTask}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent-strong)]"
            >
              + Aggiungi su giorni selezionati
            </button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {WEEK_DAYS.map((day) => (
              <label
                key={`multi-day-${day.key}`}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-2 py-1 text-xs text-[var(--ink)]"
              >
                <input
                  type="checkbox"
                  checked={multiDays.includes(day.key)}
                  onChange={() => toggleMultiDay(day.key)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                {day.label}
              </label>
            ))}
          </div>
        </section>
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

                {dayTasks.map((task) => {
                  const meta =
                    task.source === "todo" && task.todoTaskId
                      ? todoMetaById[task.todoTaskId]
                      : undefined;
                  const taskLinks = meta ? toDisplayLinks(meta.links) : [];

                  return (
                    <div
                      key={task.id}
                      className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2"
                    >
                      {task.timeSlot && (
                        <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                          Fascia: {task.timeSlot}
                        </p>
                      )}
                      <p
                        className={`text-sm font-semibold ${task.isDone ? "text-[var(--muted)] line-through" : "text-[var(--ink)]"}`}
                      >
                        {task.title}
                      </p>
                      {task.source === "todo" && (
                        <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                          Collegato al TODO
                        </p>
                      )}
                      {meta && (
                        <div className="mt-2 grid gap-2 text-xs text-[var(--muted)]">
                          {meta.meanwhile && (
                            <div>
                              <p className="uppercase tracking-[0.14em] text-[10px]">
                                Cosa fare nel mentre
                              </p>
                              <p className="mt-0.5 whitespace-pre-wrap text-[var(--ink)]">
                                {meta.meanwhile}
                              </p>
                            </div>
                          )}
                          {meta.learning && (
                            <div>
                              <p className="uppercase tracking-[0.14em] text-[10px]">
                                Cosa imparare per le prossime volte
                              </p>
                              <p className="mt-0.5 whitespace-pre-wrap text-[var(--ink)]">
                                {meta.learning}
                              </p>
                            </div>
                          )}
                          {meta.note && (
                            <div>
                              <p className="uppercase tracking-[0.14em] text-[10px]">
                                Note
                              </p>
                              <p className="mt-0.5 whitespace-pre-wrap text-[var(--ink)]">
                                {meta.note}
                              </p>
                            </div>
                          )}
                          {taskLinks.length > 0 && (
                            <div className="mt-0.5 flex flex-wrap gap-2">
                              {taskLinks.map((link, linkIndex) => (
                                <a
                                  key={`${task.id}-calendar-link-${linkIndex}`}
                                  href={link.href}
                                  target={
                                    isExternalHref(link.href) ? "_blank" : undefined
                                  }
                                  rel={
                                    isExternalHref(link.href)
                                      ? "noreferrer noopener"
                                      : undefined
                                  }
                                  className="inline-flex items-center rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/20"
                                >
                                  {link.label}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void handleEditTask(day.key, task);
                          }}
                          disabled={Boolean(busyById[task.id])}
                          className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)] disabled:opacity-60"
                        >
                          Modifica
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleToggleTask(day.key, task);
                          }}
                          disabled={Boolean(busyById[task.id])}
                          className="rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-1 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/20 disabled:opacity-60"
                        >
                          {busyById[task.id]
                            ? "Attendi..."
                            : task.isDone
                              ? "Riapri"
                              : "Completato"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleDeleteTask(day.key, task);
                          }}
                          disabled={Boolean(busyById[task.id])}
                          className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)] disabled:opacity-60"
                        >
                          {busyById[task.id] ? "Attendi..." : "Elimina"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
