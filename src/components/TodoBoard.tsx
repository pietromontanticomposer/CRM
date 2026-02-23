"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";

type TodoPriority = "bassa" | "media" | "alta";
type TodoFilter = "tutte" | "aperte" | "scadute" | "completate";

type TodoTask = {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  priority: TodoPriority;
  is_done: boolean;
  created_at: string;
  updated_at: string;
  contact_id: string | null;
};

type TodoDraft = {
  title: string;
  notes: string;
  due_date: string;
  priority: TodoPriority;
};

const emptyDraft: TodoDraft = {
  title: "",
  notes: "",
  due_date: "",
  priority: "media",
};

const filterLabels: Record<TodoFilter, string> = {
  tutte: "Tutte",
  aperte: "Aperte",
  scadute: "Scadute",
  completate: "Completate",
};

const priorityStyles: Record<TodoPriority, string> = {
  alta: "border-rose-400/40 bg-rose-500/10 text-rose-200",
  media: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  bassa: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
};

const getTodayKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDate = (value?: string | null) => {
  if (!value) return "Senza scadenza";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const compareTasks = (a: TodoTask, b: TodoTask) => {
  if (a.is_done !== b.is_done) return Number(a.is_done) - Number(b.is_done);
  const aDue = a.due_date ?? "9999-12-31";
  const bDue = b.due_date ?? "9999-12-31";
  if (aDue !== bDue) return aDue.localeCompare(bDue);
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
};

const fetchTasks = async () => {
  return supabase
    .from("todo_tasks")
    .select("*")
    .order("is_done", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
};

export default function TodoBoard() {
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [updatingById, setUpdatingById] = useState<Record<string, boolean>>(
    {}
  );
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TodoFilter>("aperte");
  const [draft, setDraft] = useState<TodoDraft>(emptyDraft);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const { data, error: fetchError } = await fetchTasks();
      if (!active) return;
      if (fetchError) {
        setError(
          "Impossibile caricare i task. Verifica la migration `todo_tasks`."
        );
        setLoading(false);
        return;
      }
      setTasks(((data as TodoTask[]) || []).sort(compareTasks));
      setLoading(false);
    };

    void run();
    return () => {
      active = false;
    };
  }, []);

  const loadTasks = async () => {
    setRefreshing(true);
    setError(null);
    const { data, error: fetchError } = await fetchTasks();
    if (fetchError) {
      setError("Impossibile aggiornare i task.");
      setRefreshing(false);
      return;
    }
    setTasks(((data as TodoTask[]) || []).sort(compareTasks));
    setRefreshing(false);
  };

  const handleAddTask = async (event: FormEvent) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      setError("Inserisci almeno il titolo del task.");
      return;
    }

    setAdding(true);
    setError(null);
    const { data, error: insertError } = await supabase
      .from("todo_tasks")
      .insert({
        title,
        notes: draft.notes.trim() || null,
        due_date: draft.due_date || null,
        priority: draft.priority,
        contact_id: null,
      })
      .select("*")
      .single();

    if (insertError) {
      setError("Impossibile creare il task. Riprova.");
      setAdding(false);
      return;
    }

    const created = data as TodoTask;
    setTasks((prev) => [created, ...prev].sort(compareTasks));
    setDraft(emptyDraft);
    setAdding(false);
  };

  const handleToggleDone = async (task: TodoTask) => {
    if (updatingById[task.id]) return;
    setUpdatingById((prev) => ({ ...prev, [task.id]: true }));
    setError(null);

    const { data, error: updateError } = await supabase
      .from("todo_tasks")
      .update({ is_done: !task.is_done })
      .eq("id", task.id)
      .select("*")
      .single();

    if (updateError) {
      setError("Impossibile aggiornare il task.");
      setUpdatingById((prev) => ({ ...prev, [task.id]: false }));
      return;
    }

    const updated = data as TodoTask;
    setTasks((prev) =>
      prev.map((item) => (item.id === task.id ? updated : item)).sort(compareTasks)
    );
    setUpdatingById((prev) => ({ ...prev, [task.id]: false }));
  };

  const today = getTodayKey();

  const counters = useMemo(() => {
    const summary = {
      tutte: tasks.length,
      aperte: 0,
      scadute: 0,
      completate: 0,
    };

    tasks.forEach((task) => {
      if (task.is_done) {
        summary.completate += 1;
      } else {
        summary.aperte += 1;
        if (task.due_date && task.due_date < today) {
          summary.scadute += 1;
        }
      }
    });

    return summary;
  }, [tasks, today]);

  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filter === "tutte") return true;
      if (filter === "aperte") return !task.is_done;
      if (filter === "completate") return task.is_done;
      if (filter === "scadute") {
        return !task.is_done && Boolean(task.due_date && task.due_date < today);
      }
      return true;
    });
  }, [tasks, filter, today]);

  return (
    <div className="relative min-h-screen overflow-hidden px-6 pb-16 pt-10 sm:px-10">
      <header className="relative mx-auto mb-8 flex w-full max-w-5xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
              TODO
            </p>
            <h1 className="text-3xl font-semibold text-[var(--ink)] sm:text-4xl">
              Le mie attivita
            </h1>
          </div>
          <button
            type="button"
            onClick={loadTasks}
            disabled={refreshing}
            className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--muted)] shadow-sm transition hover:border-[var(--accent)] hover:text-[var(--ink)] disabled:opacity-60"
          >
            {refreshing ? "Aggiorno..." : "Aggiorna"}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Aperte
            </p>
            <p className="mt-1 text-2xl font-semibold text-[var(--ink)]">
              {counters.aperte}
            </p>
          </div>
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-rose-200">
              Scadute
            </p>
            <p className="mt-1 text-2xl font-semibold text-rose-100">
              {counters.scadute}
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">
              Completate
            </p>
            <p className="mt-1 text-2xl font-semibold text-emerald-100">
              {counters.completate}
            </p>
          </div>
        </div>
      </header>

      <main className="relative mx-auto grid w-full max-w-5xl gap-6">
        <section className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-lg">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Nuovo task
          </h2>
          <form onSubmit={handleAddTask} className="mt-4 grid gap-3">
            <div className="grid gap-3 lg:grid-cols-[1fr_180px_140px_auto]">
              <input
                value={draft.title}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, title: event.target.value }))
                }
                placeholder="Cosa devo fare?"
              />
              <input
                type="date"
                value={draft.due_date}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, due_date: event.target.value }))
                }
              />
              <select
                value={draft.priority}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    priority: event.target.value as TodoPriority,
                  }))
                }
              >
                <option value="alta">Priorita alta</option>
                <option value="media">Priorita media</option>
                <option value="bassa">Priorita bassa</option>
              </select>
              <button
                type="submit"
                disabled={adding}
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
              >
                {adding ? "Aggiungo..." : "+ Aggiungi"}
              </button>
            </div>
            <textarea
              rows={2}
              value={draft.notes}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, notes: event.target.value }))
              }
              placeholder="Note (opzionale)"
            />
          </form>
        </section>

        {error && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-lg">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(filterLabels) as TodoFilter[]).map((item) => {
              const selected = filter === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setFilter(item)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    selected
                      ? "border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--ink)]"
                      : "border-[var(--line)] bg-[var(--panel-strong)] text-[var(--muted)]"
                  }`}
                >
                  {filterLabels[item]} ({counters[item]})
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3">
            {loading && (
              <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                Caricamento task...
              </div>
            )}
            {!loading && visibleTasks.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                Nessun task in questa vista.
              </div>
            )}
            {!loading &&
              visibleTasks.map((task) => {
                const isOverdue = Boolean(
                  task.due_date && task.due_date < today && !task.is_done
                );
                return (
                  <label
                    key={task.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 ${
                      task.is_done
                        ? "border-[var(--line)] bg-[var(--panel)] opacity-75"
                        : isOverdue
                          ? "border-rose-400/40 bg-rose-500/10"
                          : "border-[var(--line)] bg-[var(--panel-strong)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={task.is_done}
                      disabled={Boolean(updatingById[task.id])}
                      onChange={() => handleToggleDone(task)}
                      className="mt-1 h-4 w-4 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`break-words text-sm font-semibold ${
                          task.is_done ? "line-through text-[var(--muted)]" : ""
                        }`}
                      >
                        {task.title}
                      </p>
                      {task.notes && (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted)]">
                          {task.notes}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <span
                          className={`rounded-full border px-2 py-0.5 font-semibold ${priorityStyles[task.priority]}`}
                        >
                          {task.priority}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 font-semibold ${
                            isOverdue
                              ? "border-rose-400/40 bg-rose-500/10 text-rose-200"
                              : "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]"
                          }`}
                        >
                          {formatDate(task.due_date)}
                        </span>
                      </div>
                    </div>
                  </label>
                );
              })}
          </div>
        </section>
      </main>
    </div>
  );
}
