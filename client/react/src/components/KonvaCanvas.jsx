import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Rect, Circle, Line, Ellipse, RegularPolygon, Text, Transformer, Group } from 'react-konva';

const DRAW_STYLE = {
  fill: 'rgba(52, 211, 153, 0.15)',
  stroke: '#34d399',
  strokeWidth: 2,
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
const PropertiesPanel = ({ shape, onChange, onCommit, onDelete, unit, pxPerUnit }) => {
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
    const dimKeys = ['width', 'height', 'radius', 'radiusX', 'radiusY'];
    dimKeys.forEach(k => {
      if (nextLocal[k] !== undefined) nextLocal[k] = toUnit(nextLocal[k]);
    });

    if (nextLocal.points) {
      nextLocal.points = nextLocal.points.map((p, i) => toRelativeUnit(p, i % 2 === 0));
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

  return (
    <div className="glass sidebar-right animate-slide-right" style={{ position: 'absolute', top: 80, right: 20, zIndex: 100, padding: '20px', width: '300px', maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', borderRadius: 'var(--radius-lg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
         <h4 style={{ margin: 0, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '1px' }}>⚒️ {shape.type} settings</h4>
         <button className="btn btn-ghost" onClick={onDelete} style={{ color: 'var(--color-error)', padding: '4px' }}>🗑</button>
      </div>
      
      <div className="input-group">
        <label className="input-label">Object Label</label>
        <input type="text" className="input" value={local.name || ''} placeholder="e.g. Storage Tank" onChange={(e) => { setLocal(prev => ({...prev, name: e.target.value})); onChange('name', e.target.value); }} onBlur={onCommit} />
      </div>

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
          <input type="color" className="input" style={{ height: '40px', padding: '2px' }} value={local.fill || '#34d399'} onChange={(e) => { setLocal(prev => ({...prev, fill: e.target.value})); onChange('fill', e.target.value); }} onBlur={onCommit} />
        </div>
        <div className="input-group" style={{ flex: 1 }}>
          <label className="input-label">Stroke</label>
          <input type="color" className="input" style={{ height: '40px', padding: '2px' }} value={local.stroke || '#34d399'} onChange={(e) => { setLocal(prev => ({...prev, stroke: e.target.value})); onChange('stroke', e.target.value); }} onBlur={onCommit} />
        </div>
      </div>

      {shape.type === 'rectangle' && (
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

      {shape.type === 'line' && (
        <div className="card" style={{ padding: '12px', background: 'var(--bg-primary)' }}>
          <label className="input-label" style={{ marginBottom: '10px', display: 'block' }}>Path Coords ({unit})</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(local.points || []).map((p, i) => i % 2 === 0 && (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ fontSize: '10px', width: '25px', opacity: 0.5 }}>P{i/2 + 1}</span>
                <input type="number" step="any" className="input" style={{ padding: '6px' }} value={local.points[i]} onChange={(e) => handlePointChange(i/2, 'x', e.target.value)} onBlur={onCommit} />
                <input type="number" step="any" className="input" style={{ padding: '6px' }} value={local.points[i+1]} onChange={(e) => handlePointChange(i/2, 'y', e.target.value)} onBlur={onCommit} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="input-group" style={{ marginTop: '15px' }}>
        <label className="input-label">Rotation Angle (°)</label>
        <input type="number" step="any" className="input" value={Math.round(local.rotation || 0)} onChange={(e) => { setLocal(prev => ({...prev, rotation: e.target.value})); onChange('rotation', parseFloat(e.target.value) || 0); }} onBlur={onCommit} />
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
  const [origin, setOrigin] = useState({ x: 100, y: 100 }); // { x, y } in pixels
  
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
        ...DRAW_STYLE
      };

      if (activeTool === 'rectangle') {
        initialShape = { ...initialShape, x: pos.x, y: pos.y, width: 0, height: 0, fill: '#34d39966', stroke: '#34d399' };
      } else if (activeTool === 'circle') {
        initialShape = { ...initialShape, x: pos.x, y: pos.y, radius: 0, fill: '#3b82f666', stroke: '#3b82f6' };
      } else if (activeTool === 'triangle') {
        initialShape = { ...initialShape, x: pos.x, y: pos.y, radius: 0, sides: 3, fill: '#f59e0b66', stroke: '#f59e0b' };
      } else if (activeTool === 'ellipse') {
        initialShape = { ...initialShape, x: pos.x, y: pos.y, radiusX: 0, radiusY: 0, fill: '#ec489966', stroke: '#ec4899' };
      } else if (activeTool === 'line') {
        initialShape = { ...initialShape, points: [pos.x, pos.y, pos.x, pos.y], hitStrokeWidth: 10, stroke: '#fff' };
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
    
    if (newShape.type === 'rectangle') {
      setNewShape(prev => ({
        ...prev,
        width: pos.x - prev.x,
        height: pos.y - prev.y
      }));
    } else if (newShape.type === 'circle' || newShape.type === 'triangle') {
      const radius = Math.sqrt(Math.pow(pos.x - newShape.x, 2) + Math.pow(pos.y - newShape.y, 2));
      setNewShape(prev => ({ ...prev, radius }));
    } else if (newShape.type === 'ellipse') {
      const rx = Math.abs(pos.x - newShape.x);
      const ry = Math.abs(pos.y - newShape.y);
      setNewShape(prev => ({ ...prev, radiusX: rx, radiusY: ry }));
    } else if (newShape.type === 'line') {
      setNewShape(prev => ({ ...prev, points: [prev.points[0], prev.points[1], pos.x, pos.y] }));
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
        if (s.type === 'rectangle') {
          const cx = (s.x || 0) + (s.width || 0) / 2;
          const cy = (s.y || 0) + (s.height || 0) / 2;
          isInside = cx >= xMin && cx <= xMax && cy >= yMin && cy <= yMax;
        } else if (s.type === 'line') {
          const p1x = (s.points[0] || 0) + (s.x || 0);
          const p1y = (s.points[1] || 0) + (s.y || 0);
          const p2x = (s.points[2] || 0) + (s.x || 0);
          const p2y = (s.points[3] || 0) + (s.y || 0);
          isInside = (p1x >= xMin && p1x <= xMax && p1y >= yMin && p1y <= yMax) ||
                     (p2x >= xMin && p2x <= xMax && p2y >= yMin && p2y <= yMax);
        } else {
          isInside = s.x >= xMin && s.x <= xMax && s.y >= yMin && s.y <= yMax;
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
        if (newShape.type === 'rectangle' && Math.abs(newShape.width) > 5 && Math.abs(newShape.height) > 5) {
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
        } else if (newShape.type === 'circle' && newShape.radius > 5) {
          normalizedShape.x = Math.round(normalizedShape.x);
          normalizedShape.y = Math.round(normalizedShape.y);
          normalizedShape.radius = Math.round(normalizedShape.radius);
          isValid = true;
        } else if (newShape.type === 'ellipse' && newShape.radiusX > 5 && newShape.radiusY > 5) {
          normalizedShape.x = Math.round(normalizedShape.x);
          normalizedShape.y = Math.round(normalizedShape.y);
          normalizedShape.radiusX = Math.round(normalizedShape.radiusX);
          normalizedShape.radiusY = Math.round(normalizedShape.radiusY);
          isValid = true;
        } else if (newShape.type === 'line') {
          const dx = newShape.points[2] - newShape.points[0];
          const dy = newShape.points[3] - newShape.points[1];
          if (Math.sqrt(dx*dx + dy*dy) > 10) {
            normalizedShape.points = normalizedShape.points.map(p => Math.round(p));
            isValid = true;
          }
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
        if (s.type === 'rectangle') {
          return {
            ...s,
            x: Math.round(node.x()),
            y: Math.round(node.y()),
            width: Math.round(Math.max(5, node.width() * scaleX)),
            height: Math.round(Math.max(5, node.height() * scaleY)),
            rotation: node.rotation()
          };
        } else if (s.type === 'circle') {
          return {
            ...s,
            x: Math.round(node.x()),
            y: Math.round(node.y()),
            radius: Math.round(Math.max(5, s.radius * ((scaleX + scaleY) / 2))),
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
  const updateSelectedShapeLive = (key, numValue) => {
    setShapes(shapes.map(s => {
      if (s.id === selectedId) {
        return { ...s, [key]: numValue };
      }
      return s;
    }));
  };

  // Called ONLY when blur (unfocusing text box)
  const commitSelectedShapeProperties = () => {
    commitHistory(shapes);
  };

  const handleDeleteSelected = () => {
    commitHistory(shapes.filter(s => s.id !== selectedId));
    selectShape(null);
  };

  return (
    <div ref={containerRef} style={{ flex: 1, position: 'relative', width: '100%', height: '100%', background: '#111827', overflow: 'hidden' }} id="map-canvas">
      
      {/* TOOLBAR */}
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, display: 'flex', gap: '10px' }}>
        <button 
          className={`btn ${activeTool === 'select' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontSize: '24px', padding: '15px' }}
          onClick={() => setActiveTool('select')} title="Select"
        >
          👆
        </button>
        <button 
          className={`btn ${activeTool === 'rectangle' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontSize: '24px', padding: '15px' }}
          onClick={() => { setActiveTool('rectangle'); selectShape(null); }} title="Draw Box"
        >
          ⬛
        </button>
        <button 
          className={`btn ${activeTool === 'circle' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontSize: '24px', padding: '15px' }}
          onClick={() => { setActiveTool('circle'); selectShape(null); }} title="Draw Circle"
        >
          ⚫
        </button>
        <button 
          className={`btn ${activeTool === 'ellipse' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontSize: '24px', padding: '15px' }}
          onClick={() => { setActiveTool('ellipse'); selectShape(null); }} title="Draw Ellipse"
        >
          🕳️
        </button>
        <button 
          className={`btn ${activeTool === 'line' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontSize: '24px', padding: '15px' }}
          onClick={() => { setActiveTool('line'); selectShape(null); }} title="Draw Line"
        >
          ➖
        </button>
        <div style={{ width: '1px', background: 'rgba(255,255,255,0.2)', margin: '0 5px' }} />
        <button 
          className={`btn ${activeTool === 'triangle' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontSize: '24px', padding: '15px' }}
          onClick={() => { setActiveTool('triangle'); selectShape(null); }} title="Draw Triangle"
        >
          🔺
        </button>
        <button 
          className={`btn ${activeTool === 'area-delete' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontSize: '24px', padding: '15px', color: activeTool === 'area-delete' ? '#fff' : '#ef4444' }}
          onClick={() => { setActiveTool('area-delete'); selectShape(null); }} title="Area Delete (Sweep to clear)"
        >
          🧹
        </button>
        <div style={{ width: '1px', background: 'rgba(255,255,255,0.2)', margin: '0 5px' }} />
        <button 
          className="btn btn-secondary" 
          style={{ fontSize: '24px', padding: '15px' }}
          onClick={handleUndo} 
          disabled={historyStep === 0}
          title="Undo (Ctrl+Z)"
        >
          ↩️
        </button>
        <button 
          className="btn btn-secondary" 
          style={{ fontSize: '24px', padding: '15px' }}
          onClick={handleRedo} 
          disabled={historyStep === history.length - 1}
          title="Redo (Ctrl+Shift+Z)"
        >
          ↪️
        </button>
        <div style={{ width: '1px', background: 'rgba(255,255,255,0.2)', margin: '0 5px' }} />
        <button 
          className={`btn ${activeTool === 'set-origin' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontSize: '24px', padding: '15px' }}
          onClick={() => { setActiveTool('set-origin'); selectShape(null); }} 
          title="Set Zero Point (0,0)"
        >
          🎯
        </button>
        <button 
          className={`btn ${showGrid ? 'btn-primary' : 'btn-secondary'}`}
          style={{ fontSize: '24px', padding: '15px' }}
          onClick={() => setShowGrid(!showGrid)} 
          title="Toggle Grid"
        >
          #️⃣
        </button>
        <div style={{ width: '1px', background: 'rgba(255,255,255,0.2)', margin: '0 5px' }} />
        <div className="glass" style={{ display: 'flex', borderRadius: '10px', overflow: 'hidden' }}>
          <button className={`btn ${unit === 'px' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setUnit('px')}>PX</button>
          <button className={`btn ${unit === 'm' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setUnit('m'); if(!isRatioLocked && pxPerUnit === 15) setPxPerUnit(50); }}>M</button>
          <button className={`btn ${unit === 'ft' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setUnit('ft'); if(!isRatioLocked && pxPerUnit === 50) setPxPerUnit(15); }}>FT</button>
        </div>
        {unit !== 'px' && (
          <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '0 10px', borderRadius: '10px' }}>
            <label style={{ fontSize: '10px' }}>Ratio:</label>
            <input 
              type="number" 
              value={pxPerUnit} 
              disabled={isRatioLocked}
              onChange={(e) => setPxPerUnit(parseInt(e.target.value) || 1)} 
              style={{ 
                width: '40px', 
                background: 'none', 
                color: isRatioLocked ? '#6b7280' : 'white', 
                border: 'none', 
                borderBottom: isRatioLocked ? '1px solid #4b5563' : '1px solid #34d399',
                cursor: isRatioLocked ? 'not-allowed' : 'text'
              }} 
            />
            <span style={{ fontSize: '10px', marginRight: '5px' }}>px/{unit}</span>
            <button 
              className="btn btn-ghost" 
              style={{ padding: '2px', fontSize: '14px', border: 'none', background: 'none', cursor: 'pointer' }}
              onClick={() => setIsRatioLocked(!isRatioLocked)}
              title={isRatioLocked ? "Unlock Ratio" : "Lock Ratio"}
            >
              {isRatioLocked ? '🔒' : '🔓'}
            </button>
          </div>
        )}
      </div>

      {/* PROPERTIES PANEL */}
      {selectedId && selectedShapeData && (
        <PropertiesPanel 
          shape={selectedShapeData} 
          onChange={updateSelectedShapeLive} 
          onCommit={commitSelectedShapeProperties}
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
            {showGrid && (
              <Group>
                {[...Array(80)].map((_, i) => (
                  <Line key={`v-${i}`} points={[i * 50, 0, i * 50, 4000]} stroke="rgba(255,255,255,0.05)" strokeWidth={1} listening={false} />
                ))}
                {[...Array(80)].map((_, i) => (
                  <Line key={`h-${i}`} points={[0, i * 50, 4000, i * 50]} stroke="rgba(255,255,255,0.05)" strokeWidth={1} listening={false} />
                ))}
              </Group>
            )}
            {/* Origin Marker */}
            <Group x={origin.x} y={origin.y}>
               <Line points={[-20, 0, 20, 0]} stroke="#34d399" strokeWidth={1} />
               <Line points={[0, -20, 0, 20]} stroke="#34d399" strokeWidth={1} />
               <Circle radius={3} fill="#34d399" />
               <Text text="(0,0)" x={5} y={5} fill="#34d399" fontSize={10} fontStyle="bold" />
            </Group>
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
                    onClick={() => { if(activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if(activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  {/* Label Text Centered */}
                  {shape.name && (
                    <Text 
                      x={shape.x} y={shape.y} width={shape.width} height={shape.height}
                      text={shape.name} fill="#fff" fontSize={14} fontStyle="bold"
                      align="center" verticalAlign="middle" listening={false}
                      shadowColor="black" shadowBlur={2}
                    />
                  )}
                  {/* Dimension Labels with improved visibility */}
                  <DimensionLabel x={shape.x + shape.width/2} y={shape.y - 20} text={`W: ${formatUnit(rectWidth)}`} />
                  <DimensionLabel x={shape.x + shape.width + 35} y={shape.y + shape.height/2} text={`H: ${formatUnit(rectHeight)}`} />
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
                    onClick={() => { if(activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if(activeTool === 'select') selectShape(shape.id); }}
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
                    onClick={() => { if(activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if(activeTool === 'select') selectShape(shape.id); }}
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
                    onClick={() => { if(activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if(activeTool === 'select') selectShape(shape.id); }}
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
            } else if (shape.type === 'line') {
              const dx = shape.points[2] - shape.points[0];
              const dy = shape.points[3] - shape.points[1];
              const length = Math.round(Math.sqrt(dx*dx + dy*dy));
              return (
                <Group key={shape.id}>
                  <Line
                    id={shape.id}
                    x={shape.x || 0} y={shape.y || 0} points={shape.points}
                    stroke={isSelected ? '#3b82f6' : '#fff'} strokeWidth={Math.max(4, strokeW)}
                    hitStrokeWidth={20}
                    draggable={activeTool === 'select'} rotation={shape.rotation || 0}
                    onClick={() => { if(activeTool === 'select') selectShape(shape.id); }}
                    onTap={() => { if(activeTool === 'select') selectShape(shape.id); }}
                    onDragEnd={handleDragEnd} onTransformEnd={handleTransformEnd}
                  />
                  <DimensionLabel 
                    x={(shape.points[0] + shape.points[2])/2 + (shape.x || 0)} 
                    y={(shape.points[1] + shape.points[3])/2 + (shape.y || 0) - 20} 
                    text={`L: ${formatUnit(length)}`} 
                  />
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

          {isDrawing && newShape && newShape.type === 'rectangle' && (
            <Rect x={newShape.x} y={newShape.y} width={newShape.width} height={newShape.height} fill={newShape.fill} stroke={newShape.stroke} strokeWidth={newShape.strokeWidth} />
          )}
          {isDrawing && newShape && newShape.type === 'circle' && (
            <Circle x={newShape.x} y={newShape.y} radius={newShape.radius} fill={newShape.fill} stroke={newShape.stroke} strokeWidth={newShape.strokeWidth} />
          )}
          {isDrawing && newShape && newShape.type === 'ellipse' && (
            <Ellipse x={newShape.x} y={newShape.y} radiusX={newShape.radiusX} radiusY={newShape.radiusY} fill={newShape.fill} stroke={newShape.stroke} strokeWidth={newShape.strokeWidth} />
          )}
          {isDrawing && newShape && newShape.type === 'line' && (
            <Line points={newShape.points} stroke="#fff" strokeWidth={4} />
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
