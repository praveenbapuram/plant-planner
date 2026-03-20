import React, { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Grid,
  Text,
  Line,
  ContactShadows,
  Billboard,
} from '@react-three/drei';
import * as THREE from 'three';
import './ThreeCanvas.css';

// ─── Constants ────────────────────────────────────────────────────
const SCALE = 0.01;
const EXTRUDE_HEIGHT = 0.3;

// Unit definitions: label, default pxPerUnit, grid cell (in unit), grid section (in unit)
const UNIT_DEFS = {
  px: { label: 'PX',  defaultPPU: 1,  gridCell: 50,  gridSection: 250, symbol: 'px' },
  m:  { label: 'M',   defaultPPU: 50, gridCell: 1,   gridSection: 5,   symbol: 'm'  },
  ft: { label: 'FT',  defaultPPU: 15, gridCell: 1,   gridSection: 5,   symbol: 'ft' },
};

const LINE_TYPE_COLORS = {
  general:    '#ffffff',
  piping:     '#06b6d4',
  electrical: '#f59e0b',
  fencing:    '#94a3b8',
  pathway:    '#34d399',
};

const VIEW_PRESETS = {
  perspective: { label: 'Free',  icon: '🎥', ortho: false },
  top:         { label: 'Top',   icon: '⬇️', ortho: true  },
  front:       { label: 'Front', icon: '👁️', ortho: true  },
  right:       { label: 'Right', icon: '➡️', ortho: true  },
};

// 6 standard engineering view definitions
const SIX_VIEWS = [
  { key: 'front',  label: 'Front',  cam: (cx, cz, d) => ({ pos: [cx, 0, cz + d], up: [0, 1, 0] }) },
  { key: 'back',   label: 'Back',   cam: (cx, cz, d) => ({ pos: [cx, 0, cz - d], up: [0, 1, 0] }) },
  { key: 'left',   label: 'Left',   cam: (cx, cz, d) => ({ pos: [cx - d, 0, cz], up: [0, 1, 0] }) },
  { key: 'right',  label: 'Right',  cam: (cx, cz, d) => ({ pos: [cx + d, 0, cz], up: [0, 1, 0] }) },
  { key: 'top',    label: 'Top',    cam: (cx, cz, d) => ({ pos: [cx, d, cz + 0.001], up: [0, 0, -1] }) },
  { key: 'bottom', label: 'Bottom', cam: (cx, cz, d) => ({ pos: [cx, -d, cz + 0.001], up: [0, 0, 1] }) },
];

// ─── Helpers ──────────────────────────────────────────────────────
function rgbaToHex(rgba) {
  if (!rgba || !rgba.startsWith('rgba')) return rgba;
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return '#34d399';
  const [, r, g, b] = match;
  return `#${[r, g, b].map(c => parseInt(c).toString(16).padStart(2, '0')).join('')}`;
}

function to3D(x, y, height = 0) {
  return [x * SCALE, height, -y * SCALE];
}

function computeBounds(shapes) {
  if (!shapes || shapes.length === 0) return { cx: 0, cz: 0, extent: 5 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  shapes.forEach(s => {
    const sx = (s.x || 0) * SCALE;
    const sz = -(s.y || 0) * SCALE;
    const sw = (s.width || (s.radius || 25) * 2) * SCALE;
    const sd = (s.height || (s.radius || 25) * 2) * SCALE;
    minX = Math.min(minX, sx - sw / 2);
    maxX = Math.max(maxX, sx + sw / 2);
    minZ = Math.min(minZ, sz - sd / 2);
    maxZ = Math.max(maxZ, sz + sd / 2);
  });
  return {
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    extent: Math.max(maxX - minX, maxZ - minZ, 3),
  };
}

// Common props for interactive meshes
function useMeshInteraction(shapeId, onSelect, isDraggable, onDrag) {
  const [hovered, setHovered] = useState(false);
  const handlers = useMemo(() => ({
    onClick: (e) => { e.stopPropagation(); onSelect(shapeId); },
    onPointerOver: (e) => {
      setHovered(true);
      if (isDraggable) document.body.style.cursor = 'grab';
    },
    onPointerOut: () => {
      setHovered(false);
      document.body.style.cursor = '';
    },
    onPointerDown: (e) => {
      if (isDraggable) {
        document.body.style.cursor = 'grabbing';
        onDrag?.(e, shapeId);
      }
    },
  }), [shapeId, onSelect, isDraggable, onDrag]);
  return { hovered, handlers };
}

function ShapeLabel({ name, position }) {
  if (!name) return null;
  return (
    <Billboard position={position}>
      <Text fontSize={0.18} color="#f0fdf4" anchorY="bottom" outlineWidth={0.01} outlineColor="#000000">{name}</Text>
    </Billboard>
  );
}

function mat(fill, opacity, isSelected, hovered, opts = {}) {
  return (
    <meshStandardMaterial
      color={fill}
      transparent
      opacity={hovered ? Math.min(opacity + 0.2, 1) : opacity}
      emissive={isSelected ? fill : '#000000'}
      emissiveIntensity={isSelected ? 0.3 : 0}
      roughness={opts.roughness ?? 0.6}
      metalness={opts.metalness ?? 0.1}
      side={opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide}
    />
  );
}

// ═════════════════════════════════════════════════════════════════
//  3D SHAPE RENDERERS
// ═════════════════════════════════════════════════════════════════

// ─── Rectangle / Box ──────────────────────────────────────────────
function Rectangle3D({ shape, isSelected, onSelect, isDraggable, onDrag }) {
  const w = (shape.width || 50) * SCALE;
  const d = (shape.height || 50) * SCALE;
  const h = shape.extrudeHeight || EXTRUDE_HEIGHT;
  const fill = rgbaToHex(shape.fill) || shape.stroke || '#34d399';
  const { hovered, handlers } = useMeshInteraction(shape.id, onSelect, isDraggable, onDrag);

  const pos = useMemo(() => {
    const cx = (shape.x + (shape.width || 50) / 2) * SCALE;
    const cz = -(shape.y + (shape.height || 50) / 2) * SCALE;
    return [cx, h / 2, cz];
  }, [shape.x, shape.y, shape.width, shape.height, h]);

  return (
    <group>
      <mesh position={pos} rotation={[0, -(shape.rotation || 0) * Math.PI / 180, 0]}
        {...handlers} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        {mat(fill, shape.opacity ?? 0.7, isSelected, hovered)}
      </mesh>
      <lineSegments position={pos} rotation={[0, -(shape.rotation || 0) * Math.PI / 180, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(w, h, d)]} />
        <lineBasicMaterial color={isSelected ? '#ffffff' : (shape.stroke || '#34d399')} linewidth={2} />
      </lineSegments>
      <ShapeLabel name={shape.name} position={[pos[0], h + 0.15, pos[2]]} />
    </group>
  );
}

// ─── Circle / Cylinder ────────────────────────────────────────────
function Circle3D({ shape, isSelected, onSelect, isDraggable, onDrag }) {
  const r = (shape.radius || 30) * SCALE;
  const h = shape.extrudeHeight || EXTRUDE_HEIGHT;
  const fill = rgbaToHex(shape.fill) || shape.stroke || '#34d399';
  const { hovered, handlers } = useMeshInteraction(shape.id, onSelect, isDraggable, onDrag);
  const pos = useMemo(() => to3D(shape.x, shape.y, h / 2), [shape.x, shape.y, h]);

  return (
    <group>
      <mesh position={pos} {...handlers} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, h, 32]} />
        {mat(fill, shape.opacity ?? 0.7, isSelected, hovered)}
      </mesh>
      <lineSegments position={pos}>
        <edgesGeometry args={[new THREE.CylinderGeometry(r, r, h, 32)]} />
        <lineBasicMaterial color={isSelected ? '#ffffff' : (shape.stroke || '#34d399')} />
      </lineSegments>
      <ShapeLabel name={shape.name} position={[pos[0], h + 0.15, pos[2]]} />
    </group>
  );
}

// ─── Ellipse ──────────────────────────────────────────────────────
function Ellipse3D({ shape, isSelected, onSelect, isDraggable, onDrag }) {
  const rx = (shape.radiusX || 40) * SCALE;
  const ry = (shape.radiusY || 25) * SCALE;
  const h = shape.extrudeHeight || EXTRUDE_HEIGHT;
  const fill = rgbaToHex(shape.fill) || shape.stroke || '#34d399';
  const { hovered, handlers } = useMeshInteraction(shape.id, onSelect, isDraggable, onDrag);
  const pos = useMemo(() => to3D(shape.x, shape.y, h / 2), [shape.x, shape.y, h]);

  return (
    <group>
      <mesh position={pos} scale={[rx, 1, ry]} {...handlers} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, h, 32]} />
        {mat(fill, shape.opacity ?? 0.7, isSelected, hovered)}
      </mesh>
      <ShapeLabel name={shape.name} position={[pos[0], h + 0.15, pos[2]]} />
    </group>
  );
}

// ─── Triangle ─────────────────────────────────────────────────────
function Triangle3D({ shape, isSelected, onSelect, isDraggable, onDrag }) {
  const r = (shape.radius || 30) * SCALE;
  const h = shape.extrudeHeight || EXTRUDE_HEIGHT;
  const fill = rgbaToHex(shape.fill) || shape.stroke || '#34d399';
  const { hovered, handlers } = useMeshInteraction(shape.id, onSelect, isDraggable, onDrag);
  const pos = useMemo(() => to3D(shape.x, shape.y, 0), [shape.x, shape.y]);

  const geometry = useMemo(() => {
    const triShape = new THREE.Shape();
    const pts = [];
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI / 3) - Math.PI / 2;
      pts.push(new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r));
    }
    triShape.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => triShape.lineTo(p.x, p.y));
    triShape.closePath();
    const geom = new THREE.ExtrudeGeometry(triShape, { depth: h, bevelEnabled: false });
    geom.rotateX(-Math.PI / 2);
    return geom;
  }, [r, h]);

  return (
    <group>
      <mesh geometry={geometry} position={[pos[0], 0, pos[2]]}
        rotation={[0, -(shape.rotation || 0) * Math.PI / 180, 0]}
        {...handlers} castShadow receiveShadow>
        {mat(fill, shape.opacity ?? 0.7, isSelected, hovered, { doubleSide: true })}
      </mesh>
      <ShapeLabel name={shape.name} position={[pos[0], h + 0.15, pos[2]]} />
    </group>
  );
}

