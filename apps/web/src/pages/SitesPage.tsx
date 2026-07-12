import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Circle,
  MapContainer,
  Marker,
  TileLayer,
  useMapEvents,
} from 'react-leaflet';
import { apiFetch } from '../lib/api';
import { currentUser } from '../lib/auth';

// Vite bundles the default marker images away from where Leaflet expects
// them; point the default icon at the bundled URLs. Deleting _getIconUrl
// stops Leaflet from prepending its auto-detected path to these absolute
// URLs (which produces doubled, broken image paths).
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface Site {
  id: string;
  name: string;
  client: string | null;
  address: string | null;
  lat: number;
  lng: number;
  radiusM: number;
  archived: boolean;
  engineerIds: string[];
}

type Draft = Omit<Site, 'id' | 'archived' | 'engineerIds'> & { id?: string };

// Manila City Hall — a sensible national default pin.
const DEFAULT_CENTER: [number, number] = [14.5896, 120.9815];

const EMPTY_DRAFT: Draft = {
  name: '',
  client: null,
  address: null,
  lat: DEFAULT_CENTER[0],
  lng: DEFAULT_CENTER[1],
  radiusM: 150,
};

function DraggablePin({
  draft,
  onMove,
}: {
  draft: Draft;
  onMove: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click: (e) => onMove(e.latlng.lat, e.latlng.lng),
  });
  return (
    <>
      <Marker
        position={[draft.lat, draft.lng]}
        draggable
        eventHandlers={{
          dragend: (e) => {
            const p = (e.target as L.Marker).getLatLng();
            onMove(p.lat, p.lng);
          },
        }}
      />
      <Circle
        center={[draft.lat, draft.lng]}
        radius={draft.radiusM}
        pathOptions={{ color: '#14532d', fillOpacity: 0.12 }}
      />
    </>
  );
}

export default function SitesPage() {
  const user = currentUser()!;
  const canEdit = user.role !== 'engineer';
  const [sites, setSites] = useState<Site[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    apiFetch<Site[]>('/sites').then(setSites).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load sites');
    });

  useEffect(() => {
    void refresh();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setError(null);
    setBusy(true);
    try {
      const body = {
        name: draft.name,
        client: draft.client || undefined,
        address: draft.address || undefined,
        lat: draft.lat,
        lng: draft.lng,
        radiusM: draft.radiusM,
      };
      await apiFetch(draft.id ? `/sites/${draft.id}` : '/sites', {
        method: draft.id ? 'PUT' : 'POST',
        body,
      });
      setDraft(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(site: Site) {
    await apiFetch(
      `/sites/${site.id}/${site.archived ? 'unarchive' : 'archive'}`,
      { method: 'POST' },
    );
    await refresh();
  }

  return (
    <main className="page-pad sites-page">
      <div className="sites-header">
        <h2>Sites</h2>
        {canEdit && !draft && (
          <button onClick={() => setDraft(EMPTY_DRAFT)}>New site</button>
        )}
      </div>

      {draft && (
        <form className="site-form" onSubmit={onSubmit}>
          <h3>{draft.id ? `Edit ${draft.name}` : 'New site'}</h3>
          <label className="field">
            Name
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              minLength={2}
              required
            />
          </label>
          <label className="field">
            Client (optional)
            <input
              value={draft.client ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, client: e.target.value || null })
              }
            />
          </label>
          <label className="field">
            Address (optional)
            <input
              value={draft.address ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, address: e.target.value || null })
              }
            />
          </label>

          <p className="hint">
            Drag the pin (or click the map) to the site location.
          </p>
          <MapContainer
            center={[draft.lat, draft.lng]}
            zoom={16}
            className="site-map"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <DraggablePin
              draft={draft}
              onMove={(lat, lng) => setDraft({ ...draft, lat, lng })}
            />
          </MapContainer>

          <label className="field">
            Geofence radius: <strong>{draft.radiusM} m</strong>
            <input
              type="range"
              min={50}
              max={1000}
              step={10}
              value={draft.radiusM}
              onChange={(e) =>
                setDraft({ ...draft, radiusM: Number(e.target.value) })
              }
            />
          </label>

          {error && <p role="alert" className="error">{error}</p>}
          <div className="form-actions">
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save site'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="site-list">
        {sites.map((site) => (
          <li key={site.id} className={site.archived ? 'archived' : ''}>
            <div>
              <strong>{site.name}</strong>
              {site.client && <span className="muted"> · {site.client}</span>}
              <div className="muted">
                {site.radiusM} m geofence
                {site.archived && ' · archived'}
              </div>
            </div>
            {canEdit && (
              <div className="row-actions">
                <button
                  className="secondary"
                  onClick={() =>
                    setDraft({
                      id: site.id,
                      name: site.name,
                      client: site.client,
                      address: site.address,
                      lat: site.lat,
                      lng: site.lng,
                      radiusM: site.radiusM,
                    })
                  }
                >
                  Edit
                </button>
                <button className="secondary" onClick={() => toggleArchive(site)}>
                  {site.archived ? 'Unarchive' : 'Archive'}
                </button>
              </div>
            )}
          </li>
        ))}
        {sites.length === 0 && !draft && (
          <li className="muted">No sites yet — create the first one.</li>
        )}
      </ul>
    </main>
  );
}
