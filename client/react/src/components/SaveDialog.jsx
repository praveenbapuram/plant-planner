import { useState, useEffect, useRef } from 'react';
import './SaveDialog.css';

export default function SaveDialog({ isOpen, onSave, onCancel, defaultName, featureCount, isUpdate }) {
  const [name, setName] = useState(defaultName || '');
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setName(defaultName || '');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, defaultName]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim());
    }
  };

  return (
    <div className="save-dialog-overlay" onClick={onCancel}>
      <div className="save-dialog glass" onClick={(e) => e.stopPropagation()}>
        <div className="save-dialog-header">
          <h3>
            {isUpdate ? '✏️ Update Plot' : '💾 Save Plot Layout'}
          </h3>
          <p>
            {isUpdate
              ? 'Update the name or shapes of this plot layout.'
              : 'Give your plot layout a name to save it.'}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="save-dialog-body">
            <label htmlFor="plot-name-input">Plot Name</label>
            <input
              ref={inputRef}
              id="plot-name-input"
              className="input"
              type="text"
              placeholder="e.g. Backyard Garden, Front Lawn..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
            />
            <div className="save-dialog-info">
              🌿 {featureCount} object{featureCount !== 1 ? 's' : ''} will be saved as Layout JSON
            </div>
          </div>

          <div className="save-dialog-footer">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name.trim()}
            >
              {isUpdate ? '✏️ Update' : '💾 Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
