"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Box, Grid3X3, RotateCcw } from "lucide-react";

interface StlViewerProps {
  stlUrl: string;
  filename: string;
}

interface DimensionsMm {
  x: number;
  y: number;
  z: number;
  triangles: number;
}

export default function StlViewer({ stlUrl, filename }: StlViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const resetViewRef = useRef<(() => void) | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [dims, setDims] = useState<DimensionsMm | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    setLoading(true);
    setError(null);
    setDims(null);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a); // slate-900

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 420;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    camera.position.set(60, 50, 60);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;

    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // Éclairage studio lisible pour l'inspection géométrique
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 1.1);
    hemiLight.position.set(0, 120, 0);
    scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight1.position.set(80, 120, 90);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x94a3b8, 0.65);
    dirLight2.position.set(-80, 60, -70);
    scene.add(dirLight2);

    // Plateau d'impression type Prusa MK4 (250x210mm représenté par une grille 200mm)
    const gridHelper = new THREE.GridHelper(200, 20, 0xf97316, 0x334155);
    scene.add(gridHelper);

    let animationFrameId = 0;
    const animate = () => {
      if (disposed) return;
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || disposed) return;
      const w = container.clientWidth || 600;
      const h = container.clientHeight || 420;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Chargement du fichier STL via STLLoader
    const loader = new STLLoader();
    const abortController = new AbortController();

    fetch(stlUrl, { signal: abortController.signal })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Erreur HTTP ${res.status} lors du chargement STL`);
        }
        return res.arrayBuffer();
      })
      .then((buffer) => {
        if (disposed) return;
        const geometry = loader.parse(buffer);
        geometry.computeVertexNormals();

        // Dimensions dans le repère natif STL (Z-up en CAO/impression 3D)
        geometry.computeBoundingBox();
        const rawBox = geometry.boundingBox!;
        const sizeStl = new THREE.Vector3();
        rawBox.getSize(sizeStl);

        const posAttr = geometry.getAttribute("position");
        const triangles = posAttr ? Math.round(posAttr.count / 3) : 0;

        setDims({
          x: Number(sizeStl.x.toFixed(1)),
          y: Number(sizeStl.y.toFixed(1)),
          z: Number(sizeStl.z.toFixed(1)),
          triangles,
        });

        // Conversion Z-up (STL) -> Y-up (Three.js) pour poser la pièce à plat sur le plateau
        geometry.rotateX(-Math.PI / 2);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        const center = new THREE.Vector3();
        box.getCenter(center);

        geometry.translate(-center.x, -box.min.y, -center.z);
        geometry.computeBoundingSphere();

        const material = new THREE.MeshStandardMaterial({
          color: 0xf97316, // Prusa Orange
          roughness: 0.38,
          metalness: 0.12,
          wireframe: false,
        });

        const mesh = new THREE.Mesh(geometry, material);
        meshRef.current = mesh;
        scene.add(mesh);

        const radius = Math.max(geometry.boundingSphere?.radius ?? 20, 8);
        const targetY = (box.max.y - box.min.y) / 2;

        const fitCamera = () => {
          controls.target.set(0, targetY, 0);
          camera.position.set(
            radius * 2.1,
            targetY + radius * 1.5,
            radius * 2.1
          );
          camera.near = Math.max(0.1, radius / 100);
          camera.far = Math.max(2000, radius * 40);
          camera.updateProjectionMatrix();
          controls.update();
        };

        fitCamera();
        resetViewRef.current = fitCamera;
        setLoading(false);
      })
      .catch((err) => {
        if (disposed || err?.name === "AbortError") return;
        setError(
          err instanceof Error
            ? err.message
            : "Impossible de charger le modèle 3D."
        );
        setLoading(false);
      });

    return () => {
      disposed = true;
      abortController.abort();
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      controls.dispose();
      if (meshRef.current) {
        meshRef.current.geometry.dispose();
        if (Array.isArray(meshRef.current.material)) {
          meshRef.current.material.forEach((m) => m.dispose());
        } else {
          meshRef.current.material.dispose();
        }
        meshRef.current = null;
      }
      renderer.dispose();
    };
  }, [stlUrl]);

  useEffect(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material;
    if (mat instanceof THREE.MeshStandardMaterial) {
      mat.wireframe = wireframe;
      mat.needsUpdate = true;
    }
  }, [wireframe]);

  return (
    <div className="relative flex-1 min-h-[360px] w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-900 shadow-inner">
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {/* Infos dimensions & fichier */}
      <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2 pointer-events-none">
        <span className="inline-flex items-center gap-1.5 bg-slate-950/75 backdrop-blur px-2.5 py-1 rounded-md text-xs font-mono text-slate-200 border border-slate-700/80">
          <Box className="h-3.5 w-3.5 text-orange-400" />
          {filename}
        </span>
        {dims && (
          <span className="bg-slate-950/75 backdrop-blur px-2.5 py-1 rounded-md text-xs font-mono text-slate-300 border border-slate-700/80">
            {dims.x} × {dims.y} × {dims.z} mm • {dims.triangles} facettes
          </span>
        )}
      </div>

      {/* Contrôles caméra / maillage */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setWireframe((w) => !w)}
          title="Afficher/masquer le maillage filaire"
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition ${
            wireframe
              ? "bg-orange-600 text-white border-orange-500"
              : "bg-slate-950/75 text-slate-200 border-slate-700 hover:bg-slate-800"
          }`}
        >
          <Grid3X3 className="h-3.5 w-3.5" />
          Filaire
        </button>
        <button
          type="button"
          onClick={() => resetViewRef.current?.()}
          title="Recentrer la caméra"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-slate-950/75 text-slate-200 border border-slate-700 hover:bg-slate-800 transition"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Recentrer
        </button>
      </div>

      <div className="absolute bottom-2.5 left-3 text-[11px] text-slate-400 pointer-events-none bg-slate-950/60 px-2 py-0.5 rounded">
        Clic gauche : orbiter • Molette : zoomer • Clic droit : déplacer
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 text-slate-200 text-sm">
          Chargement du modèle 3D…
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 p-6 text-center">
          <div className="max-w-sm rounded-lg bg-rose-950/60 border border-rose-500/40 p-4 text-rose-200 text-sm">
            {error}
          </div>
        </div>
      )}
    </div>
  );
}
