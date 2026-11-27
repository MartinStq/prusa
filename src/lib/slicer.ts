import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SlicerExecutable {
  kind: "native" | "flatpak";
  command: string;
  baseArgs: string[];
  label: string;
}

export interface SlicerAnalysisResult {
  weightGrams: number;
  filamentMm: number | null;
  filamentCm3: number | null;
  estimatedTime: string | null;
  dimensionsMm: { x: number; y: number; z: number } | null;
  material: "PLA";
  infillPercent: number;
  supports: boolean;
  slicerLabel: string;
}

const PLA_DENSITY = 1.24;

async function commandExists(bin: string): Promise<boolean> {
  try {
    await execFileAsync("which", [bin], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function hasFlatpakPrusaSlicer(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "flatpak",
      ["info", "com.prusa3d.PrusaSlicer"],
      { timeout: 4000 }
    );
    return stdout.includes("com.prusa3d.PrusaSlicer");
  } catch {
    return false;
  }
}

/**
 * Détecte automatiquement l'exécutable réel de PrusaSlicer sur le PC Linux.
 */
export async function detectPrusaSlicer(): Promise<SlicerExecutable | null> {
  const customBin = process.env.PRUSA_SLICER_BIN?.trim();
  if (customBin) {
    try {
      await fs.access(customBin);
      return {
        kind: "native",
        command: customBin,
        baseArgs: [],
        label: path.basename(customBin),
      };
    } catch {
      // Continue vers l'auto-détection
    }
  }

  const vendorBins =
    process.platform === "win32"
      ? [
          path.resolve(
            process.cwd(),
            "vendor",
            "prusaslicer",
            "prusa-slicer-console.exe"
          ),
          path.resolve(
            process.cwd(),
            "vendor",
            "prusaslicer",
            "prusa-slicer.exe"
          ),
          "C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe",
          "C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer.exe",
        ]
      : [
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
  for (const vbin of vendorBins) {
    try {
      await fs.access(vbin);
      return {
        kind: "native",
        command: vbin,
        baseArgs: [],
        label: "PrusaSlicer (local)",
      };
    } catch {
      // Continue
    }
  }

  for (const bin of ["prusa-slicer", "prusaslicer"]) {
    if (await commandExists(bin)) {
      return {
        kind: "native",
        command: bin,
        baseArgs: [],
        label: bin,
      };
    }
  }

  if (await hasFlatpakPrusaSlicer()) {
    const workspaceDir = process.cwd();
    return {
      kind: "flatpak",
      command: "flatpak",
      baseArgs: [
        "run",
        "--unset-env=GIO_EXTRA_MODULES",
        "--unset-env=GTK_PATH",
        "--unset-env=GTK_IM_MODULE_FILE",
        `--filesystem=${workspaceDir}`,
        "--filesystem=/tmp",
        "com.prusa3d.PrusaSlicer",
      ],
      label: "PrusaSlicer (Flatpak officiel)",
    };
  }

  return null;
}

/**
 * Exécute le vrai moteur de tranchage PrusaSlicer en ligne de commande (`--export-gcode`)
 * exclusivement en PLA (1.24 g/cm³) pour calculer le poids exact en grammes et la durée estimée.
 */
export async function analyzeStlWithPrusaSlicer(params: {
  stlAbsolutePath: string;
  infillPercent?: number;
  supports?: boolean;
}): Promise<SlicerAnalysisResult> {
  const slicer = await detectPrusaSlicer();
  if (!slicer) {
    throw new Error(
      "PrusaSlicer n'est pas détecté sur ce PC. Impossible de lancer l'analyse automatique."
    );
  }

  const infill = Math.min(
    100,
    Math.max(5, Math.round(params.infillPercent ?? 15))
  );
  const supports = Boolean(params.supports);

  const tmpGcode = path.join(
    os.tmpdir(),
    `prusapilot_slice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.gcode`
  );

  try {
    let dimensionsMm: { x: number; y: number; z: number } | null = null;
    try {
      const { stdout: infoOut } = await execFileAsync(
        slicer.command,
        [...slicer.baseArgs, "--info", params.stlAbsolutePath],
        { timeout: 15000 }
      );
      const sx = /size_x\s*=\s*([\d.]+)/.exec(infoOut);
      const sy = /size_y\s*=\s*([\d.]+)/.exec(infoOut);
      const sz = /size_z\s*=\s*([\d.]+)/.exec(infoOut);
      if (sx && sy && sz) {
        dimensionsMm = {
          x: Number(parseFloat(sx[1]).toFixed(1)),
          y: Number(parseFloat(sy[1]).toFixed(1)),
          z: Number(parseFloat(sz[1]).toFixed(1)),
        };
      }
    } catch {
      // Non bloquant
    }

    const sliceArgs = [
      ...slicer.baseArgs,
      "--export-gcode",
      "--center",
      "125,105",
      "--nozzle-diameter",
      "0.4",
      "--layer-height",
      "0.2",
      "--first-layer-height",
      "0.2",
      "--perimeters",
      "2",
      "--top-solid-layers",
      "4",
      "--bottom-solid-layers",
      "4",
      "--fill-density",
      `${infill}%`,
      "--filament-diameter",
      "1.75",
      "--filament-density",
      String(PLA_DENSITY),
      ...(supports ? ["--support-material"] : []),
      "--output",
      tmpGcode,
      params.stlAbsolutePath,
    ];

    await execFileAsync(slicer.command, sliceArgs, {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const handle = await fs.open(tmpGcode, "r");
    try {
      const stat = await handle.stat();
      const tailSize = Math.min(stat.size, 65536);
      const buffer = Buffer.alloc(tailSize);
      await handle.read(buffer, 0, tailSize, Math.max(0, stat.size - tailSize));
      const tailText = buffer.toString("utf-8");

      const gramsMatch =
        /;\s*total filament used \[g\]\s*=\s*([\d.]+)/i.exec(tailText) ??
        /;\s*filament used \[g\]\s*=\s*([\d.]+)/i.exec(tailText);

      const mmMatch = /;\s*filament used \[mm\]\s*=\s*([\d.]+)/i.exec(tailText);
      const cm3Match = /;\s*filament used \[cm3\]\s*=\s*([\d.]+)/i.exec(
        tailText
      );
      const timeMatch =
        /;\s*estimated printing time \(normal mode\)\s*=\s*([^\r\n]+)/i.exec(
          tailText
        );

      const filamentMm = mmMatch
        ? Number(parseFloat(mmMatch[1]).toFixed(1))
        : null;
      const filamentCm3 = cm3Match
        ? Number(parseFloat(cm3Match[1]).toFixed(2))
        : null;

      let weightGrams: number | null = gramsMatch
        ? parseFloat(gramsMatch[1])
        : null;

      if ((!weightGrams || weightGrams <= 0) && filamentCm3 && filamentCm3 > 0) {
        weightGrams = filamentCm3 * PLA_DENSITY;
      } else if (
        (!weightGrams || weightGrams <= 0) &&
        filamentMm &&
        filamentMm > 0
      ) {
        weightGrams = ((filamentMm * 2.40528) / 1000) * PLA_DENSITY;
      }

      if (!weightGrams || weightGrams <= 0) {
        throw new Error(
          "PrusaSlicer a terminé le tranchage mais le poids de filament PLA n'a pas pu être extrait."
        );
      }

      return {
        weightGrams: Number(Math.max(0.1, weightGrams).toFixed(2)),
        filamentMm,
        filamentCm3,
        estimatedTime: timeMatch ? timeMatch[1].trim() : null,
        dimensionsMm,
        material: "PLA",
        infillPercent: infill,
        supports,
        slicerLabel: slicer.label,
      };
    } finally {
      await handle.close();
    }
  } finally {
    await fs.unlink(tmpGcode).catch(() => {});
  }
}
