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

function to3D(x, y, height = 0, elevation = 0) {
  return [x * SCALE, height + elevation * SCALE, -y * SCALE];
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

// Common props for interactive meshes.
// Drag is handled entirely by DomDragSystem at the DOM level.
// This hook only handles selection (onClick) and hover styling.
function useMeshInteraction(shapeId, onSelect, isDraggable) {
  const [hovered, setHovered] = useState(false);
  // Ref callback to mark mesh in userData (for DomDragSystem raycasting)
  const meshRef = useCallback((node) => {
    if (node) {
      node.userData.draggable = !!isDraggable;
      node.userData.shapeId = shapeId;
    }
  }, [isDraggable, shapeId]);
  const handlers = useMemo(() => ({
    onClick: (e) => {
      e.stopPropagation();
      onSelect(shapeId);
    },
    onPointerOver: () => {
      setHovered(true);
      if (isDraggable) document.body.style.cursor = 'grab';
    },
    onPointerOut: () => {
      setHovered(false);
      document.body.style.cursor = '';
    },
  }), [shapeId, onSelect, isDraggable]);
  return { hovered, handlers, meshRef };
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
function Rectangle3D({ shape, isSelected, onSelect, isDraggable }) {
  const w = (shape.width || 50) * SCALE;
  const d = (shape.height || 50) * SCALE;
  const h = shape.extrudeHeight || EXTRUDE_HEIGHT;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || shape.stroke || '#34d399';
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);

  const pos = useMemo(() => {
    const cx = (shape.x + (shape.width || 50) / 2) * SCALE;
    const cz = -(shape.y + (shape.height || 50) / 2) * SCALE;
    return [cx, h / 2 + elev, cz];
  }, [shape.x, shape.y, shape.width, shape.height, h, elev]);

  return (
    <group>
      <mesh position={pos} rotation={[0, -(shape.rotation || 0) * Math.PI / 180, 0]}
        ref={meshRef} {...handlers} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        {mat(fill, shape.opacity ?? 0.7, isSelected, hovered)}
      </mesh>
      <lineSegments position={pos} rotation={[0, -(shape.rotation || 0) * Math.PI / 180, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(w, h, d)]} />
        <lineBasicMaterial color={isSelected ? '#ffffff' : (shape.stroke || '#34d399')} linewidth={2} />
      </lineSegments>
      <ShapeLabel name={shape.name} position={[pos[0], pos[1] + h / 2 + 0.15, pos[2]]} />
    </group>
  );
}

// ─── Circle / Cylinder ────────────────────────────────────────────
function Circle3D({ shape, isSelected, onSelect, isDraggable }) {
  const r = (shape.radius || 30) * SCALE;
  const h = shape.extrudeHeight || EXTRUDE_HEIGHT;
  const fill = rgbaToHex(shape.fill) || shape.stroke || '#34d399';
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => to3D(shape.x, shape.y, h / 2, shape.z || 0), [shape.x, shape.y, h, shape.z]);

  return (
    <group>
      <mesh position={pos} ref={meshRef} {...handlers} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, h, 32]} />
        {mat(fill, shape.opacity ?? 0.7, isSelected, hovered)}
      </mesh>
      <lineSegments position={pos}>
        <edgesGeometry args={[new THREE.CylinderGeometry(r, r, h, 32)]} />
        <lineBasicMaterial color={isSelected ? '#ffffff' : (shape.stroke || '#34d399')} />
      </lineSegments>
      <ShapeLabel name={shape.name} position={[pos[0], pos[1] + h / 2 + 0.15, pos[2]]} />
    </group>
  );
}

// ─── Ellipse ──────────────────────────────────────────────────────
function Ellipse3D({ shape, isSelected, onSelect, isDraggable }) {
  const rx = (shape.radiusX || 40) * SCALE;
  const ry = (shape.radiusY || 25) * SCALE;
  const h = shape.extrudeHeight || EXTRUDE_HEIGHT;
  const fill = rgbaToHex(shape.fill) || shape.stroke || '#34d399';
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => to3D(shape.x, shape.y, h / 2, shape.z || 0), [shape.x, shape.y, h, shape.z]);

  return (
    <group>
      <mesh position={pos} scale={[rx, 1, ry]} ref={meshRef} {...handlers} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, h, 32]} />
        {mat(fill, shape.opacity ?? 0.7, isSelected, hovered)}
      </mesh>
      <ShapeLabel name={shape.name} position={[pos[0], h + 0.15, pos[2]]} />
    </group>
  );
}

// ─── Triangle ─────────────────────────────────────────────────────
function Triangle3D({ shape, isSelected, onSelect, isDraggable }) {
  const r = (shape.radius || 30) * SCALE;
  const h = shape.extrudeHeight || EXTRUDE_HEIGHT;
  const fill = rgbaToHex(shape.fill) || shape.stroke || '#34d399';
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const elev = (shape.z || 0) * SCALE;
  const pos = useMemo(() => to3D(shape.x, shape.y, 0, shape.z || 0), [shape.x, shape.y, shape.z]);

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
      <mesh geometry={geometry} position={[pos[0], elev, pos[2]]}
        rotation={[0, -(shape.rotation || 0) * Math.PI / 180, 0]}
        ref={meshRef} {...handlers} castShadow receiveShadow>
        {mat(fill, shape.opacity ?? 0.7, isSelected, hovered, { doubleSide: true })}
      </mesh>
      <ShapeLabel name={shape.name} position={[pos[0], h + elev + 0.15, pos[2]]} />
    </group>
  );
}

// ─── Polygon / Boundary ──────────────────────────────────────────
function Polygon3D({ shape, isSelected, onSelect, isDraggable }) {
  const h = shape.extrudeHeight || EXTRUDE_HEIGHT;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || shape.stroke || '#34d399';
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);

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
      <mesh geometry={geometry} position={[0, elev, 0]} ref={meshRef} {...handlers} castShadow receiveShadow>
        {mat(fill, shape.opacity ?? 0.7, isSelected, hovered, { doubleSide: true })}
      </mesh>
      <ShapeLabel name={shape.name} position={[centroid[0], centroid[1] + elev, centroid[2]]} />
    </group>
  );
}

// ─── Line ─────────────────────────────────────────────────────────
function Line3D({ shape, isSelected, onSelect, isDraggable }) {
  const elev = (shape.z || 0) * SCALE;
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const { center, relPoints } = usePointsWithCenter(shape.points, 0.05);

  if (!relPoints || !center) return null;
  const lineColor = shape.stroke || LINE_TYPE_COLORS[shape.lineType] || '#ffffff';
  const lineWidth = (shape.strokeWidth || 3) * 0.8;

  return (
    <group position={[center[0], elev, center[2]]} rotation={[0, -rot, 0]}>
      {/* Invisible hitbox mesh for drag detection */}
      <mesh ref={meshRef} {...handlers} visible={false}>
        <tubeGeometry args={[new THREE.CatmullRomCurve3(relPoints), 20, 0.08, 8, false]} />
        <meshBasicMaterial />
      </mesh>
      <Line points={relPoints} color={isSelected ? '#ffffff' : lineColor}
        lineWidth={hovered ? lineWidth + 1 : lineWidth}
        onClick={(e) => { e.stopPropagation(); onSelect(shape.id); }}
        dashed={shape.dash && shape.dash.length > 0}
        dashSize={shape.dash?.[0] ? shape.dash[0] * SCALE : undefined}
        gapSize={shape.dash?.[1] ? shape.dash[1] * SCALE : undefined}
      />
      {shape.lineType === 'piping' && (
        <mesh>
          <tubeGeometry args={[new THREE.CatmullRomCurve3(relPoints), 20, 0.04, 8, false]} />
          <meshStandardMaterial color={lineColor} transparent opacity={0.6} roughness={0.3} metalness={0.5} />
        </mesh>
      )}
      <ShapeLabel name={shape.name} position={[
        (relPoints[0].x + relPoints[relPoints.length - 1].x) / 2, 0.25,
        (relPoints[0].z + relPoints[relPoints.length - 1].z) / 2
      ]} />
    </group>
  );
}

