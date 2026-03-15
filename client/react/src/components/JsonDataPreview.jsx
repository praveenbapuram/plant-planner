import { useState } from 'react';
import './JsonDataPreview.css';

function syntaxHighlight(json) {
  if (typeof json !== 'string') {
    json = JSON.stringify(json, null, 2);
  }
  // Escape HTML
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key';
        } else {
          cls = 'json-string';
        }
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

export default function JsonDataPreview({ data, isVisible, onClose }) {
  const [copied, setCopied] = useState(false);

  if (!isVisible) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const hasData = Array.isArray(data) && data.length > 0;

  return (
    <div className="json-preview glass" id="json-preview-panel">
      <div className="json-preview-header">
        <span className="json-preview-title">
          📄 Layout JSON Preview
        </span>
        <div className="json-preview-actions">
          {hasData && (
            <button
              className="btn btn-ghost btn-icon"
              onClick={handleCopy}
              title="Copy JSON"
            >
              {copied ? '✓' : '📋'}
            </button>
          )}
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            title="Close preview"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="json-preview-body">
        {hasData ? (
          <pre
            dangerouslySetInnerHTML={{
              __html: syntaxHighlight(data),
            }}
          />
        ) : (
          <div className="json-preview-empty">
            Draw objects on the canvas to see JSON output here.
          </div>
        )}
      </div>
    </div>
  );
}