// ─── Polygon / Boundary ──────────────────────────────────────────
function Polygon3D({ shape, isSelected, onSelect, isDraggable, onDrag }) {
  const h = shape.extrudeHeight || EXTRUDE_HEIGHT;
  const fill = rgbaToHex(shape.fill) || shape.stroke || '#34d399';
  const { hovered, handlers } = useMeshInteraction(shape.id, onSelect, isDraggable, onDrag);

  const geometry = useMemo(() => {
    if (!shape.points || shape.points.length < 6) return null;
    const pts = [];
    for (let i = 0; i < shape.points.length; i += 2) {
      pts.push(new THREE.Vector2(shape.points[i] * SCALE, -shape.points[i + 1] * SCALE));
    }
    const polyShape = new THREE.Shape(pts);
    const geom = new THREE.ExtrudeGeometry(polyShape, { depth: h, bevelEnabled: false });
    geom.rotateX(-Math.PI / 2);
    return geom;
  }, [shape.points, h]);

  if (!geometry) return null;

  const centroid = useMemo(() => {
    if (!shape.points) return [0, 0, 0];
    let cx = 0, cy = 0, n = shape.points.length / 2;
    for (let i = 0; i < shape.points.length; i += 2) { cx += shape.points[i]; cy += shape.points[i + 1]; }
    return [cx / n * SCALE, h + 0.15, -cy / n * SCALE];
  }, [shape.points, h]);

  return (
    <group>
      <mesh geometry={geometry} {...handlers} castShadow receiveShadow>
        {mat(fill, shape.opacity ?? 0.7, isSelected, hovered, { doubleSide: true })}
      </mesh>
      <ShapeLabel name={shape.name} position={centroid} />
    </group>
  );
}

// ─── Line ─────────────────────────────────────────────────────────
function Line3D({ shape, isSelected, onSelect }) {
  const [hovered, setHovered] = useState(false);

  const points = useMemo(() => {
    if (!shape.points || shape.points.length < 4) return null;
    const pts = [];
    for (let i = 0; i < shape.points.length; i += 2) {
      pts.push(new THREE.Vector3(shape.points[i] * SCALE, 0.05, -shape.points[i + 1] * SCALE));
    }
    return pts;
  }, [shape.points]);

  if (!points) return null;
  const lineColor = shape.stroke || LINE_TYPE_COLORS[shape.lineType] || '#ffffff';
  const lineWidth = (shape.strokeWidth || 3) * 0.8;

  return (
    <group>
      <Line points={points} color={isSelected ? '#ffffff' : lineColor}
        lineWidth={hovered ? lineWidth + 1 : lineWidth}
        onClick={(e) => { e.stopPropagation(); onSelect(shape.id); }}
        onPointerOver={() => setHovered(true)} onPointerOut={() => setHovered(false)}
        dashed={shape.dash && shape.dash.length > 0}
        dashSize={shape.dash?.[0] ? shape.dash[0] * SCALE : undefined}
        gapSize={shape.dash?.[1] ? shape.dash[1] * SCALE : undefined}
      />
      {shape.lineType === 'piping' && (
        <mesh>
          <tubeGeometry args={[new THREE.CatmullRomCurve3(points), 20, 0.04, 8, false]} />
          <meshStandardMaterial color={lineColor} transparent opacity={0.6} roughness={0.3} metalness={0.5} />
        </mesh>
      )}
      <ShapeLabel name={shape.name} position={[
        (points[0].x + points[points.length - 1].x) / 2, 0.25,
        (points[0].z + points[points.length - 1].z) / 2
      ]} />
    </group>
  );
}

// ─── Arc ──────────────────────────────────────────────────────────
function Arc3D({ shape, isSelected, onSelect, isDraggable, onDrag }) {
  const outerR = (shape.outerRadius || 50) * SCALE;
  const innerR = (shape.innerRadius || 30) * SCALE;
  const h = shape.extrudeHeight || EXTRUDE_HEIGHT * 0.5;
  const fill = rgbaToHex(shape.fill) || shape.stroke || '#34d399';
  const { hovered, handlers } = useMeshInteraction(shape.id, onSelect, isDraggable, onDrag);
  const pos = useMemo(() => to3D(shape.x, shape.y, h / 2), [shape.x, shape.y, h]);

  const geometry = useMemo(() => {
    const from = (shape.angleFrom || 0) * Math.PI / 180;
    const to = (shape.angleTo || 270) * Math.PI / 180;
    const arcShape = new THREE.Shape();
    arcShape.absarc(0, 0, outerR, from, to, false);
    arcShape.absarc(0, 0, innerR, to, from, true);
    arcShape.closePath();
    const geom = new THREE.ExtrudeGeometry(arcShape, { depth: h, bevelEnabled: false });
    geom.rotateX(-Math.PI / 2);
    return geom;
  }, [outerR, innerR, h, shape.angleFrom, shape.angleTo]);

  return (
    <group>
      <mesh geometry={geometry} position={[pos[0], 0, pos[2]]} {...handlers} castShadow receiveShadow>
        {mat(fill, shape.opacity ?? 0.7, isSelected, hovered, { doubleSide: true })}
      </mesh>
      <ShapeLabel name={shape.name} position={[pos[0], h + 0.15, pos[2]]} />
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════
//  REAL-WORLD 3D ELEMENT RENDERERS
// ═════════════════════════════════════════════════════════════════

// ─── Tank (cylinder body + dome top + rim) ────────────────────────
function Tank3D({ shape, isSelected, onSelect, isDraggable, onDrag }) {
  const r = (shape.radius || 40) * SCALE;
  const h = shape.extrudeHeight || 1.0;
  const { hovered, handlers } = useMeshInteraction(shape.id, onSelect, isDraggable, onDrag);
  const pos = useMemo(() => to3D(shape.x, shape.y, 0), [shape.x, shape.y]);

  return (
    <group position={[pos[0], 0, pos[2]]}>
      {/* Body */}
      <mesh position={[0, h / 2, 0]} {...handlers} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, h, 32]} />
        <meshStandardMaterial color="#64748b" transparent opacity={hovered ? 0.95 : 0.85}
          emissive={isSelected ? '#64748b' : '#000'} emissiveIntensity={isSelected ? 0.3 : 0}
          roughness={0.3} metalness={0.7} />
      </mesh>
      {/* Dome top */}
      <mesh position={[0, h, 0]} castShadow>
        <sphereGeometry args={[r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.3} metalness={0.6}
          transparent opacity={0.9} />
      </mesh>
      {/* Rim ring */}
      <mesh position={[0, h * 0.02, 0]}>
        <torusGeometry args={[r, r * 0.05, 8, 32]} />
        <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.8} />
      </mesh>
      {/* Edge outline */}
      <lineSegments position={[0, h / 2, 0]}>
        <edgesGeometry args={[new THREE.CylinderGeometry(r, r, h, 32)]} />
        <lineBasicMaterial color={isSelected ? '#fff' : '#94a3b8'} />
      </lineSegments>
      <ShapeLabel name={shape.name || 'Tank'} position={[0, h + r + 0.2, 0]} />
    </group>
  );
}

// ─── House (box body + triangular roof) ──────────────────────────
function House3D({ shape, isSelected, onSelect, isDraggable, onDrag }) {
  // All dims in px, converted with SCALE for 3D
  const len  = (shape.houseLength || shape.width || 120) * SCALE;  // X axis
  const wid  = (shape.houseWidth  || shape.depth || 100) * SCALE;  // Z axis
  const wallH = (shape.houseHeight || 80) * SCALE;                 // Y axis (wall height)
  const roofH = (shape.roofHeight  || 40) * SCALE;                 // Y axis (roof above walls)
  const { hovered, handlers } = useMeshInteraction(shape.id, onSelect, isDraggable, onDrag);
  const pos = useMemo(() => {
    const cx = (shape.x + (shape.houseLength || shape.width || 120) / 2) * SCALE;
    const cz = -(shape.y + (shape.houseWidth || shape.depth || 100) / 2) * SCALE;
    return [cx, 0, cz];
  }, [shape.x, shape.y, shape.houseLength, shape.width, shape.houseWidth, shape.depth]);

  // Roof geometry — triangular prism
  const roofGeom = useMemo(() => {
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-len / 2 - 0.02, 0);
    roofShape.lineTo(0, roofH);
    roofShape.lineTo(len / 2 + 0.02, 0);
    roofShape.closePath();
    const geom = new THREE.ExtrudeGeometry(roofShape, { depth: wid + 0.04, bevelEnabled: false });
    geom.translate(0, 0, -(wid + 0.04) / 2);
    return geom;
  }, [len, wid, roofH]);

  // Door proportional to wall height
  const doorH = Math.min(wallH * 0.6, wallH - 0.02);
  const doorW = len * 0.18;

  return (
    <group position={pos}>
      {/* Walls */}
      <mesh position={[0, wallH / 2, 0]} {...handlers} castShadow receiveShadow>
        <boxGeometry args={[len, wallH, wid]} />
        <meshStandardMaterial color="#e2e8f0" transparent opacity={hovered ? 0.95 : 0.9}
          emissive={isSelected ? '#e2e8f0' : '#000'} emissiveIntensity={isSelected ? 0.2 : 0}
          roughness={0.8} metalness={0.05} />
      </mesh>
      {/* Door */}
      <mesh position={[0, doorH / 2, wid / 2 + 0.001]}>
        <boxGeometry args={[doorW, doorH, 0.01]} />
        <meshStandardMaterial color="#78350f" roughness={0.9} />
      </mesh>
      {/* Windows */}
      {[-1, 1].map(side => (
        <mesh key={side} position={[side * len * 0.3, wallH * 0.6, wid / 2 + 0.001]}>
          <boxGeometry args={[len * 0.15, wallH * 0.25, 0.01]} />
          <meshStandardMaterial color="#7dd3fc" roughness={0.1} metalness={0.3} transparent opacity={0.7} />
        </mesh>
      ))}
      {/* Roof */}
      <mesh geometry={roofGeom} position={[0, wallH, 0]} castShadow>
        <meshStandardMaterial color="#dc2626" roughness={0.7} metalness={0.1} side={THREE.DoubleSide} />
      </mesh>
      {/* Wall edges */}
      <lineSegments position={[0, wallH / 2, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(len, wallH, wid)]} />
        <lineBasicMaterial color={isSelected ? '#fff' : '#94a3b8'} />
      </lineSegments>
      <ShapeLabel name={shape.name || 'House'} position={[0, wallH + roofH + 0.2, 0]} />
    </group>
  );
}

