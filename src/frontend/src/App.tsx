import { PointerLockControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useActor } from "./hooks/useActor";

// =====================
// Types
// =====================
type GamePhase =
  | "start"
  | "playing"
  | "death"
  | "gameover"
  | "victory"
  | "characters";

interface GameState {
  phase: GamePhase;
  daysLeft: number;
  itemsCollected: number;
  gateUnlocked: boolean;
}

interface TouchMove {
  x: number;
  z: number;
}

// =====================
// Constants
// =====================
const TOTAL_ITEMS = 4;
const PLAYER_HEIGHT = 1.7;
const PLAYER_SPEED = 5;
const GHOST_DEATH_RADIUS = 1.8;
const ROOM_HEIGHT = 4;
const LOOK_SENSITIVITY = 0.003;

// Item positions
const ITEM_POSITIONS: { id: string; pos: [number, number, number] }[] = [
  { id: "item-n-west", pos: [-8, 1.2, -8] },
  { id: "item-n-east", pos: [8, 1.2, -8] },
  { id: "item-s-west", pos: [-8, 1.2, 8] },
  { id: "item-center", pos: [4, 1.2, 2] },
];

const GATE_POS: [number, number, number] = [0, 0, -18];

// World bounds for minimap
const MAP_X_MIN = -12;
const MAP_X_MAX = 12;
const MAP_Z_MIN = -20;
const MAP_Z_MAX = 15;

// =====================
// Mobile detection (stable, not reactive)
// =====================
const IS_TOUCH_DEVICE =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || navigator.maxTouchPoints > 0);

// =====================
// Wall definitions
// =====================
interface WallDef {
  id: string;
  pos: [number, number, number];
  size: [number, number, number];
}

const WALLS: WallDef[] = [
  {
    id: "wall-north",
    pos: [0, ROOM_HEIGHT / 2, -20],
    size: [24, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-south",
    pos: [0, ROOM_HEIGHT / 2, 15],
    size: [24, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-west",
    pos: [-12, ROOM_HEIGHT / 2, -2.5],
    size: [0.5, ROOM_HEIGHT, 35],
  },
  {
    id: "wall-east",
    pos: [12, ROOM_HEIGHT / 2, -2.5],
    size: [0.5, ROOM_HEIGHT, 35],
  },
  {
    id: "wall-div-mid-left",
    pos: [-8, ROOM_HEIGHT / 2, -5],
    size: [8, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-div-mid-right",
    pos: [8, ROOM_HEIGHT / 2, -5],
    size: [8, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-div-s-left",
    pos: [-8, ROOM_HEIGHT / 2, 5],
    size: [8, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-div-s-right",
    pos: [8, ROOM_HEIGHT / 2, 5],
    size: [8, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-corr-l",
    pos: [-4, ROOM_HEIGHT / 2, 0],
    size: [0.5, ROOM_HEIGHT, 10],
  },
  {
    id: "wall-corr-r",
    pos: [4, ROOM_HEIGHT / 2, 0],
    size: [0.5, ROOM_HEIGHT, 10],
  },
  {
    id: "wall-north-l",
    pos: [-2, ROOM_HEIGHT / 2, -12],
    size: [0.5, ROOM_HEIGHT, 16],
  },
  {
    id: "wall-north-r",
    pos: [2, ROOM_HEIGHT / 2, -12],
    size: [0.5, ROOM_HEIGHT, 16],
  },
];

// =====================
// House Component
// =====================
function HouseGeometry({ gateUnlocked }: { gateUnlocked: boolean }) {
  const gateColor = gateUnlocked ? "#00ff88" : "#cc2200";
  const gateEmissive = gateUnlocked ? "#00aa44" : "#880000";

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, -2.5]}
        receiveShadow
      >
        <planeGeometry args={[24, 35]} />
        <meshStandardMaterial color="#1a1008" roughness={1} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ROOM_HEIGHT, -2.5]}>
        <planeGeometry args={[24, 35]} />
        <meshStandardMaterial color="#0d0a08" roughness={1} />
      </mesh>
      {WALLS.map((w) => (
        <mesh key={w.id} position={w.pos} castShadow receiveShadow>
          <boxGeometry args={w.size} />
          <meshStandardMaterial color="#1c1410" roughness={0.9} />
        </mesh>
      ))}
      <group position={GATE_POS}>
        <mesh>
          <boxGeometry args={[3, 3.5, 0.2]} />
          <meshStandardMaterial
            color={gateColor}
            emissive={gateEmissive}
            emissiveIntensity={1.5}
            transparent
            opacity={0.85}
          />
        </mesh>
        <pointLight color={gateColor} intensity={3} distance={8} />
      </group>
      <mesh position={[-9, 0.5, -10]} castShadow>
        <boxGeometry args={[1.5, 1, 1.5]} />
        <meshStandardMaterial color="#1a1008" roughness={1} />
      </mesh>
      <mesh position={[9, 0.75, -12]} castShadow>
        <boxGeometry args={[1.2, 1.5, 0.8]} />
        <meshStandardMaterial color="#100c08" roughness={1} />
      </mesh>
      <mesh position={[-9, 0.4, 10]} castShadow>
        <boxGeometry args={[2, 0.8, 1]} />
        <meshStandardMaterial color="#120e08" roughness={1} />
      </mesh>
    </group>
  );
}

// =====================
// Collectible Items
// =====================
function CollectibleItem({
  position,
  collected,
}: {
  position: [number, number, number];
  collected: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (meshRef.current && !collected) {
      meshRef.current.position.y =
        position[1] + Math.sin(state.clock.elapsedTime * 2) * 0.15;
      meshRef.current.rotation.y += 0.02;
    }
  });

  if (collected) return null;

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[0.25, 16, 16]} />
      <meshStandardMaterial
        color="#ffd700"
        emissive="#ff8800"
        emissiveIntensity={2}
        roughness={0}
        metalness={0.5}
      />
      <pointLight color="#ff8800" intensity={1.5} distance={4} />
    </mesh>
  );
}

