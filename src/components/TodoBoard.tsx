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

type TaskLink = {
  url: string;
  label: string;
};

type TodoDraft = {
  title: string;
  priority: TodoPriority;
  meanwhile: string;
  learning: string;
  note: string;
  links: TaskLink[];
};

type TodoEditDraft = TodoDraft;

type TaskMeta = {
  meanwhile: string;
  learning: string;
  note: string;
  links: TaskLink[];
  bucket?: "continuativo";
};

const PRIORITIES: TodoPriority[] = ["continuativo", "alta", "media", "bassa"];
const TASK_META_PREFIX = "__todo_meta_v1__:";

const priorityRank: Record<TodoPriority, number> = {
  continuativo: 0,
  alta: 1,
  media: 2,
  bassa: 3,
};

const priorityStyles: Record<TodoPriority, string> = {
  alta: "border-rose-400/40 bg-rose-500/10 text-rose-200",
  media: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  continuativo: "border-cyan-400/40 bg-cyan-500/10 text-cyan-200",
  bassa: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
};

const emptyLink: TaskLink = { url: "", label: "" };

const emptyDraft: TodoDraft = {
  title: "",
  priority: "media",
  meanwhile: "",
  learning: "",
  note: "",
  links: [{ ...emptyLink }],
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
  note: string,
  links: TaskLink[],
  selectedPriority: TodoPriority
) => {
  const normalizedLinks = links
    .map((link) => ({
      url: link.url.trim(),
      label: link.label.trim(),
    }))
    .filter((link) => Boolean(link.url));

  const payload: TaskMeta = {
    meanwhile: meanwhile.trim(),
    learning: learning.trim(),
    note: note.trim(),
    links: normalizedLinks,
    ...(selectedPriority === "continuativo"
      ? { bucket: "continuativo" as const }
      : {}),
  };
  if (
    !payload.meanwhile &&
    !payload.learning &&
    !payload.note &&
    payload.links.length === 0 &&
    !payload.bucket
  )
    return null;
  return `${TASK_META_PREFIX}${JSON.stringify(payload)}`;
};

