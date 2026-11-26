import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { updateOrderStatus } from "@/services/orders";
import type { PrinterState, PrinterStatusPayload } from "@/types/orders";

interface MockPrinterSession {
  state: PrinterState;
  activeFile: string | null;
  activeOrderId: string | null;
  startedAtMs: number | null;
  durationSeconds: number;
  mockOverride: boolean | null;
}

const globalForMockPrinter = globalThis as unknown as {
  mockPrinterSession?: MockPrinterSession;
};

function getMockSession(): MockPrinterSession {
  if (!globalForMockPrinter.mockPrinterSession) {
    globalForMockPrinter.mockPrinterSession = {
      state: "IDLE",
      activeFile: null,
      activeOrderId: null,
      startedAtMs: null,
      durationSeconds: 90,
      mockOverride: null,
    };
  }
  return globalForMockPrinter.mockPrinterSession;
}

export function isPrusaMockEnabled(): boolean {
  const session = getMockSession();
  if (session.mockOverride !== null) {
    return session.mockOverride;
  }
  return String(process.env.PRUSA_MOCK ?? "true").toLowerCase() === "true";
}

export function setPrusaMockMode(enabled: boolean): void {
  getMockSession().mockOverride = enabled;
}

function md5(value: string): string {
  return crypto.createHash("md5").update(value).digest("hex");
}

/**
 * Génère l'en-tête HTTP Digest Auth (RFC 2617 / RFC 2069) pour le firmware Buddy de la Prusa MK4
 * lorsque PrusaLink demande l'authentification Digest (`user: maker` + password PrusaLink).
 */
function buildDigestAuthHeader(params: {
  wwwAuthenticate: string;
  method: string;
  uriPath: string;
  username: string;
  password: string;
}): string | null {
  const { wwwAuthenticate, method, uriPath, username, password } = params;
  if (!/^Digest\s+/i.test(wwwAuthenticate)) return null;

  const extract = (key: string): string | undefined => {
    const quoted = new RegExp(`${key}="([^"]*)"`, "i").exec(wwwAuthenticate);
    if (quoted) return quoted[1];
    const unquoted = new RegExp(`${key}=([^,\\s]+)`, "i").exec(wwwAuthenticate);
    return unquoted?.[1];
  };

  const realm = extract("realm") ?? "Printer API";
  const nonce = extract("nonce");
  if (!nonce) return null;

  const qopRaw = extract("qop");
  const opaque = extract("opaque");

  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method.toUpperCase()}:${uriPath}`);

  const qopTokens = qopRaw
    ? qopRaw.split(",").map((s) => s.trim().toLowerCase())
    : [];
  const useAuthQop = qopTokens.includes("auth");

  let responseHash: string;
  const parts: string[] = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uriPath}"`,
  ];

  if (useAuthQop) {
    const nc = "00000001";
    const cnonce = crypto.randomBytes(8).toString("hex");
    responseHash = md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
    parts.push(`qop=auth`, `nc=${nc}`, `cnonce="${cnonce}"`);
  } else {
    responseHash = md5(`${ha1}:${nonce}:${ha2}`);
  }

  parts.push(`response="${responseHash}"`);
  if (opaque) {
    parts.push(`opaque="${opaque}"`);
  }

  return `Digest ${parts.join(", ")}`;
}

/**
 * Effectue une requête vers PrusaLink en envoyant `X-Api-Key`, et répond automatiquement
 * au challenge HTTP Digest (`maker` + mot de passe PrusaLink) si la Prusa MK4 renvoie 401.
 */