// ─── Tree (trunk cylinder + 3 layered cones for canopy) ──────────
function Tree3D({ shape, isSelected, onSelect, isDraggable, onDrag }) {
  const trunkR = (shape.trunkRadius || 5) * SCALE;
  const trunkH = shape.trunkHeight || 0.4;
  const canopyR = (shape.canopyRadius || 30) * SCALE;
  const canopyH = shape.extrudeHeight || 0.8;
  const { hovered, handlers } = useMeshInteraction(shape.id, onSelect, isDraggable, onDrag);
  const pos = useMemo(() => to3D(shape.x, shape.y, 0), [shape.x, shape.y]);

  return (
    <group position={[pos[0], 0, pos[2]]}>
      {/* Trunk */}
      <mesh position={[0, trunkH / 2, 0]} {...handlers} castShadow>
        <cylinderGeometry args={[trunkR, trunkR * 1.3, trunkH, 8]} />
        <meshStandardMaterial color="#92400e" roughness={0.9} metalness={0.0} />
      </mesh>
      {/* Canopy layers — 3 stacked cones */}
      {[0, 1, 2].map(i => {
        const layerR = canopyR * (1 - i * 0.2);
        const layerH = canopyH * 0.45;
        const yOff = trunkH + i * layerH * 0.55;
        return (
          <mesh key={i} position={[0, yOff, 0]} castShadow>
            <coneGeometry args={[layerR, layerH, 8]} />
            <meshStandardMaterial
              color={hovered ? '#4ade80' : '#16a34a'}
              transparent opacity={0.9}
              emissive={isSelected ? '#16a34a' : '#000'}
              emissiveIntensity={isSelected ? 0.3 : 0}
              roughness={0.8} metalness={0.0}
            />
          </mesh>
        );
      })}
      <ShapeLabel name={shape.name || 'Tree'} position={[0, trunkH + canopyH * 1.2 + 0.15, 0]} />
    </group>
  );
}

// ─── Wall (long thin extruded box) ───────────────────────────────
function Wall3D({ shape, isSelected, onSelect, isDraggable, onDrag }) {
  const w = (shape.width || 200) * SCALE;
  const t = (shape.thickness || 10) * SCALE;
  const h = shape.extrudeHeight || 1.0;
  const { hovered, handlers } = useMeshInteraction(shape.id, onSelect, isDraggable, onDrag);

  const pos = useMemo(() => {
    const cx = (shape.x + (shape.width || 200) / 2) * SCALE;
    const cz = -(shape.y + (shape.thickness || 10) / 2) * SCALE;
    return [cx, h / 2, cz];
  }, [shape.x, shape.y, shape.width, shape.thickness, h]);

  return (
    <group>
      <mesh position={pos} rotation={[0, -(shape.rotation || 0) * Math.PI / 180, 0]}
        {...handlers} castShadow receiveShadow>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color="#78716c" transparent opacity={hovered ? 0.95 : 0.9}
          emissive={isSelected ? '#78716c' : '#000'} emissiveIntensity={isSelected ? 0.25 : 0}
          roughness={0.85} metalness={0.05} />
      </mesh>
      {/* Brick line pattern */}
      <lineSegments position={pos} rotation={[0, -(shape.rotation || 0) * Math.PI / 180, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(w, h, t)]} />
        <lineBasicMaterial color={isSelected ? '#fff' : '#a8a29e'} />
      </lineSegments>
      <ShapeLabel name={shape.name || 'Wall'} position={[pos[0], h + 0.15, pos[2]]} />
    </group>
  );
}

// ─── Pipe (tube along a path) ────────────────────────────────────
function Pipe3D({ shape, isSelected, onSelect }) {
  const [hovered, setHovered] = useState(false);
  const pipeRadius = (shape.pipeRadius || 5) * SCALE;

  const points = useMemo(() => {
    if (!shape.points || shape.points.length < 4) return null;
    const pts = [];
    for (let i = 0; i < shape.points.length; i += 2) {
      pts.push(new THREE.Vector3(shape.points[i] * SCALE, pipeRadius + 0.01, -shape.points[i + 1] * SCALE));
    }
    return pts;
  }, [shape.points, pipeRadius]);

  if (!points) return null;

  return (
    <group>
      {/* Outer pipe */}
      <mesh onClick={(e) => { e.stopPropagation(); onSelect(shape.id); }}
        onPointerOver={() => setHovered(true)} onPointerOut={() => setHovered(false)}
        castShadow>
        <tubeGeometry args={[new THREE.CatmullRomCurve3(points), 64, pipeRadius, 16, false]} />
        <meshStandardMaterial color={hovered ? '#22d3ee' : '#06b6d4'}
          transparent opacity={0.85} roughness={0.2} metalness={0.7}
          emissive={isSelected ? '#06b6d4' : '#000'} emissiveIntensity={isSelected ? 0.3 : 0} />
      </mesh>
      {/* Flanges at joints */}
      {points.map((pt, i) => (
        <mesh key={i} position={pt} castShadow>
          <torusGeometry args={[pipeRadius * 1.3, pipeRadius * 0.15, 8, 16]} />
          <meshStandardMaterial color="#0891b2" roughness={0.3} metalness={0.8} />
        </mesh>
      ))}
      <ShapeLabel name={shape.name || 'Pipe'} position={[
        (points[0].x + points[points.length - 1].x) / 2, pipeRadius * 2 + 0.2,
        (points[0].z + points[points.length - 1].z) / 2
      ]} />
    </group>
  );
}

// ─── Cable (thin dipping line with posts) ─────────────────────────
function Cable3D({ shape, isSelected, onSelect }) {
  const [hovered, setHovered] = useState(false);
  const cableRadius = (shape.cableRadius || 2) * SCALE;
  const postHeight = shape.postHeight || 0.5;

  const points = useMemo(() => {
    if (!shape.points || shape.points.length < 4) return null;
    const pts = [];
    for (let i = 0; i < shape.points.length; i += 2) {
      pts.push(new THREE.Vector3(shape.points[i] * SCALE, postHeight, -shape.points[i + 1] * SCALE));
    }
    // Add sag between points
    if (pts.length === 2) {
      const mid = new THREE.Vector3().lerpVectors(pts[0], pts[1], 0.5);
      mid.y = postHeight * 0.6; // sag
      return [pts[0], mid, pts[1]];
    }
    return pts;
  }, [shape.points, postHeight]);

  if (!points) return null;

  return (
    <group>
      {/* Cable line */}
      <mesh onClick={(e) => { e.stopPropagation(); onSelect(shape.id); }}
        onPointerOver={() => setHovered(true)} onPointerOut={() => setHovered(false)}>
        <tubeGeometry args={[new THREE.CatmullRomCurve3(points), 32, cableRadius, 8, false]} />
        <meshStandardMaterial color={hovered ? '#fbbf24' : '#f59e0b'}
          emissive={isSelected ? '#f59e0b' : '#000'} emissiveIntensity={isSelected ? 0.4 : 0}
          roughness={0.5} metalness={0.3} />
      </mesh>
      {/* Posts at endpoints */}
      {[points[0], points[points.length - 1]].map((pt, i) => (
        <mesh key={i} position={[pt.x, postHeight / 2, pt.z]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, postHeight, 6]} />
          <meshStandardMaterial color="#78716c" roughness={0.8} metalness={0.2} />
        </mesh>
      ))}
      <ShapeLabel name={shape.name || 'Cable'} position={[
        (points[0].x + points[points.length - 1].x) / 2, postHeight + 0.2,
        (points[0].z + points[points.length - 1].z) / 2
      ]} />
    </group>
  );
}

// ─── Path / Pathway (flat wide strip on ground) ──────────────────
function Path3D({ shape, isSelected, onSelect, isDraggable, onDrag }) {
  const w = (shape.pathWidth || 30) * SCALE;
  const len = (shape.width || 200) * SCALE;
  const { hovered, handlers } = useMeshInteraction(shape.id, onSelect, isDraggable, onDrag);

  const pos = useMemo(() => {
    const cx = (shape.x + (shape.width || 200) / 2) * SCALE;
    const cz = -(shape.y + (shape.pathWidth || 30) / 2) * SCALE;
    return [cx, 0.015, cz];
  }, [shape.x, shape.y, shape.width, shape.pathWidth]);

  return (
    <group>
      <mesh position={pos} rotation={[0, -(shape.rotation || 0) * Math.PI / 180, 0]}
        {...handlers} receiveShadow>
        <boxGeometry args={[len, 0.03, w]} />
        <meshStandardMaterial color={hovered ? '#a3e635' : '#34d399'}
          transparent opacity={0.75}
          emissive={isSelected ? '#34d399' : '#000'} emissiveIntensity={isSelected ? 0.3 : 0}
          roughness={0.9} metalness={0.0} />
      </mesh>
      {/* Dashed center line */}
      <Line
        points={[[pos[0] - len / 2, 0.035, pos[2]], [pos[0] + len / 2, 0.035, pos[2]]]}
        color="#f0fdf4" lineWidth={1} dashed dashSize={0.1} gapSize={0.05}
      />
      <ShapeLabel name={shape.name || 'Path'} position={[pos[0], 0.25, pos[2]]} />
    </group>
  );
}

