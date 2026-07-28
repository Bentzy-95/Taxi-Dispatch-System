import { useEffect, useRef } from "react";

/**
 * Opens a WebSocket to the dispatch server and calls `onMessage` for every
 * push the server sends. Reconnects automatically with backoff if the
 * connection drops.
 */
export function useLiveUpdates(onMessage: () => void, driverToken?: string) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryDelay = 1000;
    let closedByCleanup = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = driverToken
        ? `?role=driver&token=${encodeURIComponent(driverToken)}`
        : `?code=${encodeURIComponent(localStorage.getItem("atd_access_code") ?? "")}`;
      socket = new WebSocket(`${protocol}//${window.location.host}/ws${params}`);

      socket.onmessage = () => onMessageRef.current();
      socket.onclose = () => {
        if (closedByCleanup) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 1.5, 10000);
      };
    }

    connect();
    return () => {
      closedByCleanup = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [driverToken]);
}
