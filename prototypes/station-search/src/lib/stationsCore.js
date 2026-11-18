/**
 * Station discovery domain logic, implemented against
 * docs/architecture/api_contracts.md (§1.1, §1.2, §2, §4.2, §4.3, §4.4).
 *
 * Pure and data-free: every function takes the station records it works on, so
 * the same code runs in the browser (src/lib/stationsApi.js) and under plain
 * Node (scripts/check-oracle.mjs) without a bundler.
 */

export const SERVICE_TYPES = ['SWAPPING', 'CHARGING']

const EARTH_RADIUS_KM = 6371
const toRad = (deg) => (deg * Math.PI) / 180

/** §1.1 Haversine. Full double precision — never rounded in a response. */
export function haversineKm(from, to) {
  const dLat = toRad(to.lat - from.lat)
  const dLng = toRad(to.lng - from.lng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** §1.1 `distance_display`: half-up to 1 decimal, `-0` normalised to `0.0`. */
export function formatDistance(km) {
  const rounded = Math.floor(Math.abs(km) * 10 + 0.5) / 10
  const signed = km < 0 && rounded !== 0 ? -rounded : rounded
  return `${(signed === 0 ? 0 : signed).toFixed(1)} km`
}

/* -------------------------------------------------------------------------- */
/* Validation (§1.2, §2.3) — collects every error, never stops at the first.   */
/* -------------------------------------------------------------------------- */

// §1.2 verbatim: plain decimal only. `1e3`, `+1`, `.5`, `NaN`, `Infinity` and
// any padded value such as ` 21` are NOT_A_NUMBER — a looser client validator
// would accept values the real endpoint rejects. `Number("")` is 0 and
// `parseFloat("21abc")` is 21, so neither may be used either.
const NUMBER_RE = /^-?\d+(\.\d+)?$/

const MESSAGES = {
  REQUIRED: (f) => `${f} là bắt buộc.`,
  EMPTY: (f) => `${f} không được để trống.`,
  NOT_A_NUMBER: (f) => `${f} phải là một số hữu hạn.`,
  OUT_OF_RANGE: (f, extra) => `${f} phải nằm trong ${extra}.`,
  NOT_POSITIVE: (f) => `${f} phải lớn hơn 0.`,
  NOT_BOOLEAN: (f) => `${f} phải là true hoặc false.`,
  NOT_IN_ENUM: (f, extra) => `${f} phải là một trong: ${extra}.`,
  MISSING_PAIR: () => 'lat và lng phải đi cùng nhau.',
}

function detail(field, reason, extra) {
  return { field, reason, message: MESSAGES[reason](field, extra) }
}

const isBlank = (raw) => raw === undefined || raw === null || String(raw) === ''

function readNumber(raw, field, details, { min, max, positive } = {}) {
  if (raw === undefined || raw === null) {
    details.push(detail(field, 'REQUIRED'))
    return null
  }
  const text = String(raw)
  if (text === '') {
    details.push(detail(field, 'EMPTY'))
    return null
  }
  if (!NUMBER_RE.test(text)) {
    details.push(detail(field, 'NOT_A_NUMBER'))
    return null
  }
  const parsed = globalThis.Number(text)
  if (!globalThis.Number.isFinite(parsed)) {
    details.push(detail(field, 'NOT_A_NUMBER'))
    return null
  }
  const value = parsed === 0 ? 0 : parsed // §1.2: `-0` normalises to `0`
  if (positive && value <= 0) {
    details.push(detail(field, 'NOT_POSITIVE'))
    return null
  }
  if (min !== undefined && (value < min || value > max)) {
    details.push(detail(field, 'OUT_OF_RANGE', `[${min}, ${max}]`))
    return null
  }
  return value
}

function readEnum(raw, field, allowed, details) {
  if (raw === undefined || raw === null) {
    details.push(detail(field, 'REQUIRED'))
    return null
  }
  const text = String(raw)
  if (text === '') {
    details.push(detail(field, 'EMPTY'))
    return null
  }
  if (!allowed.includes(text)) {
    details.push(detail(field, 'NOT_IN_ENUM', allowed.join(' | ')))
    return null
  }
  return text
}

function readBoolean(raw, field, details, fallback) {
  if (raw === undefined || raw === null) return fallback
  if (typeof raw === 'boolean') return raw
  const text = String(raw)
  if (text === '') {
    details.push(detail(field, 'EMPTY'))
    return null
  }
  if (text !== 'true' && text !== 'false') {
    details.push(detail(field, 'NOT_BOOLEAN'))
    return null
  }
  return text === 'true'
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function requestId() {
  let out = ''
  for (let i = 0; i < 26; i += 1) out += B32[Math.floor(Math.random() * B32.length)]
  return `req_${out}`
}

function invalidInput(details) {
  return {
    status: 400,
    ok: false,
    body: {
      error: {
        code: 'INVALID_INPUT',
        message: 'Một hoặc nhiều tham số không hợp lệ.',
        details,
      },
      request_id: requestId(),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* §4.2 Booking eligibility — fixed ladder, first match wins.                  */
/* -------------------------------------------------------------------------- */

export function evaluateBooking(station, familyCode) {
  if (!familyCode) return { booking_eligible: null, ineligibility_reason: null }
  if (!station.services.includes('SWAPPING'))
    return { booking_eligible: false, ineligibility_reason: 'CHARGING_ONLY' }
  if (!station.supported_families.includes(familyCode))
    return { booking_eligible: false, ineligibility_reason: 'UNSUPPORTED_FAMILY' }
  if (station.opening_status === 'CLOSED')
    return { booking_eligible: false, ineligibility_reason: 'STATION_CLOSED' }
  if (station.opening_status === 'MAINTENANCE')
    return { booking_eligible: false, ineligibility_reason: 'STATION_MAINTENANCE' }
  const stock = station.available_batteries_by_family?.[familyCode]
  if (stock === undefined || stock < 1)
    return { booking_eligible: false, ineligibility_reason: 'OUT_OF_STOCK' }
  return { booking_eligible: true, ineligibility_reason: null }
}

export function projectStation(station, { familyCode, origin }) {
  const distance = origin ? haversineKm(origin, station.coordinates) : null
  return {
    ...station,
    distance_km: distance,
    distance_display: distance === null ? null : formatDistance(distance),
    family_supported: familyCode ? station.supported_families.includes(familyCode) : null,
    ...evaluateBooking(station, familyCode),
  }
}

/* -------------------------------------------------------------------------- */
/* §4.3 GET /api/v1/stations                                                   */
/* -------------------------------------------------------------------------- */

/**
 * @param {Array} stations the fixture records
 * @param {object} params raw values as a query string would deliver them
 *   (strings, possibly empty — validated, never coerced)
 * @param {string[]} familyCodes allowed `family_code` values
 */
export function searchOver(stations, params, familyCodes) {
  const details = []
  const lat = readNumber(params.lat, 'lat', details, { min: -90, max: 90 })
  const lng = readNumber(params.lng, 'lng', details, { min: -180, max: 180 })
  const serviceType = readEnum(params.service_type, 'service_type', SERVICE_TYPES, details)
  const familyCode = readEnum(params.family_code, 'family_code', familyCodes, details)
  const onlyOpen = readBoolean(params.only_open, 'only_open', details, true)
  // No hidden default radius: absent means every matching station is considered.
  const radiusKm = isBlank(params.radius_km)
    ? null
    : readNumber(params.radius_km, 'radius_km', details, { positive: true })

  if (details.length > 0) return invalidInput(details)

  const origin = { lat, lng }
  const matches = stations
    .filter((s) => s.services.includes(serviceType))
    .filter((s) => s.supported_families.includes(familyCode))
    .filter((s) => (onlyOpen ? s.opening_status === 'OPEN' : true))
    .map((s) => projectStation(s, { familyCode, origin }))
    .filter((s) => (radiusKm === null ? true : s.distance_km <= radiusKm))
    .sort((a, b) =>
      a.distance_km === b.distance_km
        ? a.station_id.localeCompare(b.station_id)
        : a.distance_km - b.distance_km,
    )

  return {
    status: 200,
    ok: true,
    body: {
      query: {
        lat,
        lng,
        service_type: serviceType,
        family_code: familyCode,
        only_open: onlyOpen,
        radius_km: radiusKm,
      },
      total: matches.length,
      stations: matches,
      request_id: requestId(),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* §4.4 GET /api/v1/stations/{station_id}                                      */
/* -------------------------------------------------------------------------- */

export function detailOver(stations, stationId, params, familyCodes) {
  const station = stations.find((s) => s.station_id === stationId)
  if (!station) {
    return {
      status: 404,
      ok: false,
      body: {
        error: {
          code: 'STATION_NOT_FOUND',
          message: 'Không tìm thấy trạm với mã đã cho.',
          details: [],
        },
        request_id: requestId(),
      },
    }
  }

  const details = []
  const hasLat = !isBlank(params.lat)
  const hasLng = !isBlank(params.lng)
  if (hasLat !== hasLng) details.push(detail(hasLat ? 'lng' : 'lat', 'MISSING_PAIR'))

  const lat = hasLat ? readNumber(params.lat, 'lat', details, { min: -90, max: 90 }) : null
  const lng = hasLng ? readNumber(params.lng, 'lng', details, { min: -180, max: 180 }) : null
  const familyCode = isBlank(params.family_code)
    ? null
    : readEnum(params.family_code, 'family_code', familyCodes, details)

  if (details.length > 0) return invalidInput(details)

  const origin = lat !== null && lng !== null ? { lat, lng } : null
  return {
    status: 200,
    ok: true,
    body: {
      query: { lat, lng, family_code: familyCode },
      station: projectStation(station, { familyCode, origin }),
      request_id: requestId(),
    },
  }
}

/**
 * One field, checked with the same rules the request uses, so the form can warn
 * on blur without a second copy of the validation drifting from the contract.
 * Returns a message, or null when the value is acceptable.
 */
export function validateSearchField(field, value, familyCodes = []) {
  const details = []
  if (field === 'lat') readNumber(value, 'lat', details, { min: -90, max: 90 })
  else if (field === 'lng') readNumber(value, 'lng', details, { min: -180, max: 180 })
  else if (field === 'radius_km') {
    if (isBlank(value)) return null // optional: absent means no radius at all
    readNumber(value, 'radius_km', details, { positive: true })
  } else if (field === 'family_code') readEnum(value, 'family_code', familyCodes, details)
  else if (field === 'service_type') readEnum(value, 'service_type', SERVICE_TYPES, details)
  return details[0]?.message ?? null
}

/** Display labels for §4.2 reason codes (ux-writing: say the cause, not the code). */
export const INELIGIBILITY_TEXT = {
  CHARGING_ONLY: 'Chỉ có cổng sạc — không hỗ trợ đặt trước',
  UNSUPPORTED_FAMILY: 'Không hỗ trợ nhóm pin đang chọn',
  STATION_CLOSED: 'Trạm đang đóng cửa',
  STATION_MAINTENANCE: 'Trạm đang bảo trì',
  OUT_OF_STOCK: 'Hết pin khả dụng',
}
