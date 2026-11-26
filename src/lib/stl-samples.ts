import fs from "node:fs";
import path from "node:path";

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

function formatTrianglesAsStl(
  solidName: string,
  triangles: [Vec3, Vec3, Vec3][]
): string {
  const lines: string[] = [`solid ${solidName}`];
  for (const [v1, v2, v3] of triangles) {
    const unit = normalize(cross(sub(v2, v1), sub(v3, v1)));
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

function buildConvexAsciiStl(
  solidName: string,
  triangles: [Vec3, Vec3, Vec3][],
  interiorPoint: Vec3
): string {
  const oriented: [Vec3, Vec3, Vec3][] = triangles.map(([p1, p2, p3]) => {
    const n = cross(sub(p2, p1), sub(p3, p1));
    if (dot(n, sub(p1, interiorPoint)) < 0) {
      return [p1, p3, p2];
    }
    return [p1, p2, p3];
  });
  return formatTrianglesAsStl(solidName, oriented);
}

export function createCubeStl(size = 24): string {
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
    [b0, b1, b2, b3],
    [t0, t1, t2, t3],
    [b0, b1, t1, t0],
    [b1, b2, t2, t1],
    [b2, b3, t3, t2],
    [b3, b0, t0, t3],
  ];

  const triangles: [Vec3, Vec3, Vec3][] = [];
  for (const [a, b, c, d] of quads) {
    triangles.push([a, b, c], [a, c, d]);
  }
  return buildConvexAsciiStl("cube_calibration_24mm", triangles, [0, 0, h]);
}

export function createPyramidStl(base = 32, height = 28): string {
  const h = base / 2;
  const b0: Vec3 = [-h, -h, 0];
  const b1: Vec3 = [h, -h, 0];
  const b2: Vec3 = [h, h, 0];
  const b3: Vec3 = [-h, h, 0];
  const apex: Vec3 = [0, 0, height];

  return buildConvexAsciiStl(
    "pyramide_support",
    [
      [b0, b1, b2],
      [b0, b2, b3],
      [b0, b1, apex],
      [b1, b2, apex],
      [b2, b3, apex],
      [b3, b0, apex],
    ],
    [0, 0, height / 4]
  );
}

export function createPolygonPrismStl(
  solidName: string,
  sides: number,
  radius: number,
  height: number
): string {
  const bottom: Vec3[] = [];
  const top: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = ((2 * Math.PI) / sides) * i;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    bottom.push([x, y, 0]);
    top.push([x, y, height]);
  }

  const bottomCenter: Vec3 = [0, 0, 0];
  const topCenter: Vec3 = [0, 0, height];
  const triangles: [Vec3, Vec3, Vec3][] = [];

  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    triangles.push([bottomCenter, bottom[i], bottom[next]]);
    triangles.push([topCenter, top[i], top[next]]);
    triangles.push([bottom[i], bottom[next], top[next]]);
    triangles.push([bottom[i], top[next], top[i]]);
  }

  return buildConvexAsciiStl(solidName, triangles, [0, 0, height / 2]);
}

/**
 * Équerre mécanique en L (100% étanche / manifold, extrudée sur Y).
 */
export function createLBracketStl(): string {
  const y0 = -12;
  const y1 = 12;
  // Polygone en L dans le plan XZ (CCW vu depuis -Y)
  const pts: [number, number][] = [
    [-18, 0],
    [18, 0],
    [18, 8],
    [-10, 8],
    [-10, 32],
    [-18, 32],
  ];

  const f = (i: number): Vec3 => [pts[i][0], y0, pts[i][1]];
  const b = (i: number): Vec3 => [pts[i][0], y1, pts[i][1]];

  const tris: [Vec3, Vec3, Vec3][] = [];

  // Face avant (y = y0, normale -Y)
  const faceIdx: [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 4],
    [0, 4, 5],
  ];
  for (const [i, j, k] of faceIdx) {
    // Dans (x, y, z) : (1,0,0) x (0,0,1) = (0,-1,0) -> normale -Y
    tris.push([f(i), f(j), f(k)]);
    // Face arrière (y = y1, normale +Y) : ordre inversé
    tris.push([b(i), b(k), b(j)]);
  }

  // Parois périphériques (normale sortante)
  for (let i = 0; i < pts.length; i++) {
    const next = (i + 1) % pts.length;
    tris.push([f(i), b(i), b(next)]);
    tris.push([f(i), b(next), f(next)]);
  }

  return formatTrianglesAsStl("equerre_fixation_L", tris);
}

export interface SampleStlDef {
  filename: string;
  generate: () => string;
}

export const SAMPLE_STLS: SampleStlDef[] = [
  { filename: "cube-calibration.stl", generate: () => createCubeStl(24) },
  { filename: "pyramide-support.stl", generate: () => createPyramidStl(32, 28) },
  {
    filename: "entretoise-hexagonale.stl",
    generate: () => createPolygonPrismStl("entretoise_hexagonale", 6, 16, 22),
  },
  { filename: "equerre-fixation.stl", generate: () => createLBracketStl() },
  {
    filename: "support-cylindrique.stl",
    generate: () => createPolygonPrismStl("support_cylindrique", 16, 15, 30),
  },
];

export function ensureSampleStlsOnDisk(): void {
  const stlDir = path.join(process.cwd(), "data", "stl");
  fs.mkdirSync(stlDir, { recursive: true });
  for (const sample of SAMPLE_STLS) {
    const target = path.join(stlDir, sample.filename);
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, sample.generate(), "utf-8");
    }
  }
}
