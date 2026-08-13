"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getToken } from "@/lib/auth";
import {
  clearServerNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api";
import { showBrowserNotification } from "@/lib/browser-notifications";
import {
  createNotificationFromEvent,
  mergeNotifications,
  notificationContextParts,
  trimNotifications,
  type GatewayEvent,
  type StoredNotification,
} from "@/lib/notifications";
import { dispatchGatewayEvent } from "@/lib/gateway-events";
import { eventsWebSocketProtocols, eventsWebSocketUrl } from "@/lib/ws";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";

interface NotificationContextValue {
  notifications: StoredNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const codexAppServerActivityTypes = new Set([
  "codex_app_server_started",
  "codex_app_server_stopped",
  "codex_app_server_error",
  "codex_app_server_initialized",
  "codex_app_server_thread_started",
  "codex_app_server_notification",
]);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [notifications, setNotifications] = useState<StoredNotification[]>([]);
  const invalidationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateNotifications = useCallback(
    (updater: (items: StoredNotification[]) => StoredNotification[]) => {
      setNotifications((current) => {
        return updater(current);
      });
    },
    []
  );

  const reloadNotifications = useCallback(async () => {
    try {
      const data = await listNotifications();
      setNotifications(trimNotifications(data.notifications));
    } catch {
      // The real-time stream can still populate notifications if the initial fetch fails.
    }
  }, []);

  const markRead = useCallback(
    (id: string) => {
      updateNotifications((current) =>
        current.map((notification) =>
          notification.id === id ? { ...notification, read: true } : notification
        )
      );
      void markNotificationRead(id).catch(() => {
        void reloadNotifications();
      });
    },
    [reloadNotifications, updateNotifications]
  );

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }

    let cancelled = false;
    listNotifications()
      .then((data) => {
        if (!cancelled) {
          setNotifications(trimNotifications(data.notifications));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotifications([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const token = getToken();
    if (!user || !token || typeof WebSocket === "undefined") {
      return;
    }

    const ws = new WebSocket(eventsWebSocketUrl(), eventsWebSocketProtocols(token));
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as GatewayEvent;
        dispatchGatewayEvent(message);
        const notification = createNotificationFromEvent(message);
        if (notification) {
          const context = notificationContextParts(notification, {
            project: t("notifications.projectContext"),
            session: t("notifications.sessionContext"),
            cli: t("notifications.cliContext"),
          }).join(" · ");
          const title = [t(notification.titleKey), context].filter(Boolean).join(" · ");
          updateNotifications((current) => mergeNotifications(current, notification));
          showBrowserNotification(title, notification, message);
        }
        scheduleEventQueryInvalidation(invalidationTimerRef, queryClient, message);
      } catch {
        // Ignore malformed frames from the authenticated local event stream.
      }
    };

    return () => {
      ws.close();
      if (invalidationTimerRef.current !== null) {
        clearTimeout(invalidationTimerRef.current);
        invalidationTimerRef.current = null;
      }
    };
  }, [queryClient, t, updateNotifications, user]);

  const value = useMemo<NotificationContextValue>(
    () => ({
      notifications,
      unreadCount: notifications.filter((notification) => !notification.read).length,
      markRead,
      markAllRead: () => {
        updateNotifications((current) =>
          current.map((notification) => ({ ...notification, read: true }))
        );
        void markAllNotificationsRead().catch(() => {
          void reloadNotifications();
        });
      },
      clearNotifications: () => {
        updateNotifications(() => []);
        void clearServerNotifications().catch(() => {
          void reloadNotifications();
        });
      },
    }),
    [markRead, notifications, reloadNotifications, updateNotifications]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return context;
}

function scheduleEventQueryInvalidation(
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  queryClient: ReturnType<typeof useQueryClient>,
  message: GatewayEvent
) {
  const invalidations = eventQueryInvalidations(message);
  if (invalidations.length === 0 || timerRef.current !== null) {
    return;
  }

  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    invalidateEventQueries(queryClient, invalidations);
  }, 250);
}

export function eventQueryInvalidations(message: GatewayEvent): string[][] {
  const type = message.type;
  if (
    type === "session_created" ||
    type === "session_deleted" ||
    type === "session_status_changed"
  ) {
    return [["sessions"], ["projects"], ["dashboard-summary"], ["activities"]];
  }
  if (
    type === "activity_created" &&
    codexAppServerActivityTypes.has(getPayloadString(message.payload, "activity_type") ?? "")
  ) {
    return [["codex-app-server-activities"], ["codex-app-servers"]];
  }
  if (type === "copilot_run_updated") {
    if (getPayloadString(message.payload, "event_type") === "assistant_delta") {
      return [];
    }
    return [["copilot-runs"], ["copilot-conversations"], ["copilot-conversation-messages"]];
  }
  return [];
}

function getPayloadString(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function invalidateEventQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  invalidations: string[][]
) {
  for (const queryKey of invalidations) {
    queryClient.invalidateQueries({ queryKey });
  }
}
