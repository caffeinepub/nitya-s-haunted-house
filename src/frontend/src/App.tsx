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
const GHOST_DEATH_RADIUS = 1.2;
const ROOM_HEIGHT = 4;
const LOOK_SENSITIVITY = 0.003;

// Item positions
const ITEM_POSITIONS: { id: string; pos: [number, number, number] }[] = [
  { id: "item-grand-hall", pos: [-8, 1.2, 4] },
  { id: "item-right-wing", pos: [10, 1.2, -8] },
  { id: "item-far-left", pos: [-9, 1.2, -18] },
  { id: "item-far-right", pos: [9, 1.2, -18] },
];

const GATE_POS: [number, number, number] = [0, 0, -20];

// World bounds for minimap
const MAP_X_MIN = -15;
const MAP_X_MAX = 15;
const MAP_Z_MIN = -22;
const MAP_Z_MAX = 18;

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
  // === OUTER BOUNDARY ===
  {
    id: "wall-north",
    pos: [0, ROOM_HEIGHT / 2, -22],
    size: [30, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-south",
    pos: [0, ROOM_HEIGHT / 2, 18],
    size: [30, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-west",
    pos: [-15, ROOM_HEIGHT / 2, -2],
    size: [0.5, ROOM_HEIGHT, 40],
  },
  {
    id: "wall-east",
    pos: [15, ROOM_HEIGHT / 2, -2],
    size: [0.5, ROOM_HEIGHT, 40],
  },

  // === ENTRY CORRIDOR SIDE WALLS (x:-3 to 3, z:10 to 18) ===
  {
    id: "wall-entry-w",
    pos: [-3, ROOM_HEIGHT / 2, 14],
    size: [0.5, ROOM_HEIGHT, 8],
  },
  {
    id: "wall-entry-e",
    pos: [3, ROOM_HEIGHT / 2, 14],
    size: [0.5, ROOM_HEIGHT, 8],
  },

  // === GRAND HALL SOUTH WALL (z=10, gap x:-3 to 3 for entry) ===
  {
    id: "wall-hall-s-w",
    pos: [-9, ROOM_HEIGHT / 2, 10],
    size: [12, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-hall-s-e",
    pos: [9, ROOM_HEIGHT / 2, 10],
    size: [12, ROOM_HEIGHT, 0.5],
  },

  // === GRAND HALL NORTH WALL (z=-2, gaps: x:-11 to -9 left wing door, x:-3 to 3 corridor, x:9 to 11 right wing door) ===
  {
    id: "wall-hall-n-w1",
    pos: [-13, ROOM_HEIGHT / 2, -2],
    size: [4, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-hall-n-w2",
    pos: [-6, ROOM_HEIGHT / 2, -2],
    size: [6, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-hall-n-e1",
    pos: [6, ROOM_HEIGHT / 2, -2],
    size: [6, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-hall-n-e2",
    pos: [13, ROOM_HEIGHT / 2, -2],
    size: [4, ROOM_HEIGHT, 0.5],
  },

  // === NORTH CORRIDOR SIDE WALLS (x=-3 and x=3, z:-14 to -2) ===
  {
    id: "wall-ncorr-l",
    pos: [-3, ROOM_HEIGHT / 2, -8],
    size: [0.5, ROOM_HEIGHT, 12],
  },
  {
    id: "wall-ncorr-r",
    pos: [3, ROOM_HEIGHT / 2, -8],
    size: [0.5, ROOM_HEIGHT, 12],
  },

  // === WING/CHAMBER DIVIDER (z=-14, gaps: x:-10 to -8, x:-3 to 3, x:8 to 10) ===
  {
    id: "wall-mid-w1",
    pos: [-12.5, ROOM_HEIGHT / 2, -14],
    size: [5, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-mid-w2",
    pos: [-5.5, ROOM_HEIGHT / 2, -14],
    size: [5, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-mid-e1",
    pos: [5.5, ROOM_HEIGHT / 2, -14],
    size: [5, ROOM_HEIGHT, 0.5],
  },
  {
    id: "wall-mid-e2",
    pos: [12.5, ROOM_HEIGHT / 2, -14],
    size: [5, ROOM_HEIGHT, 0.5],
  },

  // === FAR NORTH CENTER DIVIDER (x=0, z:-22 to -14) ===
  {
    id: "wall-farn-div",
    pos: [0, ROOM_HEIGHT / 2, -18],
    size: [0.5, ROOM_HEIGHT, 8],
  },
];

// =====================
// Wall Material - concrete color with emissive cracks
// =====================
function WallMaterial({ seed }: { seed: number }) {
  // Blood-stained dark stone, varied per wall
  const baseShades = ["#2d0a08", "#3a0e0c", "#2a0806", "#320c0a", "#2f0b09"];
  const hex = baseShades[Math.abs(Math.round(seed)) % baseShades.length];
  return (
    <meshStandardMaterial
      color={hex}
      roughness={0.95}
      metalness={0.0}
      emissive="#6b0000"
      emissiveIntensity={0.12 + (seed % 4) * 0.03}
    />
  );
}

// =====================
// Floor/Ceiling Material - slightly darker concrete
// =====================
function FloorCeilMaterial({ seed }: { seed: number }) {
  const isCeiling = seed > 3;
  const color = isCeiling ? "#0d0200" : "#1a0400";
  const emissive = isCeiling ? "#220000" : "#4a0000";
  const emissiveIntensity = isCeiling ? 0.05 : 0.08;
  return (
    <meshStandardMaterial
      color={color}
      roughness={0.97}
      metalness={0.0}
      emissive={emissive}
      emissiveIntensity={emissiveIntensity}
    />
  );
}

// =====================
// House Component
// =====================
function HouseGeometry({ gateUnlocked }: { gateUnlocked: boolean }) {
  const gateColor = gateUnlocked ? "#00ff88" : "#cc2200";
  const gateEmissive = gateUnlocked ? "#00aa44" : "#880000";

  const windowPositions: Array<[number, number, number, string]> = [
    [-15, 2.2, -10, "x"],
    [-15, 2.2, 2, "x"],
    [15, 2.2, -10, "x"],
    [15, 2.2, 2, "x"],
    [-6, 2.2, -22, "z"],
    [6, 2.2, -22, "z"],
    [-6, 2.2, 18, "z"],
    [6, 2.2, 18, "z"],
  ];

  const gravestonePositions: Array<[number, number, number, number]> = [
    [-9, 0, 14, 0.3],
    [9, 0, 14, -0.5],
    [-11, 0, 16, 0.8],
    [11, 0, 16, -0.2],
    [-7, 0, 17, 0.1],
    [7, 0, 17, -0.6],
  ];

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -2]} receiveShadow>
        <planeGeometry args={[30, 40]} />
        <FloorCeilMaterial seed={1.1} />
      </mesh>
      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ROOM_HEIGHT, -2]}>
        <planeGeometry args={[30, 40]} />
        <FloorCeilMaterial seed={5.7} />
      </mesh>
      {/* Walls - darker stone */}
      {WALLS.map((w, index) => (
        <mesh key={w.id} position={w.pos} castShadow receiveShadow>
          <boxGeometry args={w.size} />
          <WallMaterial seed={index * 7.3} />
        </mesh>
      ))}
      {/* Roof ridge beam */}
      <mesh position={[0, ROOM_HEIGHT + 2.5, -2.5]} castShadow>
        <boxGeometry args={[0.4, 0.4, 35.5]} />
        <meshStandardMaterial color="#2a0806" roughness={0.95} />
      </mesh>
      {/* Left roof slope */}
      <mesh
        position={[-6, ROOM_HEIGHT + 1.2, -2.5]}
        rotation={[0, 0, 0.45]}
        castShadow
      >
        <boxGeometry args={[13.5, 0.35, 35.5]} />
        <meshStandardMaterial
          color="#12101a"
          roughness={0.95}
          metalness={0.1}
        />
      </mesh>
      {/* Right roof slope */}
      <mesh
        position={[6, ROOM_HEIGHT + 1.2, -2.5]}
        rotation={[0, 0, -0.45]}
        castShadow
      >
        <boxGeometry args={[13.5, 0.35, 35.5]} />
        <meshStandardMaterial
          color="#12101a"
          roughness={0.95}
          metalness={0.1}
        />
      </mesh>
      {/* Gable north */}
      <mesh position={[0, ROOM_HEIGHT + 1.25, -20.25]} castShadow>
        <coneGeometry args={[13.5, 2.5, 3]} />
        <meshStandardMaterial color="#2d0a08" roughness={0.95} />
      </mesh>
      {/* Gable south */}
      <mesh position={[0, ROOM_HEIGHT + 1.25, 15.25]} castShadow>
        <coneGeometry args={[13.5, 2.5, 3]} />
        <meshStandardMaterial color="#2d0a08" roughness={0.95} />
      </mesh>
      {/* Glowing window frames */}
      {windowPositions.map(([x, y, z, axis]) => {
        const rotY = axis === "x" ? 0 : Math.PI / 2;
        return (
          <group key={`win-${x}-${z}`} position={[x, y, z]}>
            <mesh rotation={[0, rotY, 0]}>
              <boxGeometry args={[1.6, 1.4, 0.15]} />
              <meshStandardMaterial color="#1a1208" roughness={0.8} />
            </mesh>
            <mesh rotation={[0, rotY, 0]}>
              <planeGeometry args={[1.1, 0.95]} />
              <meshStandardMaterial
                color="#ff9922"
                emissive="#ff7700"
                emissiveIntensity={1.8}
                transparent
                opacity={0.7}
              />
            </mesh>
            <pointLight color="#ff8800" intensity={0.8} distance={6} />
          </group>
        );
      })}
      {/* Door frame at corridor entrance */}
      <group position={[0, ROOM_HEIGHT / 2, 5]}>
        <mesh position={[-2.2, 0, 0]}>
          <boxGeometry args={[0.3, ROOM_HEIGHT, 0.35]} />
          <meshStandardMaterial color="#251a0e" roughness={0.9} />
        </mesh>
        <mesh position={[2.2, 0, 0]}>
          <boxGeometry args={[0.3, ROOM_HEIGHT, 0.35]} />
          <meshStandardMaterial color="#251a0e" roughness={0.9} />
        </mesh>
        <mesh position={[0, ROOM_HEIGHT / 2 - 0.15, 0]}>
          <boxGeometry args={[4.7, 0.35, 0.35]} />
          <meshStandardMaterial color="#251a0e" roughness={0.9} />
        </mesh>
      </group>
      {/* Gravestones */}
      {gravestonePositions.map(([x, y, z, rot]) => (
        <group
          key={`grave-${x}-${z}`}
          position={[x, y, z]}
          rotation={[0, rot, 0]}
        >
          <mesh position={[0, 0.6, 0]} castShadow>
            <boxGeometry args={[0.5, 1.2, 0.12]} />
            <meshStandardMaterial color="#1a1820" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.9, 0]} castShadow>
            <boxGeometry args={[0.7, 0.12, 0.14]} />
            <meshStandardMaterial color="#1a1820" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.06, 0]}>
            <boxGeometry args={[0.65, 0.12, 0.3]} />
            <meshStandardMaterial color="#141218" roughness={1} />
          </mesh>
          <pointLight
            color="#4422aa"
            intensity={0.3}
            distance={2.5}
            position={[0, 0.5, 0]}
          />
        </group>
      ))}
      {/* Gate */}
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
      {/* Furniture/debris */}
      <mesh position={[-9, 0.5, -10]} castShadow>
        <boxGeometry args={[1.5, 1, 1.5]} />
        <meshStandardMaterial color="#2f0b09" roughness={1} />
      </mesh>
      <mesh position={[9, 0.75, -12]} castShadow>
        <boxGeometry args={[1.2, 1.5, 0.8]} />
        <meshStandardMaterial color="#505457" roughness={1} />
      </mesh>
      <mesh position={[-9, 0.4, 10]} castShadow>
        <boxGeometry args={[2, 0.8, 1]} />
        <meshStandardMaterial color="#525659" roughness={1} />
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
// Ghost (Nitya) - Dark Warrior Queen
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
  const ghostCurrentQuat = useRef(new THREE.Quaternion());
  // Keep unused refs for compatibility
  const bodyRef = useRef<THREE.Mesh>(null);
  const _tailRef = useRef<THREE.Mesh>(null);
  const _trailRef = useRef<THREE.Mesh>(null);
  const _orbRefs = useRef<THREE.Mesh[]>([]);
  const _orbAngles = useRef<number[]>([0, 0.8, 1.6, 2.4, 3.2, 4.0, 4.8, 5.6]);

  // Queen-specific refs
  const queenGroupRef = useRef<THREE.Group>(null);
  const robeRef = useRef<THREE.Mesh>(null);
  const leftFanRef = useRef<THREE.Group>(null);
  const rightFanRef = useRef<THREE.Group>(null);
  const trail1Ref = useRef<THREE.Mesh>(null);
  const trail2Ref = useRef<THREE.Mesh>(null);
  const trail3Ref = useRef<THREE.Mesh>(null);
  const redLightRef = useRef<THREE.PointLight>(null);
  const crownMatsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);

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

    const speed = 0.7 + 0.8 * Math.max(0, 1 - dist / 8);
    const dir = new THREE.Vector3(
      target.x - gp.x,
      0,
      target.z - gp.z,
    ).normalize();
    gp.x += dir.x * speed * delta;
    gp.z += dir.z * speed * delta;

    const targetQuat = new THREE.Quaternion();
    ghostRef.current.position.set(gp.x, 0, gp.z);
    const lookTarget = new THREE.Object3D();
    lookTarget.position.set(target.x, PLAYER_HEIGHT / 2, target.z);
    ghostRef.current.updateWorldMatrix(false, false);
    const tmpObj = new THREE.Object3D();
    tmpObj.position.copy(ghostRef.current.position);
    tmpObj.lookAt(target.x, PLAYER_HEIGHT / 2, target.z);
    targetQuat.copy(tmpObj.quaternion);
    ghostCurrentQuat.current.slerp(targetQuat, 0.12);
    ghostRef.current.quaternion.copy(ghostCurrentQuat.current);

    const t = state.clock.elapsedTime;
    const emissive = 0.6 + Math.sin(t * 4) * 0.3;

    // Keep queen group grounded
    if (queenGroupRef.current) {
      queenGroupRef.current.position.y = 1.0;
      // Lean forward when running
      queenGroupRef.current.rotation.x = dist < 10 ? -0.18 : -0.02;
      queenGroupRef.current.rotation.z = 0;
    }
    // Running leg animation
    if (leftLegRef.current && rightLegRef.current) {
      const runFreq = 6;
      const runAmp = dist < 10 ? 0.55 : 0.1;
      leftLegRef.current.rotation.x = Math.sin(t * runFreq) * runAmp;
      rightLegRef.current.rotation.x = Math.sin(t * runFreq + Math.PI) * runAmp;
    }
    // Arm swing (opposite to legs)
    if (leftArmRef.current && rightArmRef.current) {
      const runFreq = 6;
      const armAmp = dist < 10 ? 0.4 : 0.05;
      leftArmRef.current.rotation.x = Math.sin(t * runFreq + Math.PI) * armAmp;
      rightArmRef.current.rotation.x = Math.sin(t * runFreq) * armAmp;
    }

    // Robe billowing
    if (robeRef.current) {
      robeRef.current.scale.x = 1 + Math.sin(t * 3) * 0.15;
      const mat = robeRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = emissive * 0.4;
    }

    // Left fan spread/close (opens dramatically)
    if (leftFanRef.current) {
      leftFanRef.current.rotation.z = 0.4 + Math.sin(t * 2) * 0.6;
    }
    // Right fan opposite phase
    if (rightFanRef.current) {
      rightFanRef.current.rotation.z = -(0.4 + Math.sin(t * 2 + Math.PI) * 0.6);
    }

    // Trailing fabric flutter (solid fabric, no opacity changes)
    const trailMeshes = [trail1Ref, trail2Ref, trail3Ref];
    trailMeshes.forEach((ref, i) => {
      if (ref.current) {
        ref.current.rotation.x = Math.sin(t * 2.5 + i * 0.9) * 0.25;
        ref.current.rotation.z = Math.sin(t * 1.8 + i * 1.2) * 0.12;
      }
    });

    // Crown spike emissive pulse when close
    for (const mat of crownMatsRef.current) {
      if (mat)
        mat.emissiveIntensity = dist < 6 ? 0.5 + Math.sin(t * 6) * 0.4 : 0.1;
    }

    // Pulsing red light
    if (redLightRef.current) {
      redLightRef.current.intensity = 2.5 + Math.sin(t * 4) * 1.0;
    }

    if (dist < GHOST_DEATH_RADIUS && catchCooldown.current <= 0) {
      catchCooldown.current = 5;
      ghostPos.current.set(-10, 0, -15);
      onCatch();
    }
  });

  // Fan blade geometry helper (9 blades fanned in an arc for larger fans)
  const fanBlades = Array.from({ length: 9 }, (_, i) => i);

  return (
    <group ref={ghostRef} position={[-10, 0, -15]}>
      <group ref={queenGroupRef} position={[0, 1.0, 0]} scale={[1.1, 1.1, 1.1]}>
        {/* === LEGS === */}
        {/* Left leg group (pivot at hip) */}
        <group ref={leftLegRef} position={[-0.09, -0.3, 0]}>
          {/* Left leg */}
          <mesh position={[0, -0.25, 0]}>
            <cylinderGeometry args={[0.045, 0.04, 0.5, 14]} />
            <meshStandardMaterial color="#e8b89a" roughness={0.7} />
          </mesh>
          {/* Left boot */}
          <mesh position={[0, -0.52, 0]}>
            <cylinderGeometry args={[0.05, 0.055, 0.18, 8]} />
            <meshStandardMaterial
              color="#1a0a0a"
              roughness={0.6}
              metalness={0.3}
            />
          </mesh>
        </group>
        {/* Right leg group (pivot at hip) */}
        <group ref={rightLegRef} position={[0.09, -0.3, 0]}>
          {/* Right leg */}
          <mesh position={[0, -0.25, 0]}>
            <cylinderGeometry args={[0.045, 0.04, 0.5, 14]} />
            <meshStandardMaterial color="#e8b89a" roughness={0.7} />
          </mesh>
          {/* Right boot */}
          <mesh position={[0, -0.52, 0]}>
            <cylinderGeometry args={[0.05, 0.055, 0.18, 8]} />
            <meshStandardMaterial
              color="#1a0a0a"
              roughness={0.6}
              metalness={0.3}
            />
          </mesh>
        </group>

        {/* === LAYERED FABRIC SKIRT (panels, no cone) === */}
        {/* Front panel */}
        <mesh ref={robeRef} position={[0, -0.35, 0.18]}>
          <cylinderGeometry args={[0.35, 0.55, 0.85, 20, 1, true, -0.6, 1.2]} />
          <meshStandardMaterial
            color="#6b0000"
            emissive="#cc2200"
            emissiveIntensity={0.12}
            roughness={0.75}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Back panel */}
        <mesh position={[0, -0.35, -0.18]}>
          <cylinderGeometry
            args={[0.35, 0.55, 0.85, 20, 1, true, Math.PI - 0.6, 1.2]}
          />
          <meshStandardMaterial
            color="#5a0000"
            emissive="#cc2200"
            emissiveIntensity={0.1}
            roughness={0.8}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Left panel */}
        <mesh position={[-0.18, -0.35, 0]}>
          <cylinderGeometry
            args={[0.35, 0.55, 0.85, 20, 1, true, -Math.PI / 2 - 0.6, 1.2]}
          />
          <meshStandardMaterial
            color="#630000"
            emissive="#cc2200"
            emissiveIntensity={0.11}
            roughness={0.78}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Right panel */}
        <mesh position={[0.18, -0.35, 0]}>
          <cylinderGeometry
            args={[0.35, 0.55, 0.85, 20, 1, true, Math.PI / 2 - 0.6, 1.2]}
          />
          <meshStandardMaterial
            color="#630000"
            emissive="#cc2200"
            emissiveIntensity={0.11}
            roughness={0.78}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* === TORSO / CORSET === */}
        <mesh ref={bodyRef} position={[0, 0.28, 0]}>
          <cylinderGeometry args={[0.14, 0.17, 0.55, 16]} />
          <meshStandardMaterial
            color="#8b0000"
            emissive="#cc2200"
            emissiveIntensity={0.1}
            roughness={0.45}
            metalness={0.35}
          />
        </mesh>
        {/* Corset belt detail */}
        <mesh position={[0, 0.04, 0.1]}>
          <boxGeometry args={[0.31, 0.06, 0.02]} />
          <meshStandardMaterial
            color="#2a0000"
            roughness={0.4}
            metalness={0.5}
          />
        </mesh>

        {/* === SHOULDERS === */}
        <mesh position={[-0.2, 0.48, 0]}>
          <sphereGeometry args={[0.085, 16, 16]} />
          <meshStandardMaterial
            color="#8b0000"
            roughness={0.5}
            metalness={0.2}
          />
        </mesh>
        <mesh position={[0.2, 0.48, 0]}>
          <sphereGeometry args={[0.085, 16, 16]} />
          <meshStandardMaterial
            color="#8b0000"
            roughness={0.5}
            metalness={0.2}
          />
        </mesh>

        {/* === ARMS === */}
        {/* Left arm group (pivot at shoulder) */}
        <group ref={leftArmRef} position={[-0.22, 0.48, 0]}>
          {/* Left upper arm */}
          <mesh position={[0, -0.18, 0]} rotation={[0, 0, 0]}>
            <cylinderGeometry args={[0.04, 0.035, 0.32, 14]} />
            <meshStandardMaterial color="#e8b89a" roughness={0.7} />
          </mesh>
          {/* Left forearm */}
          <mesh position={[0, -0.4, 0]} rotation={[0, 0, 0]}>
            <cylinderGeometry args={[0.032, 0.028, 0.28, 14]} />
            <meshStandardMaterial color="#e8b89a" roughness={0.7} />
          </mesh>
        </group>
        {/* Right arm group (pivot at shoulder) */}
        <group ref={rightArmRef} position={[0.22, 0.48, 0]}>
          {/* Right upper arm */}
          <mesh position={[0, -0.18, 0]} rotation={[0, 0, 0]}>
            <cylinderGeometry args={[0.04, 0.035, 0.32, 14]} />
            <meshStandardMaterial color="#e8b89a" roughness={0.7} />
          </mesh>
          {/* Right forearm */}
          <mesh position={[0, -0.4, 0]} rotation={[0, 0, 0]}>
            <cylinderGeometry args={[0.032, 0.028, 0.28, 14]} />
            <meshStandardMaterial color="#e8b89a" roughness={0.7} />
          </mesh>
        </group>

        {/* === NECK === */}
        <mesh position={[0, 0.62, 0]}>
          <cylinderGeometry args={[0.055, 0.065, 0.14, 14]} />
          <meshStandardMaterial color="#e8b89a" roughness={0.7} />
        </mesh>

        {/* === HEAD (skin tone) === */}
        <mesh position={[0, 0.82, 0]}>
          <sphereGeometry args={[0.2, 14, 14]} />
          <meshStandardMaterial color="#e8b89a" roughness={0.6} />
        </mesh>

        {/* === HAIR (long black, flowing back) === */}
        {/* Main hair mass on top/back */}
        <mesh position={[0, 0.88, -0.1]} rotation={[0.3, 0, 0]}>
          <cylinderGeometry args={[0.19, 0.12, 0.4, 16]} />
          <meshStandardMaterial color="#0d0005" roughness={0.9} />
        </mesh>
        {/* Hair flowing down the back */}
        <mesh position={[0, 0.55, -0.22]} rotation={[0.5, 0, 0]}>
          <boxGeometry args={[0.32, 0.55, 0.06]} />
          <meshStandardMaterial
            color="#0d0005"
            roughness={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 0.2, -0.28]} rotation={[0.4, 0, 0]}>
          <boxGeometry args={[0.28, 0.5, 0.05]} />
          <meshStandardMaterial
            color="#0d0005"
            roughness={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Side hair strands */}
        <mesh position={[-0.17, 0.72, -0.05]} rotation={[0.2, 0, -0.2]}>
          <boxGeometry args={[0.06, 0.3, 0.04]} />
          <meshStandardMaterial color="#0d0005" roughness={0.9} />
        </mesh>
        <mesh position={[0.17, 0.72, -0.05]} rotation={[0.2, 0, 0.2]}>
          <boxGeometry args={[0.06, 0.3, 0.04]} />
          <meshStandardMaterial color="#0d0005" roughness={0.9} />
        </mesh>

        {/* === GLOWING RED EYES === */}
        <mesh position={[-0.07, 0.86, 0.18]}>
          <sphereGeometry args={[0.032, 8, 8]} />
          <meshStandardMaterial
            emissive="#ff2200"
            emissiveIntensity={5}
            color="#ff0000"
          />
        </mesh>
        <mesh position={[0.07, 0.86, 0.18]}>
          <sphereGeometry args={[0.032, 8, 8]} />
          <meshStandardMaterial
            emissive="#ff2200"
            emissiveIntensity={5}
            color="#ff0000"
          />
        </mesh>

        {/* === SPIKE CROWN (7 dark-iron spikes in semicircle) === */}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => {
          const angle = (i / 6) * Math.PI - Math.PI / 2;
          const r = 0.16;
          const isMid = i === 3;
          return (
            <mesh
              key={`crown-${i}`}
              position={[
                Math.cos(angle) * r,
                1.06 + (isMid ? 0.1 : 0),
                Math.sin(angle) * r * 0.35,
              ]}
              rotation={[isMid ? -0.1 : i < 3 ? -0.18 : 0.18, 0, (i - 3) * 0.2]}
              ref={(el) => {
                if (el) {
                  const mat = el.material as THREE.MeshStandardMaterial;
                  if (!crownMatsRef.current.includes(mat))
                    crownMatsRef.current.push(mat);
                }
              }}
            >
              <coneGeometry args={[0.022, 0.25 + (isMid ? 0.08 : 0), 6]} />
              <meshStandardMaterial
                color="#2a2a2a"
                emissive="#880000"
                emissiveIntensity={0.1}
                metalness={0.85}
                roughness={0.15}
              />
            </mesh>
          );
        })}
        {/* Crown band base */}
        <mesh position={[0, 1.0, 0]}>
          <torusGeometry args={[0.17, 0.022, 8, 20, Math.PI]} />
          <meshStandardMaterial
            color="#2a2a2a"
            metalness={0.85}
            roughness={0.15}
          />
        </mesh>

        {/* === LEFT FAN (large, bright red, with handle) === */}
        <group
          ref={leftFanRef}
          position={[-0.44, 0.18, 0]}
          rotation={[0, 0, 0.4]}
        >
          {/* Fan handle */}
          <mesh position={[0, -0.12, 0]}>
            <cylinderGeometry args={[0.012, 0.01, 0.24, 6]} />
            <meshStandardMaterial
              color="#1a0000"
              roughness={0.5}
              metalness={0.3}
            />
          </mesh>
          {fanBlades.map((i) => (
            <mesh
              key={`lfan-${i}`}
              position={[
                Math.cos((i - 4) * (Math.PI / 10)) * 0.3,
                Math.sin((i - 4) * (Math.PI / 10)) * 0.3,
                0,
              ]}
              rotation={[0, 0, (i - 4) * (Math.PI / 10)]}
            >
              <boxGeometry args={[0.045, 0.58, 0.007]} />
              <meshStandardMaterial
                color="#cc2200"
                emissive="#ff1100"
                emissiveIntensity={0.4}
                side={THREE.DoubleSide}
                roughness={0.4}
              />
            </mesh>
          ))}
        </group>

        {/* === RIGHT FAN (large, bright red, with handle) === */}
        <group
          ref={rightFanRef}
          position={[0.44, 0.18, 0]}
          rotation={[0, 0, -0.4]}
        >
          {/* Fan handle */}
          <mesh position={[0, -0.12, 0]}>
            <cylinderGeometry args={[0.012, 0.01, 0.24, 6]} />
            <meshStandardMaterial
              color="#1a0000"
              roughness={0.5}
              metalness={0.3}
            />
          </mesh>
          {fanBlades.map((i) => (
            <mesh
              key={`rfan-${i}`}
              position={[
                Math.cos((i - 4) * (Math.PI / 10)) * 0.3,
                Math.sin((i - 4) * (Math.PI / 10)) * 0.3,
                0,
              ]}
              rotation={[0, 0, (i - 4) * (Math.PI / 10)]}
            >
              <boxGeometry args={[0.045, 0.58, 0.007]} />
              <meshStandardMaterial
                color="#cc2200"
                emissive="#ff1100"
                emissiveIntensity={0.4}
                side={THREE.DoubleSide}
                roughness={0.4}
              />
            </mesh>
          ))}
        </group>

        {/* === TRAILING ROBE FABRIC (solid, no transparency) === */}
        <mesh ref={trail1Ref} position={[0, -0.62, 0.12]}>
          <boxGeometry args={[0.5, 0.72, 0.01]} />
          <meshStandardMaterial
            color="#8b0000"
            emissive="#cc2200"
            emissiveIntensity={0.1}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh ref={trail2Ref} position={[0.2, -0.58, 0.18]}>
          <boxGeometry args={[0.22, 0.62, 0.01]} />
          <meshStandardMaterial
            color="#6b0000"
            emissive="#cc2200"
            emissiveIntensity={0.08}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh ref={trail3Ref} position={[-0.2, -0.54, 0.2]}>
          <boxGeometry args={[0.22, 0.6, 0.01]} />
          <meshStandardMaterial
            color="#6b0000"
            emissive="#cc2200"
            emissiveIntensity={0.08}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* === SUBTLE RED ATMOSPHERE LIGHT (not a ghost aura, just dramatic lighting) === */}
        <pointLight
          ref={redLightRef}
          color="#cc1122"
          intensity={1.8}
          distance={6}
          position={[0, 0.3, 0]}
        />
      </group>
    </group>
  );
}
// =====================
// Lighting
// =====================
function WallTorch({ position }: { position: [number, number, number] }) {
  const lightRef = useRef<THREE.PointLight>(null);
  const offset = useRef(Math.random() * Math.PI * 2);

  useFrame((state) => {
    if (lightRef.current) {
      const t = state.clock.elapsedTime;
      lightRef.current.intensity =
        1.4 +
        Math.sin(t * 7.3 + offset.current) * 0.4 +
        Math.sin(t * 11 + offset.current) * 0.15;
    }
  });

  return (
    <group position={position}>
      {/* Torch holder - small cylinder */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.06, 0.3, 6]} />
        <meshStandardMaterial color="#3a2208" roughness={0.8} metalness={0.3} />
      </mesh>
      {/* Flame glow sphere */}
      <mesh position={[0, 0.2, 0]}>
        <sphereGeometry args={[0.08, 6, 6]} />
        <meshStandardMaterial
          color="#ff9922"
          emissive="#ff6600"
          emissiveIntensity={3}
          transparent
          opacity={0.85}
        />
      </mesh>
      <pointLight
        ref={lightRef}
        color="#ff6822"
        intensity={1.4}
        distance={8}
        castShadow
      />
    </group>
  );
}

