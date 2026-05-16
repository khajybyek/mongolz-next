"use client";

import { useState } from "react";
import { Sparkles, Loader2, BarChart, AlertTriangle, MessageSquare } from "lucide-react";

type Mode = "summary" | "anomaly" | "chat";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface AIChatLabels {
  summary: string;
  anomaly: string;
  chat: string;
  placeholder: string;
  running: string;
  run: string;
  chatPlaceholder: string;
  send: string;
  errorGeneric: string;
}

export function AIChat({
  labels,
  lang,
}: {
  labels: AIChatLabels;
  lang?: string;
}) {
  const [mode, setMode] = useState<Mode>("summary");
  const [history, setHistory] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (loading) return;
    setLoading(true);
    setError(null);

    const newHistory = [...history];
    if (mode === "chat" && input.trim()) {
      newHistory.push({ role: "user", content: input });
      setHistory(newHistory);
      setInput("");
    }

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(lang ? { "Accept-Language": lang } : {}) },
        body: JSON.stringify({
          mode,
          question: mode === "chat" ? input : undefined,
          history: mode === "chat" ? history : undefined,
          lang,
        }),
      });

      if (!res.ok) throw new Error(`AI request failed: ${res.status}`);
      const data = await res.json();
      setHistory([...newHistory, { role: "assistant", content: data.text }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.errorGeneric);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center gap-2">
        {[
          { mode: "summary" as Mode, icon: BarChart, label: labels.summary },
          { mode: "anomaly" as Mode, icon: AlertTriangle, label: labels.anomaly },
          { mode: "chat" as Mode, icon: MessageSquare, label: labels.chat },
        ].map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.mode}
              onClick={() => setMode(m.mode)}
              className={`btn text-xs ${
                mode === m.mode ? "bg-accent/15 text-accent" : "btn-ghost"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="card min-h-[400px] space-y-3">
        {history.length === 0 && (
          <div className="text-center py-12 text-neutral-500 text-sm">
            <Sparkles className="w-8 h-8 mx-auto mb-2 text-accent/50" />
            {labels.placeholder}
          </div>
        )}

        {history.map((m, i) => (
          <div
            key={i}
            className={`p-3 rounded-lg text-sm whitespace-pre-wrap ${
              m.role === "user"
                ? "bg-accent/10 text-accent ml-12"
                : "bg-bg-tertiary text-neutral-100 mr-12"
            }`}
          >
            {m.content}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-neutral-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            {labels.running}
          </div>
        )}

        {error && (
          <div className="text-danger text-sm bg-danger/10 border border-danger/30 rounded-lg p-3">
            {error}
          </div>
        )}
      </div>

      {mode === "chat" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={labels.chatPlaceholder}
            disabled={loading}
            className="input flex-1"
          />
          <button type="submit" disabled={!input.trim() || loading} className="btn-primary">
            {labels.send}
          </button>
        </form>
      ) : (
        <button onClick={send} disabled={loading} className="btn-primary w-full">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {labels.run}
        </button>
      )}
    </div>
  );
}
