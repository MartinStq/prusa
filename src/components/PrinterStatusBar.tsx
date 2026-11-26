"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  Cpu,
  Flame,
  FlaskConical,
  Layers,
  OctagonAlert,
  PauseCircle,
  Plus,
  Printer,
  RefreshCw,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type {
  PrinterAlert,
  PrinterState,
  PrinterStatusPayload,
} from "@/types/orders";

interface PrinterStatusBarProps {
  refreshTrigger: number;
  onOpenNewOrder: () => void;
  onSimulateOrders: (mode: "single" | "batch" | "clear") => Promise<void>;
  onPrinterFinished?: () => void;
}

interface NotificationLogItem {
  id: string;
  timestamp: string;
  severity: "warning" | "error" | "info";
  title: string;
  detail: string;
  read: boolean;
}

const DEFAULT_DOC_TITLE = "Prusa Pilot — Console Opérateur 3D";

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

function playAlertBeep(severity: "warning" | "error" | "info") {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes =
      severity === "error"
        ? [880, 660, 880]
        : severity === "warning"
        ? [740, 587]
        : [523, 659];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = severity === "error" ? "sawtooth" : "sine";
      osc.frequency.value = freq;
      const start = ctx.currentTime + idx * 0.16;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.15);
    });
  } catch {
    // Ignore si l'autoplay audio n'est pas encore débloqué par le navigateur
  }
}

