"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Euro,
  FileCode2,
  Printer,
  Receipt,
  RefreshCw,
  RotateCcw,
  Send,
  Tag,
  UploadCloud,
  UserCheck,
  XCircle,
  Zap,
} from "lucide-react";
import {
  calculatePriceTvac,
  VERDICT_LABELS,
  type OrderVerdict,
  type PrintOrder,
} from "@/types/orders";

interface DecisionPanelProps {
  order: PrintOrder;
  onOrderUpdated: (updated: PrintOrder) => void;
  onPrinterAction: () => void;
}

interface SyncedSliceInfo {
  filename: string;
  mtimeMs: number;
  weightGrams: number;
  filamentMm: number | null;
  estimatedTime: string | null;
  fillDensity: string | null;
  layerHeight: string | null;
  supports: boolean;
}

export default function DecisionPanel({
  order,
  onOrderUpdated,
  onPrinterAction,
}: DecisionPanelProps) {
  // État formulaire TO_ANALYZE
  const [verdict, setVerdict] = useState<OrderVerdict>("PRINTABLE");
  const [weightInput, setWeightInput] = useState<string>("");
  const [comment, setComment] = useState<string>("");
  const [improvementAction, setImprovementAction] = useState<
    "QUOTE" | "DESIGNER_MEETING"
  >("QUOTE");
  const [proposeMeetingOnReject, setProposeMeetingOnReject] =
    useState<boolean>(true);

  // Synchronisation automatique en direct depuis les changements faits dans PrusaSlicer
  const [syncedSlice, setSyncedSlice] = useState<SyncedSliceInfo | null>(null);
  const lastAppliedMtimeRef = useRef<number>(0);

  // État upload G-code (APPROVED)
  const [gcodeFile, setGcodeFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);

  useEffect(() => {
    setVerdict(order.verdict ?? "PRINTABLE");
    setWeightInput(order.weightGrams !== null ? String(order.weightGrams) : "");
    setComment(order.operatorComment ?? "");
    setImprovementAction(
      order.needsDesignerMeeting ? "DESIGNER_MEETING" : "QUOTE"
    );
    setProposeMeetingOnReject(true);
    setSyncedSlice(null);
    lastAppliedMtimeRef.current = 0;
    setGcodeFile(null);
    setFeedbackError(null);
    setFeedbackSuccess(null);
  }, [
    order.id,
    order.status,
    order.verdict,
    order.weightGrams,
    order.operatorComment,
    order.needsDesignerMeeting,
  ]);

  // Écoute automatique toutes les 2 secondes des exports G-code issus du PrusaSlicer central
  useEffect(() => {
    if (order.status !== "TO_ANALYZE" && order.status !== "APPROVED") {
      return;
    }

    let cancelled = false;

    const pollPrusaSlicerExport = async () => {
      try {
        const res = await fetch(`/api/orders/${order.id}/slicer/sync`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!data.synced || !data.slice || cancelled) return;

        const slice = data.slice as SyncedSliceInfo;
        setSyncedSlice(slice);

        // Dès qu'un nouveau tranchage est exporté dans PrusaSlicer, met à jour automatiquement le poids et les infos
        if (slice.mtimeMs > lastAppliedMtimeRef.current) {
          lastAppliedMtimeRef.current = slice.mtimeMs;
          if (order.status === "TO_ANALYZE") {
            setWeightInput(String(slice.weightGrams));

            const details: string[] = ["PLA"];
            if (slice.layerHeight) details.push(`couche ${slice.layerHeight}mm`);
            if (slice.fillDensity) details.push(`remplissage ${slice.fillDensity}`);
            if (slice.supports) details.push("avec supports");
            if (slice.estimatedTime) details.push(`durée ${slice.estimatedTime}`);
            setComment(details.join(" • "));
          }
        }
      } catch {
        // Ignore erreurs réseau transitoires
      }
    };

    pollPrusaSlicerExport();
    const timer = setInterval(pollPrusaSlicerExport, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [order.id, order.status]);

  const parsedWeight = parseFloat(weightInput.replace(",", "."));
  const hasValidWeight = Number.isFinite(parsedWeight) && parsedWeight > 0;
  const computedPrice = hasValidWeight ? calculatePriceTvac(parsedWeight) : null;

  const submitDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackError(null);
    setFeedbackSuccess(null);

    if (
      (verdict === "PRINTABLE" ||
        (verdict === "NEEDS_IMPROVEMENT" && improvementAction === "QUOTE")) &&
      !hasValidWeight
    ) {
      setFeedbackError(
        "Exportez le G-code dans PrusaSlicer au centre (ou saisissez le poids PLA > 0 g)."
      );
      return;
    }

    if (verdict === "NEEDS_IMPROVEMENT" && !comment.trim()) {
      setFeedbackError(
        "Veuillez préciser les améliorations ou réserves techniques."
      );
      return;
    }

    if (verdict === "NOT_PRINTABLE" && !comment.trim()) {
      setFeedbackError("Veuillez indiquer la raison du refus.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "decision",
          verdict,
          weightGrams: hasValidWeight ? parsedWeight : null,
          operatorComment: comment.trim() || null,
          improvementAction,
          needsDesignerMeeting:
            verdict === "NOT_PRINTABLE"
              ? proposeMeetingOnReject
              : verdict === "NEEDS_IMPROVEMENT" &&
                improvementAction === "DESIGNER_MEETING",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Erreur lors de l'enregistrement.");
      }
      onOrderUpdated(data.order);
      setFeedbackSuccess("Décision enregistrée avec succès.");
    } catch (err) {
      setFeedbackError(
        err instanceof Error ? err.message : "Erreur inattendue."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (
    nextStatus: PrintOrder["status"],
    extra?: { invoiced?: boolean }
  ) => {
    setSubmitting(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "status",
          status: nextStatus,
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Impossible de mettre à jour le statut.");
      }
      onOrderUpdated(data.order);
      onPrinterAction();
    } catch (err) {
      setFeedbackError(
        err instanceof Error ? err.message : "Erreur inattendue."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectGcodeFile = (file: File | undefined) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".gcode") && !lower.endsWith(".bgcode")) {
      setFeedbackError(
        "Format invalide : veuillez sélectionner un fichier .gcode ou .bgcode."
      );
      return;
    }
    setFeedbackError(null);
    setGcodeFile(file);
  };

  const handleUploadAndPrint = async () => {
    if (!gcodeFile) {
      setFeedbackError(
        "Veuillez glisser un fichier .gcode ou .bgcode généré par PrusaSlicer."
      );
      return;
    }

    setSubmitting(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);

    try {
      const formData = new FormData();
      formData.append("orderId", order.id);
      formData.append("file", gcodeFile);

      const res = await fetch("/api/printer/print", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Échec de l'envoi vers la Prusa.");
      }

      onOrderUpdated(data.order);
      onPrinterAction();
      setFeedbackSuccess(
        data.mock
          ? `Fichier sauvegardé (${data.filename}) et impression simulée démarrée.`
          : `Fichier envoyé sur votre Prusa MK4 (${data.filename}) et impression lancée !`
      );
    } catch (err) {
      setFeedbackError(
        err instanceof Error ? err.message : "Erreur lors de l'envoi."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendLatestExportedGcode = async () => {
    setSubmitting(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);
    try {
      const res = await fetch("/api/printer/print-latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error ?? "Aucun G-code récent trouvé dans ./data/gcode/."
        );
      }
      onOrderUpdated(data.order);
      onPrinterAction();
      setFeedbackSuccess(
        `G-code PrusaSlicer (${data.filename}) envoyé et lancé sur la Prusa !`
      );
    } catch (err) {
      setFeedbackError(
        err instanceof Error ? err.message : "Erreur lors de l'envoi."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Décision & Actions
          </h2>
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
            PLA Standard
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          Étape actuelle :{" "}
          <span className="font-medium text-slate-700">{order.status}</span>
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {feedbackError && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
            {feedbackError}
          </div>
        )}

        {feedbackSuccess && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-700">
            {feedbackSuccess}
          </div>
        )}

        {/* ==================== STATUT : TO_ANALYZE ==================== */}
        {order.status === "TO_ANALYZE" && (
          <form onSubmit={submitDecision} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Diagnostic d&apos;imprimabilité (PLA)
              </label>

              {/* Choix 1 : Imprimable (Standard) */}
              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition ${
                  verdict === "PRINTABLE"
                    ? "border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="verdict"
                  checked={verdict === "PRINTABLE"}
                  onChange={() => setVerdict("PRINTABLE")}
                  className="mt-0.5 accent-emerald-600"
                />
                <div className="text-xs">
                  <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    Imprimable (Standard)
                  </div>
                  <p className="text-slate-500 mt-0.5">
                    Géométrie saine en PLA, envoi direct du devis au client.
                  </p>
                </div>
              </label>

              {/* Choix 2 : Imprimable avec améliorations */}
              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition ${
                  verdict === "NEEDS_IMPROVEMENT"
                    ? "border-amber-500 bg-amber-50/50 ring-1 ring-amber-500"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="verdict"
                  checked={verdict === "NEEDS_IMPROVEMENT"}
                  onChange={() => setVerdict("NEEDS_IMPROVEMENT")}
                  className="mt-0.5 accent-amber-600"
                />
                <div className="text-xs">
                  <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    Imprimable avec améliorations
                  </div>
                  <p className="text-slate-500 mt-0.5">
                    Devis assorti de réserves ou proposition de RDV dessinateur.
                  </p>
                </div>
              </label>

              {/* Choix 3 : Non imprimable */}
              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition ${
                  verdict === "NOT_PRINTABLE"
                    ? "border-rose-500 bg-rose-50/50 ring-1 ring-rose-500"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="verdict"
                  checked={verdict === "NOT_PRINTABLE"}
                  onChange={() => setVerdict("NOT_PRINTABLE")}
                  className="mt-0.5 accent-rose-600"
                />
                <div className="text-xs">
                  <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <XCircle className="h-3.5 w-3.5 text-rose-600" />
                    Non imprimable
                  </div>
                  <p className="text-slate-500 mt-0.5">
                    Pièce inadaptée à la FDM PLA, refus motivé + option RDV.
                  </p>
                </div>
              </label>
            </div>

            {/* Sous-options pour Imprimable avec améliorations */}
            {verdict === "NEEDS_IMPROVEMENT" && (
              <div className="space-y-3 rounded-lg bg-slate-50 p-3 border border-slate-200">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Commentaire / pistes d&apos;amélioration *
                  </label>
                  <textarea
                    rows={3}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Ex : Parois < 0.8 mm sur le clip supérieur, supports importants requis..."
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <span className="block text-xs font-medium text-slate-700 mb-1.5">
                    Suite proposée au client
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setImprovementAction("QUOTE")}
                      className={`px-2.5 py-2 rounded-md text-xs font-medium border transition ${
                        improvementAction === "QUOTE"
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                      }`}
                    >
                      Envoyer devis
                    </button>
                    <button
                      type="button"
                      onClick={() => setImprovementAction("DESIGNER_MEETING")}
                      className={`px-2.5 py-2 rounded-md text-xs font-medium border transition ${
                        improvementAction === "DESIGNER_MEETING"
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                      }`}
                    >
                      Proposer RDV dessinateur
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Synchronisation directe avec vos changements dans PrusaSlicer -> Prix TVAC */}
            {(verdict === "PRINTABLE" ||
              (verdict === "NEEDS_IMPROVEMENT" &&
                improvementAction === "QUOTE")) && (
              <div className="rounded-lg bg-slate-50 p-3.5 border border-slate-200 space-y-3">
                {syncedSlice ? (
                  <div className="rounded-md bg-emerald-50 border border-emerald-200 p-2.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-emerald-900 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        Synchronisé avec PrusaSlicer
                      </span>
                      <span className="text-[10px] font-mono text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded">
                        PLA 1.24 g/cm³
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-emerald-950 space-y-0.5">
                      <div>
                        Poids extrait :{" "}
                        <strong>{syncedSlice.weightGrams} g</strong>
                        {syncedSlice.filamentMm
                          ? ` (${(syncedSlice.filamentMm / 1000).toFixed(2)} m)`
                          : ""}
                      </div>
                      <div className="text-emerald-800">
                        {[
                          syncedSlice.fillDensity
                            ? `Remplissage ${syncedSlice.fillDensity}`
                            : null,
                          syncedSlice.layerHeight
                            ? `Couche ${syncedSlice.layerHeight}mm`
                            : null,
                          syncedSlice.supports
                            ? "Supports : Oui"
                            : "Supports : Non",
                          syncedSlice.estimatedTime
                            ? `Durée ${syncedSlice.estimatedTime}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>
                    </div>
                    <p className="text-[11px] text-emerald-700">
                      Si vous modifiez à nouveau vos réglages dans PrusaSlicer et
                      ré-exportez le G-code, ce calcul se mettra à jour tout seul.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md bg-orange-50/80 border border-orange-200 p-2.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-orange-950 flex items-center gap-1.5">
                        <Cpu className="h-3.5 w-3.5 text-orange-600" />
                        Synchronisation directe PrusaSlicer
                      </span>
                      <RefreshCw className="h-3 w-3 text-orange-500 animate-spin" />
                    </div>
                    <p className="text-[11px] text-orange-900 leading-relaxed">
                      Faites vos réglages dans <strong>PrusaSlicer au centre</strong>{" "}
                      (orientation, supports, remplissage…), cliquez sur{" "}
                      <strong>Trancher maintenant</strong> puis{" "}
                      <strong>Exporter le G-code</strong> (<kbd>Entrée</kbd>) : le
                      poids exact et le prix TVAC se rempliront automatiquement ici.
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Poids PLA en grammes *
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      min="0.1"
                      value={weightInput}
                      onChange={(e) => setWeightInput(e.target.value)}
                      placeholder="Auto-rempli à l'export PrusaSlicer (ou saisie manuelle)"
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-8 text-sm font-mono focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                    />
                    <span className="absolute right-3 top-2 text-xs text-slate-400 font-mono">
                      g
                    </span>
                  </div>
                </div>

                <div className="rounded-md bg-white p-3 border border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium text-slate-700 flex items-center gap-1">
                      <Euro className="h-3.5 w-3.5 text-orange-600" />
                      Prix TVAC calculé
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      ({hasValidWeight ? parsedWeight : 0}g × 0,20 €) + 10,00 €
                    </div>
                  </div>
                  <div className="text-lg font-bold font-mono text-slate-900">
                    {computedPrice !== null
                      ? `${computedPrice.toFixed(2)} €`
                      : "—"}
                  </div>
                </div>

                {verdict === "PRINTABLE" && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Note opérateur (optionnel)
                    </label>
                    <input
                      type="text"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Auto-rempli avec vos paramètres PrusaSlicer"
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-orange-500 focus:outline-none"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Sous-options pour Non imprimable */}
            {verdict === "NOT_PRINTABLE" && (
              <div className="space-y-3 rounded-lg bg-rose-50/50 p-3 border border-rose-200">
                <div>
                  <label className="block text-xs font-medium text-slate-800 mb-1">
                    Raison du refus *
                  </label>
                  <textarea
                    rows={3}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Ex : Modèle non-manifold (maillage ouvert) ou dimensions hors volume 250×210×220 mm..."
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={proposeMeetingOnReject}
                    onChange={(e) => setProposeMeetingOnReject(e.target.checked)}
                    className="rounded accent-orange-600"
                  />
                  Proposer un RDV avec un dessinateur 3D
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold py-2.5 px-4 transition shadow-sm"
            >
              <Send className="h-4 w-4" />
              {submitting
                ? "Enregistrement…"
                : verdict === "NOT_PRINTABLE"
                ? "Confirmer le refus"
                : verdict === "NEEDS_IMPROVEMENT" &&
                  improvementAction === "DESIGNER_MEETING"
                ? "Proposer un RDV dessinateur"
                : "Envoyer le devis au client"}
            </button>
          </form>
        )}

        {/* ==================== STATUT : QUOTE_SENT ==================== */}
        {order.status === "QUOTE_SENT" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Diagnostic</span>
                <span className="font-medium text-slate-900">
                  {order.verdict ? VERDICT_LABELS[order.verdict] : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Poids PLA</span>
                <span className="font-mono font-medium text-slate-900">
                  {order.weightGrams !== null ? `${order.weightGrams} g` : "—"}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2">
                <span className="font-medium text-slate-700">Devis TVAC</span>
                <span className="font-mono text-base font-bold text-slate-900">
                  {order.priceTvac !== null
                    ? `${order.priceTvac.toFixed(2)} €`
                    : "—"}
                </span>
              </div>
              {order.operatorComment && (
                <div className="pt-2 border-t border-slate-200 text-slate-600">
                  <span className="block font-medium text-slate-700 mb-0.5">
                    Commentaire :
                  </span>
                  {order.operatorComment}
                </div>
              )}
            </div>

            <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 text-xs text-sky-900">
              En attente de l&apos;accord du client. En mode pilote local (sans
              Odoo), utilisez le bouton ci-dessous pour simuler l&apos;acceptation.
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={() => updateStatus("APPROVED")}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold py-2.5 px-4 transition shadow-sm"
            >
              <UserCheck className="h-4 w-4" />
              Simuler validation client
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => updateStatus("TO_ANALYZE")}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium py-2 px-3 transition"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Modifier l&apos;analyse / le devis
            </button>
          </div>
        )}

        {/* ==================== STATUT : APPROVED ==================== */}
        {order.status === "APPROVED" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 p-3 text-xs space-y-1">
              <div className="font-semibold text-emerald-900">
                Devis validé ({order.priceTvac?.toFixed(2) ?? "—"} € TVAC •{" "}
                {order.weightGrams ?? "—"} g PLA)
              </div>
              {syncedSlice ? (
                <p className="text-emerald-800 font-mono text-[11px] break-all">
                  Prêt : {syncedSlice.filename} ({syncedSlice.weightGrams} g)
                </p>
              ) : (
                <p className="text-emerald-800">
                  Exportez le G-code depuis le{" "}
                  <strong>PrusaSlicer au centre</strong> puis lancez-le en un
                  clic sur la Prusa MK4.
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={handleSendLatestExportedGcode}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-semibold py-2.5 px-3 transition shadow-sm"
            >
              <Zap className="h-4 w-4" />
              {submitting
                ? "Transfert vers PrusaLink…"
                : syncedSlice
                ? `Envoyer ${syncedSlice.filename} sur la Prusa`
                : "Lancer le dernier G-code exporté de PrusaSlicer"}
            </button>

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-slate-200" />
              <span className="shrink-0 px-2 text-[10px] uppercase tracking-wider text-slate-400">
                ou glisser un autre fichier
              </span>
              <div className="flex-grow border-t border-slate-200" />
            </div>

            {/* Drag & Drop G-Code */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                handleSelectGcodeFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition ${
                isDragging
                  ? "border-orange-500 bg-orange-50"
                  : gcodeFile
                  ? "border-emerald-400 bg-emerald-50/40"
                  : "border-slate-300 bg-slate-50 hover:border-orange-400 hover:bg-white"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".gcode,.bgcode"
                className="hidden"
                onChange={(e) => handleSelectGcodeFile(e.target.files?.[0])}
              />
              {gcodeFile ? (
                <div className="space-y-1">
                  <FileCode2 className="h-6 w-6 text-emerald-600 mx-auto" />
                  <p className="text-xs font-semibold text-slate-900 break-all">
                    {gcodeFile.name}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {(gcodeFile.size / 1024).toFixed(1)} Ko — Cliquez pour
                    remplacer
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <UploadCloud className="h-7 w-7 text-slate-400 mx-auto" />
                  <p className="text-xs font-medium text-slate-700">
                    Glissez-déposez un{" "}
                    <span className="font-mono">.gcode</span> /{" "}
                    <span className="font-mono">.bgcode</span>
                  </p>
                </div>
              )}
            </div>

            {gcodeFile && (
              <button
                type="button"
                disabled={submitting}
                onClick={handleUploadAndPrint}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold py-2.5 px-4 transition shadow-sm"
              >
                <Printer className="h-4 w-4" />
                Envoyer ce fichier et lancer sur la Prusa
              </button>
            )}
          </div>
        )}

        {/* ==================== STATUT : PRINTING ==================== */}
        {order.status === "PRINTING" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-orange-50 border border-orange-200 p-3.5 space-y-2 text-xs">
              <div className="font-semibold text-orange-900 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
                Impression PLA en cours sur la Prusa
              </div>
              {order.gcodeFilename && (
                <div className="text-orange-800 font-mono text-[11px] break-all">
                  Fichier : {order.gcodeFilename}
                </div>
              )}
              <p className="text-orange-700">
                Suivez l&apos;avancement et les températures dans la barre
                supérieure. Une fois la pièce retirée du plateau, marquez la
                demande comme terminée.
              </p>
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={() => updateStatus("FINISHED")}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold py-2.5 px-4 transition"
            >
              <CheckCircle2 className="h-4 w-4" />
              Marquer l&apos;impression comme terminée
            </button>
          </div>
        )}

        {/* ==================== STATUT : FINISHED ==================== */}
        {order.status === "FINISHED" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Pièce imprimée</span>
                <span className="font-medium text-slate-900 truncate max-w-[160px]">
                  {order.stlFilename}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Montant à facturer</span>
                <span className="font-mono font-bold text-slate-900">
                  {order.priceTvac !== null
                    ? `${order.priceTvac.toFixed(2)} € TVAC`
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Facturation</span>
                <span
                  className={`font-semibold ${
                    order.invoiced ? "text-emerald-600" : "text-amber-600"
                  }`}
                >
                  {order.invoiced ? "Facturé" : "À facturer"}
                </span>
              </div>
            </div>

            <a
              href={`/orders/${order.id}/label`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2.5 px-4 transition shadow-sm"
            >
              <Tag className="h-4 w-4" />
              Imprimer étiquette
            </a>

            <button
              type="button"
              disabled={submitting || order.invoiced}
              onClick={() => updateStatus("FINISHED", { invoiced: true })}
              className={`w-full inline-flex items-center justify-center gap-2 rounded-lg text-xs font-semibold py-2.5 px-4 transition ${
                order.invoiced
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
              }`}
            >
              <Receipt className="h-4 w-4" />
              {order.invoiced
                ? "Déjà marqué comme facturé"
                : "Marquer comme facturé"}
            </button>
          </div>
        )}

        {/* ==================== STATUT : REJECTED ==================== */}
        {order.status === "REJECTED" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3.5 space-y-2 text-xs">
              <div className="font-semibold text-rose-900">
                {order.needsDesignerMeeting
                  ? "En attente d'un RDV dessinateur"
                  : "Demande refusée"}
              </div>
              {order.operatorComment && (
                <p className="text-rose-800">{order.operatorComment}</p>
              )}
              {order.needsDesignerMeeting && (
                <div className="inline-block bg-white text-rose-700 border border-rose-200 px-2 py-0.5 rounded font-medium">
                  RDV dessinateur proposé au client
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={() => updateStatus("TO_ANALYZE")}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium py-2 px-3 transition"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Réouvrir l&apos;analyse
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
