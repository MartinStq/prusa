import { prisma } from "@/lib/prisma";
import type { PrintRequest } from "@prisma/client";
import {
  calculatePriceTvac,
  type CreateOrderInput,
  type OrderStatus,
  type OrderVerdict,
  type PrintOrder,
  type UpdateOrderDecisionInput,
} from "@/types/orders";

export type {
  CreateOrderInput,
  OrderStatus,
  OrderVerdict,
  PrintOrder,
  UpdateOrderDecisionInput,
};

/**
 * Convertit l'enregistrement SQLite/Prisma en DTO métier découplé.
 * Lors de la migration vers Odoo Online (JSON-RPC / XML-RPC), seul ce fichier
 * sera adapté : le reste de l'application consomme uniquement `PrintOrder`.
 */
function toPrintOrder(record: PrintRequest): PrintOrder {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    clientName: record.clientName,
    clientEmail: record.clientEmail,
    stlFilename: record.stlFilename,
    stlPath: record.stlPath,
    gcodeFilename: record.gcodeFilename,
    status: record.status as OrderStatus,
    verdict: (record.verdict as OrderVerdict | null) ?? null,
    weightGrams: record.weightGrams,
    priceTvac: record.priceTvac,
    operatorComment: record.operatorComment,
    needsDesignerMeeting: record.needsDesignerMeeting,
    invoiced: record.invoiced,
    invoicedAt: record.invoicedAt ? record.invoicedAt.toISOString() : null,
  };
}

/**
 * Récupère la liste des demandes d'impression (triées des plus récentes aux plus anciennes).
 * Point d'intégration futur : `sale.order` / `helpdesk.ticket` dans Odoo Online.
 */
export async function getOrders(filters?: {
  status?: OrderStatus;
}): Promise<PrintOrder[]> {
  const records = await prisma.printRequest.findMany({
    where: filters?.status ? { status: filters.status } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return records.map(toPrintOrder);
}

/**
 * Récupère une demande d'impression par son identifiant.
 */
export async function getOrderById(id: string): Promise<PrintOrder | null> {
  const record = await prisma.printRequest.findUnique({
    where: { id },
  });
  return record ? toPrintOrder(record) : null;
}

/**
 * Crée une nouvelle demande d'impression (statut initial : TO_ANALYZE).
 */
export async function createOrder(input: CreateOrderInput): Promise<PrintOrder> {
  const record = await prisma.printRequest.create({
    data: {
      clientName: input.clientName.trim(),
      clientEmail: input.clientEmail.trim(),
      stlFilename: input.stlFilename,
      stlPath: input.stlPath,
      status: "TO_ANALYZE",
    },
  });
  return toPrintOrder(record);
}

/**
 * Enregistre la décision technique de l'opérateur suite à l'inspection du STL.
 * Calcule automatiquement le prix TVAC côté serveur pour garantir la cohérence.
 */
export async function updateOrderDecision(
  id: string,
  input: UpdateOrderDecisionInput
): Promise<PrintOrder> {
  let nextStatus: OrderStatus;
  let weightGrams: number | null = null;
  let priceTvac: number | null = null;
  let needsDesignerMeeting = Boolean(input.needsDesignerMeeting);
  const comment = input.operatorComment?.trim() || null;

  if (input.verdict === "PRINTABLE") {
    if (typeof input.weightGrams !== "number" || input.weightGrams <= 0) {
      throw new Error("Le poids en grammes doit être supérieur à 0.");
    }
    weightGrams = Number(input.weightGrams.toFixed(2));
    priceTvac = calculatePriceTvac(weightGrams);
    needsDesignerMeeting = false;
    nextStatus = "QUOTE_SENT";
  } else if (input.verdict === "NEEDS_IMPROVEMENT") {
    if (input.improvementAction === "DESIGNER_MEETING") {
      needsDesignerMeeting = true;
      nextStatus = "REJECTED";
    } else {
      if (typeof input.weightGrams !== "number" || input.weightGrams <= 0) {
        throw new Error("Le poids en grammes est requis pour envoyer un devis.");
      }
      weightGrams = Number(input.weightGrams.toFixed(2));
      priceTvac = calculatePriceTvac(weightGrams);
      needsDesignerMeeting = false;
      nextStatus = "QUOTE_SENT";
    }
  } else {
    // NOT_PRINTABLE
    nextStatus = "REJECTED";
  }

  const record = await prisma.printRequest.update({
    where: { id },
    data: {
      verdict: input.verdict,
      weightGrams,
      priceTvac,
      operatorComment: comment,
      needsDesignerMeeting,
      status: nextStatus,
    },
  });

  return toPrintOrder(record);
}

/**
 * Met à jour le statut du cycle de vie d'une demande (ex: QUOTE_SENT -> APPROVED -> PRINTING -> FINISHED)
 * ainsi que les métadonnées associées (fichier G-code, marquage facturation).
 */
export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
  options?: {
    gcodeFilename?: string;
    invoiced?: boolean;
  }
): Promise<PrintOrder> {
  const record = await prisma.printRequest.update({
    where: { id },
    data: {
      status,
      ...(options?.gcodeFilename !== undefined
        ? { gcodeFilename: options.gcodeFilename }
        : {}),
      ...(options?.invoiced !== undefined
        ? {
            invoiced: options.invoiced,
            invoicedAt: options.invoiced ? new Date() : null,
          }
        : {}),
    },
  });

  return toPrintOrder(record);
}