function sendDesktopNotification(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch {
      // Ignore
    }
  }
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
  PAUSED: {
    badge: "bg-amber-500/25 text-amber-200 border-amber-400/60",
    dot: "bg-amber-400 animate-ping",
    label: "PAUSED — En pause",
  },
  ATTENTION: {
    badge: "bg-amber-500/30 text-amber-100 border-amber-400/80",
    dot: "bg-amber-300 animate-ping",
    label: "ATTENTION — Action écran",
  },
  ERROR: {
    badge: "bg-rose-600/35 text-rose-100 border-rose-400/80",
    dot: "bg-rose-400 animate-ping",
    label: "ERROR — Erreur Prusa",
  },
  STOPPED: {
    badge: "bg-rose-500/25 text-rose-200 border-rose-400/60",
    dot: "bg-rose-400",
    label: "STOPPED — Stoppée",
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
  onSimulateOrders,
  onPrinterFinished,
}: PrinterStatusBarProps) {
  const [status, setStatus] = useState<PrinterStatusPayload | null>(null);
  const [simMenuOpen, setSimMenuOpen] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [activeBanner, setActiveBanner] = useState<{
    key: string;
    alert: PrinterAlert;
    time: string;
  } | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<NotificationLogItem | null>(null);
  const [history, setHistory] = useState<NotificationLogItem[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [desktopPerm, setDesktopPerm] = useState<string>("default");

  const prevStateRef = useRef<PrinterState | null>(null);
  const prevProgressRef = useRef<number | null>(null);
  const prevFileRef = useRef<string | null>(null);
  const lastNotifiedKeyRef = useRef<string | null>(null);
  const soundEnabledRef = useRef<boolean>(true);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setDesktopPerm(Notification.permission);
    }
  }, []);

  const triggerSiteNotification = useCallback(
    (item: {
      severity: "warning" | "error" | "info";
      title: string;
      detail: string;
    }) => {
      const nowStr = new Date().toLocaleTimeString("fr-BE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const logItem: NotificationLogItem = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: nowStr,
        severity: item.severity,
        title: item.title,
        detail: item.detail,
        read: false,
      };

      setHistory((prev) => [logItem, ...prev].slice(0, 20));
      setToast(logItem);
      if (soundEnabledRef.current) {
        playAlertBeep(item.severity);
      }
      sendDesktopNotification(`Prusa MK4S — ${item.title}`, item.detail);
    },
    []
  );

  // Met à jour le titre de l'onglet Brave tant qu'une alerte est active
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (activeBanner) {
      const prefix = activeBanner.alert.severity === "error" ? "🚨" : "⚠️";
      document.title = `${prefix} [${activeBanner.alert.code}] Prusa MK4S`;
    } else {
      document.title = DEFAULT_DOC_TITLE;
    }
    return () => {
      document.title = DEFAULT_DOC_TITLE;
    };
  }, [activeBanner]);

  // Efface automatiquement le toast flottant après 10s (la bannière reste visible)
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 10000);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/printer/status", { cache: "no-store" });
      if (!res.ok) return;
      const data: PrinterStatusPayload = await res.json();
      setStatus(data);

      const prevState = prevStateRef.current;
      const prevProgress = prevProgressRef.current;
      const prevFile = prevFileRef.current;

      // 1. Détermine l'alerte active (venant de PrusaLink ou d'une coupure en pleine impression)
      let effectiveAlert: PrinterAlert | null = data.alert ?? null;

      if (
        !effectiveAlert &&
        prevState === "PRINTING" &&
        data.state === "OFFLINE"
      ) {
        effectiveAlert = {
          severity: "error",
          code: "OFFLINE_DURING_PRINT",
          title: "Imprimante déconnectée pendant l'impression",
          detail: `La Prusa MK4S ne répond plus en Wi-Fi pendant l'impression${
            prevFile ? ` (${prevFile})` : ""
          }${prevProgress !== null ? ` à ${prevProgress}%` : ""}.`,
        };
      }

      if (effectiveAlert) {
        const alertKey = `${effectiveAlert.code}:${data.activeFile ?? prevFile ?? ""}:${data.jobState ?? ""}`;
        const nowTime = new Date().toLocaleTimeString("fr-BE", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        setActiveBanner((cur) => {
          if (cur && cur.key === alertKey) return cur;
          return { key: alertKey, alert: effectiveAlert!, time: nowTime };
        });

        if (lastNotifiedKeyRef.current !== alertKey) {
          lastNotifiedKeyRef.current = alertKey;
          setDismissedKey(null);
          triggerSiteNotification({
            severity: effectiveAlert.severity,
            title: effectiveAlert.title,
            detail: effectiveAlert.detail,
          });
        }
      } else {
        // Si l'imprimante a repris ou est redevenue IDLE/FINISHED, on efface la bannière d'alerte
        if (
          prevState === "ATTENTION" ||
          prevState === "PAUSED" ||
          prevState === "ERROR" ||
          prevState === "STOPPED"
        ) {
          setActiveBanner(null);
          lastNotifiedKeyRef.current = null;
          if (data.state === "PRINTING") {
            triggerSiteNotification({
              severity: "info",
              title: "Impression reprise",
              detail: `La Prusa a repris l'impression${
                data.activeFile ? ` (${data.activeFile})` : ""
              }.`,
            });
          }
        }
      }

      // 2. Notification de fin d'impression
      if (prevState === "PRINTING" && data.state === "FINISHED") {
        onPrinterFinished?.();
        triggerSiteNotification({
          severity: "info",
          title: "Impression terminée !",
          detail: `La pièce${
            data.activeFile ? ` (${data.activeFile})` : ""
          } est prête sur le plateau.`,
        });
      }

      prevStateRef.current = data.state;
      prevProgressRef.current = data.progress;
      prevFileRef.current = data.activeFile;
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
  }, [onPrinterFinished, triggerSiteNotification]);

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

  const handleRequestDesktopNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    setDesktopPerm(perm);
  };

  const handleSimulateTestAlert = () => {
    const testAlert: PrinterAlert = {
      severity: "warning",
      code: "ATTENTION",
      title: "Test alerte — Changement de filament (ATTENTION)",
      detail:
        "Exemple de notification lorsque la Prusa s'arrête pour changer de filament ou signale une erreur.",
    };
    const key = `TEST_${Date.now()}`;
    setDismissedKey(null);
    setActiveBanner({
      key,
      alert: testAlert,
      time: new Date().toLocaleTimeString("fr-BE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    });
    triggerSiteNotification({
      severity: "warning",
      title: testAlert.title,
      detail: testAlert.detail,
    });
    setBellOpen(false);
  };

  const unreadCount = history.filter((h) => !h.read).length;
  const showBanner = Boolean(activeBanner && dismissedKey !== activeBanner.key);

  const currentState: PrinterState = status?.state ?? "OFFLINE";
  const style = STATE_STYLES[currentState];

  return (
    <div className="shrink-0 relative z-40">
      <header className="bg-slate-900 text-slate-100 border-b border-slate-800 px-5 py-3">
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
                    Prusa MK4S Pilot
                  </span>
                  <button
                    type="button"
                    onClick={handleToggleMockMode}
                    title="Cliquer pour basculer entre le mode Simulation et la vraie Prusa MK4S (Wi-Fi)"
                    className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded border transition ${
                      status?.mock
                        ? "bg-slate-800 text-amber-300 border-amber-500/40 hover:bg-slate-700"
                        : "bg-emerald-950/70 text-emerald-300 border-emerald-500/40 hover:bg-emerald-900/60"
                    }`}
                  >
                    <Wifi className="h-3 w-3" />
                    {status?.mock
                      ? "Mode Mock (cliquer → Wi-Fi)"
                      : `Wi-Fi ${status?.host ?? "Prusa"}`}
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

          {/* Télémétrie + Notifications + Nouvelle demande */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
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

                <div className="flex items-center gap-2.5 bg-slate-800/80 px-3 py-1.5 rounded-md border border-slate-700/70 min-w-[155px]">
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
                        className={`h-full transition-all duration-500 ${
                          currentState === "ATTENTION" ||
                          currentState === "PAUSED"
                            ? "bg-amber-400"
                            : currentState === "ERROR" ||
                              currentState === "STOPPED"
                            ? "bg-rose-500"
                            : "bg-orange-500"
                        }`}
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
                  <div className="hidden 2xl:flex items-center gap-1.5 text-slate-300 bg-slate-800/60 px-2.5 py-1.5 rounded border border-slate-700/60 max-w-[190px]">
                    <Cpu className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="truncate font-mono text-[11px]">
                      {status.activeFile}
                    </span>
                  </div>
                )}
              </>
            )}

            {/* Bouton son des alertes */}
            <button
              type="button"
              onClick={() => setSoundEnabled((s) => !s)}
              title={
                soundEnabled
                  ? "Alertes sonores activées (cliquer pour couper)"
                  : "Alertes sonores coupées (cliquer pour activer)"
              }
              className="p-2 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition"
            >
              {soundEnabled ? (
                <Volume2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <VolumeX className="h-4 w-4 text-slate-500" />
              )}
            </button>

            {/* Cloche historique & paramètres de notifications */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setBellOpen((o) => !o);
                  setHistory((prev) => prev.map((h) => ({ ...h, read: true })));
                }}
                title="Notifications imprimante"
                className={`relative p-2 rounded-md border transition ${
                  activeBanner
                    ? "bg-amber-500/20 border-amber-400 text-amber-200"
                    : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300 hover:text-white"
                }`}
              >
                {activeBanner ? (
                  <BellRing className="h-4 w-4 animate-bounce" />
                ) : (
                  <Bell className="h-4 w-4" />
                )}
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {bellOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl bg-white text-slate-900 shadow-2xl border border-slate-200 overflow-hidden z-50">
                  <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="font-semibold text-xs text-slate-900">
                      Alertes PrusaLink
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSimulateTestAlert}
                        className="text-[11px] font-medium text-orange-600 hover:text-orange-700"
                      >
                        Tester
                      </button>
                      <button
                        type="button"
                        onClick={() => setBellOpen(false)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {desktopPerm !== "granted" && (
                    <div className="px-3.5 py-2 bg-sky-50 border-b border-sky-100 flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-sky-900">
                        Alertes même hors onglet :
                      </span>
                      <button
                        type="button"
                        onClick={handleRequestDesktopNotifications}
                        className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold shrink-0"
                      >
                        Activer bureau
                      </button>
                    </div>
                  )}

                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                    {history.length === 0 ? (
                      <div className="p-5 text-center text-xs text-slate-400">
                        Aucune alerte récente. Vous serez prévenu dès que la
                        Prusa passe en pause, changement de filament ou erreur.
                      </div>
                    ) : (
                      history.map((item) => (
                        <div key={item.id} className="p-3 text-xs space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`font-semibold ${
                                item.severity === "error"
                                  ? "text-rose-700"
                                  : item.severity === "warning"
                                  ? "text-amber-700"
                                  : "text-emerald-700"
                              }`}
                            >
                              {item.title}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400 shrink-0">
                              {item.timestamp}
                            </span>
                          </div>
                          <p className="text-slate-600 text-[11px] leading-snug">
                            {item.detail}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Menu Simulation de demandes clients (sans Odoo) */}
            <div className="relative">
              <button
                type="button"
                disabled={simulating}
                onClick={() => {
                  setSimMenuOpen((o) => !o);
                  setBellOpen(false);
                }}
                className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 font-medium px-3 py-1.5 rounded-md border border-slate-700 transition"
              >
                <FlaskConical className="h-3.5 w-3.5 text-amber-400" />
                {simulating ? "Création…" : "Simuler"}
              </button>

              {simMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-xl bg-white text-slate-900 shadow-2xl border border-slate-200 overflow-hidden z-50 text-xs">
                  <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                    Simulation de demandes (Test)
                  </div>
                  <div className="p-1.5 space-y-1">
                    <button
                      type="button"
                      onClick={async () => {
                        setSimMenuOpen(false);
                        setSimulating(true);
                        try {
                          await onSimulateOrders("single");
                        } finally {
                          setSimulating(false);
                        }
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-orange-50 transition"
                    >
                      <div className="font-semibold text-slate-900">
                        + 1 demande client (À analyser)
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Génère un client + pièce 3D STL valide
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        setSimMenuOpen(false);
                        setSimulating(true);
                        try {
                          await onSimulateOrders("batch");
                        } finally {
                          setSimulating(false);
                        }
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-orange-50 transition"
                    >
                      <div className="font-semibold text-slate-900">
                        + 3 demandes d&apos;un coup
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Remplit la file pour tester le flux complet
                      </div>
                    </button>

                    <div className="border-t border-slate-100 my-1" />

                    <button
                      type="button"
                      onClick={async () => {
                        setSimMenuOpen(false);
                        if (
                          !window.confirm(
                            "Supprimer toutes les demandes (à analyser, devis envoyés, validées, en impression, terminées, refusées) ?"
                          )
                        ) {
                          return;
                        }
                        setSimulating(true);
                        try {
                          await onSimulateOrders("clear");
                        } finally {
                          setSimulating(false);
                        }
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-rose-50 text-rose-700 transition"
                    >
                      <div className="font-semibold">
                        Tout supprimer (vider toute la file)
                      </div>
                      <div className="text-[11px] text-rose-500">
                        Supprime tous les devis, impressions et demandes
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>

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
      </header>

      {/* BANNIÈRE D'ALERTE PERSISTANTE (changement de filament / pause / erreur / arrêt) */}
      {showBanner && activeBanner && (
        <div
          role="alert"
          className={`px-5 py-2.5 border-b flex flex-wrap items-center justify-between gap-3 text-xs ${
            activeBanner.alert.severity === "error"
              ? "bg-rose-600 text-white border-rose-700"
              : "bg-amber-500 text-slate-950 border-amber-600"
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {activeBanner.alert.severity === "error" ? (
              <OctagonAlert className="h-5 w-5 shrink-0 animate-pulse" />
            ) : activeBanner.alert.code === "PAUSED" ? (
              <PauseCircle className="h-5 w-5 shrink-0 animate-pulse" />
            ) : (
              <AlertTriangle className="h-5 w-5 shrink-0 animate-pulse" />
            )}
            <div className="min-w-0">
              <div className="font-bold flex flex-wrap items-center gap-2">
                <span>{activeBanner.alert.title}</span>
                <span className="font-mono text-[10px] opacity-80">
                  ({activeBanner.time})
                </span>
              </div>
              <p className="text-[11px] opacity-95">
                {activeBanner.alert.detail}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setDismissedKey(activeBanner.key)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold shrink-0 transition ${
              activeBanner.alert.severity === "error"
                ? "bg-rose-800/70 hover:bg-rose-900 text-white"
                : "bg-slate-950/15 hover:bg-slate-950/25 text-slate-950"
            }`}
          >
            <X className="h-3.5 w-3.5" />
            Acquitter
          </button>
        </div>
      )}

      {/* TOAST FLOTTANT À L'APPARITION D'UN NOUVEL ÉVÉNEMENT */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl shadow-2xl border p-3.5 bg-slate-900 text-white border-slate-700 flex items-start gap-3 animate-in">
          {toast.severity === "error" ? (
            <OctagonAlert className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
          ) : toast.severity === "warning" ? (
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 text-xs space-y-0.5">
            <div className="font-semibold text-white">{toast.title}</div>
            <p className="text-slate-300 text-[11px] leading-snug">
              {toast.detail}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
