import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
// small-batch-dataset/stickers/build.ts --web
import stickerUrl from "../assets/sd-sticker.webp";

/** A full-size SD card in millimeters, as the sticker build draws it. */
const CARD = { w: 24, h: 32, t: 2.1, chamfer: 4, r: 1 };
/** The 20 × 25 mm label, centered, 2.5 mm down from the top edge. */
const LABEL = { w: 20, h: 25, top: 2.5 };
const BEVEL = 0.25;
/** One turn every ten seconds. */
const TURN = (Math.PI * 2) / 10;
/** Radians of turn per pixel dragged. */
const DRAG = 0.012;

/** The card's outline, centered, y up: rounded corners, the top-right one cut off. */
function outline() {
  const { w, h, chamfer, r } = CARD;
  const [x0, y0, x1, y1] = [-w / 2, -h / 2, w / 2, h / 2];
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - chamfer);
  s.lineTo(x1 - chamfer, y1);
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

/**
 * The SD-card edition, turning: dark plastic, the sticker on the front, the
 * contacts on the back. Drag to spin it; it settles back into its slow turn
 * (or stops, with reduced motion). Draws only while on screen and moving.
 */
export default function SdCard({ className = "" }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.NeutralToneMapping;
    const canvas = renderer.domElement;
    canvas.className = "block size-full cursor-grab touch-pan-y";
    host.appendChild(canvas);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(30, 50, 70);
    scene.add(key);

    const camera = new THREE.PerspectiveCamera(24, 1, 1, 1000);
    camera.position.set(0, 0, 96);

    // Seen from a little above: the tilt is fixed, the spin turns inside it.
    const tilt = new THREE.Group();
    tilt.rotation.x = 0.16;
    const spin = new THREE.Group();
    tilt.add(spin);
    scene.add(tilt);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) => {
      geometries.push(geometry);
      if (!materials.includes(material)) materials.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      spin.add(mesh);
    };

    const core = CARD.t - 2 * BEVEL;
    const body = new THREE.ExtrudeGeometry(outline(), {
      depth: core,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelOffset: -BEVEL,
      bevelSegments: 3,
      curveSegments: 8,
    });
    body.translate(0, 0, -core / 2);
    add(body, new THREE.MeshPhysicalMaterial({ color: 0x2b2b2e, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4 }));

    const sticker = new THREE.TextureLoader().load(stickerUrl, () => wake());
    sticker.colorSpace = THREE.SRGBColorSpace;
    sticker.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const front = CARD.t / 2 + 0.01;
    add(
      new THREE.PlaneGeometry(LABEL.w, LABEL.h),
      new THREE.MeshStandardMaterial({ map: sticker, alphaTest: 0.5, roughness: 0.6 }),
      0,
      CARD.h / 2 - LABEL.top - LABEL.h / 2,
      front,
    );

    // Nine contacts along the top edge on the back, clear of the cut corner.
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4af5a, metalness: 1, roughness: 0.3 });
    const pad = new THREE.BoxGeometry(1.5, 3.6, 0.04);
    for (let i = 0; i < 9; i++) add(pad, gold, -10.4 + i * 2.2, CARD.h / 2 - 0.9 - 1.8, -front);
    // The write-protect switch on the left edge.
    add(new THREE.BoxGeometry(0.6, 3.2, 1.1), new THREE.MeshStandardMaterial({ color: 0xe9e7e1, roughness: 0.5 }), -CARD.w / 2 - 0.1, 5);

    // Spin: a slow turn, or the flick a drag leaves behind, easing back to it.
    let angle = -0.6;
    let vel = reduce ? 0 : TURN;
    let dragging = false;
    let lastX = 0;
    let lastMove = 0;
    let flick = 0;
    let visible = true;
    let raf = 0;
    let last = 0;

    const frame = (t: number) => {
      raf = 0;
      const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
      last = t;
      if (!dragging) {
        vel += ((reduce ? 0 : TURN) - vel) * (1 - Math.exp(-dt * 1.2));
        angle += vel * dt;
      }
      spin.rotation.y = angle;
      renderer.render(scene, camera);
      if (visible && (dragging || Math.abs(vel) > 1e-3)) raf = requestAnimationFrame(frame);
      else last = 0;
    };
    function wake() {
      if (!raf && visible) raf = requestAnimationFrame(frame);
    }

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastMove = performance.now();
      flick = 0;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      wake();
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const now = performance.now();
      const turn = (e.clientX - lastX) * DRAG;
      angle += turn;
      flick = turn / Math.max((now - lastMove) / 1000, 1 / 120);
      lastX = e.clientX;
      lastMove = now;
      wake();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      // A drag that stopped before letting go leaves no flick.
      vel = performance.now() - lastMove > 80 ? 0 : THREE.MathUtils.clamp(flick, -12, 12);
      canvas.style.cursor = "";
      wake();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    const resize = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      wake();
    });
    resize.observe(host);
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
      }
    });
    seen.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      seen.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      for (const g of new Set(geometries)) g.dispose();
      for (const m of materials) m.dispose();
      sticker.dispose();
      env.dispose();
      room.dispose();
      pmrem.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label="The SD card, turning: dark plastic, with the sticker of the twelve tables on the front."
      className={className}
    />
  );
}
