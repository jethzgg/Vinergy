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

/** Create an isolated mutable store from the seed fixture. */
export function createReservationStore(fixture, options = {}) {
  const startTimeMs = options.startTimeMs ?? Date.parse('2026-11-25T18:30:00Z')
  const config = { ...DEFAULT_CONFIG, ...(options.config ?? {}) }
  return {
    stations: structuredClone(fixture.stations),
    families: structuredClone(fixture.battery_families),
    origins: structuredClone(fixture.origins),
    // Internal records hold owner_id; API projections omit user_id (§6.3, §6.6, §6.12 #6).
    drafts: new Map(),
    reservations: new Map(),
    // Key: `${userId}::CONFIRM_RESERVATION::${idempotencyKey}`
    idempotency: new Map(),
    nowMs: startTimeMs,
    config,
  }
}

export function getNowIso(store) {
  return new Date(store.nowMs).toISOString()
}

export function advanceClock(store, deltaSeconds) {
  store.nowMs += deltaSeconds * 1000
  return getNowIso(store)
}

export function setHoldMinutes(store, minutes) {
  if (typeof minutes === 'number' && Number.isInteger(minutes) && minutes > 0) {
    store.config.holdMinutes = minutes
  }
  return store.config.holdMinutes
}

/** Project internal draft record to §6.3 API shape (status & available_batteries computed on read). */
function projectDraft(store, record, distanceKm = null) {
  const station = store.stations.find((s) => s.station_id === record.station_id)
  const status = record.reservation_id
    ? 'USED'
    : store.nowMs >= Date.parse(record.expires_at)
      ? 'EXPIRED'
      : 'OPEN'
  const availableBatteries = station?.available_batteries_by_family?.[record.family_code] ?? null

  return {
    draft_id: record.draft_id,
    status,
    station: {
      station_id: record.station_id,
      name: station?.name ?? record.station_name,
      area_label: station?.area_label ?? record.area_label,
      coordinates: structuredClone(station?.coordinates ?? record.coordinates),
      distance_km: distanceKm,
      distance_display: distanceKm === null ? null : formatDistance(distanceKm),
    },
    family_code: record.family_code,
    quantity: record.quantity,
    available_batteries: availableBatteries,
    hold_minutes: record.hold_minutes,
    created_at: record.created_at,
    expires_at: record.expires_at,
    reservation_id: record.reservation_id,
  }
}

/** Project internal reservation record to §6.6 API shape (nested station, no user_id). */
function projectReservation(record) {
  return {
    reservation_id: record.reservation_id,
    status: record.status,
    draft_id: record.draft_id,
    station: structuredClone(record.station),
    family_code: record.family_code,
    quantity: record.quantity,
    created_at: record.created_at,
    expires_at: record.expires_at,
    cancelled_at: record.cancelled_at,
    expired_at: record.expired_at,
  }
}

/**
 * BR-09: Reconcile an ACTIVE reservation whose expires_at <= now.
 * Releases battery stock exactly once.
 */
export function reconcileReservationExpiry(store, record) {
  if (!record || record.status !== 'ACTIVE') return false
  if (store.nowMs < Date.parse(record.expires_at)) return false

  const station = store.stations.find((s) => s.station_id === record.station.station_id)
  if (station && typeof station.available_batteries_by_family?.[record.family_code] === 'number') {
    station.available_batteries_by_family[record.family_code] += 1
  }
  record.status = 'EXPIRED'
  record.expired_at = getNowIso(store)
  return true
}

/** Background expiry sweep (AE-16c). Returns count of expired orders released. */
export function sweepExpiredReservations(store) {
  let released = 0
  for (const record of store.reservations.values()) {
    if (reconcileReservationExpiry(store, record)) released += 1
  }
  return released
}

/** Canonical request hash over all 4 v2.1 confirmation fields (§6.12 #2). */
function buildRequestHash({ draft_id, station_id, family_code, quantity }) {
  return JSON.stringify({ draft_id, family_code, quantity, station_id })
}

/* -------------------------------------------------------------------------- */
/* POST /api/v1/reservation-drafts (§6.4)                                     */
/* -------------------------------------------------------------------------- */