// =====================
// Candle - floor-standing horror candle
// =====================
function Candle({ position }: { position: [number, number, number] }) {
  const lightRef = useRef<THREE.PointLight>(null);
  const offset = useRef(Math.random() * Math.PI * 2);

  useFrame((state) => {
    if (lightRef.current) {
      const t = state.clock.elapsedTime;
      lightRef.current.intensity =
        0.8 +
        Math.sin(t * 8.1 + offset.current) * 0.3 +
        Math.sin(t * 13.7 + offset.current) * 0.1;
    }
  });

  return (
    <group position={position}>
      {/* Wax body */}
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 0.3, 8]} />
        <meshStandardMaterial color="#e8dcc8" roughness={0.9} />
      </mesh>
      {/* Flame */}
      <mesh position={[0, 0.34, 0]}>
        <sphereGeometry args={[0.035, 6, 8]} />
        <meshStandardMaterial
          color="#ffdd44"
          emissive="#ff9900"
          emissiveIntensity={4}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* Wax drip pool */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.06, 8]} />
        <meshStandardMaterial color="#d4c8a8" roughness={0.95} />
      </mesh>
      <pointLight
        ref={lightRef}
        color="#ff9922"
        intensity={0.8}
        distance={6}
        castShadow={false}
      />
    </group>
  );
}
function HouseLighting() {
  const light1 = useRef<THREE.PointLight>(null);
  const light2 = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    if (light1.current) {
      light1.current.intensity =
        1.0 + Math.sin(state.clock.elapsedTime * 7.3) * 0.12;
    }
    if (light2.current) {
      light2.current.intensity =
        0.7 + Math.sin(state.clock.elapsedTime * 5.1 + 1) * 0.1;
    }
  });

  return (
    <>
      {/* Blood-red ambient - very low */}
      <ambientLight intensity={0.12} color="#1a0000" />
      {/* Dim crimson fill from above */}
      <directionalLight
        color="#1a0000"
        intensity={0.05}
        position={[0, 10, 0]}
      />
      <pointLight
        ref={light1}
        color="#cc1100"
        intensity={1.0}
        distance={12}
        position={[0, 3, 0]}
      />
      <pointLight
        ref={light2}
        color="#880022"
        intensity={0.7}
        distance={15}
        position={[-8, 3, -8]}
      />
      <pointLight
        color="#661100"
        intensity={0.5}
        distance={10}
        position={[8, 3, 8]}
      />
      <pointLight
        color="#550011"
        intensity={0.6}
        distance={12}
        position={[8, 3, -12]}
      />
      <pointLight
        color="#440000"
        intensity={0.4}
        distance={10}
        position={[-8, 3, 10]}
      />
      {/* Wall torches at key spots */}
      <WallTorch position={[-11.5, 2.5, -8]} />
      <WallTorch position={[11.5, 2.5, -8]} />
      {/* Floor candles throughout rooms */}
      <Candle position={[-9, 0.15, -5]} />
      <Candle position={[9, 0.15, -5]} />
      <Candle position={[-9, 0.15, 3]} />
      <Candle position={[9, 0.15, 3]} />
      <Candle position={[0, 0.15, -15]} />
      <Candle position={[-5, 0.15, -15]} />
      <Candle position={[5, 0.15, -15]} />
      <Candle position={[-3, 0.15, 8]} />
      <Candle position={[3, 0.15, 8]} />
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
  const smoothYaw = useRef(0);
  const smoothPitch = useRef(0);

  useFrame(() => {
    if (!active) return;
    camera.rotation.order = "YXZ";
    const lf = 0.3;
    smoothYaw.current += (yawRef.current - smoothYaw.current) * lf;
    smoothPitch.current += (pitchRef.current - smoothPitch.current) * lf;
    camera.rotation.set(smoothPitch.current, smoothYaw.current, 0);
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
      camera.position.set(0, PLAYER_HEIGHT, 14);
      playerPosRef.current.set(0, PLAYER_HEIGHT, 14);
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
      <fogExp2 attach="fog" args={["#0a0002", 0.035]} />
      <HouseLighting />
      <HouseGeometry gateUnlocked={gameState.gateUnlocked} />
      {/* Blood puddles on the floor */}
      {[
        { pos: [3, 0.01, -5] as [number, number, number], r: 0.6, id: "b1" },
        { pos: [-5, 0.01, 2] as [number, number, number], r: 1.2, id: "b2" },
        { pos: [7, 0.01, -12] as [number, number, number], r: 0.8, id: "b3" },
        { pos: [-7, 0.01, -12] as [number, number, number], r: 1.2, id: "b4" },
        { pos: [0, 0.01, 5] as [number, number, number], r: 0.6, id: "b5" },
        { pos: [-3, 0.01, -8] as [number, number, number], r: 0.9, id: "b6" },
        { pos: [5, 0.01, -2] as [number, number, number], r: 0.7, id: "b7" },
        { pos: [-4, 0.01, -16] as [number, number, number], r: 1.0, id: "b8" },
      ].map(({ pos, r, id }) => (
        <mesh key={id} position={pos} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[r, 16]} />
          <meshStandardMaterial
            color="#1a0000"
            emissive="#660000"
            emissiveIntensity={0.4}
            roughness={0.2}
            metalness={0.1}
          />
        </mesh>
      ))}
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
      ctx.fillStyle = "rgba(8, 0, 2, 0.88)";
      ctx.fillRect(0, 0, SIZE, SIZE);

      ctx.strokeStyle = "rgba(160, 20, 20, 0.75)";
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
      ctx.strokeStyle = "rgba(200, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);

      const [gx, gy] = worldToCanvas(GATE_POS[0], GATE_POS[2]);
      ctx.fillStyle = "#ff0000";
      ctx.beginPath();
      ctx.arc(gx, gy, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ff6600";
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
        ctx.fillStyle = "#ff0088";
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
        border: "1px solid rgba(150, 0, 0, 0.6)",
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

// =====================
// CSS Nitya Figure
// =====================
function NityaFigure({
  pose,
  style,
  showJaw,
}: {
  pose: "standing" | "lying";
  style?: React.CSSProperties;
  showJaw?: boolean;
}) {
  const containerStyle: React.CSSProperties = {
    position: "relative",
    width: 90,
    height: 200,
    transform: pose === "lying" ? "rotate(90deg)" : "rotate(0deg)",
    transformOrigin: "bottom center",
    ...style,
  };

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes leftLegRun {
          0% { transform: rotate(-25deg); }
          50% { transform: rotate(25deg); }
          100% { transform: rotate(-25deg); }
        }
        @keyframes rightLegRun {
          0% { transform: rotate(25deg); }
          50% { transform: rotate(-25deg); }
          100% { transform: rotate(25deg); }
        }
      `}</style>
      {/* ── Long flowing hair behind head ── */}
      <div
        style={{
          position: "absolute",
          top: 28,
          left: "50%",
          transform: "translateX(-50%)",
          width: 76,
          height: 130,
          background:
            "linear-gradient(to bottom, #0a0212 0%, #0d0318 50%, transparent 100%)",
          borderRadius: "0 0 40px 40px",
          zIndex: 0,
          boxShadow: "inset 0 10px 20px rgba(80,0,160,0.15)",
        }}
      />
      {/* Hair left strand */}
      <div
        style={{
          position: "absolute",
          top: 26,
          left: 1,
          width: 20,
          height: 115,
          background:
            "linear-gradient(to bottom, #0a0212 0%, #120418 60%, transparent 100%)",
          borderRadius: "0 0 60% 60%",
          transform: "rotate(-10deg)",
          zIndex: 0,
        }}
      />
      {/* Hair right strand */}
      <div
        style={{
          position: "absolute",
          top: 26,
          right: 1,
          width: 20,
          height: 115,
          background:
            "linear-gradient(to bottom, #0a0212 0%, #120418 60%, transparent 100%)",
          borderRadius: "0 0 60% 60%",
          transform: "rotate(10deg)",
          zIndex: 0,
        }}
      />
      {/* Hair glossy highlight streak */}
      <div
        style={{
          position: "absolute",
          top: 30,
          left: "50%",
          transform: "translateX(-50%) rotate(-5deg)",
          width: 8,
          height: 80,
          background:
            "linear-gradient(to bottom, rgba(120,60,220,0.35) 0%, rgba(80,20,160,0.15) 60%, transparent 100%)",
          borderRadius: 8,
          zIndex: 1,
          pointerEvents: "none",
        }}
      />

      {/* ── Crown base ── */}
      <div
        style={{
          position: "absolute",
          top: 6,
          left: "50%",
          transform: "translateX(-50%)",
          width: 54,
          height: 13,
          background:
            "linear-gradient(to bottom, #f5d060 0%, #c9922b 50%, #a07010 100%)",
          borderRadius: "3px 3px 0 0",
          zIndex: 4,
          boxShadow:
            "0 0 10px rgba(245,208,96,0.6), 0 0 20px rgba(200,140,20,0.3), inset 0 2px 4px rgba(255,255,200,0.4)",
        }}
      />
      {/* Crown spike far-left (short) */}
      <div
        style={{
          position: "absolute",
          top: -2,
          left: "14%",
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderBottom: "14px solid #c9922b",
          zIndex: 4,
          filter: "drop-shadow(0 0 4px rgba(245,208,96,0.8))",
        }}
      />
      {/* Crown spike left (medium) */}
      <div
        style={{
          position: "absolute",
          top: -6,
          left: "28%",
          width: 0,
          height: 0,
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderBottom: "20px solid #d4a030",
          zIndex: 4,
          filter: "drop-shadow(0 0 5px rgba(245,208,96,0.9))",
        }}
      />
      {/* Crown spike center (tallest) */}
      <div
        style={{
          position: "absolute",
          top: -14,
          left: "50%",
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
          borderLeft: "8px solid transparent",
          borderRight: "8px solid transparent",
          borderBottom: "28px solid #f5d060",
          zIndex: 4,
          filter: "drop-shadow(0 0 8px rgba(245,220,80,1))",
        }}
      />
      {/* Crown spike right (medium) */}
      <div
        style={{
          position: "absolute",
          top: -6,
          right: "28%",
          width: 0,
          height: 0,
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderBottom: "20px solid #d4a030",
          zIndex: 4,
          filter: "drop-shadow(0 0 5px rgba(245,208,96,0.9))",
        }}
      />
      {/* Crown spike far-right (short) */}
      <div
        style={{
          position: "absolute",
          top: -2,
          right: "14%",
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderBottom: "14px solid #c9922b",
          zIndex: 4,
          filter: "drop-shadow(0 0 4px rgba(245,208,96,0.8))",
        }}
      />
      {/* Crown center crimson gem */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: "50%",
          transform: "translateX(-50%)",
          width: 7,
          height: 7,
          background:
            "radial-gradient(ellipse, #ff8888 0%, #cc0000 60%, #800000 100%)",
          borderRadius: "50%",
          zIndex: 5,
          boxShadow: "0 0 6px rgba(255,0,0,0.9), 0 0 12px rgba(200,0,0,0.5)",
        }}
      />

      {/* ── Head ── */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          width: 50,
          height: 58,
          background:
            "radial-gradient(ellipse at 38% 32%, #f0c0a0 0%, #e8b090 35%, #c48060 70%, #9a6040 100%)",
          borderRadius: "50% 50% 44% 44%",
          zIndex: 2,
          boxShadow:
            "inset -5px -7px 14px rgba(0,0,0,0.3), inset 3px 3px 8px rgba(255,220,180,0.25)",
        }}
      >
        {/* Left eyebrow */}
        <div
          style={{
            position: "absolute",
            top: 13,
            left: 7,
            width: 14,
            height: 2,
            background: "#1a0a04",
            borderRadius: "2px 2px 0 0",
            transform: "rotate(-8deg)",
          }}
        />
        {/* Right eyebrow */}
        <div
          style={{
            position: "absolute",
            top: 13,
            right: 7,
            width: 14,
            height: 2,
            background: "#1a0a04",
            borderRadius: "2px 2px 0 0",
            transform: "rotate(8deg)",
          }}
        />
        {/* Left eye white */}
        <div
          style={{
            position: "absolute",
            top: 18,
            left: 7,
            width: 13,
            height: 8,
            background: "#fff8f8",
            borderRadius: "50%",
            boxShadow: "0 0 3px rgba(0,0,0,0.4)",
            overflow: "hidden",
          }}
        >
          {/* Left iris */}
          <div
            style={{
              position: "absolute",
              top: 1,
              left: 2,
              width: 9,
              height: 7,
              background:
                "radial-gradient(ellipse at 35% 30%, #ff6666 0%, #cc0000 50%, #7a0000 100%)",
              borderRadius: "50%",
              boxShadow: "0 0 5px rgba(200,0,0,0.7)",
            }}
          />
          {/* Left pupil */}
          <div
            style={{
              position: "absolute",
              top: 2,
              left: 4,
              width: 5,
              height: 5,
              background: "#0a0000",
              borderRadius: "50%",
            }}
          />
          {/* Left eye glint */}
          <div
            style={{
              position: "absolute",
              top: 1,
              left: 5,
              width: 3,
              height: 3,
              background: "rgba(255,255,255,0.85)",
              borderRadius: "50%",
            }}
          />
        </div>
        {/* Left eye lashes (top border) */}
        <div
          style={{
            position: "absolute",
            top: 17,
            left: 7,
            width: 13,
            height: 3,
            borderTop: "3px solid #0a0000",
            borderRadius: "50% 50% 0 0",
            pointerEvents: "none",
          }}
        />

        {/* Right eye white */}
        <div
          style={{
            position: "absolute",
            top: 18,
            right: 7,
            width: 13,
            height: 8,
            background: "#fff8f8",
            borderRadius: "50%",
            boxShadow: "0 0 3px rgba(0,0,0,0.4)",
            overflow: "hidden",
          }}
        >
          {/* Right iris */}
          <div
            style={{
              position: "absolute",
              top: 1,
              left: 2,
              width: 9,
              height: 7,
              background:
                "radial-gradient(ellipse at 35% 30%, #ff6666 0%, #cc0000 50%, #7a0000 100%)",
              borderRadius: "50%",
              boxShadow: "0 0 5px rgba(200,0,0,0.7)",
            }}
          />
          {/* Right pupil */}
          <div
            style={{
              position: "absolute",
              top: 2,
              left: 4,
              width: 5,
              height: 5,
              background: "#0a0000",
              borderRadius: "50%",
            }}
          />
          {/* Right eye glint */}
          <div
            style={{
              position: "absolute",
              top: 1,
              left: 5,
              width: 3,
              height: 3,
              background: "rgba(255,255,255,0.85)",
              borderRadius: "50%",
            }}
          />
        </div>
        {/* Right eye lashes */}
        <div
          style={{
            position: "absolute",
            top: 17,
            right: 7,
            width: 13,
            height: 3,
            borderTop: "3px solid #0a0000",
            borderRadius: "50% 50% 0 0",
            pointerEvents: "none",
          }}
        />

        {/* Nose hint */}
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            width: 5,
            height: 4,
            borderBottom: "2px solid rgba(120,60,30,0.45)",
            borderLeft: "1px solid rgba(120,60,30,0.3)",
            borderRight: "1px solid rgba(120,60,30,0.3)",
            borderRadius: "0 0 50% 50%",
          }}
        />

        {/* Lips */}
        <div
          style={{
            position: "absolute",
            bottom: showJaw ? 12 : 11,
            left: "50%",
            transform: "translateX(-50%)",
            width: 18,
            height: showJaw ? 13 : 5,
            background: showJaw
              ? "#1a0000"
              : "linear-gradient(to bottom, #cc2244 0%, #8b1a1a 60%, #6a1010 100%)",
            borderRadius: showJaw ? "4px 4px 50% 50%" : "50% 50% 50% 50%",
            transition: "height 0.1s ease",
            overflow: "hidden",
            boxShadow: showJaw
              ? "none"
              : "inset 0 2px 3px rgba(255,100,100,0.3)",
            animation: showJaw
              ? "jawChewSmooth 0.4s ease-in-out infinite alternate"
              : "none",
          }}
        >
          {/* Upper lip bow */}
          {!showJaw && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: "50%",
                transform: "translateX(-50%)",
                width: 10,
                height: 3,
                background: "rgba(255,160,160,0.4)",
                borderRadius: "50%",
              }}
            />
          )}
          {showJaw && (
            <div
              style={{
                position: "absolute",
                top: 2,
                left: "50%",
                transform: "translateX(-50%)",
                width: 14,
                height: 5,
                background:
                  "linear-gradient(to bottom, #cc2200 0%, #880000 100%)",
                borderRadius: "0 0 4px 4px",
              }}
            />
          )}
        </div>

        {/* Cheek blush left */}
        <div
          style={{
            position: "absolute",
            top: 26,
            left: 4,
            width: 10,
            height: 6,
            background:
              "radial-gradient(ellipse, rgba(220,100,80,0.35), transparent 70%)",
            borderRadius: "50%",
          }}
        />
        {/* Cheek blush right */}
        <div
          style={{
            position: "absolute",
            top: 26,
            right: 4,
            width: 10,
            height: 6,
            background:
              "radial-gradient(ellipse, rgba(220,100,80,0.35), transparent 70%)",
            borderRadius: "50%",
          }}
        />
      </div>

      {/* ── Neck ── */}
      <div
        style={{
          position: "absolute",
          top: 72,
          left: "50%",
          transform: "translateX(-50%)",
          width: 22,
          height: 12,
          background: "linear-gradient(to bottom, #e0a880, #c48060)",
          zIndex: 2,
        }}
      />
      {/* Gold necklace */}
      <div
        style={{
          position: "absolute",
          top: 80,
          left: "50%",
          transform: "translateX(-50%)",
          width: 36,
          height: 5,
          background:
            "linear-gradient(to right, transparent 0%, #c9922b 20%, #f5d060 50%, #c9922b 80%, transparent 100%)",
          borderRadius: "0 0 8px 8px",
          zIndex: 3,
          boxShadow: "0 0 5px rgba(245,208,96,0.5)",
        }}
      />

      {/* ── Left arm (skin + gold bracer) ── */}
      <div
        style={{
          position: "absolute",
          top: 84,
          left: 4,
          width: 14,
          height: 52,
          background:
            "linear-gradient(to bottom, #e0a880 0%, #c48060 60%, #a06040 100%)",
          borderRadius: "6px 6px 10px 10px",
          transform: "rotate(-12deg)",
          zIndex: 1,
        }}
      />
      {/* Left bracer */}
      <div
        style={{
          position: "absolute",
          top: 118,
          left: 4,
          width: 14,
          height: 10,
          background:
            "linear-gradient(to bottom, #f5d060 0%, #c9922b 50%, #a07010 100%)",
          borderRadius: 4,
          transform: "rotate(-12deg)",
          zIndex: 2,
          boxShadow: "0 0 5px rgba(245,208,96,0.5)",
        }}
      />

      {/* ── Right arm (skin + gold bracer) ── */}
      <div
        style={{
          position: "absolute",
          top: 84,
          right: 4,
          width: 14,
          height: 52,
          background:
            "linear-gradient(to bottom, #e0a880 0%, #c48060 60%, #a06040 100%)",
          borderRadius: "6px 6px 10px 10px",
          transform: "rotate(12deg)",
          zIndex: 1,
        }}
      />
      {/* Right bracer */}
      <div
        style={{
          position: "absolute",
          top: 118,
          right: 4,
          width: 14,
          height: 10,
          background:
            "linear-gradient(to bottom, #f5d060 0%, #c9922b 50%, #a07010 100%)",
          borderRadius: 4,
          transform: "rotate(12deg)",
          zIndex: 2,
          boxShadow: "0 0 5px rgba(245,208,96,0.5)",
        }}
      />

      {/* ── Armored corset ── */}
      <div
        style={{
          position: "absolute",
          top: 82,
          left: "50%",
          transform: "translateX(-50%)",
          width: 54,
          height: 54,
          background:
            "linear-gradient(160deg, #c02040 0%, #8b0020 40%, #5a0018 100%)",
          borderRadius: "8px 8px 4px 4px",
          zIndex: 2,
          boxShadow:
            "inset 0 4px 10px rgba(255,160,100,0.2), inset 0 -4px 10px rgba(0,0,0,0.5), 0 0 8px rgba(180,20,40,0.3)",
        }}
      >
        {/* Gold trim top edge */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background:
              "linear-gradient(to right, #a07010, #f5d060 50%, #a07010)",
            borderRadius: "8px 8px 0 0",
          }}
        />
        {/* Vertical channel lines */}
        <div
          style={{
            position: "absolute",
            top: 6,
            left: "30%",
            width: 1,
            height: 38,
            background: "rgba(245,208,96,0.35)",
            borderRadius: 1,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 6,
            right: "30%",
            width: 1,
            height: 38,
            background: "rgba(245,208,96,0.35)",
            borderRadius: 1,
          }}
        />
        {/* Horizontal detail lines */}
        <div
          style={{
            position: "absolute",
            top: 18,
            left: 8,
            right: 8,
            height: 1,
            background: "rgba(245,208,96,0.3)",
            borderRadius: 1,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 34,
            left: 8,
            right: 8,
            height: 1,
            background: "rgba(245,208,96,0.25)",
            borderRadius: 1,
          }}
        />
        {/* Center gem cluster */}
        {/* Left gold gem */}
        <div
          style={{
            position: "absolute",
            top: 8,
            left: "50%",
            marginLeft: -13,
            width: 7,
            height: 7,
            background:
              "radial-gradient(ellipse, #fff0a0 0%, #f5d060 50%, #a07010 100%)",
            borderRadius: "50%",
            boxShadow: "0 0 5px rgba(245,208,96,0.8)",
          }}
        />
        {/* Center crimson gem */}
        <div
          style={{
            position: "absolute",
            top: 6,
            left: "50%",
            transform: "translateX(-50%)",
            width: 10,
            height: 10,
            background:
              "radial-gradient(ellipse, #ff8888 0%, #cc0000 55%, #660000 100%)",
            borderRadius: "50%",
            boxShadow: "0 0 8px rgba(255,0,0,0.9), 0 0 16px rgba(200,0,0,0.4)",
          }}
        />
        {/* Right gold gem */}
        <div
          style={{
            position: "absolute",
            top: 8,
            left: "50%",
            marginLeft: 6,
            width: 7,
            height: 7,
            background:
              "radial-gradient(ellipse, #fff0a0 0%, #f5d060 50%, #a07010 100%)",
            borderRadius: "50%",
            boxShadow: "0 0 5px rgba(245,208,96,0.8)",
          }}
        />
      </div>

      {/* ── Skirt / Robe ── */}
      <div
        style={{
          position: "absolute",
          top: 133,
          left: "50%",
          transform: "translateX(-50%)",
          width: 72,
          height: 68,
          background:
            "linear-gradient(160deg, #8b0038 0%, #5a0030 40%, #38001e 100%)",
          borderRadius: "4px 4px 36px 36px",
          zIndex: 2,
          clipPath: "polygon(6% 0%, 94% 0%, 102% 100%, -2% 100%)",
          boxShadow: "inset 0 4px 10px rgba(180,0,80,0.3)",
        }}
      />
      {/* Gold hem border */}
      <div
        style={{
          position: "absolute",
          top: 194,
          left: "50%",
          transform: "translateX(-50%)",
          width: 80,
          height: 4,
          background:
            "linear-gradient(to right, transparent 0%, #c9922b 15%, #f5d060 50%, #c9922b 85%, transparent 100%)",
          zIndex: 3,
          borderRadius: 2,
          boxShadow: "0 0 6px rgba(245,208,96,0.5)",
        }}
      />
      {/* Robe shimmer overlay */}
      <div
        style={{
          position: "absolute",
          top: 133,
          left: "50%",
          transform: "translateX(-50%)",
          width: 72,
          height: 68,
          background:
            "linear-gradient(135deg, rgba(220,60,120,0.2) 0%, transparent 40%, rgba(100,0,60,0.3) 80%)",
          zIndex: 2,
          clipPath: "polygon(6% 0%, 94% 0%, 102% 100%, -2% 100%)",
          pointerEvents: "none",
        }}
      />
      {/* ── Running legs (visible below skirt) ── */}
      {/* Left leg */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "28%",
          width: 14,
          height: 40,
          background: "linear-gradient(to bottom, #e0a880, #c48060)",
          borderRadius: "4px 4px 6px 6px",
          transformOrigin: "top center",
          animation:
            pose === "standing"
              ? "leftLegRun 0.45s ease-in-out infinite"
              : "none",
          zIndex: 1,
        }}
      />
      {/* Left boot */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "25%",
          width: 18,
          height: 10,
          background: "linear-gradient(to bottom, #1a0a0a, #0d0505)",
          borderRadius: "3px 3px 5px 5px",
          transformOrigin: "top center",
          animation:
            pose === "standing"
              ? "leftLegRun 0.45s ease-in-out infinite"
              : "none",
          zIndex: 1,
        }}
      />
      {/* Right leg */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          right: "28%",
          width: 14,
          height: 40,
          background: "linear-gradient(to bottom, #e0a880, #c48060)",
          borderRadius: "4px 4px 6px 6px",
          transformOrigin: "top center",
          animation:
            pose === "standing"
              ? "rightLegRun 0.45s ease-in-out infinite"
              : "none",
          zIndex: 1,
        }}
      />
      {/* Right boot */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          right: "25%",
          width: 18,
          height: 10,
          background: "linear-gradient(to bottom, #1a0a0a, #0d0505)",
          borderRadius: "3px 3px 5px 5px",
          transformOrigin: "top center",
          animation:
            pose === "standing"
              ? "rightLegRun 0.45s ease-in-out infinite"
              : "none",
          zIndex: 1,
        }}
      />
    </div>
  );
}
// =====================
// GameOverScreen
// =====================
function GameOverScreen({ onRestart }: { onRestart: () => void }) {
  const [phase, setPhase] = useState(0);
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1000),
      setTimeout(() => setPhase(2), 3000),
      setTimeout(() => {
        setShaking(true);
        setTimeout(() => setShaking(false), 600);
      }, 4200),
      setTimeout(() => setPhase(3), 5500),
      setTimeout(() => setPhase(4), 8000),
      setTimeout(() => setPhase(5), 11000),
    ];
    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);

  const candles = [
    { left: "8%", delay: "0s" },
    { left: "18%", delay: "0.4s" },
    { left: "78%", delay: "0.2s" },
    { left: "88%", delay: "0.7s" },
  ];

  const bloodSplats = [
    { offsetX: -12, offsetY: 8, size: 28, delay: "0.05s" },
    { offsetX: 14, offsetY: 12, size: 20, delay: "0.1s" },
    { offsetX: 0, offsetY: 20, size: 36, delay: "0s" },
    { offsetX: -22, offsetY: 16, size: 16, delay: "0.15s" },
    { offsetX: 24, offsetY: 4, size: 22, delay: "0.08s" },
  ];

  const burstRays = Array.from({ length: 10 }, (_, i) => ({
    angle: i * 36,
    length: 40 + (i % 3) * 20,
    delay: `${i * 0.07}s`,
  }));

  const caption =
    phase === 1
      ? "She drags you to her lair..."
      : phase === 2
        ? "She HURLS you across the room!"
        : phase === 3
          ? "She slowly lies down on you..."
          : phase === 4
            ? "She feasts on you..."
            : "";

  return (
    <div
      className="overlay-screen gameover-overlay"
      style={{
        overflow: "hidden",
        background:
          "linear-gradient(to bottom, #0a0005 0%, #1a0008 40%, #0d0003 100%)",
        animation: shaking ? "screenShake 0.5s ease-in-out" : "none",
      }}
    >
      {/* Stone wall brick pattern */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "55%",
          background:
            "repeating-linear-gradient(0deg, transparent, transparent 34px, rgba(40,5,10,0.5) 34px, rgba(40,5,10,0.5) 36px)," +
            "repeating-linear-gradient(90deg, transparent, transparent 58px, rgba(40,5,10,0.4) 58px, rgba(40,5,10,0.4) 60px)",
          opacity: phase >= 1 ? 1 : 0,
          transition: "opacity 1.5s",
          zIndex: 1,
          pointerEvents: "none",
        }}
      />

      {/* Floor */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          height: "35%",
          background:
            "linear-gradient(to top, #0a0003 0%, #140008 60%, transparent 100%)",
          opacity: phase >= 1 ? 1 : 0,
          transition: "opacity 1.5s",
          zIndex: 1,
          pointerEvents: "none",
        }}
      />

      {/* Candles */}
      {candles.map((c) => (
        <div
          key={c.left}
          style={{
            position: "absolute",
            bottom: "30%",
            left: c.left,
            zIndex: 3,
            opacity: phase >= 1 ? 1 : 0,
            transition: "opacity 1s",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 8,
              height: 14,
              background:
                "radial-gradient(ellipse at 50% 70%, #ff9900, #ff4400, transparent)",
              borderRadius: "50% 50% 30% 30%",
              animation: "flickerCandle 1.2s ease-in-out infinite",
              animationDelay: c.delay,
              boxShadow: "0 0 12px 4px rgba(255,120,0,0.5)",
            }}
          />
          <div
            style={{
              width: 10,
              height: 30,
              background: "linear-gradient(to bottom, #d4c4a0, #a08060)",
              borderRadius: "2px 2px 0 0",
              boxShadow: "0 0 8px rgba(255,120,0,0.3)",
            }}
          />
        </div>
      ))}

      {/* Candle ambient glow */}
      {phase >= 1 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at 10% 70%, rgba(180,80,0,0.12) 0%, transparent 35%)," +
              "radial-gradient(ellipse at 90% 70%, rgba(180,80,0,0.12) 0%, transparent 35%)",
            animation: "flickerCandle 2s ease-in-out infinite",
            zIndex: 2,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Crimson vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            phase >= 4
              ? "radial-gradient(ellipse at center, rgba(100,0,0,0.5) 0%, rgba(0,0,0,0.97) 80%)"
              : "radial-gradient(ellipse at center, rgba(30,0,0,0.3) 0%, rgba(0,0,0,0.7) 80%)",
          transition: "background 2s",
          zIndex: 6,
          pointerEvents: "none",
        }}
      />

      {/* Phase 4: Pulsing red screen overlay */}
      {phase >= 4 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(120,0,0,0.18)",
            animation: "feastScreenPulse 0.8s ease-in-out infinite alternate",
            zIndex: 7,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Phase 0: Darkness intro text */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
          zIndex: 10,
          opacity: phase === 0 ? 1 : 0,
          transition: "opacity 0.8s",
          pointerEvents: "none",
          padding: "0 2rem",
        }}
      >
        <div
          style={{
            fontFamily: "'Fraunces', serif",
            fontSize: "clamp(1.4rem, 3.5vw, 2.8rem)",
            color: "rgba(200,50,50,0.95)",
            textShadow: "0 0 30px rgba(200,0,0,0.8)",
            lineHeight: 1.4,
          }}
        >
          No escape...
          <br />
          <span style={{ fontSize: "0.65em", color: "rgba(180,100,100,0.8)" }}>
            Nitya takes you to her chamber.
          </span>
        </div>
      </div>

      {/* Scene (phases 1-4) */}
      {phase >= 1 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 4,
            pointerEvents: "none",
          }}
        >
          {/* Caption */}
          {caption && (
            <div
              key={phase}
              style={{
                position: "absolute",
                top: "7%",
                left: "50%",
                transform: "translateX(-50%)",
                fontSize: "clamp(0.9rem, 2.2vw, 1.5rem)",
                color: "rgba(230,70,70,0.95)",
                fontFamily: "'Fraunces', serif",
                textAlign: "center",
                letterSpacing: "0.04em",
                animation: "fadeInSad 0.7s ease-in",
                textShadow: "0 0 18px rgba(200,0,0,0.9)",
                zIndex: 9,
                padding: "0 1.5rem",
                whiteSpace: "nowrap",
              }}
            >
              {caption}
            </div>
          )}

          {/* Phase 1: Nitya drags player from left */}
          {phase === 1 && (
            <div
              style={{
                position: "absolute",
                bottom: "22%",
                animation:
                  "nityaDragEnter 2.2s cubic-bezier(0.22,1,0.36,1) forwards",
                display: "flex",
                alignItems: "flex-end",
                gap: 14,
              }}
            >
              {/* Limp player silhouette being dragged on floor */}
              <div
                style={{
                  marginBottom: 8,
                  animation: "playerDragged 0.4s ease-in-out infinite",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  opacity: 0.85,
                }}
              >
                {/* Head */}
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "radial-gradient(ellipse, #4a2020, #2a1010)",
                    boxShadow: "0 0 6px rgba(120,0,0,0.5)",
                    marginBottom: 2,
                    marginLeft: 8,
                  }}
                />
                {/* Limp body horizontal */}
                <div
                  style={{
                    width: 44,
                    height: 12,
                    background: "linear-gradient(to right, #2a1010, #1a0808)",
                    borderRadius: 4,
                    boxShadow: "0 2px 8px rgba(100,0,0,0.4)",
                  }}
                />
                {/* Legs splayed out */}
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 2,
                  }}
                >
                  <div
                    style={{
                      width: 5,
                      height: 18,
                      background: "#2a1010",
                      borderRadius: 3,
                      transform: "rotate(-20deg)",
                    }}
                  />
                  <div
                    style={{
                      width: 5,
                      height: 18,
                      background: "#2a1010",
                      borderRadius: 3,
                      transform: "rotate(20deg)",
                    }}
                  />
                </div>
              </div>
              {/* Nitya CSS figure striding in */}
              <div
                style={{
                  animation: "nityaStride 0.5s ease-in-out infinite",
                  filter: "drop-shadow(0 0 16px rgba(200,0,0,0.9))",
                }}
              >
                <NityaFigure pose="standing" />
              </div>
            </div>
          )}

          {/* Phase 2: Throw */}
          {phase === 2 && (
            <>
              {/* Nitya winding up + throwing */}
              <div
                style={{
                  position: "absolute",
                  bottom: "18%",
                  left: "25%",
                  transform: "translateX(-50%)",
                  animation: "nityaThrowWindup 2.5s ease-in-out forwards",
                  filter: "drop-shadow(0 0 22px rgba(220,0,0,0.95))",
                  zIndex: 5,
                }}
              >
                <NityaFigure pose="standing" />
              </div>
              {/* Player flying through air in parabolic arc */}
              <div
                style={{
                  position: "absolute",
                  bottom: "40%",
                  left: "20%",
                  zIndex: 6,
                  animation:
                    "throwPlayerArc 2.0s cubic-bezier(0.3,0,0.7,1) forwards",
                  transformOrigin: "center center",
                }}
              >
                {/* Player spinning silhouette */}
                <div style={{ animation: "playerSpin 0.3s linear infinite" }}>
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: "radial-gradient(ellipse, #4a2020, #2a1010)",
                      margin: "0 auto",
                      boxShadow: "0 0 8px rgba(150,0,0,0.5)",
                    }}
                  />
                  <div
                    style={{
                      width: 12,
                      height: 24,
                      background: "#3a1a1a",
                      margin: "2px auto 0",
                      borderRadius: 3,
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: 5,
                      marginTop: 2,
                    }}
                  >
                    <div
                      style={{
                        width: 5,
                        height: 12,
                        background: "#2a1010",
                        borderRadius: 3,
                      }}
                    />
                    <div
                      style={{
                        width: 5,
                        height: 12,
                        background: "#2a1010",
                        borderRadius: 3,
                      }}
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Crashed player + blood splats (phase 2+ after impact) */}
          {phase >= 2 && (
            <div
              style={{
                position: "absolute",
                bottom: "22%",
                right: "18%",
                zIndex: 4,
                opacity: phase === 2 ? 0 : 1,
                transition: "opacity 0.3s",
                transitionDelay: "1.8s",
              }}
            >
              {bloodSplats.map((s) => (
                <div
                  key={`splat-${s.offsetX}-${s.offsetY}`}
                  style={{
                    position: "absolute",
                    left: s.offsetX,
                    top: s.offsetY,
                    width: s.size,
                    height: s.size,
                    borderRadius: "50%",
                    background:
                      "radial-gradient(ellipse, #8b0000 0%, #5a0000 60%, transparent 100%)",
                    animation:
                      "bloodSplat 0.6s cubic-bezier(0.22,1,0.36,1) forwards",
                    animationDelay: s.delay,
                    transform: "scale(0)",
                    opacity: 0.9,
                  }}
                />
              ))}
              {/* Head */}
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "#3a1a1a",
                  position: "absolute",
                  left: -12,
                  top: 4,
                  boxShadow: "0 0 8px rgba(120,0,0,0.6)",
                }}
              />
              {/* Flat body */}
              <div
                style={{
                  width: 52,
                  height: 14,
                  background: "linear-gradient(to right, #2a1010, #1a0808)",
                  borderRadius: 4,
                  animation: "crash 0.4s ease-out forwards",
                  boxShadow:
                    "0 4px 12px rgba(0,0,0,0.8), 0 0 16px rgba(120,0,0,0.4)",
                }}
              />
            </div>
          )}

          {/* Phase 3: Nitya slowly lies down */}
          {phase === 3 && (
            <div
              style={{
                position: "absolute",
                bottom: "20%",
                right: "12%",
                zIndex: 5,
                animation:
                  "nityaApproachAndLieDown 3.2s cubic-bezier(0.55,0,0.8,0.45) forwards",
                transformOrigin: "bottom center",
                filter: "drop-shadow(0 0 22px rgba(180,0,0,0.85))",
              }}
            >
              <NityaFigure pose="standing" />
              <div
                style={{
                  position: "absolute",
                  inset: "-24px",
                  borderRadius: "50%",
                  background:
                    "radial-gradient(ellipse, rgba(150,0,0,0.3) 0%, transparent 70%)",
                  animation: "feastPulse 1.8s ease-in-out infinite alternate",
                  pointerEvents: "none",
                }}
              />
            </div>
          )}

          {/* Phase 4: Feast - Nitya lying flat on player */}
          {phase >= 4 && (
            <div
              style={{
                position: "absolute",
                bottom: "18%",
                right: "8%",
                zIndex: 5,
                transformOrigin: "bottom center",
              }}
            >
              {/* Nitya lying flat, pulsing */}
              <div
                style={{
                  animation: "lyingBodyPulse 0.5s ease-in-out infinite",
                  filter: "drop-shadow(0 0 28px rgba(220,0,0,0.95))",
                }}
              >
                <NityaFigure pose="lying" showJaw={phase >= 4} />
              </div>

              {/* Spreading blood pool under her */}
              <div
                style={{
                  position: "absolute",
                  bottom: -10,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 200,
                  height: 80,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(ellipse, rgba(160,0,0,0.9) 0%, rgba(100,0,0,0.6) 50%, transparent 100%)",
                  animation: "bloodSpread 3s ease-out forwards",
                  zIndex: -1,
                }}
              />
              {/* Secondary blood blob */}
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: "20%",
                  width: 120,
                  height: 50,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(ellipse, rgba(140,0,0,0.8) 0%, transparent 80%)",
                  animation: "bloodSpread 4s 0.5s ease-out forwards",
                  zIndex: -1,
                }}
              />

              {/* Blood burst rays */}
              <div
                style={{
                  position: "absolute",
                  bottom: 20,
                  right: 20,
                  width: 0,
                  height: 0,
                  zIndex: 6,
                }}
              >
                {burstRays.map((ray) => (
                  <div
                    key={ray.angle}
                    style={{
                      position: "absolute",
                      width: ray.length,
                      height: 3,
                      background:
                        "linear-gradient(to right, rgba(160,0,0,0.9), transparent)",
                      transformOrigin: "left center",
                      transform: `rotate(${ray.angle}deg)`,
                      animation: "bloodSplat 0.5s ease-out infinite alternate",
                      animationDelay: ray.delay,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Phase 4: Blood pool under player on ground */}
          {phase >= 4 && (
            <div
              style={{
                position: "absolute",
                bottom: "16%",
                right: "14%",
                width: 160,
                height: 60,
                borderRadius: "50%",
                background:
                  "radial-gradient(ellipse, rgba(160,0,0,0.85) 0%, transparent 80%)",
                animation: "bloodPoolGrow 3s ease-out forwards",
                zIndex: 3,
              }}
            />
          )}
        </div>
      )}

      {/* Phase 5: GAME OVER */}
      {phase >= 5 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 20,
            background: "rgba(0,0,0,0.6)",
            animation: "fadeInSad 1.2s ease-in",
          }}
        >
          <div
            style={{
              fontFamily: "'Fraunces', serif",
              fontSize: "clamp(3rem, 9vw, 7rem)",
              fontWeight: 900,
              color: "#cc0000",
              textShadow:
                "0 0 40px rgba(220,0,0,0.9), 0 0 80px rgba(180,0,0,0.6), 2px 2px 0 #000",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              lineHeight: 1,
              marginBottom: "1.5rem",
              animation: "titlePulse 2s ease-in-out infinite",
            }}
          >
            GAME OVER
          </div>
          <div
            className="horror-divider"
            style={{ width: "min(380px, 80vw)" }}
          />
          <div
            style={{
              color: "rgba(200,80,80,0.9)",
              fontFamily: "'Fraunces', serif",
              fontSize: "clamp(0.85rem, 1.8vw, 1.1rem)",
              textAlign: "center",
              lineHeight: 1.8,
              marginTop: "1rem",
              marginBottom: "2rem",
              maxWidth: "min(420px, 88vw)",
            }}
          >
            There was no one left to remember you.
            <br />
            <span className="nitya-name">Nitya</span> was satisfied.
          </div>
          <button
            type="button"
            className="horror-btn"
            onClick={onRestart}
            data-ocid="game.primary_button"
          >
            Try Again
          </button>
        </div>
      )}
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
// =====================
// Rotate Overlay
// =====================
function RotateOverlay() {
  return (
    <div className="rotate-overlay" data-ocid="rotate.panel">
      <div className="rotate-overlay-icon">
        <div className="rotate-overlay-phone" />
        <div className="rotate-overlay-arrow" />
      </div>
      <div className="rotate-overlay-divider" />
      <div className="rotate-overlay-title">Rotate Your Device</div>
      <div className="rotate-overlay-sub">Landscape mode required to play</div>
    </div>
  );
}

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
    playerPosRef.current.set(0, PLAYER_HEIGHT, 14);
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
    <>
      <RotateOverlay />
      <div className="game-container">
        <Canvas
          camera={{
            position: [0, PLAYER_HEIGHT, 10],
            fov: 75,
            near: 0.1,
            far: 100,
          }}
          shadows
          gl={{ antialias: window.devicePixelRatio <= 1 }}
          dpr={Math.min(window.devicePixelRatio, 1.5)}
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
    </>
  );
}