// ─── Arc ──────────────────────────────────────────────────────────
function Arc3D({ shape, isSelected, onSelect, isDraggable }) {
  const outerR = (shape.outerRadius || 50) * SCALE;
  const innerR = (shape.innerRadius || 30) * SCALE;
  const h = shape.extrudeHeight || EXTRUDE_HEIGHT * 0.5;
  const fill = rgbaToHex(shape.fill) || shape.stroke || '#34d399';
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => to3D(shape.x, shape.y, h / 2, shape.z || 0), [shape.x, shape.y, h, shape.z]);

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
      <mesh geometry={geometry} position={[pos[0], 0, pos[2]]} ref={meshRef} {...handlers} castShadow receiveShadow>
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
function Tank3D({ shape, isSelected, onSelect, isDraggable }) {
  const r = (shape.radius || 40) * SCALE;
  const h = shape.extrudeHeight || 1.0;
  const elev = (shape.z || 0) * SCALE;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => to3D(shape.x, shape.y, 0, shape.z || 0), [shape.x, shape.y, shape.z]);

  return (
    <group position={[pos[0], elev, pos[2]]}>
      {/* Body */}
      <mesh position={[0, h / 2, 0]} ref={meshRef} {...handlers} castShadow receiveShadow>
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
function House3D({ shape, isSelected, onSelect, isDraggable }) {
  // All dims in px, converted with SCALE for 3D
  const len  = (shape.houseLength || shape.width || 120) * SCALE;  // X axis
  const wid  = (shape.houseWidth  || shape.depth || 100) * SCALE;  // Z axis
  const wallH = (shape.houseHeight || 80) * SCALE;                 // Y axis (wall height)
  const roofH = (shape.roofHeight  || 40) * SCALE;                 // Y axis (roof above walls)
  const elev = (shape.z || 0) * SCALE;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => {
    const cx = (shape.x + (shape.houseLength || shape.width || 120) / 2) * SCALE;
    const cz = -(shape.y + (shape.houseWidth || shape.depth || 100) / 2) * SCALE;
    return [cx, elev, cz];
  }, [shape.x, shape.y, shape.houseLength, shape.width, shape.houseWidth, shape.depth, elev]);

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
      <mesh position={[0, wallH / 2, 0]} ref={meshRef} {...handlers} castShadow receiveShadow>
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
function Tree3D({ shape, isSelected, onSelect, isDraggable }) {
  const trunkR = (shape.trunkRadius || 5) * SCALE;
  const trunkH = shape.trunkHeight || 0.4;
  const canopyR = (shape.canopyRadius || 30) * SCALE;
  const canopyH = shape.extrudeHeight || 0.8;
  const elev = (shape.z || 0) * SCALE;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => to3D(shape.x, shape.y, 0, shape.z || 0), [shape.x, shape.y, shape.z]);

  return (
    <group position={[pos[0], elev, pos[2]]}>
      {/* Trunk */}
      <mesh position={[0, trunkH / 2, 0]} ref={meshRef} {...handlers} castShadow>
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
function Wall3D({ shape, isSelected, onSelect, isDraggable }) {
  const w = (shape.width || 200) * SCALE;
  const t = (shape.thickness || 10) * SCALE;
  const h = shape.extrudeHeight || 1.0;
  const elev = (shape.z || 0) * SCALE;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);

  const pos = useMemo(() => {
    const cx = (shape.x + (shape.width || 200) / 2) * SCALE;
    const cz = -(shape.y + (shape.thickness || 10) / 2) * SCALE;
    return [cx, h / 2 + elev, cz];
  }, [shape.x, shape.y, shape.width, shape.thickness, h, elev]);

  return (
    <group>
      <mesh position={pos} rotation={[0, -(shape.rotation || 0) * Math.PI / 180, 0]}
        ref={meshRef} {...handlers} castShadow receiveShadow>
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

// Helper: compute center & relative points for point-based shapes
function usePointsWithCenter(shapePoints, yVal) {
  return useMemo(() => {
    if (!shapePoints || shapePoints.length < 4) return { center: null, relPoints: null };
    let sumX = 0, sumY = 0, n = 0;
    for (let i = 0; i < shapePoints.length; i += 2) {
      sumX += shapePoints[i]; sumY += shapePoints[i + 1]; n++;
    }
    const cx = sumX / n, cy = sumY / n;
    const pts = [];
    for (let i = 0; i < shapePoints.length; i += 2) {
      pts.push(new THREE.Vector3(
        (shapePoints[i] - cx) * SCALE,
        yVal,
        -(shapePoints[i + 1] - cy) * SCALE
      ));
    }
    return { center: [cx * SCALE, 0, -cy * SCALE], relPoints: pts };
  }, [shapePoints, yVal]);
}

// ─── Pipe (tube along a path) ────────────────────────────────────
function Pipe3D({ shape, isSelected, onSelect, isDraggable }) {
  const pipeRadius = (shape.pipeRadius || 5) * SCALE;
  const elev = (shape.z || 0) * SCALE;
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const { center, relPoints } = usePointsWithCenter(shape.points, pipeRadius + 0.01);

  if (!relPoints) return null;

  return (
    <group position={[center[0], elev, center[2]]} rotation={[0, -rot, 0]}>
      {/* Outer pipe */}
      <mesh ref={meshRef} {...handlers} castShadow>
        <tubeGeometry args={[new THREE.CatmullRomCurve3(relPoints), 64, pipeRadius, 16, false]} />
        <meshStandardMaterial color={hovered ? '#22d3ee' : '#06b6d4'}
          transparent opacity={0.85} roughness={0.2} metalness={0.7}
          emissive={isSelected ? '#06b6d4' : '#000'} emissiveIntensity={isSelected ? 0.3 : 0} />
      </mesh>
      {/* Flanges at joints */}
      {relPoints.map((pt, i) => (
        <mesh key={i} position={pt} castShadow>
          <torusGeometry args={[pipeRadius * 1.3, pipeRadius * 0.15, 8, 16]} />
          <meshStandardMaterial color="#0891b2" roughness={0.3} metalness={0.8} />
        </mesh>
      ))}
      <ShapeLabel name={shape.name || 'Pipe'} position={[
        (relPoints[0].x + relPoints[relPoints.length - 1].x) / 2, pipeRadius * 2 + 0.2,
        (relPoints[0].z + relPoints[relPoints.length - 1].z) / 2
      ]} />
    </group>
  );
}

// ─── Cable (thin dipping line with posts) ─────────────────────────
function Cable3D({ shape, isSelected, onSelect, isDraggable }) {
  const cableRadius = (shape.cableRadius || 2) * SCALE;
  const postHeight = shape.postHeight || 0.5;
  const elev = (shape.z || 0) * SCALE;
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const { center, relPoints: endPoints } = usePointsWithCenter(shape.points, postHeight);

  // Add sag between 2-point cables (using relative points)
  const points = useMemo(() => {
    if (!endPoints) return null;
    if (endPoints.length === 2) {
      const mid = new THREE.Vector3().lerpVectors(endPoints[0], endPoints[1], 0.5);
      mid.y = postHeight * 0.6;
      return [endPoints[0], mid, endPoints[1]];
    }
    return endPoints;
  }, [endPoints, postHeight]);

  if (!points || !center) return null;

  return (
    <group position={[center[0], elev, center[2]]} rotation={[0, -rot, 0]}>
      {/* Cable line */}
      <mesh ref={meshRef} {...handlers}>
        <tubeGeometry args={[new THREE.CatmullRomCurve3(points), 32, cableRadius, 8, false]} />
        <meshStandardMaterial color={hovered ? '#fbbf24' : '#f59e0b'}
          emissive={isSelected ? '#f59e0b' : '#000'} emissiveIntensity={isSelected ? 0.4 : 0}
          roughness={0.5} metalness={0.3} />
      </mesh>
      {/* Posts at endpoints (use endPoints, not sag points) */}
      {endPoints.map((pt, i) => (
        <mesh key={i} position={[pt.x, postHeight / 2, pt.z]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, postHeight, 6]} />
          <meshStandardMaterial color="#78716c" roughness={0.8} metalness={0.2} />
        </mesh>
      ))}
      <ShapeLabel name={shape.name || 'Cable'} position={[
        (endPoints[0].x + endPoints[endPoints.length - 1].x) / 2, postHeight + 0.2,
        (endPoints[0].z + endPoints[endPoints.length - 1].z) / 2
      ]} />
    </group>
  );
}

// ─── Path / Pathway (flat wide strip on ground) ──────────────────
function Path3D({ shape, isSelected, onSelect, isDraggable }) {
  const w = (shape.pathWidth || 30) * SCALE;
  const len = (shape.width || 200) * SCALE;
  const elev = (shape.z || 0) * SCALE;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);

  const pos = useMemo(() => {
    const cx = (shape.x + (shape.width || 200) / 2) * SCALE;
    const cz = -(shape.y + (shape.pathWidth || 30) / 2) * SCALE;
    return [cx, 0.015 + elev, cz];
  }, [shape.x, shape.y, shape.width, shape.pathWidth, elev]);

  return (
    <group>
      <mesh position={pos} rotation={[0, -(shape.rotation || 0) * Math.PI / 180, 0]}
        ref={meshRef} {...handlers} receiveShadow>
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
// Road surface type definitions
const ROAD_SURFACES = {
  tar:      { label: 'Tar / Asphalt',  color: '#374151', hoverColor: '#4b5563', roughness: 0.92, metalness: 0.0,  markings: 'asphalt'  },
  cement:   { label: 'Cement / Concrete', color: '#9ca3af', hoverColor: '#b0b8c4', roughness: 0.85, metalness: 0.05, markings: 'concrete' },
  mud:      { label: 'Mud Road',        color: '#78552b', hoverColor: '#8b6934', roughness: 1.0,  metalness: 0.0,  markings: 'mud'      },
  gravel:   { label: 'Gravel',          color: '#a8977a', hoverColor: '#bfad93', roughness: 1.0,  metalness: 0.0,  markings: 'gravel'   },
  dirt:     { label: 'Dirt Track',      color: '#92613a', hoverColor: '#a87448', roughness: 0.98, metalness: 0.0,  markings: 'dirt'     },
};

function Road3D({ shape, isSelected, onSelect, isDraggable }) {
  const w = (shape.roadWidth || 60) * SCALE;
  const len = (shape.width || 300) * SCALE;
  const elev = (shape.z || 0) * SCALE;
  const surface = ROAD_SURFACES[shape.roadSurface] || ROAD_SURFACES.tar;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const rot = -(shape.rotation || 0) * Math.PI / 180;

  const pos = useMemo(() => {
    const cx = (shape.x + (shape.width || 300) / 2) * SCALE;
    const cz = -(shape.y + (shape.roadWidth || 60) / 2) * SCALE;
    return [cx, 0.01 + elev, cz];
  }, [shape.x, shape.y, shape.width, shape.roadWidth, elev]);

  // Generate concrete expansion joints
  const concreteJoints = useMemo(() => {
    if (surface.markings !== 'concrete') return null;
    const joints = [];
    const spacing = w * 1.2; // roughly square slabs
    const count = Math.floor(len / spacing);
    for (let i = 1; i < count; i++) {
      const xOff = -len / 2 + i * spacing;
      joints.push(xOff);
    }
    return joints;
  }, [surface.markings, len, w]);

  // Gravel scatter dots (decorative small meshes)
  const gravelDots = useMemo(() => {
    if (surface.markings !== 'gravel') return null;
    const dots = [];
    const seed = (shape.id || '').length;
    for (let i = 0; i < 40; i++) {
      const pseudoRand = ((i * 7 + seed * 13) % 97) / 97;
      const pseudoRand2 = ((i * 11 + seed * 3) % 89) / 89;
      dots.push({
        x: (pseudoRand - 0.5) * len * 0.9,
        z: (pseudoRand2 - 0.5) * w * 0.8,
        s: 0.008 + pseudoRand * 0.012,
      });
    }
    return dots;
  }, [surface.markings, len, w, shape.id]);

  return (
    <group>
      {/* Road surface */}
      <mesh position={pos} rotation={[0, rot, 0]}
        ref={meshRef} {...handlers} receiveShadow>
        <boxGeometry args={[len, 0.02, w]} />
        <meshStandardMaterial
          color={hovered ? surface.hoverColor : surface.color}
          transparent opacity={0.95}
          emissive={isSelected ? surface.color : '#000'}
          emissiveIntensity={isSelected ? 0.25 : 0}
          roughness={surface.roughness} metalness={surface.metalness} />
      </mesh>

      {/* ── Asphalt markings: center dashed yellow + white edge lines ── */}
      {surface.markings === 'asphalt' && (
        <group position={pos} rotation={[0, rot, 0]}>
          <Line points={[[-len / 2, 0.015, 0], [len / 2, 0.015, 0]]}
            color="#fbbf24" lineWidth={2} dashed dashSize={0.15} gapSize={0.1} />
          {[-1, 1].map(side => (
            <Line key={side}
              points={[[-len / 2, 0.015, side * w * 0.45], [len / 2, 0.015, side * w * 0.45]]}
              color="#e5e7eb" lineWidth={1.5} />
          ))}
        </group>
      )}

      {/* ── Concrete markings: expansion joints (perpendicular lines) + subtle edge ── */}
      {surface.markings === 'concrete' && concreteJoints && (
        <group position={pos} rotation={[0, rot, 0]}>
          {concreteJoints.map((xOff, i) => (
            <Line key={i}
              points={[[xOff, 0.015, -w * 0.48], [xOff, 0.015, w * 0.48]]}
              color="#6b7280" lineWidth={1} />
          ))}
          {/* Center joint */}
          <Line points={[[-len / 2, 0.015, 0], [len / 2, 0.015, 0]]}
            color="#6b7280" lineWidth={0.5} />
          {/* Edge curbs */}
          {[-1, 1].map(side => (
            <mesh key={side} position={[0, 0.02, side * w * 0.49]}>
              <boxGeometry args={[len, 0.03, w * 0.02]} />
              <meshStandardMaterial color="#b0b8c4" roughness={0.8} />
            </mesh>
          ))}
        </group>
      )}

      {/* ── Mud markings: wavy ruts / tire tracks ── */}
      {surface.markings === 'mud' && (
        <group position={pos} rotation={[0, rot, 0]}>
          {[-0.2, 0.2].map((offset, i) => (
            <Line key={i}
              points={[
                [-len / 2, 0.015, offset * w],
                [-len / 4, 0.018, (offset + 0.03) * w],
                [0, 0.013, (offset - 0.02) * w],
                [len / 4, 0.017, (offset + 0.04) * w],
                [len / 2, 0.015, offset * w],
              ]}
              color="#5c3d1e" lineWidth={2.5} />
          ))}
          {/* Puddle patches */}
          {[-0.3, 0.15, 0.35].map((xp, i) => (
            <mesh key={i} position={[xp * len, 0.012, ((i * 0.3 - 0.2) * w)]}
              rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[w * 0.12, 12]} />
              <meshStandardMaterial color="#5a3f20" transparent opacity={0.6} roughness={0.6} metalness={0.1} />
            </mesh>
          ))}
        </group>
      )}

      {/* ── Gravel: scattered pebble dots ── */}
      {surface.markings === 'gravel' && gravelDots && (
        <group position={pos} rotation={[0, rot, 0]}>
          {gravelDots.map((dot, i) => (
            <mesh key={i} position={[dot.x, 0.015, dot.z]}>
              <sphereGeometry args={[dot.s, 6, 4]} />
              <meshStandardMaterial color={i % 3 === 0 ? '#8b7d6b' : i % 3 === 1 ? '#a09080' : '#b5a594'}
                roughness={1} />
            </mesh>
          ))}
          {/* Edge mounds */}
          {[-1, 1].map(side => (
            <mesh key={side} position={[0, 0.01, side * w * 0.47]}>
              <boxGeometry args={[len, 0.015, w * 0.06]} />
              <meshStandardMaterial color="#8b7d6b" roughness={1} />
            </mesh>
          ))}
        </group>
      )}

      {/* ── Dirt track: twin tire ruts ── */}
      {surface.markings === 'dirt' && (
        <group position={pos} rotation={[0, rot, 0]}>
          {[-0.22, 0.22].map((offset, i) => (
            <mesh key={i} position={[0, 0.005, offset * w]}>
              <boxGeometry args={[len * 0.95, 0.008, w * 0.12]} />
              <meshStandardMaterial color="#6d4423" roughness={1} transparent opacity={0.7} />
            </mesh>
          ))}
          {/* Center grass strip */}
          <mesh position={[0, 0.008, 0]}>
            <boxGeometry args={[len * 0.9, 0.005, w * 0.15]} />
            <meshStandardMaterial color="#4a7a3d" roughness={1} transparent opacity={0.4} />
          </mesh>
          {/* Grass edges */}
          {[-1, 1].map(side => (
            <mesh key={side} position={[0, 0.005, side * w * 0.44]}>
              <boxGeometry args={[len, 0.01, w * 0.08]} />
              <meshStandardMaterial color="#4a7a3d" roughness={1} transparent opacity={0.35} />
            </mesh>
          ))}
        </group>
      )}

      <ShapeLabel name={shape.name || `${surface.label}`} position={[pos[0], 0.25 + elev, pos[2]]} />
    </group>
  );
}

// ─── Metal Frame / Steel Structure ──────────────────────────────
function MetalFrame3D({ shape, isSelected, onSelect, isDraggable }) {
  const fw = (shape.frameWidth || 150) * SCALE;
  const fd = (shape.frameDepth || 100) * SCALE;
  const fh = shape.frameHeight || 1.5;
  const bar = (shape.barThickness || 3) * SCALE;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || '#7f8c8d';
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => {
    const cx = (shape.x + (shape.frameWidth || 150) / 2) * SCALE;
    const cz = -(shape.y + (shape.frameDepth || 100) / 2) * SCALE;
    return [cx, elev, cz];
  }, [shape.x, shape.y, shape.frameWidth, shape.frameDepth, elev]);

  // Build frame as 4 vertical posts + 4 top beams + 4 bottom beams
  const posts = useMemo(() => {
    const hw = fw / 2, hd = fd / 2;
    return [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]];
  }, [fw, fd]);

  return (
    <group position={pos} rotation={[0, -rot, 0]}>
      {/* Invisible hitbox */}
      <mesh ref={meshRef} {...handlers} position={[0, fh / 2, 0]} visible={false}>
        <boxGeometry args={[fw, fh, fd]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      {/* Vertical posts */}
      {posts.map(([px, pz], i) => (
        <mesh key={`p${i}`} position={[px, fh / 2, pz]} castShadow>
          <boxGeometry args={[bar, fh, bar]} />
          {mat(fill, 0.9, isSelected, hovered, { roughness: 0.3, metalness: 0.8 })}
        </mesh>
      ))}
      {/* Top beams */}
      {posts.map(([px, pz], i) => {
        const next = posts[(i + 1) % 4];
        const mx = (px + next[0]) / 2, mz = (pz + next[1]) / 2;
        const len = Math.sqrt((next[0] - px) ** 2 + (next[1] - pz) ** 2);
        const angle = Math.atan2(next[1] - pz, next[0] - px);
        return (
          <mesh key={`t${i}`} position={[mx, fh, mz]} rotation={[0, -angle, 0]} castShadow>
            <boxGeometry args={[len, bar, bar]} />
            {mat(fill, 0.9, isSelected, hovered, { roughness: 0.3, metalness: 0.8 })}
          </mesh>
        );
      })}
      {/* Bottom beams */}
      {posts.map(([px, pz], i) => {
        const next = posts[(i + 1) % 4];
        const mx = (px + next[0]) / 2, mz = (pz + next[1]) / 2;
        const len = Math.sqrt((next[0] - px) ** 2 + (next[1] - pz) ** 2);
        const angle = Math.atan2(next[1] - pz, next[0] - px);
        return (
          <mesh key={`b${i}`} position={[mx, 0, mz]} rotation={[0, -angle, 0]} castShadow>
            <boxGeometry args={[len, bar, bar]} />
            {mat(fill, 0.9, isSelected, hovered, { roughness: 0.3, metalness: 0.8 })}
          </mesh>
        );
      })}
      <ShapeLabel name={shape.name} position={[0, fh + 0.2, 0]} />
    </group>
  );
}

// ─── Fence ─────────────────────────────────────────────────────
function Fence3D({ shape, isSelected, onSelect, isDraggable }) {
  const fenceLen = (shape.width || 200) * SCALE;
  const fenceH = shape.fenceHeight || 0.6;
  const postR = 2 * SCALE;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || '#8b7355';
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => {
    const cx = (shape.x + (shape.width || 200) / 2) * SCALE;
    const cz = -(shape.y + 5) * SCALE;
    return [cx, elev, cz];
  }, [shape.x, shape.y, shape.width, elev]);

  const postCount = Math.max(2, Math.ceil(fenceLen / (30 * SCALE)) + 1);
  const spacing = fenceLen / (postCount - 1);

  return (
    <group position={pos} rotation={[0, -rot, 0]}>
      <mesh ref={meshRef} {...handlers} position={[0, fenceH / 2, 0]} visible={false}>
        <boxGeometry args={[fenceLen, fenceH, postR * 4]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      {Array.from({ length: postCount }, (_, i) => {
        const px = -fenceLen / 2 + i * spacing;
        return (
          <mesh key={`fp${i}`} position={[px, fenceH / 2, 0]} castShadow>
            <cylinderGeometry args={[postR, postR, fenceH, 8]} />
            {mat(fill, 0.9, isSelected, hovered, { roughness: 0.8 })}
          </mesh>
        );
      })}
      {/* Horizontal rails */}
      {[0.2, 0.5].filter(h => h < fenceH).map((rh, ri) => (
        <mesh key={`rail${ri}`} position={[0, rh, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[postR * 0.6, postR * 0.6, fenceLen, 8]} />
          {mat(fill, 0.85, isSelected, hovered, { roughness: 0.8 })}
        </mesh>
      ))}
      <ShapeLabel name={shape.name} position={[0, fenceH + 0.15, 0]} />
    </group>
  );
}

// ─── Gate ──────────────────────────────────────────────────────
function Gate3D({ shape, isSelected, onSelect, isDraggable }) {
  const gateW = (shape.gateWidth || 80) * SCALE;
  const gateH = shape.gateHeight || 0.8;
  const bar = 2 * SCALE;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || '#4a4a4a';
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => {
    const cx = (shape.x + (shape.gateWidth || 80) / 2) * SCALE;
    const cz = -(shape.y + 5) * SCALE;
    return [cx, elev, cz];
  }, [shape.x, shape.y, shape.gateWidth, elev]);

  const barCount = Math.max(3, Math.floor(gateW / (8 * SCALE)));
  const barSpacing = gateW / (barCount + 1);

  return (
    <group position={pos} rotation={[0, -rot, 0]}>
      <mesh ref={meshRef} {...handlers} position={[0, gateH / 2, 0]} visible={false}>
        <boxGeometry args={[gateW + bar * 4, gateH, bar * 4]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      {/* Gate posts (thicker) */}
      {[-gateW / 2 - bar, gateW / 2 + bar].map((px, i) => (
        <mesh key={`gp${i}`} position={[px, gateH / 2, 0]} castShadow>
          <boxGeometry args={[bar * 2, gateH, bar * 2]} />
          {mat('#333333', 0.95, isSelected, hovered, { roughness: 0.3, metalness: 0.7 })}
        </mesh>
      ))}
      {/* Vertical bars */}
      {Array.from({ length: barCount }, (_, i) => (
        <mesh key={`gb${i}`} position={[-gateW / 2 + (i + 1) * barSpacing, gateH / 2, 0]} castShadow>
          <cylinderGeometry args={[bar * 0.5, bar * 0.5, gateH * 0.9, 6]} />
          {mat(fill, 0.9, isSelected, hovered, { roughness: 0.3, metalness: 0.6 })}
        </mesh>
      ))}
      {/* Top rail */}
      <mesh position={[0, gateH * 0.95, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[bar * 0.7, bar * 0.7, gateW, 8]} />
        {mat(fill, 0.9, isSelected, hovered, { roughness: 0.3, metalness: 0.6 })}
      </mesh>
      <ShapeLabel name={shape.name} position={[0, gateH + 0.15, 0]} />
    </group>
  );
}

// ─── Platform / Deck ──────────────────────────────────────────
function Platform3D({ shape, isSelected, onSelect, isDraggable }) {
  const pw = (shape.width || 150) * SCALE;
  const pd = (shape.platformDepth || 120) * SCALE;
  const ph = shape.platformHeight || 0.3;
  const legBar = 3 * SCALE;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || '#a0522d';
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => {
    const cx = (shape.x + (shape.width || 150) / 2) * SCALE;
    const cz = -(shape.y + (shape.platformDepth || 120) / 2) * SCALE;
    return [cx, elev, cz];
  }, [shape.x, shape.y, shape.width, shape.platformDepth, elev]);

  return (
    <group position={pos} rotation={[0, -rot, 0]}>
      {/* Top surface */}
      <mesh ref={meshRef} {...handlers} position={[0, ph, 0]} castShadow receiveShadow>
        <boxGeometry args={[pw, 0.04, pd]} />
        {mat(fill, 0.85, isSelected, hovered, { roughness: 0.85 })}
      </mesh>
      {/* Legs */}
      {[[-1,-1],[-1,1],[1,-1],[1,1]].map(([sx, sz], i) => (
        <mesh key={`leg${i}`} position={[sx * (pw / 2 - legBar), ph / 2, sz * (pd / 2 - legBar)]} castShadow>
          <boxGeometry args={[legBar, ph, legBar]} />
          {mat('#666', 0.9, isSelected, hovered, { roughness: 0.4, metalness: 0.5 })}
        </mesh>
      ))}
      <ShapeLabel name={shape.name} position={[0, ph + 0.2, 0]} />
    </group>
  );
}

// ─── Stairs ────────────────────────────────────────────────────
function Stairs3D({ shape, isSelected, onSelect, isDraggable }) {
  const sw = (shape.stairWidth || 60) * SCALE;
  const sd = (shape.stairDepth || 100) * SCALE;
  const sh = shape.stairHeight || 0.8;
  const steps = shape.stairSteps || 5;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || '#9ca3af';
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => {
    const cx = (shape.x + (shape.stairWidth || 60) / 2) * SCALE;
    const cz = -(shape.y + (shape.stairDepth || 100) / 2) * SCALE;
    return [cx, elev, cz];
  }, [shape.x, shape.y, shape.stairWidth, shape.stairDepth, elev]);

  const stepH = sh / steps;
  const stepD = sd / steps;

  return (
    <group position={pos} rotation={[0, -rot, 0]}>
      <mesh ref={meshRef} {...handlers} position={[0, sh / 2, 0]} visible={false}>
        <boxGeometry args={[sw, sh, sd]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      {Array.from({ length: steps }, (_, i) => (
        <mesh key={`step${i}`}
          position={[0, (i + 0.5) * stepH, -sd / 2 + (i + 0.5) * stepD]}
          castShadow receiveShadow>
          <boxGeometry args={[sw, stepH * 0.9, stepD * 0.95]} />
          {mat(fill, 0.85, isSelected, hovered, { roughness: 0.8 })}
        </mesh>
      ))}
      <ShapeLabel name={shape.name} position={[0, sh + 0.15, 0]} />
    </group>
  );
}

// ─── Solar Panel ──────────────────────────────────────────────
function SolarPanel3D({ shape, isSelected, onSelect, isDraggable }) {
  const pw = (shape.panelWidth || 120) * SCALE;
  const pd = (shape.panelDepth || 80) * SCALE;
  const tilt = (shape.panelTilt || 30) * Math.PI / 180;
  const postH = shape.postHeight || 0.4;
  const elev = (shape.z || 0) * SCALE;
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => {
    const cx = (shape.x + (shape.panelWidth || 120) / 2) * SCALE;
    const cz = -(shape.y + (shape.panelDepth || 80) / 2) * SCALE;
    return [cx, elev, cz];
  }, [shape.x, shape.y, shape.panelWidth, shape.panelDepth, elev]);

  return (
    <group position={pos} rotation={[0, -rot, 0]}>
      {/* Support post */}
      <mesh position={[0, postH / 2, 0]} castShadow>
        <cylinderGeometry args={[2 * SCALE, 2 * SCALE, postH, 8]} />
        {mat('#555', 0.9, isSelected, hovered, { roughness: 0.3, metalness: 0.7 })}
      </mesh>
      {/* Panel (tilted) */}
      <group position={[0, postH, 0]} rotation={[-tilt, 0, 0]}>
        <mesh ref={meshRef} {...handlers} castShadow receiveShadow>
          <boxGeometry args={[pw, 0.02, pd]} />
          {mat('#1a365d', 0.85, isSelected, hovered, { roughness: 0.2, metalness: 0.4 })}
        </mesh>
        {/* Grid lines on panel */}
        {[-pw / 4, 0, pw / 4].map((lx, i) => (
          <mesh key={`gl${i}`} position={[lx, 0.015, 0]}>
            <boxGeometry args={[0.005, 0.005, pd * 0.95]} />
            <meshBasicMaterial color="#2d4a7a" />
          </mesh>
        ))}
        {[-pd / 3, 0, pd / 3].map((lz, i) => (
          <mesh key={`gh${i}`} position={[0, 0.015, lz]}>
            <boxGeometry args={[pw * 0.95, 0.005, 0.005]} />
            <meshBasicMaterial color="#2d4a7a" />
          </mesh>
        ))}
      </group>
      <ShapeLabel name={shape.name} position={[0, postH + 0.4, 0]} />
    </group>
  );
}

// ─── Shed / Shelter ───────────────────────────────────────────
function Shed3D({ shape, isSelected, onSelect, isDraggable }) {
  const sw = (shape.shedWidth || 100) * SCALE;
  const sd = (shape.shedDepth || 80) * SCALE;
  const sh = shape.shedHeight || 0.6;
  const rh = shape.shedRoofHeight || 0.25;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || '#8b6914';
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => {
    const cx = (shape.x + (shape.shedWidth || 100) / 2) * SCALE;
    const cz = -(shape.y + (shape.shedDepth || 80) / 2) * SCALE;
    return [cx, elev, cz];
  }, [shape.x, shape.y, shape.shedWidth, shape.shedDepth, elev]);

  const roofGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const hw = sw / 2, hd = sd / 2;
    const verts = new Float32Array([
      -hw, sh, -hd,  hw, sh, -hd,  0, sh + rh, 0,
      hw, sh, -hd,   hw, sh, hd,   0, sh + rh, 0,
      hw, sh, hd,   -hw, sh, hd,   0, sh + rh, 0,
      -hw, sh, hd,  -hw, sh, -hd,  0, sh + rh, 0,
    ]);
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.computeVertexNormals();
    return g;
  }, [sw, sd, sh, rh]);

  return (
    <group position={pos} rotation={[0, -rot, 0]}>
      {/* Walls */}
      <mesh ref={meshRef} {...handlers} position={[0, sh / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[sw, sh, sd]} />
        {mat(fill, 0.8, isSelected, hovered, { roughness: 0.85 })}
      </mesh>
      {/* Roof */}
      <mesh geometry={roofGeo} castShadow>
        {mat('#a0522d', 0.85, isSelected, hovered, { roughness: 0.7 })}
      </mesh>
      <ShapeLabel name={shape.name} position={[0, sh + rh + 0.15, 0]} />
    </group>
  );
}

