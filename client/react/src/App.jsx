import { useState, useRef, useCallback, useEffect } from 'react';
import './App.css';
import KonvaCanvas from './components/KonvaCanvas';
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
  
  // Mobile Detection
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  const canvasRef = useRef(null);

  // Load existing layouts on mount
  useEffect(() => {
    loadPlots();
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
      setShapesToLoad(plot.geojson || []);
      showToast('success', `Loaded: ${plot.name}`, 'Project Open');
    } catch (err) {
      showToast('error', 'Could not open project', 'Error');
    }
  };

  const handleNewPlot = useCallback(() => {
    setActivePlot(null);
    setShapesToLoad([]);
    if (canvasRef.current?.clearDrawings) canvasRef.current.clearDrawings();
    showToast('info', 'Starting a new blank layout', 'New Layout');
  }, []);

  const handleSave = useCallback(async (name) => {
    setIsSaveDialogOpen(false);
    try {
      if (activePlot) {
        const updated = await updatePlot(activePlot.id, { name, geojson: currentShapes });
        setActivePlot(updated);
        showToast('success', 'Changes saved successfully', 'Update Success');
      } else {
        const created = await createPlot(name, currentShapes);
        setActivePlot(created);
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
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '1px' }}>Project Library</h3>
          {isMobile && <button className="btn btn-ghost" onClick={() => setIsSidebarOpen(false)}>✕</button>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
          {plots.map(p => (
            <div 
              key={p.id} 
              className={`card ${activePlot?.id === p.id ? 'active' : ''}`}
              style={{ marginBottom: '8px', cursor: 'pointer', borderColor: activePlot?.id === p.id ? 'var(--accent-primary)' : '' }}
              onClick={() => { handleSelectPlot(p.id); if(isMobile) setIsSidebarOpen(false); }}
            >
              <div style={{ fontWeight: 600, fontSize: '14px' }}>{p.name}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{p.geojson?.length || 0} objects</div>
            </div>
          ))}
        </div>
      </aside>

      {/* MAIN CANVAS AREA */}
      <main className="main-content">
        <KonvaCanvas 
          shapesToLoad={shapesToLoad}
          onShapesChange={setCurrentShapes}
          canvasRef={canvasRef}
        />
        
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
