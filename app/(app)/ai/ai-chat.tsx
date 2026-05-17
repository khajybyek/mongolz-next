"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, BarChart3, AlertTriangle, MessageSquare, Send, User, Bot, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";

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
  emptyChatHint: string;
  emptyRunHint: string;
}

const MODES: Array<{ mode: Mode; icon: LucideIcon; key: keyof AIChatLabels }> = [
  { mode: "summary", icon: BarChart3, key: "summary" },
  { mode: "anomaly", icon: AlertTriangle, key: "anomaly" },
  { mode: "chat", icon: MessageSquare, key: "chat" },
];

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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history, loading]);

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
      {/* Mode switcher */}
      <div className="card p-1.5 inline-flex items-center gap-1">
        {MODES.map(({ mode: m, icon: Icon, key }) => {
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                active
                  ? "bg-accent text-bg shadow-soft"
                  : "text-text-soft hover:text-text hover:bg-text-muted/[0.04]"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {labels[key]}
            </button>
          );
        })}
      </div>

      {/* Chat panel */}
      <div className="card p-0 overflow-hidden flex flex-col" style={{ minHeight: 480 }}>
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-5 space-y-4"
          style={{ minHeight: 360 }}
        >
          {history.length === 0 && !loading && (
            <div className="h-full flex flex-col items-center justify-center text-center py-12 animate-fade-in">
              <div className="relative mb-4">
                <div
                  className="absolute inset-0 bg-accent/30 blur-2xl rounded-full"
                  aria-hidden
                />
                <div className="relative w-14 h-14 rounded-2xl bg-accent/15 text-accent border border-accent/30 inline-flex items-center justify-center">
                  <Sparkles className="w-7 h-7" />
                </div>
              </div>
              <p className="text-sm font-medium text-text">{labels.placeholder}</p>
              <p className="text-xs text-text-muted mt-1.5 max-w-sm text-balance">
                {mode === "chat" ? labels.emptyChatHint : labels.emptyRunHint}
              </p>
            </div>
          )}

          {history.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}

          {loading && (
            <div className="flex items-start gap-3 animate-fade-in">
              <div className="w-8 h-8 rounded-full bg-accent/15 text-accent border border-accent/20 inline-flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-2 text-text-soft text-sm bg-surface-elevated rounded-2xl rounded-tl-md px-4 py-3 border border-border">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {labels.running}
              </div>
            </div>
          )}

          {error && <Alert variant="danger">{error}</Alert>}
        </div>

        {/* Input row pinned to bottom */}
        <div className="border-t border-border bg-surface-elevated/40 p-3">
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
              <button
                type="submit"
                disabled={!input.trim() || loading}
                aria-label={labels.send}
                className="btn-primary"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">{labels.send}</span>
              </button>
            </form>
          ) : (
            <button onClick={send} disabled={loading} className="btn-primary w-full">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {labels.run}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const Icon = isUser ? User : Bot;
  return (
    <div className={cn("flex items-start gap-3 animate-fade-in-up", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "w-8 h-8 rounded-full inline-flex items-center justify-center border shrink-0",
          isUser
            ? "bg-accent/15 text-accent border-accent/20"
            : "bg-text-muted/[0.04] text-text-soft border-border"
        )}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed",
          isUser
            ? "bg-accent/10 text-text border border-accent/20 rounded-tr-md"
            : "bg-surface-elevated text-text border border-border rounded-tl-md"
        )}
      >
        {message.content}
      </div>
    </div>
  );
}
