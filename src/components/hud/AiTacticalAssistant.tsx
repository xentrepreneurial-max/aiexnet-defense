"use client";

import React, { useState } from "react";
import { Bot, Send, Sparkles, ChevronDown, ChevronUp, Terminal, ShieldAlert } from "lucide-react";

export const AiTacticalAssistant: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputQuery, setInputQuery] = useState("");
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([
    {
      role: "assistant",
      text: "🛡️ **BENGAL-EYE AI COPILOT ONLINE**\nবাংলাদেশ ডিফেন্স ও সিচুয়েশনাল ইন্টেলিজেন্স সিস্টেমে স্বাগতম। আপনি যেকোনো এয়ারস্পেস, মেরিটাইম মুভমেন্ট, স্যাটেলাইট রিকনেসান্স বা থ্রেট অ্যানালিসিসের জন্য প্রশ্ন করতে পারেন।"
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);

  const quickPrompts = [
    "দক্ষিণ-পূর্ব বর্ডারে এয়ারস্পেস থ্রেট অ্যানালিসিস করো",
    "বঙ্গোপসাগরে সন্দেহজনক নৌযান শনাক্ত করো",
    "বঙ্গবন্ধু-১ ও সেন্টিনেল স্যাটেলাইটের বর্তমান অবস্থান জানাও",
    "কুর্মিটোলা ও চট্টগ্রামের রাডার কাভারেজ স্ট্যাটাস কী?",
  ];

  const handleSend = (queryText?: string) => {
    const textToSend = queryText || inputQuery;
    if (!textToSend.trim() || isLoading) return;

    const userMsg = textToSend.trim();
    setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    if (!queryText) setInputQuery("");
    setIsLoading(true);

    setTimeout(() => {
      let reply = "";
      const lower = userMsg.toLowerCase();

      if (lower.includes("বর্ডার") || lower.includes("এয়ারস্পেস") || lower.includes("threat") || lower.includes("airspace")) {
        reply = "⚠️ **AIR DEFENSE THREAT EVALUATION:**\n- **সতর্কতা:** রাডার ট্র্যাক `TGT-GHOST` (Altitude: 3,500m, Speed: 310 kts) দক্ষিণ-পূর্ব এয়ার ডিফেন্স জোন (ADIZ) এর নিকটতম পরিধিতে রয়েছে।\n- **সুপারিশ:** BAF জহুরুল হক ও কক্সবাজার ঘাঁটি থেকে ২x F-7BGI ইন্টারসেপ্টর স্ট্যাটাসকে হাই-রেডিনেস এ রাখার নির্দেশনা প্রদান করা হচ্ছে।";
      } else if (lower.includes("বঙ্গোপসাগর") || lower.includes("নৌযান") || lower.includes("vessel") || lower.includes("sea")) {
        reply = "⚓ **MARITIME INTELLIGENCE SUMMARY:**\n- সেন্ট মার্টিনের দক্ষিণ-পূর্বে আনআইডেন্টিফাইড ফিশিং ট্রলার `FV YUAN YANG 802` সন্দেহজনক গতিপথে নোঙর করা হয়েছে।\n- টহলরত বাংলাদেশ নৌবাহিনীর ফ্রিগেট `BNS BIJOY (F-35)` এবং সাবমেরিন `BNS NABAJATRA` কে উক্ত সেক্টরে মনিটরিং বাড়ানোর কমান্ড লিংক পাঠানো হয়েছে।";
      } else if (lower.includes("স্যাটেলাইট") || lower.includes("satellite") || lower.includes("sentinel") || lower.includes("orbit")) {
        reply = "🛰️ **ORBITAL RECONNAISSANCE INTEL:**\n- **Bangabandhu-1:** 119.1°E জিওস্টেশনারি অরবিটে স্বাভাবিক সক্রিয়।\n- **Copernicus Sentinel-2A (Optical 10m):** আগামী ৪২ মিনিটের মধ্যে চট্টগ্রাম-কক্সবাজার কোস্টাল লাইনের ওপর অপটিক্যাল স্ক্যান পরিচালনা করবে। ক্লাউড কাভারেজ প্রায় ১৫%।";
      } else {
        reply = `🔍 **INTEL RESPONSE:**\n"${userMsg}" সম্পর্কিত সমস্ত রাডার ও জিও-স্পেশিয়াল ডাটা প্রসেস করা হয়েছে। ডিফেন্স গ্রিড ডিফকন-৩ লেভেলে সক্রিয় রয়েছে এবং সমস্ত গ্রাউন্ড রাডার নরমাল অপারেশনাল।`;
      }

      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
      setIsLoading(false);
    }, 600);
  };

  return (
    <div className="fixed bottom-6 left-6 z-40 w-96 tactical-glass rounded-xl border border-emerald-500/40 shadow-2xl font-mono select-none overflow-hidden">
      {/* Header bar */}
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
              TACTICAL AI INTEL COPILOT
            </span>
            <span className="text-[9px] text-slate-400">DEFENSE SITUATIONAL ADVISOR</span>
          </div>
        </div>

        <button className="text-slate-400 hover:text-emerald-300">
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {isOpen && (
        <div className="p-3 bg-slate-950/95 space-y-3">
          {/* Message log */}
          <div className="h-64 overflow-y-auto space-y-2 pr-1 text-xs">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`p-2.5 rounded-lg border leading-relaxed ${
                  m.role === "user"
                    ? "bg-slate-900/90 border-cyan-500/40 text-cyan-200 ml-4"
                    : "bg-emerald-950/40 border-emerald-500/30 text-emerald-100 mr-2"
                }`}
              >
                <div className="text-[9px] font-bold uppercase opacity-60 mb-1">
                  {m.role === "user" ? "TACTICAL QUERY" : "AI DEFENSE MATRIX"}
                </div>
                <div className="whitespace-pre-line text-[11px]">{m.text}</div>
              </div>
            ))}
            {isLoading && (
              <div className="p-2 text-xs text-emerald-400 flex items-center gap-2 font-mono animate-pulse">
                <Sparkles className="w-3.5 h-3.5" />
                ANALYZING RADAR & SATELLITE TELEMETRY...
              </div>
            )}
          </div>

          {/* Quick Prompts */}
          <div className="space-y-1">
            <span className="text-[9px] text-slate-400 block">QUICK INTEL QUERIES:</span>
            <div className="flex flex-wrap gap-1">
              {quickPrompts.slice(0, 2).map((p, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(p)}
                  className="text-[10px] bg-slate-900/90 hover:bg-emerald-950 border border-slate-700 hover:border-emerald-500 text-slate-300 hover:text-emerald-200 px-2 py-1 rounded truncate max-w-[175px] transition-colors text-left"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Input field */}
          <div className="flex items-center gap-1.5 pt-1">
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Ask tactical copilot..."
              className="flex-1 bg-slate-900 border border-slate-700 focus:border-emerald-400 rounded px-2.5 py-1.5 text-xs text-slate-200 outline-none font-mono"
            />
            <button
              onClick={() => handleSend()}
              disabled={isLoading || !inputQuery.trim()}
              className="p-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-950 rounded font-bold transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
