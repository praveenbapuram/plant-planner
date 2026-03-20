import { useState, useRef, useCallback, useEffect } from 'react';
import './App.css';
import KonvaCanvas from './components/KonvaCanvas';
import ThreeCanvas from './components/ThreeCanvas';
import JsonDataPreview from './components/JsonDataPreview';
import SaveDialog from './components/SaveDialog';
import ToastContainer, { showToast } from './components/Toast';
import { listPlots, getPlot, createPlot, updatePlot, deletePlot } from './services/api';

export default function App() {
  // Global State
  const [plots, setPlots] = useState([]);
  const [activePlot, setActivePlot] = useState(null);
  const [currentShapes, setCurrentShapes] = useState([]);
  const [shapesToLoad, setShapesToLoad] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [viewMode, setViewMode] = useState('3d'); // '2d' | '3d'
  
  // Mobile Detection
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  const [libraryTemplates, setLibraryTemplates] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pp_library') || '[]'); } catch { return []; }
  });
  const [showLibrary, setShowLibrary] = useState(false);

  const saveToLibrary = useCallback((name) => {
    const template = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || `Template ${libraryTemplates.length + 1}`,
      shapes: JSON.parse(JSON.stringify(currentShapes)),
      createdAt: new Date().toISOString(),
      shapeCount: currentShapes.length,
    };
    const updated = [...libraryTemplates, template];
    setLibraryTemplates(updated);
    try { localStorage.setItem('pp_library', JSON.stringify(updated)); } catch {}
    showToast('success', `Saved "${template.name}" to library`, 'Library');
  }, [currentShapes, libraryTemplates]);

  const loadFromLibrary = useCallback((template) => {
    const shapes = JSON.parse(JSON.stringify(template.shapes));
    setCurrentShapes(shapes);
    setShapesToLoad(shapes);
    showToast('success', `Loaded "${template.name}" (${shapes.length} objects)`, 'Library');
  }, []);

  const deleteFromLibrary = useCallback((templateId) => {
    const updated = libraryTemplates.filter(t => t.id !== templateId);
    setLibraryTemplates(updated);
    try { localStorage.setItem('pp_library', JSON.stringify(updated)); } catch {}
    showToast('info', 'Template removed from library', 'Library');
  }, [libraryTemplates]);

  const canvasRef = useRef(null);

  // Load existing layouts on mount + restore last active plot
  useEffect(() => {
    const init = async () => {
      await loadPlots();
      // Restore last active plot from localStorage
      const lastPlotId = localStorage.getItem('plantplanner_activePlotId');
      if (lastPlotId) {
        try {
          const plot = await getPlot(lastPlotId);
          setActivePlot(plot);
          const shapes = plot.geojson || [];
          setShapesToLoad(shapes);
          setCurrentShapes(shapes);
        } catch {
          localStorage.removeItem('plantplanner_activePlotId');
        }
      }
    };
    init();
  }, []);

  const loadPlots = async () => {
    setIsLoading(true);
    try {
      const data = await listPlots();
      setPlots(data);
    } catch (err) {
      showToast('error', 'Failed to load layouts', 'Sync Error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectPlot = async (plotId) => {
    try {
      const plot = await getPlot(plotId);
      setActivePlot(plot);
      const shapes = plot.geojson || [];
      setShapesToLoad(shapes);
      setCurrentShapes(shapes);
      localStorage.setItem('plantplanner_activePlotId', plot.id);
      showToast('success', `Loaded: ${plot.name}`, 'Project Open');
    } catch (err) {
      showToast('error', 'Could not open project', 'Error');
    }
  };

  const handleNewPlot = useCallback(() => {
    setActivePlot(null);
    setShapesToLoad([]);
    setCurrentShapes([]);
    localStorage.removeItem('plantplanner_activePlotId');
    if (canvasRef.current?.clearDrawings) canvasRef.current.clearDrawings();
    showToast('info', 'Starting a new blank layout', 'New Layout');
  }, []);

  const handleSave = useCallback(async (name) => {
    setIsSaveDialogOpen(false);
    try {
      if (activePlot) {
        const updated = await updatePlot(activePlot.id, { name, geojson: currentShapes });
        setActivePlot(updated);
        localStorage.setItem('plantplanner_activePlotId', updated.id);
        showToast('success', 'Changes saved successfully', 'Update Success');
      } else {
        const created = await createPlot(name, currentShapes);
        setActivePlot(created);
        localStorage.setItem('plantplanner_activePlotId', created.id);
        showToast('success', 'New layout created', 'Project Saved');
      }
      loadPlots();
    } catch (err) {
      showToast('error', 'Failed to save progress', 'Save Error');
    }
  }, [activePlot, currentShapes]);

  return (
    <div className="app-container">
      {/* HEADER SECTION */}
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '10px' : '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '32px', height: '32px', background: 'var(--accent-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'black', fontWeight: 800 }}>P</div>
            {!isMobile && <h1 style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-heading)', letterSpacing: '-0.5px', whiteSpace: 'nowrap' }}>PlantPlanner <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: '5px' }}>v2.0</span></h1>}
          </div>
          <button className="btn btn-secondary" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            {isMobile ? '📚' : (isSidebarOpen ? '⇠ Close Library' : '⇢ Open Library')}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          {/* 2D / 3D View Toggle */}
          <div className="view-toggle">
            <button className={`view-toggle-btn ${viewMode === '2d' ? 'active' : ''}`} onClick={() => setViewMode('2d')}>
              ✏️ 2D
            </button>
            <button className={`view-toggle-btn ${viewMode === '3d' ? 'active' : ''}`} onClick={() => setViewMode('3d')}>
              🧊 3D
            </button>
          </div>
          {/* Import / Export JSON */}
          {!isMobile && (
            <>
              <button className="btn btn-secondary" title="Import layout from JSON file" onClick={() => document.getElementById('json-import-input')?.click()}>
                📥 Import
              </button>
              <button className="btn btn-secondary" title="Export layout as JSON file" onClick={() => {
                const blob = new Blob([JSON.stringify(currentShapes, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${activePlot?.name || 'layout'}-${new Date().toISOString().slice(0,10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                showToast('success', 'Layout exported as JSON', 'Export');
              }}>
                📤 Export
              </button>
              <input id="json-import-input" type="file" accept=".json,application/json" style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    try {
                      const data = JSON.parse(ev.target.result);
                      if (Array.isArray(data)) {
                        setCurrentShapes(data);
                        setShapesToLoad(data);
                        showToast('success', `Imported ${data.length} objects`, 'Import');
                      } else if (data.shapes && Array.isArray(data.shapes)) {
                        setCurrentShapes(data.shapes);
                        setShapesToLoad(data.shapes);
                        showToast('success', `Imported ${data.shapes.length} objects`, 'Import');
                      } else {
                        showToast('error', 'Invalid JSON format — expected an array of shapes', 'Import Error');
                      }
                    } catch (err) {
                      showToast('error', 'Could not parse JSON file', 'Import Error');
                    }
                  };
                  reader.readAsText(file);
                  e.target.value = ''; // reset so same file can be re-imported
                }}
              />
            </>
          )}
          {isMobile ? (
            <button className="btn btn-primary" onClick={() => setIsSaveDialogOpen(true)}>💾 Save</button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={handleNewPlot}>New Blank</button>
              <button className="btn btn-primary" onClick={() => setIsSaveDialogOpen(true)}>
                {activePlot ? '💾 Save Changes' : '💾 Save New Project'}
              </button>
            </>
          )}
        </div>
      </header>

      {/* LEFT SIDEBAR: Project Library */}
      <aside className={`sidebar-left ${isSidebarOpen ? 'open' : 'collapsed'}`}>
        {/* Tab switcher: Projects / Library */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            <button
              className={`btn ${!showLibrary ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '5px 12px', flex: 1 }}
              onClick={() => setShowLibrary(false)}>
              📁 Projects
            </button>
            <button
              className={`btn ${showLibrary ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '5px 12px', flex: 1 }}
              onClick={() => setShowLibrary(true)}>
              📚 Library
            </button>
          </div>
          {isMobile && <button className="btn btn-ghost" onClick={() => setIsSidebarOpen(false)}>✕</button>}
        </div>

        {!showLibrary ? (
          /* ── Projects Tab ── */
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {plots.map(p => (
              <div
                key={p.id}
                className={`card ${activePlot?.id === p.id ? 'active' : ''}`}
                style={{ marginBottom: '8px', cursor: 'pointer', borderColor: activePlot?.id === p.id ? 'var(--accent-primary)' : '' }}
                onClick={() => { handleSelectPlot(p.id); if(isMobile) setIsSidebarOpen(false); }}
              >
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{p.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{p.shapeCount ?? p.geojson?.length ?? 0} objects</div>
              </div>
            ))}
          </div>
        ) : (
          /* ── Library Tab ── */
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Save to Library */}
            <button
              className="btn btn-primary"
              style={{ width: '100%', fontSize: 12 }}
              disabled={currentShapes.length === 0}
              onClick={() => {
                const name = prompt('Template name:', activePlot?.name || `Template ${libraryTemplates.length + 1}`);
                if (name) saveToLibrary(name);
              }}>
              + Save Current Layout to Library
            </button>
            {/* Import JSON to Library */}
            <button
              className="btn btn-secondary"
              style={{ width: '100%', fontSize: 12 }}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,application/json';
                input.onchange = (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    try {
                      const data = JSON.parse(ev.target.result);
                      const shapes = Array.isArray(data) ? data : (data.shapes || []);
                      if (shapes.length === 0) { showToast('error', 'No shapes found in file', 'Import Error'); return; }
                      const name = prompt('Template name:', file.name.replace('.json', ''));
                      if (!name) return;
                      const template = {
                        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                        name,
                        shapes: shapes,
                        createdAt: new Date().toISOString(),
                        shapeCount: shapes.length,
                      };
                      const updated = [...libraryTemplates, template];
                      setLibraryTemplates(updated);
                      try { localStorage.setItem('pp_library', JSON.stringify(updated)); } catch {}
                      showToast('success', `"${name}" added to library`, 'Library');
                    } catch { showToast('error', 'Invalid JSON', 'Import Error'); }
                  };
                  reader.readAsText(file);
                };
                input.click();
              }}>
              📥 Import JSON to Library
            </button>

            <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />

            {libraryTemplates.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No templates yet. Save a layout or import a JSON file to build your library.
              </div>
            ) : (
              libraryTemplates.map(t => (
                <div key={t.id} className="card" style={{ marginBottom: 0, position: 'relative' }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {t.shapeCount} objects • {new Date(t.createdAt).toLocaleDateString()}
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    <button className="btn btn-primary" style={{ fontSize: 11, padding: '3px 10px', flex: 1 }}
                      onClick={() => loadFromLibrary(t)}>
                      Load
                    </button>
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }}
                      title="Export as JSON"
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(t.shapes, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = `${t.name}.json`; a.click();
                        URL.revokeObjectURL(url);
                      }}>
                      📤
                    </button>
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 10px', color: '#f87171' }}
                      title="Delete template"
                      onClick={() => { if (confirm(`Delete "${t.name}"?`)) deleteFromLibrary(t.id); }}>
                      🗑️
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </aside>

      {/* MAIN CANVAS AREA */}
      <main className="main-content">
        {viewMode === '2d' ? (
          <KonvaCanvas
            shapesToLoad={shapesToLoad}
            onShapesChange={setCurrentShapes}
            canvasRef={canvasRef}
          />
        ) : (
          <ThreeCanvas shapes={currentShapes} onShapesChange={setCurrentShapes} />
        )}
        
        {/* Floating JSON Peek Button */}
        <div style={{ position: 'absolute', bottom: '20px', left: '20px', zIndex: 10 }}>
           <button className="btn btn-secondary glass" onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}>
             {isRightSidebarOpen ? 'Hide Panel ⇉' : '⇇ Show Panel'}
           </button>
        </div>
      </main>

      {/* RIGHT SIDEBAR (Bottom Sheet on Mobile) */}
      <aside className={`sidebar-right ${isRightSidebarOpen ? 'open' : ''}`}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '1px' }}>Blueprint Data</h3>
          {isMobile && <button className="btn btn-ghost" onClick={() => setIsRightSidebarOpen(false)}>✕ Close</button>}
        </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <JsonDataPreview data={currentShapes} isVisible={true} inline={true} />
          </div>
          <div style={{ padding: '20px', background: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-subtle)' }}>
             <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                This JSON payload can be sent to AI models or other CAD engines for further processing.
             </p>
          </div>
      </aside>

      {/* MOBILE TOOLS BAR */}
      {isMobile && (
        <div className="mobile-tools-bar">
          <button className="btn btn-secondary" onClick={() => setIsRightSidebarOpen(true)}>📊 Data</button>
          <div style={{ width: '2px', height: '30px', background: 'var(--border-subtle)' }} />
          <button className="btn btn-secondary" onClick={handleNewPlot}>✨ New</button>
          <button className="btn btn-primary" onClick={() => setIsSaveDialogOpen(true)}>💾 Save</button>
        </div>
      )}

      {/* DIALOGS */}
      <SaveDialog 
        isOpen={isSaveDialogOpen}
        onSave={handleSave}
        onCancel={() => setIsSaveDialogOpen(false)}
        defaultName={activePlot?.name || ''}
        isUpdate={!!activePlot}
      />

      <ToastContainer />
    </div>
  );
}