// =====================
// Ghost (Nitya)
// =====================
function Ghost({
  playerPos,
  onCatch,
  active,
  ghostPosRef,
}: {
  playerPos: React.MutableRefObject<THREE.Vector3>;
  onCatch: () => void;
  active: boolean;
  ghostPosRef: React.MutableRefObject<THREE.Vector3>;
}) {
  const ghostRef = useRef<THREE.Group>(null);
  const ghostPos = useRef(new THREE.Vector3(-10, 0, -15));
  const catchCooldown = useRef(0);
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    ghostPosRef.current = ghostPos.current;
  }, [ghostPosRef]);

  useFrame((state, delta) => {
    if (!ghostRef.current || !active) return;
    catchCooldown.current = Math.max(0, catchCooldown.current - delta);

    const target = playerPos.current.clone();
    target.y = 0;
    const gp = ghostPos.current;
    const dist = gp.distanceTo(new THREE.Vector3(target.x, 0, target.z));

    const speed = dist > 8 ? 1.5 : dist > 4 ? 2.5 : 2.8;
    const dir = new THREE.Vector3(
      target.x - gp.x,
      0,
      target.z - gp.z,
    ).normalize();
    gp.x += dir.x * speed * delta;
    gp.z += dir.z * speed * delta;

    ghostRef.current.position.set(gp.x, PLAYER_HEIGHT / 2, gp.z);
    ghostRef.current.lookAt(target.x, PLAYER_HEIGHT / 2, target.z);

    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.8 + Math.sin(state.clock.elapsedTime * 5) * 0.3;
    }

    if (dist < GHOST_DEATH_RADIUS && catchCooldown.current <= 0) {
      catchCooldown.current = 2;
      ghostPos.current.set(-10, 0, -15);
      onCatch();
    }
  });

  return (
    <group ref={ghostRef} position={[-10, PLAYER_HEIGHT / 2, -15]}>
      <mesh ref={meshRef}>
        <capsuleGeometry args={[0.4, 1.2, 8, 16]} />
        <meshStandardMaterial
          color="#dde8ff"
          emissive="#aabbff"
          emissiveIntensity={0.8}
          transparent
          opacity={0.75}
          roughness={0}
        />
      </mesh>
      <pointLight
        color="#8899ff"
        intensity={2}
        distance={5}
        position={[0, 0.6, 0.3]}
      />
      <mesh position={[-0.15, 0.55, 0.35]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial
          emissive="#ff2244"
          emissiveIntensity={3}
          color="#ff0000"
        />
      </mesh>
      <mesh position={[0.15, 0.55, 0.35]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial
          emissive="#ff2244"
          emissiveIntensity={3}
          color="#ff0000"
        />
      </mesh>
    </group>
  );
}

// =====================
// Lighting
// =====================
function HouseLighting() {
  const light1 = useRef<THREE.PointLight>(null);
  const light2 = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    if (light1.current) {
      light1.current.intensity =
        1.2 + Math.sin(state.clock.elapsedTime * 7.3) * 0.15;
    }
    if (light2.current) {
      light2.current.intensity =
        0.9 + Math.sin(state.clock.elapsedTime * 5.1 + 1) * 0.12;
    }
  });

  return (
    <>
      <ambientLight intensity={0.08} color="#200818" />
      <pointLight
        ref={light1}
        color="#ff6020"
        intensity={1.2}
        distance={12}
        position={[0, 3, 0]}
      />
      <pointLight
        ref={light2}
        color="#6020a0"
        intensity={0.9}
        distance={15}
        position={[-8, 3, -8]}
      />
      <pointLight
        color="#401808"
        intensity={0.6}
        distance={10}
        position={[8, 3, 8]}
      />
      <pointLight
        color="#301040"
        intensity={0.8}
        distance={12}
        position={[8, 3, -12]}
      />
      <pointLight
        color="#200808"
        intensity={0.5}
        distance={10}
        position={[-8, 3, 10]}
      />
    </>
  );
}

// =====================
// Mobile Camera Controller (inside Canvas)
// =====================
function MobileCameraController({
  yawRef,
  pitchRef,
  active,
}: {
  yawRef: React.MutableRefObject<number>;
  pitchRef: React.MutableRefObject<number>;
  active: boolean;
}) {
  const { camera } = useThree();

  useFrame(() => {
    if (!active) return;
    camera.rotation.order = "YXZ";
    camera.rotation.set(pitchRef.current, yawRef.current, 0);
  });

  return null;
}