// ─── Road (wider paved surface with lane markings) ───────────────
function Road3D({ shape, isSelected, onSelect, isDraggable, onDrag }) {
  const w = (shape.roadWidth || 60) * SCALE;
  const len = (shape.width || 300) * SCALE;
  const { hovered, handlers } = useMeshInteraction(shape.id, onSelect, isDraggable, onDrag);

  const pos = useMemo(() => {
    const cx = (shape.x + (shape.width || 300) / 2) * SCALE;
    const cz = -(shape.y + (shape.roadWidth || 60) / 2) * SCALE;
    return [cx, 0.01, cz];
  }, [shape.x, shape.y, shape.width, shape.roadWidth]);

  return (
    <group>
      {/* Asphalt surface */}
      <mesh position={pos} rotation={[0, -(shape.rotation || 0) * Math.PI / 180, 0]}
        {...handlers} receiveShadow>
        <boxGeometry args={[len, 0.02, w]} />
        <meshStandardMaterial color={hovered ? '#4b5563' : '#374151'}
          transparent opacity={0.95}
          emissive={isSelected ? '#374151' : '#000'} emissiveIntensity={isSelected ? 0.2 : 0}
          roughness={0.95} metalness={0.0} />
      </mesh>
      {/* Center dashed line */}
      <Line
        points={[[pos[0] - len / 2, 0.025, pos[2]], [pos[0] + len / 2, 0.025, pos[2]]]}
        color="#fbbf24" lineWidth={2} dashed dashSize={0.15} gapSize={0.1}
      />
      {/* Edge lines */}
      {[-1, 1].map(side => (
        <Line key={side}
          points={[
            [pos[0] - len / 2, 0.025, pos[2] + side * w * 0.45],
            [pos[0] + len / 2, 0.025, pos[2] + side * w * 0.45]
          ]}
          color="#e5e7eb" lineWidth={1.5}
        />
      ))}
      <ShapeLabel name={shape.name || 'Road'} position={[pos[0], 0.25, pos[2]]} />
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════
//  SHAPE DISPATCHER
// ═════════════════════════════════════════════════════════════════
function Shape3D({ shape, isSelected, onSelect, isDraggable, onDrag, onDragEnd }) {
  const props = { shape, isSelected, onSelect, isDraggable, onDrag, onDragEnd };

  switch (shape.type) {
    case 'rectangle':  return <Rectangle3D {...props} />;
    case 'circle':     return <Circle3D {...props} />;
    case 'ellipse':    return <Ellipse3D {...props} />;
    case 'triangle':   return <Triangle3D {...props} />;
    case 'boundary':
    case 'polygon':
    case 'curve':      return <Polygon3D {...props} />;
    case 'line':
    case 'path_line':  return <Line3D {...props} />;
    case 'arc':        return <Arc3D {...props} />;
    // Real-world elements
    case 'tank':       return <Tank3D {...props} />;
    case 'house':      return <House3D {...props} />;
    case 'tree':       return <Tree3D {...props} />;
    case 'wall':       return <Wall3D {...props} />;
    case 'pipe':       return <Pipe3D {...props} />;
    case 'cable':      return <Cable3D {...props} />;
    case 'path':       return <Path3D {...props} />;
    case 'road':       return <Road3D {...props} />;
    default:
      return (
        <mesh position={to3D(shape.x || 0, shape.y || 0, 0.15)}
          onClick={(e) => { e.stopPropagation(); onSelect(shape.id); }}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial color="#f59e0b" />
        </mesh>
      );
  }
}

// ═════════════════════════════════════════════════════════════════
//  ELEMENT CATALOG
// ═════════════════════════════════════════════════════════════════
const ELEMENT_CATALOG = [
  // Primitives
  { type: 'rectangle', icon: '⬛', label: 'Box',      group: 'shape', dims: { width: 100, height: 80, extrudeHeight: 0.5 } },
  { type: 'circle',    icon: '⚫', label: 'Cylinder', group: 'shape', dims: { radius: 40, extrudeHeight: 0.5 } },
  { type: 'triangle',  icon: '🔺', label: 'Prism',   group: 'shape', dims: { radius: 40, extrudeHeight: 0.5 } },
  // Real-world elements
  { type: 'tank',      icon: '🛢️', label: 'Tank',    group: 'real',  dims: { radius: 40, extrudeHeight: 1.0 } },
  { type: 'house',     icon: '🏠', label: 'House',   group: 'real',  dims: { houseLength: 120, houseWidth: 100, houseHeight: 80, roofHeight: 40 } },
  { type: 'tree',      icon: '🌲', label: 'Tree',    group: 'real',  dims: { trunkRadius: 5, trunkHeight: 0.4, canopyRadius: 30, extrudeHeight: 0.8 } },
  { type: 'wall',      icon: '🧱', label: 'Wall',    group: 'real',  dims: { width: 200, thickness: 10, extrudeHeight: 1.0 } },
  { type: 'pipe',      icon: '💧', label: 'Pipe',    group: 'real',  dims: { length: 200, pipeRadius: 5 } },
  { type: 'cable',     icon: '⚡', label: 'Cable',   group: 'real',  dims: { length: 200, cableRadius: 2, postHeight: 0.5 } },
  { type: 'path',      icon: '👣', label: 'Path',    group: 'real',  dims: { width: 200, pathWidth: 30 } },
  { type: 'road',      icon: '🛣️', label: 'Road',    group: 'real',  dims: { width: 300, roadWidth: 60 } },
];

// Dimension labels
const DIM_LABELS = {
  width: 'Length (px)', height: 'Depth (px)', depth: 'Depth (px)',
  radius: 'Radius (px)', radiusX: 'Radius X (px)', radiusY: 'Radius Y (px)',
  extrudeHeight: '3D Height', length: 'Length (px)',
  outerRadius: 'Outer R (px)', innerRadius: 'Inner R (px)',
  angleFrom: 'Angle From', angleTo: 'Angle To', sides: 'Sides',
  thickness: 'Thickness (px)', pipeRadius: 'Pipe Radius (px)',
  cableRadius: 'Cable Radius (px)', postHeight: 'Post Height',
  pathWidth: 'Path Width (px)', roadWidth: 'Road Width (px)',
  trunkRadius: 'Trunk R (px)', trunkHeight: 'Trunk Height',
  canopyRadius: 'Canopy R (px)', roofHeight: 'Roof Height (px)',
  houseLength: 'Length (px)', houseWidth: 'Width (px)', houseHeight: 'Wall Height (px)',
};

// ─── Helper: compute wall endpoints for snapping ─────────────────
function getWallEndpoints(wall) {
  const w = wall.width || 200;
  const t = wall.thickness || 10;
  const rot = (wall.rotation || 0) * Math.PI / 180;
  const cx = wall.x + w / 2;
  const cy = wall.y + t / 2;
  const dx = (w / 2) * Math.cos(rot);
  const dy = (w / 2) * Math.sin(rot);
  return {
    start: { x: cx - dx, y: cy - dy },
    end:   { x: cx + dx, y: cy + dy },
  };
}

// ─── Unit conversion helpers (used by components receiving unit/pxPerUnit) ──
function toUnit(pxVal, pxPerUnit) { return pxVal / pxPerUnit; }
function fromUnit(unitVal, pxPerUnit) { return unitVal * pxPerUnit; }
function formatUnit(pxVal, pxPerUnit, symbol, decimals = 1) {
  return `${(pxVal / pxPerUnit).toFixed(decimals)} ${symbol}`;
}

// ─── Editable number input for properties panel ──────────────────
function PropInput({ label, value, onChange, unit = 'px', step = 5, min = 1 }) {
  return (
    <div className="three-prop-edit-row">
      <label className="three-prop-edit-label">{label}</label>
      <input type="number" className="three-prop-edit-input" value={value}
        step={step} min={min}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '' || v === '-') return;
          const num = parseFloat(v);
          if (!isNaN(num)) onChange(num);
        }}
      />
      {unit && <span className="three-prop-edit-unit">{unit}</span>}
    </div>
  );
}

