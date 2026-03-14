import { PointerLockControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useActor } from "./hooks/useActor";

// =====================
// Types
// =====================
type GamePhase = "start" | "playing" | "death" | "gameover" | "victory";

interface GameState {
  phase: GamePhase;
  daysLeft: number;
  itemsCollected: number;
  gateUnlocked: boolean;
}

// =====================
// Constants
// =====================
const TOTAL_ITEMS = 4;
const PLAYER_HEIGHT = 1.7;
const PLAYER_SPEED = 5;
const GHOST_DEATH_RADIUS = 1.8;
const ROOM_HEIGHT = 4;

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
    id: "wall-div-mid",
    pos: [0, ROOM_HEIGHT / 2, -5],
    size: [10, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-div-s",
    pos: [0, ROOM_HEIGHT / 2, 5],
    size: [10, ROOM_HEIGHT, 0.5],
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
  // FIX Bug 2: spawn far from player
  const ghostPos = useRef(new THREE.Vector3(-10, 0, -15));
  const catchCooldown = useRef(0);
  const meshRef = useRef<THREE.Mesh>(null);

  // Expose internal ghost position to parent via ghostPosRef
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

    // FIX Bug 4: reduce max speed from 3.5 to 2.8
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
      // FIX Bug 2: reset to far corner
      ghostPos.current.set(-10, 0, -15);
      onCatch();
    }
  });

  return (
    // FIX Bug 2: initial group position updated
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
// Player Controller
// =====================
function PlayerController({
  gameState,
  onItemCollect,
  onEscape,
  playerPosRef,
  collectedItems,
}: {
  gameState: GameState;
  onItemCollect: (id: string) => void;
  onEscape: () => void;
  playerPosRef: React.MutableRefObject<THREE.Vector3>;
  collectedItems: Set<string>;
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
    if (keys.current.KeyW || keys.current.ArrowUp) move.add(forward);
    if (keys.current.KeyS || keys.current.ArrowDown) move.sub(forward);
    if (keys.current.KeyA || keys.current.ArrowLeft) move.sub(right);
    if (keys.current.KeyD || keys.current.ArrowRight) move.add(right);

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
}: {
  gameState: GameState;
  onItemCollect: (id: string) => void;
  onCatch: () => void;
  onEscape: () => void;
  playerPosRef: React.MutableRefObject<THREE.Vector3>;
  ghostPosRef: React.MutableRefObject<THREE.Vector3>;
  collectedItems: Set<string>;
}) {
  return (
    <>
      <fog attach="fog" args={["#050208", 5, 28]} />
      <HouseLighting />
      <HouseGeometry gateUnlocked={gameState.gateUnlocked} />
      {/* FIX Bug 1: use collectedItems.has(id) instead of idx < collectedCount */}
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
      />
      <PointerLockControls />
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

      // Background
      ctx.fillStyle = "rgba(5, 2, 8, 0.75)";
      ctx.fillRect(0, 0, SIZE, SIZE);

      // Draw walls
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

      // Draw outer border outline
      const [bx1, by1] = worldToCanvas(MAP_X_MIN, MAP_Z_MIN);
      const [bx2, by2] = worldToCanvas(MAP_X_MAX, MAP_Z_MAX);
      ctx.strokeStyle = "rgba(200, 150, 100, 0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);

      // Draw gate
      const [gx, gy] = worldToCanvas(GATE_POS[0], GATE_POS[2]);
      ctx.fillStyle = "#00ff88";
      ctx.beginPath();
      ctx.arc(gx, gy, 3, 0, Math.PI * 2);
      ctx.fill();

      // Draw uncollected items
      ctx.fillStyle = "#ffd700";
      for (const { id, pos } of ITEM_POSITIONS) {
        if (collectedItems.has(id)) continue;
        const [ix, iy] = worldToCanvas(pos[0], pos[2]);
        ctx.beginPath();
        ctx.arc(ix, iy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw ghost
      const gPos = ghostPosRef.current;
      if (gPos) {
        const [rx, ry] = worldToCanvas(gPos.x, gPos.z);
        ctx.fillStyle = "#ff4466";
        ctx.beginPath();
        ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw player
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

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={120}
      style={{
        position: "absolute",
        bottom: 40,
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
      {/* FIX Bug 3: improved direction hint */}
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
// Screens
// =====================
function StartScreen({ onStart }: { onStart: () => void }) {
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
      <div
        style={{
          marginTop: "1.5rem",
          fontSize: "0.7rem",
          color: "rgba(200,150,120,0.45)",
          letterSpacing: "0.15em",
        }}
      >
        WASD to move · Mouse to look · Click to lock cursor
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
  // Ghost position ref — initialized to spawn position, updated live by Ghost component
  const ghostPosRef = useRef(new THREE.Vector3(-10, 0, -15));

  // FIX Bug 1: track collected items by ID
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

  const handleItemCollect = useCallback((_id: string) => {
    // FIX Bug 1: update collectedItems set
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
    // FIX Bug 1: reset collected items
    setCollectedItems(new Set());
    setGameState({
      phase: "start",
      daysLeft: 3,
      itemsCollected: 0,
      gateUnlocked: false,
    });
  }, []);

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
        />
      </Canvas>

      <HUD gameState={gameState} collectedItems={collectedItems} />

      {/* Minimap */}
      <Minimap
        playerPosRef={playerPosRef}
        ghostPosRef={ghostPosRef}
        collectedItems={collectedItems}
        gameState={gameState}
      />

      {gameState.phase === "start" && <StartScreen onStart={handleStart} />}
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