// =====================
// Player Controller
// =====================
function PlayerController({
  gameState,
  onItemCollect,
  onEscape,
  playerPosRef,
  collectedItems,
  touchMoveRef,
}: {
  gameState: GameState;
  onItemCollect: (id: string) => void;
  onEscape: () => void;
  playerPosRef: React.MutableRefObject<THREE.Vector3>;
  collectedItems: Set<string>;
  touchMoveRef: React.MutableRefObject<TouchMove>;
}) {
  const { camera } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const localCollectedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    if (gameState.phase === "playing" && gameState.itemsCollected === 0) {
      localCollectedIds.current.clear();
    }
  }, [gameState.phase, gameState.itemsCollected]);

  useEffect(() => {
    if (gameState.phase === "playing") {
      camera.position.set(0, PLAYER_HEIGHT, 10);
      playerPosRef.current.set(0, PLAYER_HEIGHT, 10);
    }
  }, [gameState.phase, camera, playerPosRef]);

  useFrame((_, delta) => {
    if (gameState.phase !== "playing") return;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0));

    const move = new THREE.Vector3();

    // Keyboard input
    if (keys.current.KeyW || keys.current.ArrowUp) move.add(forward);
    if (keys.current.KeyS || keys.current.ArrowDown) move.sub(forward);
    if (keys.current.KeyA || keys.current.ArrowLeft) move.sub(right);
    if (keys.current.KeyD || keys.current.ArrowRight) move.add(right);

    // Touch joystick input
    const tm = touchMoveRef.current;
    if (tm.x !== 0 || tm.z !== 0) {
      const tf = forward.clone().multiplyScalar(-tm.z);
      const tr = right.clone().multiplyScalar(tm.x);
      move.add(tf).add(tr);
    }

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(PLAYER_SPEED * delta);
      const newPos = camera.position.clone().add(move);
      newPos.x = Math.max(-11.5, Math.min(11.5, newPos.x));
      newPos.z = Math.max(-19.5, Math.min(14.5, newPos.z));
      newPos.y = PLAYER_HEIGHT;

      let blocked = false;
      for (const wall of WALLS) {
        const wx = wall.pos[0];
        const wz = wall.pos[2];
        const ww = wall.size[0] / 2 + 0.4;
        const wd = wall.size[2] / 2 + 0.4;
        if (
          newPos.x > wx - ww &&
          newPos.x < wx + ww &&
          newPos.z > wz - wd &&
          newPos.z < wz + wd
        ) {
          blocked = true;
          break;
        }
      }

      if (!blocked) {
        camera.position.copy(newPos);
        playerPosRef.current.copy(newPos);
      }
    }

    for (const { id, pos } of ITEM_POSITIONS) {
      if (localCollectedIds.current.has(id)) continue;
      if (collectedItems.has(id)) {
        localCollectedIds.current.add(id);
        continue;
      }
      const ip = new THREE.Vector3(...pos);
      if (camera.position.distanceTo(ip) < 1.5) {
        localCollectedIds.current.add(id);
        onItemCollect(id);
      }
    }

    if (gameState.gateUnlocked) {
      const gp = new THREE.Vector3(...GATE_POS);
      gp.y = PLAYER_HEIGHT;
      if (camera.position.distanceTo(gp) < 2.5) {
        onEscape();
      }
    }
  });

  return null;
}

// =====================
// Scene
// =====================
function Scene({
  gameState,
  onItemCollect,
  onCatch,
  onEscape,
  playerPosRef,
  ghostPosRef,
  collectedItems,
  touchMoveRef,
  touchYawRef,
  touchPitchRef,
}: {
  gameState: GameState;
  onItemCollect: (id: string) => void;
  onCatch: () => void;
  onEscape: () => void;
  playerPosRef: React.MutableRefObject<THREE.Vector3>;
  ghostPosRef: React.MutableRefObject<THREE.Vector3>;
  collectedItems: Set<string>;
  touchMoveRef: React.MutableRefObject<TouchMove>;
  touchYawRef: React.MutableRefObject<number>;
  touchPitchRef: React.MutableRefObject<number>;
}) {
  return (
    <>
      <fog attach="fog" args={["#050208", 5, 28]} />
      <HouseLighting />
      <HouseGeometry gateUnlocked={gameState.gateUnlocked} />
      {ITEM_POSITIONS.map(({ id, pos }) => (
        <CollectibleItem
          key={id}
          position={pos}
          collected={collectedItems.has(id)}
        />
      ))}
      <Ghost
        playerPos={playerPosRef}
        onCatch={onCatch}
        active={gameState.phase === "playing"}
        ghostPosRef={ghostPosRef}
      />
      <PlayerController
        gameState={gameState}
        onItemCollect={onItemCollect}
        onEscape={onEscape}
        playerPosRef={playerPosRef}
        collectedItems={collectedItems}
        touchMoveRef={touchMoveRef}
      />
      {IS_TOUCH_DEVICE ? (
        <MobileCameraController
          yawRef={touchYawRef}
          pitchRef={touchPitchRef}
          active={gameState.phase === "playing"}
        />
      ) : (
        <PointerLockControls />
      )}
    </>
  );
}

