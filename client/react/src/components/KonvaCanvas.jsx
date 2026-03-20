import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Rect, Circle, Line, Ellipse, RegularPolygon, Text, Transformer, Group, Arc } from 'react-konva';

const DRAW_STYLE = {
  fill: 'rgba(52, 211, 153, 0.15)',
  stroke: '#34d399',
  strokeWidth: 2,
};

const LINE_TYPES = {
  general: { label: 'General', stroke: '#ffffff', dash: [], strokeWidth: 4, icon: '➖' },
  piping: { label: 'Piping', stroke: '#06b6d4', dash: [2, 3], strokeWidth: 4, icon: '💧' },
  electrical: { label: 'Cabling', stroke: '#f59e0b', dash: [10, 5], strokeWidth: 3, icon: '⚡' },
  fencing: { label: 'Fence', stroke: '#94a3b8', dash: [15, 4, 2, 4], strokeWidth: 2, icon: '⬛' },
  pathway: { label: 'Path', stroke: '#34d399', dash: [20, 10], strokeWidth: 6, icon: '👣' },
};

// Shared Label Component for dimensions
const DimensionLabel = ({ x, y, text }) => {
  const width = text.length * 8 + 14;
  return (
    <Group x={x} y={y}>
      <Rect
        fill="rgba(17, 24, 39, 0.9)"
        stroke="#34d399"
        strokeWidth={1}
        width={width}
        height={22}
        cornerRadius={4}
        offsetX={width / 2}
        offsetY={11}
        shadowColor="black"
        shadowBlur={4}
        shadowOpacity={0.3}
      />
      <Text
        text={text}
        fill="#34d399"
        fontSize={12}
        fontStyle="bold"
        align="center"
        verticalAlign="middle"
        width={width}
        height={22}
        offsetX={width / 2}
        offsetY={11}
      />
    </Group>
  );
};

