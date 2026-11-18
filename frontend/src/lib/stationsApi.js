import { INELIGIBILITY_TEXT, SERVICE_TYPES } from './formFields.js'
import { FAMILY_CODES } from './searchOptions.js'

const apiBase = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api/v1').replace(/\/+$/, '')

function isCoordinate(value, limit) {
  return Number.isFinite(value) && Math.abs(value) <= limit
}

function isEnumList(values, allowed) {
  return Array.isArray(values) && values.length > 0 && values.every(value => allowed.includes(value))
}

function isFamilyCountMap(counts) {
  if (counts === null || typeof counts !== 'object' || Array.isArray(counts)) return false
  return Object.entries(counts).every(([family, count]) =>
    FAMILY_CODES.includes(family) && Number.isInteger(count) && count >= 0)
}

function isStationDetail(station, expectedId) {
  if (station?.station_id !== expectedId) return false
  const { coordinates, booking_eligible, ineligibility_reason, distance_display } = station
  return typeof station.name === 'string' && station.name.length > 0
    && typeof station.area_label === 'string' && station.area_label.length > 0
    && isCoordinate(coordinates?.lat, 90) && isCoordinate(coordinates?.lng, 180)
    && ['OPEN', 'CLOSED', 'MAINTENANCE'].includes(station.opening_status)
    && isEnumList(station.services, SERVICE_TYPES)
    && isEnumList(station.supported_families, FAMILY_CODES)
    && isFamilyCountMap(station.available_batteries_by_family)
    && isFamilyCountMap(station.available_charging_ports_by_family)
    && (distance_display === null || typeof distance_display === 'string')
    && (booking_eligible === null || typeof booking_eligible === 'boolean')
    && (ineligibility_reason === null ||
      (typeof ineligibility_reason === 'string' && Object.hasOwn(INELIGIBILITY_TEXT, ineligibility_reason)))
}

async function request(path, params, { signal } = {}) {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (value != null) query.set(name, String(value))
  }
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const timeout = setTimeout(cancel, 15000)
  try {
    const response = await fetch(`${apiBase}/stations${path}?${query}`, { signal: controller.signal })
    const body = await response.json().catch((error) => {
      if (controller.signal.aborted) throw error
      return null
    })
    if (!response.ok) {
      const error = body?.error ?? { message: `Dịch vụ trả lỗi HTTP ${response.status}.` }
      return { ok: false, body: { error } }
    }
    const valid = path
      ? isStationDetail(body?.station, decodeURIComponent(path.slice(1)))
      : Array.isArray(body?.stations) && body.query && body.total === body.stations.length
    if (!valid) {
      throw new Error('Phản hồi dịch vụ trạm không hợp lệ.')
    }
    return { ok: true, body }
  } catch (error) {
    if (signal?.aborted) throw error
    if (controller.signal.aborted) throw new Error('Hết thời gian chờ dịch vụ trạm.')
    if (error instanceof TypeError) throw new Error('Hãy kiểm tra kết nối và thử lại.')
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
  }
}

export function searchStations(params, options) {
  return request('', { ...params, radius_km: params.radius_km === '' ? undefined : params.radius_km }, options)
}

export function getStationDetail(stationId, params = {}, options) {
  return request('/' + encodeURIComponent(stationId), params, options)
}