// =====================
// Minimap
// =====================
function Minimap({
  playerPosRef,
  ghostPosRef,
  collectedItems,
  gameState,
}: {
  playerPosRef: React.MutableRefObject<THREE.Vector3>;
  ghostPosRef: React.MutableRefObject<THREE.Vector3>;
  collectedItems: Set<string>;
  gameState: GameState;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (gameState.phase !== "playing") return;

    const SIZE = 120;
    const mapW = MAP_X_MAX - MAP_X_MIN;
    const mapH = MAP_Z_MAX - MAP_Z_MIN;

    function worldToCanvas(x: number, z: number): [number, number] {
      const cx = ((x - MAP_X_MIN) / mapW) * SIZE;
      const cy = ((z - MAP_Z_MIN) / mapH) * SIZE;
      return [cx, cy];
    }

    let rafId: number;
    function draw() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = "rgba(5, 2, 8, 0.75)";
      ctx.fillRect(0, 0, SIZE, SIZE);

      ctx.strokeStyle = "rgba(180, 140, 100, 0.6)";
      ctx.lineWidth = 1;
      for (const wall of WALLS) {
        const wx = wall.pos[0];
        const wz = wall.pos[2];
        const hw = wall.size[0] / 2;
        const hd = wall.size[2] / 2;
        const [x1, y1] = worldToCanvas(wx - hw, wz - hd);
        const [x2, y2] = worldToCanvas(wx + hw, wz + hd);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      }

      const [bx1, by1] = worldToCanvas(MAP_X_MIN, MAP_Z_MIN);
      const [bx2, by2] = worldToCanvas(MAP_X_MAX, MAP_Z_MAX);
      ctx.strokeStyle = "rgba(200, 150, 100, 0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);

      const [gx, gy] = worldToCanvas(GATE_POS[0], GATE_POS[2]);
      ctx.fillStyle = "#00ff88";
      ctx.beginPath();
      ctx.arc(gx, gy, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffd700";
      for (const { id, pos } of ITEM_POSITIONS) {
        if (collectedItems.has(id)) continue;
        const [ix, iy] = worldToCanvas(pos[0], pos[2]);
        ctx.beginPath();
        ctx.arc(ix, iy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      const gPos = ghostPosRef.current;
      if (gPos) {
        const [rx, ry] = worldToCanvas(gPos.x, gPos.z);
        ctx.fillStyle = "#ff4466";
        ctx.beginPath();
        ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      const pPos = playerPosRef.current;
      const [px, py] = worldToCanvas(pPos.x, pPos.z);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [gameState.phase, collectedItems, playerPosRef, ghostPosRef]);

  if (gameState.phase !== "playing") return null;

  // On mobile, push minimap higher to make room for joystick
  const bottomOffset = IS_TOUCH_DEVICE ? 210 : 40;

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={120}
      style={{
        position: "absolute",
        bottom: bottomOffset,
        left: 16,
        width: 120,
        height: 120,
        border: "1px solid rgba(200,150,100,0.35)",
        borderRadius: 4,
        zIndex: 10,
        pointerEvents: "none",
        imageRendering: "pixelated",
      }}
    />
  );
}

// =====================
// Virtual Joystick
// =====================
function VirtualJoystick({
  touchMoveRef,
  visible,
}: {
  touchMoveRef: React.MutableRefObject<TouchMove>;
  visible: boolean;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const activeTouchId = useRef<number | null>(null);
  const centerRef = useRef({ x: 0, y: 0 });
  const [labelVisible, setLabelVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLabelVisible(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const outer = outerRef.current;
    if (!outer) return;

    const OUTER_RADIUS = 60; // px
    const KNOB_RADIUS = 22; // px

    function getCenter() {
      const rect = outer!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function onTouchStart(e: TouchEvent) {
      e.preventDefault();
      if (activeTouchId.current !== null) return;
      const touch = e.changedTouches[0];
      activeTouchId.current = touch.identifier;
      centerRef.current = getCenter();
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      if (activeTouchId.current === null) return;
      let touch: Touch | null = null;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId.current) {
          touch = e.changedTouches[i];
          break;
        }
      }
      if (!touch) return;

      const dx = touch.clientX - centerRef.current.x;
      const dy = touch.clientY - centerRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const clampDist = Math.min(dist, OUTER_RADIUS - KNOB_RADIUS);
      const angle = Math.atan2(dy, dx);
      const kx = Math.cos(angle) * clampDist;
      const ky = Math.sin(angle) * clampDist;

      if (knobRef.current) {
        knobRef.current.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
      }

      const norm = dist > 5 ? clampDist / (OUTER_RADIUS - KNOB_RADIUS) : 0;
      touchMoveRef.current = {
        x: norm * Math.cos(angle),
        z: norm * Math.sin(angle),
      };
    }

    function onTouchEnd(e: TouchEvent) {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId.current) {
          activeTouchId.current = null;
          break;
        }
      }
      if (activeTouchId.current === null) {
        if (knobRef.current) {
          knobRef.current.style.transform = "translate(-50%, -50%)";
        }
        touchMoveRef.current = { x: 0, z: 0 };
      }
    }

    outer.addEventListener("touchstart", onTouchStart, { passive: false });
    outer.addEventListener("touchmove", onTouchMove, { passive: false });
    outer.addEventListener("touchend", onTouchEnd, { passive: false });
    outer.addEventListener("touchcancel", onTouchEnd, { passive: false });

    return () => {
      outer.removeEventListener("touchstart", onTouchStart);
      outer.removeEventListener("touchmove", onTouchMove);
      outer.removeEventListener("touchend", onTouchEnd);
      outer.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [visible, touchMoveRef]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 60,
        left: 20,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        pointerEvents: "none",
      }}
    >
      <div
        ref={outerRef}
        style={{
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: "rgba(0,0,0,0.3)",
          border: "2px solid rgba(255,255,255,0.15)",
          position: "relative",
          pointerEvents: "auto",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <div
          ref={knobRef}
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.6)",
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
            boxShadow: "0 0 12px rgba(255,200,100,0.4)",
          }}
        />
      </div>
      <div
        style={{
          fontSize: "0.6rem",
          letterSpacing: "0.2em",
          color: "rgba(255,255,255,0.35)",
          opacity: labelVisible ? 1 : 0,
          transition: "opacity 0.8s ease",
          pointerEvents: "none",
        }}
      >
        MOVE
      </div>
    </div>
  );
}

