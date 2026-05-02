"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  trimNotifications,
  type GatewayEvent,
  type StoredNotification,
} from "@/lib/notifications";
import { eventsWebSocketUrl } from "@/lib/ws";
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

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [notifications, setNotifications] = useState<StoredNotification[]>([]);

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

    const ws = new WebSocket(eventsWebSocketUrl(token));
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as GatewayEvent;
        const notification = createNotificationFromEvent(message);
        if (notification) {
          updateNotifications((current) => mergeNotifications(current, notification));
          showBrowserNotification(t(notification.titleKey), notification, message);
        }
        invalidateEventQueries(queryClient, message.type);
      } catch {
        // Ignore malformed frames from the authenticated local event stream.
      }
    };

    return () => {
      ws.close();
    };
  }, [queryClient, t, updateNotifications, user]);

  const value = useMemo<NotificationContextValue>(
    () => ({
      notifications,
      unreadCount: notifications.filter((notification) => !notification.read).length,
      markRead: (id) => {
        updateNotifications((current) =>
          current.map((notification) =>
            notification.id === id ? { ...notification, read: true } : notification
          )
        );
        void markNotificationRead(id).catch(() => {
          void reloadNotifications();
        });
      },
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
    [notifications, reloadNotifications, updateNotifications]
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

function invalidateEventQueries(queryClient: ReturnType<typeof useQueryClient>, type?: string) {
  if (
    type === "session_created" ||
    type === "session_deleted" ||
    type === "session_status_changed" ||
    type === "activity_created"
  ) {
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    queryClient.invalidateQueries({ queryKey: ["activities"] });
  }
}
