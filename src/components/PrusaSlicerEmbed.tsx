"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Loader2, Maximize2, Minimize2, RotateCw } from "lucide-react";

interface PrusaSlicerEmbedProps {
  orderId: string;
  stlFilename: string;
}

export default function PrusaSlicerEmbed({
  orderId,
  stlFilename,
}: PrusaSlicerEmbedProps) {
  const [ready, setReady] = useState<boolean>(false);
  const [loadingPiece, setLoadingPiece] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState<boolean>(false);
  const [iframeKey, setIframeKey] = useState<number>(0);

  const lastRequestedOrderIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadSession = useCallback(
    async (forceReload = false) => {
      if (!forceReload && lastRequestedOrderIdRef.current === orderId) {
        return;
      }
      lastRequestedOrderIdRef.current = orderId;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoadingPiece(true);
      setError(null);
      try {
        const res = await fetch("/api/slicer/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, forceReload }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            data.error ?? "Impossible de démarrer PrusaSlicer intégré."
          );
        }
        setReady(true);
        if (forceReload) {
          setIframeKey((k) => k + 1);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        lastRequestedOrderIdRef.current = null;
        setError(
          err instanceof Error
            ? err.message
            : "Erreur de connexion à PrusaSlicer."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoadingPiece(false);
        }
      }
    },
    [orderId]
  );

  useEffect(() => {
    loadSession(false);
  }, [loadSession]);

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-3 z-50 flex flex-col rounded-xl overflow-hidden border-2 border-slate-700 bg-slate-900 shadow-2xl"
          : "relative flex-1 min-h-[440px] w-full flex flex-col rounded-xl overflow-hidden border border-slate-300 bg-slate-900 shadow-inner"
      }
    >
      {/* Barre d'outil fine de l'intégration PrusaSlicer */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950 text-slate-200 border-b border-slate-800 text-xs shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Cpu className="h-3.5 w-3.5 text-orange-500 shrink-0" />
          <span className="font-semibold text-white">PrusaSlicer</span>
          <span className="text-slate-500">•</span>
          <span className="font-mono text-[11px] text-orange-300 truncate">
            {stlFilename}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-mono">
            MK4S • PLA
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={loadingPiece}
            onClick={() => loadSession(true)}
            title="Recharger le fichier STL dans PrusaSlicer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-[11px] border border-slate-700 transition"
          >
            <RotateCw
              className={`h-3 w-3 ${loadingPiece ? "animate-spin" : ""}`}
            />
            Recharger STL
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            title={
              fullscreen ? "Quitter le plein écran" : "Agrandir PrusaSlicer"
            }
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] border border-slate-700 transition"
          >
            {fullscreen ? (
              <>
                <Minimize2 className="h-3 w-3" />
                Réduire
              </>
            ) : (
              <>
                <Maximize2 className="h-3 w-3" />
                Agrandir
              </>
            )}
          </button>
        </div>
      </div>

      {/* Zone interactive PrusaSlicer en direct */}
      <div className="relative flex-1 w-full h-full bg-slate-900">
        {ready && !error && (
          <iframe
            key={iframeKey}
            src="/slicer-embed"
            title="PrusaSlicer Intégré"
            className="absolute inset-0 w-full h-full border-0"
          />
        )}

        {loadingPiece && !error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/75 backdrop-blur-[2px]">
            <div className="flex items-center gap-2.5 rounded-lg bg-slate-900 border border-slate-700 px-4 py-3 text-xs text-slate-100 shadow-xl">
              <Loader2 className="h-4 w-4 text-orange-400 animate-spin shrink-0" />
              <span>
                Chargement de{" "}
                <strong className="font-mono text-orange-300">
                  {stlFilename}
                </strong>{" "}
                dans PrusaSlicer…
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-6 text-center bg-slate-900">
            <div className="max-w-md rounded-lg bg-rose-950/70 border border-rose-500/40 p-4 text-rose-200 text-xs space-y-2">
              <p className="font-semibold">{error}</p>
              <button
                type="button"
                onClick={() => loadSession(true)}
                className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-medium"
              >
                Réessayer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