// ─── Properties Panel ─────────────────────────────────────────────
function PropertiesPanel3D({ selectedShape, shapes, onUpdateShape, onDeleteShape, onContinueWall, origin, unit, pxPerUnit }) {
  if (!selectedShape) return null;
  const shape = shapes.find(s => s.id === selectedShape);
  if (!shape) return null;

  const h = shape.extrudeHeight || EXTRUDE_HEIGHT;
  const rot = shape.rotation || 0;
  const t = shape.type;
  const ox = origin ? origin.x : 0;
  const oy = origin ? origin.y : 0;
  const sym = UNIT_DEFS[unit]?.symbol || 'px';
  const ppu = pxPerUnit || 1;
  const uStep = unit === 'px' ? 5 : 0.5;
  // Relative position from origin
  const relX = toUnit((shape.x || 0) - ox, ppu);
  const relY = toUnit((shape.y || 0) - oy, ppu);

  // Convert display value from px → unit, and onChange back from unit → px
  const uVal = (pxVal) => parseFloat(toUnit(pxVal, ppu).toFixed(2));
  const pxFromInput = (unitVal) => fromUnit(unitVal, ppu);

  return (
    <div className="three-height-panel glass">
      <h4>⚒️ {shape.name || shape.type}</h4>

      {/* ─ Position — absolute (editable) ─ */}
      <div className="three-prop-row">
        <span className="three-prop-label">X</span>
        <input type="number" className="three-prop-edit-input three-prop-inline"
          value={uVal(shape.x || 0)} step={uStep}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onUpdateShape(shape.id, { x: pxFromInput(v) }); }} />
        <span className="three-prop-edit-unit">{sym}</span>
      </div>
      <div className="three-prop-row">
        <span className="three-prop-label">Y</span>
        <input type="number" className="three-prop-edit-input three-prop-inline"
          value={uVal(shape.y || 0)} step={uStep}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onUpdateShape(shape.id, { y: pxFromInput(v) }); }} />
        <span className="three-prop-edit-unit">{sym}</span>
      </div>
      {/* ─ Relative position from origin ─ */}
      {(ox !== 0 || oy !== 0) && (
        <div className="three-prop-relative">
          <span className="three-prop-rel-label">From origin:</span>
          <span className="three-prop-rel-value">({relX.toFixed(1)}, {relY.toFixed(1)}) {sym}</span>
        </div>
      )}

      <div className="three-prop-divider" />

      {/* ─ Type-specific dimensions ─ */}

      {/* Rectangle / Box */}
      {t === 'rectangle' && (
        <>
          <PropInput label="Width" value={uVal(shape.width || 50)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { width: pxFromInput(v) })} />
          <PropInput label="Depth" value={uVal(shape.height || 50)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { height: pxFromInput(v) })} />
        </>
      )}

      {/* Circle / Cylinder */}
      {t === 'circle' && (
        <PropInput label="Radius" value={uVal(shape.radius || 30)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { radius: pxFromInput(v) })} />
      )}

      {/* Triangle */}
      {t === 'triangle' && (
        <PropInput label="Radius" value={uVal(shape.radius || 30)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { radius: pxFromInput(v) })} />
      )}

      {/* Ellipse */}
      {t === 'ellipse' && (
        <>
          <PropInput label="Radius X" value={uVal(shape.radiusX || 40)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { radiusX: pxFromInput(v) })} />
          <PropInput label="Radius Y" value={uVal(shape.radiusY || 25)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { radiusY: pxFromInput(v) })} />
        </>
      )}

      {/* Tank */}
      {t === 'tank' && (
        <PropInput label="Radius" value={uVal(shape.radius || 40)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { radius: pxFromInput(v) })} />
      )}

      {/* House */}
      {t === 'house' && (
        <>
          <PropInput label="Length" value={uVal(shape.houseLength || shape.width || 120)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { houseLength: pxFromInput(v) })} />
          <PropInput label="Width" value={uVal(shape.houseWidth || shape.depth || 100)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { houseWidth: pxFromInput(v) })} />
          <PropInput label="Wall Ht" value={uVal(shape.houseHeight || 80)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { houseHeight: pxFromInput(v) })} />
          <PropInput label="Roof Ht" value={uVal(shape.roofHeight || 40)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { roofHeight: pxFromInput(v) })} />
        </>
      )}

      {/* Tree */}
      {t === 'tree' && (
        <>
          <PropInput label="Canopy R" value={uVal(shape.canopyRadius || 30)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { canopyRadius: pxFromInput(v) })} />
          <PropInput label="Trunk R" value={uVal(shape.trunkRadius || 5)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { trunkRadius: pxFromInput(v) })} />
        </>
      )}

      {/* Wall */}
      {t === 'wall' && (
        <>
          <PropInput label="Length" value={uVal(shape.width || 200)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { width: pxFromInput(v) })} />
          <PropInput label="Thick" value={uVal(shape.thickness || 10)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { thickness: pxFromInput(v) })} />
          {shape.anchorPoint && (
            <div className="three-wall-anchor-info">
              <span className="three-wall-anchor-badge">🔗 Anchored</span>
              <button className="three-wall-detach-btn"
                onClick={() => onUpdateShape(shape.id, { anchorPoint: null, anchoredEnd: null, anchorSourceId: null })}
                title="Detach wall from anchor point">
                Detach
              </button>
            </div>
          )}
        </>
      )}

      {/* Pipe */}
      {t === 'pipe' && (
        <PropInput label="Pipe R" value={uVal(shape.pipeRadius || 5)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { pipeRadius: pxFromInput(v) })} />
      )}

      {/* Cable */}
      {t === 'cable' && (
        <>
          <PropInput label="Cable R" value={uVal(shape.cableRadius || 2)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { cableRadius: pxFromInput(v) })} />
          <PropInput label="Post Ht" value={shape.postHeight || 0.5} step={0.05} min={0.1} unit="3D" onChange={(v) => onUpdateShape(shape.id, { postHeight: v })} />
        </>
      )}

      {/* Path */}
      {t === 'path' && (
        <>
          <PropInput label="Length" value={uVal(shape.width || 200)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { width: pxFromInput(v) })} />
          <PropInput label="Width" value={uVal(shape.pathWidth || 30)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { pathWidth: pxFromInput(v) })} />
        </>
      )}

      {/* Road */}
      {t === 'road' && (
        <>
          <PropInput label="Length" value={uVal(shape.width || 300)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { width: pxFromInput(v) })} />
          <PropInput label="Width" value={uVal(shape.roadWidth || 60)} unit={sym} step={uStep} onChange={(v) => onUpdateShape(shape.id, { roadWidth: pxFromInput(v) })} />
        </>
      )}

      <div className="three-prop-divider" />

      {/* ─ Rotation (all types except line-based) ─ */}
      {!['pipe', 'cable', 'line', 'path_line'].includes(t) && (
        <div className="three-prop-section">
          <div className="three-prop-edit-row">
            <label className="three-prop-edit-label">Rotation</label>
            <input type="number" className="three-prop-edit-input three-prop-inline"
              value={Math.round(rot)} step={5} min={-360} max={360}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onUpdateShape(shape.id, { rotation: v }); }} />
            <span className="three-prop-edit-unit">°</span>
          </div>
          {/* Quick rotation presets */}
          <div className="three-rotation-presets">
            {[0, 45, 90, 135, 180].map(deg => (
              <button key={deg} className={`three-rot-btn ${Math.round(rot) === deg ? 'active' : ''}`}
                onClick={() => onUpdateShape(shape.id, { rotation: deg })}>
                {deg}°
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="three-prop-divider" />

      {/* ─ 3D Height (all types with extrudeHeight) ─ */}
      <div className="height-control">
        <label>Height</label>
        <input type="range" min="0.05" max="3" step="0.05" value={h}
          onChange={(e) => onUpdateShape(shape.id, { extrudeHeight: parseFloat(e.target.value) })} />
        <span>{h.toFixed(2)}</span>
      </div>
      <div className="height-control">
        <label>Opacity</label>
        <input type="range" min="0.1" max="1" step="0.05" value={shape.opacity ?? 0.7}
          onChange={(e) => onUpdateShape(shape.id, { opacity: parseFloat(e.target.value) })} />
        <span>{(shape.opacity ?? 0.7).toFixed(2)}</span>
      </div>

      {/* ─ Wall continuation button ─ */}
      {t === 'wall' && onContinueWall && (
        <>
          <div className="three-prop-divider" />
          <div className="three-wall-continue-section">
            <p className="three-wall-hint">Connect walls to build boundary:</p>
            <button className="three-wall-continue-btn" onClick={() => onContinueWall(shape, 'end')}>
              ➡️ Continue from End
            </button>
            <button className="three-wall-continue-btn" onClick={() => onContinueWall(shape, 'start')}>
              ⬅️ Continue from Start
            </button>
          </div>
        </>
      )}

      {/* ─ Delete Element ─ */}
      <div className="three-prop-divider" />
      <button className="three-delete-btn" onClick={() => onDeleteShape && onDeleteShape(shape.id)}
        title="Delete this element (or press Delete key)">
        🗑️ Remove Element
      </button>
    </div>
  );
}

// ─── Dimension Input Modal ────────────────────────────────────────
function DimensionModal({ elementDef, onConfirm, onCancel, unit, pxPerUnit }) {
  const sym = UNIT_DEFS[unit]?.symbol || 'px';
  const ppu = pxPerUnit || 1;
  // Store dims internally in the selected unit for display, convert back to px on confirm
  const is3DKey = (k) => k === 'extrudeHeight' || k === 'trunkHeight' || k === 'postHeight';
  const isUnitless = (k) => k.includes('angle') || k === 'sides' || k === 'lineType';

  const initDims = useMemo(() => {
    const d = {};
    Object.entries(elementDef.dims).forEach(([k, v]) => {
      d[k] = is3DKey(k) || isUnitless(k) ? v : parseFloat(toUnit(v, ppu).toFixed(2));
    });
    return d;
  }, [elementDef.dims, ppu]);

  const [dims, setDims] = useState(initDims);
  const [nameInput, setNameInput] = useState(elementDef.label);

  const handleChange = (key, rawVal) => {
    if (rawVal === '' || rawVal === '-') {
      setDims(prev => ({ ...prev, [key]: rawVal }));
      return;
    }
    const num = parseFloat(rawVal);
    if (!isNaN(num)) {
      setDims(prev => ({ ...prev, [key]: num }));
    }
  };

  const editableKeys = Object.keys(elementDef.dims);

  // Build dynamic label: replace "(px)" with current unit symbol
  const dimLabel = (key) => {
    const base = DIM_LABELS[key] || key;
    return base.replace(/\(px\)/g, `(${sym})`);
  };

  return (
    <div className="three-dim-modal">
      <h4>{elementDef.icon} Add {elementDef.label}</h4>
      {/* Name */}
      <div className="three-dim-row">
        <label>Name</label>
        <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)}
          placeholder={elementDef.label} style={{ flex: 1 }} />
        <span className="three-dim-unit"></span>
      </div>
      {/* All dimension inputs */}
      {editableKeys.map((key, i) => (
        <div className="three-dim-row" key={key}>
          <label>{dimLabel(key)}</label>
          <input
            type="number"
            value={dims[key]}
            step={is3DKey(key) ? 0.05 : (key === 'sides' ? 1 : (unit === 'px' ? 5 : 0.5))}
            min={is3DKey(key) ? 0.05 : (key === 'sides' ? 3 : (unit === 'px' ? 1 : 0.01))}
            onChange={(e) => handleChange(key, e.target.value)}
            autoFocus={i === 0}
          />
          <span className="three-dim-unit">
            {is3DKey(key) ? '3D' : (isUnitless(key) ? '' : sym)}
          </span>
        </div>
      ))}
      <div className="three-dim-actions">
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={() => {
          // Convert unit values back to px
          const finalDims = {};
          Object.entries(dims).forEach(([k, v]) => {
            const numV = typeof v === 'string' ? (parseFloat(v) || elementDef.dims[k]) : v;
            finalDims[k] = is3DKey(k) || isUnitless(k) ? numV : fromUnit(numV, ppu);
          });
          onConfirm(finalDims, nameInput);
        }}>Place Element</button>
      </div>
    </div>
  );
}

// ─── Camera View Controller ───────────────────────────────────────
function ViewTransitioner({ viewPreset, bounds, controlsRef }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3());
  const goalPos = useRef(new THREE.Vector3());
  const isAnimating = useRef(false);
  const animFrame = useRef(0);

  useEffect(() => {
    const { cx, cz, extent } = bounds;
    const dist = Math.max(extent * 1.2, 3);
    target.current.set(cx, 0, cz);
    switch (viewPreset) {
      case 'top':   goalPos.current.set(cx, dist + 5, cz + 0.001); break;
      case 'front': goalPos.current.set(cx, extent * 0.3, cz + dist); break;
      case 'right': goalPos.current.set(cx + dist, extent * 0.3, cz); break;
      default:      goalPos.current.set(cx + dist * 0.7, dist * 0.7, cz + dist * 0.7); break;
    }
    isAnimating.current = true;
    animFrame.current = 0;
  }, [viewPreset, bounds]);

  useFrame(() => {
    if (!isAnimating.current) return;
    animFrame.current++;
    const t = Math.min(animFrame.current / 30, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(camera.position, goalPos.current, ease);
    if (controlsRef.current) {
      controlsRef.current.target.lerp(target.current, ease);
      controlsRef.current.update();
    }
    camera.lookAt(target.current);
    if (t >= 1) isAnimating.current = false;
  });
  return null;
}

// ─── Elevation Sync: reads polar angle from OrbitControls each frame ──
function ElevationSync({ controlsRef, onAngleChange }) {
  useFrame(() => {
    if (controlsRef.current) {
      onAngleChange(controlsRef.current.getPolarAngle());
    }
  });
  return null;
}

