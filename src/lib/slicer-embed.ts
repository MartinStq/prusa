import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DISPLAY_NUM = ":98";
const VNC_PORT = 5998;

interface EmbedRuntime {
  xvncProc: ChildProcess | null;
  slicerProc: ChildProcess | null;
  fitInterval: NodeJS.Timeout | null;
  currentStlPath: string | null;
  activeOrderId: string | null;
  sessionOpenedAtMs: number;
  startingPromise: Promise<void> | null;
}

const globalForEmbed = globalThis as unknown as {
  __prusaSlicerEmbed?: EmbedRuntime;
};

function getRuntime(): EmbedRuntime {
  if (!globalForEmbed.__prusaSlicerEmbed) {
    globalForEmbed.__prusaSlicerEmbed = {
      xvncProc: null,
      slicerProc: null,
      fitInterval: null,
      currentStlPath: null,
      activeOrderId: null,
      sessionOpenedAtMs: Date.now(),
      startingPromise: null,
    };
  }
  return globalForEmbed.__prusaSlicerEmbed;
}

export function getActiveSlicerSessionInfo() {
  const rt = getRuntime();
  return {
    activeOrderId: rt.activeOrderId,
    sessionOpenedAtMs: rt.sessionOpenedAtMs,
  };
}

async function isXDisplayReady(): Promise<boolean> {
  try {
    await execFileAsync("xdotool", ["getdisplaygeometry"], {
      env: { ...process.env, DISPLAY: DISPLAY_NUM },
      timeout: 1200,
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForXDisplay(timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isXDisplayReady()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function startWindowFitterLoop(runtime: EmbedRuntime): void {
  if (runtime.fitInterval) {
    clearInterval(runtime.fitInterval);
  }
  runtime.fitInterval = setInterval(() => {
    fitSlicerWindows().catch(() => {});
  }, 450);
  runtime.fitInterval.unref?.();
}

async function ensureDisplay(): Promise<void> {
  const runtime = getRuntime();
  startWindowFitterLoop(runtime);

  if (runtime.startingPromise) {
    return runtime.startingPromise;
  }

  runtime.startingPromise = (async () => {
    if (!(await isXDisplayReady())) {
      await fs.unlink("/tmp/.X98-lock").catch(() => {});
      await fs.unlink("/tmp/.X11-unix/X98").catch(() => {});

      const xvnc = spawn(
        "Xtigervnc",
        [
          DISPLAY_NUM,
          "-geometry",
          "1200x780",
          "-depth",
          "24",
          "-SecurityTypes",
          "None",
          "-localhost",
          "yes",
          "-rfbport",
          String(VNC_PORT),
          "-AlwaysShared",
          "-AcceptSetDesktopSize=1",
          "-BlacklistThreshold=1000000",
          "-BlacklistTimeout=0",
        ],
        {
          stdio: "ignore",
          detached: true,
        }
      );
      xvnc.unref();
      runtime.xvncProc = xvnc;

      const ready = await waitForXDisplay(6000);
      if (!ready) {
        throw new Error(
          "Impossible de démarrer le serveur d'affichage virtuel Xtigervnc (:98)."
        );
      }

      await execFileAsync("xhost", ["+local:"], {
        env: { ...process.env, DISPLAY: DISPLAY_NUM },
        timeout: 3000,
      }).catch(() => {});
    }
  })().finally(() => {
    runtime.startingPromise = null;
  });

  return runtime.startingPromise;
}

/**
 * - Ajuste la fenêtre principale de PrusaSlicer à 100% du cadre (0, 0, dispW, dispH).
 * - Contraint automatiquement toutes les boîtes de dialogue modales (ex: "Enregistrer le fichier G-code sous :")
 *   à rester entièrement visibles à l'intérieur du cadre (X >= 12, Y >= 12, largeur/hauteur <= cadre - 24),
 *   pour que les boutons "Annuler" / "Enregistrer" ne soient jamais coupés en haut ou à droite.
 */
export async function fitSlicerWindows(): Promise<void> {
  const env = { ...process.env, DISPLAY: DISPLAY_NUM };
  const { stdout: geomOut } = await execFileAsync(
    "xdotool",
    ["getdisplaygeometry"],
    { env, timeout: 1500 }
  );
  const [dispW, dispH] = geomOut.trim().split(/\s+/).map(Number);
  if (!dispW || !dispH) return;

  const { stdout: idsOut } = await execFileAsync(
    "xdotool",
    ["search", "--onlyvisible", "--class", "PrusaSlicer"],
    { env, timeout: 1500 }
  ).catch(() => ({ stdout: "" }));

  const ids = idsOut
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  for (const wid of ids) {
    const { stdout: props } = await execFileAsync(
      "xprop",
      ["-id", wid, "WM_TRANSIENT_FOR", "_NET_WM_WINDOW_TYPE", "WM_NAME"],
      { env, timeout: 1500 }
    ).catch(() => ({ stdout: "" }));

    const isPopup =
      props.includes("_NET_WM_WINDOW_TYPE_MENU") ||
      props.includes("_NET_WM_WINDOW_TYPE_POPUP_MENU") ||
      props.includes("_NET_WM_WINDOW_TYPE_DROPDOWN_MENU") ||
      props.includes("_NET_WM_WINDOW_TYPE_COMBO") ||
      props.includes("_NET_WM_WINDOW_TYPE_TOOLTIP");

    if (isPopup) {
      continue;
    }

    const isDialog =
      (props.includes("WM_TRANSIENT_FOR(WINDOW)") &&
        !props.includes("WM_TRANSIENT_FOR:  not found")) ||
      props.includes("_NET_WM_WINDOW_TYPE_DIALOG");

    const { stdout: winGeom } = await execFileAsync(
      "xdotool",
      ["getwindowgeometry", "--shell", wid],
      { env, timeout: 1500 }
    ).catch(() => ({ stdout: "" }));

    const x = Number(/X=(-?\d+)/.exec(winGeom)?.[1] ?? 0);
    const y = Number(/Y=(-?\d+)/.exec(winGeom)?.[1] ?? 0);
    const w = Number(/WIDTH=(\d+)/.exec(winGeom)?.[1] ?? 0);
    const h = Number(/HEIGHT=(\d+)/.exec(winGeom)?.[1] ?? 0);

    if (w < 260 || h < 160) {
      continue;
    }

    if (isDialog) {
      const margin = 16;
      const maxW = Math.max(400, dispW - margin * 2);
      const maxH = Math.max(300, dispH - margin * 2);
      const targetW = Math.min(w, maxW);
      const targetH = Math.min(h, maxH);

      const needsResize = w > maxW || h > maxH;
      const outOfBounds =
        x < 4 ||
        y < 4 ||
        x + targetW > dispW - 4 ||
        y + targetH > dispH - 4;

      if (needsResize || outOfBounds) {
        if (needsResize) {
          await execFileAsync(
            "xdotool",
            ["windowsize", wid, String(targetW), String(targetH)],
            { env, timeout: 1500 }
          ).catch(() => {});
        }

        // Relit la taille réelle après application des contraintes GTK éventuelles
        const { stdout: afterGeom } = await execFileAsync(
          "xdotool",
          ["getwindowgeometry", "--shell", wid],
          { env, timeout: 1500 }
        ).catch(() => ({ stdout: winGeom }));

        const realW = Number(/WIDTH=(\d+)/.exec(afterGeom)?.[1] ?? targetW);
        const realH = Number(/HEIGHT=(\d+)/.exec(afterGeom)?.[1] ?? targetH);

        // Garantit toujours Y >= 0 (et X >= 0) pour que la barre supérieure GTK ("Enregistrer" / "Annuler") reste 100% visible
        const newX = Math.max(0, Math.floor((dispW - realW) / 2));
        const newY = Math.max(0, Math.floor((dispH - realH) / 2));

        await execFileAsync(
          "xdotool",
          ["windowmove", wid, String(newX), String(newY)],
          { env, timeout: 1500 }
        ).catch(() => {});
      }
      continue;
    }

    // Fenêtre principale PrusaSlicer -> plein cadre
    if (x !== 0 || y !== 0 || Math.abs(w - dispW) > 4 || Math.abs(h - dispH) > 4) {
      await execFileAsync(
        "xdotool",
        [
          "windowmove",
          wid,
          "0",
          "0",
          "windowsize",
          wid,
          String(dispW),
          String(dispH),
        ],
        { env, timeout: 1500 }
      ).catch(() => {});
    }
  }
}

async function killRunningPrusaSlicerOnDisplay(): Promise<void> {
  const runtime = getRuntime();
  if (runtime.slicerProc && !runtime.slicerProc.killed) {
    try {
      runtime.slicerProc.kill("SIGTERM");
    } catch {
      // Ignore
    }
    runtime.slicerProc = null;
  }

  await execFileAsync("flatpak", ["kill", "com.prusa3d.PrusaSlicer"], {
    timeout: 3000,
  }).catch(() => {});

  await new Promise((r) => setTimeout(r, 250));
}

export async function loadOrderInEmbeddedPrusaSlicer(params: {
  orderId?: string;
  stlAbsolutePath: string;
  stlFilename: string;
  forceReload?: boolean;
}): Promise<{ reloaded: boolean }> {
  await ensureDisplay();

  const runtime = getRuntime();

  const gcodeDir = path.resolve(process.cwd(), "data", "gcode");
  await fs.mkdir(gcodeDir, { recursive: true });

  const cleanName = params.stlFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const workStlPath = path.join(gcodeDir, cleanName);
  await fs.copyFile(params.stlAbsolutePath, workStlPath);

  const env = { ...process.env, DISPLAY: DISPLAY_NUM };
  const { stdout: existingWin } = await execFileAsync(
    "xdotool",
    ["search", "--onlyvisible", "--class", "PrusaSlicer"],
    { env, timeout: 1500 }
  ).catch(() => ({ stdout: "" }));

  const isWindowAlive = Boolean(existingWin.trim());

  if (
    !params.forceReload &&
    isWindowAlive &&
    runtime.currentStlPath === params.stlAbsolutePath
  ) {
    if (params.orderId && runtime.activeOrderId !== params.orderId) {
      runtime.activeOrderId = params.orderId;
      runtime.sessionOpenedAtMs = Date.now();
    }
    await fitSlicerWindows().catch(() => {});
    return { reloaded: false };
  }

  await killRunningPrusaSlicerOnDisplay();

  const workspaceDir = process.cwd();
  const cleanEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DISPLAY: DISPLAY_NUM,
    GDK_BACKEND: "x11",
    WAYLAND_DISPLAY: "",
  };
  delete cleanEnv.GIO_EXTRA_MODULES;
  delete cleanEnv.GTK_PATH;
  delete cleanEnv.GTK_IM_MODULE_FILE;

  const proc = spawn(
    "flatpak",
    [
      "run",
      "--nosocket=wayland",
      "--socket=x11",
      `--env=DISPLAY=${DISPLAY_NUM}`,
      "--env=GDK_BACKEND=x11",
      "--unset-env=WAYLAND_DISPLAY",
      "--unset-env=GIO_EXTRA_MODULES",
      "--unset-env=GTK_PATH",
      "--unset-env=GTK_IM_MODULE_FILE",
      `--filesystem=${workspaceDir}`,
      "--filesystem=/tmp",
      "com.prusa3d.PrusaSlicer",
      workStlPath,
    ],
    {
      env: cleanEnv,
      stdio: "ignore",
      detached: true,
    }
  );
  proc.unref();
  runtime.slicerProc = proc;
  runtime.currentStlPath = params.stlAbsolutePath;
  runtime.activeOrderId = params.orderId ?? runtime.activeOrderId;
  runtime.sessionOpenedAtMs = Date.now();

  for (const delay of [1500, 3000, 4800]) {
    setTimeout(() => {
      fitSlicerWindows().catch(() => {});
    }, delay);
  }

  return { reloaded: true };
}
