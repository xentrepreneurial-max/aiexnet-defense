"use client";

import React, { useState } from "react";
import { Bot, Send, ChevronDown, ChevronUp, Database, Crosshair } from "lucide-react";

interface Answer {
  headline: string;
  lines: string[];
  provenance: string[];
  coordinates?: [number, number];
}

interface Message {
  role: "user" | "system";
  text?: string;
  answer?: Answer;
}

interface AiTacticalAssistantProps {
  onSelectCoordinates?: (coords: [number, number]) => void;
}

/**
 * Tactical query console.
 *
 * Deliberately NOT a chatbot. Every answer is computed server-side from the
 * live ADS-B / AIS / FIRMS feeds and lists the feeds and their link state it
 * was derived from. It cannot speculate, and when a feed is down it reports
 * that instead of producing a plausible-sounding answer.
 */
export const AiTacticalAssistant: React.FC<AiTacticalAssistantProps> = ({
  onSelectCoordinates,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputQuery, setInputQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "system",
      text:
        "TACTICAL QUERY CONSOLE\nপ্রতিটি উত্তর লাইভ ফিড থেকে হিসাব করে দেওয়া হয় — কোনো অনুমান নয়। ফিড বন্ধ থাকলে উত্তর না দিয়ে সেটাই জানানো হবে।",
    },
  ]);

  const quickPrompts = [
    "Air picture summary",
    "Military and unidentified contacts",
    "ADIZ incursions",
    "Sensor link status",
    "Fastest and highest contact",
    "Active thermal detections",
  ];

  const handleSend = async (queryText?: string) => {
    const textToSend = (queryText ?? inputQuery).trim();
    if (!textToSend || isLoading) return;

    setMessages((prev) => [...prev, { role: "user", text: textToSend }]);
    if (!queryText) setInputQuery("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/defense/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: textToSend }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setMessages((prev) => [...prev, { role: "system", answer: json.answer }]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          answer: {
            headline: "QUERY FAILED",
            lines: [`Could not reach the query service: ${err?.message ?? err}`],
            provenance: [],
          },
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-6 z-40 w-96 tactical-glass rounded-xl border border-emerald-500/40 shadow-2xl font-mono select-none overflow-hidden">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between p-3 bg-slate-950/80 hover:bg-slate-900 border-b border-slate-700/80 cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded bg-emerald-950/90 border border-emerald-400 text-emerald-300">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs font-bold text-emerald-400 block tracking-wider">
              TACTICAL QUERY CONSOLE
            </span>
            <span className="text-[9px] text-slate-400">
              COMPUTED FROM LIVE FEEDS · NO INFERENCE
            </span>
          </div>
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        )}
      </div>

      {isOpen && (
        <>
          <div className="max-h-80 overflow-y-auto p-3 space-y-2.5 bg-slate-950/40">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg bg-cyan-950/70 border border-cyan-600/40 px-2.5 py-1.5 text-[11px] text-cyan-100">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="rounded-lg bg-slate-900/70 border border-slate-700/70 p-2.5">
                  {m.text && (
                    <p className="text-[11px] text-emerald-300 whitespace-pre-line leading-relaxed">
                      {m.text}
                    </p>
                  )}
                  {m.answer && (
                    <>
                      <p className="text-[11px] font-bold text-emerald-400 mb-1.5 leading-snug">
                        {m.answer.headline}
                      </p>
                      <div className="space-y-0.5">
                        {m.answer.lines.map((line, j) => (
                          <p
                            key={j}
                            className="text-[10px] text-slate-300 leading-relaxed whitespace-pre-wrap"
                          >
                            {line}
                          </p>
                        ))}
                      </div>

                      {m.answer.coordinates && onSelectCoordinates && (
                        <button
                          onClick={() => onSelectCoordinates(m.answer!.coordinates!)}
                          className="mt-2 flex items-center gap-1 text-[9px] text-cyan-300 hover:text-cyan-100 bg-slate-950/80 px-1.5 py-0.5 rounded border border-cyan-500/30"
                        >
                          <Crosshair className="w-2.5 h-2.5" />
                          LOCATE ON MAP
                        </button>
                      )}

                      {m.answer.provenance.length > 0 && (
                        <div className="mt-2 pt-1.5 border-t border-slate-800">
                          <span className="flex items-center gap-1 text-[8.5px] text-slate-500 mb-0.5">
                            <Database className="w-2.5 h-2.5" />
                            COMPUTED FROM
                          </span>
                          {m.answer.provenance.map((p, j) => (
                            <p key={j} className="text-[8.5px] text-slate-500 leading-snug">
                              {p}
                            </p>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            )}

            {isLoading && (
              <p className="text-[10px] text-slate-500 animate-pulse">
                Querying live feeds…
              </p>
            )}
          </div>

          <div className="p-2 border-t border-slate-800 bg-slate-950/70">
            <div className="flex flex-wrap gap-1 mb-2">
              {quickPrompts.map((p) => (
                <button
                  key={p}
                  onClick={() => handleSend(p)}
                  disabled={isLoading}
                  className="text-[9px] px-1.5 py-1 rounded bg-slate-900 hover:bg-emerald-950 border border-slate-700 hover:border-emerald-500/50 text-slate-300 hover:text-emerald-300 transition-colors disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <input
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Query the live picture…"
                className="flex-1 bg-slate-900 border border-slate-700 focus:border-emerald-500/60 rounded px-2 py-1.5 text-[11px] text-slate-200 outline-none placeholder:text-slate-600"
              />
              <button
                onClick={() => handleSend()}
                disabled={isLoading}
                className="p-1.5 rounded bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