// ─── Drag Handler ─────────────────────────────────────────────────
function DragHandler({ dragState, onMove, onEnd, viewPreset }) {
  const { camera, raycaster, gl } = useThree();
  // Use ground plane (Y=0) for all views — elements are placed on the ground
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const intersection = useMemo(() => new THREE.Vector3(), []);
  // For front/right views, we project via a camera-facing plane through the shape's ground position
  const shapePlane = useMemo(() => new THREE.Plane(), []);

  useEffect(() => {
    if (!dragState) return;
    const canvas = gl.domElement;

    const onPointerMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);

      // For front/right ortho views, project onto a plane facing the camera
      if (viewPreset === 'front' || viewPreset === 'right') {
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        shapePlane.setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3(0, 0, 0));
        if (raycaster.ray.intersectPlane(shapePlane, intersection)) {
          onMove(dragState.shapeId, intersection.x / SCALE, -intersection.z / SCALE);
        }
      } else {
        // Top-down and perspective: project onto ground plane
        if (raycaster.ray.intersectPlane(groundPlane, intersection)) {
          onMove(dragState.shapeId, intersection.x / SCALE, -intersection.z / SCALE);
        }
      }
    };
    const onPointerUp = () => onEnd();
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [dragState, camera, raycaster, gl, groundPlane, shapePlane, intersection, onMove, onEnd, viewPreset]);
  return null;
}

// ─── Grid Axis Labels (measurement ticks along X and Z) ──────────
function GridLabels3D({ unit, pxPerUnit }) {
  const uDef = UNIT_DEFS[unit];
  const section = uDef.gridSection;                // units per section mark
  const sectionWorld = section * pxPerUnit * SCALE; // world-space distance per section
  const sym = uDef.symbol;
  const count = 10; // labels in each direction from origin

  const labels = useMemo(() => {
    const arr = [];
    for (let i = -count; i <= count; i++) {
      if (i === 0) continue;
      const worldPos = i * sectionWorld;
      const unitVal = i * section;
      const txt = `${unitVal}${sym}`;
      // X-axis labels (along the red axis, Z=0)
      arr.push({ key: `x${i}`, pos: [worldPos, 0.02, 0.15], text: txt });
      // Z-axis labels (along the blue axis, X=0)  — 3D Z is negative of 2D Y
      arr.push({ key: `z${i}`, pos: [0.15, 0.02, worldPos], text: txt });
    }
    return arr;
  }, [sectionWorld, section, sym]);

  return (
    <group>
      {labels.map(l => (
        <Billboard key={l.key} position={l.pos}>
          <Text fontSize={0.12} color="rgba(52,211,153,0.5)" anchorX="left" anchorY="middle">
            {l.text}
          </Text>
        </Billboard>
      ))}
      {/* Origin "0" label */}
      <Billboard position={[0.1, 0.02, 0.1]}>
        <Text fontSize={0.14} color="#34d399" anchorX="left" anchorY="middle" fontWeight="bold">0</Text>
      </Billboard>
    </group>
  );
}

// ─── Crosshair ────────────────────────────────────────────────────
function CursorCrosshair({ viewPreset }) {
  const { camera, raycaster, gl } = useThree();
  const [pos, setPos] = useState(null);
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const intersection = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    if (viewPreset !== 'top') { setPos(null); return; }
    const canvas = gl.domElement;
    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      if (raycaster.ray.intersectPlane(groundPlane, intersection)) {
        setPos({ x: intersection.x, z: intersection.z });
      }
    };
    canvas.addEventListener('pointermove', onMove);
    return () => canvas.removeEventListener('pointermove', onMove);
  }, [viewPreset, camera, raycaster, gl, groundPlane, intersection]);

  if (!pos || viewPreset !== 'top') return null;
  const size = 0.3;
  return (
    <group position={[pos.x, 0.02, pos.z]}>
      <Line points={[[-size, 0, 0], [size, 0, 0]]} color="#f59e0b" lineWidth={1.5} />
      <Line points={[[0, 0, -size], [0, 0, size]]} color="#f59e0b" lineWidth={1.5} />
    </group>
  );
}

