import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { pinColor } from '../../../frontend/src/lib/pinColor.js'
function buildIcon(station, serviceType) {
  const color = pinColor(station, serviceType)
  return L.divIcon({
    className: 'vg-pin',
    html: `<div class="vg-pin__inner"><svg width="58" height="32" viewBox="0 0 58 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M29 32 L21.5 22.5 L36.5 22.5 Z" fill="#ffffff"/>
  <path d="M29 29.5 L23.5 22.5 L34.5 22.5 Z" fill="${color}"/>
  <rect x="1.5" y="1.5" width="55" height="21" rx="5" fill="${color}" stroke="#ffffff" stroke-width="2"/>
  <text x="29" y="16.3" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
        font-size="12" font-weight="600" letter-spacing="0.2" fill="#ffffff">${station.station_id}</text>
</svg></div>`,
    iconSize: [58, 32],
    iconAnchor: [29, 32],
  })
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true

const originIcon = L.divIcon({
  className: 'vg-origin',
  html: '<div class="relative"><div class="vg-origin__ring"></div><div class="vg-origin__dot"></div></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

export default function LeafletStationMap({ query, stations, selectedId, hoveredId, onSelect, onHover, onError }) {
  const mapElRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(new Map())
  const overlaysRef = useRef([])
  const boundsRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  /* -------------------------------------------------------------- map init */

  useEffect(() => {
    const el = mapElRef.current
    if (!el || mapRef.current) return undefined

    const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(
      [21.012, 105.84],
      13,
    )
    let tileErrors = 0
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    })
      .on('tileerror', () => {
        tileErrors += 1
        if (tileErrors > 10) onError()
      })
      .addTo(map)

    mapRef.current = map
    setMapReady(true)

    // A resized container keeps the same stations in view, not the same centre.
    const observer = new ResizeObserver(() => {
      map.invalidateSize()
      if (boundsRef.current) map.fitBounds(boundsRef.current, { animate: false })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      markersRef.current.clear()
      overlaysRef.current = []
      setMapReady(false)
    }
  }, [onError])

  // Markers follow the result set exactly: an error or an empty result clears them.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current.clear()
    overlaysRef.current.forEach((layer) => layer.remove())
    overlaysRef.current = []

    if (!query) return

    const origin = L.latLng(query.lat, query.lng)
    const originMarker = L.marker(origin, { icon: originIcon, zIndexOffset: 500 })
      .addTo(map)
      .bindTooltip('Điểm xuất phát', { direction: 'top', offset: [0, -10] })
    overlaysRef.current.push(originMarker)

    if (query.radius_km) {
      const circle = L.circle(origin, {
        radius: query.radius_km * 1000,
        color: '#059669',
        weight: 1,
        dashArray: '4 4',
        fillColor: '#059669',
        fillOpacity: 0.04,
      }).addTo(map)
      overlaysRef.current.push(circle)
    }

    stations.forEach((station) => {
      const marker = L.marker([station.coordinates.lat, station.coordinates.lng], {
        icon: buildIcon(station, query.service_type),
        keyboard: false,
        title: `${station.station_id} — ${station.name}`,
      })
        .addTo(map)
        .on('click', () => {
          onSelect(station.station_id)
        })
        .on('mouseover', () => onHover(station.station_id))
        .on('mouseout', () => onHover(null))
      markersRef.current.set(station.station_id, marker)
    })

    const points = [origin, ...stations.map((s) => L.latLng(s.coordinates.lat, s.coordinates.lng))]
    if (points.length > 1) {
      boundsRef.current = L.latLngBounds(points).pad(0.22)
      map.fitBounds(boundsRef.current, { animate: false })
    } else {
      boundsRef.current = null
      map.setView(origin, 14, { animate: false })
    }
  }, [mapReady, query, stations, onSelect, onHover])

  // Hover or selection in either direction restyles the matching pin. Toggling a
  // class keeps the same element, so the pin scales instead of being swapped.
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const el = marker.getElement()
      if (!el) return
      el.classList.toggle('vg-pin--active', id === selectedId || id === hoveredId)
      el.classList.toggle('vg-pin--selected', id === selectedId)
      marker.setZIndexOffset(id === selectedId ? 500 : id === hoveredId ? 400 : 0)
    })
  }, [selectedId, hoveredId, stations])

  // Selecting from the map brings the matching card into view, and vice versa.
  useEffect(() => {
    if (!selectedId) return
    const reduce = prefersReducedMotion()
    const marker = markersRef.current.get(selectedId)
    const map = mapRef.current
    if (!marker || !map) return
    const zoom = Math.max(map.getZoom(), 14)
    if (reduce) map.setView(marker.getLatLng(), zoom, { animate: false })
    else map.flyTo(marker.getLatLng(), zoom, { duration: 0.55 })
  }, [selectedId])

  return <div ref={mapElRef} className="h-full w-full" />
}
