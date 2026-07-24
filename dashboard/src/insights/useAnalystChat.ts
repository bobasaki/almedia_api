import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Chat state for the AI analyst. Sends the running conversation plus a data
 * digest to /api/ai/chat and appends the streamed SSE deltas to the last
 * assistant message as they arrive.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnalystChat {
  messages: ChatMessage[];
  streaming: boolean;
  configured: boolean | null;
  error: string | null;
  send: (question: string) => void;
  clear: () => void;
}

function parseSseChunk(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    let event = "message";
    let data = "";
    for (const line of part.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (data) events.push({ event, data });
  }
  return { events, rest };
}

export function useAnalystChat(getContext: () => string): AnalystChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ai/status", { signal: controller.signal })
      .then((response) => response.json() as Promise<{ configured: boolean }>)
      .then((status) => setConfigured(status.configured))
      .catch(() => setConfigured(false));
    return () => controller.abort();
  }, []);

  const send = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || streaming) return;
      setError(null);

      const history = [...messages, { role: "user" as const, content: trimmed }];
      setMessages([...history, { role: "assistant", content: "" }]);
      setStreaming(true);

      const appendDelta = (text: string) =>
        setMessages((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + text };
          return next;
        });

      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        try {
          const response = await fetch("/api/ai/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: history, context: getContext() }),
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `AI request failed (${response.status})`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const { events, rest } = parseSseChunk(buffer);
            buffer = rest;
            for (const { event, data } of events) {
              const payload = JSON.parse(data) as { text?: string; error?: string };
              if (event === "delta" && payload.text) appendDelta(payload.text);
              if (event === "error" && payload.error) setError(payload.error);
            }
          }
        } catch (caught) {
          if (!controller.signal.aborted) {
            setError(caught instanceof Error ? caught.message : "The AI request failed");
            // Drop the empty assistant stub so the user can retry cleanly.
            setMessages((current) =>
              current[current.length - 1]?.content === "" ? current.slice(0, -1) : current,
            );
          }
        } finally {
          setStreaming(false);
        }
      })();
    },
    [getContext, messages, streaming],
  );

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { messages, streaming, configured, error, send, clear };
}