// Extracted Properties Panel — Unit-Aware & High Fidelity
const PropertiesPanel = ({ shape, onChange, onChangeBatch, onCommit, onDelete, unit, pxPerUnit, origin }) => {
  // We keep local state in the CURRENT UNIT (m, ft, or px) to avoid snapping
  const [local, setLocal] = useState({});

  const toUnit = useCallback((px) => {
    if (unit === 'px' || !px) return px;
    return (px / pxPerUnit).toFixed(2);
  }, [unit, pxPerUnit]);

  const fromUnit = useCallback((val) => {
    const num = parseFloat(val);
    if (isNaN(num)) return null;
    return unit === 'px' ? num : num * pxPerUnit;
  }, [unit, pxPerUnit]);

  // Transform coordinates for display: (CanvasPX - OriginPX) -> Unit
  const toRelativeUnit = useCallback((px, isAxisX) => {
    const relativePx = px - (isAxisX ? origin.x : origin.y);
    if (unit === 'px') return Math.round(relativePx);
    return (relativePx / pxPerUnit).toFixed(2);
  }, [unit, pxPerUnit, origin]);

  // Transform input to absolute canvas pixels: (UnitInput -> RelativePX) + OriginPX
  const fromRelativeUnit = useCallback((val, isAxisX) => {
    const num = parseFloat(val);
    if (isNaN(num)) return null;
    const relPx = unit === 'px' ? num : num * pxPerUnit;
    return relPx + (isAxisX ? origin.x : origin.y);
  }, [unit, pxPerUnit, origin]);

  // Sync local state when shape, unit, or origin changes
  useEffect(() => {
    const nextLocal = { ...shape };

    // Position keys (Relative to Origin)
    ['x', 'y'].forEach(k => {
      if (nextLocal[k] !== undefined) nextLocal[k] = toRelativeUnit(nextLocal[k], k === 'x');
    });

    // Dimension keys (Absolute size, not relative to origin position)
    const dimKeys = ['width', 'height', 'radius', 'radiusX', 'radiusY', 'outerRadius', 'innerRadius'];
    dimKeys.forEach(k => {
      if (nextLocal[k] !== undefined) nextLocal[k] = toUnit(nextLocal[k]);
    });

    if (nextLocal.points) {
      nextLocal.points = nextLocal.points.map((p, i) => toRelativeUnit(p, i % 2 === 0));
    }

    if (shape.type === 'line' && shape.points) {
      const p = shape.points;
      const dx = p[2] - p[0];
      const dy = p[3] - p[1];
      const lenPx = Math.sqrt(dx * dx + dy * dy);
      nextLocal.length = toUnit(lenPx);
    }

    setLocal(nextLocal);
  }, [shape.id, unit, pxPerUnit, origin]);

  const handleChange = (key, val) => {
    setLocal(prev => ({ ...prev, [key]: val }));
    const pxVal = (key === 'x' || key === 'y') ? fromRelativeUnit(val, key === 'x') : fromUnit(val);
    if (pxVal !== null) {
      onChange(key, pxVal);
    }
  };

  const handlePointChange = (idx, axis, val) => {
    const newPoints = [...(local.points || [])];
    newPoints[axis === 'x' ? idx * 2 : idx * 2 + 1] = val;
    setLocal(prev => ({ ...prev, points: newPoints }));

    const pxVal = fromRelativeUnit(val, axis === 'x');
    if (pxVal !== null) {
      const finalPxPoints = [...(shape.points || [])];
      finalPxPoints[axis === 'x' ? idx * 2 : idx * 2 + 1] = pxVal;
      onChange('points', finalPxPoints);
    }
  };

  const handleLengthChange = (val) => {
    setLocal(prev => ({ ...prev, length: val }));
    const newLen = parseFloat(val);
    if (isNaN(newLen) || newLen <= 0) return;

    const newLenPx = unit === 'px' ? newLen : newLen * pxPerUnit;
    const p = shape.points;
    const dx = p[2] - p[0];
    const dy = p[3] - p[1];
    const currentLen = Math.sqrt(dx * dx + dy * dy);

    if (currentLen < 0.1) {
      onChange('points', [p[0], p[1], p[0] + newLenPx, p[1]]);
    } else {
      const ratio = newLenPx / currentLen;
      onChange('points', [p[0], p[1], p[0] + dx * ratio, p[1] + dy * ratio]);
    }
  };

  return (
    <div className="glass sidebar-right animate-slide-right" style={{ position: 'absolute', top: 80, right: 20, zIndex: 100, padding: '20px', width: '300px', maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', borderRadius: 'var(--radius-lg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h4 style={{ margin: 0, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '1px' }}>⚒️ {shape.type} settings</h4>
        <button className="btn btn-ghost" onClick={onDelete} style={{ color: 'var(--color-error)', padding: '4px' }}>🗑</button>
      </div>

      <div className="input-group">
        <label className="input-label">Object Label</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input type="text" className="input" style={{ flex: 1 }} value={local.name || ''} placeholder="e.g. Storage Tank" onChange={(e) => { setLocal(prev => ({ ...prev, name: e.target.value })); onChange('name', e.target.value); }} onBlur={onCommit} />
          <button
            className={`btn ${local.labelPos === 'below' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '8px', fontSize: '10px', height: '40px' }}
            onClick={() => { const next = local.labelPos === 'below' ? 'center' : 'below'; setLocal(prev => ({ ...prev, labelPos: next })); onChange('labelPos', next); onCommit(); }}
            title="Toggle Label Position (Center / Below)"
          >
            {local.labelPos === 'below' ? '⬇️' : '🎯'}
          </button>
        </div>
      </div>

      {shape.type === 'line' && (
        <div className="input-group" style={{ marginBottom: '20px' }}>
          <label className="input-label">Item / Line Type</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            {Object.entries(LINE_TYPES).map(([id, cfg]) => (
              <button
                key={id}
                className={`btn ${local.lineType === id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '10px', padding: '10px 4px', flexDirection: 'column', height: 'auto', gap: '4px' }}
                onClick={() => {
                  const updates = {
                    lineType: id,
                    stroke: cfg.stroke,
                    dash: cfg.dash,
                    strokeWidth: cfg.strokeWidth
                  };
                  setLocal(prev => ({ ...prev, ...updates }));
                  onChangeBatch(updates);
                }}
              >
                <span style={{ fontSize: '16px' }}>{cfg.icon}</span>
                {cfg.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '15px' }}>
        <div className="input-group">
          <label className="input-label">Center X ({unit})</label>
          <input type="number" step="any" className="input" value={local.x} onChange={(e) => handleChange('x', e.target.value)} onBlur={onCommit} />
        </div>
        <div className="input-group">
          <label className="input-label">Center Y ({unit})</label>
          <input type="number" step="any" className="input" value={local.y} onChange={(e) => handleChange('y', e.target.value)} onBlur={onCommit} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <div className="input-group" style={{ flex: 1 }}>
          <label className="input-label">Fill</label>
          <input type="color" className="input" style={{ height: '40px', padding: '2px' }} value={local.fill || '#34d399'} onChange={(e) => { setLocal(prev => ({ ...prev, fill: e.target.value })); onChange('fill', e.target.value); }} onBlur={onCommit} />
        </div>
        <div className="input-group" style={{ flex: 1 }}>
          <label className="input-label">Stroke</label>
          <input type="color" className="input" style={{ height: '40px', padding: '2px' }} value={local.stroke || '#34d399'} onChange={(e) => { setLocal(prev => ({ ...prev, stroke: e.target.value })); onChange('stroke', e.target.value); }} onBlur={onCommit} />
        </div>
      </div>

      {(shape.type === 'rectangle' || shape.type === 'boundary') && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div className="input-group">
            <label className="input-label">Width ({unit})</label>
            <input type="number" step="any" className="input" value={local.width} onChange={(e) => handleChange('width', e.target.value)} onBlur={onCommit} />
          </div>
          <div className="input-group">
            <label className="input-label">Height ({unit})</label>
            <input type="number" step="any" className="input" value={local.height} onChange={(e) => handleChange('height', e.target.value)} onBlur={onCommit} />
          </div>
        </div>
      )}

      {(shape.type === 'circle' || shape.type === 'triangle') && (
        <div className="input-group">
          <label className="input-label">Radius / Size ({unit})</label>
          <input type="number" step="any" className="input" value={local.radius} onChange={(e) => handleChange('radius', e.target.value)} onBlur={onCommit} />
        </div>
      )}

      {shape.type === 'arc' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div className="input-group">
            <label className="input-label">Radius ({unit})</label>
            <input type="number" step="any" className="input" value={local.outerRadius} onChange={(e) => { setLocal(prev => ({...prev, innerRadius: e.target.value})); handleChange('outerRadius', e.target.value); handleChange('innerRadius', e.target.value); }} onBlur={onCommit} />
          </div>
          <div className="input-group">
            <label className="input-label">Angle (°)</label>
            <input type="number" step="any" className="input" value={local.angle} onChange={(e) => { setLocal(prev => ({...prev, angle: e.target.value})); onChange('angle', parseFloat(e.target.value) || 0); }} onBlur={onCommit} />
          </div>
        </div>
      )}

      {shape.type === 'ellipse' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div className="input-group">
            <label className="input-label">Rad X ({unit})</label>
            <input type="number" step="any" className="input" value={local.radiusX} onChange={(e) => handleChange('radiusX', e.target.value)} onBlur={onCommit} />
          </div>
          <div className="input-group">
            <label className="input-label">Rad Y ({unit})</label>
            <input type="number" step="any" className="input" value={local.radiusY} onChange={(e) => handleChange('radiusY', e.target.value)} onBlur={onCommit} />
          </div>
        </div>
      )}

      {(shape.type === 'line' || shape.type === 'curve' || shape.type === 'poly4' || shape.type === 'curved-area') && (
        <div className="card" style={{ padding: '12px', background: 'var(--bg-primary)', marginTop: '10px' }}>
          <label className="input-label" style={{ marginBottom: '10px', display: 'block' }}>Corner / Node Points ({unit})</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(local.points || []).map((p, i) => i % 2 === 0 && (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ fontSize: '10px', width: '25px', opacity: 0.5 }}>P{i / 2 + 1}</span>
                <input type="number" step="any" className="input" style={{ padding: '6px' }} value={local.points[i]} onChange={(e) => handlePointChange(i / 2, 'x', e.target.value)} onBlur={onCommit} />
                <input type="number" step="any" className="input" style={{ padding: '6px' }} value={local.points[i + 1]} onChange={(e) => handlePointChange(i / 2, 'y', e.target.value)} onBlur={onCommit} />
              </div>
            ))}
          </div>
          {(shape.type === 'curve' || shape.type === 'curved-area') && (
            <div className="input-group" style={{ marginTop: '15px' }}>
              <label className="input-label">Curvature Intensity</label>
              <input type="range" min="0" max="2" step="0.1" value={local.tension || 0} onChange={(e) => { setLocal(prev => ({ ...prev, tension: e.target.value })); onChange('tension', parseFloat(e.target.value)); }} onBlur={onCommit} />
            </div>
          )}
        </div>
      )}

      {/* ─── Custom Element Properties ─── */}

      {shape.type === 'tank' && (
        <div className="input-group">
          <label className="input-label">Radius ({unit})</label>
          <input type="number" step="any" className="input" value={local.radius} onChange={(e) => handleChange('radius', e.target.value)} onBlur={onCommit} />
        </div>
      )}

      {shape.type === 'house' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div className="input-group">
            <label className="input-label">Length ({unit})</label>
            <input type="number" step="any" className="input" value={toUnit(shape.houseLength || shape.width || 120)} onChange={(e) => { onChange('houseLength', fromUnit(e.target.value)); }} onBlur={onCommit} />
          </div>
          <div className="input-group">
            <label className="input-label">Width ({unit})</label>
            <input type="number" step="any" className="input" value={toUnit(shape.houseWidth || shape.depth || 100)} onChange={(e) => { onChange('houseWidth', fromUnit(e.target.value)); }} onBlur={onCommit} />
          </div>
          <div className="input-group">
            <label className="input-label">Wall Ht ({unit})</label>
            <input type="number" step="any" className="input" value={toUnit(shape.houseHeight || 80)} onChange={(e) => { onChange('houseHeight', fromUnit(e.target.value)); }} onBlur={onCommit} />
          </div>
          <div className="input-group">
            <label className="input-label">Roof Ht ({unit})</label>
            <input type="number" step="any" className="input" value={toUnit(shape.roofHeight || 40)} onChange={(e) => { onChange('roofHeight', fromUnit(e.target.value)); }} onBlur={onCommit} />
          </div>
        </div>
      )}

      {shape.type === 'tree' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div className="input-group">
            <label className="input-label">Canopy R ({unit})</label>
            <input type="number" step="any" className="input" value={toUnit(shape.canopyRadius || 30)} onChange={(e) => { onChange('canopyRadius', fromUnit(e.target.value)); }} onBlur={onCommit} />
          </div>
          <div className="input-group">
            <label className="input-label">Trunk R ({unit})</label>
            <input type="number" step="any" className="input" value={toUnit(shape.trunkRadius || 5)} onChange={(e) => { onChange('trunkRadius', fromUnit(e.target.value)); }} onBlur={onCommit} />
          </div>
        </div>
      )}

      {shape.type === 'wall' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div className="input-group">
            <label className="input-label">Length ({unit})</label>
            <input type="number" step="any" className="input" value={local.width} onChange={(e) => handleChange('width', e.target.value)} onBlur={onCommit} />
          </div>
          <div className="input-group">
            <label className="input-label">Thickness ({unit})</label>
            <input type="number" step="any" className="input" value={toUnit(shape.thickness || 10)} onChange={(e) => { onChange('thickness', fromUnit(e.target.value)); }} onBlur={onCommit} />
          </div>
        </div>
      )}

      {(shape.type === 'pipe' || shape.type === 'cable') && shape.points && (
        <div className="card" style={{ padding: '12px', background: 'var(--bg-primary)', marginTop: '10px' }}>
          <label className="input-label" style={{ marginBottom: '10px', display: 'block' }}>Endpoints ({unit})</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(local.points || []).map((p, i) => i % 2 === 0 && (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ fontSize: '10px', width: '25px', opacity: 0.5 }}>P{i / 2 + 1}</span>
                <input type="number" step="any" className="input" style={{ padding: '6px' }} value={local.points[i]} onChange={(e) => handlePointChange(i / 2, 'x', e.target.value)} onBlur={onCommit} />
                <input type="number" step="any" className="input" style={{ padding: '6px' }} value={local.points[i + 1]} onChange={(e) => handlePointChange(i / 2, 'y', e.target.value)} onBlur={onCommit} />
              </div>
            ))}
          </div>
          {shape.type === 'pipe' && (
            <div className="input-group" style={{ marginTop: '10px' }}>
              <label className="input-label">Pipe Radius ({unit})</label>
              <input type="number" step="any" className="input" value={toUnit(shape.pipeRadius || 5)} onChange={(e) => { onChange('pipeRadius', fromUnit(e.target.value)); }} onBlur={onCommit} />
            </div>
          )}
          {shape.type === 'cable' && (
            <div className="input-group" style={{ marginTop: '10px' }}>
              <label className="input-label">Cable Radius ({unit})</label>
              <input type="number" step="any" className="input" value={toUnit(shape.cableRadius || 2)} onChange={(e) => { onChange('cableRadius', fromUnit(e.target.value)); }} onBlur={onCommit} />
            </div>
          )}
        </div>
      )}

      {shape.type === 'path' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div className="input-group">
            <label className="input-label">Length ({unit})</label>
            <input type="number" step="any" className="input" value={local.width} onChange={(e) => handleChange('width', e.target.value)} onBlur={onCommit} />
          </div>
          <div className="input-group">
            <label className="input-label">Path Width ({unit})</label>
            <input type="number" step="any" className="input" value={toUnit(shape.pathWidth || 30)} onChange={(e) => { onChange('pathWidth', fromUnit(e.target.value)); }} onBlur={onCommit} />
          </div>
        </div>
      )}

      {shape.type === 'road' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div className="input-group">
            <label className="input-label">Length ({unit})</label>
            <input type="number" step="any" className="input" value={local.width} onChange={(e) => handleChange('width', e.target.value)} onBlur={onCommit} />
          </div>
          <div className="input-group">
            <label className="input-label">Road Width ({unit})</label>
            <input type="number" step="any" className="input" value={toUnit(shape.roadWidth || 60)} onChange={(e) => { onChange('roadWidth', fromUnit(e.target.value)); }} onBlur={onCommit} />
          </div>
        </div>
      )}

      <div className="input-group" style={{ marginTop: '15px' }}>
        <label className="input-label">Rotation Angle (°)</label>
        <input type="number" step="any" className="input" value={Math.round(local.rotation || 0)} onChange={(e) => { setLocal(prev => ({ ...prev, rotation: e.target.value })); onChange('rotation', parseFloat(e.target.value) || 0); }} onBlur={onCommit} />
      </div>
    </div>
  );
};

