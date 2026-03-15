import { useState, useMemo } from 'react';
import './PlotList.css';

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function LoadingSkeleton() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <div key={i} className="plot-card-skeleton">
          <div className="skeleton skeleton-icon" />
          <div style={{ flex: 1 }}>
            <div className="skeleton skeleton-text" />
            <div className="skeleton skeleton-text-short" />
          </div>
        </div>
      ))}
    </>
  );
}

export default function PlotList({
  plots,
  activePlotId,
  isCollapsed,
  isLoading,
  onSelectPlot,
  onDeletePlot,
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPlots = useMemo(() => {
    if (!searchQuery.trim()) return plots;
    const q = searchQuery.toLowerCase();
    return plots.filter((p) => p.name.toLowerCase().includes(q));
  }, [plots, searchQuery]);

  return (
    <aside className={`plot-list ${isCollapsed ? 'collapsed' : ''}`} id="plot-list-sidebar">
      <div className="plot-list-header">
        <h2>📋 Saved Plots</h2>
        <div className="plot-list-search">
          <span className="plot-list-search-icon">🔍</span>
          <input
            className="input"
            type="text"
            placeholder="Search plots..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            id="plot-search-input"
          />
        </div>
      </div>

      <div className="plot-list-body">
        {isLoading ? (
          <LoadingSkeleton />
        ) : filteredPlots.length === 0 ? (
          <div className="plot-list-empty">
            <div className="plot-list-empty-icon">🗺️</div>
            <p>
              {searchQuery
                ? 'No plots match your search.'
                : 'No plots saved yet. Draw a plot on the canvas and save it!'}
            </p>
          </div>
        ) : (
          filteredPlots.map((plot, index) => (
            <div
              key={plot.id}
              className={`plot-card ${activePlotId === plot.id ? 'active' : ''}`}
              onClick={() => onSelectPlot(plot.id)}
              style={{ animationDelay: `${index * 50}ms` }}
              id={`plot-card-${plot.id}`}
            >
              <div className="plot-card-icon">🌿</div>
              <div className="plot-card-info">
                <div className="plot-card-name">{plot.name}</div>
                <div className="plot-card-date">{formatDate(plot.updatedAt)}</div>
              </div>
              <div className="plot-card-actions">
                <button
                  className="plot-card-action-btn delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeletePlot(plot.id, plot.name);
                  }}
                  title="Delete plot"
                  aria-label={`Delete ${plot.name}`}
                >
                  🗑
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
