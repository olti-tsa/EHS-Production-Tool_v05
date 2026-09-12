/** Authenticated invalidations only: always fetch authoritative data after an event.
 * Callers retain polling as a fallback when a proxy interrupts the stream. */
export function subscribeCrewResponses(
  getToken: () => Promise<string | null>,
  onChange: () => void,
): () => void {
  const controller = new AbortController();
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let delay = 1_000;
  const refresh = () => {
    if (!controller.signal.aborted && document.visibilityState !== "hidden") onChange();
  };
  const connect = async () => {
    try {
      const token = await getToken();
      if (controller.signal.aborted) return;
      if (!token) throw new Error("Authentication not ready");
      const response = await fetch(`${import.meta.env.BASE_URL}api/portal/briefs/events/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error("Crew response stream unavailable");
      delay = 1_000;
      refresh(); // Recover missed events after disconnect.
      const reader = response.body.getReader();
      try {
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          if (buffer.length > 65_536) throw new Error("Crew event exceeds buffer limit");
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (frame.split("\n").some(line => line.trim() === "event: crew-response")) refresh();
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch {
      // Existing polling remains authoritative while reconnecting.
    }
    if (!controller.signal.aborted) {
      reconnectTimer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30_000);
    }
  };
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  void connect();
  return () => {
    controller.abort();
    clearTimeout(reconnectTimer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}