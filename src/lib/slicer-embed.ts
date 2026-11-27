import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IS_WINDOWS = process.platform === "win32";
const DISPLAY_NUM = ":98";
const VNC_PORT = 5998;

interface SlicerLaunchTarget {
  kind: "windows" | "native" | "flatpak";
  command: string;
  configDir: string;
  buildArgs: (workStlPath: string) => string[];
}

interface EmbedRuntime {
  xvncProc: ChildProcess | null;
  slicerProc: ChildProcess | null;
  fitInterval: NodeJS.Timeout | null;
  currentStlPath: string | null;
  activeOrderId: string | null;
  sessionOpenedAtMs: number;
  startingPromise: Promise<void> | null;
  loadLock: Promise<unknown>;
  latestRequestSeq: number;
  fittingInFlight: boolean;
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
      loadLock: Promise.resolve(),
      latestRequestSeq: 0,
      fittingInFlight: false,
    };
  }
  const rt = globalForEmbed.__prusaSlicerEmbed;
  if (!rt.loadLock) rt.loadLock = Promise.resolve();
  if (typeof rt.latestRequestSeq !== "number") rt.latestRequestSeq = 0;
  if (typeof rt.fittingInFlight !== "boolean") rt.fittingInFlight = false;
  if (typeof rt.sessionOpenedAtMs !== "number")
    rt.sessionOpenedAtMs = Date.now();
  return rt;
}

