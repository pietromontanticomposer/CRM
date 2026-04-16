"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type CrmNotification = {
  id: string;
  title: string | null;
  body: string | null;
  is_read: boolean | null;
  created_at: string;
};

type NotificationsApiResponse = {
  notifications?: CrmNotification[];
  error?: string;
};

const NOTIFICATIONS_UPDATED_EVENT = "crm:notifications-updated";
const CONTACTS_REFRESH_EVENT = "crm:contacts-refresh";

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

export default function CrmNotificationsBell() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [notifications, setNotifications] = useState<CrmNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [markingById, setMarkingById] = useState<Record<string, boolean>>({});
  const panelRef = useRef<HTMLDivElement | null>(null);

  const unreadCount = useMemo(
    () =>
      notifications.filter((notification) => notification.is_read !== true)
        .length,
    [notifications]
  );

  const loadNotifications = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    const response = await fetch("/api/notifications?scope=all&limit=100", {
      method: "GET",
      cache: "no-store",
    }).catch(() => null);

    if (!response) {
      if (!silent) setLoading(false);
      setError("Impossibile caricare le notifiche CRM.");
      return;
    }

    if (!response.ok) {
      if (!silent) setLoading(false);
      const payload = (await response.json().catch(() => null)) as
        | NotificationsApiResponse
        | null;
      setError(payload?.error?.trim() || "Impossibile caricare le notifiche CRM.");
      return;
    }

    const payload = (await response.json()) as NotificationsApiResponse;
    const incoming = payload.notifications ?? [];
    const hadUnread = notifications.some((n) => n.is_read !== true);
    const hasNewUnread = incoming.some(
      (n) => n.is_read !== true && !notifications.find((old) => old.id === n.id)
    );
    setNotifications(incoming);
    if (hasNewUnread && hadUnread !== undefined) {
      window.dispatchEvent(new Event(CONTACTS_REFRESH_EVENT));
    }
    if (!silent) setLoading(false);
  };

  const markAsRead = async (notificationId: string) => {
    setMarkingById((prev) => ({ ...prev, [notificationId]: true }));
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all", notificationId }),
    }).catch(() => null);

    if (response?.ok) {
      setNotifications((prev) =>
        prev.map((notification) =>
          notification.id === notificationId
            ? { ...notification, is_read: true }
            : notification
        )
      );
      void loadNotifications(true);
    } else {
      setError("Impossibile segnare la notifica come letta.");
    }

    setMarkingById((prev) => {
      const next = { ...prev };
      delete next[notificationId];
      return next;
    });
  };

  const markAllAsRead = async () => {
    if (!unreadCount) return;
    setMarkingAll(true);
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all", markAll: true }),
    }).catch(() => null);

    if (response?.ok) {
      setNotifications((prev) =>
        prev.map((notification) => ({ ...notification, is_read: true }))
      );
      void loadNotifications(true);
    } else {
      setError("Impossibile segnare tutte le notifiche come lette.");
    }
    setMarkingAll(false);
  };

  const togglePanel = () => {
    setOpen((current) => {
      const next = !current;
      if (next) {
        void loadNotifications(true);
      }
      return next;
    });
  };

  useEffect(() => {
    const initialTimeoutId = window.setTimeout(() => {
      void loadNotifications();
    }, 0);
    const intervalId = window.setInterval(() => {
      void loadNotifications(true);
    }, 10_000);
    const onNotificationsUpdated = () => {
      void loadNotifications(true);
    };
    const onFocus = () => {
      void loadNotifications(true);
    };
    const onVisibilityChange = () => {
      if (!document.hidden) {
        void loadNotifications(true);
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, onNotificationsUpdated);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(initialTimeoutId);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        NOTIFICATIONS_UPDATED_EVENT,
        onNotificationsUpdated
      );
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!open) return;
      const target = event.target as Node | null;
      if (panelRef.current && target && !panelRef.current.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={togglePanel}
        className="relative rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-[var(--muted)] shadow-sm transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
        aria-label="Apri notifiche CRM"
        title="Notifiche CRM"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(430px,calc(100vw-2rem))] rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-2xl">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Archivio notifiche
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={markAllAsRead}
                disabled={markingAll || unreadCount === 0}
                className="rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)] disabled:opacity-60"
              >
                {markingAll ? "Segno..." : "Segna tutto letto"}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          {!loading && !error && notifications.length === 0 && (
            <div className="mt-3 rounded-xl border border-dashed border-[var(--line)] p-3 text-xs text-[var(--muted)]">
              Nessuna notifica in archivio.
            </div>
          )}

          {notifications.length > 0 && (
            <>
              <div className="mt-2 text-[11px] text-[var(--muted)]">
                Aprire la campanella non cancella nulla. Le notifiche lette
                restano qui.
              </div>
              <div className="mt-3 grid max-h-80 gap-2 overflow-y-auto pr-1">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`rounded-xl border px-3 py-2 ${
                      notification.is_read === true
                        ? "border-[var(--line)] bg-[var(--panel-strong)]"
                        : "border-[var(--accent)] bg-[var(--accent)]/10"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs font-semibold text-[var(--ink)]">
                        {notification.title || "Notifica CRM"}
                      </div>
                      {notification.is_read !== true && (
                        <button
                          type="button"
                          onClick={() => void markAsRead(notification.id)}
                          disabled={Boolean(markingById[notification.id])}
                          className="shrink-0 rounded-full border border-[var(--line)] bg-[var(--panel)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)] disabled:opacity-60"
                        >
                          {markingById[notification.id]
                            ? "Segno..."
                            : "Segna letta"}
                        </button>
                      )}
                    </div>
                    {notification.body && (
                      <div className="mt-1 text-[11px] text-[var(--muted)]">
                        {notification.body}
                      </div>
                    )}
                    <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                      {formatDateTime(notification.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
