const API_BASE = '/api/plots';

async function handleResponse(response) {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/** List all plots (summary only) */
export async function listPlots() {
  const res = await fetch(API_BASE);
  return handleResponse(res);
}

/** Get a single plot with full GeoJSON */
export async function getPlot(id) {
  const res = await fetch(`${API_BASE}/${id}`);
  return handleResponse(res);
}

/** Create a new plot */
export async function createPlot(name, geojson) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, geojson }),
  });
  return handleResponse(res);
}

/** Update an existing plot */
export async function updatePlot(id, data) {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

/** Delete a plot */
export async function deletePlot(id) {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
  });
  return handleResponse(res);
}
