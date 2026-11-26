import { notFound } from "next/navigation";
import { getOrderById } from "@/services/orders";
import PrintLabelActions from "@/components/PrintLabelActions";

export const dynamic = "force-dynamic";

export default async function OrderLabelPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const order = await getOrderById(id);

  if (!order) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-slate-100 py-10 px-4 print:bg-white print:p-0">
      <div className="max-w-md mx-auto">
        <PrintLabelActions />

        <div className="bg-white border-2 border-slate-900 rounded-xl p-6 shadow-sm print:shadow-none print:rounded-none">
          <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-orange-600">
                Service Impression 3D
              </p>
              <h1 className="text-lg font-extrabold text-slate-900 mt-0.5">
                Étiquette de Retrait
              </h1>
            </div>
            <div className="text-right font-mono">
              <span className="text-[10px] uppercase text-slate-500 block">
                Commande
              </span>
              <span className="text-sm font-bold text-slate-900">
                #{order.id.slice(-8).toUpperCase()}
              </span>
            </div>
          </div>

          <div className="py-4 space-y-3 text-sm border-b border-slate-200">
            <div>
              <span className="text-[11px] uppercase tracking-wider text-slate-500 block">
                Client
              </span>
              <p className="font-bold text-base text-slate-900">
                {order.clientName}
              </p>
              <p className="text-xs text-slate-600">{order.clientEmail}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-slate-500 block">
                  Fichier STL
                </span>
                <p className="font-mono text-xs font-medium text-slate-800 break-all">
                  {order.stlFilename}
                </p>
              </div>
              <div>
                <span className="text-[11px] uppercase tracking-wider text-slate-500 block">
                  Date
                </span>
                <p className="text-xs font-medium text-slate-800">
                  {new Date(order.updatedAt).toLocaleDateString("fr-BE", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>

            {order.weightGrams !== null && (
              <div>
                <span className="text-[11px] uppercase tracking-wider text-slate-500 block">
                  Poids matière
                </span>
                <p className="font-mono text-xs font-medium text-slate-800">
                  {order.weightGrams} g
                </p>
              </div>
            )}
          </div>

          <div className="pt-4 flex items-end justify-between">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-slate-500 block">
                ID Complet
              </span>
              <span className="font-mono text-[10px] text-slate-600">
                {order.id}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 block">
                Total TVAC
              </span>
              <span className="font-mono text-2xl font-black text-slate-900">
                {order.priceTvac !== null
                  ? `${order.priceTvac.toFixed(2)} €`
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
