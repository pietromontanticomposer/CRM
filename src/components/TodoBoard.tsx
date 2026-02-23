"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";

type TodoPriority = "alta" | "media" | "continuativo" | "bassa";

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

type TodoDraft = {
  title: string;
  priority: TodoPriority;
  meanwhile: string;
  learning: string;
};

type TodoEditDraft = TodoDraft;

type TaskMeta = {
  meanwhile: string;
  learning: string;
  bucket?: "continuativo";
};

const PRIORITIES: TodoPriority[] = ["alta", "media", "continuativo", "bassa"];
const TASK_META_PREFIX = "__todo_meta_v1__:";

const priorityRank: Record<TodoPriority, number> = {
  alta: 0,
  media: 1,
  continuativo: 2,
  bassa: 3,
};

const priorityStyles: Record<TodoPriority, string> = {
  alta: "border-rose-400/40 bg-rose-500/10 text-rose-200",
  media: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  continuativo: "border-cyan-400/40 bg-cyan-500/10 text-cyan-200",
  bassa: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
};

const emptyDraft: TodoDraft = {
  title: "",
  priority: "media",
  meanwhile: "",
  learning: "",
};

const fetchTasks = async () => {
  return supabase.from("todo_tasks").select("*").order("created_at", {
    ascending: false,
  });
};

const sortTasks = (a: TodoTask, b: TodoTask) => {
  const aBucket = getTaskBucket(a);
  const bBucket = getTaskBucket(b);
  if (a.is_done !== b.is_done) return Number(a.is_done) - Number(b.is_done);
  const priorityDelta = priorityRank[aBucket] - priorityRank[bBucket];
  if (priorityDelta !== 0) return priorityDelta;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
};

const buildTaskMeta = (
  meanwhile: string,
  learning: string,
  selectedPriority: TodoPriority
) => {
  const payload: TaskMeta = {
    meanwhile: meanwhile.trim(),
    learning: learning.trim(),
    ...(selectedPriority === "continuativo"
      ? { bucket: "continuativo" as const }
      : {}),
  };
  if (!payload.meanwhile && !payload.learning && !payload.bucket) return null;
  return `${TASK_META_PREFIX}${JSON.stringify(payload)}`;
};

const parseTaskMeta = (value?: string | null): TaskMeta => {
  if (!value) return { meanwhile: "", learning: "" };

  if (!value.startsWith(TASK_META_PREFIX)) {
    return { meanwhile: value, learning: "" };
  }

  try {
    const parsed = JSON.parse(
      value.slice(TASK_META_PREFIX.length)
    ) as Partial<TaskMeta>;
    return {
      meanwhile:
        typeof parsed.meanwhile === "string" ? parsed.meanwhile : "",
      learning: typeof parsed.learning === "string" ? parsed.learning : "",
      bucket: parsed.bucket === "continuativo" ? "continuativo" : undefined,
    };
  } catch {
    return { meanwhile: value, learning: "" };
  }
};

const getTaskBucket = (task: TodoTask): TodoPriority => {
  if (task.priority === "continuativo") return "continuativo";
  const meta = parseTaskMeta(task.notes);
  if (meta.bucket === "continuativo") return "continuativo";
  return task.priority;
};

