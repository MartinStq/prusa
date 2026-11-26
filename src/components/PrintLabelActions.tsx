"use client";

import { Printer } from "lucide-react";

export default function PrintLabelActions() {
  return (
    <div className="no-print flex items-center justify-between mb-6 bg-slate-900 text-white px-4 py-3 rounded-lg">
      <span className="text-xs text-slate-300">
        Aperçu d&apos;impression de l&apos;étiquette client
      </span>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold px-3.5 py-2 rounded-md transition"
      >
        <Printer className="h-4 w-4" />
        Lancer l&apos;impression
      </button>
    </div>
  );
}
