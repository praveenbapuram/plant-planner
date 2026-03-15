import './Toolbar.css';

export default function Toolbar({ onNewPlot, onToggleSidebar, isSidebarOpen, activePlot, hasDrawnShapes }) {
  return (
    <header className="toolbar" id="main-toolbar">
      <div className="toolbar-brand">
        <div className="toolbar-logo">🌱</div>
        <div>
          <div className="toolbar-title">Plant Planner</div>
          <div className="toolbar-subtitle">Plot Layout Designer</div>
        </div>
      </div>

      <div className="toolbar-actions">
        <div className="toolbar-status">
          <span className="toolbar-status-dot"></span>
          <span>{activePlot ? `Editing: ${activePlot.name}` : 'Ready'}</span>
        </div>

        <div className="toolbar-divider" />

        <button
          className="btn btn-secondary"
          onClick={onToggleSidebar}
          id="toggle-sidebar-btn"
          title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          {isSidebarOpen ? '◀' : '▶'} Plots
        </button>

        <button
          className="btn btn-primary"
          onClick={onNewPlot}
          id="new-plot-btn"
        >
          + New Plot
        </button>
      </div>
    </header>
  );
}
