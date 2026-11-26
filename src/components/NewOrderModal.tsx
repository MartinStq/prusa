"use client";

import { useState } from "react";
import { Upload, X } from "lucide-react";
import type { PrintOrder } from "@/types/orders";

interface NewOrderModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (order: PrintOrder) => void;
}

export default function NewOrderModal({
  open,
  onClose,
  onCreated,
}: NewOrderModalProps) {
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [stlFile, setStlFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stlFile) {
      setError("Veuillez sélectionner un fichier .stl.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("clientName", clientName);
      formData.append("clientEmail", clientEmail);
      formData.append("file", stlFile);

      const res = await fetch("/api/orders", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Impossible de créer la demande.");
      }

      onCreated(data.order);
      setClientName("");
      setClientEmail("");
      setStlFile(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            Nouvelle demande d&apos;impression STL
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-rose-700">
              {error}
            </div>
          )}

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Nom du client *
            </label>
            <input
              type="text"
              required
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Ex : Jean Dupont"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              E-mail du client *
            </label>
            <input
              type="email"
              required
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="jean.dupont@exemple.be"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Fichier 3D (.stl) *
            </label>
            <label className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 hover:border-orange-400 rounded-lg p-4 cursor-pointer bg-slate-50">
              <Upload className="h-4 w-4 text-slate-500" />
              <span className="text-slate-700 font-medium truncate">
                {stlFile ? stlFile.name : "Choisir un fichier .stl"}
              </span>
              <input
                type="file"
                accept=".stl"
                className="hidden"
                onChange={(e) => setStlFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-semibold disabled:opacity-50"
            >
              {submitting ? "Création…" : "Ajouter à la file"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
