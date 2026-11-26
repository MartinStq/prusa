export const ORDER_STATUSES = [
  "TO_ANALYZE",
  "QUOTE_SENT",
  "APPROVED",
  "PRINTING",
  "FINISHED",
  "REJECTED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_VERDICTS = [
  "PRINTABLE",
  "NEEDS_IMPROVEMENT",
  "NOT_PRINTABLE",
] as const;

export type OrderVerdict = (typeof ORDER_VERDICTS)[number];

export interface PrintOrder {
  id: string;
  createdAt: string;
  updatedAt: string;
  clientName: string;
  clientEmail: string;
  stlFilename: string;
  stlPath: string;
  gcodeFilename: string | null;
  status: OrderStatus;
  verdict: OrderVerdict | null;
  weightGrams: number | null;
  priceTvac: number | null;
  operatorComment: string | null;
  needsDesignerMeeting: boolean;
  invoiced: boolean;
  invoicedAt: string | null;
}

export interface CreateOrderInput {
  clientName: string;
  clientEmail: string;
  stlFilename: string;
  stlPath: string;
}

export interface UpdateOrderDecisionInput {
  verdict: OrderVerdict;
  weightGrams?: number | null;
  operatorComment?: string | null;
  needsDesignerMeeting?: boolean;
  /**
   * Pour NEEDS_IMPROVEMENT : permet de choisir entre envoyer un devis ("QUOTE")
   * ou proposer un RDV dessinateur sans devis immédiat ("DESIGNER_MEETING").
   */
  improvementAction?: "QUOTE" | "DESIGNER_MEETING";
}

export type PrinterState = "IDLE" | "PRINTING" | "FINISHED" | "OFFLINE";

export interface PrinterStatusPayload {
  state: PrinterState;
  rawState?: string;
  mock: boolean;
  host?: string;
  tempNozzle: number | null;
  targetNozzle: number | null;
  tempBed: number | null;
  targetBed: number | null;
  progress: number | null;
  timeRemainingSeconds: number | null;
  activeFile: string | null;
  activeOrderId?: string | null;
  message?: string;
}

/**
 * Formule tarifaire pilote : Prix TVAC = (grammes * 0.20) + 10 €
 */
export function calculatePriceTvac(weightGrams: number): number {
  if (!Number.isFinite(weightGrams) || weightGrams < 0) return 10;
  return Number((weightGrams * 0.2 + 10).toFixed(2));
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  TO_ANALYZE: "À analyser",
  QUOTE_SENT: "Devis envoyé",
  APPROVED: "Validé client",
  PRINTING: "En impression",
  FINISHED: "Terminé",
  REJECTED: "Refusé / RDV",
};

export const VERDICT_LABELS: Record<OrderVerdict, string> = {
  PRINTABLE: "Imprimable (Standard)",
  NEEDS_IMPROVEMENT: "Imprimable avec améliorations",
  NOT_PRINTABLE: "Non imprimable",
};
