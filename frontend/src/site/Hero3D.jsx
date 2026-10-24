// Live 3D hero: Guardian, a robot made from the pause tile, stands guard while
// purchase pieces fall around it. Drag and throw the pieces, click one to see
// Guardian's call. Guardian's eyes follow you and change with each verdict.
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { BallCollider, CuboidCollider, Physics, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { C, VERDICT_COLOR, spawnList } from "./pieces.js";

/* ---------- materials and textures ---------- */
const gloss = (color, extra = {}) => ({
  color, roughness: 0.22, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.08, ...extra,
});

const texCache = {};
function canvasTexture(key, draw, w = 512, h = 320) {
  if (texCache[key]) return texCache[key];
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache[key] = t;
  return t;
}
const FONT = 'Geist, "Segoe UI", "Noto Sans", Roboto, Arial, sans-serif';

// Soft round glow, used in place of a bloom pass so there's no extra library
const glowTex = () => canvasTexture("glow", (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.25, "rgba(255,255,255,0.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, w, h);
}, 256, 256);

const tagTex = () => canvasTexture("tag", (g, w, h) => {
  g.fillStyle = C.lemon; g.fillRect(0, 0, w, h);
  g.fillStyle = C.cherry; g.beginPath(); g.arc(56, h / 2, 22, 0, Math.PI * 2); g.fill();
  g.fillStyle = C.lemon; g.beginPath(); g.arc(56, h / 2, 12, 0, Math.PI * 2); g.fill();
  g.fillStyle = C.cherry; g.font = `600 150px ${FONT}`; g.textBaseline = "middle"; g.fillText("−60%", 100, h / 2 + 8);
});
const noteTex = () => canvasTexture("note", (g, w, h) => {
  g.fillStyle = C.roseSoft; g.fillRect(0, 0, w, h);
  g.fillStyle = C.cherry; g.font = `600 46px ${FONT}`; g.fillText("Note to AI agents:", 36, 70);
  g.globalAlpha = 0.5; g.lineCap = "round"; g.lineWidth = 14; g.strokeStyle = C.rose;
  [[36, 140, 440], [36, 196, 380], [36, 252, 300]].forEach(([x, y, l]) => { g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y); g.stroke(); });
});
const phoneTex = () => canvasTexture("phone", (g, w, h) => {
  g.fillStyle = C.angelSoft; g.fillRect(0, 0, w, h);
  g.fillStyle = C.cherry; g.font = `600 64px ${FONT}`; g.textAlign = "center";
  g.fillText("Share your", w / 2, h * 0.36); g.fillText("number?", w / 2, h * 0.36 + 76);
  g.fillStyle = C.tomato; g.beginPath(); g.roundRect(w / 2 - 120, h * 0.66, 240, 84, 42); g.fill();
  g.fillStyle = "#FFFFFF"; g.font = `600 44px ${FONT}`; g.fillText("Blocked", w / 2, h * 0.66 + 57);
}, 360, 640);
const coinTex = () => canvasTexture("coin", (g, w, h) => {
  g.fillStyle = C.gold; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#D9A632"; g.lineWidth = 18; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 30, 0, Math.PI * 2); g.stroke();
  g.fillStyle = C.cherry; g.font = `500 300px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("₹", w / 2, h / 2 + 14);
}, 512, 512);

let shieldGeom;
function shieldGeometry() {
  if (shieldGeom) return shieldGeom;
  const s = new THREE.Shape();
  s.moveTo(0, 0.62);
  s.bezierCurveTo(0.3, 0.62, 0.5, 0.52, 0.56, 0.46);
  s.lineTo(0.56, 0.06);
  s.bezierCurveTo(0.56, -0.34, 0.26, -0.56, 0, -0.68);
  s.bezierCurveTo(-0.26, -0.56, -0.56, -0.34, -0.56, 0.06);
  s.lineTo(-0.56, 0.46);
  s.bezierCurveTo(-0.5, 0.52, -0.3, 0.62, 0, 0.62);
  shieldGeom = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.08, bevelSegments: 6, curveSegments: 28 });
  shieldGeom.center();
  return shieldGeom;
}

/* ---------- the pieces ---------- */
function PieceMesh({ kind }) {
  switch (kind) {
    case "pause":
      return (
        <group>
          <RoundedBox args={[1, 1, 0.38]} radius={0.24} smoothness={6}><meshPhysicalMaterial {...gloss(C.tang)} /></RoundedBox>
          {[-0.17, 0.17].map((x) => (
            <RoundedBox key={x} args={[0.16, 0.5, 0.12]} radius={0.07} smoothness={4} position={[x, 0, 0.2]}>
              <meshPhysicalMaterial {...gloss(C.cherry)} />
            </RoundedBox>
          ))}
        </group>
      );
    case "tag":
      return (
        <group>
          <RoundedBox args={[1.32, 0.8, 0.16]} radius={0.1} smoothness={4}><meshPhysicalMaterial {...gloss(C.lemon)} /></RoundedBox>
          <mesh position={[0, 0, 0.082]}><planeGeometry args={[1.2, 0.72]} /><meshPhysicalMaterial {...gloss("#ffffff")} map={tagTex()} /></mesh>
        </group>
      );
    case "note":
      return (
        <group>
          <RoundedBox args={[1.2, 0.86, 0.08]} radius={0.04} smoothness={3}><meshPhysicalMaterial {...gloss(C.roseSoft, { roughness: 0.35 })} /></RoundedBox>
          <mesh position={[0, 0, 0.042]}><planeGeometry args={[1.12, 0.78]} /><meshPhysicalMaterial {...gloss("#ffffff", { roughness: 0.35 })} map={noteTex()} /></mesh>
        </group>
      );
    case "phone":
      return (
        <group>
          <RoundedBox args={[0.66, 1.22, 0.1]} radius={0.09} smoothness={4}><meshPhysicalMaterial {...gloss(C.sonic)} /></RoundedBox>
          <mesh position={[0, 0, 0.052]}><planeGeometry args={[0.56, 1.06]} /><meshPhysicalMaterial {...gloss("#ffffff")} map={phoneTex()} /></mesh>
        </group>
      );
    case "shield":
      return <mesh geometry={shieldGeometry()}><meshPhysicalMaterial {...gloss(C.angel, { sheen: 0.4, sheenColor: "#ffffff" })} /></mesh>;
    case "coin":
    default:
      return (
        <group>
          <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.52, 0.52, 0.16, 48]} /><meshPhysicalMaterial {...gloss(C.gold, { metalness: 0.35, roughness: 0.25 })} /></mesh>
          {[0.081, -0.081].map((z) => (
            <mesh key={z} position={[0, 0, z]} rotation={[0, z < 0 ? Math.PI : 0, 0]}>
              <circleGeometry args={[0.5, 48]} /><meshPhysicalMaterial {...gloss("#ffffff", { metalness: 0.2 })} map={coinTex()} />
            </mesh>
          ))}
        </group>
      );
  }
}

const COLLIDER = { shield: "hull", coin: "hull" };

function Piece({ kind, position, rotation, register, onGrab }) {
  const ref = useRef();
  useEffect(() => register(ref, kind), [register, kind]);
  return (
    <RigidBody ref={ref} position={position} rotation={rotation} colliders={COLLIDER[kind] || "cuboid"}
      restitution={0.35} friction={0.7} linearDamping={0.5} angularDamping={0.6} ccd
      enabledTranslations={[true, true, false]} enabledRotations={[false, false, true]}>
      <group
        onPointerDown={(e) => onGrab(e, ref, kind)}
        onPointerOver={() => { document.body.style.cursor = "grab"; }}
        onPointerOut={() => { document.body.style.cursor = ""; }}
      >
        <PieceMesh kind={kind} />
      </group>
    </RigidBody>
  );
}

/* ---------- Guardian, the robot ---------- */
const IDLE_EYE = new THREE.Color(C.angel);
const MOOD_COLOR = {
  idle: IDLE_EYE,
  allow: new THREE.Color(VERDICT_COLOR.allow),
  ask: new THREE.Color(VERDICT_COLOR.ask),
  block: new THREE.Color(VERDICT_COLOR.block),
};
// Where the hands go for each mood: [x, y, z, tilt]
const HANDS = {
  idle: [[-1.38, -0.78, 0.1, 0.25], [1.38, -0.78, 0.1, -0.25]],
  allow: [[-1.6, -0.05, 0.2, 0.75], [1.6, -0.05, 0.2, -0.75]],
  ask: [[-1.38, -0.8, 0.1, 0.25], [1.5, 0.4, 0.45, -0.2]],
  block: [[-0.42, -0.95, 0.95, -0.7], [0.42, -0.95, 1.0, 0.7]],
};

// Rim light so the head glows at the edges, like the Iris robot
function rimMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: 2.6 }, uStrength: { value: 0.9 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uPower; uniform float uStrength;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), uPower);
        gl_FragColor = vec4(uColor * f * uStrength, f * uStrength);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

function Glow({ color, size = 1, opacity = 0.8, ...props }) {
  return (
    <sprite scale={[size, size, 1]} raycast={() => null} {...props}>
      <spriteMaterial map={glowTex()} color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

// Moves a kinematic collider to follow part of the robot, so pieces bounce off it
function Follower({ target, radius }) {
  const body = useRef();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!body.current || !target.current) return;
    target.current.getWorldPosition(v);
    body.current.setNextKinematicTranslation({ x: v.x, y: v.y, z: 0 });
  });
  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[0, -40, 0]}>
      <BallCollider args={[radius]} restitution={0.5} friction={0} />
    </RigidBody>
  );
}

function Eye({ side, mats, pupil }) {
  // Four faces share one spot; only the one for the current mood is shown.
  return (
    <group position={[side * 0.36, 0.02, 0.73]}>
      <group name="idle">
        <mesh material={mats.eye}><torusGeometry args={[0.17, 0.036, 16, 48]} /></mesh>
        <mesh ref={pupil} material={mats.eye} position={[0, 0, 0.01]}><circleGeometry args={[0.085, 32]} /></mesh>
      </group>
      <group name="allow" visible={false}>
        <mesh material={mats.eye} position={[0, -0.05, 0]}><torusGeometry args={[0.15, 0.045, 16, 48, Math.PI]} /></mesh>
      </group>
      <group name="ask" visible={false}>
        <mesh material={mats.eye}><capsuleGeometry args={[0.065, 0.26, 8, 16]} /></mesh>
      </group>
      <group name="block" visible={false}>
        <mesh material={mats.eye} rotation={[0, 0, Math.PI / 2 + side * 0.42]}><capsuleGeometry args={[0.05, 0.3, 8, 16]} /></mesh>
      </group>
      <Glow color={C.angel} size={0.95} opacity={0.55} position={[0, 0, -0.02]} name="glow" />
    </group>
  );
}

function Robot({ position, scale, mood, focus, drag, poke, onPoke }) {
  const root = useRef();
  const head = useRef();
  const eyes = useRef();
  const pupils = [useRef(), useRef()];
  const hands = [useRef(), useRef()];
  const antenna = useRef();
  const glows = useRef([]);

  const mats = useMemo(() => ({
    eye: new THREE.MeshBasicMaterial({ color: IDLE_EYE.clone(), toneMapped: false }),
    rim: rimMaterial(C.angel),
  }), []);
  useEffect(() => () => { mats.eye.dispose(); mats.rim.dispose(); }, [mats]);

  const st = useRef({
    t0: null, pop: 0, popV: 0, lastMove: 0, px: 0, py: 0,
    nextBlink: 2.5, blink: 1, shown: "idle", react: 0,
    look: new THREE.Vector2(), aim: new THREE.Vector2(),
  });

  useFrame(({ clock, pointer, viewport }, dt) => {
    const s = st.current;
    const t = clock.elapsedTime;
    dt = Math.min(dt, 1 / 30);
    if (s.t0 === null) s.t0 = t;
    const age = t - s.t0;

    // Intro pop: a springy scale-in
    if (age > 0.25) {
      s.popV += ((1 - s.pop) * 140 - s.popV * 11) * dt;
      s.pop += s.popV * dt;
    }
    const pk = poke.current ? Math.max(0, 1 - (t - poke.current) / 0.6) : 0;
    root.current.scale.setScalar(scale * Math.max(0, s.pop) * (1 + Math.sin(pk * Math.PI) * 0.08));

    // Who Guardian looks at: a piece you're holding or just picked, else your cursor, else it looks around
    const hx = position[0], hy = position[1];
    if (Math.abs(pointer.x - s.px) + Math.abs(pointer.y - s.py) > 0.002) { s.lastMove = t; s.px = pointer.x; s.py = pointer.y; }
    let tx, ty;
    const target = drag.current?.ref.current || (focus.current && focus.current.until > t ? focus.current.ref.current : null);
    if (target) {
      const p = target.translation(); tx = p.x; ty = p.y;
    } else if (t - s.lastMove < 3.5) {
      tx = (pointer.x * viewport.width) / 2; ty = (pointer.y * viewport.height) / 2;
    } else {
      tx = hx + Math.sin(t * 0.55) * 3; ty = hy + Math.sin(t * 0.83) * 1.1;
    }
    const yaw = THREE.MathUtils.clamp(Math.atan2(tx - hx, 5), -0.62, 0.62);
    const pitch = THREE.MathUtils.clamp(-Math.atan2(ty - hy, 5), -0.42, 0.42);
    s.aim.set(yaw, pitch);
    s.look.lerp(s.aim, 1 - Math.exp(-dt * 7));
    const bob = Math.sin(t * 1.3) * 0.06;
    head.current.rotation.set(s.look.y, s.look.x, -s.look.x * 0.12);
    head.current.position.y = bob;

    // Face: swap shapes when the mood changes, with a little pop
    const m = mood || "idle";
    if (m !== s.shown) { s.shown = m; s.react = t; }
    mats.eye.color.lerp(MOOD_COLOR[m], 1 - Math.exp(-dt * 10));
    eyes.current.children.forEach((eye) => eye.children.forEach((g) => {
      if (g.name === "glow") g.material.color.copy(mats.eye.color);
      else g.visible = g.name === m;
    }));
    glows.current.forEach((g) => g && g.material.color.copy(mats.eye.color));
    mats.rim.uniforms.uColor.value.copy(mats.eye.color).lerp(IDLE_EYE, 0.5);

    // Blink every 2.5 to 6 seconds (only with round eyes)
    if (age > s.nextBlink) { s.blink = 0; s.nextBlink = age + 2.5 + Math.random() * 3.5; }
    s.blink = Math.min(1, s.blink + dt * 9);
    const blinkY = m === "idle" ? Math.max(0.08, Math.abs(Math.cos(s.blink * Math.PI))) : 1;
    const react = Math.max(0, 1 - (t - s.react) / 0.35);
    eyes.current.scale.set(1 + react * 0.25, blinkY * (1 + react * 0.25), 1);

    // Pupils lean toward what it's looking at
    pupils.forEach((p) => p.current && p.current.position.set((s.look.x / 0.62) * 0.06, (-s.look.y / 0.42) * 0.05, 0.01));

    // Hands float, and move into a pose for each verdict
    const pose = HANDS[pk > 0 ? "allow" : m];
    hands.forEach((h, i) => {
      const [x, y, z, r] = pose[i];
      const k = 1 - Math.exp(-dt * 8);
      const g = h.current;
      g.position.x += (x - g.position.x) * k;
      g.position.y += (y + Math.sin(t * 1.6 + i * 1.7) * 0.08 + bob * 0.5 - g.position.y) * k;
      g.position.z += (z - g.position.z) * k;
      g.rotation.z += (r - g.rotation.z) * k;
    });

    // Antenna sways a little
    antenna.current.rotation.z = Math.sin(t * 2.1) * 0.08 - s.look.x * 0.15;
  });

  return (
    <>
    {/* colliders live outside the scaled group so physics sizes stay right */}
    <Follower target={head} radius={1.0 * scale} />
    <Follower target={hands[0]} radius={0.28 * scale} />
    <Follower target={hands[1]} radius={0.28 * scale} />
    <group ref={root} position={position} scale={0.001}
      onPointerDown={(e) => { e.stopPropagation(); onPoke(); }}
      onPointerOver={() => { document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { document.body.style.cursor = ""; }}>
      {/* soft halo behind, glow on the floor */}
      <Glow color={C.blueberry} size={5.2} opacity={0.5} position={[0, 0.1, -1.4]} />

      <group ref={head}>
        {/* the head is the pause tile, turned into a face */}
        <RoundedBox args={[1.9, 1.62, 1.3]} radius={0.52} smoothness={8}>
          <meshPhysicalMaterial {...gloss(C.tang, { clearcoatRoughness: 0.05 })} />
        </RoundedBox>
        <RoundedBox args={[1.94, 1.66, 1.34]} radius={0.54} smoothness={8} material={mats.rim} />
        {/* glass visor */}
        <RoundedBox args={[1.5, 0.98, 0.2]} radius={0.3} smoothness={6} position={[0, 0.02, 0.6]}>
          <meshPhysicalMaterial color="#121014" roughness={0.06} metalness={0.4} clearcoat={1} clearcoatRoughness={0.02} />
        </RoundedBox>
        <group ref={eyes}>
          <Eye side={-1} mats={mats} pupil={pupils[0]} />
          <Eye side={1} mats={mats} pupil={pupils[1]} />
        </group>
        {/* ear pods */}
        {[-1, 1].map((sd) => (
          <group key={sd} position={[sd * 0.98, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <mesh><cylinderGeometry args={[0.24, 0.24, 0.16, 32]} /><meshPhysicalMaterial {...gloss(C.sea)} /></mesh>
            <mesh position={[0, sd * 0.085, 0]} rotation={[0, 0, 0]}><torusGeometry args={[0.15, 0.025, 12, 32]} /><primitive object={mats.eye} attach="material" /></mesh>
          </group>
        ))}
        {/* antenna */}
        <group ref={antenna} position={[0, 0.8, 0]}>
          <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.03, 0.04, 0.4, 12]} /><meshPhysicalMaterial {...gloss(C.sea)} /></mesh>
          <mesh position={[0, 0.46, 0]}><sphereGeometry args={[0.11, 24, 24]} /><primitive object={mats.eye} attach="material" /></mesh>
          <Glow color={C.angel} size={0.9} opacity={0.7} position={[0, 0.46, 0]} ref={(el) => { glows.current[0] = el; }} />
        </group>
      </group>

      {/* collar */}
      <mesh position={[0, -1.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.42, 0.09, 20, 48]} />
        <meshPhysicalMaterial {...gloss(C.blueberry)} />
      </mesh>
      <Glow color={C.angel} size={1.6} opacity={0.35} position={[0, -1.02, 0.2]} ref={(el) => { glows.current[1] = el; }} />

      {/* floating hands */}
      {hands.map((h, i) => (
        <group key={i} ref={h} position={HANDS.idle[i].slice(0, 3)}>
          <mesh><capsuleGeometry args={[0.2, 0.3, 10, 24]} /><meshPhysicalMaterial {...gloss(C.marsh)} /></mesh>
          <mesh position={[0, -0.22, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.2, 0.05, 12, 32]} /><meshPhysicalMaterial {...gloss(C.blueberry)} /></mesh>
        </group>
      ))}
    </group>
    </>
  );
}

/* ---------- scene parts ---------- */
function Bounds({ left, right, floor }) {
  return (
    <RigidBody type="fixed" colliders={false} key={`${left}-${right}-${floor}`}>
      <CuboidCollider args={[40, 0.5, 4]} position={[0, floor - 0.5, 0]} />
      <CuboidCollider args={[0.5, 40, 4]} position={[left - 0.5, 0, 0]} />
      <CuboidCollider args={[0.5, 40, 4]} position={[right + 0.5, 0, 0]} />
      <CuboidCollider args={[40, 40, 0.5]} position={[0, 0, -1.7]} />
      <CuboidCollider args={[40, 40, 0.5]} position={[0, 0, 1.7]} />
    </RigidBody>
  );
}

function PointerBall({ drag, inside }) {
  const ref = useRef();
  useFrame(({ pointer, viewport }) => {
    const b = ref.current;
    if (!b) return;
    const target = { x: (pointer.x * viewport.width) / 2, y: (pointer.y * viewport.height) / 2, z: 0 };
    const active = inside.current && !drag.current;
    if (b.isEnabled() !== active) {
      if (active) b.setTranslation(target, true);
      b.setEnabled(active);
    }
    if (active) b.setNextKinematicTranslation(target);
  });
  return (
    <RigidBody ref={ref} type="kinematicPosition" colliders={false} position={[0, -40, 0]}>
      <BallCollider args={[0.45]} />
    </RigidBody>
  );
}

function Dragger({ drag }) {
  useFrame(({ pointer, viewport }) => {
    const d = drag.current;
    const b = d?.ref.current;
    if (!b) return;
    const p = b.translation();
    const vx = ((pointer.x * viewport.width) / 2 - p.x) * 12;
    const vy = ((pointer.y * viewport.height) / 2 - p.y) * 12;
    const mag = Math.hypot(vx, vy);
    const k = mag > 22 ? 22 / mag : 1;
    b.setLinvel({ x: vx * k, y: vy * k, z: -p.z * 4 }, true);
    const a = b.angvel();
    b.setAngvel({ x: a.x * 0.9, y: a.y * 0.9, z: a.z * 0.9 }, true);
  });
  return null;
}

function Scene({ small, seed, register, onGrab, drag, inside, mood, focus, poke, onPoke }) {
  const { viewport, size } = useThree();
  const w = viewport.width, h = viewport.height;
  const wide = size.width >= 900;
  const ppu = size.height / h;                       // pixels per world unit
  const left = wide ? -w / 2 + w * 0.5 : -w / 2 + 0.2;
  const right = w / 2 - 0.2;
  const floor = wide ? -h / 2 + h * 0.15 : -h / 2 + 0.1;
  // On wide screens, leave room on the right for the verdict card
  const robotX = wide ? Math.max(left + 1.4, right - 360 / ppu - 1.05) : 0;
  const robotY = wide ? 0.25 : 0.55;
  const robotScale = wide ? 1 : 0.85;
  const bounds = useRef({ left, right, h });
  bounds.current = { left, right, h };

  const list = useMemo(() => {
    const { left: l, right: r, h: hh } = bounds.current;
    return spawnList(small).map((kind, i) => ({
      kind, key: `${seed}-${i}`,
      pos: [l + 0.8 + Math.random() * Math.max(0.5, r - l - 1.6), hh / 2 + 1.4 + i * 0.8, ((i % 3) - 1) * 0.45],
      rot: [0, 0, (Math.random() - 0.5) * 1.6],
    }));
  }, [seed, small]);

  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 8, 6]} intensity={1.3} />
      <directionalLight position={[-6, 2, 3]} intensity={0.5} color={C.angel} />
      <Environment resolution={256}>
        <group rotation={[-Math.PI / 3, 0, 0]}>
          <Lightformer form="circle" intensity={4} rotation-x={Math.PI / 2} position={[0, 5, -9]} scale={2} />
          <Lightformer form="circle" intensity={2} color={C.roseSoft} rotation-y={Math.PI / 2} position={[-5, 1, -1]} scale={2} />
          <Lightformer form="ring" color={C.sonic} intensity={5} rotation-y={Math.PI / 2} position={[-5, -1, -1]} scale={4} />
          <Lightformer form="rect" color={C.angel} intensity={2} rotation-y={-Math.PI / 2} position={[10, 1, 0]} scale={[20, 1, 1]} />
        </group>
      </Environment>
      <Bounds left={left} right={right} floor={floor} />
      <PointerBall drag={drag} inside={inside} />
      <Dragger drag={drag} />
      <Robot position={[robotX, robotY, 0]} scale={robotScale} mood={mood} focus={focus} drag={drag} poke={poke} onPoke={onPoke} />
      <Glow color={C.blueberry} size={6} opacity={0.35} position={[robotX, floor + 0.05, -1.2]} />
      {list.map((p) => (
        <Piece key={p.key} kind={p.kind} position={p.pos} rotation={p.rot} register={register} onGrab={onGrab} />
      ))}
      <ContactShadows position={[(left + right) / 2, floor + 0.01, 0]} scale={[right - left + 2, 4]} opacity={0.6} blur={2.4} far={3} color="#000000" />
    </>
  );
}

export default function Hero3D({ small = false, paused = false, controls, onSelect, mood = null }) {
  const [seed, setSeed] = useState(0);
  const bodies = useRef([]);
  const drag = useRef(null);
  const inside = useRef(false);
  const focus = useRef(null);
  const poke = useRef(0);
  const clock = useRef(null);
  const now = () => (clock.current ? clock.current.elapsedTime : 0);

  const register = useCallback((ref, kind) => {
    const entry = { ref, kind };
    bodies.current.push(entry);
    return () => { bodies.current = bodies.current.filter((b) => b !== entry); };
  }, []);

  const onGrab = useCallback((e, ref, kind) => {
    e.stopPropagation();
    drag.current = { ref, kind, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, moved: false };
    document.body.style.cursor = "grabbing";
  }, []);

  useEffect(() => {
    const move = (e) => {
      const d = drag.current;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.moved = true;
    };
    const up = () => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved) {
        focus.current = { ref: d.ref, until: now() + 2.5 };
        onSelect?.(d.kind);
      }
      drag.current = null;
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [onSelect]);

  const kick = (filter) => {
    let first = null;
    bodies.current.forEach(({ ref, kind }) => {
      const b = ref.current;
      if (!b || (filter && kind !== filter)) return;
      if (!first) first = ref;
      const m = b.mass();
      b.wakeUp();
      b.applyImpulse({ x: (Math.random() - 0.5) * 3 * m, y: (filter ? 9 : 6 + Math.random() * 4) * m, z: 0 }, true);
      b.applyTorqueImpulse({ x: 0, y: 0, z: (Math.random() - 0.5) * 0.6 * m }, true);
    });
    if (filter && first) focus.current = { ref: first, until: now() + 2 };
  };

  useImperativeHandle(controls, () => ({
    shake: () => kick(null),
    jump: (kind) => kick(kind),
    reset: () => { bodies.current = []; focus.current = null; setSeed((s) => s + 1); },
  }));

  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 12], fov: 32 }}
      frameloop={paused ? "demand" : "always"}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={(state) => {
        clock.current = state.clock;
        state.gl.toneMapping = THREE.NeutralToneMapping;   // keeps tangerine and the Pantone colours true
      }}
      onPointerEnter={() => { inside.current = true; }}
      onPointerLeave={() => { inside.current = false; }}
      aria-hidden="true"
    >
      <Physics gravity={[0, -12, 0]} paused={paused}>
        <Scene small={small} seed={seed} register={register} onGrab={onGrab} drag={drag} inside={inside}
          mood={mood} focus={focus} poke={poke} onPoke={() => { poke.current = now(); }} />
      </Physics>
    </Canvas>
  );
}