// ─── Garden Bed ───────────────────────────────────────────────
function GardenBed3D({ shape, isSelected, onSelect, isDraggable }) {
  const bw = (shape.bedWidth || 120) * SCALE;
  const bd = (shape.bedDepth || 60) * SCALE;
  const bh = shape.bedHeight || 0.15;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || '#5d4037';
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => {
    const cx = (shape.x + (shape.bedWidth || 120) / 2) * SCALE;
    const cz = -(shape.y + (shape.bedDepth || 60) / 2) * SCALE;
    return [cx, elev, cz];
  }, [shape.x, shape.y, shape.bedWidth, shape.bedDepth, elev]);

  return (
    <group position={pos} rotation={[0, -rot, 0]}>
      {/* Wooden border */}
      <mesh ref={meshRef} {...handlers} position={[0, bh / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[bw, bh, bd]} />
        {mat(fill, 0.85, isSelected, hovered, { roughness: 0.9 })}
      </mesh>
      {/* Soil fill */}
      <mesh position={[0, bh * 0.9, 0]}>
        <boxGeometry args={[bw * 0.9, 0.02, bd * 0.9]} />
        {mat('#3e2723', 0.9, isSelected, hovered, { roughness: 1.0 })}
      </mesh>
      {/* Mini plant rows */}
      {[-bd * 0.25, 0, bd * 0.25].map((rz, i) => (
        <group key={`row${i}`}>
          {Array.from({ length: 4 }, (_, j) => (
            <mesh key={`p${j}`} position={[-bw * 0.3 + j * (bw * 0.2), bh + 0.04, rz]}>
              <sphereGeometry args={[0.03, 8, 8]} />
              <meshStandardMaterial color="#2e7d32" />
            </mesh>
          ))}
        </group>
      ))}
      <ShapeLabel name={shape.name} position={[0, bh + 0.2, 0]} />
    </group>
  );
}