const KonvaCanvas = ({ shapesToLoad, onShapesChange, onShapeCountChange, canvasRef }) => {
  const [shapes, setShapes] = useState([]);

  // History State for Undo/Redo
  const [history, setHistory] = useState([[]]);
  const [historyStep, setHistoryStep] = useState(0);

  const [activeTool, setActiveTool] = useState('select'); // 'select', 'rectangle', 'circle', 'ellipse', 'triangle', 'line'
  const [unit, setUnit] = useState('px'); // 'px', 'm', 'ft'
  const [pxPerUnit, setPxPerUnit] = useState(50); // Ratio: how many pixels equal 1 current unit (m or ft)
  const [isRatioLocked, setIsRatioLocked] = useState(false);

  const [isDrawing, setIsDrawing] = useState(false);
  const [newShape, setNewShape] = useState(null);
  const [selectedId, selectShape] = useState(null);
  const [selectionZone, setSelectionZone] = useState(null); // { x1, y1, x2, y2 }

  const [showGrid, setShowGrid] = useState(true);
  const [gridOpacity, setGridOpacity] = useState(0.05);
  const [gridSubdivisions, setGridSubdivisions] = useState(1);
  const [majorGridStep, setMajorGridStep] = useState(1); // Major lines every X units
  const [plotSize, setPlotSize] = useState({ width: 0, height: 0 }); // World dimensions
  const [origin, setOrigin] = useState({ x: 100, y: 100 }); // { x, y } in pixels
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 800 });
  const stageRef = useRef(null);
  const trRef = useRef(null);

  const formatUnit = (val) => {
    const num = parseFloat(val);
    if (unit === 'px') return `${Math.round(num)}px`;
    return `${(num / pxPerUnit).toFixed(2)}${unit}`;
  };

  const toRelativeUnit = (px, isAxisX) => {
    const rel = px - (isAxisX ? origin.x : origin.y);
    if (unit === 'px') return Math.round(rel);
    return (rel / pxPerUnit).toFixed(2);
  };

  // Resize handler
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Helper to commit to history
  const commitHistory = (newShapes) => {
    const nextHistory = history.slice(0, historyStep + 1);
    nextHistory.push(newShapes);
    setShapes(newShapes);
    setHistory(nextHistory);
    setHistoryStep(nextHistory.length - 1);
  };

  const handleUndo = () => {
    if (historyStep > 0) {
      setHistoryStep(historyStep - 1);
      setShapes(history[historyStep - 1]);
      selectShape(null);
    }
  };

  const handleRedo = () => {
    if (historyStep < history.length - 1) {
      setHistoryStep(historyStep + 1);
      setShapes(history[historyStep + 1]);
      selectShape(null);
    }
  };

  useEffect(() => {
    if (canvasRef) {
      canvasRef.current = {
        clearDrawings: () => {
          setShapes([]);
          setHistory([[]]);
          setHistoryStep(0);
          selectShape(null);
        }
      };
    }
  }, [canvasRef]);

  useEffect(() => {
    if (shapesToLoad && Array.isArray(shapesToLoad)) {
      setShapes(shapesToLoad);
      setHistory([shapesToLoad]);
    } else {
      setShapes([]);
      setHistory([[]]);
    }
    setHistoryStep(0);
    selectShape(null);
  }, [shapesToLoad]);

  useEffect(() => {
    if (onShapesChange) onShapesChange(shapes);
    if (onShapeCountChange) onShapeCountChange(shapes.length);
  }, [shapes, onShapesChange, onShapeCountChange]);

  useEffect(() => {
    if (selectedId && trRef.current) {
      const node = stageRef.current.findOne('#' + selectedId);
      if (node) {
        trRef.current.nodes([node]);
        trRef.current.getLayer().batchDraw();
      }
    }
  }, [selectedId, shapes]);

  const handleMouseDown = (e) => {
    const clickedOnEmpty = e.target === e.target.getStage() || e.target.id() === 'bg-grid';

    if (activeTool === 'select') {
      if (clickedOnEmpty) selectShape(null);
      return;
    }

    if (clickedOnEmpty && activeTool === 'area-delete') {
      selectShape(null);
      const pos = e.target.getStage().getPointerPosition();
      setSelectionZone({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y });
      return;
    }

    if (clickedOnEmpty && activeTool === 'set-origin') {
      const pos = e.target.getStage().getPointerPosition();
      setOrigin({ x: Math.round(pos.x), y: Math.round(pos.y) });
      setActiveTool('select');
      return;
    }

    if (clickedOnEmpty && activeTool !== 'select') {
      selectShape(null);
      setIsDrawing(true);
      const pos = e.target.getStage().getPointerPosition();

      let initialShape = {
        id: `shape_${Date.now()}`,
        type: activeTool,
        labelPos: 'center',
        ...DRAW_STYLE
      };

      if (activeTool === 'boundary') {
        initialShape = { ...initialShape, x: pos.x, y: pos.y, width: 0, height: 0, fill: 'transparent', stroke: '#f87171', strokeWidth: 3, dash: [10, 5], name: 'BOUNDARY' };
      } else if (activeTool === 'rectangle') {
        initialShape = { ...initialShape, x: pos.x, y: pos.y, width: 0, height: 0, fill: '#34d39966', stroke: '#34d399' };
      } else if (activeTool === 'circle') {
        initialShape = { ...initialShape, x: pos.x, y: pos.y, radius: 0, fill: '#3b82f666', stroke: '#3b82f6' };
      } else if (activeTool === 'triangle') {
        initialShape = { ...initialShape, x: pos.x, y: pos.y, radius: 0, sides: 3, fill: '#f59e0b66', stroke: '#f59e0b' };
      } else if (activeTool === 'arc') {
        initialShape = { ...initialShape, x: pos.x, y: pos.y, innerRadius: 0, outerRadius: 0, angle: 180, stroke: '#3b82f6', strokeWidth: 4, fill: 'rgba(59, 130, 246, 0.3)' };
      } else if (activeTool === 'ellipse') {
        initialShape = { ...initialShape, x: pos.x, y: pos.y, radiusX: 0, radiusY: 0, fill: '#ec489966', stroke: '#ec4899' };
      } else if (activeTool === 'line' || activeTool === 'curve') {
        initialShape = {
          ...initialShape,
          points: [pos.x, pos.y, pos.x, pos.y],
          hitStrokeWidth: 10,
          stroke: '#ffffff',
          lineType: 'general',
          strokeWidth: 4,
          tension: activeTool === 'curve' ? 0.5 : 0,
          dash: []
        };
      } else if (activeTool === 'poly4' || activeTool === 'curved-area') {
        initialShape = {
          ...initialShape,
          points: [pos.x, pos.y, pos.x + 1, pos.y, pos.x + 1, pos.y + 1, pos.x, pos.y + 1],
          fill: activeTool === 'curved-area' ? '#10b98166' : '#8b5cf666',
          stroke: activeTool === 'curved-area' ? '#10b981' : '#8b5cf6',
          strokeWidth: 2,
          tension: activeTool === 'curved-area' ? 0.3 : 0
        };
      }

      setNewShape(initialShape);
    }
  };

  const handleMouseMove = (e) => {
    const pos = e.target.getStage().getPointerPosition();

    if (selectionZone) {
      setSelectionZone(prev => ({ ...prev, x2: pos.x, y2: pos.y }));
      return;
    }

    if (!isDrawing || !newShape) return;

    if (newShape.type === 'rectangle' || newShape.type === 'boundary') {
      setNewShape(prev => ({
        ...prev,
        width: pos.x - prev.x,
        height: pos.y - prev.y
      }));
    } else if (newShape.type === 'circle' || newShape.type === 'triangle') {
      const radius = Math.sqrt(Math.pow(pos.x - newShape.x, 2) + Math.pow(pos.y - newShape.y, 2));
      setNewShape(prev => ({ ...prev, radius }));
    } else if (newShape.type === 'arc') {
      const radius = Math.sqrt(Math.pow(pos.x - newShape.x, 2) + Math.pow(pos.y - newShape.y, 2));
      setNewShape(prev => ({ ...prev, outerRadius: radius, innerRadius: 0 }));
    } else if (newShape.type === 'ellipse') {
      const rx = Math.abs(pos.x - newShape.x);
      const ry = Math.abs(pos.y - newShape.y);
      setNewShape(prev => ({ ...prev, radiusX: rx, radiusY: ry }));
    } else if (newShape.type === 'line' || newShape.type === 'curve') {
      setNewShape(prev => ({ ...prev, points: [prev.points[0], prev.points[1], pos.x, pos.y] }));
    } else if (newShape.type === 'poly4' || newShape.type === 'curved-area') {
      // Draw as a box during drag for simplicity, then convert to 4 points
      const x1 = newShape.points[0];
      const y1 = newShape.points[1];
      setNewShape(prev => ({
        ...prev,
        points: [x1, y1, pos.x, y1, pos.x, pos.y, x1, pos.y]
      }));
    }
  };

  const handleMouseUp = () => {
    if (selectionZone) {
      // Area Deletion Logic
      const xMin = Math.min(selectionZone.x1, selectionZone.x2);
      const xMax = Math.max(selectionZone.x1, selectionZone.x2);
      const yMin = Math.min(selectionZone.y1, selectionZone.y2);
      const yMax = Math.max(selectionZone.y1, selectionZone.y2);

      const filtered = shapes.filter(s => {
        let isInside = false;
        const x = s.x || (s.points && s.points[0]) || 0;
        const y = s.y || (s.points && s.points[1]) || 0;

        if (s.type === 'rectangle' || s.type === 'boundary') {
          const cx = x + (s.width || 0) / 2;
          const cy = y + (s.height || 0) / 2;
          isInside = cx >= xMin && cx <= xMax && cy >= yMin && cy <= yMax;
        } else if (s.type === 'line' || s.type === 'curve' || s.type === 'poly4' || s.type === 'curved-area') {
          // Check if start or end point is in zone
          const p1x = (s.points[0] || 0) + (s.x || 0);
          const p1y = (s.points[1] || 0) + (s.y || 0);
          const p2x = (s.points[2] || 0) + (s.x || 0);
          const p2y = (s.points[3] || 0) + (s.y || 0);
          isInside = (p1x >= xMin && p1x <= xMax && p1y >= yMin && p1y <= yMax) ||
            (p2x >= xMin && p2x <= xMax && p2y >= yMin && p2y <= yMax);
        } else {
          isInside = x >= xMin && x <= xMax && y >= yMin && y <= yMax;
        }
        return !isInside;
      });

      if (filtered.length !== shapes.length) {
        commitHistory(filtered);
      }
      setSelectionZone(null);
      return;
    }

    if (isDrawing && newShape) {
      let isValid = false;
      const normalizedShape = { ...newShape };

      // Make lines exact integers for bounding box checks
      if ((newShape.type === 'rectangle' || newShape.type === 'boundary') && Math.abs(newShape.width) > 5 && Math.abs(newShape.height) > 5) {
        if (normalizedShape.width < 0) {
          normalizedShape.x += normalizedShape.width;
          normalizedShape.width = Math.abs(normalizedShape.width);
        }
        if (normalizedShape.height < 0) {
          normalizedShape.y += normalizedShape.height;
          normalizedShape.height = Math.abs(normalizedShape.height);
        }
        normalizedShape.x = Math.round(normalizedShape.x);
        normalizedShape.y = Math.round(normalizedShape.y);
        normalizedShape.width = Math.round(normalizedShape.width);
        normalizedShape.height = Math.round(normalizedShape.height);
        isValid = true;
      } else if ((newShape.type === 'circle' || newShape.type === 'triangle') && newShape.radius > 5) {
        normalizedShape.x = Math.round(normalizedShape.x);
        normalizedShape.y = Math.round(normalizedShape.y);
        normalizedShape.radius = Math.round(normalizedShape.radius);
        isValid = true;
      } else if (newShape.type === 'arc' && newShape.outerRadius > 5) {
        normalizedShape.x = Math.round(normalizedShape.x);
        normalizedShape.y = Math.round(normalizedShape.y);
        normalizedShape.outerRadius = Math.round(normalizedShape.outerRadius);
        normalizedShape.innerRadius = 0;
        isValid = true;
      } else if (newShape.type === 'ellipse' && newShape.radiusX > 5 && newShape.radiusY > 5) {
        normalizedShape.x = Math.round(normalizedShape.x);
        normalizedShape.y = Math.round(normalizedShape.y);
        normalizedShape.radiusX = Math.round(normalizedShape.radiusX);
        normalizedShape.radiusY = Math.round(normalizedShape.radiusY);
        isValid = true;
      } else if (newShape.type === 'line' || newShape.type === 'curve') {
        const dx = newShape.points[2] - newShape.points[0];
        const dy = newShape.points[3] - newShape.points[1];
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
          normalizedShape.points = normalizedShape.points.map(p => Math.round(p));
          isValid = true;
        }
      } else if (newShape.type === 'poly4' || newShape.type === 'curved-area') {
        normalizedShape.points = normalizedShape.points.map(p => Math.round(p));
        isValid = true;
      }

      if (isValid) {
        // Use commitHistory so we can undo shape creation
        commitHistory([...shapes, normalizedShape]);
        selectShape(normalizedShape.id);
        setActiveTool('select');
      }
      setIsDrawing(false);
      setNewShape(null);
    }
  };

  const handleDragEnd = (e) => {
    const id = e.target.id();
    const newShapes = shapes.map(s => {
      if (s.id === id) {
        return { ...s, x: Math.round(e.target.x()), y: Math.round(e.target.y()) };
      }
      return s;
    });
    commitHistory(newShapes);
  };

  const handleTransformEnd = (e) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);

    const newShapes = shapes.map(s => {
      if (s.id === node.id()) {
        if (s.type === 'rectangle' || s.type === 'boundary') {
          return {
            ...s,
            x: Math.round(node.x()),
            y: Math.round(node.y()),
            width: Math.round(Math.max(5, node.width() * scaleX)),
            height: Math.round(Math.max(5, node.height() * scaleY)),
            rotation: node.rotation()
          };
        } else if (s.type === 'circle' || s.type === 'triangle') {
          return {
            ...s,
            x: Math.round(node.x()),
            y: Math.round(node.y()),
            radius: Math.round(Math.max(5, s.radius * ((scaleX + scaleY) / 2))),
            rotation: node.rotation()
          };
        } else if (s.type === 'arc') {
          return {
            ...s,
            x: Math.round(node.x()),
            y: Math.round(node.y()),
            outerRadius: Math.round(Math.max(5, s.outerRadius * ((scaleX + scaleY) / 2))),
            innerRadius: Math.round(Math.max(5, s.innerRadius * ((scaleX + scaleY) / 2))),
            rotation: node.rotation()
          };
        } else if (s.type === 'ellipse') {
          return {
            ...s,
            x: Math.round(node.x()),
            y: Math.round(node.y()),
            radiusX: Math.round(Math.max(5, node.radiusX() * scaleX)),
            radiusY: Math.round(Math.max(5, node.radiusY() * scaleY)),
            rotation: node.rotation()
          };
        } else if (s.type === 'line' || s.type === 'curve' || s.type === 'poly4' || s.type === 'curved-area') {
          return {
            ...s,
            x: Math.round(node.x()),
            y: Math.round(node.y()),
            points: s.points.map((p, i) => Math.round(i % 2 === 0 ? p * scaleX : p * scaleY)),
            rotation: node.rotation()
          };
        }
      }
      return s;
    });
    commitHistory(newShapes);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't delete shape if we are typing inside an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        const remaining = shapes.filter(s => s.id !== selectedId);
        commitHistory(remaining);
        selectShape(null);
      }

      // Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, shapes, history, historyStep]);

  const selectedShapeData = shapes.find(s => s.id === selectedId);

  // Called wildly on every stroke by the generic canvas updates
  const updateSelectedShapeLive = (key, val) => {
    setShapes(prev => prev.map(s => {
      if (s.id === selectedId) {
        return { ...s, [key]: val };
      }
      return s;
    }));
  };

  const updateSelectedShapeBatch = (updates) => {
    setShapes(prev => prev.map(s => {
      if (s.id === selectedId) {
        return { ...s, ...updates };
      }
      return s;
    }));
  };

  // Called ONLY when blur (unfocusing text box) or explicit commit
  const commitSelectedShapeProperties = (updatedShapes) => {
    commitHistory(updatedShapes || shapes);
  };

  const handleDeleteSelected = () => {
    commitHistory(shapes.filter(s => s.id !== selectedId));
    selectShape(null);
  };

  return (
    <div ref={containerRef} style={{ flex: 1, position: 'relative', width: '100%', height: '100%', background: '#111827', overflow: 'hidden' }} id="map-canvas">

      {/* ACTION TOOLBAR: TOP CENTER (Row 1) */}
      <div style={{ 
        position: 'absolute', 
        top: isMobile ? 5 : 15, 
        left: '50%', 
        transform: 'translateX(-50%)', 
        zIndex: 10, 
        display: 'flex', 
        flexDirection: 'column', 
        gap: isMobile ? '5px' : '10px', 
        alignItems: 'center',
        width: isMobile ? '95%' : 'auto'
      }}>
        <div className="glass" style={{ display: 'flex', padding: '4px', gap: '4px', borderRadius: '12px', width: isMobile ? '100%' : 'auto', justifyContent: 'center' }}>
          <button className={`btn ${activeTool === 'select' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: isMobile ? '14px' : '18px', padding: isMobile ? '8px' : '10px 15px' }} onClick={() => setActiveTool('select')} title="Selection Mode">{isMobile ? '👆' : '👆 Select'}</button>
          <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '4px 2px' }} />
          <button className="btn btn-secondary" style={{ fontSize: isMobile ? '14px' : '18px', padding: isMobile ? '8px' : '10px' }} onClick={handleUndo} disabled={historyStep === 0} title="Undo">↩️</button>
          <button className="btn btn-secondary" style={{ fontSize: isMobile ? '14px' : '18px', padding: isMobile ? '8px' : '10px' }} onClick={handleRedo} disabled={historyStep === history.length - 1} title="Redo">↪️</button>
          <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '4px 2px' }} />
          <button className={`btn ${activeTool === 'set-origin' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: isMobile ? '14px' : '18px', padding: isMobile ? '8px' : '10px' }} onClick={() => { setActiveTool('set-origin'); selectShape(null); }} title="Set (0,0) Origin">🎯</button>
          <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '4px 2px' }} />
          <button className={`btn ${activeTool === 'area-delete' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: isMobile ? '14px' : '18px', padding: isMobile ? '8px' : '10px', color: activeTool === 'area-delete' ? '#fff' : '#ef4444' }} onClick={() => { setActiveTool('area-delete'); selectShape(null); }} title="Clear Area">🧹</button>
        </div>

        {/* GRAPH & VIEW TOOLBAR: TOP CENTER (Row 2) */}
        {(!isMobile || (isMobile && showGrid)) && (
          <div className="glass" style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: isMobile ? '6px' : '12px', 
            padding: isMobile ? '4px 8px' : '6px 15px', 
            borderRadius: '10px', 
            scale: isMobile ? '0.9' : '1'
          }}>
            <button className={`btn ${showGrid ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '14px', padding: '4px 8px', height: '28px' }} onClick={() => setShowGrid(!showGrid)} title="Toggle Grid">{isMobile ? '#️⃣' : '#️⃣ Graph'}</button>
            
            {showGrid && (
              <>
                <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', height: '16px' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ fontSize: '8px', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)' }}>OP</span>
                  <input type="range" min="0.02" max="0.4" step="0.02" value={gridOpacity} onChange={(e) => setGridOpacity(parseFloat(e.target.value))} style={{ width: '30px' }} />
                </div>
                {!isMobile && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <span style={{ fontSize: '9px', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)', marginRight: '2px' }}>SUBDIV</span>
                    {[1, 2, 5, 10].map(d => (
                      <button key={d} className={`btn ${gridSubdivisions === d ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0 5px', fontSize: '10px', height: '22px', minWidth: '22px' }} onClick={() => setGridSubdivisions(d)}>{d}</button>
                    ))}
                  </div>
                )}
                <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', height: '16px' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ fontSize: '8px', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)' }}>PLOT</span>
                  <input type="number" placeholder="W" value={plotSize.width || ''} onChange={(e) => setPlotSize(p => ({ ...p, width: parseFloat(e.target.value) || 0 }))} style={{ width: '28px', background: 'transparent', border: 'none', borderBottom: '1px solid #f87171', color: 'white', fontSize: '10px', textAlign: 'center' }} />
                  <input type="number" placeholder="H" value={plotSize.height || ''} onChange={(e) => setPlotSize(p => ({ ...p, height: parseFloat(e.target.value) || 0 }))} style={{ width: '28px', background: 'transparent', border: 'none', borderBottom: '1px solid #f87171', color: 'white', fontSize: '10px', textAlign: 'center' }} />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* SHAPE TOOLBOX: LEFT SIDE (Single Column) or BOTTOM (Mobile) */}
      <div style={{ 
        position: 'absolute', 
        top: isMobile ? 'auto' : '50%', 
        bottom: isMobile ? 80 : 'auto',
        left: isMobile ? '50%' : 15, 
        transform: isMobile ? 'translateX(-50%)' : 'translateY(-50%)', 
        zIndex: 10, 
        display: 'flex', 
        flexDirection: isMobile ? 'row' : 'column', 
        gap: '6px',
        maxWidth: isMobile ? '95%' : 'auto',
        overflowX: isMobile ? 'auto' : 'visible'
      }}>
        
        <div className="glass" style={{ 
          display: 'flex', 
          flexDirection: isMobile ? 'row' : 'column', 
          padding: '4px', 
          gap: '4px', 
          borderRadius: '12px', 
          alignItems: 'center',
          maxHeight: isMobile ? '50px' : 'auto'
        }}>
          {!isMobile && <div style={{ fontSize: '9px', color: '#9ca3af', textAlign: 'center', fontWeight: 'bold' }}>DRAW</div>}
          <button className={`btn ${activeTool === 'boundary' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '8px', fontSize: '18px' }} onClick={() => setActiveTool('boundary')} title="Boundary">🔲</button>
          <button className={`btn ${activeTool === 'rectangle' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '8px', fontSize: '18px' }} onClick={() => setActiveTool('rectangle')} title="Box">⬛</button>
          <button className={`btn ${activeTool === 'circle' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '8px', fontSize: '18px' }} onClick={() => setActiveTool('circle')} title="Circle">⚫</button>
          <button className={`btn ${activeTool === 'ellipse' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '8px', fontSize: '18px' }} onClick={() => setActiveTool('ellipse')} title="Ellipse">🕳️</button>
          <button className={`btn ${activeTool === 'triangle' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '8px', fontSize: '18px' }} onClick={() => setActiveTool('triangle')} title="Triangle">🔺</button>
          <button className={`btn ${activeTool === 'poly4' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '8px', fontSize: '18px' }} onClick={() => setActiveTool('poly4')} title="4-Side Poly">⬈</button>
          <button className={`btn ${activeTool === 'curved-area' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '8px', fontSize: '18px' }} onClick={() => setActiveTool('curved-area')} title="Curved Space Area">☁️</button>
          <div style={{ width: isMobile ? '1px' : '20px', height: isMobile ? '20px' : '1px', background: 'rgba(255,255,255,0.1)' }} />
          <button className={`btn ${activeTool === 'line' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '8px', fontSize: '18px' }} onClick={() => setActiveTool('line')} title="Line">➖</button>
          <button className={`btn ${activeTool === 'curve' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '8px', fontSize: '18px' }} onClick={() => setActiveTool('curve')} title="Curve Path">⤴️</button>
          <button className={`btn ${activeTool === 'arc' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '8px', fontSize: '18px' }} onClick={() => setActiveTool('arc')} title="Small Curve Arc">⌒</button>
        </div>
      </div>

      {/* FOOTER: BOTTOM RIGHT (Scale & Units) */}
      <div style={{ 
        position: 'absolute', 
        bottom: isMobile ? 140 : 15, 
        right: isMobile ? 15 : 340, 
        zIndex: 10, 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'flex-end', 
        gap: '8px',
        scale: isMobile ? '0.85' : '1',
        transformOrigin: 'bottom right'
      }}>


        {/* SCALE & CONVERSION */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <div className="glass" style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden' }}>
            <button className={`btn ${unit === 'px' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '6px 10px', fontSize: '11px' }} onClick={() => setUnit('px')}>PX</button>
            <button className={`btn ${unit === 'm' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '6px 10px', fontSize: '11px' }} onClick={() => { setUnit('m'); if (!isRatioLocked && pxPerUnit === 15) setPxPerUnit(50); }}>M</button>
            <button className={`btn ${unit === 'ft' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '6px 10px', fontSize: '11px' }} onClick={() => { setUnit('ft'); if (!isRatioLocked && pxPerUnit === 50) setPxPerUnit(15); }}>FT</button>
          </div>

          {unit !== 'px' && (
            <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0 8px', borderRadius: '8px', height: '31px' }}>
              <span style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--accent-primary)' }}>1{unit}=</span>
              <input
                type="number" value={pxPerUnit} disabled={isRatioLocked}
                onChange={(e) => setPxPerUnit(parseInt(e.target.value) || 1)}
                style={{ width: '30px', background: 'none', color: isRatioLocked ? '#6b7280' : 'white', border: 'none', borderBottom: isRatioLocked ? '1px solid #4b5563' : '1px solid #34d399', fontSize: '11px', textAlign: 'center' }}
              />
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>px</span>
              <button className="btn btn-ghost" style={{ padding: '0 2px' }} onClick={() => setIsRatioLocked(!isRatioLocked)}>
                {isRatioLocked ? '🔒' : '🔓'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* SIDEBAR PROPERTIES */}
      {selectedId && selectedShapeData && (
        <PropertiesPanel
          shape={selectedShapeData}
          onChange={updateSelectedShapeLive}
          onChangeBatch={(updates) => {
            updateSelectedShapeBatch(updates);
            setShapes(prev => { commitSelectedShapeProperties(prev); return prev; });
          }}
          onCommit={() => commitSelectedShapeProperties()}
          onDelete={handleDeleteSelected}
          unit={unit}
          pxPerUnit={pxPerUnit}
          origin={origin}
        />
      )}

      <Stage
        width={dimensions.width}
        height={dimensions.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
        ref={stageRef}
        style={{ cursor: activeTool === 'select' ? (selectedId ? 'move' : 'default') : 'crosshair' }}
      >
        <Layer>
          <Rect id="bg-grid" x={0} y={0} width={4000} height={4000} fill="#111827" />
          {showGrid && (() => {
            const majorStepPx = (unit === 'px' ? 50 : pxPerUnit * majorGridStep);
            const minorStepPx = majorStepPx / gridSubdivisions;
            const majorColor = `rgba(255,255,255,${gridOpacity * 2.5})`;
            const minorColor = `rgba(255,255,255,${gridOpacity})`;

            const vLines = [];
            const hLines = [];

            const startX = origin.x - Math.ceil(origin.x / minorStepPx) * minorStepPx;
            for (let x = startX; x < 4000; x += minorStepPx) {
              const distanceToOrigin = Math.abs(x - origin.x);
              const isMajor = (distanceToOrigin % majorStepPx) < 0.1 || (majorStepPx - (distanceToOrigin % majorStepPx)) < 0.1;
              vLines.push({ x, isMajor });
            }

            const startY = origin.y - Math.ceil(origin.y / minorStepPx) * minorStepPx;
            for (let y = startY; y < 4000; y += minorStepPx) {
              const distanceToOrigin = Math.abs(y - origin.y);
              const isMajor = (distanceToOrigin % majorStepPx) < 0.1 || (majorStepPx - (distanceToOrigin % majorStepPx)) < 0.1;
              hLines.push({ y, isMajor });
            }

            return (
              <Group>
                {vLines.map((l, i) => (
                  <Line key={`v-${i}`} points={[l.x, 0, l.x, 4000]} stroke={l.isMajor ? majorColor : minorColor} strokeWidth={l.isMajor ? 1 : 0.5} listening={false} />
                ))}
                {hLines.map((l, i) => (
                  <Line key={`h-${i}`} points={[0, l.y, 4000, l.y]} stroke={l.isMajor ? majorColor : minorColor} strokeWidth={l.isMajor ? 1 : 0.5} listening={false} />
                ))}
              </Group>
            );
          })()}
          {/* Origin Marker */}
          <Group x={origin.x} y={origin.y}>
            <Line points={[-20, 0, 20, 0]} stroke="#34d399" strokeWidth={1} />
            <Line points={[0, -20, 0, 20]} stroke="#34d399" strokeWidth={1} />
            <Circle radius={3} fill="#34d399" />
            <Text text="(0,0)" x={5} y={5} fill="#34d399" fontSize={10} fontStyle="bold" />
          </Group>

          {/* Global Plot Boundary based on dimensions given */}
          {plotSize.width > 0 && plotSize.height > 0 && (
            <Rect
              x={origin.x}
              y={origin.y}
              width={plotSize.width * (unit === 'px' ? 1 : pxPerUnit)}
              height={plotSize.height * (unit === 'px' ? 1 : pxPerUnit)}
              stroke="#f87171"
              strokeWidth={2}
              dash={[10, 5]}
              listening={false}
            />
          )}
        </Layer>

        <Layer>
          {shapes.map((shape) => {
            const isSelected = selectedId === shape.id;
            const strokeColor = isSelected ? "#10b981" : shape.stroke;
            const strokeW = isSelected ? 3 : shape.strokeWidth;

            if (shape.type === 'rectangle') {
              const rectWidth = Math.round(shape.width);
              const rectHeight = Math.round(shape.height);
              return (
                <Group key={shape.id}>
                  <Rect
                    id={shape.id}
                    x={shape.x} y={shape.y} width={shape.width} height={shape.height}
                    fill={shape.fill} stroke={strokeColor} strokeWidth={strokeW}
                    draggable={activeTool === 'select'} rotation={shape.rotation || 0}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  {/* Label Text Centered or Below */}
                  {shape.name && (
                    <Text
                      x={shape.x}
                      y={shape.labelPos === 'below' ? shape.y + shape.height + 8 : shape.y}
                      width={shape.width}
                      height={shape.labelPos === 'below' ? 20 : shape.height}
                      text={shape.name}
                      fill="#fff"
                      fontSize={14}
                      fontStyle="bold"
                      align="center"
                      verticalAlign={shape.labelPos === 'below' ? 'top' : 'middle'}
                      listening={false}
                      shadowColor="black"
                      shadowBlur={2}
                    />
                  )}
                  {/* Dimension Labels with improved visibility */}
                  <DimensionLabel x={shape.x + shape.width / 2} y={shape.y - 20} text={`W: ${formatUnit(rectWidth)}`} />
                  <DimensionLabel x={shape.x + shape.width + 35} y={shape.y + shape.height / 2} text={`H: ${formatUnit(rectHeight)}`} />
                </Group>
              );
            } else if (shape.type === 'boundary') {
              const rectWidth = Math.round(shape.width);
              const rectHeight = Math.round(shape.height);
              return (
                <Group key={shape.id}>
                  <Rect
                    id={shape.id}
                    x={shape.x} y={shape.y} width={shape.width} height={shape.height}
                    fill={shape.fill} stroke={strokeColor} strokeWidth={shape.strokeWidth}
                    dash={shape.dash}
                    draggable={activeTool === 'select'} rotation={shape.rotation || 0}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  {shape.name && (
                    <Text
                      x={shape.x}
                      y={shape.labelPos === 'below' ? shape.y + shape.height + 8 : shape.y}
                      width={shape.width}
                      height={shape.labelPos === 'below' ? 20 : shape.height}
                      text={shape.name}
                      fill="#f87171"
                      fontSize={16}
                      fontStyle="bold"
                      align="center"
                      verticalAlign={shape.labelPos === 'below' ? 'top' : 'middle'}
                      listening={false}
                      shadowColor="black"
                      shadowBlur={2}
                    />
                  )}
                  <DimensionLabel x={shape.x + shape.width / 2} y={shape.y - 20} text={`Bound W: ${formatUnit(rectWidth)}`} />
                  <DimensionLabel x={shape.x + shape.width + 50} y={shape.y + shape.height / 2} text={`Bound H: ${formatUnit(rectHeight)}`} />
                </Group>
              );
            } else if (shape.type === 'circle') {
              const radius = Math.round(shape.radius);
              return (
                <Group key={shape.id}>
                  <Circle
                    id={shape.id}
                    x={shape.x} y={shape.y} radius={shape.radius}
                    fill={shape.fill} stroke={strokeColor} strokeWidth={strokeW}
                    draggable={activeTool === 'select'} rotation={shape.rotation || 0}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  {shape.name && (
                    <Text
                      x={shape.x - shape.radius}
                      y={shape.labelPos === 'below' ? shape.y + shape.radius + 8 : shape.y - shape.radius}
                      width={shape.radius * 2}
                      height={shape.labelPos === 'below' ? 20 : shape.radius * 2}
                      text={shape.name} fill="#fff" fontSize={14} fontStyle="bold"
                      align="center" verticalAlign={shape.labelPos === 'below' ? 'top' : 'middle'} listening={false}
                      shadowColor="black" shadowBlur={2}
                    />
                  )}
                  <DimensionLabel x={shape.x} y={shape.y - shape.radius - 20} text={`Dia: ${formatUnit(radius * 2)}`} />
                </Group>
              );
            } else if (shape.type === 'triangle') {
              const size = Math.round(shape.radius);
              return (
                <Group key={shape.id}>
                  <RegularPolygon
                    id={shape.id}
                    x={shape.x} y={shape.y} sides={3} radius={shape.radius}
                    fill={shape.fill} stroke={strokeColor} strokeWidth={strokeW}
                    draggable={activeTool === 'select'} rotation={shape.rotation || 0}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  {shape.name && (
                    <Text
                      x={shape.x - shape.radius} y={shape.y - shape.radius} width={shape.radius * 2} height={shape.radius * 2}
                      text={shape.name} fill="#fff" fontSize={14} fontStyle="bold"
                      align="center" verticalAlign="middle" listening={false}
                      shadowColor="black" shadowBlur={2}
                    />
                  )}
                  <DimensionLabel x={shape.x} y={shape.y - shape.radius - 20} text={`S: ${formatUnit(size)}`} />
                </Group>
              );
            } else if (shape.type === 'arc') {
              const radius = Math.round(shape.outerRadius);
              return (
                <Group key={shape.id}>
                  <Arc
                    id={shape.id}
                    x={shape.x} y={shape.y} innerRadius={shape.innerRadius} outerRadius={shape.outerRadius} angle={shape.angle}
                    fill={shape.fill} stroke={strokeColor} strokeWidth={strokeW}
                    draggable={activeTool === 'select'} rotation={shape.rotation || 0}
                    hitStrokeWidth={20}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  {shape.name && (
                    <Text
                      x={shape.x - shape.outerRadius}
                      y={shape.labelPos === 'below' ? shape.y + shape.outerRadius + 8 : shape.y - shape.outerRadius}
                      width={shape.outerRadius * 2}
                      height={shape.labelPos === 'below' ? 20 : shape.outerRadius * 2}
                      text={shape.name} fill="#fff" fontSize={14} fontStyle="bold"
                      align="center" verticalAlign={shape.labelPos === 'below' ? 'top' : 'middle'} listening={false}
                      shadowColor="black" shadowBlur={2}
                    />
                  )}
                  <DimensionLabel x={shape.x} y={shape.y - shape.outerRadius - 20} text={`R: ${formatUnit(radius)} A: ${Math.round(shape.angle)}°`} />
                </Group>
              );
            } else if (shape.type === 'ellipse') {
              const rx = Math.round(shape.radiusX);
              const ry = Math.round(shape.radiusY);
              return (
                <Group key={shape.id}>
                  <Ellipse
                    id={shape.id}
                    x={shape.x} y={shape.y} radiusX={shape.radiusX} radiusY={shape.radiusY}
                    fill={shape.fill} stroke={strokeColor} strokeWidth={strokeW}
                    draggable={activeTool === 'select'} rotation={shape.rotation || 0}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  {shape.name && (
                    <Text
                      x={shape.x - shape.radiusX} y={shape.y - shape.radiusY} width={shape.radiusX * 2} height={shape.radiusY * 2}
                      text={shape.name} fill="#fff" fontSize={14} fontStyle="bold"
                      align="center" verticalAlign="middle" listening={false}
                      shadowColor="black" shadowBlur={2}
                    />
                  )}
                  <DimensionLabel x={shape.x} y={shape.y - shape.radiusY - 20} text={`W: ${formatUnit(rx * 2)} H: ${formatUnit(ry * 2)}`} />
                </Group>
              );
            } else if (shape.type === 'line' || shape.type === 'curve') {
              const dx = shape.points[2] - shape.points[0];
              const dy = shape.points[3] - shape.points[1];
              const length = Math.round(Math.sqrt(dx * dx + dy * dy));
              return (
                <Group key={shape.id}>
                  <Line
                    id={shape.id}
                    x={shape.x || 0} y={shape.y || 0} points={shape.points}
                    stroke={isSelected ? '#3b82f6' : (shape.stroke || '#fff')}
                    strokeWidth={isSelected ? 4 : (shape.strokeWidth || 4)}
                    dash={shape.dash || []}
                    tension={shape.tension || 0}
                    hitStrokeWidth={20}
                    draggable={activeTool === 'select'} rotation={shape.rotation || 0}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  <DimensionLabel
                    x={(shape.points[0] + shape.points[2]) / 2 + (shape.x || 0)}
                    y={(shape.points[1] + shape.points[3]) / 2 + (shape.y || 0) - 20}
                    text={`L: ${formatUnit(length)}`}
                  />
                </Group>
              );
            } else if (shape.type === 'poly4' || shape.type === 'curved-area') {
              return (
                <Group key={shape.id}>
                  <Line
                    id={shape.id}
                    x={shape.x || 0} y={shape.y || 0} points={shape.points}
                    fill={shape.fill} stroke={isSelected ? '#3b82f6' : shape.stroke}
                    strokeWidth={isSelected ? 4 : shape.strokeWidth}
                    tension={shape.tension || 0}
                    closed={true}
                    draggable={activeTool === 'select'} rotation={shape.rotation || 0}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                </Group>
              );

            // ════════════════════════════════════════════════════
            //  CUSTOM REAL-WORLD ELEMENTS — 2D Top-Down Views
            // ════════════════════════════════════════════════════

            } else if (shape.type === 'tank') {
              // Tank — top-down view: circle with cross-hatch
              const r = shape.radius || 40;
              return (
                <Group key={shape.id}>
                  <Circle
                    id={shape.id}
                    x={shape.x} y={shape.y} radius={r}
                    fill="rgba(100, 116, 139, 0.25)" stroke={isSelected ? '#10b981' : '#64748b'} strokeWidth={isSelected ? 3 : 2}
                    draggable={activeTool === 'select'}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  {/* Cross-hatch lines to indicate tank */}
                  <Line points={[shape.x - r * 0.6, shape.y, shape.x + r * 0.6, shape.y]} stroke="#94a3b8" strokeWidth={1} listening={false} />
                  <Line points={[shape.x, shape.y - r * 0.6, shape.x, shape.y + r * 0.6]} stroke="#94a3b8" strokeWidth={1} listening={false} />
                  {/* Inner circle (dome outline) */}
                  <Circle x={shape.x} y={shape.y} radius={r * 0.35} stroke="#94a3b8" strokeWidth={1} listening={false} />
                  {shape.name && (
                    <Text x={shape.x - r} y={shape.y - 8} width={r * 2} height={20}
                      text={shape.name} fill="#fff" fontSize={12} fontStyle="bold"
                      align="center" verticalAlign="middle" listening={false} shadowColor="black" shadowBlur={2} />
                  )}
                  <DimensionLabel x={shape.x} y={shape.y - r - 20} text={`Tank Dia: ${formatUnit(r * 2)}`} />
                </Group>
              );

            } else if (shape.type === 'house') {
              // House — top-down view: rectangle with roof ridge line
              const len = shape.houseLength || shape.width || 120;
              const wid = shape.houseWidth || shape.depth || 100;
              return (
                <Group key={shape.id}>
                  <Rect
                    id={shape.id}
                    x={shape.x} y={shape.y} width={len} height={wid}
                    fill="rgba(226, 232, 240, 0.2)" stroke={isSelected ? '#10b981' : '#e2e8f0'} strokeWidth={isSelected ? 3 : 2}
                    draggable={activeTool === 'select'}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  {/* Roof ridge line (center horizontal) */}
                  <Line points={[shape.x, shape.y + wid / 2, shape.x + len, shape.y + wid / 2]}
                    stroke="#dc2626" strokeWidth={2} dash={[6, 3]} listening={false} />
                  {/* Diagonal roof lines from corners to ridge */}
                  <Line points={[shape.x, shape.y, shape.x + len / 2, shape.y + wid / 2]}
                    stroke="#dc2626" strokeWidth={1} listening={false} />
                  <Line points={[shape.x + len, shape.y, shape.x + len / 2, shape.y + wid / 2]}
                    stroke="#dc2626" strokeWidth={1} listening={false} />
                  <Line points={[shape.x, shape.y + wid, shape.x + len / 2, shape.y + wid / 2]}
                    stroke="#dc2626" strokeWidth={1} listening={false} />
                  <Line points={[shape.x + len, shape.y + wid, shape.x + len / 2, shape.y + wid / 2]}
                    stroke="#dc2626" strokeWidth={1} listening={false} />
                  {/* Door indicator */}
                  <Rect x={shape.x + len * 0.4} y={shape.y + wid - 4} width={len * 0.2} height={4}
                    fill="#78350f" listening={false} />
                  {shape.name && (
                    <Text x={shape.x} y={shape.y + wid / 2 - 8} width={len} height={20}
                      text={shape.name} fill="#fff" fontSize={13} fontStyle="bold"
                      align="center" verticalAlign="middle" listening={false} shadowColor="black" shadowBlur={2} />
                  )}
                  <DimensionLabel x={shape.x + len / 2} y={shape.y - 20} text={`${formatUnit(len)} × ${formatUnit(wid)}`} />
                </Group>
              );

            } else if (shape.type === 'tree') {
              // Tree — top-down view: filled circle (canopy) with small center dot (trunk)
              const canopyR = shape.canopyRadius || 30;
              const trunkR = shape.trunkRadius || 5;
              return (
                <Group key={shape.id}>
                  <Circle
                    id={shape.id}
                    x={shape.x} y={shape.y} radius={canopyR}
                    fill="rgba(22, 163, 74, 0.3)" stroke={isSelected ? '#10b981' : '#16a34a'} strokeWidth={isSelected ? 3 : 2}
                    draggable={activeTool === 'select'}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  {/* Inner canopy rings */}
                  <Circle x={shape.x} y={shape.y} radius={canopyR * 0.65} stroke="#22c55e" strokeWidth={1} listening={false} />
                  {/* Trunk center dot */}
                  <Circle x={shape.x} y={shape.y} radius={trunkR} fill="#92400e" stroke="#78350f" strokeWidth={1} listening={false} />
                  {shape.name && (
                    <Text x={shape.x - canopyR} y={shape.y - 8} width={canopyR * 2} height={20}
                      text={shape.name} fill="#fff" fontSize={12} fontStyle="bold"
                      align="center" verticalAlign="middle" listening={false} shadowColor="black" shadowBlur={2} />
                  )}
                  <DimensionLabel x={shape.x} y={shape.y - canopyR - 20} text={`Tree R: ${formatUnit(canopyR)}`} />
                </Group>
              );

            } else if (shape.type === 'wall') {
              // Wall — top-down view: narrow filled rectangle with brick pattern
              const w = shape.width || 200;
              const t = shape.thickness || 10;
              return (
                <Group key={shape.id}>
                  <Rect
                    id={shape.id}
                    x={shape.x} y={shape.y} width={w} height={t}
                    fill="rgba(120, 113, 108, 0.5)" stroke={isSelected ? '#10b981' : '#a8a29e'} strokeWidth={isSelected ? 3 : 2}
                    draggable={activeTool === 'select'} rotation={shape.rotation || 0}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  {/* Brick pattern lines */}
                  <Line points={[shape.x, shape.y + t / 2, shape.x + w, shape.y + t / 2]}
                    stroke="#78716c" strokeWidth={0.5} listening={false} />
                  {shape.name && (
                    <Text x={shape.x} y={shape.y + t + 6} width={w} height={18}
                      text={shape.name} fill="#d6d3d1" fontSize={11} fontStyle="bold"
                      align="center" listening={false} shadowColor="black" shadowBlur={2} />
                  )}
                  <DimensionLabel x={shape.x + w / 2} y={shape.y - 20} text={`Wall: ${formatUnit(w)} × ${formatUnit(t)}`} />
                </Group>
              );

            } else if (shape.type === 'pipe') {
              // Pipe — top-down view: thick colored line with circle joints
              const pipeR = shape.pipeRadius || 5;
              if (!shape.points || shape.points.length < 4) return null;
              const pts = shape.points;
              const dx = pts[2] - pts[0];
              const dy = pts[3] - pts[1];
              const length = Math.round(Math.sqrt(dx * dx + dy * dy));
              return (
                <Group key={shape.id}>
                  <Line
                    id={shape.id}
                    points={pts}
                    stroke={isSelected ? '#22d3ee' : '#06b6d4'} strokeWidth={pipeR * 2}
                    lineCap="round" lineJoin="round"
                    draggable={activeTool === 'select'}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                    hitStrokeWidth={20}
                  />
                  {/* Center flow line */}
                  <Line points={pts} stroke="#0e7490" strokeWidth={1} dash={[4, 4]} listening={false} />
                  {/* Joint circles at endpoints */}
                  <Circle x={pts[0]} y={pts[1]} radius={pipeR * 1.5} stroke="#0891b2" strokeWidth={2} fill="rgba(6, 182, 212, 0.2)" listening={false} />
                  <Circle x={pts[2]} y={pts[3]} radius={pipeR * 1.5} stroke="#0891b2" strokeWidth={2} fill="rgba(6, 182, 212, 0.2)" listening={false} />
                  {shape.name && (
                    <Text x={(pts[0] + pts[2]) / 2 - 40} y={(pts[1] + pts[3]) / 2 - 20} width={80} height={18}
                      text={shape.name} fill="#67e8f9" fontSize={11} fontStyle="bold"
                      align="center" listening={false} shadowColor="black" shadowBlur={2} />
                  )}
                  <DimensionLabel x={(pts[0] + pts[2]) / 2} y={Math.min(pts[1], pts[3]) - 24} text={`Pipe: ${formatUnit(length)}`} />
                </Group>
              );

            } else if (shape.type === 'cable') {
              // Cable — top-down view: thin dashed line with post dots
              if (!shape.points || shape.points.length < 4) return null;
              const pts = shape.points;
              const dx = pts[2] - pts[0];
              const dy = pts[3] - pts[1];
              const length = Math.round(Math.sqrt(dx * dx + dy * dy));
              return (
                <Group key={shape.id}>
                  <Line
                    id={shape.id}
                    points={pts}
                    stroke={isSelected ? '#fbbf24' : '#f59e0b'} strokeWidth={isSelected ? 3 : 2}
                    dash={[8, 4]}
                    draggable={activeTool === 'select'}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                    hitStrokeWidth={20}
                  />
                  {/* Post markers at endpoints */}
                  <Circle x={pts[0]} y={pts[1]} radius={4} fill="#78716c" stroke="#a8a29e" strokeWidth={1} listening={false} />
                  <Circle x={pts[2]} y={pts[3]} radius={4} fill="#78716c" stroke="#a8a29e" strokeWidth={1} listening={false} />
                  {/* Lightning bolt icon at center */}
                  <Text x={(pts[0] + pts[2]) / 2 - 8} y={(pts[1] + pts[3]) / 2 - 8} text="⚡" fontSize={14} listening={false} />
                  {shape.name && (
                    <Text x={(pts[0] + pts[2]) / 2 - 40} y={(pts[1] + pts[3]) / 2 + 10} width={80} height={18}
                      text={shape.name} fill="#fcd34d" fontSize={11} fontStyle="bold"
                      align="center" listening={false} shadowColor="black" shadowBlur={2} />
                  )}
                  <DimensionLabel x={(pts[0] + pts[2]) / 2} y={Math.min(pts[1], pts[3]) - 24} text={`Cable: ${formatUnit(length)}`} />
                </Group>
              );

            } else if (shape.type === 'path') {
              // Path — top-down view: wide green strip with dashed center line
              const w = shape.width || 200;
              const pw = shape.pathWidth || 30;
              return (
                <Group key={shape.id}>
                  <Rect
                    id={shape.id}
                    x={shape.x} y={shape.y} width={w} height={pw}
                    fill="rgba(52, 211, 153, 0.2)" stroke={isSelected ? '#10b981' : '#34d399'} strokeWidth={isSelected ? 3 : 1.5}
                    draggable={activeTool === 'select'} rotation={shape.rotation || 0}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  {/* Dashed center line */}
                  <Line points={[shape.x + 4, shape.y + pw / 2, shape.x + w - 4, shape.y + pw / 2]}
                    stroke="#f0fdf4" strokeWidth={1} dash={[6, 4]} listening={false} />
                  {shape.name && (
                    <Text x={shape.x} y={shape.y + pw / 2 - 7} width={w} height={18}
                      text={shape.name} fill="#d1fae5" fontSize={11} fontStyle="bold"
                      align="center" verticalAlign="middle" listening={false} shadowColor="black" shadowBlur={2} />
                  )}
                  <DimensionLabel x={shape.x + w / 2} y={shape.y - 20} text={`Path: ${formatUnit(w)} × ${formatUnit(pw)}`} />
                </Group>
              );

            } else if (shape.type === 'road') {
              // Road — top-down view: dark wide strip with yellow center dashes and white edge lines
              const w = shape.width || 300;
              const rw = shape.roadWidth || 60;
              return (
                <Group key={shape.id}>
                  <Rect
                    id={shape.id}
                    x={shape.x} y={shape.y} width={w} height={rw}
                    fill="rgba(55, 65, 81, 0.7)" stroke={isSelected ? '#10b981' : '#6b7280'} strokeWidth={isSelected ? 3 : 1.5}
                    draggable={activeTool === 'select'} rotation={shape.rotation || 0}
                    onClick={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if (activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  {/* Yellow center dashed line */}
                  <Line points={[shape.x + 6, shape.y + rw / 2, shape.x + w - 6, shape.y + rw / 2]}
                    stroke="#fbbf24" strokeWidth={2} dash={[10, 6]} listening={false} />
                  {/* White edge lines */}
                  <Line points={[shape.x + 4, shape.y + 4, shape.x + w - 4, shape.y + 4]}
                    stroke="#e5e7eb" strokeWidth={1.5} listening={false} />
                  <Line points={[shape.x + 4, shape.y + rw - 4, shape.x + w - 4, shape.y + rw - 4]}
                    stroke="#e5e7eb" strokeWidth={1.5} listening={false} />
                  {shape.name && (
                    <Text x={shape.x} y={shape.y + rw / 2 - 7} width={w} height={18}
                      text={shape.name} fill="#fff" fontSize={12} fontStyle="bold"
                      align="center" verticalAlign="middle" listening={false} shadowColor="black" shadowBlur={2} />
                  )}
                  <DimensionLabel x={shape.x + w / 2} y={shape.y - 20} text={`Road: ${formatUnit(w)} × ${formatUnit(rw)}`} />
                </Group>
              );
            }
            return null;
          })}

          {selectionZone && (
            <Rect
              x={Math.min(selectionZone.x1, selectionZone.x2)}
              y={Math.min(selectionZone.y1, selectionZone.y2)}
              width={Math.abs(selectionZone.x2 - selectionZone.x1)}
              height={Math.abs(selectionZone.y2 - selectionZone.y1)}
              stroke="#ef4444"
              strokeWidth={1}
              dash={[5, 2]}
              fill="rgba(239, 68, 68, 0.1)"
            />
          )}

          {isDrawing && newShape && (newShape.type === 'rectangle' || newShape.type === 'boundary') && (
            <Rect x={newShape.x} y={newShape.y} width={newShape.width} height={newShape.height} fill={newShape.fill} stroke={newShape.stroke} strokeWidth={newShape.strokeWidth} dash={newShape.dash} />
          )}
          {isDrawing && newShape && newShape.type === 'circle' && (
            <Circle x={newShape.x} y={newShape.y} radius={newShape.radius} fill={newShape.fill} stroke={newShape.stroke} strokeWidth={newShape.strokeWidth} />
          )}
          {isDrawing && newShape && newShape.type === 'arc' && (
            <Arc x={newShape.x} y={newShape.y} innerRadius={newShape.innerRadius} outerRadius={newShape.outerRadius} angle={newShape.angle} stroke={newShape.stroke} strokeWidth={newShape.strokeWidth} hitStrokeWidth={20} />
          )}
          {isDrawing && newShape && newShape.type === 'ellipse' && (
            <Ellipse x={newShape.x} y={newShape.y} radiusX={newShape.radiusX} radiusY={newShape.radiusY} fill={newShape.fill} stroke={newShape.stroke} strokeWidth={newShape.strokeWidth} />
          )}
          {isDrawing && newShape && (newShape.type === 'line' || newShape.type === 'curve') && (
            <Line points={newShape.points} stroke="#fff" strokeWidth={4} tension={newShape.tension} />
          )}
          {isDrawing && newShape && (newShape.type === 'poly4' || newShape.type === 'curved-area') && (
            <Line points={newShape.points} stroke={newShape.stroke || "#8b5cf6"} strokeWidth={newShape.strokeWidth || 2} fill={newShape.fill || "rgba(139, 92, 246, 0.2)"} tension={newShape.tension || 0} closed={true} />
          )}

          {selectedId && activeTool === 'select' && (
            <Transformer
              ref={trRef}
              boundBoxFunc={(oldBox, newBox) => {
                if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) return oldBox;
                return newBox;
              }}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
};

export default KonvaCanvas;
