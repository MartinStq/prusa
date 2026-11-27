import fs from "node:fs/promises";
import path from "node:path";

export interface ParsedGcodeMetadata {
  filename: string;
  fullPath: string;
  mtimeMs: number;
  weightGrams: number;
  filamentMm: number | null;
  filamentCm3: number | null;
  estimatedTime: string | null;
  fillDensity: string | null;
  layerHeight: string | null;
  supports: boolean;
}

const PLA_DENSITY = 1.24;

function matchValue(text: string, keyPattern: string): string | null {
  // Supporte à la fois le format ASCII G-code ("; key = value") et le format binaire .bgcode ("key=value")
  const regex = new RegExp(
    `(?:;\\s*)?${keyPattern}\\s*=\\s*([^\\r\\n\\x00]+)`,
    "i"
  );
  const m = regex.exec(text);
  return m ? m[1].trim() : null;
}

/**
 * Extrait le poids exact de PLA (en grammes), le temps estimé et les paramètres de tranchage
 * directement depuis un fichier `.gcode` (ASCII) ou `.bgcode` (binaire Prusa MK4) généré par PrusaSlicer.
 */
export async function parsePrusaGcodeMetadata(
  filePath: string
): Promise<ParsedGcodeMetadata | null> {
  const st = await fs.stat(filePath).catch(() => null);
  if (!st || !st.isFile() || st.size < 32) return null;

  const handle = await fs.open(filePath, "r");
  try {
    // Dans un .bgcode, les métadonnées sont dans les premiers Ko ;
    // dans un .gcode ASCII, elles sont dans les derniers Ko. On lit tête + queue.
    const headLen = Math.min(st.size, 65536);
    const headBuf = Buffer.alloc(headLen);
    await handle.read(headBuf, 0, headLen, 0);

    let combinedText = headBuf.toString("latin1");

    if (st.size > headLen) {
      const tailLen = Math.min(st.size - headLen, 65536);
      const tailBuf = Buffer.alloc(tailLen);
      await handle.read(tailBuf, 0, tailLen, st.size - tailLen);
      combinedText += "\n" + tailBuf.toString("latin1");
    }

    const totalGramsStr =
      matchValue(combinedText, "total filament used \\[g\\]") ??
      matchValue(combinedText, "filament used \\[g\\]");
    const mmStr = matchValue(combinedText, "filament used \\[mm\\]");
    const cm3Str = matchValue(combinedText, "filament used \\[cm3\\]");
    const estimatedTime = matchValue(
      combinedText,
      "estimated printing time \\(normal mode\\)"
    );
    const fillDensity = matchValue(combinedText, "fill_density");
    const layerHeight = matchValue(combinedText, "layer_height");
    const supportStr = matchValue(combinedText, "support_material");

    const filamentMm = mmStr ? parseFloat(mmStr) : null;
    const filamentCm3 = cm3Str ? parseFloat(cm3Str) : null;
    let weightGrams = totalGramsStr ? parseFloat(totalGramsStr) : NaN;

    if ((!Number.isFinite(weightGrams) || weightGrams <= 0) && filamentCm3 && filamentCm3 > 0) {
      weightGrams = filamentCm3 * PLA_DENSITY;
    } else if (
      (!Number.isFinite(weightGrams) || weightGrams <= 0) &&
      filamentMm &&
      filamentMm > 0
    ) {
      weightGrams = ((filamentMm * 2.40528) / 1000) * PLA_DENSITY;
    }

    if (!Number.isFinite(weightGrams) || weightGrams <= 0) {
      return null;
    }

    const supports =
      supportStr === "1" ||
      (typeof supportStr === "string" &&
        supportStr.toLowerCase() === "true");

    return {
      filename: path.basename(filePath),
      fullPath: filePath,
      mtimeMs: st.mtimeMs,
      weightGrams: Number(Math.max(0.1, weightGrams).toFixed(2)),
      filamentMm:
        filamentMm && Number.isFinite(filamentMm)
          ? Number(filamentMm.toFixed(1))
          : null,
      filamentCm3:
        filamentCm3 && Number.isFinite(filamentCm3)
          ? Number(filamentCm3.toFixed(2))
          : null,
      estimatedTime: estimatedTime || null,
      fillDensity: fillDensity || null,
      layerHeight: layerHeight || null,
      supports,
    };
  } finally {
    await handle.close();
  }
}

async function getPrusaSlicerLastOutputDir(): Promise<string | null> {
  const home = process.env.HOME;
  if (!home) return null;
  const candidates = [
    path.join(
      home,
      ".var",
      "app",
      "com.prusa3d.PrusaSlicer",
      "config",
      "PrusaSlicer",
      "PrusaSlicer.ini"
    ),
    path.join(home, ".config", "PrusaSlicer", "PrusaSlicer.ini"),
  ];
  for (const iniPath of candidates) {
    try {
      const content = await fs.readFile(iniPath, "utf-8");
      const m = /^(?:last_output_path|skein_directory)\s*=\s*(.+)$/m.exec(
        content
      );
      if (m) return m[1].trim();
    } catch {
      // Essaie le chemin suivant
    }
  }
  return null;
}

/**
 * Recherche le fichier `.gcode` ou `.bgcode` le plus récemment exporté par l'opérateur
 * depuis l'ouverture de la pièce dans PrusaSlicer. S'il a été enregistré dans un autre dossier,
 * il est automatiquement copié dans `./data/gcode/`.
 */
export async function findLatestExportedGcodeSince(
  sinceMs: number
): Promise<ParsedGcodeMetadata | null> {
  const gcodeDir = path.resolve(process.cwd(), "data", "gcode");
  await fs.mkdir(gcodeDir, { recursive: true });

  const dirsToCheck = new Set<string>([gcodeDir]);
  const lastDir = await getPrusaSlicerLastOutputDir();
  if (lastDir) {
    dirsToCheck.add(path.resolve(lastDir));
  }

  let newestCandidate: { fullPath: string; mtimeMs: number; inGcodeDir: boolean } | null =
    null;

  for (const dir of dirsToCheck) {
    const entries = await fs.readdir(dir).catch(() => []);
    for (const name of entries) {
      const ext = path.extname(name).toLowerCase();
      if (ext !== ".gcode" && ext !== ".bgcode") continue;
      const fullPath = path.join(dir, name);
      const st = await fs.stat(fullPath).catch(() => null);
      if (!st || !st.isFile()) continue;
      if (st.mtimeMs < sinceMs) continue;

      if (!newestCandidate || st.mtimeMs > newestCandidate.mtimeMs) {
        newestCandidate = {
          fullPath,
          mtimeMs: st.mtimeMs,
          inGcodeDir: dir === gcodeDir,
        };
      }
    }
  }

  if (!newestCandidate) return null;

  let targetPath = newestCandidate.fullPath;
  if (!newestCandidate.inGcodeDir) {
    const dest = path.join(gcodeDir, path.basename(newestCandidate.fullPath));
    await fs.copyFile(newestCandidate.fullPath, dest).catch(() => {});
    targetPath = dest;
  }

  const parsed = await parsePrusaGcodeMetadata(targetPath);
  if (!parsed) return null;
  // Conserve le timestamp exact d'export pour le suivi côté UI
  parsed.mtimeMs = newestCandidate.mtimeMs;
  return parsed;
}