export function getActiveSlicerSessionInfo() {
  const rt = getRuntime();
  return {
    activeOrderId: rt.activeOrderId,
    sessionOpenedAtMs: rt.sessionOpenedAtMs,
    mode: IS_WINDOWS ? ("native-window" as const) : ("embedded" as const),
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(bin: string): Promise<boolean> {
  try {
    await execFileAsync(IS_WINDOWS ? "where" : "which", [bin], {
      timeout: 2500,
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveWindowsSlicerTarget(): Promise<SlicerLaunchTarget> {
  const appData =
    process.env.APPDATA ||
    path.join(process.env.USERPROFILE || process.cwd(), "AppData", "Roaming");
  const configDir = path.join(appData, "PrusaSlicer");

  const candidates = [
    process.env.PRUSA_SLICER_BIN?.trim(),
    path.resolve(process.cwd(), "vendor", "prusaslicer", "prusa-slicer.exe"),
    "C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer.exe",
    "C:\\Program Files (x86)\\Prusa3D\\PrusaSlicer\\prusa-slicer.exe",
    process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          "Programs",
          "Prusa3D",
          "PrusaSlicer",
          "prusa-slicer.exe"
        )
      : undefined,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return {
        kind: "windows",
        command: candidate,
        configDir,
        buildArgs: (workStlPath) => [workStlPath],
      };
    }
  }

  throw new Error(
    "prusa-slicer.exe introuvable sur ce PC Windows. Lancez windows\\1-Installer-sur-Windows.bat ou installez PrusaSlicer."
  );
}

/**
 * Détecte le vrai PrusaSlicer disponible (100% Windows natif ou Linux) :
 * - Windows : ./vendor/prusaslicer/prusa-slicer.exe ou C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer.exe
 * - Linux : ./vendor/prusaslicer/prusa-slicer, binaire système `prusa-slicer`, ou Flatpak `com.prusa3d.PrusaSlicer`
 */
async function resolveSlicerTarget(): Promise<SlicerLaunchTarget> {
  if (IS_WINDOWS) {
    return resolveWindowsSlicerTarget();
  }

  const home = process.env.HOME || "";
  const nativeConfigDir = path.join(home, ".config", "PrusaSlicer");
  const flatpakConfigDir = path.join(
    home,
    ".var",
    "app",
    "com.prusa3d.PrusaSlicer",
    "config",
    "PrusaSlicer"
  );

  const customBin = process.env.PRUSA_SLICER_BIN?.trim();
  if (customBin && (await fileExists(customBin))) {
    return {
      kind: "native",
      command: customBin,
      configDir: nativeConfigDir,
      buildArgs: (workStlPath) => [workStlPath],
    };
  }

  const vendorCandidates = [
    path.resolve(process.cwd(), "vendor", "prusaslicer", "prusa-slicer"),
    path.resolve(
      process.cwd(),
      "vendor",
      "prusaslicer",
      "bin",
      "prusa-slicer"
    ),
    path.resolve(
      process.cwd(),
      "vendor",
      "prusaslicer",
      "squashfs-root",
      "usr",
      "bin",
      "prusa-slicer"
    ),
  ];

  for (const candidate of vendorCandidates) {
    if (await fileExists(candidate)) {
      return {
        kind: "native",
        command: candidate,
        configDir: nativeConfigDir,
        buildArgs: (workStlPath) => [workStlPath],
      };
    }
  }

  for (const bin of ["prusa-slicer", "prusaslicer"]) {
    if (await commandExists(bin)) {
      return {
        kind: "native",
        command: bin,
        configDir: nativeConfigDir,
        buildArgs: (workStlPath) => [workStlPath],
      };
    }
  }

  const workspaceDir = process.cwd();
  return {
    kind: "flatpak",
    command: "flatpak",
    configDir: flatpakConfigDir,
    buildArgs: (workStlPath) => [
      "run",
      "--nosocket=wayland",
      "--socket=x11",
      `--env=DISPLAY=${DISPLAY_NUM}`,
      "--env=GDK_BACKEND=x11",
      "--env=LP_NUM_THREADS=4",
      "--env=MESA_NO_ERROR=1",
      "--unset-env=WAYLAND_DISPLAY",
      "--unset-env=GIO_EXTRA_MODULES",
      "--unset-env=GTK_PATH",
      "--unset-env=GTK_IM_MODULE_FILE",
      `--filesystem=${workspaceDir}`,
      "--filesystem=/tmp",
      "com.prusa3d.PrusaSlicer",
      workStlPath,
    ],
  };
}

/**
 * Installe automatiquement le profil embarqué `Original Prusa MK4S 0.4 nozzle bon.ini`
 * et pointe les exports G-code directement vers ./data/gcode (Windows & Linux).
 */
async function tunePrusaSlicerIni(configRoot: string): Promise<void> {
  const gcodeDir = path.resolve(process.cwd(), "data", "gcode");
  const iniPath = path.join(configRoot, "PrusaSlicer.ini");
  const printerDir = path.join(configRoot, "printer");
  const customPrinterIni = path.join(
    printerDir,
    "Original Prusa MK4S 0.4 nozzle bon.ini"
  );
  const repoBundledPrinterIni = path.resolve(
    process.cwd(),
    "config",
    "prusaslicer",
    "printer",
    "Original Prusa MK4S 0.4 nozzle bon.ini"
  );

  await fs.mkdir(printerDir, { recursive: true }).catch(() => {});
  if (
    !(await fileExists(customPrinterIni)) &&
    (await fileExists(repoBundledPrinterIni))
  ) {
    await fs.copyFile(repoBundledPrinterIni, customPrinterIni).catch(() => {});
  }

  const hasCustomPrinter = await fileExists(customPrinterIni);

  try {
    let content = await fs.readFile(iniPath, "utf-8");
    const replacements: [RegExp, string][] = [
      [/^show_splash_screen\s*=.*$/m, "show_splash_screen = 0"],
      [/^show_hints\s*=.*$/m, "show_hints = 0"],
      [/^notify_release\s*=.*$/m, "notify_release = none"],
      [/^preset_update\s*=.*$/m, "preset_update = 0"],
      [/^auth_login_dialog_confirmed\s*=.*$/m, "auth_login_dialog_confirmed = 1"],
      [/^skein_directory\s*=.*$/m, `skein_directory = ${gcodeDir}`],
      [/^last_output_path\s*=.*$/m, `last_output_path = ${gcodeDir}`],
      ...(hasCustomPrinter
        ? ([
            [/^printer\s*=.*$/m, "printer = Original Prusa MK4S 0.4 nozzle bon"],
            [/^print\s*=.*$/m, "print = 0.20mm SPEED @MK4S 0.4"],
            [/^filament\s*=.*$/m, "filament = Prusament PLA @MK4S"],
          ] as [RegExp, string][])
        : []),
    ];

    let changed = false;
    for (const [regex, nextLine] of replacements) {
      if (regex.test(content)) {
        const updated = content.replace(regex, nextLine);
        if (updated !== content) {
          content = updated;
          changed = true;
        }
      }
    }

    if (changed) {
      await fs.writeFile(iniPath, content, "utf-8");
    }
  } catch {
    const freshIni = [
      "show_splash_screen = 0",
      "show_hints = 0",
      "notify_release = none",
      "preset_update = 0",
      "auth_login_dialog_confirmed = 1",
      "use_binary_gcode_when_supported = 1",
      "background_processing = 0",
      "remember_output_path = 1",
      "",
      "[presets]",
      ...(hasCustomPrinter
        ? [
            "printer = Original Prusa MK4S 0.4 nozzle bon",
            "print = 0.20mm SPEED @MK4S 0.4",
            "filament = Prusament PLA @MK4S",
          ]
        : []),
      "",
      "[recent]",
      `skein_directory = ${gcodeDir}`,
      `last_output_path = ${gcodeDir}`,
      "",
      "[vendor:PrusaResearch]",
      "model:MK4S = 0.4",
      "",
    ].join("\n");
    await fs.writeFile(iniPath, freshIni, "utf-8").catch(() => {});
  }
}

async function prepareWorkStl(
  stlAbsolutePath: string,
  stlFilename: string
): Promise<string> {
  const gcodeDir = path.resolve(process.cwd(), "data", "gcode");
  await fs.mkdir(gcodeDir, { recursive: true });
  const cleanName = stlFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const workStlPath = path.join(gcodeDir, cleanName);
  await fs.copyFile(stlAbsolutePath, workStlPath);
  return workStlPath;
}

/**
 * Ouvre le STL directement dans le vrai PrusaSlicer Windows (fenêtre native 60 FPS GPU)
 * et enregistre l'heure de session pour la synchro automatique du poids PLA à l'export G-code.
 */
export async function openOrderInNativePrusaSlicer(params: {
  orderId?: string;
  stlAbsolutePath: string;
  stlFilename: string;
}): Promise<{ mode: "native-window"; command: string }> {
  const runtime = getRuntime();
  const target = await resolveSlicerTarget();
  const workStlPath = await prepareWorkStl(
    params.stlAbsolutePath,
    params.stlFilename
  );

  await tunePrusaSlicerIni(target.configDir);

  const proc = spawn(target.command, target.buildArgs(workStlPath), {
    stdio: "ignore",
    detached: true,
    windowsHide: false,
  });
  proc.unref();

  runtime.slicerProc = proc;
  runtime.currentStlPath = params.stlAbsolutePath;
  runtime.activeOrderId = params.orderId ?? runtime.activeOrderId;
  runtime.sessionOpenedAtMs = Date.now();

  return { mode: "native-window", command: path.basename(target.command) };
}

/* ==================== PARTIE LINUX EMBARQUÉE (Xtigervnc :98) ==================== */

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
  }, 1500);
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
          "-FrameRate=30",
          "-CompareFB=2",
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

interface ParsedWindow {
  id: string;
  title: string;
  w: number;
  h: number;
  x: number;
  y: number;
}

async function listSlicerWindows(): Promise<{
  dispW: number;
  dispH: number;
  windows: ParsedWindow[];
} | null> {
  const env = { ...process.env, DISPLAY: DISPLAY_NUM };
  const [geomRes, treeRes] = await Promise.all([
    execFileAsync("xdotool", ["getdisplaygeometry"], { env, timeout: 1500 }),
    execFileAsync("xwininfo", ["-root", "-tree"], { env, timeout: 1500 }),
  ]).catch(() => [null, null] as const);

  if (!geomRes || !treeRes) return null;

  const [dispW, dispH] = geomRes.stdout.trim().split(/\s+/).map(Number);
  if (!dispW || !dispH) return null;

  const windows: ParsedWindow[] = [];
  const lineRegex =
    /^ {5}(0x[0-9a-f]+)\s+(?:"([^"]*)"|\(has no name\)):\s+\("[^"]*prusa[^"]*"\s+"[^"]*prusa[^"]*"\)\s+(\d+)x(\d+)([+-]\d+)([+-]\d+)/i;

  for (const line of treeRes.stdout.split("\n")) {
    const m = lineRegex.exec(line);
    if (!m) continue;
    const w = Number(m[3]);
    const h = Number(m[4]);
    if (w < 260 || h < 160) continue;
    windows.push({
      id: m[1],
      title: m[2] ?? "",
      w,
      h,
      x: Number(m[5]),
      y: Number(m[6]),
    });
  }

  return { dispW, dispH, windows };
}

export async function fitSlicerWindows(): Promise<boolean> {
  if (IS_WINDOWS) return false;
  const runtime = getRuntime();
  if (runtime.fittingInFlight) return false;
  runtime.fittingInFlight = true;

  try {
    const info = await listSlicerWindows();
    if (!info || info.windows.length === 0) return false;

    const { dispW, dispH, windows } = info;
    const env = { ...process.env, DISPLAY: DISPLAY_NUM };
    let hasMainWindow = false;

    for (const win of windows) {
      const looksMain = /PrusaSlicer-\d/i.test(win.title);
      if (looksMain) {
        hasMainWindow = true;
        if (
          win.x !== 0 ||
          win.y !== 0 ||
          Math.abs(win.w - dispW) > 4 ||
          Math.abs(win.h - dispH) > 4
        ) {
          await execFileAsync(
            "xdotool",
            [
              "windowmove",
              win.id,
              "0",
              "0",
              "windowsize",
              win.id,
              String(dispW),
              String(dispH),
            ],
            { env, timeout: 1500 }
          ).catch(() => {});
        }
        continue;
      }

      const margin = 16;
      const maxW = Math.max(400, dispW - margin * 2);
      const maxH = Math.max(300, dispH - margin * 2);
      const needsResize = win.w > maxW || win.h > maxH;
      const outOfBounds =
        win.x < 4 ||
        win.y < 4 ||
        win.x + win.w > dispW - 4 ||
        win.y + win.h > dispH - 4;

      if (!needsResize && !outOfBounds) continue;

      const { stdout: props } = await execFileAsync(
        "xprop",
        ["-id", win.id, "_NET_WM_WINDOW_TYPE"],
        { env, timeout: 1200 }
      ).catch(() => ({ stdout: "" }));

      if (
        props.includes("_NET_WM_WINDOW_TYPE_MENU") ||
        props.includes("_NET_WM_WINDOW_TYPE_POPUP_MENU") ||
        props.includes("_NET_WM_WINDOW_TYPE_DROPDOWN_MENU") ||
        props.includes("_NET_WM_WINDOW_TYPE_COMBO") ||
        props.includes("_NET_WM_WINDOW_TYPE_TOOLTIP")
      ) {
        continue;
      }

      const targetW = Math.min(win.w, maxW);
      const targetH = Math.min(win.h, maxH);

      if (needsResize) {
        await execFileAsync(
          "xdotool",
          ["windowsize", win.id, String(targetW), String(targetH)],
          { env, timeout: 1500 }
        ).catch(() => {});
      }

      const newX = Math.max(0, Math.floor((dispW - targetW) / 2));
      const newY = Math.max(0, Math.floor((dispH - targetH) / 2));

      await execFileAsync(
        "xdotool",
        ["windowmove", win.id, String(newX), String(newY)],
        { env, timeout: 1500 }
      ).catch(() => {});
    }

    return hasMainWindow;
  } finally {
    runtime.fittingInFlight = false;
  }
}

async function killRunningPrusaSlicerOnDisplay(
  target: SlicerLaunchTarget
): Promise<void> {
  const runtime = getRuntime();
  if (runtime.slicerProc && !runtime.slicerProc.killed) {
    try {
      runtime.slicerProc.kill("SIGTERM");
    } catch {
      // Ignore
    }
    runtime.slicerProc = null;
  }

  if (target.kind === "flatpak") {
    await execFileAsync("flatpak", ["kill", "com.prusa3d.PrusaSlicer"], {
      timeout: 3000,
    }).catch(() => {});
  } else {
    await execFileAsync("pkill", ["-TERM", "-f", "prusa-slicer"], {
      timeout: 2500,
    }).catch(() => {});
  }

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const info = await listSlicerWindows();
    if (!info || info.windows.length === 0) break;
    await new Promise((r) => setTimeout(r, 150));
  }
}