// ─── Pond / Pool ──────────────────────────────────────────────
function Pond3D({ shape, isSelected, onSelect, isDraggable }) {
  const pr = (shape.pondRadius || 50) * SCALE;
  const pd = shape.pondDepth || 0.1;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || '#1565c0';
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => to3D(shape.x, shape.y, -pd / 2, shape.z || 0), [shape.x, shape.y, pd, shape.z]);

  return (
    <group>
      {/* Rim */}
      <mesh position={[pos[0], elev + 0.01, pos[2]]}>
        <cylinderGeometry args={[pr * 1.08, pr * 1.08, 0.03, 32]} />
        {mat('#78909c', 0.8, isSelected, hovered, { roughness: 0.7 })}
      </mesh>
      {/* Water surface */}
      <mesh ref={meshRef} {...handlers} position={[pos[0], elev, pos[2]]} receiveShadow>
        <cylinderGeometry args={[pr, pr, 0.02, 32]} />
        {mat(fill, 0.5, isSelected, hovered, { roughness: 0.1, metalness: 0.3 })}
      </mesh>
      <ShapeLabel name={shape.name} position={[pos[0], elev + 0.2, pos[2]]} />
    </group>
  );
}

// ─── Lamp Post / Light ────────────────────────────────────────
function LampPost3D({ shape, isSelected, onSelect, isDraggable }) {
  const poleH = shape.poleHeight || 1.2;
  const poleR = 2 * SCALE;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || '#37474f';
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => to3D(shape.x, shape.y, 0, shape.z || 0), [shape.x, shape.y, shape.z]);

  return (
    <group>
      {/* Pole */}
      <mesh ref={meshRef} {...handlers} position={[pos[0], poleH / 2 + elev, pos[2]]} castShadow>
        <cylinderGeometry args={[poleR, poleR * 1.3, poleH, 8]} />
        {mat(fill, 0.9, isSelected, hovered, { roughness: 0.3, metalness: 0.7 })}
      </mesh>
      {/* Lamp head */}
      <mesh position={[pos[0], poleH + elev, pos[2]]} castShadow>
        <sphereGeometry args={[poleR * 3, 16, 16]} />
        {mat('#fdd835', 0.7, isSelected, hovered, { roughness: 0.2 })}
      </mesh>
      {/* Light glow */}
      <pointLight position={[pos[0], poleH + elev, pos[2]]} intensity={0.5} distance={3} color="#fdd835" />
      <ShapeLabel name={shape.name} position={[pos[0], poleH + 0.25 + elev, pos[2]]} />
    </group>
  );
}

// ─── Bench / Seating ──────────────────────────────────────────
function Bench3D({ shape, isSelected, onSelect, isDraggable }) {
  const bw = (shape.benchWidth || 80) * SCALE;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || '#5d4037';
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => {
    const cx = (shape.x + (shape.benchWidth || 80) / 2) * SCALE;
    const cz = -(shape.y + 15) * SCALE;
    return [cx, elev, cz];
  }, [shape.x, shape.y, shape.benchWidth, elev]);

  const seatH = 0.22, seatD = 15 * SCALE, legH = 0.22;

  return (
    <group position={pos} rotation={[0, -rot, 0]}>
      <mesh ref={meshRef} {...handlers} position={[0, seatH + legH, 0]} visible={false}>
        <boxGeometry args={[bw, 0.5, seatD * 2]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      {/* Seat */}
      <mesh position={[0, legH + 0.02, 0]} castShadow>
        <boxGeometry args={[bw, 0.03, seatD]} />
        {mat(fill, 0.9, isSelected, hovered, { roughness: 0.85 })}
      </mesh>
      {/* Backrest */}
      <mesh position={[0, legH + 0.12, -seatD / 2]} castShadow>
        <boxGeometry args={[bw, 0.18, 0.02]} />
        {mat(fill, 0.9, isSelected, hovered, { roughness: 0.85 })}
      </mesh>
      {/* Legs */}
      {[-bw * 0.35, bw * 0.35].map((lx, i) => (
        <mesh key={`bl${i}`} position={[lx, legH / 2, 0]} castShadow>
          <boxGeometry args={[0.02, legH, seatD * 0.8]} />
          {mat('#333', 0.9, isSelected, hovered, { roughness: 0.3, metalness: 0.6 })}
        </mesh>
      ))}
      <ShapeLabel name={shape.name} position={[0, legH + 0.35, 0]} />
    </group>
  );
}

// ─── Sign / Board ─────────────────────────────────────────────
function Sign3D({ shape, isSelected, onSelect, isDraggable }) {
  const signW = (shape.signWidth || 60) * SCALE;
  const signH = shape.signHeight || 0.4;
  const poleH = shape.poleHeight || 0.8;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || '#1565c0';
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => to3D(shape.x, shape.y, 0, shape.z || 0), [shape.x, shape.y, shape.z]);

  return (
    <group position={pos} rotation={[0, -rot, 0]}>
      {/* Pole */}
      <mesh position={[0, poleH / 2 + elev, 0]} castShadow>
        <cylinderGeometry args={[1.5 * SCALE, 2 * SCALE, poleH, 8]} />
        {mat('#555', 0.9, isSelected, hovered, { roughness: 0.3, metalness: 0.6 })}
      </mesh>
      {/* Sign board */}
      <mesh ref={meshRef} {...handlers} position={[0, poleH + signH / 2 + elev, 0]} castShadow>
        <boxGeometry args={[signW, signH, 0.02]} />
        {mat(fill, 0.85, isSelected, hovered, { roughness: 0.5 })}
      </mesh>
      {/* Text area (white) */}
      <mesh position={[0, poleH + signH / 2 + elev, 0.012]}>
        <boxGeometry args={[signW * 0.85, signH * 0.7, 0.005]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <ShapeLabel name={shape.name} position={[0, poleH + signH + 0.15 + elev, 0]} />
    </group>
  );
}

