"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Calendar,
  Download,
  FileBox,
  Inbox,
  Mail,
  Scale,
  User,
} from "lucide-react";
import PrinterStatusBar from "@/components/PrinterStatusBar";
import PrusaSlicerEmbed from "@/components/PrusaSlicerEmbed";
import DecisionPanel from "@/components/DecisionPanel";
import NewOrderModal from "@/components/NewOrderModal";
import {
  ORDER_STATUSES,
  STATUS_LABELS,
  type OrderStatus,
  type PrintOrder,
} from "@/types/orders";

interface OperatorDashboardProps {
  initialOrders: PrintOrder[];
}

const BADGE_COLORS: Record<OrderStatus, string> = {
  TO_ANALYZE: "bg-amber-100 text-amber-800 border-amber-200",
  QUOTE_SENT: "bg-sky-100 text-sky-800 border-sky-200",
  APPROVED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  PRINTING: "bg-orange-100 text-orange-800 border-orange-200",
  FINISHED: "bg-slate-200 text-slate-800 border-slate-300",
  REJECTED: "bg-rose-100 text-rose-800 border-rose-200",
};

export default function OperatorDashboard({
  initialOrders,
}: OperatorDashboardProps) {
  const initialDefaultStatus: OrderStatus =
    ORDER_STATUSES.find((st) => initialOrders.some((o) => o.status === st)) ??
    "TO_ANALYZE";

  const [orders, setOrders] = useState<PrintOrder[]>(initialOrders);
  const [statusFilter, setStatusFilter] =
    useState<OrderStatus>(initialDefaultStatus);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialOrders.find((o) => o.status === initialDefaultStatus)?.id ??
      initialOrders[0]?.id ??
      null
  );
  const [printerRefreshKey, setPrinterRefreshKey] = useState(0);
  const [newModalOpen, setNewModalOpen] = useState(false);

  const reloadOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.orders)) {
        setOrders(data.orders);
      }
    } catch {
      // Ignore
    }
  }, []);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => o.status === statusFilter);
  }, [orders, statusFilter]);

  const selectedOrder = useMemo(() => {
    const inCurrentTab = filteredOrders.find((o) => o.id === selectedId);
    return inCurrentTab ?? filteredOrders[0] ?? null;
  }, [selectedId, filteredOrders]);

  const countsByStatus = useMemo(() => {
    const counts: Record<OrderStatus, number> = {
      TO_ANALYZE: 0,
      QUOTE_SENT: 0,
      APPROVED: 0,
      PRINTING: 0,
      FINISHED: 0,
      REJECTED: 0,
    };
    for (const o of orders) {
      counts[o.status] = (counts[o.status] ?? 0) + 1;
    }
    return counts;
  }, [orders]);

  const handleSelectFilter = (st: OrderStatus) => {
    setStatusFilter(st);
    const firstInTab = orders.find((o) => o.status === st);
    setSelectedId(firstInTab?.id ?? null);
  };

  const handleOrderUpdated = (updated: PrintOrder) => {
    setOrders((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    setStatusFilter(updated.status);
    setSelectedId(updated.id);
  };

  const handleOrderCreated = (created: PrintOrder) => {
    setOrders((prev) => [created, ...prev]);
    setStatusFilter("TO_ANALYZE");
    setSelectedId(created.id);
  };

  const handleSimulateOrders = async (mode: "single" | "batch" | "clear") => {
    const res = await fetch("/api/orders/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, count: mode === "batch" ? 3 : 1 }),
    });
    if (!res.ok) return;
    const data = await res.json();

    if (mode === "clear") {
      setOrders([]);
      setStatusFilter("TO_ANALYZE");
      setSelectedId(null);
      return;
    }

    if (Array.isArray(data.created) && data.created.length > 0) {
      const createdList = data.created as PrintOrder[];
      setOrders((prev) => [...createdList.reverse(), ...prev]);
      setStatusFilter("TO_ANALYZE");
      setSelectedId(createdList[0].id);
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-100">
      {/* 1. BARRE DU HAUT : STATUT PRUSA EN DIRECT */}
      <PrinterStatusBar
        refreshTrigger={printerRefreshKey}
        onOpenNewOrder={() => setNewModalOpen(true)}
        onSimulateOrders={handleSimulateOrders}
        onPrinterFinished={reloadOrders}
      />

      {/* CORPS EN 3 COLONNES (flex fixe sur les côtés pour maximiser PrusaSlicer) */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* 2. COLONNE GAUCHE : FILE D'ATTENTE (sans filtre "Toutes") */}
        <aside className="w-full lg:w-[265px] shrink-0 border-r border-slate-200 bg-white flex flex-col min-h-0">
          <div className="p-3 border-b border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                File d&apos;attente ({filteredOrders.length})
              </h2>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200">
                PLA
              </span>
            </div>

            {/* Filtres uniquement par statut */}
            <div className="flex flex-wrap gap-1.5">
              {ORDER_STATUSES.map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => handleSelectFilter(st)}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium transition ${
                    statusFilter === st
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {STATUS_LABELS[st]} ({countsByStatus[st] ?? 0})
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredOrders.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs space-y-2">
                <Inbox className="h-7 w-7 mx-auto text-slate-300" />
                <p>Aucune demande en statut « {STATUS_LABELS[statusFilter]} ».</p>
              </div>
            ) : (
              filteredOrders.map((item) => {
                const active = selectedOrder?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left px-3.5 py-3 transition block ${
                      active
                        ? "bg-orange-50/70 border-l-4 border-l-orange-600"
                        : "hover:bg-slate-50 border-l-4 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-xs text-slate-900 truncate">
                        {item.clientName}
                      </span>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          BADGE_COLORS[item.status]
                        }`}
                      >
                        {STATUS_LABELS[item.status]}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                      <FileBox className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span className="truncate font-mono text-[11px]">
                        {item.stlFilename}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                      <span>
                        {new Date(item.createdAt).toLocaleDateString("fr-BE", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {item.invoiced && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium text-[10px]">
                            Facturé
                          </span>
                        )}
                        {item.priceTvac !== null && (
                          <span className="font-mono font-semibold text-slate-700">
                            {item.priceTvac.toFixed(2)} €
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* 3. ZONE CENTRALE : VRAI PRUSASLICER INTÉGRÉ */}
        <main className="flex-1 min-w-0 p-3 flex flex-col gap-2.5 min-h-0 overflow-hidden">
          {selectedOrder ? (
            <>
              {/* En-tête fiche client + Télécharger le STL */}
              <div className="rounded-xl bg-white border border-slate-200 px-4 py-2.5 shadow-sm flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      <User className="h-4 w-4 text-slate-400" />
                      {selectedOrder.clientName}
                    </h1>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                        BADGE_COLORS[selectedOrder.status]
                      }`}
                    >
                      {STATUS_LABELS[selectedOrder.status]}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      #{selectedOrder.id.slice(-8)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    <a
                      href={`mailto:${selectedOrder.clientEmail}`}
                      className="inline-flex items-center gap-1 hover:text-orange-600"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {selectedOrder.clientEmail}
                    </a>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {new Date(selectedOrder.createdAt).toLocaleString("fr-BE")}
                    </span>
                    {selectedOrder.weightGrams !== null && (
                      <span className="inline-flex items-center gap-1 font-mono text-slate-700">
                        <Scale className="h-3.5 w-3.5 text-slate-400" />
                        {selectedOrder.weightGrams} g PLA
                      </span>
                    )}
                  </div>
                </div>

                <a
                  href={`/api/orders/${selectedOrder.id}/stl?download=1`}
                  download={selectedOrder.stlFilename}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3 py-2 transition shadow-sm shrink-0"
                >
                  <Download className="h-3.5 w-3.5 text-orange-400" />
                  Télécharger le STL
                </a>
              </div>

              {/* Vrai PrusaSlicer intégré directement à la place du viewer Three.js */}
              <PrusaSlicerEmbed
                orderId={selectedOrder.id}
                stlFilename={selectedOrder.stlFilename}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-slate-400 text-sm">
              Aucune demande sélectionnée dans le statut «{" "}
              {STATUS_LABELS[statusFilter]} ».
            </div>
          )}
        </main>

        {/* 4. COLONNE DROITE : DÉCISION & ACTIONS */}
        <section className="w-full lg:w-[325px] shrink-0 border-l border-slate-200 bg-white flex flex-col min-h-0">
          {selectedOrder ? (
            <DecisionPanel
              order={selectedOrder}
              onOrderUpdated={handleOrderUpdated}
              onPrinterAction={() => setPrinterRefreshKey((k) => k + 1)}
            />
          ) : (
            <div className="p-6 text-xs text-slate-400">
              Sélectionnez un autre statut à gauche pour afficher ses demandes.
            </div>
          )}
        </section>
      </div>

      <NewOrderModal
        open={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        onCreated={handleOrderCreated}
      />
    </div>
  );
}
