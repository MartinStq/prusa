import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function fmt(n: number): string {
  return Number(n.toFixed(6)).toString();
}

/**
 * Construit un fichier STL ASCII valide à partir d'une liste de triangles
 * et d'un point intérieur (pour garantir l'orientation sortante des normales).
 */
function buildAsciiStl(
  solidName: string,
  triangles: [Vec3, Vec3, Vec3][],
  interiorPoint: Vec3
): string {
  const lines: string[] = [`solid ${solidName}`];

  for (const [p1, p2, p3] of triangles) {
    let v1 = p1;
    let v2 = p2;
    let v3 = p3;

    let n = cross(sub(v2, v1), sub(v3, v1));
    const outwardRef = sub(v1, interiorPoint);
    if (dot(n, outwardRef) < 0) {
      [v2, v3] = [v3, v2];
      n = cross(sub(v2, v1), sub(v3, v1));
    }
    const unit = normalize(n);

    lines.push(`  facet normal ${fmt(unit[0])} ${fmt(unit[1])} ${fmt(unit[2])}`);
    lines.push("    outer loop");
    lines.push(`      vertex ${fmt(v1[0])} ${fmt(v1[1])} ${fmt(v1[2])}`);
    lines.push(`      vertex ${fmt(v2[0])} ${fmt(v2[1])} ${fmt(v2[2])}`);
    lines.push(`      vertex ${fmt(v3[0])} ${fmt(v3[1])} ${fmt(v3[2])}`);
    lines.push("    endloop");
    lines.push("  endfacet");
  }

  lines.push(`endsolid ${solidName}`);
  return lines.join("\n") + "\n";
}

function createCubeStl(size = 24): string {
  const h = size / 2;
  const b0: Vec3 = [-h, -h, 0];
  const b1: Vec3 = [h, -h, 0];
  const b2: Vec3 = [h, h, 0];
  const b3: Vec3 = [-h, h, 0];
  const t0: Vec3 = [-h, -h, size];
  const t1: Vec3 = [h, -h, size];
  const t2: Vec3 = [h, h, size];
  const t3: Vec3 = [-h, h, size];

  const quads: [Vec3, Vec3, Vec3, Vec3][] = [
    [b0, b1, b2, b3], // bottom
    [t0, t1, t2, t3], // top
    [b0, b1, t1, t0], // front
    [b1, b2, t2, t1], // right
    [b2, b3, t3, t2], // back
    [b3, b0, t0, t3], // left
  ];

  const triangles: [Vec3, Vec3, Vec3][] = [];
  for (const [a, b, c, d] of quads) {
    triangles.push([a, b, c], [a, c, d]);
  }

  return buildAsciiStl("cube_calibration_24mm", triangles, [0, 0, size / 2]);
}

function createPyramidStl(base = 32, height = 28): string {
  const h = base / 2;
  const b0: Vec3 = [-h, -h, 0];
  const b1: Vec3 = [h, -h, 0];
  const b2: Vec3 = [h, h, 0];
  const b3: Vec3 = [-h, h, 0];
  const apex: Vec3 = [0, 0, height];

  const triangles: [Vec3, Vec3, Vec3][] = [
    [b0, b1, b2],
    [b0, b2, b3],
    [b0, b1, apex],
    [b1, b2, apex],
    [b2, b3, apex],
    [b3, b0, apex],
  ];

  return buildAsciiStl("pyramide_support", triangles, [0, 0, height / 4]);
}

function createHexPrismStl(radius = 16, height = 22): string {
  const bottom: Vec3[] = [];
  const top: Vec3[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    bottom.push([x, y, 0]);
    top.push([x, y, height]);
  }

  const bottomCenter: Vec3 = [0, 0, 0];
  const topCenter: Vec3 = [0, 0, height];
  const triangles: [Vec3, Vec3, Vec3][] = [];

  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6;
    // Bottom cap
    triangles.push([bottomCenter, bottom[i], bottom[next]]);
    // Top cap
    triangles.push([topCenter, top[i], top[next]]);
    // Side quad
    triangles.push([bottom[i], bottom[next], top[next]]);
    triangles.push([bottom[i], top[next], top[i]]);
  }

  return buildAsciiStl("entretoise_hexagonale", triangles, [0, 0, height / 2]);
}

async function main() {
  const stlDir = path.join(process.cwd(), "data", "stl");
  const gcodeDir = path.join(process.cwd(), "data", "gcode");
  fs.mkdirSync(stlDir, { recursive: true });
  fs.mkdirSync(gcodeDir, { recursive: true });

  const stlFiles = [
    { filename: "cube-calibration.stl", content: createCubeStl(24) },
    { filename: "pyramide-support.stl", content: createPyramidStl(32, 28) },
    { filename: "entretoise-hexagonale.stl", content: createHexPrismStl(16, 22) },
  ];

  for (const file of stlFiles) {
    fs.writeFileSync(path.join(stlDir, file.filename), file.content, "utf-8");
  }
  console.log(`✓ 3 fichiers STL ASCII générés dans ./data/stl/`);

  await prisma.printRequest.deleteMany();

  const requests = [
    {
      clientName: "Sophie Laurent",
      clientEmail: "sophie.laurent@atelier-nova.be",
      stlFilename: "cube-calibration.stl",
      stlPath: "./data/stl/cube-calibration.stl",
      status: "TO_ANALYZE",
    },
    {
      clientName: "Thomas Vandenberghe",
      clientEmail: "t.vandenberghe@mecatech.be",
      stlFilename: "entretoise-hexagonale.stl",
      stlPath: "./data/stl/entretoise-hexagonale.stl",
      status: "TO_ANALYZE",
    },
    {
      clientName: "Claire Dubois",
      clientEmail: "claire.dubois@studio-k.be",
      stlFilename: "pyramide-support.stl",
      stlPath: "./data/stl/pyramide-support.stl",
      status: "QUOTE_SENT",
      verdict: "PRINTABLE",
      weightGrams: 18.5,
      priceTvac: 13.7,
      operatorComment: "Impression PLA Prusament Galaxy Black 0.20mm, remplissage 20%.",
      needsDesignerMeeting: false,
    },
    {
      clientName: "Marc Peeters",
      clientEmail: "marc.peeters@fabrique-nord.be",
      stlFilename: "entretoise-hexagonale.stl",
      stlPath: "./data/stl/entretoise-hexagonale.stl",
      status: "QUOTE_SENT",
      verdict: "NEEDS_IMPROVEMENT",
      weightGrams: 32.0,
      priceTvac: 16.4,
      operatorComment:
        "Chanfrein un peu raide sur l'assise : ajout de 3 périmètres prévu au slicing pour renforcer la pièce.",
      needsDesignerMeeting: false,
    },
    {
      clientName: "Julie Moreau",
      clientEmail: "julie.moreau@proto-lab.be",
      stlFilename: "cube-calibration.stl",
      stlPath: "./data/stl/cube-calibration.stl",
      status: "APPROVED",
      verdict: "PRINTABLE",
      weightGrams: 24.0,
      priceTvac: 14.8,
      operatorComment: "Devis validé par la cliente. Prêt pour tranchage dans PrusaSlicer (PLA Prusament Orange).",
      needsDesignerMeeting: false,
    },
  ];

  for (const req of requests) {
    await prisma.printRequest.create({ data: req });
  }

  console.log(`✓ ${requests.length} demandes d'impression de test créées dans SQLite.`);
}

main()
  .catch((err) => {
    console.error("Erreur lors du seed :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