const parseTaskMeta = (value?: string | null): TaskMeta => {
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
    ) as Partial<TaskMeta>;
    const parsedWithLegacy = parsed as Partial<TaskMeta> & {
      link?: string;
      linkUrl?: string;
      linkLabel?: string;
      links?: unknown;
    };

    const parsedLinks = Array.isArray(parsedWithLegacy.links)
      ? parsedWithLegacy.links
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const asLink = item as Partial<TaskLink>;
            const url =
              typeof asLink.url === "string" ? asLink.url.trim() : "";
            const label =
              typeof asLink.label === "string" ? asLink.label.trim() : "";
            if (!url) return null;
            return { url, label };
          })
          .filter((item): item is TaskLink => Boolean(item))
      : [];

    const legacyLinkUrl =
      typeof parsedWithLegacy.linkUrl === "string"
        ? parsedWithLegacy.linkUrl.trim()
        : typeof parsedWithLegacy.link === "string"
          ? parsedWithLegacy.link.trim()
          : "";
    const legacyLinkLabel =
      typeof parsedWithLegacy.linkLabel === "string"
        ? parsedWithLegacy.linkLabel.trim()
        : "";
    const legacyLinks = legacyLinkUrl
      ? [{ url: legacyLinkUrl, label: legacyLinkLabel }]
      : [];

    return {
      meanwhile:
        typeof parsed.meanwhile === "string" ? parsed.meanwhile : "",
      learning: typeof parsed.learning === "string" ? parsed.learning : "",
      note: typeof parsed.note === "string" ? parsed.note : "",
      links: parsedLinks.length > 0 ? parsedLinks : legacyLinks,
      bucket: parsed.bucket === "continuativo" ? "continuativo" : undefined,
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

const getTaskBucket = (task: TodoTask): TodoPriority => {
  if (task.priority === "continuativo") return "continuativo";
  const meta = parseTaskMeta(task.notes);
  if (meta.bucket === "continuativo") return "continuativo";
  return task.priority;
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
    .filter((item): item is { href: string; label: string } => Boolean(item));

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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [openTaskDetailsById, setOpenTaskDetailsById] = useState<
    Record<string, boolean>
  >({});

  const updateDraftLink = (
    index: number,
    field: keyof TaskLink,
    value: string
  ) => {
    setDraft((prev) => ({
      ...prev,
      links: prev.links.map((link, currentIndex) =>
        currentIndex === index ? { ...link, [field]: value } : link
      ),
    }));
  };

  const addDraftLink = () => {
    setDraft((prev) => ({
      ...prev,
      links: [...prev.links, { ...emptyLink }],
    }));
  };

  const removeDraftLink = (index: number) => {
    setDraft((prev) => {
      if (prev.links.length === 1) return prev;
      return {
        ...prev,
        links: prev.links.filter((_, currentIndex) => currentIndex !== index),
      };
    });
  };

  const updateEditLink = (
    taskId: string,
    index: number,
    field: keyof TaskLink,
    value: string
  ) => {
    setEditDraftById((prev) => {
      const currentDraft = prev[taskId];
      if (!currentDraft) return prev;
      return {
        ...prev,
        [taskId]: {
          ...currentDraft,
          links: currentDraft.links.map((link, currentIndex) =>
            currentIndex === index ? { ...link, [field]: value } : link
          ),
        },
      };
    });
  };

  const addEditLink = (taskId: string) => {
    setEditDraftById((prev) => {
      const currentDraft = prev[taskId];
      if (!currentDraft) return prev;
      return {
        ...prev,
        [taskId]: {
          ...currentDraft,
          links: [...currentDraft.links, { ...emptyLink }],
        },
      };
    });
  };

  const removeEditLink = (taskId: string, index: number) => {
    setEditDraftById((prev) => {
      const currentDraft = prev[taskId];
      if (!currentDraft || currentDraft.links.length === 1) return prev;
      return {
        ...prev,
        [taskId]: {
          ...currentDraft,
          links: currentDraft.links.filter(
            (_, currentIndex) => currentIndex !== index
          ),
        },
      };
    });
  };

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
        notes: buildTaskMeta(
          draft.meanwhile,
          draft.learning,
          draft.note,
          draft.links,
          draft.priority
        ),
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
    setOpenMenuId(null);
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
    setOpenMenuId(null);
    setEditDraftById((prev) => ({
      ...prev,
      [task.id]: {
        title: task.title,
        priority: getTaskBucket(task),
        meanwhile: meta.meanwhile,
        learning: meta.learning,
        note: meta.note,
        links: meta.links.length > 0 ? meta.links : [{ ...emptyLink }],
      },
    }));
    setOpenTaskDetailsById((prev) => ({ ...prev, [task.id]: true }));
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
          editDraft.note,
          editDraft.links,
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
    setOpenMenuId(null);
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
                <option value="alta">Priorità alta</option>
                <option value="media">Priorità media</option>
                <option value="continuativo">Priorità continuativo</option>
                <option value="bassa">Priorità bassa</option>
              </select>
              <button
                type="submit"
                disabled={adding}
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
              >
                {adding ? "Aggiungo..." : "+ Aggiungi"}
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
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
              <textarea
                rows={2}
                value={draft.note}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, note: event.target.value }))
                }
                placeholder="Note"
              />
            </div>
            <div className="grid gap-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
                Link (multipli)
              </p>
              {draft.links.map((link, index) => (
                <div
                  key={`new-link-${index}`}
                  className="grid gap-2 lg:grid-cols-[1fr_1fr_auto]"
                >
                  <input
                    value={link.url}
                    onChange={(event) =>
                      updateDraftLink(index, "url", event.target.value)
                    }
                    placeholder="URL pulsante (opzionale)"
                  />
                  <input
                    value={link.label}
                    onChange={(event) =>
                      updateDraftLink(index, "label", event.target.value)
                    }
                    placeholder="Nome pulsante (es. Apri documento)"
                  />
                  <button
                    type="button"
                    onClick={() => removeDraftLink(index)}
                    disabled={draft.links.length === 1}
                    className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-xs font-semibold text-[var(--muted)] transition hover:border-red-400 hover:text-red-200 disabled:opacity-40"
                  >
                    Rimuovi
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addDraftLink}
                className="w-fit rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
              >
                + Aggiungi link
              </button>
            </div>
          </form>
        </section>

        {error && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </header>

      <main className="relative mx-auto grid w-full max-w-6xl items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PRIORITIES.map((priority) => {
          const column = groupedOpenTasks[priority];
          return (
            <section
              key={priority}
              className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-lg"
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
                    const taskLinks = toDisplayLinks(meta.links);
                    const isEditing = Boolean(editingById[task.id]);
                    const editDraft = editDraftById[task.id];
                    return (
                      <details
                        key={task.id}
                        className="relative min-w-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2"
                        open={isEditing || Boolean(openTaskDetailsById[task.id])}
                        onToggle={(event) => {
                          const isOpen = (event.currentTarget as HTMLDetailsElement)
                            .open;
                          setOpenTaskDetailsById((prev) => ({
                            ...prev,
                            [task.id]: isOpen,
                          }));
                        }}
                      >
                        <summary className="cursor-pointer break-words pr-6 text-left text-sm font-semibold text-[var(--ink)]">
                          {task.title}
                        </summary>
                        {!isEditing && (
                          <div className="absolute right-2 top-2">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenMenuId((prev) =>
                                  prev === task.id ? null : task.id
                                )
                              }
                              className="px-1 py-0 text-base font-semibold leading-none text-[var(--muted)] transition hover:text-[var(--ink)]"
                              aria-label="Azioni task"
                            >
                              ...
                            </button>
                            {openMenuId === task.id && (
                              <div className="absolute right-0 z-30 mt-1 w-32 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-1 shadow-lg">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    handleStartEdit(task);
                                  }}
                                  className="w-full rounded-lg px-2 py-1 text-left text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--panel-strong)]"
                                >
                                  Modifica
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTask(task.id)}
                                  disabled={Boolean(deletingById[task.id])}
                                  className="w-full rounded-lg px-2 py-1 text-left text-xs font-semibold text-red-200 transition hover:bg-red-500/10 disabled:opacity-60"
                                >
                                  {deletingById[task.id] ? "Elimino..." : "Elimina"}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
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
                                <option value="alta">Priorità alta</option>
                                <option value="media">Priorità media</option>
                                <option value="continuativo">
                                  Priorità continuativo
                                </option>
                                <option value="bassa">Priorità bassa</option>
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
                              <textarea
                                rows={2}
                                value={editDraft.note}
                                onChange={(event) =>
                                  setEditDraftById((prev) => ({
                                    ...prev,
                                    [task.id]: {
                                      ...editDraft,
                                      note: event.target.value,
                                    },
                                  }))
                                }
                                placeholder="Note"
                              />
                              <div className="grid gap-2">
                                <p className="text-[10px] uppercase tracking-[0.14em]">
                                  Link (multipli)
                                </p>
                                {editDraft.links.map((link, index) => (
                                  <div
                                    key={`${task.id}-link-${index}`}
                                    className="grid gap-2"
                                  >
                                    <input
                                      value={link.url}
                                      onChange={(event) =>
                                        updateEditLink(
                                          task.id,
                                          index,
                                          "url",
                                          event.target.value
                                        )
                                      }
                                      placeholder="URL pulsante (opzionale)"
                                    />
                                    <input
                                      value={link.label}
                                      onChange={(event) =>
                                        updateEditLink(
                                          task.id,
                                          index,
                                          "label",
                                          event.target.value
                                        )
                                      }
                                      placeholder="Nome pulsante (es. Apri documento)"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => removeEditLink(task.id, index)}
                                      disabled={editDraft.links.length === 1}
                                      className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-xs font-semibold text-[var(--muted)] transition hover:border-red-400 hover:text-red-200 disabled:opacity-40"
                                    >
                                      Rimuovi
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => addEditLink(task.id)}
                                  className="w-fit rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
                                >
                                  + Aggiungi link
                                </button>
                              </div>
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
                                      key={`${task.id}-open-link-${linkIndex}`}
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
                              <div className="mt-1 flex flex-wrap items-center gap-2">
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
              const taskLinks = toDisplayLinks(meta.links);
              const isEditing = Boolean(editingById[task.id]);
              const editDraft = editDraftById[task.id];

              return (
                <div
                  key={task.id}
                  className="relative min-w-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2"
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
                        <option value="alta">Priorità alta</option>
                        <option value="media">Priorità media</option>
                        <option value="continuativo">
                          Priorità continuativo
                        </option>
                        <option value="bassa">Priorità bassa</option>
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
                      <textarea
                        rows={2}
                        value={editDraft.note}
                        onChange={(event) =>
                          setEditDraftById((prev) => ({
                            ...prev,
                            [task.id]: {
                              ...editDraft,
                              note: event.target.value,
                            },
                          }))
                        }
                        placeholder="Note"
                      />
                      <div className="grid gap-2">
                        <p className="text-[10px] uppercase tracking-[0.14em]">
                          Link (multipli)
                        </p>
                        {editDraft.links.map((link, index) => (
                          <div
                            key={`${task.id}-done-link-${index}`}
                            className="grid gap-2"
                          >
                            <input
                              value={link.url}
                              onChange={(event) =>
                                updateEditLink(
                                  task.id,
                                  index,
                                  "url",
                                  event.target.value
                                )
                              }
                              placeholder="URL pulsante (opzionale)"
                            />
                            <input
                              value={link.label}
                              onChange={(event) =>
                                updateEditLink(
                                  task.id,
                                  index,
                                  "label",
                                  event.target.value
                                )
                              }
                              placeholder="Nome pulsante (es. Apri documento)"
                            />
                            <button
                              type="button"
                              onClick={() => removeEditLink(task.id, index)}
                              disabled={editDraft.links.length === 1}
                              className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-xs font-semibold text-[var(--muted)] transition hover:border-red-400 hover:text-red-200 disabled:opacity-40"
                            >
                              Rimuovi
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addEditLink(task.id)}
                          className="w-fit rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
                        >
                          + Aggiungi link
                        </button>
                      </div>
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
                      <div className="absolute right-2 top-2">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenMenuId((prev) =>
                              prev === task.id ? null : task.id
                            )
                          }
                          className="px-1 py-0 text-base font-semibold leading-none text-[var(--muted)] transition hover:text-[var(--ink)]"
                          aria-label="Azioni task"
                        >
                          ...
                        </button>
                        {openMenuId === task.id && (
                          <div className="absolute right-0 z-30 mt-1 w-32 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-1 shadow-lg">
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                handleStartEdit(task);
                              }}
                              className="w-full rounded-lg px-2 py-1 text-left text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--panel-strong)]"
                            >
                              Modifica
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTask(task.id)}
                              disabled={Boolean(deletingById[task.id])}
                              className="w-full rounded-lg px-2 py-1 text-left text-xs font-semibold text-red-200 transition hover:bg-red-500/10 disabled:opacity-60"
                            >
                              {deletingById[task.id] ? "Elimino..." : "Elimina"}
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="break-words text-sm text-[var(--muted)] line-through">
                        {task.title}
                      </p>
                      {(meta.meanwhile ||
                        meta.learning ||
                        meta.note ||
                        meta.links.length > 0) && (
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
                          {meta.note && (
                            <p className="whitespace-pre-wrap">
                              Note: {meta.note}
                            </p>
                          )}
                          {taskLinks.length > 0 && (
                            <div className="mt-0.5 flex flex-wrap gap-2">
                              {taskLinks.map((link, linkIndex) => (
                                <a
                                  key={`${task.id}-done-view-link-${linkIndex}`}
                                  href={link.href}
                                  target={
                                    isExternalHref(link.href) ? "_blank" : undefined
                                  }
                                  rel={
                                    isExternalHref(link.href)
                                      ? "noreferrer noopener"
                                      : undefined
                                  }
                                  className="inline-flex w-fit items-center rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/20"
                                >
                                  {link.label}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleDone(task)}
                          disabled={Boolean(updatingById[task.id])}
                          className="rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-1 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/20 disabled:opacity-60"
                        >
                          {updatingById[task.id] ? "Aggiorno..." : "Riapri"}
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