// ─── Container / Storage ──────────────────────────────────────
function Container3D({ shape, isSelected, onSelect, isDraggable }) {
  const cw = (shape.containerWidth || 150) * SCALE;
  const cd = (shape.containerDepth || 60) * SCALE;
  const ch = shape.containerHeight || 0.8;
  const elev = (shape.z || 0) * SCALE;
  const fill = rgbaToHex(shape.fill) || '#c62828';
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => {
    const cx = (shape.x + (shape.containerWidth || 150) / 2) * SCALE;
    const cz = -(shape.y + (shape.containerDepth || 60) / 2) * SCALE;
    return [cx, elev, cz];
  }, [shape.x, shape.y, shape.containerWidth, shape.containerDepth, elev]);

  return (
    <group position={pos} rotation={[0, -rot, 0]}>
      {/* Main body */}
      <mesh ref={meshRef} {...handlers} position={[0, ch / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[cw, ch, cd]} />
        {mat(fill, 0.85, isSelected, hovered, { roughness: 0.6, metalness: 0.3 })}
      </mesh>
      {/* Corrugation ridges */}
      {Array.from({ length: 6 }, (_, i) => {
        const rx = -cw * 0.4 + i * (cw * 0.16);
        return (
          <group key={`r${i}`}>
            <mesh position={[rx, ch / 2, cd / 2 + 0.003]}>
              <boxGeometry args={[0.01, ch * 0.85, 0.005]} />
              {mat('#000', 0.15, false, false)}
            </mesh>
            <mesh position={[rx, ch / 2, -cd / 2 - 0.003]}>
              <boxGeometry args={[0.01, ch * 0.85, 0.005]} />
              {mat('#000', 0.15, false, false)}
            </mesh>
          </group>
        );
      })}
      <lineSegments position={[0, ch / 2, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(cw, ch, cd)]} />
        <lineBasicMaterial color={isSelected ? '#fff' : '#333'} />
      </lineSegments>
      <ShapeLabel name={shape.name} position={[0, ch + 0.15, 0]} />
    </group>
  );
}

