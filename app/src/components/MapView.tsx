import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Circle, Tooltip, useMap } from 'react-leaflet'

export type MapPin = {
  id: string
  lat: number
  lng: number
  label?: string
  /** 'me' = customer/user, 'crew' = crew member, 'target' = job location */
  kind: 'me' | 'crew' | 'target'
  selected?: boolean
}

const COLORS = { me: '#3b82f6', crew: '#f5b72f', target: '#22c55e' }

function FitBounds({ pins }: { pins: MapPin[] }) {
  const map = useMap()
  const key = pins.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|')
  useEffect(() => {
    if (pins.length === 0) return
    if (pins.length === 1) {
      map.setView([pins[0].lat, pins[0].lng], 14)
    } else {
      map.fitBounds(pins.map((p) => [p.lat, p.lng] as [number, number]), { padding: [40, 40], maxZoom: 15 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map])
  return null
}

/**
 * Dark OpenStreetMap view with simple circle pins.
 * `radiusKm` draws a coverage circle around the first 'me' pin.
 */
export function MapView({
  pins,
  radiusKm,
  height = 260,
  onPinClick,
}: {
  pins: MapPin[]
  radiusKm?: number
  height?: number
  onPinClick?: (id: string) => void
}) {
  const me = pins.find((p) => p.kind === 'me')
  const center: [number, number] = pins[0] ? [pins[0].lat, pins[0].lng] : [12.9716, 77.5946] // Bengaluru
  return (
    <div className="overflow-hidden rounded-2xl border border-line" style={{ height }}>
      <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }} zoomControl={false} attributionControl>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
        />
        {me && radiusKm && (
          <Circle
            center={[me.lat, me.lng]}
            radius={radiusKm * 1000}
            pathOptions={{ color: '#f5b72f', weight: 1, dashArray: '6 4', fillOpacity: 0.04 }}
          />
        )}
        {pins.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={p.selected ? 11 : p.kind === 'me' ? 8 : 9}
            pathOptions={{
              color: p.selected ? '#fff' : COLORS[p.kind],
              weight: p.selected ? 3 : 2,
              fillColor: COLORS[p.kind],
              fillOpacity: 0.9,
            }}
            eventHandlers={onPinClick ? { click: () => onPinClick(p.id) } : undefined}
          >
            {p.label && <Tooltip direction="top" offset={[0, -8]}>{p.label}</Tooltip>}
          </CircleMarker>
        ))}
        <FitBounds pins={pins} />
      </MapContainer>
    </div>
  )
}