// ─── 3D Origin / Reference Point Marker ──────────────────────────
function OriginMarker3D({ origin, onDragOrigin, isTopDown }) {
  const meshRef = useRef();
  const [hovered, setHovered] = useState(false);
  const pos = useMemo(() => [origin.x * SCALE, 0.02, -origin.y * SCALE], [origin.x, origin.y]);
  const axisLen = 0.8;

  return (
    <group position={pos}>
      {/* Center sphere — draggable */}
      <mesh ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onPointerDown={(e) => {
          if (!isTopDown || !onDragOrigin) return;
          e.stopPropagation();
          onDragOrigin(e);
        }}
      >
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color={hovered ? '#fbbf24' : '#ef4444'} emissive={hovered ? '#fbbf24' : '#ef4444'}
          emissiveIntensity={0.5} roughness={0.3} />
      </mesh>

      {/* X axis — red */}
      <Line points={[[0, 0, 0], [axisLen, 0, 0]]} color="#ef4444" lineWidth={3} />
      <mesh position={[axisLen + 0.08, 0, 0]}>
        <coneGeometry args={[0.04, 0.1, 8]} />
        <meshStandardMaterial color="#ef4444" />
      </mesh>
      <Billboard position={[axisLen + 0.25, 0, 0]}>
        <Text fontSize={0.12} color="#ef4444" anchorY="middle">X</Text>
      </Billboard>

      {/* Z axis (mapped from 2D Y) — blue */}
      <Line points={[[0, 0, 0], [0, 0, -axisLen]]} color="#3b82f6" lineWidth={3} />
      <mesh position={[0, 0, -(axisLen + 0.08)]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.04, 0.1, 8]} />
        <meshStandardMaterial color="#3b82f6" />
      </mesh>
      <Billboard position={[0, 0, -(axisLen + 0.25)]}>
        <Text fontSize={0.12} color="#3b82f6" anchorY="middle">Y</Text>
      </Billboard>

      {/* Y axis (vertical) — green */}
      <Line points={[[0, 0, 0], [0, axisLen, 0]]} color="#22c55e" lineWidth={3} />
      <mesh position={[0, axisLen + 0.08, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.04, 0.1, 8]} />
        <meshStandardMaterial color="#22c55e" />
      </mesh>
      <Billboard position={[0, axisLen + 0.25, 0]}>
        <Text fontSize={0.12} color="#22c55e" anchorY="middle">Z</Text>
      </Billboard>

      {/* Origin label */}
      <Billboard position={[0, 0.3, 0]}>
        <Text fontSize={0.1} color="#f59e0b" anchorY="bottom" outlineWidth={0.005} outlineColor="#000">
          ORIGIN ({Math.round(origin.x)}, {Math.round(origin.y)})
        </Text>
      </Billboard>

      {/* Ground ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.15, 0.18, 32]} />
        <meshBasicMaterial color={hovered ? '#fbbf24' : '#ef4444'} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ─── Drag handler for origin marker ──────────────────────────────
function OriginDragHandler({ dragging, onMove, onEnd }) {
  const { camera, raycaster, gl } = useThree();
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const intersection = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    if (!dragging) return;
    const canvas = gl.domElement;
    const onPointerMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      if (raycaster.ray.intersectPlane(groundPlane, intersection)) {
        onMove(intersection.x / SCALE, -intersection.z / SCALE);
      }
    };
    const onPointerUp = () => onEnd();
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [dragging, camera, raycaster, gl, groundPlane, intersection, onMove, onEnd]);
  return null;
}

// ═════════════════════════════════════════════════════════════════
//  SHARED SCENE CONTENT (used by main canvas AND 6-view panels)
// ═════════════════════════════════════════════════════════════════
function SceneShapes({ shapes, selectedId, onSelect, isDraggable, onDragStart }) {
  return (
    <>
      {shapes.map(shape => (
        <Shape3D key={shape.id} shape={shape}
          isSelected={selectedId === shape.id} onSelect={onSelect || (() => {})}
          isDraggable={isDraggable} onDrag={onDragStart} />
      ))}
    </>
  );
}

// ─── Mini Scene for 6-View Panel (static, no interactions) ──────
function MiniScene({ shapes, bounds, unit, pxPerUnit }) {
  const uDef = UNIT_DEFS[unit] || UNIT_DEFS.px;
  const ppu = pxPerUnit || 1;
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 15, 10]} intensity={0.8} />
      <directionalLight position={[-5, 8, -5]} intensity={0.3} />
      <hemisphereLight args={['#34d399', '#050807', 0.3]} />
      <Grid args={[50, 50]} position={[0, -0.001, 0]}
        cellSize={uDef.gridCell * ppu * SCALE}
        cellThickness={0.4} cellColor="#1a3a2a"
        sectionSize={uDef.gridSection * ppu * SCALE}
        sectionThickness={0.8} sectionColor="#34d399"
        fadeDistance={30} fadeStrength={1.5} followCamera={false} infiniteGrid />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#0a0f0d" transparent opacity={0.3} />
      </mesh>
      {shapes.map(shape => (
        <Shape3D key={shape.id} shape={shape}
          isSelected={false} onSelect={() => {}}
          isDraggable={false} onDrag={() => {}} />
      ))}
    </>
  );
}

// ─── 6-View Orthographic Projection Panel ─────────────────────────
function SixViewPanel({ shapes, bounds, onClose, unit, pxPerUnit }) {
  const { cx, cz, extent } = bounds;
  const dist = extent * 1.5 + 2;
  const halfExt = extent * 0.8 + 1;

  return (
    <div className="six-view-overlay">
      <div className="six-view-header">
        <div className="six-view-title">
          <span className="six-view-title-icon">📐</span>
          <span>6-View Engineering Projection</span>
        </div>
        <button className="btn btn-secondary six-view-close" onClick={onClose}>✕ Close</button>
      </div>
      <div className="six-view-grid">
        {SIX_VIEWS.map(view => {
          const camDef = view.cam(cx, cz, dist);
          return (
            <div key={view.key} className="six-view-cell">
              <div className="six-view-cell-label">{view.label}</div>
              <Canvas
                orthographic
                camera={{
                  position: camDef.pos,
                  up: camDef.up,
                  zoom: 60,
                  near: 0.01,
                  far: dist * 4,
                  left: -halfExt, right: halfExt,
                  top: halfExt, bottom: -halfExt,
                }}
                gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
                dpr={[1, 1.5]}
              >
                <color attach="background" args={['#050807']} />
                <SixViewCameraSetup target={[cx, 0, cz]} />
                <MiniScene shapes={shapes} bounds={bounds} unit={unit} pxPerUnit={pxPerUnit} />
              </Canvas>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Helper to point camera at the scene center
function SixViewCameraSetup({ target }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateProjectionMatrix();
  }, [camera, target]);
  return null;
}

// ═════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════
export default function ThreeCanvas({ shapes = [], onShapesChange }) {
  const [selectedId, setSelectedId] = useState(null);
  const [localShapes, setLocalShapes] = useState(shapes);
  const [viewPreset, setViewPreset] = useState('perspective');
  const [dragState, setDragState] = useState(null);
  const [addingElement, setAddingElement] = useState(null);
  const [showSixViews, setShowSixViews] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [draggingOrigin, setDraggingOrigin] = useState(false);
  const [unit, setUnit] = useState('px');
  const [pxPerUnit, setPxPerUnit] = useState(UNIT_DEFS.px.defaultPPU);
  const [ratioLocked, setRatioLocked] = useState(false);
  const [polarAngle, setPolarAngle] = useState(Math.PI / 4); // ~45° default
  const controlsRef = useRef();
  const meshInteractedRef = useRef(false); // prevents onPointerMissed from deselecting after a mesh click

  // Derived unit helpers
  const uDef = UNIT_DEFS[unit];
  const sym = uDef.symbol;
  const fmtU = useCallback((pxVal, dec = 1) => formatUnit(pxVal, pxPerUnit, sym, dec), [pxPerUnit, sym]);

  // Elevation slider: set polar angle on OrbitControls
  const handleElevationChange = useCallback((angle) => {
    if (controlsRef.current) {
      controlsRef.current.setPolarAngle(angle);
      controlsRef.current.update();
    }
  }, []);

  // Sync polar angle from OrbitControls (runs each frame inside Canvas)
  const handleAngleSync = useCallback((angle) => {
    setPolarAngle(angle);
  }, []);

  // When unit changes, update pxPerUnit to the default — unless locked
  const handleUnitChange = useCallback((newUnit) => {
    setUnit(newUnit);
    if (!ratioLocked) {
      setPxPerUnit(UNIT_DEFS[newUnit].defaultPPU);
    }
  }, [ratioLocked]);

  const isOrtho = VIEW_PRESETS[viewPreset]?.ortho;
  const isTopDown = viewPreset === 'top';

  useEffect(() => { setLocalShapes(shapes); }, [shapes]);

  const bounds = useMemo(() => computeBounds(localShapes), [localShapes]);

  const handleSelect = useCallback((id) => {
    meshInteractedRef.current = true;
    // Clear the flag after a short delay so the next onPointerMissed doesn't get blocked
    setTimeout(() => { meshInteractedRef.current = false; }, 100);
    setSelectedId(prev => prev === id ? null : id);
  }, []);

  const handleUpdateShape = useCallback((id, updates) => {
    setLocalShapes(prev => {
      const next = prev.map(s => {
        if (s.id !== id) return s;
        const merged = { ...s, ...updates };

        // Wall anchor: when length (width) or rotation changes, keep the anchored endpoint fixed
        if (s.type === 'wall' && s.anchorPoint && (updates.width !== undefined || updates.rotation !== undefined)) {
          const newW = merged.width || 200;
          const newT = merged.thickness || 10;
          const rot = (merged.rotation || 0) * Math.PI / 180;
          const halfLen = newW / 2;
          const ax = s.anchorPoint.x;
          const ay = s.anchorPoint.y;

          // anchoredEnd tells us which end is pinned to the anchor
          if (s.anchoredEnd === 'start') {
            // Start is pinned → center is offset along rotation from anchor
            const cx = ax + halfLen * Math.cos(rot);
            const cy = ay + halfLen * Math.sin(rot);
            merged.x = cx - newW / 2;
            merged.y = cy - newT / 2;
          } else {
            // End is pinned → center is offset opposite rotation from anchor
            const cx = ax - halfLen * Math.cos(rot);
            const cy = ay - halfLen * Math.sin(rot);
            merged.x = cx - newW / 2;
            merged.y = cy - newT / 2;
          }
        }

        return merged;
      });
      onShapesChange?.(next);
      return next;
    });
  }, [onShapesChange]);

  const handleDeselect = useCallback(() => {
    // Skip deselect if a mesh was just clicked (prevents panel flicker)
    if (meshInteractedRef.current) return;
    setSelectedId(null);
  }, []);

  // Delete selected element
  const handleDeleteShape = useCallback((id) => {
    setLocalShapes(prev => {
      const next = prev.filter(s => s.id !== id);
      onShapesChange?.(next);
      return next;
    });
    setSelectedId(null);
  }, [onShapesChange]);

  // Keyboard shortcut: Delete / Backspace removes selected element
  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        // Don't delete if user is typing in an input
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        e.preventDefault();
        handleDeleteShape(selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, handleDeleteShape]);

  // Add new element
  const handleAddElement = useCallback((dims, name) => {
    if (!addingElement) return;
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cx = (bounds.cx / SCALE) || 200;
    const cy = (-bounds.cz / SCALE) || 200;

    let newShape = {
      id,
      type: addingElement.type,
      x: cx,
      y: cy,
      fill: 'rgba(52, 211, 153, 0.15)',
      stroke: '#34d399',
      strokeWidth: 2,
      opacity: 0.7,
      name: name || addingElement.label,
      ...dims,
    };

    // Line-like elements need points array
    if (['pipe', 'cable'].includes(addingElement.type)) {
      const len = dims.length || 200;
      newShape.points = [cx - len / 2, cy, cx + len / 2, cy];
      delete newShape.length;
    }

    // For 'line' type (generic line)
    if (addingElement.type === 'line' || addingElement.type === 'path_line') {
      const len = dims.length || 120;
      newShape.points = [cx - len / 2, cy, cx + len / 2, cy];
      newShape.stroke = LINE_TYPE_COLORS[dims.lineType] || '#ffffff';
      newShape.lineType = dims.lineType || 'general';
      delete newShape.length;
    }

    setLocalShapes(prev => {
      const next = [...prev, newShape];
      onShapesChange?.(next);
      return next;
    });
    setSelectedId(id);
    setAddingElement(null);
  }, [addingElement, bounds, onShapesChange]);

  // Drag handlers — works in all views
  const handleDragStart = useCallback((e, shapeId) => {
    e.stopPropagation();
    meshInteractedRef.current = true;
    setTimeout(() => { meshInteractedRef.current = false; }, 200);
    setDragState({ shapeId });
    setSelectedId(shapeId);
    if (controlsRef.current) controlsRef.current.enabled = false;
  }, []);

  const handleDragMove = useCallback((shapeId, newX, newY) => {
    setLocalShapes(prev => prev.map(s => {
      if (s.id !== shapeId) return s;
      if (s.type === 'rectangle' || s.type === 'wall' || s.type === 'path' || s.type === 'road') {
        return { ...s, x: newX - (s.width || 50) / 2, y: newY - (s.height || s.thickness || s.pathWidth || s.roadWidth || 50) / 2 };
      }
      if (s.type === 'house') {
        return { ...s, x: newX - (s.houseLength || s.width || 120) / 2, y: newY - (s.houseWidth || s.depth || 100) / 2 };
      }
      return { ...s, x: newX, y: newY };
    }));
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragState) onShapesChange?.(localShapes);
    setDragState(null);
    document.body.style.cursor = '';
    if (controlsRef.current) controlsRef.current.enabled = true;
  }, [dragState, localShapes, onShapesChange]);

  // ─── Origin drag handlers ───
  const handleOriginDragStart = useCallback((e) => {
    e.stopPropagation();
    setDraggingOrigin(true);
    if (controlsRef.current) controlsRef.current.enabled = false;
  }, []);

  const handleOriginDragMove = useCallback((newX, newY) => {
    setOrigin({ x: Math.round(newX), y: Math.round(newY) });
  }, []);

  const handleOriginDragEnd = useCallback(() => {
    setDraggingOrigin(false);
    if (controlsRef.current) controlsRef.current.enabled = true;
  }, []);

  // ─── Wall Continuation: spawn a new wall connected to the selected wall's endpoint ───
  const handleContinueWall = useCallback((sourceWall, fromEnd) => {
    const endpoints = getWallEndpoints(sourceWall);
    const anchor = fromEnd === 'end' ? endpoints.end : endpoints.start;
    const srcRot = sourceWall.rotation || 0;
    // Default: perpendicular turn (90°). User can rotate after placing.
    const newRot = srcRot + 90;
    const newW = sourceWall.width || 200;
    const newT = sourceWall.thickness || 10;

    // Position the new wall so its start endpoint meets the anchor point
    const newRotRad = newRot * Math.PI / 180;
    const halfLen = newW / 2;
    // Center of new wall offset from anchor
    const newCx = anchor.x + halfLen * Math.cos(newRotRad);
    const newCy = anchor.y + halfLen * Math.sin(newRotRad);

    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const newWall = {
      id,
      type: 'wall',
      x: newCx - newW / 2,
      y: newCy - newT / 2,
      width: newW,
      thickness: newT,
      extrudeHeight: sourceWall.extrudeHeight || 1.0,
      rotation: newRot % 360,
      fill: sourceWall.fill || 'rgba(52, 211, 153, 0.15)',
      stroke: sourceWall.stroke || '#34d399',
      strokeWidth: 2,
      opacity: sourceWall.opacity ?? 0.7,
      name: `Wall ${localShapes.filter(s => s.type === 'wall').length + 1}`,
      // Anchor metadata: keeps this end pinned when length/rotation changes
      anchorPoint: { x: anchor.x, y: anchor.y },
      anchoredEnd: 'start',   // the "start" end of this new wall sits on the anchor
      anchorSourceId: sourceWall.id,
    };

    setLocalShapes(prev => {
      const next = [...prev, newWall];
      onShapesChange?.(next);
      return next;
    });
    setSelectedId(id);
  }, [localShapes, onShapesChange]);

  return (
    <div className="three-canvas-wrapper">
      <Canvas dpr={[1, 2]}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onPointerMissed={handleDeselect}
        camera={{ fov: 50, position: [8, 6, 8], near: 0.1, far: 1000 }}
      >
        <color attach="background" args={['#050807']} />
        <ViewTransitioner viewPreset={viewPreset} bounds={bounds} controlsRef={controlsRef} />
        {dragState && <DragHandler dragState={dragState} onMove={handleDragMove} onEnd={handleDragEnd} viewPreset={viewPreset} />}
        <CursorCrosshair viewPreset={viewPreset} />
        {!isTopDown && <ElevationSync controlsRef={controlsRef} onAngleChange={handleAngleSync} />}

        {/* Lighting */}
        <ambientLight intensity={isTopDown ? 0.8 : 0.4} />
        <directionalLight position={[10, 15, 10]} intensity={isTopDown ? 0.6 : 1.2}
          castShadow shadow-mapSize={[2048, 2048]}
          shadow-camera-far={50} shadow-camera-left={-20} shadow-camera-right={20}
          shadow-camera-top={20} shadow-camera-bottom={-20} />
        <directionalLight position={[-5, 8, -5]} intensity={0.3} />
        <hemisphereLight args={['#34d399', '#050807', 0.3]} />

        {!isTopDown && <fog attach="fog" args={['#050807', 20, 60]} />}

        <Grid args={[50, 50]} position={[0, -0.001, 0]}
          cellSize={uDef.gridCell * pxPerUnit * SCALE}
          cellThickness={isTopDown ? 0.8 : 0.5}
          cellColor={isTopDown ? '#1e3a2e' : '#1a3a2a'}
          sectionSize={uDef.gridSection * pxPerUnit * SCALE}
          sectionThickness={1} sectionColor="#34d399"
          fadeDistance={isTopDown ? 50 : 30} fadeStrength={isTopDown ? 0.5 : 1.5}
          followCamera={false} infiniteGrid />

        <GridLabels3D unit={unit} pxPerUnit={pxPerUnit} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
          <planeGeometry args={[100, 100]} />
          <shadowMaterial transparent opacity={0.4} />
        </mesh>

        {!isTopDown && <ContactShadows position={[0, -0.005, 0]} opacity={0.35} scale={40} blur={2.5} far={10} color="#000" />}

        {localShapes.map(shape => (
          <Shape3D key={shape.id} shape={shape}
            isSelected={selectedId === shape.id} onSelect={handleSelect}
            isDraggable={true} onDrag={handleDragStart} onDragEnd={handleDragEnd} />
        ))}

        {/* Origin / Reference Point */}
        <OriginMarker3D origin={origin} onDragOrigin={handleOriginDragStart} isTopDown={isTopDown} />
        {draggingOrigin && <OriginDragHandler dragging={draggingOrigin} onMove={handleOriginDragMove} onEnd={handleOriginDragEnd} />}

        <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08}
          minDistance={1} maxDistance={80}
          maxPolarAngle={isTopDown ? 0.01 : Math.PI / 2 - 0.05}
          enableRotate={!isTopDown}
          mouseButtons={{
            LEFT: isTopDown ? undefined : THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN,
          }}
          touches={{
            ONE: isTopDown ? undefined : THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_PAN,
          }}
          target={[bounds.cx, 0, bounds.cz]} />
      </Canvas>

      {/* ──── Overlay UI ──── */}

      {/* View Preset Buttons */}
      <div className="three-view-bar">
        {Object.entries(VIEW_PRESETS).map(([key, cfg]) => (
          <button key={key} className={`three-view-btn ${viewPreset === key ? 'active' : ''}`}
            onClick={() => { setViewPreset(key); setShowSixViews(false); }} title={cfg.label + ' View'}>
            <span className="three-view-icon">{cfg.icon}</span>
            <span className="three-view-label">{cfg.label}</span>
          </button>
        ))}
        <div style={{ height: '1px', background: 'rgba(52,211,153,0.2)', margin: '4px 0' }} />
        <button className={`three-view-btn ${showSixViews ? 'active' : ''}`}
          onClick={() => setShowSixViews(!showSixViews)} title="6-View Engineering Projection">
          <span className="three-view-icon">📐</span>
          <span className="three-view-label">6-View</span>
        </button>
      </div>

      {/* Elevation Slider — right side */}
      {!isTopDown && (
        <div className="three-elevation-slider glass">
          <span className="three-elev-label">⬆</span>
          <input
            type="range"
            className="three-elev-range"
            min={0.05}
            max={Math.PI / 2 - 0.05}
            step={0.01}
            value={Math.PI / 2 - polarAngle}
            onChange={(e) => {
              const invertedAngle = Math.PI / 2 - parseFloat(e.target.value);
              handleElevationChange(invertedAngle);
            }}
            title={`Elevation: ${Math.round((Math.PI / 2 - polarAngle) * 180 / Math.PI)}°`}
          />
          <span className="three-elev-label">⬇</span>
          <span className="three-elev-value">{Math.round((Math.PI / 2 - polarAngle) * 180 / Math.PI)}°</span>
        </div>
      )}

      <div className="three-overlay-top">
        <div className="three-badge glass">
          <span className="three-badge-dot" />
          {isTopDown ? 'Layout View' : '3D View'}
        </div>
        <div className="three-stats glass">
          {localShapes.length} object{localShapes.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="three-overlay-bottom glass">
        {isTopDown ? (
          <>
            <span>🖱️ Drag to place</span>
            <span>⇧ Right-click pan</span>
            <span>🔍 Scroll zoom</span>
          </>
        ) : (
          <>
            <span>🖱️ Orbit (click element to drag)</span>
            <span>⇧ Right-click pan</span>
            <span>🔍 Zoom</span>
          </>
        )}
      </div>

      {selectedId && (() => {
        const s = localShapes.find(sh => sh.id === selectedId);
        if (!s) return null;
        const absX = toUnit(s.x || 0, pxPerUnit).toFixed(1);
        const absY = toUnit(s.y || 0, pxPerUnit).toFixed(1);
        const relX = toUnit((s.x || 0) - origin.x, pxPerUnit).toFixed(1);
        const relY = toUnit((s.y || 0) - origin.y, pxPerUnit).toFixed(1);
        return (
          <div className="three-coord-readout glass">
            <div>Abs: ({absX}, {absY}) {sym}</div>
            {(origin.x !== 0 || origin.y !== 0) && (
              <div style={{ color: '#f59e0b', fontSize: '10px' }}>Ref: ({relX}, {relY}) {sym}</div>
            )}
          </div>
        );
      })()}

      {/* Origin control */}
      <div className="three-origin-control glass">
        <span className="three-origin-icon">📍</span>
        <span className="three-origin-text">
          Origin: ({toUnit(origin.x, pxPerUnit).toFixed(1)}, {toUnit(origin.y, pxPerUnit).toFixed(1)}) {sym}
        </span>
        {(origin.x !== 0 || origin.y !== 0) && (
          <button className="three-origin-reset" onClick={() => setOrigin({ x: 0, y: 0 })} title="Reset to (0,0)">
            ↺
          </button>
        )}
        <input type="number" className="three-origin-input"
          value={parseFloat(toUnit(origin.x, pxPerUnit).toFixed(2))}
          step={unit === 'px' ? 10 : 0.5}
          title={`Origin X (${sym})`}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setOrigin(prev => ({ ...prev, x: fromUnit(v, pxPerUnit) })); }} />
        <input type="number" className="three-origin-input"
          value={parseFloat(toUnit(origin.y, pxPerUnit).toFixed(2))}
          step={unit === 'px' ? 10 : 0.5}
          title={`Origin Y (${sym})`}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setOrigin(prev => ({ ...prev, y: fromUnit(v, pxPerUnit) })); }} />
      </div>

      {/* Unit Toggle Toolbar */}
      <div className="three-unit-toolbar glass">
        <span className="three-unit-label">Unit:</span>
        {Object.entries(UNIT_DEFS).map(([key, def]) => (
          <button key={key} className={`three-unit-btn ${unit === key ? 'active' : ''}`}
            onClick={() => handleUnitChange(key)} title={`Switch to ${def.label}`}>
            {def.label}
          </button>
        ))}
        <span className="three-unit-sep">|</span>
        <span className="three-unit-ratio-label">1 {uDef.label} =</span>
        <input type="number"
          className={`three-unit-ratio-input ${ratioLocked ? 'locked' : ''}`}
          value={pxPerUnit}
          step={unit === 'px' ? 1 : 5} min={1}
          disabled={ratioLocked}
          title={ratioLocked ? 'Ratio locked — click 🔒 to unlock' : 'Pixels per unit'}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setPxPerUnit(v); }} />
        <span className="three-unit-ratio-suffix">px</span>
        <button
          className={`three-unit-lock-btn ${ratioLocked ? 'locked' : ''}`}
          onClick={() => setRatioLocked(prev => !prev)}
          title={ratioLocked ? 'Unlock conversion ratio' : 'Lock conversion ratio'}>
          {ratioLocked ? '🔒' : '🔓'}
        </button>
      </div>

      {/* Element Toolbar — split into groups */}
      <div className="three-element-toolbar">
        {ELEMENT_CATALOG.map((elem, i) => {
          // Add divider between groups
          const prevGroup = i > 0 ? ELEMENT_CATALOG[i - 1].group : null;
          const showDivider = prevGroup && prevGroup !== elem.group;
          return (
            <React.Fragment key={elem.type}>
              {showDivider && <div className="three-toolbar-divider" />}
              <button
                className={`three-elem-btn ${addingElement?.type === elem.type ? 'active' : ''}`}
                onClick={() => setAddingElement(addingElement?.type === elem.type ? null : elem)}
                title={`Add ${elem.label}`}
              >
                <span className="three-elem-icon">{elem.icon}</span>
                <span className="three-elem-label">{elem.label}</span>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {addingElement && (
        <DimensionModal
          elementDef={addingElement}
          onConfirm={handleAddElement}
          onCancel={() => setAddingElement(null)}
          unit={unit}
          pxPerUnit={pxPerUnit}
        />
      )}

      <PropertiesPanel3D
        selectedShape={selectedId}
        shapes={localShapes}
        onUpdateShape={handleUpdateShape}
        onDeleteShape={handleDeleteShape}
        onContinueWall={handleContinueWall}
        origin={origin}
        unit={unit}
        pxPerUnit={pxPerUnit}
      />

      {/* 6-View Engineering Projection Panel */}
      {showSixViews && (
        <SixViewPanel
          shapes={localShapes}
          bounds={bounds}
          onClose={() => setShowSixViews(false)}
          unit={unit}
          pxPerUnit={pxPerUnit}
        />
      )}
    </div>
  );
}
