"use client";

import React, { useState } from "react";
import { Shield, Lock, Radio, KeyRound, CheckCircle2, AlertTriangle, Terminal, ChevronRight } from "lucide-react";
import { UserProfile, UserRole } from "@/types/intelligence";

interface TacticalAuthGateProps {
  onAuthenticated: (user: UserProfile) => void;
}

export const TacticalAuthGate: React.FC<TacticalAuthGateProps> = ({ onAuthenticated }) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>("COMMANDER");
  const [callsign, setCallsign] = useState("BENGAL-LEADER");
  const [passcode, setPasscode] = useState("••••••••");
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleQuickBypass = () => {
    const operatorUser: UserProfile = {
      id: "op-dev-01",
      callsign: "TACTICAL-OPERATOR",
      name: "Watch Officer / Operator",
      role: "OPERATOR",
      clearance: "SECRET",
      sector: "DIRECT_AIR_MARITIME_OPS",
    };
    onAuthenticated(operatorUser);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthorizing(true);
    setAuthError(null);

    setTimeout(() => {
      setIsAuthorizing(false);
      const authenticatedUser: UserProfile = {
        id: selectedRole === "COMMANDER" ? "cmd-001" : "anl-042",
        callsign: callsign.trim().toUpperCase() || "VIPER-1",
        name: selectedRole === "COMMANDER" ? "Joint Operations Commander" : "Senior OSINT Analyst",
        role: selectedRole,
        clearance: selectedRole === "COMMANDER" ? "TOP SECRET" : "SECRET",
        sector: selectedRole === "COMMANDER" ? "NATIONAL_COMMAND_GRID" : "SOUTHEAST_INTELLIGENCE",
      };
      onAuthenticated(authenticatedUser);
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#02050b]/90 backdrop-blur-md p-4">
      {/* Background Decorative Grids */}
      <div className="absolute inset-0 radar-grid-bg opacity-30 pointer-events-none" />
      <div className="absolute inset-0 crt-overlay" />

      <div className="relative w-full max-w-xl tactical-glass rounded-xl border border-cyan-500/30 p-8 shadow-2xl shadow-cyan-950/50 overflow-hidden">
        {/* Top Glowing Header Bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-cyan-400 to-emerald-500 animate-pulse" />

        {/* Tactical Header */}
        <div className="flex items-center justify-between border-b border-slate-700/60 pb-4 mb-6">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-400">
              <Shield className="w-6 h-6 animate-pulse-glow" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-wider text-emerald-400 uppercase font-mono flex items-center gap-2">
                BENGAL-EYE C4ISR
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
                  v2.4 SECURE
                </span>
              </h1>
              <p className="text-xs text-slate-400 tracking-tight">
                Bangladesh National Aerospace & Maritime Defense Matrix
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono text-cyan-400 font-semibold tracking-widest flex items-center gap-1.5 justify-end">
              <Radio className="w-3 h-3 text-emerald-400 animate-ping" />
              ENC-RSA-4096
            </div>
            <div className="text-[9px] text-slate-500 uppercase tracking-wider">Classification: RESTRICTED</div>
          </div>
        </div>

        {/* Role Selector Tabs */}
        <div className="mb-6">
          <label className="block text-xs font-mono text-slate-300 uppercase tracking-wider mb-2">
            Select Command Level Authorization:
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["COMMANDER", "SENIOR_ANALYST", "OPERATOR"] as UserRole[]).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => {
                  setSelectedRole(role);
                  if (role === "COMMANDER") setCallsign("BENGAL-LEADER");
                  if (role === "SENIOR_ANALYST") setCallsign("OSINT-ANALYST-9");
                  if (role === "OPERATOR") setCallsign("RADAR-WATCH-3");
                }}
                className={`py-2 px-3 rounded text-xs font-mono font-medium border transition-all duration-200 text-center ${
                  selectedRole === role
                    ? "bg-cyan-950/80 border-cyan-400 text-cyan-200 shadow-md shadow-cyan-900/40"
                    : "bg-slate-900/50 border-slate-700/60 text-slate-400 hover:border-slate-500"
                }`}
              >
                {role === "COMMANDER" && "🎖️ COMMANDER"}
                {role === "SENIOR_ANALYST" && "📡 ANALYST"}
                {role === "OPERATOR" && "⚡ OPERATOR"}
              </button>
            ))}
          </div>
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              TACTICAL CALLSIGN / ID:
            </label>
            <input
              type="text"
              value={callsign}
              onChange={(e) => setCallsign(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-400 rounded px-3 py-2 text-sm font-mono text-emerald-400 outline-none transition-colors"
              placeholder="e.g. BENGAL-LEADER"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-cyan-400" />
              SECURITY ACCESS TOKEN:
            </label>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-400 rounded px-3 py-2 text-sm font-mono text-emerald-400 outline-none transition-colors"
              placeholder="••••••••"
              required
            />
          </div>

          {authError && (
            <div className="flex items-center gap-2 p-2 bg-rose-950/60 border border-rose-500/50 rounded text-rose-300 text-xs font-mono">
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              {authError}
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 space-y-3">
            <button
              type="submit"
              disabled={isAuthorizing}
              className="w-full py-2.5 px-4 rounded bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-950 font-bold font-mono text-sm tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition-all disabled:opacity-50"
            >
              {isAuthorizing ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  AUTHENTICATING CLEARANCE...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  AUTHENTICATE & ENTER COMMAND MATRIX
                </>
              )}
            </button>

            {/* Quick 1-Click Sandbox Bypass for Instant Testing */}
            <button
              type="button"
              onClick={handleQuickBypass}
              className="w-full py-2 px-4 rounded bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/30 text-cyan-300 text-xs font-mono flex items-center justify-center gap-2 transition-colors"
            >
              <span>⚡ DIRECT 1-CLICK ANALYST ACCESS (SANDBOX MODE)</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>

        {/* Footer info */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500 font-mono">
          <span className="flex items-center gap-1 text-emerald-500/80">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping" />
            SECURE LINK ESTABLISHED
          </span>
          <span>BD-DEFENSE GRID SEC-NET</span>
        </div>
      </div>
    </div>
  );
};
