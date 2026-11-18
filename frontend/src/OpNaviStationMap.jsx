import { useEffect, useRef, useState } from 'react'
import { loadOpNavi } from './lib/opNavi.js'
import { pinColor } from './lib/pinColor.js'
import { SAMPLE_ORIGINS } from './lib/searchOptions.js'

// AMap positions are [longitude, latitude]. FastAPI uses named coordinates.
const position = ({ lat, lng }) => [lng, lat]

export default function OpNaviStationMap({ query, stations, selectedId, hoveredId, onSelect, onHover, onError }) {
  const container = useRef(null)
  const pins = useRef(new Map())
  const [map, setMap] = useState(null)

  useEffect(() => {
    let active = true
    let instance
    let timer
    const unavailable = () => {
      if (active) onError('OpNavi chưa tải được bản đồ. Kiểm tra quyền hiển thị bản đồ và vùng của Web/JS key.')
    }
    loadOpNavi().then(sdk => {
      if (!active) return
      instance = new sdk.Map(container.current, {
        zoom: 13, center: position(SAMPLE_ORIGINS[0]), viewMode: '2D', showOversea: true,
      })
      timer = setTimeout(unavailable, 20000)
      instance.on('complete', () => {
        clearTimeout(timer)
        if (active) setMap(instance)
      })
      instance.on('error', unavailable)
    }).catch(error => {
      if (active) onError(error.message)
    })
    return () => {
      active = false
      clearTimeout(timer)
      instance?.destroy()
    }
  }, [onError])

  useEffect(() => {
    if (!map || !query) return
    const { Marker, Circle } = window.AMap
    const dot = document.createElement('span')
    dot.className = 'vg-origin__dot block'
    const origin = new Marker({ position: position(query), content: dot, anchor: 'center', title: 'Điểm xuất phát', zIndex: 1 })
    const overlays = [origin]
    if (query.radius_km) overlays.push(new Circle({
      center: position(query), radius: query.radius_km * 1000, strokeColor: '#059669',
      strokeWeight: 1, fillColor: '#059669', fillOpacity: 0.04, bubble: true, zIndex: 0,
    }))

    for (const station of stations) {
      const id = station.station_id
      const label = document.createElement('button')
      label.type = 'button'
      label.title = id + ' — ' + station.name
      label.setAttribute('aria-label', label.title)
      label.className = 'vg-pin__inner num rounded border-2 border-white px-2 py-1 text-xs font-semibold text-white'
      label.textContent = id
      label.style.backgroundColor = pinColor(station, query.service_type)
      label.onclick = () => onSelect(id)
      label.onpointerenter = label.onfocus = () => onHover(id)
      label.onpointerleave = label.onblur = () => onHover(null)
      const wrapper = document.createElement('div')
      wrapper.append(label)
      const marker = new Marker({ position: position(station.coordinates), content: wrapper, anchor: 'bottom-center', title: label.title })
      marker.on('click', () => onSelect(id))
      overlays.push(marker)
      pins.current.set(id, { marker, wrapper })
    }

    map.add(overlays)
    const markers = [origin, ...Array.from(pins.current.values(), pin => pin.marker)]
    const fit = () => {
      if (!container.current?.clientHeight) return
      if (stations.length) map.setFitView(markers, true, [42, 42, 42, 42], 16)
      else map.setZoomAndCenter(14, position(query))
    }
    const observer = new ResizeObserver(fit)
    observer.observe(container.current)
    fit()
    return () => {
      observer.disconnect()
      if (container.current) map.remove(overlays)
      pins.current.clear()
    }
  }, [map, query, stations, onSelect, onHover])

  useEffect(() => {
    for (const [id, { marker, wrapper }] of pins.current) {
      wrapper.classList.toggle('vg-pin--selected', id === selectedId)
      wrapper.classList.toggle('vg-pin--active', id === selectedId || id === hoveredId)
      marker.setzIndex(id === selectedId ? 12 : id === hoveredId ? 11 : 10)
    }
  }, [map, selectedId, hoveredId, stations])

  useEffect(() => {
    const pin = pins.current.get(selectedId)
    if (pin) map.setCenter(pin.marker.getPosition())
  }, [map, selectedId])

  return <div ref={container} className="h-full w-full" />
}