export async function loadOrderInEmbeddedPrusaSlicer(params: {
  orderId?: string;
  stlAbsolutePath: string;
  stlFilename: string;
  forceReload?: boolean;
}): Promise<{ mode: "embedded" | "native-window"; reloaded: boolean }> {
  const runtime = getRuntime();

  // Sur Windows natif : pas besoin de Xtigervnc/Linux — on prépare le STL et la session
  // pour le viewer 3D WebGL + bouton "Ouvrir dans PrusaSlicer Windows" (et on ouvre auto si forceReload)
  if (IS_WINDOWS) {
    if (params.orderId && runtime.activeOrderId !== params.orderId) {
      runtime.activeOrderId = params.orderId;
      runtime.sessionOpenedAtMs = Date.now();
    }
    if (params.forceReload) {
      await openOrderInNativePrusaSlicer(params);
      return { mode: "native-window", reloaded: true };
    }
    await prepareWorkStl(params.stlAbsolutePath, params.stlFilename);
    return { mode: "native-window", reloaded: false };
  }

  const mySeq = ++runtime.latestRequestSeq;

  const task = async (): Promise<{ mode: "embedded"; reloaded: boolean }> => {
    if (mySeq < runtime.latestRequestSeq) {
      return { mode: "embedded", reloaded: false };
    }

    await ensureDisplay();
    const target = await resolveSlicerTarget();
    const workStlPath = await prepareWorkStl(
      params.stlAbsolutePath,
      params.stlFilename
    );

    const existing = await listSlicerWindows();
    const isWindowAlive = Boolean(existing && existing.windows.length > 0);

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
      return { mode: "embedded", reloaded: false };
    }

    await killRunningPrusaSlicerOnDisplay(target);
    await tunePrusaSlicerIni(target.configDir);

    if (mySeq < runtime.latestRequestSeq) {
      return { mode: "embedded", reloaded: false };
    }

    const cleanEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DISPLAY: DISPLAY_NUM,
      GDK_BACKEND: "x11",
      WAYLAND_DISPLAY: "",
      LP_NUM_THREADS: "4",
      MESA_NO_ERROR: "1",
    };
    delete cleanEnv.GIO_EXTRA_MODULES;
    delete cleanEnv.GTK_PATH;
    delete cleanEnv.GTK_IM_MODULE_FILE;

    const proc = spawn(target.command, target.buildArgs(workStlPath), {
      env: cleanEnv,
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
    runtime.slicerProc = proc;
    runtime.currentStlPath = params.stlAbsolutePath;
    runtime.activeOrderId = params.orderId ?? runtime.activeOrderId;
    runtime.sessionOpenedAtMs = Date.now();

    const waitDeadline = Date.now() + 4500;
    while (Date.now() < waitDeadline) {
      if (mySeq < runtime.latestRequestSeq) break;
      const mapped = await fitSlicerWindows().catch(() => false);
      if (mapped) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    return { mode: "embedded", reloaded: true };
  };

  const chained = runtime.loadLock.then(task, task);
  runtime.loadLock = chained.catch(() => {});
  return chained;
}