export default function TodoBoard() {
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TodoDraft>(emptyDraft);
  const [updatingById, setUpdatingById] = useState<Record<string, boolean>>(
    {}
  );
  const [editingById, setEditingById] = useState<Record<string, boolean>>({});
  const [editDraftById, setEditDraftById] = useState<
    Record<string, TodoEditDraft>
  >({});
  const [deletingById, setDeletingById] = useState<Record<string, boolean>>({});

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
    const cleanTitle = draft.title.trim();
    if (!cleanTitle) {
      setError("Inserisci un titolo.");
      return;
    }

    setAdding(true);
    setError(null);
    const dbPriority =
      draft.priority === "continuativo" ? "bassa" : draft.priority;
    const { data, error: insertError } = await supabase
      .from("todo_tasks")
      .insert({
        title: cleanTitle,
        priority: dbPriority,
        is_done: false,
        notes: buildTaskMeta(draft.meanwhile, draft.learning, draft.priority),
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
      prev.map((item) => (item.id === task.id ? updated : item)).sort(sortTasks)
    );
    setUpdatingById((prev) => ({ ...prev, [task.id]: false }));
  };

  const handleStartEdit = (task: TodoTask) => {
    const meta = parseTaskMeta(task.notes);
    setEditDraftById((prev) => ({
      ...prev,
      [task.id]: {
        title: task.title,
        priority: getTaskBucket(task),
        meanwhile: meta.meanwhile,
        learning: meta.learning,
      },
    }));
    setEditingById((prev) => ({ ...prev, [task.id]: true }));
  };

  const handleCancelEdit = (taskId: string) => {
    setEditingById((prev) => ({ ...prev, [taskId]: false }));
    setEditDraftById((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  };

  const handleSaveEdit = async (taskId: string) => {
    const editDraft = editDraftById[taskId];
    if (!editDraft) return;

    const cleanTitle = editDraft.title.trim();
    if (!cleanTitle) {
      setError("Il titolo non puo essere vuoto.");
      return;
    }

    setUpdatingById((prev) => ({ ...prev, [taskId]: true }));
    setError(null);

    const dbPriority =
      editDraft.priority === "continuativo" ? "bassa" : editDraft.priority;
    const { data, error: updateError } = await supabase
      .from("todo_tasks")
      .update({
        title: cleanTitle,
        priority: dbPriority,
        notes: buildTaskMeta(
          editDraft.meanwhile,
          editDraft.learning,
          editDraft.priority
        ),
      })
      .eq("id", taskId)
      .select("*")
      .single();

    if (updateError) {
      setError("Impossibile salvare le modifiche.");
      setUpdatingById((prev) => ({ ...prev, [taskId]: false }));
      return;
    }

    const updated = data as TodoTask;
    setTasks((prev) =>
      prev.map((item) => (item.id === taskId ? updated : item)).sort(sortTasks)
    );
    handleCancelEdit(taskId);
    setUpdatingById((prev) => ({ ...prev, [taskId]: false }));
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm("Eliminare questo task?")) return;
    setDeletingById((prev) => ({ ...prev, [taskId]: true }));
    setError(null);

    const { error: deleteError } = await supabase
      .from("todo_tasks")
      .delete()
      .eq("id", taskId);

    if (deleteError) {
      setError("Impossibile eliminare il task.");
      setDeletingById((prev) => ({ ...prev, [taskId]: false }));
      return;
    }

    setTasks((prev) => prev.filter((task) => task.id !== taskId));
    handleCancelEdit(taskId);
    setDeletingById((prev) => ({ ...prev, [taskId]: false }));
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
      continuativo: [],
      bassa: [],
    };
    openTasks.forEach((task) => {
      groups[getTaskBucket(task)].push(task);
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
              Card minimali: solo titolo. Apri la card per i dettagli.
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
          <form onSubmit={handleAddTask} className="grid gap-2">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
              <input
                value={draft.title}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, title: event.target.value }))
                }
                placeholder="Nuovo task"
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
                <option value="continuativo">Priorita continuativo</option>
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

            <div className="grid gap-2 sm:grid-cols-2">
              <textarea
                rows={2}
                value={draft.meanwhile}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, meanwhile: event.target.value }))
                }
                placeholder="Cosa fare nel mentre"
              />
              <textarea
                rows={2}
                value={draft.learning}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, learning: event.target.value }))
                }
                placeholder="Cosa imparare per le prossime volte"
              />
            </div>
          </form>
        </section>

        {error && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </header>

      <main className="relative mx-auto grid w-full max-w-6xl gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PRIORITIES.map((priority) => {
          const column = groupedOpenTasks[priority];
          return (
            <section
              key={priority}
              className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-lg"
            >
              <div className="mb-3 flex items-center justify-between">
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${priorityStyles[priority]}`}
                >
                  {priority}
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
                  column.map((task) => {
                    const meta = parseTaskMeta(task.notes);
                    const isEditing = Boolean(editingById[task.id]);
                    const editDraft = editDraftById[task.id];
                    return (
                      <details
                        key={task.id}
                        className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2"
                      >
                        <summary className="cursor-pointer text-left text-sm font-semibold text-[var(--ink)]">
                          {task.title}
                        </summary>
                        <div className="mt-2 grid gap-2 text-xs text-[var(--muted)]">
                          {isEditing && editDraft ? (
                            <>
                              <input
                                value={editDraft.title}
                                onChange={(event) =>
                                  setEditDraftById((prev) => ({
                                    ...prev,
                                    [task.id]: {
                                      ...editDraft,
                                      title: event.target.value,
                                    },
                                  }))
                                }
                                placeholder="Titolo task"
                              />
                              <select
                                value={editDraft.priority}
                                onChange={(event) =>
                                  setEditDraftById((prev) => ({
                                    ...prev,
                                    [task.id]: {
                                      ...editDraft,
                                      priority: event.target
                                        .value as TodoPriority,
                                    },
                                  }))
                                }
                              >
                                <option value="alta">Priorita alta</option>
                                <option value="media">Priorita media</option>
                                <option value="continuativo">
                                  Priorita continuativo
                                </option>
                                <option value="bassa">Priorita bassa</option>
                              </select>
                              <textarea
                                rows={2}
                                value={editDraft.meanwhile}
                                onChange={(event) =>
                                  setEditDraftById((prev) => ({
                                    ...prev,
                                    [task.id]: {
                                      ...editDraft,
                                      meanwhile: event.target.value,
                                    },
                                  }))
                                }
                                placeholder="Cosa fare nel mentre"
                              />
                              <textarea
                                rows={2}
                                value={editDraft.learning}
                                onChange={(event) =>
                                  setEditDraftById((prev) => ({
                                    ...prev,
                                    [task.id]: {
                                      ...editDraft,
                                      learning: event.target.value,
                                    },
                                  }))
                                }
                                placeholder="Cosa imparare per le prossime volte"
                              />
                              <div className="mt-1 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSaveEdit(task.id)}
                                  disabled={Boolean(updatingById[task.id])}
                                  className="rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-1 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/20 disabled:opacity-60"
                                >
                                  {updatingById[task.id]
                                    ? "Salvo..."
                                    : "Salva"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCancelEdit(task.id)}
                                  className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--accent)]"
                                >
                                  Annulla
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div>
                                <p className="uppercase tracking-[0.14em] text-[10px]">
                                  Cosa fare nel mentre
                                </p>
                                <p className="mt-0.5 whitespace-pre-wrap text-[var(--ink)]">
                                  {meta.meanwhile || "—"}
                                </p>
                              </div>
                              <div>
                                <p className="uppercase tracking-[0.14em] text-[10px]">
                                  Cosa imparare per le prossime volte
                                </p>
                                <p className="mt-0.5 whitespace-pre-wrap text-[var(--ink)]">
                                  {meta.learning || "—"}
                                </p>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleToggleDone(task)}
                                  disabled={Boolean(updatingById[task.id])}
                                  className="rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-1 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/20 disabled:opacity-60"
                                >
                                  {updatingById[task.id]
                                    ? "Aggiorno..."
                                    : "Segna completato"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(task)}
                                  className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--accent)]"
                                >
                                  Modifica
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTask(task.id)}
                                  disabled={Boolean(deletingById[task.id])}
                                  className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-200 transition hover:border-red-400/70 disabled:opacity-60"
                                >
                                  {deletingById[task.id]
                                    ? "Elimino..."
                                    : "Elimina"}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </details>
                    );
                  })}
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
            {doneTasks.map((task) => {
              const meta = parseTaskMeta(task.notes);
              const isEditing = Boolean(editingById[task.id]);
              const editDraft = editDraftById[task.id];

              return (
                <div
                  key={task.id}
                  className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2"
                >
                  {isEditing && editDraft ? (
                    <div className="grid gap-2 text-xs text-[var(--muted)]">
                      <input
                        value={editDraft.title}
                        onChange={(event) =>
                          setEditDraftById((prev) => ({
                            ...prev,
                            [task.id]: {
                              ...editDraft,
                              title: event.target.value,
                            },
                          }))
                        }
                        placeholder="Titolo task"
                      />
                      <select
                        value={editDraft.priority}
                        onChange={(event) =>
                          setEditDraftById((prev) => ({
                            ...prev,
                            [task.id]: {
                              ...editDraft,
                              priority: event.target.value as TodoPriority,
                            },
                          }))
                        }
                      >
                        <option value="alta">Priorita alta</option>
                        <option value="media">Priorita media</option>
                        <option value="continuativo">
                          Priorita continuativo
                        </option>
                        <option value="bassa">Priorita bassa</option>
                      </select>
                      <textarea
                        rows={2}
                        value={editDraft.meanwhile}
                        onChange={(event) =>
                          setEditDraftById((prev) => ({
                            ...prev,
                            [task.id]: {
                              ...editDraft,
                              meanwhile: event.target.value,
                            },
                          }))
                        }
                        placeholder="Cosa fare nel mentre"
                      />
                      <textarea
                        rows={2}
                        value={editDraft.learning}
                        onChange={(event) =>
                          setEditDraftById((prev) => ({
                            ...prev,
                            [task.id]: {
                              ...editDraft,
                              learning: event.target.value,
                            },
                          }))
                        }
                        placeholder="Cosa imparare per le prossime volte"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(task.id)}
                          disabled={Boolean(updatingById[task.id])}
                          className="rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-1 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/20 disabled:opacity-60"
                        >
                          {updatingById[task.id] ? "Salvo..." : "Salva"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelEdit(task.id)}
                          className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--accent)]"
                        >
                          Annulla
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2 text-xs text-[var(--muted)]">
                      <p className="text-sm text-[var(--muted)] line-through">
                        {task.title}
                      </p>
                      {(meta.meanwhile || meta.learning) && (
                        <div className="grid gap-1">
                          <p className="text-[10px] uppercase tracking-[0.14em]">
                            Dettagli
                          </p>
                          {meta.meanwhile && (
                            <p className="whitespace-pre-wrap">
                              Nel mentre: {meta.meanwhile}
                            </p>
                          )}
                          {meta.learning && (
                            <p className="whitespace-pre-wrap">
                              Imparare: {meta.learning}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleDone(task)}
                          disabled={Boolean(updatingById[task.id])}
                          className="rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-1 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/20 disabled:opacity-60"
                        >
                          {updatingById[task.id] ? "Aggiorno..." : "Riapri"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(task)}
                          className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--accent)]"
                        >
                          Modifica
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTask(task.id)}
                          disabled={Boolean(deletingById[task.id])}
                          className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-200 transition hover:border-red-400/70 disabled:opacity-60"
                        >
                          {deletingById[task.id] ? "Elimino..." : "Elimina"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      </section>
    </div>
  );
}
