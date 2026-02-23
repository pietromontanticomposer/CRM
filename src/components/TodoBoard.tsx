"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";

type TodoPriority = "alta" | "media" | "bassa";

type TodoTask = {
  id: string;
  title: string;
  priority: TodoPriority;
  is_done: boolean;
  created_at: string;
  updated_at: string;
  notes: string | null;
  due_date: string | null;
  contact_id: string | null;
};

const PRIORITIES: TodoPriority[] = ["alta", "media", "bassa"];

const priorityRank: Record<TodoPriority, number> = {
  alta: 0,
  media: 1,
  bassa: 2,
};

const priorityStyles: Record<TodoPriority, string> = {
  alta: "border-rose-400/40 bg-rose-500/10 text-rose-200",
  media: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  bassa: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
};

const fetchTasks = async () => {
  return supabase.from("todo_tasks").select("*").order("created_at", {
    ascending: false,
  });
};

const sortTasks = (a: TodoTask, b: TodoTask) => {
  if (a.is_done !== b.is_done) return Number(a.is_done) - Number(b.is_done);
  const priorityDelta = priorityRank[a.priority] - priorityRank[b.priority];
  if (priorityDelta !== 0) return priorityDelta;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
};

export default function TodoBoard() {
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TodoPriority>("media");
  const [updatingById, setUpdatingById] = useState<Record<string, boolean>>(
    {}
  );

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
      setTasks(((data as TodoTask[]) || []).sort(sortTasks));
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
    setTasks(((data as TodoTask[]) || []).sort(sortTasks));
    setRefreshing(false);
  };

  const handleAddTask = async (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Inserisci un titolo.");
      return;
    }

    setAdding(true);
    setError(null);
    const { data, error: insertError } = await supabase
      .from("todo_tasks")
      .insert({
        title: cleanTitle,
        priority,
        is_done: false,
        notes: null,
        due_date: null,
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
    setTasks((prev) => [created, ...prev].sort(sortTasks));
    setTitle("");
    setPriority("media");
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
      prev.map((item) => (item.id === task.id ? updated : item)).sort(sortTasks)
    );
    setUpdatingById((prev) => ({ ...prev, [task.id]: false }));
  };

  const openTasks = useMemo(
    () => tasks.filter((task) => !task.is_done),
    [tasks]
  );
  const doneTasks = useMemo(
    () => tasks.filter((task) => task.is_done),
    [tasks]
  );

  const groupedOpenTasks = useMemo(() => {
    const groups: Record<TodoPriority, TodoTask[]> = {
      alta: [],
      media: [],
      bassa: [],
    };
    openTasks.forEach((task) => {
      groups[task.priority].push(task);
    });
    return groups;
  }, [openTasks]);

  return (
    <div className="relative min-h-screen overflow-hidden px-6 pb-16 pt-10 sm:px-10">
      <header className="relative mx-auto mb-6 flex w-full max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
              TODO
            </p>
            <h1 className="text-3xl font-semibold text-[var(--ink)] sm:text-4xl">
              Task Prioritari
            </h1>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Clicca una card per segnare completato.
            </p>
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

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-lg">
          <form onSubmit={handleAddTask} className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Nuovo task"
            />
            <select
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as TodoPriority)
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
          </form>
        </section>

        {error && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </header>

      <main className="relative mx-auto grid w-full max-w-6xl gap-4 md:grid-cols-3">
        {PRIORITIES.map((item) => {
          const column = groupedOpenTasks[item];
          return (
            <section
              key={item}
              className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-lg"
            >
              <div className="mb-3 flex items-center justify-between">
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${priorityStyles[item]}`}
                >
                  {item}
                </span>
                <span className="text-xs text-[var(--muted)]">{column.length}</span>
              </div>
              <div className="grid gap-2">
                {loading && (
                  <div className="rounded-xl border border-dashed border-[var(--line)] p-2 text-xs text-[var(--muted)]">
                    Caricamento...
                  </div>
                )}
                {!loading && column.length === 0 && (
                  <div className="rounded-xl border border-dashed border-[var(--line)] p-2 text-xs text-[var(--muted)]">
                    Nessun task
                  </div>
                )}
                {!loading &&
                  column.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => handleToggleDone(task)}
                      disabled={Boolean(updatingById[task.id])}
                      className="w-full rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-left text-sm font-semibold text-[var(--ink)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] disabled:opacity-60"
                    >
                      {task.title}
                    </button>
                  ))}
              </div>
            </section>
          );
        })}
      </main>

      <section className="mx-auto mt-5 w-full max-w-6xl rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-lg">
        <details>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Completati ({doneTasks.length})
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {doneTasks.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--line)] p-2 text-xs text-[var(--muted)]">
                Nessun task completato.
              </div>
            )}
            {doneTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => handleToggleDone(task)}
                disabled={Boolean(updatingById[task.id])}
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-left text-sm text-[var(--muted)] line-through transition hover:border-[var(--accent)] disabled:opacity-60"
              >
                {task.title}
              </button>
            ))}
          </div>
        </details>
      </section>
    </div>
  );
}
