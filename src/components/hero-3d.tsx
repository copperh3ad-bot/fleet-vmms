"use client";
import { useEffect, useRef, useState } from "react";

// A real 3D wheel behind the home page headline, ringed by a slowly turning network of route points with light pulses running
// along it. It is decoration only (hidden from assistive technology) and costs nothing until it is wanted: the 3D library is a
// separate download that starts after the page has appeared, and only on a wide screen, with motion allowed, on a connection
// that is not saving data. On a phone, on a weak device, or where WebGL is missing, the page simply has no canvas and shows the
// flat illustration it always had. Drawing pauses when the picture is scrolled away or the tab is hidden.

const GOLD = 0xf2b84b;

type Nav = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

function wanted(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Nav;
  if (!window.matchMedia("(min-width: 768px)").matches) return false;
  if (nav.connection?.saveData) return false;
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 2) return false;
  return true;
}

export function Hero3D() {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = box.current;
    if (!host || !wanted()) return;
    let stop = () => {};
    let gone = false;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const start = async () => {
      try {
        const [THREE, { RoomEnvironment }] = await Promise.all([import("three"), import("three/addons/environments/RoomEnvironment.js")]);
        if (gone) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.setClearColor(0x000000, 0);
        host.appendChild(renderer.domElement);
        renderer.domElement.style.cssText = "display:block;width:100%;height:100%";

        const scene = new THREE.Scene();
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environment = envTex;
        scene.environmentIntensity = 0.55;

        const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
        camera.position.set(0, 0, 7.5);

        const key = new THREE.DirectionalLight(0xfff0d0, 3.2); key.position.set(3, 4, 5); scene.add(key);
        const rim = new THREE.DirectionalLight(0x4fb6d6, 3); rim.position.set(-5, 1, -2); scene.add(rim);
        const gl = new THREE.PointLight(GOLD, 40, 12, 2); gl.position.set(1.5, 1.8, -2.2); scene.add(gl);   // warm light from behind the wheel
        scene.add(new THREE.AmbientLight(0x88a4b4, 0.6));

        // a soft glow disc behind the wheel
        const gc = document.createElement("canvas"); gc.width = gc.height = 128;
        const g2 = gc.getContext("2d");
        if (g2) { const gr = g2.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, "rgba(242,184,75,.55)"); gr.addColorStop(0.5, "rgba(11,110,138,.22)"); gr.addColorStop(1, "rgba(11,110,138,0)"); g2.fillStyle = gr; g2.fillRect(0, 0, 128, 128); }
        const glowTex = new THREE.CanvasTexture(gc);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        glow.scale.set(7.5, 7.5, 1); glow.position.z = -1.5; scene.add(glow);

        const owned: { dispose(): void }[] = [];
        const own = <T extends { dispose(): void }>(x: T) => { owned.push(x); return x; };

        // ---- the wheel ----
        const wheel = new THREE.Group();
        const tyreMat = own(new THREE.MeshStandardMaterial({ color: 0x33475a, roughness: 0.5, metalness: 0.35 }));
        const steel = own(new THREE.MeshStandardMaterial({ color: 0xd3dde3, roughness: 0.28, metalness: 1 }));
        const gold = own(new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.3, metalness: 1, emissive: GOLD, emissiveIntensity: 0.25 }));

        wheel.add(new THREE.Mesh(own(new THREE.TorusGeometry(1, 0.42, 36, 120)), tyreMat));

        // tread blocks around the outside
        const BLOCKS = 56;
        const blockGeo = own(new THREE.BoxGeometry(0.17, 0.09, 0.62));
        const blocks = new THREE.InstancedMesh(blockGeo, own(new THREE.MeshStandardMaterial({ color: 0x45596b, roughness: 0.6, metalness: 0.3 })), BLOCKS);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
        for (let i = 0; i < BLOCKS; i++) {
          const a = (i / BLOCKS) * Math.PI * 2;
          q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
          p.set(Math.cos(a) * 1.43, Math.sin(a) * 1.43, 0);
          blocks.setMatrixAt(i, m.compose(p, q, one));
        }
        wheel.add(blocks);

        // gold accent ring on both sidewalls
        const ringGeo = own(new THREE.TorusGeometry(1.04, 0.017, 12, 160));
        for (const z of [0.405, -0.405]) { const r = new THREE.Mesh(ringGeo, gold); r.position.z = z; wheel.add(r); }

        // the rim: barrel, lips, spokes and hub
        const barrel = new THREE.Mesh(own(new THREE.CylinderGeometry(0.64, 0.64, 0.56, 72, 1, true)), own(new THREE.MeshStandardMaterial({ color: 0xaab8c1, roughness: 0.35, metalness: 1, side: THREE.DoubleSide })));
        barrel.rotation.x = Math.PI / 2; wheel.add(barrel);
        const lipGeo = own(new THREE.TorusGeometry(0.64, 0.045, 16, 96));
        for (const z of [0.28, -0.28]) { const l = new THREE.Mesh(lipGeo, steel); l.position.z = z; wheel.add(l); }
        const face = new THREE.Mesh(own(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 72)), own(new THREE.MeshStandardMaterial({ color: 0x182630, roughness: 0.6, metalness: 0.6 })));
        face.rotation.x = Math.PI / 2; face.position.z = 0.05; wheel.add(face);
        const spokeGeo = own(new THREE.BoxGeometry(0.15, 0.5, 0.1));
        const SPOKES = 6;
        for (let i = 0; i < SPOKES; i++) {
          const a = (i / SPOKES) * Math.PI * 2;
          const s = new THREE.Mesh(spokeGeo, steel);
          s.position.set(Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0.12);
          s.rotation.z = a - Math.PI / 2;
          wheel.add(s);
        }
        const hub = new THREE.Mesh(own(new THREE.CylinderGeometry(0.2, 0.22, 0.2, 40)), gold);
        hub.rotation.x = Math.PI / 2; hub.position.z = 0.18; wheel.add(hub);
        const nutGeo = own(new THREE.CylinderGeometry(0.028, 0.028, 0.05, 6));
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + 0.3;
          const n = new THREE.Mesh(nutGeo, steel);
          n.rotation.x = Math.PI / 2; n.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.3); wheel.add(n);
        }

        const pivot = new THREE.Group();   // tilts toward the pointer; the wheel inside spins
        pivot.add(wheel);
        scene.add(pivot);

        // ---- the route network: points on a shell, each joined to its nearest neighbours ----
        const net = new THREE.Group();
        scene.add(net);
        const N = 70;
        let seed = 7;
        const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
        const pts: import("three").Vector3[] = [];
        for (let i = 0; i < N; i++) {
          const u = rand() * 2 - 1, th = rand() * Math.PI * 2, r = 2.9 + rand() * 1.5, s = Math.sqrt(1 - u * u);
          pts.push(new THREE.Vector3(r * s * Math.cos(th), r * u * 0.62, r * s * Math.sin(th)));
        }
        const edges: [number, number][] = [];
        const seen = new Set<string>();
        pts.forEach((a, i) => {
          pts.map((b, j) => ({ j, d: a.distanceToSquared(b) })).filter((o) => o.j !== i).sort((x, y) => x.d - y.d).slice(0, 2).forEach(({ j }) => {
            const k = i < j ? `${i}-${j}` : `${j}-${i}`;
            if (!seen.has(k)) { seen.add(k); edges.push([i, j]); }
          });
        });
        const lineGeo = own(new THREE.BufferGeometry());
        lineGeo.setFromPoints(edges.flatMap(([i, j]) => [pts[i], pts[j]]));
        net.add(new THREE.LineSegments(lineGeo, own(new THREE.LineBasicMaterial({ color: 0x4fb6d6, transparent: true, opacity: 0.28 }))));

        const nodeGeo = own(new THREE.BufferGeometry().setFromPoints(pts));
        net.add(new THREE.Points(nodeGeo, own(new THREE.PointsMaterial({ color: GOLD, size: 0.07, transparent: true, opacity: 0.95, sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending }))));

        const PULSES = 14;
        const pulseGeo = own(new THREE.BufferGeometry());
        pulseGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PULSES * 3), 3));
        net.add(new THREE.Points(pulseGeo, own(new THREE.PointsMaterial({ color: 0xffe3a3, size: 0.16, transparent: true, opacity: 0.9, sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending }))));
        const pulse = Array.from({ length: PULSES }, (_, i) => ({ e: Math.floor(rand() * edges.length), t: rand(), v: 0.18 + rand() * 0.25, i }));

        // ---- fine dust ----
        const DUST = 260;
        const dustPos = new Float32Array(DUST * 3);
        for (let i = 0; i < DUST; i++) { dustPos[i * 3] = (rand() - 0.5) * 16; dustPos[i * 3 + 1] = (rand() - 0.5) * 8; dustPos[i * 3 + 2] = (rand() - 0.5) * 10 - 2; }
        const dustGeo = own(new THREE.BufferGeometry());
        dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
        const dust = new THREE.Points(dustGeo, own(new THREE.PointsMaterial({ color: 0x9fb2be, size: 0.03, transparent: true, opacity: 0.55, depthWrite: false })));
        scene.add(dust);

        // ---- size, pointer, loop ----
        const layout = () => {
          const w = host.clientWidth || 1, h = host.clientHeight || 1;
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          const halfW = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z * camera.aspect;
          const x = halfW * 0.6;
          pivot.position.set(x, 0.1, 0); net.position.set(x, 0, 0); glow.position.x = x;
          const sc = Math.min(1.1, Math.max(0.75, h / 640));
          pivot.scale.setScalar(sc);
        };
        layout();
        const ro = new ResizeObserver(layout);
        ro.observe(host);

        const aim = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
        const onMove = (e: PointerEvent) => { aim.x = (e.clientX / window.innerWidth) * 2 - 1; aim.y = (e.clientY / window.innerHeight) * 2 - 1; };
        window.addEventListener("pointermove", onMove, { passive: true });

        const tmp = new THREE.Vector3();
        const posAttr = pulseGeo.getAttribute("position") as import("three").BufferAttribute;
        const draw = (t: number, dt: number) => {
          cur.x += (aim.x - cur.x) * 0.05; cur.y += (aim.y - cur.y) * 0.05;
          pivot.rotation.y = -0.62 + cur.x * 0.28;
          pivot.rotation.x = 0.1 + cur.y * 0.16;
          wheel.rotation.z = -t * 0.5;
          net.rotation.y = t * 0.06; net.rotation.x = Math.sin(t * 0.2) * 0.05;
          dust.rotation.y = t * 0.012;
          for (const o of pulse) {
            o.t += o.v * dt;
            if (o.t >= 1) { o.t = 0; o.e = Math.floor(rand() * edges.length); }
            const [a, b] = edges[o.e];
            tmp.lerpVectors(pts[a], pts[b], o.t);
            posAttr.setXYZ(o.i, tmp.x, tmp.y, tmp.z);
          }
          posAttr.needsUpdate = true;
          renderer.render(scene, camera);
        };

        let raf = 0, last = performance.now(), visible = true;
        const frame = (now: number) => {
          raf = 0;
          if (gone || !visible || document.hidden) return;
          const dt = Math.min(0.05, (now - last) / 1000); last = now;
          draw(now / 1000, dt);
          raf = requestAnimationFrame(frame);
        };
        const kick = () => { if (!raf && !calm && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };

        draw(2.2, 0);                       // first picture straight away; for visitors who want calm, this is the only one
        setReady(true);

        const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }, { threshold: 0 });
        io.observe(host);
        document.addEventListener("visibilitychange", kick);
        kick();

        stop = () => {
          if (raf) cancelAnimationFrame(raf);
          io.disconnect(); ro.disconnect();
          window.removeEventListener("pointermove", onMove);
          document.removeEventListener("visibilitychange", kick);
          owned.forEach((o) => o.dispose());
          glowTex.dispose(); glow.material.dispose();
          envTex.dispose(); pmrem.dispose(); renderer.dispose();
          renderer.domElement.remove();
        };
        if (gone) stop();
      } catch {
        /* no WebGL, or the library did not load: the flat illustration is already on the page */
      }
    };

    // after the page has appeared: when the browser is idle, or after a short wait where it cannot say so
    const hasIdle = "requestIdleCallback" in window;
    const handle = hasIdle ? window.requestIdleCallback(() => { void start(); }, { timeout: 1500 }) : window.setTimeout(() => { void start(); }, 400);
    return () => { gone = true; if (hasIdle) window.cancelIdleCallback(handle); else clearTimeout(handle); stop(); };
  }, []);

  return <div ref={box} aria-hidden="true" className={`hero-3d pointer-events-none absolute inset-0 transition-opacity duration-1000 ${ready ? "opacity-100" : "opacity-0"}`} />;
}