// =====================
// Touch Look Zone
// =====================
function TouchLookZone({
  yawRef,
  pitchRef,
  visible,
}: {
  yawRef: React.MutableRefObject<number>;
  pitchRef: React.MutableRefObject<number>;
  visible: boolean;
}) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);
  const activeTouchId = useRef<number | null>(null);
  const [hintVisible, setHintVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setHintVisible(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const zone = zoneRef.current;
    if (!zone) return;

    const MAX_PITCH = (85 * Math.PI) / 180;

    function onTouchStart(e: TouchEvent) {
      e.preventDefault();
      if (activeTouchId.current !== null) return;
      const touch = e.changedTouches[0];
      activeTouchId.current = touch.identifier;
      lastTouchRef.current = { x: touch.clientX, y: touch.clientY };
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      if (activeTouchId.current === null || !lastTouchRef.current) return;
      let touch: Touch | null = null;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId.current) {
          touch = e.changedTouches[i];
          break;
        }
      }
      if (!touch) return;

      const dx = touch.clientX - lastTouchRef.current.x;
      const dy = touch.clientY - lastTouchRef.current.y;
      lastTouchRef.current = { x: touch.clientX, y: touch.clientY };

      yawRef.current -= dx * LOOK_SENSITIVITY;
      pitchRef.current -= dy * LOOK_SENSITIVITY;
      pitchRef.current = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, pitchRef.current),
      );
    }

    function onTouchEnd(e: TouchEvent) {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId.current) {
          activeTouchId.current = null;
          lastTouchRef.current = null;
          break;
        }
      }
    }

    zone.addEventListener("touchstart", onTouchStart, { passive: false });
    zone.addEventListener("touchmove", onTouchMove, { passive: false });
    zone.addEventListener("touchend", onTouchEnd, { passive: false });
    zone.addEventListener("touchcancel", onTouchEnd, { passive: false });

    return () => {
      zone.removeEventListener("touchstart", onTouchStart);
      zone.removeEventListener("touchmove", onTouchMove);
      zone.removeEventListener("touchend", onTouchEnd);
      zone.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [visible, yawRef, pitchRef]);

  if (!visible) return null;

  return (
    <div
      ref={zoneRef}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: "50%",
        height: "100%",
        zIndex: 15,
        pointerEvents: "auto",
        touchAction: "none",
        userSelect: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          fontSize: "0.6rem",
          letterSpacing: "0.15em",
          color: "rgba(255,255,255,0.2)",
          opacity: hintVisible ? 1 : 0,
          transition: "opacity 0.8s ease",
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
      >
        LOOK →
      </div>
    </div>
  );
}

// =====================
// HUD
// =====================
const CANDLE_KEYS = ["candle-1", "candle-2", "candle-3"];
const RELIC_KEYS = ["relic-1", "relic-2", "relic-3", "relic-4"];

function HUD({
  gameState,
  collectedItems,
}: {
  gameState: GameState;
  collectedItems: Set<string>;
}) {
  if (gameState.phase !== "playing") return null;
  const allCollected = gameState.itemsCollected >= TOTAL_ITEMS;
  const remaining = TOTAL_ITEMS - gameState.itemsCollected;

  return (
    <div className="hud">
      <div className="hud-days">
        <div
          style={{
            fontSize: "0.7rem",
            letterSpacing: "0.2em",
            marginBottom: 4,
            opacity: 0.6,
          }}
        >
          DAYS REMAINING
        </div>
        <div className="candle-row">
          {CANDLE_KEYS.map((key, i) => (
            <span
              key={key}
              className={`skull-icon ${i >= gameState.daysLeft ? "dead" : ""}`}
            >
              🕯️
            </span>
          ))}
        </div>
      </div>
      <div className="hud-items">
        <div
          style={{
            fontSize: "0.7rem",
            letterSpacing: "0.2em",
            marginBottom: 4,
            opacity: 0.6,
          }}
        >
          RELICS FOUND
        </div>
        <div style={{ fontSize: "1.4rem" }}>
          {RELIC_KEYS.map((key, i) => (
            <span
              key={key}
              style={{
                marginLeft: 3,
                filter: collectedItems.has(ITEM_POSITIONS[i]?.id ?? "")
                  ? "drop-shadow(0 0 6px #ff8800)"
                  : "none",
                opacity: collectedItems.has(ITEM_POSITIONS[i]?.id ?? "")
                  ? 1
                  : 0.2,
              }}
            >
              🔮
            </span>
          ))}
        </div>
      </div>
      {!allCollected && (
        <div className="hud-hint">
          {remaining} relic{remaining !== 1 ? "s" : ""} remaining — Explore the
          rooms
        </div>
      )}
      {allCollected && (
        <div className="hud-hint" style={{ color: "rgba(100,255,160,0.85)" }}>
          Gate unlocked — reach it to escape!
        </div>
      )}
      <div className="hud-crosshair" />
    </div>
  );
}

// =====================
// Characters Screen
// =====================
interface CharacterDef {
  name: string;
  role: string;
  lore: string;
  stats: { speed: number; fear: number; power: number };
  accent: string;
  icon: string;
  generated?: boolean;
}

const PRESET_CHARACTERS: CharacterDef[] = [
  {
    name: "Nitya",
    role: "Ghost",
    lore: "She was once a child who played in these very halls, her laughter echoing where now only silence dares. Bound to the house by a sorrow too deep for death to sever, she hunts trespassers with cold, relentless grace. Look into her eyes and you will see your own end.",
    stats: { speed: 78, fear: 95, power: 88 },
    accent: "#c8a8ff",
    icon: "👻",
  },
  {
    name: "The Lost Soul",
    role: "Spirit",
    lore: "Trapped between worlds since a moonless night decades past, it wanders the corridors seeking a way it will never find. It means no harm — yet the cold it carries rots wood and dims lanterns. Cross its path and feel sorrow seep into your bones.",
    stats: { speed: 42, fear: 68, power: 35 },
    accent: "#88ccff",
    icon: "🌫️",
  },
  {
    name: "The Watcher",
    role: "Demon",
    lore: "It does not move. It does not speak. It simply waits in dark corners with eyes that catch no light, observing all who enter without mercy or remorse. Many have felt its gaze and found their courage dissolve like morning frost.",
    stats: { speed: 20, fear: 90, power: 72 },
    accent: "#ff6644",
    icon: "👁️",
  },
  {
    name: "The Player",
    role: "Survivor",
    lore: "You came here by accident — or so you believe. Armed with nothing but wits and a fading will to live, you must navigate Nitya's domain before the last candle gutters. The house does not forgive hesitation. Neither does she.",
    stats: { speed: 60, fear: 15, power: 40 },
    accent: "#88ffcc",
    icon: "🧍",
  },
];

