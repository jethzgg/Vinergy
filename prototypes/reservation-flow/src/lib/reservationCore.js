/**
 * Vinergy — Reservation domain logic (WBS 2.1.2 prototype, aligned with API v2.2 / WBS 2.1.3).
 *
 * Pure and framework-free, implementing:
 *   - docs/architecture/api_contracts.md §1.3, §2, §3, §4.2, §6.1–§6.12
 *   - docs/requirements/SRS.md BR-01…BR-10, FR-06…FR-09, FR-12
 *   - docs/requirements/Acceptance_Examples_and_Sample_Data.md AE-08…AE-18, AE-23f
 *
 * Runs identically in the browser (src/lib/reservationApi.js) and under plain
 * Node (scripts/check-oracle.mjs).
 */

const EARTH_RADIUS_KM = 6371
const toRad = (deg) => (deg * Math.PI) / 180

export const DEMO_USERS = ['USER-A', 'USER-B']
export const FAMILY_CODES = ['FAM_A', 'FAM_B']
export const RESERVATION_STATUSES = ['ACTIVE', 'CANCELLED', 'EXPIRED']

// Configurable simulation defaults (SRS §8 / API v2.1: draft 5m, hold 15m).
export const DEFAULT_CONFIG = {
  draftTtlMinutes: 5,
  holdMinutes: 15,
}

export const INELIGIBILITY_TEXT = {
  CHARGING_ONLY: 'Chỉ có cổng sạc — không hỗ trợ đặt trước',
  UNSUPPORTED_FAMILY: 'Không hỗ trợ nhóm pin đang chọn',
  STATION_CLOSED: 'Trạm đang đóng cửa',
  STATION_MAINTENANCE: 'Trạm đang bảo trì',
  OUT_OF_STOCK: 'Hết pin khả dụng',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const STATION_ID_RE = /^[A-Z0-9-]{1,32}$/
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,100}$/

export function haversineKm(from, to) {
  const dLat = toRad(to.lat - from.lat)
  const dLng = toRad(to.lng - from.lng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function formatDistance(km) {
  const rounded = Math.floor(Math.abs(km) * 10 + 0.5) / 10
  const signed = km < 0 && rounded !== 0 ? -rounded : rounded
  return `${(signed === 0 ? 0 : signed).toFixed(1)} km`
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function makeRequestId() {
  let out = ''
  for (let i = 0; i < 26; i += 1) {
    out += B32[Math.floor(Math.random() * B32.length)]
  }
  return `req_${out}`
}

/** Generate standard lowercase UUID v4 (§6.1, §6.2). */
export function makeUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().toLowerCase()
  }
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16) || hex()
  })
}

export function errorResponse(status, code, message, details = [], headers = {}) {
  return {
    status,
    ok: false,
    headers,
    body: {
      error: { code, message, details },
      request_id: makeRequestId(),
    },
  }
}

/** §4.2 Booking eligibility ladder — fixed order, first match wins. */
export function evaluateBooking(station, familyCode) {
  if (!familyCode) return { booking_eligible: null, ineligibility_reason: null }
  if (!station.services.includes('SWAPPING')) {
    return { booking_eligible: false, ineligibility_reason: 'CHARGING_ONLY' }
  }
  if (!station.supported_families.includes(familyCode)) {
    return { booking_eligible: false, ineligibility_reason: 'UNSUPPORTED_FAMILY' }
  }
  if (station.opening_status === 'CLOSED') {
    return { booking_eligible: false, ineligibility_reason: 'STATION_CLOSED' }
  }
  if (station.opening_status === 'MAINTENANCE') {
    return { booking_eligible: false, ineligibility_reason: 'STATION_MAINTENANCE' }
  }
  const stock = station.available_batteries_by_family?.[familyCode]
  if (stock === undefined || stock < 1) {
    return { booking_eligible: false, ineligibility_reason: 'OUT_OF_STOCK' }
  }
  return { booking_eligible: true, ineligibility_reason: null }
}

/** §6.2 Validate quantity: required JSON number, integer strictly equal to 1 (BR-05, AE-08). */
function validateQuantity(value, details) {
  if (value === undefined) {
    details.push({
      field: 'quantity',
      reason: 'REQUIRED',
      message: 'quantity là bắt buộc.',
    })
    return false
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    details.push({
      field: 'quantity',
      reason: 'NOT_A_NUMBER',
      message: 'quantity phải là kiểu số JSON.',
    })
    return false
  }
  if (!Number.isInteger(value) || value !== 1) {
    details.push({
      field: 'quantity',
      reason: 'MUST_BE_ONE',
      message: 'quantity bắt buộc là số nguyên đúng bằng 1 (BR-05).',
    })
    return false
  }
  return true
}

function validateFamilyCode(value, details) {
  if (value === undefined) {
    details.push({ field: 'family_code', reason: 'REQUIRED', message: 'family_code là bắt buộc.' })
    return false
  }
  if (typeof value !== 'string') {
    details.push({ field: 'family_code', reason: 'INVALID_FORMAT', message: 'family_code phải là chuỗi.' })
    return false
  }
  if (!FAMILY_CODES.includes(value)) {
    details.push({
      field: 'family_code',
      reason: 'NOT_IN_ENUM',
      message: 'family_code phải là FAM_A hoặc FAM_B.',
    })
    return false
  }
  return true
}

function validateUnknownFields(obj, allowedKeys, details, prefix = '') {
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      const fieldName = prefix ? `${prefix}.${key}` : key
      details.push({
        field: fieldName,
        reason: 'UNKNOWN_FIELD',
        message: `Trường ${fieldName} không được hỗ trợ trong hợp đồng API v2.1.`,
      })
    }
  }
}

function validateSession(session, nowMs) {
  if (!session || !session.demo_user) {
    return errorResponse(401, 'SESSION_REQUIRED', 'Vui lòng chọn phiên người dùng demo để tiếp tục.')
  }
  if (session.expired || (session.expires_at && nowMs >= Date.parse(session.expires_at))) {
    return errorResponse(
      401,
      'SESSION_EXPIRED',
      'Phiên demo đã hết hạn. Vui lòng chọn lại người dùng demo để tiếp tục.',
    )
  }
  return null
}

