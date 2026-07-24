import { useEffect, useRef, useState, type FormEvent } from "react";

import type { ChatMessage } from "../useAnalystChat";

/**
 * The AI analyst chat. Every question is grounded on a digest of the data
 * currently in view (filters applied), so answers reference real numbers.
 */

interface AiAnalystWidgetProps {
  messages: ChatMessage[];
  streaming: boolean;
  configured: boolean | null;
  error: string | null;
  onSend: (question: string) => void;
  onClear: () => void;
}

const SUGGESTIONS = [
  "Using remaining plan budget and matured performance, where should we shift budget next month?",
  "Which verticals combine strong return, engagement, and enough measured campaigns to scale?",
  "Which markets under-deliver on views?",
  "Which matured channels should we rebook or drop, and is the candidate list complete?",
];

export function AiAnalystWidget({
  messages,
  streaming,
  configured,
  error,
  onSend,
  onClear,
}: AiAnalystWidgetProps) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSend(draft);
    setDraft("");
  };

  if (configured === false) {
    return (
      <div className="ai-setup">
        <p>
          The AI analyst needs an OpenAI API key. Add <code>OPENAI_API_KEY</code> to{" "}
          <code>.env</code> and restart <code>pnpm dashboard</code> — the key stays on the local
          server.
        </p>
      </div>
    );
  }

  return (
    <div className="ai-chat">
      <div className="ai-log" ref={logRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="ai-intro">
            <p>
              Ask anything about the data currently in view — filters apply to my answers too.
            </p>
            <div className="ai-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={streaming}
                  onClick={() => onSend(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`ai-message ai-${message.role}`}>
            {message.content ||
              (streaming && index === messages.length - 1 ? <span className="ai-typing">Analyzing…</span> : null)}
          </div>
        ))}
        {error && <div className="inline-error">{error}</div>}
      </div>
      <form className="ai-composer" onSubmit={submit}>
        <input
          value={draft}
          placeholder="Ask the analyst…"
          disabled={configured === null}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="button primary" disabled={streaming || !draft.trim()}>
          {streaming ? "…" : "Send"}
        </button>
        {messages.length > 0 && (
          <button type="button" className="button ghost" onClick={onClear} title="Clear the conversation">
            Clear
          </button>
        )}
      </form>
    </div>
  );
}