const GEN_NAMES = [
  "Mara",
  "Voss",
  "Elara",
  "Seraph",
  "Dread",
  "Hollow",
  "Cain",
  "Lyra",
  "Mordecai",
  "Vesper",
  "Ashveil",
  "Nocturne",
  "Revenant",
  "Umbra",
  "Corvus",
];
const GEN_ROLES = [
  "Wraith",
  "Poltergeist",
  "Demon",
  "Specter",
  "Banshee",
  "Shadow",
];
const GEN_LORE_OPENERS = [
  "Born in the witching hour of a year no calendar marks,",
  "Once a scholar who sought forbidden knowledge,",
  "Summoned through a ritual gone catastrophically wrong,",
  "A child of plague and ruin,",
  "Fashioned from the grief of a hundred lost souls,",
];
const GEN_LORE_MIDDLES = [
  "it now haunts the spaces between heartbeats.",
  "it feeds on the terror of the living.",
  "it craves the warmth it can never again possess.",
  "it has forgotten what mercy once felt like.",
  "it wanders with purpose only the damned understand.",
];
const GEN_LORE_ENDINGS = [
  "Those who survive the encounter are never quite whole again.",
  "Its whispers can drive the sane to madness in mere moments.",
  "Even Nitya herself gives it a wide berth.",
  "The house seems to breathe harder when it draws near.",
  "No relic can guard against what it carries inside.",
];
const GEN_ACCENTS = [
  "#ff8866",
  "#aa88ff",
  "#66ccff",
  "#ffcc66",
  "#ff66aa",
  "#88ffaa",
];
const GEN_ICONS = ["💀", "🦇", "🕷️", "🩸", "🌑", "⛓️", "🔮", "🕸️"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateCharacter(): CharacterDef {
  return {
    name: pick(GEN_NAMES),
    role: pick(GEN_ROLES),
    lore: `${pick(GEN_LORE_OPENERS)} ${pick(GEN_LORE_MIDDLES)} ${pick(GEN_LORE_ENDINGS)}`,
    stats: {
      speed: 20 + Math.floor(Math.random() * 81),
      fear: 20 + Math.floor(Math.random() * 81),
      power: 20 + Math.floor(Math.random() * 81),
    },
    accent: pick(GEN_ACCENTS),
    icon: pick(GEN_ICONS),
    generated: true,
  };
}

function StatBar({
  label,
  value,
  color,
}: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: "0.4rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.65rem",
          letterSpacing: "0.15em",
          color: "rgba(220,190,170,0.6)",
          marginBottom: "0.2rem",
          textTransform: "uppercase",
        }}
      >
        <span>{label}</span>
        <span style={{ color: "rgba(220,190,170,0.8)" }}>{value}</span>
      </div>
      <div
        style={{
          width: "100%",
          height: 4,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${value}%`,
            height: "100%",
            background: color,
            borderRadius: 2,
            transition: "width 0.6s ease",
          }}
        />
      </div>
    </div>
  );
}

function CharacterCard({ char, index }: { char: CharacterDef; index: number }) {
  return (
    <div
      data-ocid={`characters.item.${index + 1}`}
      style={{
        background: "rgba(8, 3, 14, 0.85)",
        border: `1px solid ${char.accent}33`,
        borderRadius: "4px",
        padding: "1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
        boxShadow: `0 0 24px ${char.accent}18, inset 0 0 30px rgba(0,0,0,0.4)`,
        position: "relative",
        overflow: "hidden",
        animation: char.generated ? "fadeInCard 0.4s ease" : "none",
      }}
    >
      {/* glow corner */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: 60,
          height: 60,
          background: `radial-gradient(circle at top right, ${char.accent}22, transparent 70%)`,
          pointerEvents: "none",
        }}
      />

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ fontSize: "1.8rem", lineHeight: 1 }}>{char.icon}</span>
        <div>
          <div
            style={{
              fontFamily: "Fraunces, serif",
              fontSize: "clamp(1rem, 2.5vw, 1.3rem)",
              fontWeight: 700,
              color: char.accent,
              textShadow: `0 0 12px ${char.accent}88`,
              letterSpacing: "0.03em",
            }}
          >
            {char.name}
          </div>
          <div
            style={{
              display: "inline-block",
              fontSize: "0.6rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(200,150,120,0.7)",
              background: "rgba(200,100,50,0.1)",
              border: "1px solid rgba(200,100,50,0.2)",
              padding: "0.1rem 0.5rem",
              borderRadius: "2px",
              marginTop: "0.15rem",
            }}
          >
            {char.role}
          </div>
        </div>
      </div>

      {/* lore */}
      <p
        style={{
          fontFamily: "Figtree, sans-serif",
          fontSize: "0.75rem",
          color: "rgba(210,185,165,0.65)",
          lineHeight: 1.6,
          letterSpacing: "0.02em",
          margin: 0,
        }}
      >
        {char.lore}
      </p>

      {/* stats */}
      <div style={{ marginTop: "0.25rem" }}>
        <StatBar
          label="Speed"
          value={char.stats.speed}
          color="linear-gradient(to right, #4488ff, #88aaff)"
        />
        <StatBar
          label="Fear"
          value={char.stats.fear}
          color="linear-gradient(to right, #cc2200, #ff6644)"
        />
        <StatBar
          label="Power"
          value={char.stats.power}
          color="linear-gradient(to right, #882299, #cc66ff)"
        />
      </div>

      {char.generated && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            fontSize: "0.55rem",
            letterSpacing: "0.15em",
            color: "rgba(200,150,120,0.5)",
            textTransform: "uppercase",
          }}
        >
          Generated
        </div>
      )}
    </div>
  );
}

function CharactersScreen({ onBack }: { onBack: () => void }) {
  const [generatedChar, setGeneratedChar] = useState<CharacterDef | null>(null);

  const handleGenerate = useCallback(() => {
    setGeneratedChar(generateCharacter());
  }, []);

  const allChars = generatedChar
    ? [...PRESET_CHARACTERS, generatedChar]
    : PRESET_CHARACTERS;

  return (
    <div className="overlay-screen characters-overlay">
      <div
        style={{
          width: "100%",
          maxWidth: 900,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "clamp(1rem, 3vw, 2rem)",
          overflowY: "auto",
          alignItems: "center",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "0.25rem" }}>
          <div
            className="overlay-title flicker-text"
            style={{ fontSize: "clamp(1.8rem, 4vw, 3rem)", marginBottom: 0 }}
          >
            The <span className="nitya-name">Haunted</span>
          </div>
          <div
            style={{
              fontFamily: "Figtree, sans-serif",
              fontSize: "0.7rem",
              letterSpacing: "0.35em",
              color: "rgba(200,150,120,0.45)",
              textTransform: "uppercase",
              marginTop: "0.25rem",
            }}
          >
            Dossier of Souls
          </div>
        </div>

        <div
          className="horror-divider"
          style={{ marginTop: "0.75rem", marginBottom: "1.25rem" }}
        />

        {/* Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "1rem",
            width: "100%",
          }}
        >
          {allChars.map((char, i) => (
            <CharacterCard key={char.name} char={char} index={i} />
          ))}
        </div>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            marginTop: "1.5rem",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <button
            type="button"
            className="horror-btn"
            onClick={handleGenerate}
            data-ocid="characters.primary_button"
          >
            ✦ Generate Character
          </button>
          <button
            type="button"
            className="horror-btn"
            onClick={onBack}
            data-ocid="characters.secondary_button"
            style={{
              borderColor: "rgba(150,100,80,0.35)",
              color: "rgba(200,160,140,0.7)",
            }}
          >
            ← Back
          </button>
        </div>

        <div
          style={{
            marginTop: "1.5rem",
            fontSize: "0.6rem",
            color: "rgba(200,150,120,0.25)",
            letterSpacing: "0.1em",
            textAlign: "center",
          }}
        >
          © {new Date().getFullYear()}. Built with ♥ using{" "}
          <a
            href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
            style={{ color: "rgba(200,150,120,0.35)", pointerEvents: "all" }}
            target="_blank"
            rel="noreferrer"
          >
            caffeine.ai
          </a>
        </div>
      </div>
    </div>
  );
}

// =====================
// Screens
// =====================
function StartScreen({
  onStart,
  onCharacters,
}: { onStart: () => void; onCharacters: () => void }) {
  return (
    <div className="overlay-screen start-overlay">
      <div className="overlay-title flicker-text">
        Nitya's
        <br />
        <span className="nitya-name">Haunted House</span>
      </div>
      <div className="horror-divider" />
      <div className="overlay-subtitle">
        She trapped you.
        <br />
        You have 3 days to escape.
        <br />
        Find the relics. Unlock the gate. Run.
      </div>
      <button
        type="button"
        className="horror-btn"
        onClick={onStart}
        data-ocid="game.primary_button"
      >
        Enter the House
      </button>
      <button
        type="button"
        className="horror-btn"
        onClick={onCharacters}
        data-ocid="game.secondary_button"
        style={{
          marginTop: "0.75rem",
          borderColor: "rgba(180,100,200,0.35)",
          color: "rgba(200,170,240,0.7)",
          fontSize: "0.85rem",
          padding: "0.65rem 2rem",
        }}
      >
        Meet the Characters
      </button>
      <div
        style={{
          marginTop: "1.5rem",
          fontSize: "0.7rem",
          color: "rgba(200,150,120,0.45)",
          letterSpacing: "0.15em",
        }}
      >
        {IS_TOUCH_DEVICE
          ? "Left thumb to move · Right thumb to look"
          : "WASD to move · Mouse to look · Click to lock cursor"}
      </div>
    </div>
  );
}

function DeathScreen({
  daysLeft,
  onContinue,
}: { daysLeft: number; onContinue: () => void }) {
  return (
    <div className="overlay-screen death-overlay">
      <div
        className="overlay-title"
        style={{ fontSize: "clamp(2rem,5vw,3.5rem)" }}
      >
        <span className="nitya-name">Nitya</span> found you...
      </div>
      <div className="horror-divider" />
      <div className="overlay-status">
        {daysLeft} {daysLeft === 1 ? "day" : "days"} remaining
      </div>
      <div className="overlay-subtitle" style={{ marginBottom: "2rem" }}>
        She lets you go... for now.
      </div>
      <button
        type="button"
        className="horror-btn"
        onClick={onContinue}
        data-ocid="game.primary_button"
      >
        Continue
      </button>
    </div>
  );
}

function GameOverScreen({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="overlay-screen gameover-overlay">
      <div className="overlay-title">You couldn't escape</div>
      <div className="horror-divider" />
      <div
        className="overlay-subtitle"
        style={{ color: "rgba(255,100,100,0.8)", marginBottom: "1rem" }}
      >
        <span className="nitya-name">Nitya</span> claimed your soul.
      </div>
      <div style={{ fontSize: "3rem", marginBottom: "2rem" }}>💀</div>
      <button
        type="button"
        className="horror-btn"
        onClick={onRestart}
        data-ocid="game.primary_button"
      >
        Try Again
      </button>
    </div>
  );
}

function VictoryScreen({
  daysLeft,
  onRestart,
}: { daysLeft: number; onRestart: () => void }) {
  return (
    <div className="overlay-screen victory-overlay">
      <div
        className="overlay-title"
        style={{
          color: "#c0ffe0",
          textShadow: "0 0 40px rgba(50,255,150,0.7)",
        }}
      >
        You Escaped!
      </div>
      <div
        className="horror-divider"
        style={{
          background:
            "linear-gradient(to right, transparent, rgba(50,200,100,0.5), transparent)",
        }}
      />
      <div className="overlay-victory-status">
        {daysLeft} {daysLeft === 1 ? "day" : "days"} to spare
      </div>
      <div className="overlay-subtitle">
        You survived <span className="nitya-name">Nitya's</span> haunted house.
        <br />
        Few have made it out alive.
      </div>
      <button
        type="button"
        className="horror-btn horror-btn-success"
        onClick={onRestart}
        data-ocid="game.primary_button"
      >
        Play Again
      </button>
    </div>
  );
}

// =====================
// App
// =====================
export default function App() {
  const { actor } = useActor();
  const playerPosRef = useRef(new THREE.Vector3(0, PLAYER_HEIGHT, 10));
  const ghostPosRef = useRef(new THREE.Vector3(-10, 0, -15));

  // Mobile touch refs
  const touchMoveRef = useRef<TouchMove>({ x: 0, z: 0 });
  const touchYawRef = useRef<number>(0);
  const touchPitchRef = useRef<number>(0);

  const [collectedItems, setCollectedItems] = useState<Set<string>>(new Set());

  const [gameState, setGameState] = useState<GameState>({
    phase: "start",
    daysLeft: 3,
    itemsCollected: 0,
    gateUnlocked: false,
  });

  const handleStart = useCallback(() => {
    setGameState({
      phase: "playing",
      daysLeft: 3,
      itemsCollected: 0,
      gateUnlocked: false,
    });
  }, []);

  const handleShowCharacters = useCallback(() => {
    setGameState((prev) => ({ ...prev, phase: "characters" }));
  }, []);

  const handleBackToStart = useCallback(() => {
    setGameState((prev) => ({ ...prev, phase: "start" }));
  }, []);

  const handleItemCollect = useCallback((_id: string) => {
    setCollectedItems((prev) => new Set([...prev, _id]));
    setGameState((prev) => {
      const next = prev.itemsCollected + 1;
      return {
        ...prev,
        itemsCollected: next,
        gateUnlocked: next >= TOTAL_ITEMS,
      };
    });
  }, []);

  const handleCatch = useCallback(() => {
    setGameState((prev) => {
      const newDays = prev.daysLeft - 1;
      if (newDays <= 0) return { ...prev, daysLeft: 0, phase: "gameover" };
      return { ...prev, daysLeft: newDays, phase: "death" };
    });
  }, []);

  const handleContinue = useCallback(() => {
    setGameState((prev) => ({ ...prev, phase: "playing" }));
  }, []);

  const handleEscape = useCallback(() => {
    setGameState((prev) => {
      if (actor) {
        actor.saveScore("Player", BigInt(prev.daysLeft)).catch(() => {});
      }
      return { ...prev, phase: "victory" };
    });
  }, [actor]);

  const handleRestart = useCallback(() => {
    playerPosRef.current.set(0, PLAYER_HEIGHT, 10);
    ghostPosRef.current.set(-10, 0, -15);
    touchMoveRef.current = { x: 0, z: 0 };
    touchYawRef.current = 0;
    touchPitchRef.current = 0;
    setCollectedItems(new Set());
    setGameState({
      phase: "start",
      daysLeft: 3,
      itemsCollected: 0,
      gateUnlocked: false,
    });
  }, []);

  const isPlaying = gameState.phase === "playing";

  return (
    <div className="game-container">
      <Canvas
        camera={{
          position: [0, PLAYER_HEIGHT, 10],
          fov: 75,
          near: 0.1,
          far: 100,
        }}
        shadows
        gl={{ antialias: true }}
        style={{ background: "#050208" }}
      >
        <Scene
          gameState={gameState}
          onItemCollect={handleItemCollect}
          onCatch={handleCatch}
          onEscape={handleEscape}
          playerPosRef={playerPosRef}
          ghostPosRef={ghostPosRef}
          collectedItems={collectedItems}
          touchMoveRef={touchMoveRef}
          touchYawRef={touchYawRef}
          touchPitchRef={touchPitchRef}
        />
      </Canvas>

      <HUD gameState={gameState} collectedItems={collectedItems} />

      <Minimap
        playerPosRef={playerPosRef}
        ghostPosRef={ghostPosRef}
        collectedItems={collectedItems}
        gameState={gameState}
      />

      {/* Mobile touch controls — only rendered on touch devices during gameplay */}
      {IS_TOUCH_DEVICE && isPlaying && (
        <>
          <VirtualJoystick touchMoveRef={touchMoveRef} visible={true} />
          <TouchLookZone
            yawRef={touchYawRef}
            pitchRef={touchPitchRef}
            visible={true}
          />
        </>
      )}

      {gameState.phase === "start" && (
        <StartScreen
          onStart={handleStart}
          onCharacters={handleShowCharacters}
        />
      )}
      {gameState.phase === "characters" && (
        <CharactersScreen onBack={handleBackToStart} />
      )}
      {gameState.phase === "death" && (
        <DeathScreen
          daysLeft={gameState.daysLeft}
          onContinue={handleContinue}
        />
      )}
      {gameState.phase === "gameover" && (
        <GameOverScreen onRestart={handleRestart} />
      )}
      {gameState.phase === "victory" && (
        <VictoryScreen
          daysLeft={gameState.daysLeft}
          onRestart={handleRestart}
        />
      )}

      <div
        style={{
          position: "absolute",
          bottom: 10,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: "0.6rem",
          color: "rgba(200,150,120,0.3)",
          letterSpacing: "0.1em",
          pointerEvents: "none",
          zIndex: 5,
          whiteSpace: "nowrap",
        }}
      >
        © {new Date().getFullYear()}. Built with ♥ using{" "}
        <a
          href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
          style={{ color: "rgba(200,150,120,0.4)", pointerEvents: "all" }}
          target="_blank"
          rel="noreferrer"
        >
          caffeine.ai
        </a>
      </div>
    </div>
  );
}