async function prusaFetch(
  host: string,
  uriPath: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const apiKey = process.env.PRUSA_API_KEY?.trim() ?? "";
  const username = process.env.PRUSA_USER?.trim() || "maker";
  const timeoutMs = init.timeoutMs ?? 3500;
  const method = (init.method ?? "GET").toUpperCase();
  const url = `http://${host}${uriPath}`;

  const baseHeaders: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    ...(apiKey ? { "X-Api-Key": apiKey } : {}),
  };

  const firstRes = await fetch(url, {
    ...init,
    method,
    headers: baseHeaders,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (firstRes.status !== 401 || !apiKey) {
    return firstRes;
  }

  const wwwAuth = firstRes.headers.get("www-authenticate") ?? "";
  const digestHeader = buildDigestAuthHeader({
    wwwAuthenticate: wwwAuth,
    method,
    uriPath,
    username,
    password: apiKey,
  });

  if (!digestHeader) {
    return firstRes;
  }

  const restHeaders: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };

  return fetch(url, {
    ...init,
    method,
    headers: {
      ...restHeaders,
      Authorization: digestHeader,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function getCandidateHosts(): string[] {
  const ip = process.env.PRUSA_IP?.trim();
  if (ip) return [ip];
  const hostname = process.env.PRUSA_HOSTNAME?.trim();
  if (hostname) {
    return [hostname.includes(".") ? hostname : `${hostname}.local`];
  }
  return [];
}

function normalizePrusaState(rawState?: string): PrinterState {
  if (!rawState) return "OFFLINE";
  const upper = rawState.toUpperCase();
  if (upper === "PRINTING" || upper === "PAUSED" || upper === "BUSY") {
    return "PRINTING";
  }
  if (upper === "FINISHED") {
    return "FINISHED";
  }
  if (
    upper === "IDLE" ||
    upper === "READY" ||
    upper === "STOPPED" ||
    upper === "ATTENTION"
  ) {
    return "IDLE";
  }
  return "OFFLINE";
}

export async function setMockPrinterState(
  nextState: "IDLE" | "FINISHED"
): Promise<void> {
  const session = getMockSession();
  if (nextState === "FINISHED" && session.activeOrderId) {
    try {
      await updateOrderStatus(session.activeOrderId, "FINISHED");
    } catch {
      // Ignore
    }
    session.state = "FINISHED";
    session.startedAtMs = null;
  } else if (nextState === "IDLE") {
    session.state = "IDLE";
    session.activeFile = null;
    session.activeOrderId = null;
    session.startedAtMs = null;
  }
}

export async function fetchPrusaStatus(): Promise<PrinterStatusPayload> {
  const configuredHost =
    process.env.PRUSA_IP?.trim() || process.env.PRUSA_HOSTNAME?.trim() || "";

  if (isPrusaMockEnabled()) {
    const session = getMockSession();

    if (session.state === "PRINTING" && session.startedAtMs) {
      const elapsedSec = (Date.now() - session.startedAtMs) / 1000;
      if (elapsedSec >= session.durationSeconds) {
        session.state = "FINISHED";
        session.startedAtMs = null;
        if (session.activeOrderId) {
          try {
            await updateOrderStatus(session.activeOrderId, "FINISHED");
          } catch {
            // Ignore
          }
        }
      } else {
        const progress = Math.min(
          99,
          Math.max(1, Math.round((elapsedSec / session.durationSeconds) * 100))
        );
        const remaining = Math.max(
          1,
          Math.round(session.durationSeconds - elapsedSec)
        );
        return {
          state: "PRINTING",
          rawState: "PRINTING",
          mock: true,
          host: configuredHost,
          tempNozzle: 215.2,
          targetNozzle: 215,
          tempBed: 60.1,
          targetBed: 60,
          progress,
          timeRemainingSeconds: remaining,
          activeFile: session.activeFile,
          activeOrderId: session.activeOrderId,
          message: "Mode simulation PrusaLink actif",
        };
      }
    }

    if (session.state === "FINISHED") {
      return {
        state: "FINISHED",
        rawState: "FINISHED",
        mock: true,
        host: configuredHost,
        tempNozzle: 34.5,
        targetNozzle: 0,
        tempBed: 29.8,
        targetBed: 0,
        progress: 100,
        timeRemainingSeconds: 0,
        activeFile: session.activeFile,
        activeOrderId: session.activeOrderId,
        message: "Impression simulée terminée",
      };
    }

    return {
      state: "IDLE",
      rawState: "IDLE",
      mock: true,
      host: configuredHost,
      tempNozzle: 24.6,
      targetNozzle: 0,
      tempBed: 23.2,
      targetBed: 0,
      progress: null,
      timeRemainingSeconds: null,
      activeFile: null,
      activeOrderId: null,
      message: "Mode simulation PrusaLink actif",
    };
  }

  const hosts = getCandidateHosts();
  if (hosts.length === 0) {
    return {
      state: "OFFLINE",
      mock: false,
      tempNozzle: null,
      targetNozzle: null,
      tempBed: null,
      targetBed: null,
      progress: null,
      timeRemainingSeconds: null,
      activeFile: null,
      message: "PRUSA_IP non configurée dans .env",
    };
  }

  let lastErrorMsg = `Prusa MK4 (${hosts[0]}) injoignable sur ce Wi-Fi`;

  for (const host of hosts) {
    try {
      const statusRes = await prusaFetch(host, "/api/v1/status", {
        headers: { Accept: "application/json" },
        timeoutMs: 3000,
      });

      if (!statusRes.ok) {
        lastErrorMsg =
          statusRes.status === 401
            ? `Authentification refusée par ${host} (vérifiez PRUSA_USER / PRUSA_API_KEY)`
            : `PrusaLink ${host} HTTP ${statusRes.status}`;
        continue;
      }

      const jobRes = await prusaFetch(host, "/api/v1/job", {
        headers: { Accept: "application/json" },
        timeoutMs: 2500,
      }).catch(() => null);

      const statusData = await statusRes.json();
      const jobData =
        jobRes && jobRes.status === 200
          ? await jobRes.json().catch(() => null)
          : null;

      const printer = statusData?.printer ?? {};
      const statusJob = statusData?.job ?? {};

      const rawState: string | undefined = printer.state ?? jobData?.state;
      const state = normalizePrusaState(rawState);

      const progressRaw = statusJob.progress ?? jobData?.progress ?? null;
      const progress =
        typeof progressRaw === "number" ? Math.round(progressRaw) : null;

      const timeRemainingRaw =
        statusJob.time_remaining ?? jobData?.time_remaining ?? null;
      const timeRemainingSeconds =
        typeof timeRemainingRaw === "number"
          ? Math.round(timeRemainingRaw)
          : null;

      const activeFile =
        jobData?.file?.display_name ?? jobData?.file?.name ?? null;

      return {
        state,
        rawState,
        mock: false,
        host,
        tempNozzle:
          typeof printer.temp_nozzle === "number" ? printer.temp_nozzle : null,
        targetNozzle:
          typeof printer.target_nozzle === "number"
            ? printer.target_nozzle
            : null,
        tempBed: typeof printer.temp_bed === "number" ? printer.temp_bed : null,
        targetBed:
          typeof printer.target_bed === "number" ? printer.target_bed : null,
        progress,
        timeRemainingSeconds,
        activeFile,
      };
    } catch {
      lastErrorMsg = `Prusa MK4 (${host}) hors ligne ou sur un autre sous-réseau Wi-Fi`;
    }
  }

  return {
    state: "OFFLINE",
    mock: false,
    host: hosts[0],
    tempNozzle: null,
    targetNozzle: null,
    tempBed: null,
    targetBed: null,
    progress: null,
    timeRemainingSeconds: null,
    activeFile: null,
    message: lastErrorMsg,
  };
}

export async function uploadGcodeAndStartPrint(params: {
  orderId: string;
  originalFilename: string;
  fileBuffer: Buffer;
}) {
  const ext = path.extname(params.originalFilename).toLowerCase();
  if (ext !== ".gcode" && ext !== ".bgcode") {
    throw new Error("Seuls les fichiers .gcode et .bgcode sont acceptés.");
  }

  const base = path
    .basename(params.originalFilename, ext)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 60);
  const suffix = `_${params.orderId.slice(-6)}`;
  const safeFilename = `${base || "print"}${
    base.endsWith(suffix) ? "" : suffix
  }${ext}`;

  const gcodeDir = path.join(process.cwd(), "data", "gcode");
  await fs.mkdir(gcodeDir, { recursive: true });
  const localPath = path.join(gcodeDir, safeFilename);
  await fs.writeFile(localPath, params.fileBuffer);

  if (isPrusaMockEnabled()) {
    const session = getMockSession();
    session.state = "PRINTING";
    session.activeFile = safeFilename;
    session.activeOrderId = params.orderId;
    session.startedAtMs = Date.now();

    const updatedOrder = await updateOrderStatus(params.orderId, "PRINTING", {
      gcodeFilename: safeFilename,
    });

    return {
      mock: true,
      filename: safeFilename,
      localPath: `./data/gcode/${safeFilename}`,
      order: updatedOrder,
    };
  }

  const hosts = getCandidateHosts();
  if (hosts.length === 0) {
    throw new Error("Variable PRUSA_IP manquante dans la configuration serveur.");
  }

  // Vérifie qu'une clé USB est bien présente dans la Prusa avant d'envoyer le fichier
  try {
    const storageRes = await prusaFetch(hosts[0], "/api/v1/storage", {
      headers: { Accept: "application/json" },
      timeoutMs: 3000,
    });
    if (storageRes.ok) {
      const storageData = await storageRes.json();
      const usb = (storageData?.storage_list ?? []).find(
        (s: { path?: string }) => s.path === "/usb/"
      );
      if (usb && usb.available === false) {
        throw new Error(
          "Aucune clé USB détectée dans la Prusa MK4. Insérez une clé USB (FAT32) à l'avant de l'imprimante puis réessayez."
        );
      }
      if (usb && usb.read_only === true) {
        throw new Error(
          "La clé USB de la Prusa est en lecture seule. Vérifiez la clé puis réessayez."
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("clé USB")) {
      throw err;
    }
    // Vérification non bloquante si l'endpoint storage ne répond pas
  }

  const uriPath = `/api/v1/files/usb/${encodeURIComponent(safeFilename)}`;
  let lastError: Error | null = null;

  for (const host of hosts) {
    try {
      const response = await prusaFetch(host, uriPath, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(params.fileBuffer.byteLength),
          "Print-After-Upload": "?1",
          Overwrite: "?1",
        },
        body: new Uint8Array(params.fileBuffer),
        timeoutMs: 45000,
      });

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        throw new Error(
          `Échec PrusaLink sur ${host} (HTTP ${response.status}) ${details}`.trim()
        );
      }

      const updatedOrder = await updateOrderStatus(params.orderId, "PRINTING", {
        gcodeFilename: safeFilename,
      });

      return {
        mock: false,
        host,
        filename: safeFilename,
        localPath: `./data/gcode/${safeFilename}`,
        order: updatedOrder,
      };
    } catch (err) {
      lastError =
        err instanceof Error
          ? err
          : new Error(`Impossible de joindre la Prusa sur ${host}`);
    }
  }

  throw (
    lastError ??
    new Error("Impossible d'envoyer le fichier G-code vers la Prusa MK4.")
  );
}
