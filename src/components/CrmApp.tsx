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

type EmailDirection = "inbound" | "outbound";

type EmailRow = {
  id: string;
  contact_id: string | null;
  direction: EmailDirection;
  gmail_uid: number | null;
  message_id_header: string | null;
  from_email: string | null;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  received_at: string | null;
  created_at: string | null;
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

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const normalizeThreadSubject = (subject?: string | null) => {
  const fallback = "Senza oggetto";
  if (!subject) return fallback;
  let normalized = subject.trim();
  if (!normalized) return fallback;
  normalized = normalized.replace(/^(re|fw|fwd|ris)\s*:\s*/gi, "");
  while (/^(re|fw|fwd|ris)\s*:\s*/i.test(normalized)) {
    normalized = normalized.replace(/^(re|fw|fwd|ris)\s*:\s*/gi, "");
  }
  return normalized.trim() || fallback;
};

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join("");
};

const buildDraft = (contact: Contact): DraftContact => ({
  id: contact.id,
  name: contact.name,
  email: contact.email,
  company: contact.company,
  role: contact.role,
  status: contact.status,
  last_action_at: contact.last_action_at,
  last_action_note: contact.last_action_note,
  next_action_at: contact.next_action_at,
  next_action_note: contact.next_action_note,
  notes: contact.notes,
});

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
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsError, setEmailsError] = useState<string | null>(null);
  const [emailReadById, setEmailReadById] = useState<Record<string, boolean>>(
    {}
  );
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  const selected = contacts.find((contact) => contact.id === selectedId) || null;
  const selectedEmail =
    emails.find((email) => email.id === selectedEmailId) || null;

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

  const emailThreads = useMemo(() => {
    if (!emails.length) return [];
    const grouped = new Map<
      string,
      { key: string; subject: string; messages: EmailRow[] }
    >();

    emails.forEach((email) => {
      const subject = normalizeThreadSubject(email.subject);
      const key = subject.toLowerCase();
      if (!grouped.has(key)) {
        grouped.set(key, { key, subject, messages: [] });
      }
      grouped.get(key)!.messages.push(email);
    });

    const threads = Array.from(grouped.values()).map((thread) => {
      thread.messages.sort(
        (a, b) => getTimestamp(b.received_at) - getTimestamp(a.received_at)
      );
      const latest = thread.messages[0] ?? null;
      const unreadCount = thread.messages.reduce((acc, message) => {
        if (
          message.direction === "inbound" &&
          !(emailReadById[message.id] ?? true)
        ) {
          return acc + 1;
        }
        return acc;
      }, 0);
      return {
        ...thread,
        latestAt: latest?.received_at ?? null,
        unreadCount,
        total: thread.messages.length,
      };
    });

    threads.sort(
      (a, b) => getTimestamp(b.latestAt) - getTimestamp(a.latestAt)
    );

    return threads;
  }, [emails, emailReadById]);

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

  const loadEmails = async (contactId: string | null, email?: string | null) => {
    if (!contactId) {
      setEmails([]);
      setSelectedEmailId(null);
      setEmailReadById({});
      return;
    }

    setEmailsLoading(true);
    setEmailsError(null);
    const query = supabase
      .from("emails")
      .select(
        "id, contact_id, direction, gmail_uid, message_id_header, from_email, from_name, to_email, subject, text_body, html_body, received_at, created_at"
      )
      .order("received_at", { ascending: false });

    const { data, error: fetchError } = email
      ? await query.or(
          `contact_id.eq.${contactId},from_email.ilike.%${email}%,to_email.ilike.%${email}%`
        )
      : await query.eq("contact_id", contactId);

    if (fetchError) {
      setEmailsError("Impossibile caricare le email.");
      setEmailsLoading(false);
      return;
    }

    const emailRows = (data as EmailRow[]) || [];
    const readMap: Record<string, boolean> = {};
    emailRows.forEach((row) => {
      readMap[row.id] = true;
    });

    const inboundIds = emailRows
      .filter((row) => row.direction === "inbound")
      .map((row) => row.id);

    if (inboundIds.length) {
      const { data: notifications, error: notificationsError } =
        await supabase
          .from("notifications")
          .select("email_id, is_read")
          .in("email_id", inboundIds)
          .eq("type", "email_received");

      if (!notificationsError && notifications) {
        notifications.forEach((notification) => {
          if (!notification.email_id) return;
          const isRead = Boolean(notification.is_read);
          if (readMap[notification.email_id] === undefined) {
            readMap[notification.email_id] = isRead;
          } else {
            readMap[notification.email_id] =
              readMap[notification.email_id] && isRead;
          }
        });
      }
    }

    setEmails(emailRows);
    setEmailReadById(readMap);
    setEmailsLoading(false);
  };

  const handleSelectContact = (contact: Contact) => {
    setSelectedId(contact.id);
    setDraft(buildDraft(contact));
    setSelectedEmailId(null);
    loadEmails(contact.id, contact.email);
  };

  const handleSelectEmail = async (emailId: string) => {
    setSelectedEmailId(emailId);
    setEmailReadById((prev) => ({ ...prev, [emailId]: true }));
    const selectedRow = emails.find((email) => email.id === emailId);
    if (selectedRow?.direction !== "inbound") return;
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("email_id", emailId)
      .eq("type", "email_received");
  };

  const getReplyTarget = () => {
    if (selectedEmail?.direction === "inbound") return selectedEmail;
    return emails.find((email) => email.direction === "inbound") || null;
  };

  const handleSendEmail = async () => {
    if (!selected?.email?.trim()) {
      setEmailsError("Aggiungi un'email al contatto per poter rispondere.");
      return;
    }

    if (!emailSubject.trim() && !emailBody.trim()) {
      setEmailsError("Scrivi almeno un oggetto o un messaggio.");
      return;
    }

    setSendingEmail(true);
    setEmailsError(null);
    const replyTarget = getReplyTarget();

    const response = await fetch("/api/gmail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: selected.email.trim(),
        subject: emailSubject.trim() || undefined,
        text: emailBody.trim() || undefined,
        replyToEmailId: replyTarget?.id ?? undefined,
      }),
    });

    if (!response.ok) {
      setEmailsError("Invio email fallito. Riprova.");
      setSendingEmail(false);
      return;
    }

    setEmailSubject("");
    setEmailBody("");
    await loadEmails(selected.id, selected.email);
    setSendingEmail(false);
  };

  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);

    const response = await fetch("/api/gmail/sync-now", { method: "POST" });

    if (!response.ok) {
      setSyncMessage("Sync fallita. Riprova.");
      setSyncing(false);
      return;
    }

    setLastSyncAt(new Date());
    setSyncMessage("Sync completata.");
    if (selected) {
      await loadEmails(selected.id, selected.email);
    }
    setSyncing(false);
  };

  useEffect(() => {
    loadContacts();
  }, []);

  useEffect(() => {
    handleSyncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    if (!newContact.name.trim()) return;

    setAdding(true);
    setError(null);
    const today = new Date().toISOString().slice(0, 10);

    const { data, error: insertError } = await supabase
      .from("contacts")
      .insert({
        name: newContact.name.trim(),
        email: newContact.email.trim() || null,
        company: newContact.company.trim() || null,
        role: newContact.role.trim() || null,
        status: "Da contattare",
        last_action_at: today,
      })
      .select("*")
      .single();

    if (insertError) {
      setError("Impossibile salvare. Controlla le policy del database.");
      setAdding(false);
      return;
    }

    const created = data as Contact;
    setContacts((prev) => [created, ...prev]);
    setSelectedId(created.id);
    setDraft(buildDraft(created));
    loadEmails(created.id, created.email);
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

    const updated = data as Contact;
    setContacts((prev) =>
      prev.map((contact) => (contact.id === id ? updated : contact))
    );
    setDraft(buildDraft(updated));
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
    setDraft(null);
    setEmails([]);
    setSelectedEmailId(null);
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
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--muted)]">
              Ultimo sync:{" "}
              {lastSyncAt
                ? lastSyncAt.toLocaleTimeString("it-IT", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "mai"}
            </div>
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={syncing}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
            >
              {syncing ? "Sync..." : "Sync ora"}
            </button>
          </div>
        </div>
        {syncMessage && (
          <div className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-2 text-xs text-[var(--muted)]">
            {syncMessage}
          </div>
        )}
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
                onClick={() => handleSelectContact(contact)}
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

              <div className="mt-8 grid gap-4 rounded-2xl border border-[var(--line)] bg-white/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                      Email
                    </div>
                    <div className="text-sm font-semibold">
                      Storico conversazioni
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadEmails(selected.id, selected.email)}
                    className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold text-[var(--muted)]"
                  >
                    Aggiorna
                  </button>
                </div>

                {emailsLoading && (
                  <div className="rounded-xl border border-dashed border-[var(--line)] p-3 text-sm text-[var(--muted)]">
                    Caricamento email...
                  </div>
                )}

                {!emailsLoading && emails.length === 0 && (
                  <div className="rounded-xl border border-dashed border-[var(--line)] p-3 text-sm text-[var(--muted)]">
                    Nessuna email per questo contatto.
                  </div>
                )}

                <div className="grid gap-3">
                  {emailThreads.map((thread, threadIndex) => (
                    <details
                      key={thread.key}
                      className="rounded-2xl border border-[var(--line)] bg-white/70"
                      defaultOpen={threadIndex === 0}
                    >
                      <summary className="cursor-pointer list-none">
                        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                          <div>
                            <div className="text-sm font-semibold text-[var(--ink)]">
                              {thread.subject}
                            </div>
                            <div className="mt-1 text-xs text-[var(--muted)]">
                              Ultima attivita{" "}
                              {formatDateTime(thread.latestAt)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="rounded-full border border-[var(--line)] bg-white px-2 py-0.5 font-semibold text-[var(--muted)]">
                              {thread.total} messaggi
                            </span>
                            {thread.unreadCount > 0 && (
                              <span className="rounded-full border border-[var(--accent)] bg-[var(--panel-strong)] px-2 py-0.5 font-semibold text-[var(--accent)]">
                                {thread.unreadCount} non letti
                              </span>
                            )}
                          </div>
                        </div>
                      </summary>
                      <div className="border-t border-[var(--line)] px-4 py-3">
                        <div className="grid gap-2">
                          {thread.messages.map((email) => {
                            const address =
                              email.direction === "inbound"
                                ? email.from_email
                                : email.to_email;
                            const preview =
                              email.subject ||
                              email.text_body?.replace(/\s+/g, " ").trim() ||
                              "Senza oggetto";
                            const isRead = emailReadById[email.id] ?? true;
                            const directionLabel =
                              email.direction === "inbound"
                                ? "Ricevuta"
                                : "Inviata";
                            const directionStyle =
                              email.direction === "inbound"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-amber-200 bg-amber-50 text-amber-700";
                            return (
                              <button
                                key={email.id}
                                type="button"
                                onClick={() => handleSelectEmail(email.id)}
                                className={`rounded-xl border px-3 py-2 text-left transition ${
                                  email.id === selectedEmailId
                                    ? "border-[var(--accent)] bg-[var(--panel-strong)]"
                                    : isRead
                                      ? "border-[var(--line)] bg-white"
                                      : "border-[var(--accent)] bg-[var(--panel-strong)]"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
                                  <span className="flex items-center gap-2">
                                    {!isRead && (
                                      <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                                    )}
                                    <span>
                                      {email.direction === "inbound"
                                        ? "Da"
                                        : "A"}{" "}
                                      {address || "—"}
                                    </span>
                                  </span>
                                  <span className="flex items-center gap-2">
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${directionStyle}`}
                                    >
                                      {directionLabel}
                                    </span>
                                    <span>
                                      {formatDateTime(email.received_at)}
                                    </span>
                                  </span>
                                </div>
                                <div
                                  className={`mt-1 text-sm text-[var(--ink)] ${
                                    isRead ? "font-semibold" : "font-bold"
                                  }`}
                                >
                                  {preview.length > 120
                                    ? `${preview.slice(0, 120)}…`
                                    : preview}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </details>
                  ))}
                </div>

                {selectedEmail && (
                  <div className="rounded-xl border border-[var(--line)] bg-white p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                      Dettaglio email
                    </div>
                    <div className="mt-2 text-sm font-semibold">
                      {selectedEmail.subject || "Senza oggetto"}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          selectedEmail.direction === "inbound"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {selectedEmail.direction === "inbound"
                          ? "Ricevuta"
                          : "Inviata"}
                      </span>
                      <span>
                        {selectedEmail.direction === "inbound" ? "Da" : "A"}{" "}
                        {selectedEmail.direction === "inbound"
                          ? selectedEmail.from_email
                          : selectedEmail.to_email}
                      </span>
                      <span>·</span>
                      <span>{formatDateTime(selectedEmail.received_at)}</span>
                    </div>
                    <div className="mt-3 whitespace-pre-wrap text-sm text-[var(--ink)]">
                      {selectedEmail.text_body ||
                        "Nessun testo disponibile per questa email."}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-[var(--line)] bg-white p-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    Rispondi
                  </div>
                  <div className="mt-2 text-xs text-[var(--muted)]">
                    A: {selected.email || "—"}
                  </div>
                  <input
                    className="mt-3 w-full"
                    placeholder="Oggetto"
                    value={emailSubject}
                    onChange={(event) => setEmailSubject(event.target.value)}
                  />
                  <textarea
                    className="mt-3 w-full"
                    rows={4}
                    placeholder="Scrivi il messaggio..."
                    value={emailBody}
                    onChange={(event) => setEmailBody(event.target.value)}
                  />
                  {emailsError && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {emailsError}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSendEmail}
                      disabled={sendingEmail}
                      className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
                    >
                      {sendingEmail ? "Invio..." : "Invia email"}
                    </button>
                    {getReplyTarget() && (
                      <span className="text-xs text-[var(--muted)]">
                        Risposta collegata al thread esistente.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
