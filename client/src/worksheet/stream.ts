// Reads a Server-Sent Events stream with fetch, so the group token can travel in the
// Authorization header (EventSource cannot set headers, and tokens in URLs end up in logs).

export interface StreamHandlers {
  onOpen(): void;
  onEvent(event: string, data: unknown): void;
  /** Called once when the stream ends for any reason; `status` is the HTTP status if it failed early. */
  onClose(status?: number): void;
}

export function openStream(url: string, token: string, h: StreamHandlers): () => void {
  const ctrl = new AbortController();
  let closed = false;
  const close = (status?: number) => {
    if (closed) return;
    closed = true;
    h.onClose(status);
  };

  (async () => {
    let res: Response;
    try {
      res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' }, signal: ctrl.signal, cache: 'no-store' });
    } catch {
      return close();
    }
    if (!res.ok || !res.body) return close(res.status);
    h.onOpen();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let event = 'message';
          const data: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
          }
          if (data.length) {
            try { h.onEvent(event, JSON.parse(data.join('\n'))); } catch { /* ignore a malformed frame */ }
          }
        }
      }
    } catch {
      /* network drop or abort */
    }
    close();
  })();

  return () => {
    closed = true;
    ctrl.abort();
  };
}
