"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Clock,
  Cpu,
  Flame,
  Layers,
  Plus,
  Printer,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { PrinterState, PrinterStatusPayload } from "@/types/orders";

interface PrinterStatusBarProps {
  refreshTrigger: number;
  onOpenNewOrder: () => void;
  onPrinterFinished?: () => void;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  if (seconds === 0) return "0s";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, "0")}m`;
  if (mins > 0) return `${mins}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

const STATE_STYLES: Record<
  PrinterState,
  { badge: string; dot: string; label: string }
> = {
  IDLE: {
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-400",
    label: "IDLE — Prête",
  },
  PRINTING: {
    badge: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    dot: "bg-orange-400 animate-pulse",
    label: "PRINTING — En cours",
  },
  FINISHED: {
    badge: "bg-sky-500/20 text-sky-300 border-sky-500/40",
    dot: "bg-sky-400",
    label: "FINISHED — Terminé",
  },
  OFFLINE: {
    badge: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    dot: "bg-rose-400",
    label: "OFFLINE — Hors ligne",
  },
};

export default function PrinterStatusBar({
  refreshTrigger,
  onOpenNewOrder,
  onPrinterFinished,
}: PrinterStatusBarProps) {
  const [status, setStatus] = useState<PrinterStatusPayload | null>(null);
  const [lastState, setLastState] = useState<PrinterState | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/printer/status", { cache: "no-store" });
      if (!res.ok) return;
      const data: PrinterStatusPayload = await res.json();
      setStatus(data);
      setLastState((prev) => {
        if (prev === "PRINTING" && data.state === "FINISHED") {
          onPrinterFinished?.();
        }
        return data.state;
      });
    } catch {
      setStatus({
        state: "OFFLINE",
        mock: false,
        tempNozzle: null,
        targetNozzle: null,
        tempBed: null,
        targetBed: null,
        progress: null,
        timeRemainingSeconds: null,
        activeFile: null,
      });
    }
  }, [onPrinterFinished]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus, refreshTrigger]);

  const handleResetMockIdle = async () => {
    const res = await fetch("/api/printer/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "IDLE" }),
    });
    if (res.ok) {
      setStatus(await res.json());
    }
  };

  const handleToggleMockMode = async () => {
    if (!status) return;
    const res = await fetch("/api/printer/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mock: !status.mock }),
    });
    if (res.ok) {
      setStatus(await res.json());
    }
  };

  const currentState: PrinterState = status?.state ?? "OFFLINE";
  const style = STATE_STYLES[currentState];

  return (
    <header className="bg-slate-900 text-slate-100 border-b border-slate-800 px-5 py-3 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Identité & Statut PrusaLink */}
        <div className="flex items-center gap-3.5">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-orange-600 flex items-center justify-center shadow-sm">
              <Printer className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm tracking-tight text-white">
                  Prusa MK4 Pilot
                </span>
                <button
                  type="button"
                  onClick={handleToggleMockMode}
                  title="Cliquer pour basculer entre le mode Simulation et la vraie Prusa MK4 (Wi-Fi)"
                  className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded border transition ${
                    status?.mock
                      ? "bg-slate-800 text-amber-300 border-amber-500/40 hover:bg-slate-700"
                      : "bg-emerald-950/70 text-emerald-300 border-emerald-500/40 hover:bg-emerald-900/60"
                  }`}
                >
                  <Wifi className="h-3 w-3" />
                  {status?.mock
                    ? "Mode Mock (cliquer → Wi-Fi)"
                    : `Wi-Fi ${status?.host ?? "Prusa MK4"}`}
                </button>
              </div>
              <p className="text-xs text-slate-400">
                Console Opérateur • PrusaLink
              </p>
            </div>
          </div>

          <div className="h-7 w-px bg-slate-800 hidden sm:block" />

          <div
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-semibold ${style.badge}`}
          >
            <span className={`h-2 w-2 rounded-full ${style.dot}`} />
            {style.label}
          </div>

          {status?.mock && currentState === "FINISHED" && (
            <button
              type="button"
              onClick={handleResetMockIdle}
              className="text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded border border-slate-700 transition"
            >
              Plateau vidé (IDLE)
            </button>
          )}
        </div>

        {/* Télémétrie : Températures, Progression, Temps restant */}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {currentState === "OFFLINE" && !status ? (
            <span className="text-slate-400 flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Connexion PrusaLink…
            </span>
          ) : currentState === "OFFLINE" ? (
            <span className="text-rose-300 flex items-center gap-1.5">
              <WifiOff className="h-4 w-4 shrink-0" />
              <span>{status?.message ?? "Imprimante hors ligne"}</span>
            </span>
          ) : (
            <>
              <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-md border border-slate-700/70">
                <Flame className="h-4 w-4 text-orange-400" />
                <div>
                  <span className="text-slate-400 mr-1.5">Buse</span>
                  <span className="font-mono font-semibold text-white">
                    {status?.tempNozzle !== null &&
                    status?.tempNozzle !== undefined
                      ? `${status.tempNozzle.toFixed(1)}°C`
                      : "—"}
                  </span>
                  {status?.targetNozzle ? (
                    <span className="font-mono text-slate-400">
                      {" "}
                      / {status.targetNozzle}°C
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-md border border-slate-700/70">
                <Layers className="h-4 w-4 text-sky-400" />
                <div>
                  <span className="text-slate-400 mr-1.5">Plateau</span>
                  <span className="font-mono font-semibold text-white">
                    {status?.tempBed !== null && status?.tempBed !== undefined
                      ? `${status.tempBed.toFixed(1)}°C`
                      : "—"}
                  </span>
                  {status?.targetBed ? (
                    <span className="font-mono text-slate-400">
                      {" "}
                      / {status.targetBed}°C
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2.5 bg-slate-800/80 px-3 py-1.5 rounded-md border border-slate-700/70 min-w-[165px]">
                <Activity className="h-4 w-4 text-emerald-400 shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">Avancement</span>
                    <span className="font-mono font-semibold text-white">
                      {status?.progress !== null &&
                      status?.progress !== undefined
                        ? `${status.progress}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-700 rounded-full mt-1 overflow-hidden">
                    <div
                      className="h-full bg-orange-500 transition-all duration-500"
                      style={{ width: `${status?.progress ?? 0}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-md border border-slate-700/70">
                <Clock className="h-4 w-4 text-amber-400" />
                <div>
                  <span className="text-slate-400 mr-1.5">Restant</span>
                  <span className="font-mono font-semibold text-white">
                    {formatDuration(status?.timeRemainingSeconds ?? null)}
                  </span>
                </div>
              </div>

              {status?.activeFile && (
                <div className="hidden xl:flex items-center gap-1.5 text-slate-300 bg-slate-800/60 px-2.5 py-1.5 rounded border border-slate-700/60 max-w-[200px]">
                  <Cpu className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="truncate font-mono text-[11px]">
                    {status.activeFile}
                  </span>
                </div>
              )}
            </>
          )}

          <button
            type="button"
            onClick={onOpenNewOrder}
            className="inline-flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white font-medium px-3 py-1.5 rounded-md transition shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Nouvelle demande
          </button>
        </div>
      </div>

      {lastState === "PRINTING" &&
        status?.rawState &&
        status.rawState !== "PRINTING" && (
          <div className="mt-1 text-[11px] text-amber-300">
            État détaillé PrusaLink : {status.rawState}
          </div>
        )}
    </header>
  );
}