// ─── Parking Spot ─────────────────────────────────────────────
function ParkingSpot3D({ shape, isSelected, onSelect, isDraggable }) {
  const pw = (shape.spotWidth || 60) * SCALE;
  const pd = (shape.spotDepth || 120) * SCALE;
  const elev = (shape.z || 0) * SCALE;
  const rot = (shape.rotation || 0) * Math.PI / 180;
  const { hovered, handlers, meshRef } = useMeshInteraction(shape.id, onSelect, isDraggable);
  const pos = useMemo(() => {
    const cx = (shape.x + (shape.spotWidth || 60) / 2) * SCALE;
    const cz = -(shape.y + (shape.spotDepth || 120) / 2) * SCALE;
    return [cx, elev + 0.005, cz];
  }, [shape.x, shape.y, shape.spotWidth, shape.spotDepth, elev]);

  return (
    <group position={pos} rotation={[0, -rot, 0]}>
      {/* Ground surface */}
      <mesh ref={meshRef} {...handlers} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[pw, pd]} />
        {mat('#374151', 0.7, isSelected, hovered, { roughness: 0.95 })}
      </mesh>
      {/* White boundary lines (3 sides - open at front) */}
      {[
        { p: [-pw / 2, 0.002, 0], s: [0.015, 0.002, pd] },
        { p: [pw / 2, 0.002, 0], s: [0.015, 0.002, pd] },
        { p: [0, 0.002, pd / 2], s: [pw, 0.002, 0.015] },
      ].map(({ p, s }, i) => (
        <mesh key={`ln${i}`} position={p}>
          <boxGeometry args={s} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      ))}
      {/* P marking */}
      <Billboard position={[0, 0.01, 0]}>
        <Text fontSize={pw * 0.4} color="#ffffff" anchorY="middle">P</Text>
      </Billboard>
      <ShapeLabel name={shape.name} position={[0, 0.3, 0]} />
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════
//  SHAPE DISPATCHER
// ═════════════════════════════════════════════════════════════════
function Shape3D({ shape, isSelected, onSelect, isDraggable }) {
  const props = { shape, isSelected, onSelect, isDraggable };

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
    // Structural & layout elements
    case 'metalFrame': return <MetalFrame3D {...props} />;
    case 'fence':      return <Fence3D {...props} />;
    case 'gate':       return <Gate3D {...props} />;
    case 'platform':   return <Platform3D {...props} />;
    case 'stairs':     return <Stairs3D {...props} />;
    case 'solarPanel': return <SolarPanel3D {...props} />;
    case 'shed':       return <Shed3D {...props} />;
    case 'gardenBed':  return <GardenBed3D {...props} />;
    case 'pond':       return <Pond3D {...props} />;
    case 'lampPost':   return <LampPost3D {...props} />;
    case 'bench':      return <Bench3D {...props} />;
    case 'sign':       return <Sign3D {...props} />;
    case 'container':  return <Container3D {...props} />;
    case 'parkingSpot':return <ParkingSpot3D {...props} />;
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
  { type: 'road',      icon: '🛣️', label: 'Road',    group: 'real',  dims: { width: 300, roadWidth: 60, roadSurface: 'tar' } },
  // Structural & layout elements
  { type: 'metalFrame', icon: '🏗️', label: 'Metal Frame', group: 'structure', dims: { frameWidth: 150, frameDepth: 100, frameHeight: 1.5, barThickness: 3 } },
  { type: 'fence',      icon: '🏚️', label: 'Fence',       group: 'structure', dims: { width: 200, fenceHeight: 0.6 } },
  { type: 'gate',       icon: '🚪', label: 'Gate',        group: 'structure', dims: { gateWidth: 80, gateHeight: 0.8 } },
  { type: 'platform',   icon: '📋', label: 'Platform',    group: 'structure', dims: { width: 150, platformDepth: 120, platformHeight: 0.3 } },
  { type: 'stairs',     icon: '🪜', label: 'Stairs',      group: 'structure', dims: { stairWidth: 60, stairDepth: 100, stairHeight: 0.8, stairSteps: 5 } },
  { type: 'container',  icon: '📦', label: 'Container',   group: 'structure', dims: { containerWidth: 150, containerDepth: 60, containerHeight: 0.8 } },
  // Outdoor & site elements
  { type: 'solarPanel', icon: '☀️', label: 'Solar Panel', group: 'outdoor', dims: { panelWidth: 120, panelDepth: 80, panelTilt: 30, postHeight: 0.4 } },
  { type: 'shed',       icon: '🏡', label: 'Shed',        group: 'outdoor', dims: { shedWidth: 100, shedDepth: 80, shedHeight: 0.6, shedRoofHeight: 0.25 } },
  { type: 'gardenBed',  icon: '🌱', label: 'Garden Bed',  group: 'outdoor', dims: { bedWidth: 120, bedDepth: 60, bedHeight: 0.15 } },
  { type: 'pond',       icon: '💦', label: 'Pond',        group: 'outdoor', dims: { pondRadius: 50, pondDepth: 0.1 } },
  { type: 'lampPost',   icon: '💡', label: 'Lamp Post',   group: 'outdoor', dims: { poleHeight: 1.2 } },
  { type: 'bench',      icon: '🪑', label: 'Bench',       group: 'outdoor', dims: { benchWidth: 80 } },
  { type: 'sign',       icon: '🪧', label: 'Sign',        group: 'outdoor', dims: { signWidth: 60, signHeight: 0.4, poleHeight: 0.8 } },
  { type: 'parkingSpot',icon: '🅿️', label: 'Parking',     group: 'outdoor', dims: { spotWidth: 60, spotDepth: 120 } },
];

// Dimension labels
const DIM_LABELS = {
  width: 'Length (px)', height: 'Depth (px)', depth: 'Depth (px)',
  radius: 'Radius (px)', radiusX: 'Radius X (px)', radiusY: 'Radius Y (px)',
  extrudeHeight: 'Height (px)', length: 'Length (px)',
  outerRadius: 'Outer R (px)', innerRadius: 'Inner R (px)',
  angleFrom: 'Angle From', angleTo: 'Angle To', sides: 'Sides',
  thickness: 'Thickness (px)', pipeRadius: 'Pipe Radius (px)',
  cableRadius: 'Cable Radius (px)', postHeight: 'Post Height (px)',
  pathWidth: 'Path Width (px)', roadWidth: 'Road Width (px)', roadSurface: 'Surface Type',
  trunkRadius: 'Trunk R (px)', trunkHeight: 'Trunk Height (px)',
  canopyRadius: 'Canopy R (px)', roofHeight: 'Roof Height (px)',
  houseLength: 'Length (px)', houseWidth: 'Width (px)', houseHeight: 'Wall Height (px)',
  // New element dimensions
  frameWidth: 'Frame Width (px)', frameDepth: 'Frame Depth (px)',
  frameHeight: 'Frame Height', barThickness: 'Bar Thickness (px)',
  fenceHeight: 'Fence Height', gateWidth: 'Gate Width (px)', gateHeight: 'Gate Height',
  platformDepth: 'Platform Depth (px)', platformHeight: 'Platform Height',
  stairWidth: 'Width (px)', stairDepth: 'Depth (px)', stairHeight: 'Total Height', stairSteps: 'Steps',
  containerWidth: 'Length (px)', containerDepth: 'Depth (px)', containerHeight: 'Height',
  panelWidth: 'Panel Width (px)', panelDepth: 'Panel Depth (px)', panelTilt: 'Tilt Angle (°)',
  shedWidth: 'Width (px)', shedDepth: 'Depth (px)', shedHeight: 'Wall Height', shedRoofHeight: 'Roof Height',
  bedWidth: 'Bed Width (px)', bedDepth: 'Bed Depth (px)', bedHeight: 'Bed Height',
  pondRadius: 'Radius (px)', pondDepth: 'Water Depth',
  poleHeight: 'Pole Height', benchWidth: 'Width (px)',
  signWidth: 'Sign Width (px)', signHeight: 'Sign Height',
  spotWidth: 'Spot Width (px)', spotDepth: 'Spot Depth (px)',
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
function PropertiesPanel3D({ selectedShape, shapes, onUpdateShape, onDeleteShape, onContinueWall, origin, unit, pxPerUnit, onLinkStart, onUngroup, linkingFrom }) {
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
  const isPointBased = shape.points && shape.points.length >= 4 &&
    ['pipe', 'cable', 'line', 'path_line'].includes(t);

  // For point-based shapes, compute center from points
  let displayX = shape.x || 0;
  let displayY = shape.y || 0;
  if (isPointBased) {
    let sumX = 0, sumY = 0, n = 0;
    for (let i = 0; i < shape.points.length; i += 2) {
      sumX += shape.points[i];
      sumY += shape.points[i + 1];
      n++;
    }
    displayX = sumX / n;
    displayY = sumY / n;
  }

  // Relative position from origin
  const relX = toUnit(displayX - ox, ppu);
  const relY = toUnit(displayY - oy, ppu);

  // Convert display value from px → unit, and onChange back from unit → px
  const uVal = (pxVal) => parseFloat(toUnit(pxVal, ppu).toFixed(2));
  const pxFromInput = (unitVal) => fromUnit(unitVal, ppu);

  // Handler for X/Y changes on point-based shapes: move all points by delta
  const handlePointBasedMove = (axis, newPxVal) => {
    const oldVal = axis === 'x' ? displayX : displayY;
    const delta = newPxVal - oldVal;
    const newPoints = [...shape.points];
    for (let i = 0; i < newPoints.length; i += 2) {
      if (axis === 'x') newPoints[i] += delta;
      else newPoints[i + 1] += delta;
    }
    onUpdateShape(shape.id, { points: newPoints, [axis]: newPxVal });
  };

  return (
    <div className="three-height-panel glass">
      <h4>⚒️ {shape.name || shape.type}</h4>

      {/* ─ Position — absolute (editable) ─ */}
      <div className="three-prop-row">
        <span className="three-prop-label">X</span>
        <input type="number" className="three-prop-edit-input three-prop-inline"
          value={uVal(displayX)} step={uStep}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) {
            if (isPointBased) handlePointBasedMove('x', pxFromInput(v));
            else onUpdateShape(shape.id, { x: pxFromInput(v) });
          }}} />
        <span className="three-prop-edit-unit">{sym}</span>
      </div>
      <div className="three-prop-row">
        <span className="three-prop-label">Y</span>
        <input type="number" className="three-prop-edit-input three-prop-inline"
          value={uVal(displayY)} step={uStep}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) {
            if (isPointBased) handlePointBasedMove('y', pxFromInput(v));
            else onUpdateShape(shape.id, { y: pxFromInput(v) });
          }}} />
        <span className="three-prop-edit-unit">{sym}</span>
      </div>
      <div className="three-prop-row">
        <span className="three-prop-label" style={{ color: '#60a5fa' }}>Z <small>(elev)</small></span>
        <input type="number" className="three-prop-edit-input three-prop-inline"
          value={uVal(shape.z || 0)} step={uStep}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onUpdateShape(shape.id, { z: pxFromInput(v) }); }} />
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
          <PropInput label="Post Ht" value={parseFloat(toUnit((shape.postHeight || 0.5) / SCALE, ppu).toFixed(2))} step={uStep} min={0.01} unit={sym}
            onChange={(v) => onUpdateShape(shape.id, { postHeight: fromUnit(v, ppu) * SCALE })} />
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
          <div className="three-prop-section">
            <label className="three-prop-edit-label" style={{ marginBottom: 4 }}>Surface</label>
            <div className="three-surface-selector">
              {Object.entries(ROAD_SURFACES).map(([key, def]) => (
                <button key={key}
                  className={`three-surface-btn ${(shape.roadSurface || 'tar') === key ? 'active' : ''}`}
                  style={{ '--surface-color': def.color }}
                  onClick={() => onUpdateShape(shape.id, { roadSurface: key })}
                  title={def.label}>
                  <span className="three-surface-swatch" style={{ background: def.color }} />
                  <span className="three-surface-name">{def.label.split(/[\/\s]/)[0]}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="three-prop-divider" />

      {/* ─ Rotation (all types) ─ */}
      {(
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

      {/* ─ 3D Height (all types with extrudeHeight) — shown in selected unit ─ */}
      <div className="height-control">
        <label>Height</label>
        <input type="range" min="0.05" max="5" step="0.05" value={h}
          onChange={(e) => onUpdateShape(shape.id, { extrudeHeight: parseFloat(e.target.value) })} />
        <span>{toUnit(h / SCALE, ppu).toFixed(2)} {sym}</span>
      </div>
      <div className="three-prop-row">
        <span className="three-prop-label">Height</span>
        <input type="number" className="three-prop-edit-input three-prop-inline"
          value={parseFloat(toUnit(h / SCALE, ppu).toFixed(2))}
          step={uStep}
          min={0.01}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v > 0) onUpdateShape(shape.id, { extrudeHeight: fromUnit(v, ppu) * SCALE });
          }} />
        <span className="three-prop-edit-unit">{sym}</span>
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

      {/* ─ Group / Link ─ */}
      <div className="three-prop-divider" />
      {shape.groupId ? (
        <div className="three-group-section">
          <span className="three-group-badge">🔗 Linked group</span>
          <span className="three-group-count">
            ({shapes.filter(s => s.groupId === shape.groupId).length} objects)
          </span>
          <button className="three-group-btn three-ungroup-btn"
            onClick={() => onUngroup && onUngroup(shape.groupId)}
            title="Unlink all objects in this group">
            Unlink All
          </button>
          <button className="three-group-btn"
            onClick={() => onLinkStart && onLinkStart(shape.id)}
            title="Link another object to this group">
            + Link More
          </button>
        </div>
      ) : (
        <div className="three-group-section">
          {linkingFrom === shape.id ? (
            <span className="three-group-linking">Click another object to link...</span>
          ) : (
            <button className="three-group-btn"
              onClick={() => onLinkStart && onLinkStart(shape.id)}
              title="Link this object with another — they will move together">
              🔗 Link with...
            </button>
          )}
        </div>
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
  const isUnitless = (k) => k.includes('angle') || k === 'sides' || k === 'lineType' || k === 'roadSurface';

  const initDims = useMemo(() => {
    const d = {};
    Object.entries(elementDef.dims).forEach(([k, v]) => {
      if (isUnitless(k)) {
        d[k] = v;
      } else if (is3DKey(k)) {
        // 3D height stored as world units → convert to px then to unit
        d[k] = parseFloat(toUnit(v / SCALE, ppu).toFixed(2));
      } else {
        d[k] = parseFloat(toUnit(v, ppu).toFixed(2));
      }
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
          {key === 'roadSurface' ? (
            <select value={dims[key] || 'tar'}
              onChange={(e) => handleChange(key, e.target.value)}
              style={{ flex: 1 }}>
              {Object.entries(ROAD_SURFACES).map(([k, d]) => (
                <option key={k} value={k}>{d.label}</option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              value={dims[key]}
              step={key === 'sides' ? 1 : (unit === 'px' ? 5 : 0.1)}
              min={key === 'sides' ? 3 : (unit === 'px' ? 1 : 0.01)}
              onChange={(e) => handleChange(key, e.target.value)}
              autoFocus={i === 0}
            />
          )}
          <span className="three-dim-unit">
            {isUnitless(key) ? '' : sym}
          </span>
        </div>
      ))}
      <div className="three-dim-actions">
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={() => {
          // Convert unit values back to px (or world units for 3D keys)
          const finalDims = {};
          Object.entries(dims).forEach(([k, v]) => {
            // String-valued keys (like roadSurface) pass through as-is
            if (k === 'roadSurface' || k === 'lineType') { finalDims[k] = v; return; }
            const numV = typeof v === 'string' ? (parseFloat(v) || elementDef.dims[k]) : v;
            if (isUnitless(k)) {
              finalDims[k] = numV;
            } else if (is3DKey(k)) {
              // Convert from unit → px → world units
              finalDims[k] = fromUnit(numV, ppu) * SCALE;
            } else {
              finalDims[k] = fromUnit(numV, ppu);
            }
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

// ═════════════════════════════════════════════════════════════════
// DOM-LEVEL DRAG SYSTEM
// Completely bypasses R3F's synthetic event system and OrbitControls
// event conflicts by using capture-phase DOM listeners + manual raycasting.
// This is the only reliable way to make drag work alongside OrbitControls.
// ═════════════════════════════════════════════════════════════════
function DomDragSystem({ controlsRef, shapesRef, onDragMove, onDragEnd, onDragStart, viewPreset, moveLock }) {
  const { gl, camera, scene } = useThree();
  const raycasterRef = useRef(new THREE.Raycaster());
  const hitPoint = useRef(new THREE.Vector3());
  // Stable axis-aligned planes — never recomputed from camera direction
  const planes = useMemo(() => ({
    ground: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),   // Y=0  (for top/perspective)
    front:  new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),   // Z=0  (for front view)
    right:  new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),   // X=0  (for right view)
  }), []);
  // dragRef: { shapeId, offsetX, offsetY, offsetZ, frozenX, frozenY, frozenZ }
  // frozenX/frozenY/frozenZ: the axis value that is locked for this view
  const dragRef = useRef(null);

  useEffect(() => {
    const canvas = gl.domElement;
    const parent = canvas.parentElement;

    const getMouse = (e) => {
      const rect = canvas.getBoundingClientRect();
      return new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
    };

    // Compute shape center in 2D px
    const shapeCenter = (shape) => {
      if (!shape) return { cx: 0, cy: 0 };
      // Point-based shapes: compute center from points array
      if (shape.points && shape.points.length >= 4 &&
          ['pipe', 'cable', 'line', 'path_line'].includes(shape.type)) {
        let sumX = 0, sumY = 0, n = 0;
        for (let i = 0; i < shape.points.length; i += 2) {
          sumX += shape.points[i];
          sumY += shape.points[i + 1];
          n++;
        }
        return { cx: sumX / n, cy: sumY / n };
      }
      if (shape.type === 'rectangle' || shape.type === 'wall' || shape.type === 'path' || shape.type === 'road') {
        return {
          cx: (shape.x || 0) + (shape.width || 50) / 2,
          cy: (shape.y || 0) + (shape.height || shape.thickness || shape.pathWidth || shape.roadWidth || 50) / 2,
        };
      }
      if (shape.type === 'house') {
        return {
          cx: (shape.x || 0) + (shape.houseLength || shape.width || 120) / 2,
          cy: (shape.y || 0) + (shape.houseWidth || shape.depth || 100) / 2,
        };
      }
      return { cx: shape.x || 0, cy: shape.y || 0 };
    };

    // Project mouse → 2D px on the appropriate stable plane.
    // Returns { x, y, z } where null means "keep frozen value for this axis".
    // z = elevation in px (from vertical component in front/right views)
    const project = (e) => {
      raycasterRef.current.setFromCamera(getMouse(e), camera);
      const hp = hitPoint.current;

      if (viewPreset === 'top' || viewPreset === 'perspective') {
        // Ground plane (Y=0) — both axes movable, no elevation drag
        if (raycasterRef.current.ray.intersectPlane(planes.ground, hp)) {
          return { x: hp.x / SCALE, y: -hp.z / SCALE, z: null };
        }
      } else if (viewPreset === 'front') {
        // XY plane (Z=0) — horizontal = 2D x, vertical = elevation (Y axis in 3D = z in px)
        if (raycasterRef.current.ray.intersectPlane(planes.front, hp)) {
          return { x: hp.x / SCALE, y: null, z: hp.y / SCALE };
        }
      } else if (viewPreset === 'right') {
        // YZ plane (X=0) — horizontal = 2D y, vertical = elevation
        if (raycasterRef.current.ray.intersectPlane(planes.right, hp)) {
          return { x: null, y: -hp.z / SCALE, z: hp.y / SCALE };
        }
      }
      return null;
    };

    // Find which draggable shape is under the pointer
    const findDraggableShape = (e) => {
      raycasterRef.current.setFromCamera(getMouse(e), camera);
      const intersects = raycasterRef.current.intersectObjects(scene.children, true);
      for (const hit of intersects) {
        let obj = hit.object;
        while (obj) {
          if (obj.userData && obj.userData.shapeId && obj.userData.draggable) {
            return obj.userData.shapeId;
          }
          obj = obj.parent;
        }
      }
      return null;
    };

    // ─── POINTER DOWN (capture phase — fires BEFORE OrbitControls) ───
    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      const shapeId = findDraggableShape(e);
      if (!shapeId) return;

      // Prevent OrbitControls from seeing this event
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (controlsRef?.current) controlsRef.current.enabled = false;

      const shapes = shapesRef.current || [];
      const shape = shapes.find(s => s.id === shapeId);
      const { cx, cy } = shapeCenter(shape);
      const cz = shape.z || 0; // current elevation in px

      // Project cursor and compute offset
      const cursorPos = project(e);
      const offsetX = (cursorPos && cursorPos.x !== null) ? cx - cursorPos.x : 0;
      const offsetY = (cursorPos && cursorPos.y !== null) ? cy - cursorPos.y : 0;
      const offsetZ = (cursorPos && cursorPos.z !== null) ? cz - cursorPos.z : 0;

      // For constrained views, freeze the non-movable axis at the current value
      dragRef.current = {
        shapeId,
        offsetX,
        offsetY,
        offsetZ,
        frozenX: cx,
        frozenY: cy,
        frozenZ: cz,
      };
      document.body.style.cursor = 'grabbing';
      onDragStart(shapeId);
    };

    // ─── POINTER MOVE ───
    const onPointerMove = (e) => {
      if (!dragRef.current) return;
      const pos = project(e);
      if (!pos) return;

      const d = dragRef.current;
      // For each axis: if projection returns null, use frozen value
      const newX = pos.x !== null ? Math.round(pos.x + d.offsetX) : d.frozenX;
      const newY = pos.y !== null ? Math.round(pos.y + d.offsetY) : d.frozenY;
      const newZ = pos.z !== null ? Math.round(pos.z + d.offsetZ) : d.frozenZ;

      onDragMove(d.shapeId, newX, newY, newZ);
    };

    // ─── POINTER UP ───
    const onPointerUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = '';
      if (controlsRef?.current && !moveLock) controlsRef.current.enabled = true;
      onDragEnd();
    };

    // Capture phase on canvas + parent div (fires before OrbitControls bubble)
    canvas.addEventListener('pointerdown', onPointerDown, true);
    if (parent) parent.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      if (parent) parent.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [gl, camera, scene, controlsRef, shapesRef, onDragMove, onDragEnd, onDragStart, viewPreset, planes, moveLock]);

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
      arr.push({ key: `x${i}`, pos: [worldPos, 0.02, 0.15], text: txt, color: 'rgba(52,211,153,0.5)' });
      // Z-axis labels (along the blue axis, X=0) — 3D Z is negative of 2D Y
      arr.push({ key: `z${i}`, pos: [0.15, 0.02, worldPos], text: txt, color: 'rgba(52,211,153,0.5)' });
      // Y-axis labels (vertical / elevation) — only positive
      if (i > 0) {
        arr.push({ key: `y${i}`, pos: [0.15, worldPos, 0.15], text: txt, color: 'rgba(96,165,250,0.6)' });
      }
    }
    return arr;
  }, [sectionWorld, section, sym]);

  return (
    <group>
      {labels.map(l => (
        <Billboard key={l.key} position={l.pos}>
          <Text fontSize={0.12} color={l.color} anchorX="left" anchorY="middle">
            {l.text}
          </Text>
        </Billboard>
      ))}
      {/* Origin "0" label */}
      <Billboard position={[0.1, 0.02, 0.1]}>
        <Text fontSize={0.14} color="#34d399" anchorX="left" anchorY="middle" fontWeight="bold">0</Text>
      </Billboard>
      {/* Y-axis indicator line (vertical) */}
      <Line
        points={[[0, 0, 0], [0, count * sectionWorld, 0]]}
        color="#60a5fa"
        lineWidth={0.5}
        transparent
        opacity={0.3}
      />
    </group>
  );
}

// ─── Crosshair ────────────────────────────────────────────────────
// ─── Measurement Line (shown between two clicked points) ─────────
function MeasureLine3D({ points, unit, pxPerUnit }) {
  if (!points || points.length < 2) return null;
  const p1 = points[0];
  const p2 = points[1];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const distPx = Math.sqrt(dx * dx + dy * dy);
  const distUnit = toUnit(distPx, pxPerUnit || 1);
  const sym = UNIT_DEFS[unit]?.symbol || 'px';

  const a = [p1.x * SCALE, 0.1, -p1.y * SCALE];
  const b = [p2.x * SCALE, 0.1, -p2.y * SCALE];
  const mid = [(a[0] + b[0]) / 2, 0.35, (a[2] + b[2]) / 2];

  return (
    <group>
      <Line points={[a, b]} color="#f59e0b" lineWidth={3} dashed dashSize={0.08} gapSize={0.04} />
      {/* End markers */}
      {[a, b].map((pt, i) => (
        <mesh key={i} position={pt}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.5} />
        </mesh>
      ))}
      <Billboard position={mid}>
        <Text fontSize={0.14} color="#fbbf24" anchorY="bottom" outlineWidth={0.008} outlineColor="#000">
          {distUnit.toFixed(2)} {sym}
        </Text>
      </Billboard>
    </group>
  );
}

// ─── Measurement click handler (inside Canvas) ───────────────────
function MeasureClickHandler({ active, onPoint }) {
  const { camera, gl } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    if (!active) return;
    const canvas = gl.domElement;
    const onClick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const rc = new THREE.Raycaster();
      rc.setFromCamera(mouse, camera);
      if (rc.ray.intersectPlane(plane, hit)) {
        onPoint({ x: hit.x / SCALE, y: -hit.z / SCALE });
      }
    };
    canvas.addEventListener('click', onClick);
    return () => canvas.removeEventListener('click', onClick);
  }, [active, camera, gl, plane, hit, onPoint]);

  return null;
}

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
          isDraggable={isDraggable} />
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
          isDraggable={false} />
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
  const [addingElement, setAddingElement] = useState(null);
  const [showSixViews, setShowSixViews] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [draggingOrigin, setDraggingOrigin] = useState(false);
  const [linkingFrom, setLinkingFrom] = useState(null); // shapeId we're linking FROM (group mode)
  const [unit, setUnit] = useState(() => {
    try { const v = localStorage.getItem('pp3d_unit'); return v && UNIT_DEFS[v] ? v : 'px'; } catch { return 'px'; }
  });
  const [pxPerUnit, setPxPerUnit] = useState(() => {
    try { const v = parseFloat(localStorage.getItem('pp3d_pxPerUnit')); return v > 0 ? v : UNIT_DEFS.px.defaultPPU; } catch { return UNIT_DEFS.px.defaultPPU; }
  });
  const [ratioLocked, setRatioLocked] = useState(() => {
    try { return localStorage.getItem('pp3d_ratioLocked') === 'true'; } catch { return false; }
  });
  const [polarAngle, setPolarAngle] = useState(Math.PI / 4); // ~45° default
  const [moveLock, setMoveLock] = useState(false); // when true, orbit is disabled; only object dragging works
  const [snapToGrid, setSnapToGrid] = useState(false); // snap dragged objects to grid
  const [measureMode, setMeasureMode] = useState(false); // measurement tool active
  const [measurePoints, setMeasurePoints] = useState([]); // [{x,y}] clicked measure points
  const clipboardRef = useRef(null); // copied shape data for paste
  const controlsRef = useRef();
  const meshInteractedRef = useRef(false); // prevents onPointerMissed from deselecting after a mesh click
  const dragActiveRef = useRef(false);      // true while a drag is in progress — suppresses onClick toggle
  const shapesRef = useRef(localShapes);    // always-current shapes for DOM drag system

  // ─── Undo / Redo history ───
  const undoStackRef = useRef([]);    // past states (most recent at end)
  const redoStackRef = useRef([]);    // future states
  const isUndoRedoRef = useRef(false); // flag to skip pushing when restoring
  const MAX_UNDO = 80;

  // Push current state to undo stack before any mutation
  const pushUndo = useCallback((currentShapes) => {
    if (isUndoRedoRef.current) return;
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), JSON.parse(JSON.stringify(currentShapes))];
    redoStackRef.current = []; // clear redo on new action
  }, []);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop();
    redoStackRef.current.push(JSON.parse(JSON.stringify(shapesRef.current)));
    isUndoRedoRef.current = true;
    setLocalShapes(prev);
    onShapesChange?.(prev);
    shapesRef.current = prev;
    isUndoRedoRef.current = false;
  }, [onShapesChange]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop();
    undoStackRef.current.push(JSON.parse(JSON.stringify(shapesRef.current)));
    isUndoRedoRef.current = true;
    setLocalShapes(next);
    onShapesChange?.(next);
    shapesRef.current = next;
    isUndoRedoRef.current = false;
  }, [onShapesChange]);

  // Persist unit settings to localStorage
  useEffect(() => { try { localStorage.setItem('pp3d_unit', unit); } catch {} }, [unit]);
  useEffect(() => { try { localStorage.setItem('pp3d_pxPerUnit', String(pxPerUnit)); } catch {} }, [pxPerUnit]);
  useEffect(() => { try { localStorage.setItem('pp3d_ratioLocked', String(ratioLocked)); } catch {} }, [ratioLocked]);

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
  useEffect(() => { shapesRef.current = localShapes; }, [localShapes]);

  const bounds = useMemo(() => computeBounds(localShapes), [localShapes]);

  const handleSelect = useCallback((id) => {
    // If a drag is active or just finished, don't toggle — the drag already set selection
    if (dragActiveRef.current) return;
    meshInteractedRef.current = true;
    setTimeout(() => { meshInteractedRef.current = false; }, 150);

    // If we're in linking mode, link the two shapes
    if (linkingFrom && id !== linkingFrom) {
      pushUndo(shapesRef.current);
      setLocalShapes(prev => {
        const srcShape = prev.find(s => s.id === linkingFrom);
        const existingGroupId = srcShape?.groupId;
        const tgtShape = prev.find(s => s.id === id);
        const tgtGroupId = tgtShape?.groupId;
        // Use existing groupId if source already has one, else generate new
        const gid = existingGroupId || tgtGroupId ||
          (crypto.randomUUID ? crypto.randomUUID() : `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
        const next = prev.map(s => {
          if (s.id === linkingFrom || s.id === id) return { ...s, groupId: gid };
          // Also pull in any shapes from either existing group
          if (existingGroupId && s.groupId === existingGroupId) return { ...s, groupId: gid };
          if (tgtGroupId && s.groupId === tgtGroupId) return { ...s, groupId: gid };
          return s;
        });
        onShapesChange?.(next);
        return next;
      });
      setLinkingFrom(null);
      setSelectedId(id);
      return;
    }

    setSelectedId(prev => prev === id ? null : id);
  }, [linkingFrom, pushUndo, onShapesChange]);

  const handleUpdateShape = useCallback((id, updates) => {
    pushUndo(shapesRef.current);
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

  const handleDeselect = useCallback((e) => {
    // Skip deselect if a mesh was just clicked or drag is active
    if (meshInteractedRef.current || dragActiveRef.current) return;
    // Only deselect if the click was actually on the canvas (not on overlay UI)
    if (e && e.target && e.target.tagName && e.target.tagName !== 'CANVAS') return;
    setSelectedId(null);
  }, []);

  // Delete selected element
  const handleDeleteShape = useCallback((id) => {
    pushUndo(shapesRef.current);
    setLocalShapes(prev => {
      const next = prev.filter(s => s.id !== id);
      onShapesChange?.(next);
      return next;
    });
    setSelectedId(null);
  }, [onShapesChange]);

  // Keyboard shortcuts: Delete, Undo (Ctrl+Z), Redo (Ctrl+Y / Ctrl+Shift+Z)
  useEffect(() => {
    const onKey = (e) => {
      // Don't handle if user is typing in an input
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      // Escape: cancel linking mode
      if (e.key === 'Escape') {
        if (linkingFrom) { setLinkingFrom(null); return; }
        if (selectedId) { setSelectedId(null); return; }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        handleDeleteShape(selectedId);
        return;
      }
      // Undo: Ctrl+Z (or Cmd+Z on Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      // Redo: Ctrl+Y or Ctrl+Shift+Z (or Cmd equivalents)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey) || (e.key === 'Z' && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }
      // Copy: Ctrl+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedId) {
        e.preventDefault();
        const shape = shapesRef.current.find(s => s.id === selectedId);
        if (shape) {
          clipboardRef.current = JSON.parse(JSON.stringify(shape));
        }
        return;
      }
      // Paste: Ctrl+V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboardRef.current) {
        e.preventDefault();
        pushUndo(shapesRef.current);
        const src = clipboardRef.current;
        const newId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const offset = 30; // px offset so pasted shape doesn't overlap original
        const pasted = { ...JSON.parse(JSON.stringify(src)), id: newId, groupId: undefined };
        pasted.x = (pasted.x || 0) + offset;
        pasted.y = (pasted.y || 0) + offset;
        pasted.name = (pasted.name || pasted.type) + ' (copy)';
        // Offset points for point-based shapes
        if (pasted.points && pasted.points.length >= 4) {
          pasted.points = pasted.points.map((v, i) => v + offset);
        }
        setLocalShapes(prev => {
          const next = [...prev, pasted];
          onShapesChange?.(next);
          shapesRef.current = next;
          return next;
        });
        setSelectedId(newId);
        return;
      }
      // Duplicate: Ctrl+D
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedId) {
        e.preventDefault();
        const shape = shapesRef.current.find(s => s.id === selectedId);
        if (!shape) return;
        pushUndo(shapesRef.current);
        const newId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const offset = 30;
        const dup = { ...JSON.parse(JSON.stringify(shape)), id: newId, groupId: undefined };
        dup.x = (dup.x || 0) + offset;
        dup.y = (dup.y || 0) + offset;
        dup.name = (dup.name || dup.type) + ' (copy)';
        if (dup.points && dup.points.length >= 4) {
          dup.points = dup.points.map((v, i) => v + offset);
        }
        setLocalShapes(prev => {
          const next = [...prev, dup];
          onShapesChange?.(next);
          shapesRef.current = next;
          return next;
        });
        setSelectedId(newId);
        return;
      }
      // Toggle snap: Ctrl+G
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        setSnapToGrid(prev => !prev);
        return;
      }
      // Toggle measure: M key
      if (e.key === 'm' || e.key === 'M') {
        setMeasureMode(prev => { if (prev) setMeasurePoints([]); return !prev; });
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, handleDeleteShape, undo, redo, linkingFrom, pushUndo, onShapesChange]);

  // Add new element
  // Add new element
  const handleAddElement = useCallback((dims, name) => {
    if (!addingElement) return;
    pushUndo(shapesRef.current);
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

  // ─── DOM-level drag callbacks (called by DomDragSystem) ───
  const handleDomDragStart = useCallback((shapeId) => {
    pushUndo(shapesRef.current);
    meshInteractedRef.current = true;
    dragActiveRef.current = true;
    setSelectedId(shapeId);
  }, [pushUndo]);

  // Move a single shape by a delta (dx, dy) and optionally set absolute z
  const moveShapeByDelta = (s, dx, dy, dz) => {
    const zUpdate = dz !== undefined ? { z: (s.z || 0) + dz } : {};

    // Point-based shapes: move all points
    if (s.points && s.points.length >= 4 &&
        ['pipe', 'cable', 'line', 'path_line'].includes(s.type)) {
      const newPoints = [...s.points];
      for (let i = 0; i < newPoints.length; i += 2) {
        newPoints[i] = Math.round(newPoints[i] + dx);
        newPoints[i + 1] = Math.round(newPoints[i + 1] + dy);
      }
      return { ...s, x: (s.x || 0) + dx, y: (s.y || 0) + dy, points: newPoints, ...zUpdate };
    }
    return { ...s, x: (s.x || 0) + dx, y: (s.y || 0) + dy, ...zUpdate };
  };

  // Get center of a shape in 2D px
  const getShapeCenter = (s) => {
    if (s.points && s.points.length >= 4 &&
        ['pipe', 'cable', 'line', 'path_line'].includes(s.type)) {
      let sumX = 0, sumY = 0, n = 0;
      for (let i = 0; i < s.points.length; i += 2) {
        sumX += s.points[i]; sumY += s.points[i + 1]; n++;
      }
      return { cx: sumX / n, cy: sumY / n };
    }
    if (s.type === 'rectangle' || s.type === 'wall' || s.type === 'path' || s.type === 'road') {
      return {
        cx: (s.x || 0) + (s.width || 50) / 2,
        cy: (s.y || 0) + (s.height || s.thickness || s.pathWidth || s.roadWidth || 50) / 2,
      };
    }
    if (s.type === 'house') {
      return {
        cx: (s.x || 0) + (s.houseLength || s.width || 120) / 2,
        cy: (s.y || 0) + (s.houseWidth || s.depth || 100) / 2,
      };
    }
    return { cx: s.x || 0, cy: s.y || 0 };
  };

  const snapRef = useRef(snapToGrid);
  useEffect(() => { snapRef.current = snapToGrid; }, [snapToGrid]);

  const handleDomDragMove = useCallback((shapeId, newCenterX, newCenterY, newZ) => {
    // Apply snap-to-grid if enabled
    const gridSnap = snapRef.current ? (uDef.gridCell * pxPerUnit) : 1;
    const snap = (v) => snapRef.current ? Math.round(v / gridSnap) * gridSnap : Math.round(v);
    const cx = snap(newCenterX);
    const cy = snap(newCenterY);
    setLocalShapes(prev => {
      const draggedShape = prev.find(s => s.id === shapeId);
      if (!draggedShape) return prev;

      // Compute delta from old center of dragged shape
      const oldCenter = getShapeCenter(draggedShape);
      const dx = cx - Math.round(oldCenter.cx);
      const dy = cy - Math.round(oldCenter.cy);
      const dz = newZ != null ? Math.round(newZ) - (draggedShape.z || 0) : undefined;

      // Find group members (if any)
      const groupId = draggedShape.groupId;

      const next = prev.map(s => {
        if (s.id === shapeId) {
          return moveShapeByDelta(s, dx, dy, dz);
        }
        // Move group members by same delta (but not z — only dragged shape gets z change)
        if (groupId && s.groupId === groupId) {
          return moveShapeByDelta(s, dx, dy, undefined);
        }
        return s;
      });
      shapesRef.current = next;
      return next;
    });
  }, []);

  const handleDomDragEnd = useCallback(() => {
    // Persist the current shapes
    onShapesChange?.(shapesRef.current);
    // Keep dragActiveRef true briefly so the onClick that fires right after pointerUp doesn't toggle
    setTimeout(() => {
      dragActiveRef.current = false;
      meshInteractedRef.current = false;
    }, 150);
  }, [onShapesChange]);

  // ─── Group / Link handlers ───
  // ─── Measurement point handler ───
  const handleMeasurePoint = useCallback((pt) => {
    setMeasurePoints(prev => {
      if (prev.length >= 2) return [pt]; // start new measurement
      return [...prev, pt];
    });
  }, []);

  const handleLinkStart = useCallback((shapeId) => {
    setLinkingFrom(shapeId);
  }, []);

  const handleUngroup = useCallback((groupId) => {
    pushUndo(shapesRef.current);
    setLocalShapes(prev => {
      const next = prev.map(s => s.groupId === groupId ? { ...s, groupId: undefined } : s);
      onShapesChange?.(next);
      return next;
    });
  }, [onShapesChange, pushUndo]);

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
    pushUndo(shapesRef.current);
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
        <DomDragSystem
          controlsRef={controlsRef}
          shapesRef={shapesRef}
          onDragStart={handleDomDragStart}
          onDragMove={handleDomDragMove}
          onDragEnd={handleDomDragEnd}
          viewPreset={viewPreset}
          moveLock={moveLock}
        />
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
            isDraggable={true} />
        ))}

        {/* Measurement tool */}
        {measureMode && <MeasureClickHandler active={measureMode} onPoint={handleMeasurePoint} />}
        {measurePoints.length >= 2 && <MeasureLine3D points={measurePoints} unit={unit} pxPerUnit={pxPerUnit} />}
        {measurePoints.length === 1 && (
          <mesh position={[measurePoints[0].x * SCALE, 0.1, -measurePoints[0].y * SCALE]}>
            <sphereGeometry args={[0.04, 8, 8]} />
            <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.5} />
          </mesh>
        )}

        {/* Origin / Reference Point */}
        <OriginMarker3D origin={origin} onDragOrigin={handleOriginDragStart} isTopDown={isTopDown} />
        {draggingOrigin && <OriginDragHandler dragging={draggingOrigin} onMove={handleOriginDragMove} onEnd={handleOriginDragEnd} />}

        <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08}
          minDistance={0.5} maxDistance={80}
          maxPolarAngle={isTopDown ? 0.01 : Math.PI / 2 - 0.05}
          enableRotate={!isTopDown && !moveLock}
          enablePan={!moveLock}
          enableZoom={!moveLock}
          zoomSpeed={1.2}
          panSpeed={isTopDown ? 1.5 : 1.0}
          screenSpacePanning={true}
          mouseButtons={{
            LEFT: moveLock ? undefined : (isTopDown ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE),
            MIDDLE: moveLock ? undefined : THREE.MOUSE.DOLLY,
            RIGHT: moveLock ? undefined : THREE.MOUSE.PAN,
          }}
          touches={{
            ONE: moveLock ? undefined : (isTopDown ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE),
            TWO: moveLock ? undefined : THREE.TOUCH.DOLLY_PAN,
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
        <div style={{ height: '1px', background: 'rgba(52,211,153,0.2)', margin: '4px 0' }} />
        <button className={`three-view-btn ${moveLock ? 'active' : ''}`}
          onClick={() => setMoveLock(!moveLock)}
          title={moveLock ? 'Unlock orbit (currently: move-only mode)' : 'Lock orbit — only move objects'}>
          <span className="three-view-icon">{moveLock ? '🔒' : '🔓'}</span>
          <span className="three-view-label">{moveLock ? 'Locked' : 'Move'}</span>
        </button>
        <div style={{ height: '1px', background: 'rgba(52,211,153,0.2)', margin: '4px 0' }} />
        <button className="three-view-btn"
          onClick={undo}
          title="Undo (Ctrl+Z)">
          <span className="three-view-icon">↩️</span>
          <span className="three-view-label">Undo</span>
        </button>
        <button className="three-view-btn"
          onClick={redo}
          title="Redo (Ctrl+Y)">
          <span className="three-view-icon">↪️</span>
          <span className="three-view-label">Redo</span>
        </button>
        <div style={{ height: '1px', background: 'rgba(52,211,153,0.2)', margin: '4px 0' }} />
        <button className={`three-view-btn ${snapToGrid ? 'active' : ''}`}
          onClick={() => setSnapToGrid(!snapToGrid)}
          title={`Snap to grid (Ctrl+G) — ${snapToGrid ? 'ON' : 'OFF'}`}>
          <span className="three-view-icon">{snapToGrid ? '🧲' : '🔘'}</span>
          <span className="three-view-label">Snap</span>
        </button>
        <button className={`three-view-btn ${measureMode ? 'active' : ''}`}
          onClick={() => { setMeasureMode(!measureMode); if (measureMode) setMeasurePoints([]); }}
          title="Measurement tool (M key)">
          <span className="three-view-icon">📏</span>
          <span className="three-view-label">Measure</span>
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
        {linkingFrom && (
          <div className="three-link-banner glass" style={{
            background: 'rgba(96,165,250,0.25)', border: '1px solid rgba(96,165,250,0.5)',
            padding: '6px 14px', borderRadius: 8, fontSize: 13, color: '#93c5fd',
            display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'auto', zIndex: 25,
          }}>
            🔗 Click another object to link • <button
              onClick={() => setLinkingFrom(null)}
              style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#93c5fd',
                padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
              Cancel (Esc)
            </button>
          </div>
        )}
      </div>

      <div className="three-overlay-bottom glass">
        {measureMode ? (
          <span style={{ color: '#fbbf24' }}>📏 Measure: {measurePoints.length === 0 ? 'Click first point' : measurePoints.length === 1 ? 'Click second point' : 'Done! Click to start new'} (M to exit)</span>
        ) : isTopDown ? (
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
        {snapToGrid && <span style={{ color: '#34d399' }}>🧲 Snap ON</span>}
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
        <div className="three-toolbar-divider" />
        <button
          className="three-elem-btn three-export-catalog-btn"
          onClick={() => {
            const catalog = ELEMENT_CATALOG.map(elem => {
              const dimEntries = Object.entries(elem.dims).map(([key, defaultValue]) => ({
                key,
                label: DIM_LABELS[key] || key,
                defaultValue,
                type: typeof defaultValue === 'string' ? 'string' : 'number',
              }));
              return {
                type: elem.type,
                icon: elem.icon,
                label: elem.label,
                group: elem.group,
                capabilities: {
                  draggable: true,
                  rotatable: true,
                  elevationZ: true,
                  resizable: true,
                  colorCustomizable: true,
                  opacityControl: true,
                  groupLinkable: true,
                  snapToGrid: true,
                  copyPaste: true,
                  undoRedo: true,
                  pointBased: ['pipe', 'cable', 'line', 'path_line'].includes(elem.type),
                  roadSurfaces: elem.type === 'road',
                  wallContinuation: elem.type === 'wall',
                },
                dimensions: dimEntries,
                defaultDimensions: { ...elem.dims },
              };
            });
            const exportData = {
              name: 'PlantPlanner Element Catalog',
              version: '1.0',
              exportedAt: new Date().toISOString(),
              totalElements: catalog.length,
              groups: [...new Set(ELEMENT_CATALOG.map(e => e.group))],
              elements: catalog,
            };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `element-catalog-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          title="Export full element catalog as JSON"
        >
          <span className="three-elem-icon">📋</span>
          <span className="three-elem-label">Export Catalog</span>
        </button>
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
        onLinkStart={handleLinkStart}
        onUngroup={handleUngroup}
        linkingFrom={linkingFrom}
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
