"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabaseClient";

const STATUS_OPTIONS = [
  "Da contattare",
  "In corso",
  "In attesa",
  "Chiuso",
] as const;

type Status = (typeof STATUS_OPTIONS)[number];

type Contact = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  status: Status;
  last_action_at: string | null;
  last_action_note: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type DraftContact = Omit<Contact, "created_at" | "updated_at">;

type NewContact = {
  name: string;
  email: string;
  company: string;
  role: string;
};

const emptyNewContact: NewContact = {
  name: "",
  email: "",
  company: "",
  role: "",
};

const statusStyles: Record<Status, string> = {
  "Da contattare": "bg-amber-100 text-amber-800 border-amber-200",
  "In corso": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "In attesa": "bg-sky-100 text-sky-800 border-sky-200",
  "Chiuso": "bg-zinc-200 text-zinc-700 border-zinc-300",
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
  });
};

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join("");
};

export default function CrmApp() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newContact, setNewContact] = useState<NewContact>(emptyNewContact);
  const [draft, setDraft] = useState<DraftContact | null>(null);

  const selected = contacts.find((contact) => contact.id === selectedId) || null;

  const counts = useMemo(() => {
    return STATUS_OPTIONS.reduce(
      (acc, status) => {
        acc[status] = contacts.filter((contact) => contact.status === status)
          .length;
        return acc;
      },
      {} as Record<Status, number>
    );
  }, [contacts]);

  const loadContacts = async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("contacts")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError("Impossibile caricare i contatti. Controlla il database.");
      setLoading(false);
      return;
    }

    setContacts((data as Contact[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    loadContacts();
  }, []);

  useEffect(() => {
    if (selected) {
      const { created_at, updated_at, ...rest } = selected;
      setDraft({ ...rest });
    } else {
      setDraft(null);
    }
  }, [selectedId, selected?.updated_at]);

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    if (!newContact.name.trim()) return;

    setAdding(true);
    setError(null);

    const { data, error: insertError } = await supabase
      .from("contacts")
      .insert({
        name: newContact.name.trim(),
        email: newContact.email.trim() || null,
        company: newContact.company.trim() || null,
        role: newContact.role.trim() || null,
        status: "Da contattare",
      })
      .select("*")
      .single();

    if (insertError) {
      setError("Impossibile salvare. Controlla le policy del database.");
      setAdding(false);
      return;
    }

    setContacts((prev) => [data as Contact, ...prev]);
    setSelectedId((data as Contact).id);
    setNewContact(emptyNewContact);
    setAdding(false);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);

    const { id, ...updates } = draft;
    const { data, error: updateError } = await supabase
      .from("contacts")
      .update({
        ...updates,
        name: updates.name.trim(),
        email: updates.email?.trim() || null,
        company: updates.company?.trim() || null,
        role: updates.role?.trim() || null,
        last_action_at: updates.last_action_at || null,
        last_action_note: updates.last_action_note?.trim() || null,
        next_action_at: updates.next_action_at || null,
        next_action_note: updates.next_action_note?.trim() || null,
        notes: updates.notes?.trim() || null,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      setError("Impossibile aggiornare. Riprova.");
      setSaving(false);
      return;
    }

    setContacts((prev) =>
      prev.map((contact) => (contact.id === id ? (data as Contact) : contact))
    );
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    setError(null);

    const { error: deleteError } = await supabase
      .from("contacts")
      .delete()
      .eq("id", selected.id);

    if (deleteError) {
      setError("Impossibile eliminare. Riprova.");
      setDeleting(false);
      return;
    }

    setContacts((prev) => prev.filter((contact) => contact.id !== selected.id));
    setSelectedId(null);
    setDeleting(false);
  };

  return (
    <div className="min-h-screen px-6 pb-16 pt-10 sm:px-10">
      <header className="mx-auto mb-10 flex w-full max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
              CRM personale
            </p>
            <h1 className="text-3xl font-semibold text-[var(--ink)] sm:text-4xl">
              Contatti registi e produzioni
            </h1>
          </div>
          <div className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--muted)]">
            Ultimo sync: manuale
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((status) => (
            <div
              key={status}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusStyles[status]}`}
            >
              <span>{status}</span>
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px]">
                {counts[status] ?? 0}
              </span>
            </div>
          ))}
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[340px_1fr]">
        <section className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_10px_40px_-30px_rgba(0,0,0,0.4)]">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Nuovo contatto
          </h2>
          <form onSubmit={handleAdd} className="mt-4 grid gap-3">
            <input
              placeholder="Nome e cognome"
              value={newContact.name}
              onChange={(event) =>
                setNewContact((prev) => ({ ...prev, name: event.target.value }))
              }
              required
            />
            <input
              placeholder="Email"
              type="email"
              value={newContact.email}
              onChange={(event) =>
                setNewContact((prev) => ({ ...prev, email: event.target.value }))
              }
            />
            <input
              placeholder="Produzione / Studio"
              value={newContact.company}
              onChange={(event) =>
                setNewContact((prev) => ({
                  ...prev,
                  company: event.target.value,
                }))
              }
            />
            <input
              placeholder="Ruolo (regista, producer)"
              value={newContact.role}
              onChange={(event) =>
                setNewContact((prev) => ({ ...prev, role: event.target.value }))
              }
            />
            <button
              type="submit"
              disabled={adding}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
            >
              {adding ? "Salvo..." : "+ Aggiungi"}
            </button>
          </form>

          <div className="mt-8 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            <span>Contatti</span>
            <span>{contacts.length}</span>
          </div>

          <div className="mt-4 grid gap-3">
            {loading && (
              <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                Caricamento...
              </div>
            )}
            {!loading && contacts.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                Nessun contatto ancora. Aggiungi il primo.
              </div>
            )}
            {contacts.map((contact) => (
              <button
                key={contact.id}
                onClick={() => setSelectedId(contact.id)}
                className={`flex w-full flex-col gap-3 rounded-2xl border px-4 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${
                  contact.id === selectedId
                    ? "border-[var(--accent)] bg-[var(--panel-strong)]"
                    : "border-[var(--line)] bg-white/60"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">
                      {getInitials(contact.name)}
                    </div>
                    <div>
                      <div className="text-sm font-semibold">
                        {contact.name}
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        {[contact.role, contact.company]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusStyles[contact.status]}`}
                  >
                    {contact.status}
                  </span>
                </div>
                <div className="text-xs text-[var(--muted)]">
                  Prossima azione: {formatDate(contact.next_action_at)}
                  {contact.next_action_note
                    ? ` · ${contact.next_action_note}`
                    : ""}
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[0_10px_40px_-30px_rgba(0,0,0,0.4)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                Dettagli
              </p>
              <h2 className="text-2xl font-semibold">Scheda contatto</h2>
            </div>
            {selected && (
              <div className="rounded-full border border-[var(--line)] bg-white/70 px-3 py-1 text-xs text-[var(--muted)]">
                Creato il {formatDate(selected.created_at)}
              </div>
            )}
          </div>

          {!selected && (
            <div className="mt-10 rounded-2xl border border-dashed border-[var(--line)] p-6 text-sm text-[var(--muted)]">
              Seleziona un contatto per vedere i dettagli.
            </div>
          )}

          {selected && draft && (
            <div className="mt-6 grid gap-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Nome
                  </label>
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      setDraft((prev) =>
                        prev ? { ...prev, name: event.target.value } : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Email
                  </label>
                  <input
                    type="email"
                    value={draft.email ?? ""}
                    onChange={(event) =>
                      setDraft((prev) =>
                        prev ? { ...prev, email: event.target.value } : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Produzione
                  </label>
                  <input
                    value={draft.company ?? ""}
                    onChange={(event) =>
                      setDraft((prev) =>
                        prev ? { ...prev, company: event.target.value } : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Ruolo
                  </label>
                  <input
                    value={draft.role ?? ""}
                    onChange={(event) =>
                      setDraft((prev) =>
                        prev ? { ...prev, role: event.target.value } : prev
                      )
                    }
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Stato
                  </label>
                  <select
                    value={draft.status}
                    onChange={(event) =>
                      setDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              status: event.target.value as Status,
                            }
                          : prev
                      )
                    }
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Ultimo contatto
                  </label>
                  <input
                    type="date"
                    value={draft.last_action_at ?? ""}
                    onChange={(event) =>
                      setDraft((prev) =>
                        prev
                          ? { ...prev, last_action_at: event.target.value }
                          : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Nota ultimo contatto
                  </label>
                  <input
                    value={draft.last_action_note ?? ""}
                    onChange={(event) =>
                      setDraft((prev) =>
                        prev
                          ? { ...prev, last_action_note: event.target.value }
                          : prev
                      )
                    }
                    placeholder="Email inviata, call, follow-up..."
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Prossima azione
                  </label>
                  <input
                    type="date"
                    value={draft.next_action_at ?? ""}
                    onChange={(event) =>
                      setDraft((prev) =>
                        prev
                          ? { ...prev, next_action_at: event.target.value }
                          : prev
                      )
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Nota prossima azione
                  </label>
                  <input
                    value={draft.next_action_note ?? ""}
                    onChange={(event) =>
                      setDraft((prev) =>
                        prev
                          ? { ...prev, next_action_note: event.target.value }
                          : prev
                      )
                    }
                    placeholder="Follow-up tra 7 giorni"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                  Note libere
                </label>
                <textarea
                  rows={4}
                  value={draft.notes ?? ""}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev ? { ...prev, notes: event.target.value } : prev
                    )
                  }
                  placeholder="Mood della conversazione, preferenze, referenze, ecc."
                />
              </div>

              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
                >
                  {saving ? "Salvo..." : "Salva modifiche"}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50 disabled:opacity-60"
                >
                  {deleting ? "Elimino..." : "Elimina contatto"}
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