const CREATE_DRAFT_FIELDS = new Set(['family_code', 'quantity', 'station_id', 'nearest'])
const NEAREST_FIELDS = new Set(['lat', 'lng', 'radius_km'])

export function createDraft(store, session, body) {
  const authErr = validateSession(session, store.nowMs)
  if (authErr) return authErr

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse(400, 'INVALID_INPUT', 'Nội dung yêu cầu không hợp lệ.', [])
  }

  const details = []
  validateFamilyCode(body.family_code, details)
  validateQuantity(body.quantity, details)

  const hasStationId = body.station_id !== undefined
  const hasNearest = body.nearest !== undefined

  if (!hasStationId && !hasNearest) {
    details.push({
      field: 'station_id',
      reason: 'ONE_OF_REQUIRED',
      message: 'Cần truyền một trong hai: station_id hoặc nearest.',
    })
  } else if (hasStationId && hasNearest) {
    details.push({
      field: 'nearest',
      reason: 'MUTUALLY_EXCLUSIVE',
      message: 'Không được truyền đồng thời cả station_id và nearest.',
    })
  }

  if (hasStationId && !hasNearest) {
    if (typeof body.station_id !== 'string' || !STATION_ID_RE.test(body.station_id)) {
      details.push({
        field: 'station_id',
        reason: 'INVALID_FORMAT',
        message: 'station_id không đúng định dạng.',
      })
    }
  }

  if (hasNearest && !hasStationId) {
    if (!body.nearest || typeof body.nearest !== 'object' || Array.isArray(body.nearest)) {
      details.push({
        field: 'nearest',
        reason: 'INVALID_FORMAT',
        message: 'nearest phải là đối tượng chứa lat, lng và radius_km (tùy chọn).',
      })
    } else {
      const { lat, lng, radius_km } = body.nearest
      if (lat === undefined) {
        details.push({ field: 'nearest.lat', reason: 'REQUIRED', message: 'nearest.lat là bắt buộc.' })
      } else if (typeof lat !== 'number' || !Number.isFinite(lat)) {
        details.push({ field: 'nearest.lat', reason: 'NOT_A_NUMBER', message: 'nearest.lat phải là số hữu hạn.' })
      } else if (lat < -90 || lat > 90) {
        details.push({ field: 'nearest.lat', reason: 'OUT_OF_RANGE', message: 'nearest.lat phải nằm trong [-90, 90].' })
      }

      if (lng === undefined) {
        details.push({ field: 'nearest.lng', reason: 'REQUIRED', message: 'nearest.lng là bắt buộc.' })
      } else if (typeof lng !== 'number' || !Number.isFinite(lng)) {
        details.push({ field: 'nearest.lng', reason: 'NOT_A_NUMBER', message: 'nearest.lng phải là số hữu hạn.' })
      } else if (lng < -180 || lng > 180) {
        details.push({ field: 'nearest.lng', reason: 'OUT_OF_RANGE', message: 'nearest.lng phải nằm trong [-180, 180].' })
      }

      if (radius_km !== undefined && radius_km !== null) {
        if (typeof radius_km !== 'number' || !Number.isFinite(radius_km)) {
          details.push({ field: 'nearest.radius_km', reason: 'NOT_A_NUMBER', message: 'nearest.radius_km phải là số.' })
        } else if (radius_km <= 0) {
          details.push({ field: 'nearest.radius_km', reason: 'NOT_POSITIVE', message: 'nearest.radius_km phải lớn hơn 0.' })
        }
      }

      validateUnknownFields(body.nearest, NEAREST_FIELDS, details, 'nearest')
    }
  }

  validateUnknownFields(body, CREATE_DRAFT_FIELDS, details)

  if (details.length > 0) {
    return errorResponse(400, 'INVALID_INPUT', 'Một hoặc nhiều tham số không hợp lệ.', details)
  }

  let selectedStation = null
  let distanceKm = null

  if (hasNearest) {
    const origin = { lat: body.nearest.lat, lng: body.nearest.lng }
    const radius = body.nearest.radius_km ?? null
    const candidates = store.stations
      .filter((s) => evaluateBooking(s, body.family_code).booking_eligible)
      .map((s) => ({ station: s, distance_km: haversineKm(origin, s.coordinates) }))
      .filter((c) => (radius === null ? true : c.distance_km <= radius))
      .sort((a, b) =>
        a.distance_km === b.distance_km
          ? a.station.station_id.localeCompare(b.station.station_id)
          : a.distance_km - b.distance_km,
      )

    if (candidates.length === 0) {
      return errorResponse(
        409,
        'NO_ELIGIBLE_STATION',
        radius !== null
          ? `Không có trạm đổi pin ${body.family_code} nào đủ điều kiện trong bán kính ${radius} km.`
          : `Hiện không có trạm đổi pin ${body.family_code} nào còn pin khả dụng.`,
      )
    }

    selectedStation = candidates[0].station
    distanceKm = candidates[0].distance_km
  } else {
    selectedStation = store.stations.find((s) => s.station_id === body.station_id) ?? null
    if (!selectedStation) {
      return errorResponse(404, 'STATION_NOT_FOUND', 'Không tìm thấy trạm với mã đã cho.')
    }
    const verdict = evaluateBooking(selectedStation, body.family_code)
    if (!verdict.booking_eligible) {
      return errorResponse(
        409,
        'STATION_NOT_ELIGIBLE',
        INELIGIBILITY_TEXT[verdict.ineligibility_reason] ?? 'Trạm không đủ điều kiện đặt pin.',
        [
          {
            field: 'station_id',
            reason: verdict.ineligibility_reason,
            message: INELIGIBILITY_TEXT[verdict.ineligibility_reason],
          },
        ],
      )
    }
  }

  const createdAt = getNowIso(store)
  const expiresAt = new Date(store.nowMs + store.config.draftTtlMinutes * 60 * 1000).toISOString()

  const record = {
    draft_id: makeUuid(),
    owner_id: session.demo_user,
    station_id: selectedStation.station_id,
    station_name: selectedStation.name,
    area_label: selectedStation.area_label,
    coordinates: { ...selectedStation.coordinates },
    family_code: body.family_code,
    quantity: 1,
    hold_minutes: store.config.holdMinutes,
    created_at: createdAt,
    expires_at: expiresAt,
    reservation_id: null,
  }

  // BR-06 / AE-09: Draft never holds stock.
  store.drafts.set(record.draft_id, record)

  return {
    status: 201,
    ok: true,
    headers: { 'Cache-Control': 'no-store' },
    body: {
      is_simulated: true,
      draft: projectDraft(store, record, distanceKm),
      request_id: makeRequestId(),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* GET /api/v1/reservation-drafts/{draft_id} (§6.5)                           */
/* -------------------------------------------------------------------------- */

export function getDraftDetail(store, session, draftId) {
  const authErr = validateSession(session, store.nowMs)
  if (authErr) return authErr

  if (typeof draftId !== 'string' || !UUID_RE.test(draftId)) {
    return errorResponse(400, 'INVALID_INPUT', 'Mã bản nháp không đúng định dạng UUID.', [
      { field: 'draft_id', reason: 'INVALID_FORMAT', message: 'draft_id phải là UUID chữ thường.' },
    ])
  }

  const record = store.drafts.get(draftId)
  if (!record || record.owner_id !== session.demo_user) {
    return errorResponse(404, 'DRAFT_NOT_FOUND', 'Không tìm thấy bản nháp trong phiên hiện tại.')
  }

  return {
    status: 200,
    ok: true,
    headers: { 'Cache-Control': 'no-store' },
    body: {
      is_simulated: true,
      draft: projectDraft(store, record),
      request_id: makeRequestId(),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* POST /api/v1/reservations (§6.7)                                           */
/* -------------------------------------------------------------------------- */

const CONFIRM_FIELDS = new Set(['draft_id', 'station_id', 'family_code', 'quantity'])

export function confirmReservation(store, session, body, idempotencyKey) {
  const authErr = validateSession(session, store.nowMs)
  if (authErr) return authErr

  const details = []
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    details.push({
      field: 'Idempotency-Key',
      reason: 'REQUIRED',
      message: 'Thiếu header Idempotency-Key cho thao tác xác nhận.',
    })
  } else if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    details.push({
      field: 'Idempotency-Key',
      reason: 'INVALID_FORMAT',
      message: 'Idempotency-Key phải dài 16–100 ký tự (chữ, số, -, _).',
    })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse(400, 'INVALID_INPUT', 'Nội dung xác nhận không hợp lệ.', details)
  }

  if (body.draft_id === undefined) {
    details.push({ field: 'draft_id', reason: 'REQUIRED', message: 'draft_id là bắt buộc.' })
  } else if (typeof body.draft_id !== 'string' || !UUID_RE.test(body.draft_id)) {
    details.push({
      field: 'draft_id',
      reason: 'INVALID_FORMAT',
      message: 'draft_id phải là UUID chữ thường.',
    })
  }

  if (body.station_id === undefined) {
    details.push({ field: 'station_id', reason: 'REQUIRED', message: 'station_id là bắt buộc.' })
  } else if (typeof body.station_id !== 'string' || !STATION_ID_RE.test(body.station_id)) {
    details.push({
      field: 'station_id',
      reason: 'INVALID_FORMAT',
      message: 'station_id không đúng định dạng.',
    })
  }

  validateFamilyCode(body.family_code, details)
  validateQuantity(body.quantity, details)
  validateUnknownFields(body, CONFIRM_FIELDS, details)

  if (details.length > 0) {
    return errorResponse(400, 'INVALID_INPUT', 'Thông tin xác nhận đặt pin chưa hợp lệ.', details)
  }

  const idemScopeKey = `${session.demo_user}::CONFIRM_RESERVATION::${idempotencyKey}`
  const requestHash = buildRequestHash(body)

  // §6.7 Step 1–2 (BR-08): Check idempotency FIRST before draft expiry or current station conditions.
  const existingIdem = store.idempotency.get(idemScopeKey)
  if (existingIdem) {
    if (existingIdem.request_hash !== requestHash) {
      return errorResponse(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'Khóa chống xử lý lặp đã được sử dụng cho một nội dung xác nhận khác.',
      )
    }
    if (existingIdem.in_progress) {
      return errorResponse(
        409,
        'REQUEST_IN_PROGRESS',
        'Yêu cầu xác nhận cùng khóa đang được máy chủ xử lý. Vui lòng đối soát lại sau giây lát.',
        [],
        { 'Retry-After': '1' },
      )
    }
    const existingOrder = store.reservations.get(existingIdem.reservation_id)
    if (existingOrder) {
      reconcileReservationExpiry(store, existingOrder)
      return {
        status: 200,
        ok: true,
        headers: { 'Idempotent-Replayed': 'true', 'Cache-Control': 'no-store' },
        body: {
          is_simulated: true,
          reservation: projectReservation(existingOrder),
          request_id: makeRequestId(),
        },
      }
    }
  }

  // §6.7 Step 3: Draft exists and belongs to current session user.
  const draft = store.drafts.get(body.draft_id)
  if (!draft || draft.owner_id !== session.demo_user) {
    return errorResponse(404, 'DRAFT_NOT_FOUND', 'Không tìm thấy bản nháp trong phiên hiện tại.')
  }

  // §6.7 Step 4: Used draft with a NEW idempotency key returns conflict (AE-17).
  if (draft.reservation_id) {
    return errorResponse(
      409,
      'DRAFT_ALREADY_USED',
      'Bản nháp này đã được sử dụng để tạo đơn đặt pin trước đó.',
    )
  }

  // §6.7 Step 5: Body mismatches draft station_id / family_code / quantity -> DRAFT_STALE (CONTENT_MISMATCH).
  if (
    body.station_id !== draft.station_id ||
    body.family_code !== draft.family_code ||
    body.quantity !== draft.quantity
  ) {
    return errorResponse(
      409,
      'DRAFT_STALE',
      'Nội dung xác nhận không khớp với bản nháp ban đầu. Vui lòng tạo bản nháp mới.',
      [
        {
          field: 'draft_id',
          reason: 'CONTENT_MISMATCH',
          message: 'station_id, family_code hoặc quantity không khớp với bản nháp.',
        },
      ],
    )
  }

  // §6.7 Step 6: Draft expired -> DRAFT_STALE (DRAFT_EXPIRED).
  if (store.nowMs >= Date.parse(draft.expires_at)) {
    return errorResponse(
      409,
      'DRAFT_STALE',
      'Bản nháp đã hết hiệu lực. Vui lòng tạo bản nháp mới để kiểm tra lại tồn kho.',
      [
        {
          field: 'draft_id',
          reason: 'DRAFT_EXPIRED',
          message: 'Bản nháp đã quá thời hạn xác nhận.',
        },
      ],
    )
  }

  // §6.7 Step 7 (BR-07): Atomic re-check of station status, service, family and stock >= 1.
  const station = store.stations.find((s) => s.station_id === draft.station_id)
  if (!station) {
    return errorResponse(404, 'STATION_NOT_FOUND', 'Không tìm thấy trạm.')
  }
  const verdict = evaluateBooking(station, draft.family_code)
  if (!verdict.booking_eligible) {
    return errorResponse(
      409,
      'STATION_NOT_ELIGIBLE',
      verdict.ineligibility_reason === 'OUT_OF_STOCK'
        ? `Trạm đã hết pin ${draft.family_code} khả dụng.`
        : INELIGIBILITY_TEXT[verdict.ineligibility_reason],
      [
        {
          field: 'station_id',
          reason: verdict.ineligibility_reason,
          message:
            verdict.ineligibility_reason === 'OUT_OF_STOCK'
              ? `Trạm đã hết pin ${draft.family_code} khả dụng.`
              : INELIGIBILITY_TEXT[verdict.ineligibility_reason],
        },
      ],
    )
  }

  // §6.7 Step 8: Atomic commit — decrement stock by 1, mark draft USED, create ACTIVE order.
  station.available_batteries_by_family[draft.family_code] -= 1
  const createdAt = getNowIso(store)
  const expiresAt = new Date(store.nowMs + draft.hold_minutes * 60 * 1000).toISOString()

  const record = {
    reservation_id: makeUuid(),
    owner_id: session.demo_user,
    status: 'ACTIVE',
    draft_id: draft.draft_id,
    station: {
      station_id: station.station_id,
      name: station.name,
      area_label: station.area_label,
      coordinates: { ...station.coordinates },
    },
    family_code: draft.family_code,
    quantity: 1,
    created_at: createdAt,
    expires_at: expiresAt,
    cancelled_at: null,
    expired_at: null,
  }

  draft.reservation_id = record.reservation_id
  store.reservations.set(record.reservation_id, record)
  store.idempotency.set(idemScopeKey, {
    user_id: session.demo_user,
    operation: 'CONFIRM_RESERVATION',
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    reservation_id: record.reservation_id,
    in_progress: false,
    created_at: createdAt,
  })

  return {
    status: 201,
    ok: true,
    headers: {
      Location: `/api/v1/reservations/${record.reservation_id}`,
      'Cache-Control': 'no-store',
    },
    body: {
      is_simulated: true,
      reservation: projectReservation(record),
      request_id: makeRequestId(),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* GET /api/v1/reservations & GET /api/v1/reservations/{id} (§6.8, §6.9)      */
/* -------------------------------------------------------------------------- */

export function listReservations(store, session, query = {}) {
  const authErr = validateSession(session, store.nowMs)
  if (authErr) return authErr

  const statusFilter = query?.status ?? null
  if (statusFilter !== null && !RESERVATION_STATUSES.includes(statusFilter)) {
    return errorResponse(400, 'INVALID_INPUT', 'Tham số status không hợp lệ.', [
      {
        field: 'status',
        reason: 'NOT_IN_ENUM',
        message: 'status phải là ACTIVE, CANCELLED hoặc EXPIRED.',
      },
    ])
  }

  const owned = []
  for (const record of store.reservations.values()) {
    if (record.owner_id !== session.demo_user) continue
    reconcileReservationExpiry(store, record)
    if (statusFilter && record.status !== statusFilter) continue
    owned.push(projectReservation(record))
  }

  // §6.8: Sort created_at DESC, then reservation_id ASC.
  owned.sort((a, b) => {
    const diff = Date.parse(b.created_at) - Date.parse(a.created_at)
    return diff !== 0 ? diff : a.reservation_id.localeCompare(b.reservation_id)
  })

  return {
    status: 200,
    ok: true,
    headers: { 'Cache-Control': 'no-store' },
    body: {
      is_simulated: true,
      query: { status: statusFilter },
      total: owned.length,
      reservations: owned,
      request_id: makeRequestId(),
    },
  }
}

export function getReservationDetail(store, session, reservationId) {
  const authErr = validateSession(session, store.nowMs)
  if (authErr) return authErr

  if (typeof reservationId !== 'string' || !UUID_RE.test(reservationId)) {
    return errorResponse(400, 'INVALID_INPUT', 'Mã đơn không đúng định dạng UUID.', [
      {
        field: 'reservation_id',
        reason: 'INVALID_FORMAT',
        message: 'reservation_id phải là UUID chữ thường.',
      },
    ])
  }

  const record = store.reservations.get(reservationId)
  // AE-14: Non-owner receives 404 without leaking order existence or details.
  if (!record || record.owner_id !== session.demo_user) {
    return errorResponse(
      404,
      'RESERVATION_NOT_FOUND',
      'Không tìm thấy đơn đặt pin trong phiên hiện tại.',
    )
  }

  reconcileReservationExpiry(store, record)

  return {
    status: 200,
    ok: true,
    headers: { 'Cache-Control': 'no-store' },
    body: {
      is_simulated: true,
      reservation: projectReservation(record),
      request_id: makeRequestId(),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* POST /api/v1/reservations/{id}/cancel (§6.10)                              */
/* -------------------------------------------------------------------------- */

export function cancelReservation(store, session, reservationId, body = undefined) {
  const authErr = validateSession(session, store.nowMs)
  if (authErr) return authErr

  const details = []
  if (typeof reservationId !== 'string' || !UUID_RE.test(reservationId)) {
    details.push({
      field: 'reservation_id',
      reason: 'INVALID_FORMAT',
      message: 'reservation_id phải là UUID chữ thường.',
    })
  }
  if (body !== undefined && body !== null) {
    if (typeof body !== 'object' || Array.isArray(body)) {
      details.push({ field: 'body', reason: 'INVALID_FORMAT', message: 'Body hủy đơn phải rỗng hoặc {}.' })
    } else {
      validateUnknownFields(body, new Set(), details)
    }
  }
  if (details.length > 0) {
    return errorResponse(400, 'INVALID_INPUT', 'Yêu cầu hủy đơn không hợp lệ.', details)
  }

  const record = store.reservations.get(reservationId)
  if (!record || record.owner_id !== session.demo_user) {
    return errorResponse(
      404,
      'RESERVATION_NOT_FOUND',
      'Không tìm thấy đơn đặt pin trong phiên hiện tại.',
    )
  }

  // BR-09 / AE-16b: Cancel at or after expires_at must reconcile to EXPIRED, never CANCELLED.
  if (record.status === 'ACTIVE' && store.nowMs >= Date.parse(record.expires_at)) {
    reconcileReservationExpiry(store, record)
    return {
      status: 200,
      ok: true,
      headers: { 'Cache-Control': 'no-store' },
      body: {
        is_simulated: true,
        reservation: projectReservation(record),
        request_id: makeRequestId(),
      },
    }
  }

  // Terminal states: idempotent, never release stock a second time (AE-15, AE-16d).
  if (record.status !== 'ACTIVE') {
    return {
      status: 200,
      ok: true,
      headers: { 'Cache-Control': 'no-store' },
      body: {
        is_simulated: true,
        reservation: projectReservation(record),
        request_id: makeRequestId(),
      },
    }
  }

  // Conditional transition ACTIVE -> CANCELLED before expires_at, release stock once.
  const station = store.stations.find((s) => s.station_id === record.station.station_id)
  if (station && typeof station.available_batteries_by_family?.[record.family_code] === 'number') {
    station.available_batteries_by_family[record.family_code] += 1
  }
  record.status = 'CANCELLED'
  record.cancelled_at = getNowIso(store)

  return {
    status: 200,
    ok: true,
    headers: { 'Cache-Control': 'no-store' },
    body: {
      is_simulated: true,
      reservation: projectReservation(record),
      request_id: makeRequestId(),
    },
  }
}
