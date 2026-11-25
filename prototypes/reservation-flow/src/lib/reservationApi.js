/**
 * Mock reservation API binding data/seed_stations_v0.json to reservationCore.js
 * (aligned with API v2.2 / WBS 2.1.3) with simulated latency and fault injection.
 *
 * When real Sprint 2 backend endpoints land (2.2.x), only this module switches
 * to fetch() calls against /api/v1/reservation-drafts and /api/v1/reservations.
 */
import fixture from '../../../../data/seed_stations_v0.json'
import {
  DEMO_USERS,
  FAMILY_CODES,
  INELIGIBILITY_TEXT,
  advanceClock,
  cancelReservation,
  confirmReservation,
  createDraft,
  createReservationStore,
  errorResponse,
  evaluateBooking,
  getDraftDetail,
  getNowIso,
  getReservationDetail,
  listReservations,
  makeUuid,
  setHoldMinutes,
  sweepExpiredReservations,
} from './reservationCore.js'

export { DEMO_USERS, FAMILY_CODES, INELIGIBILITY_TEXT, evaluateBooking, makeUuid }
export const FIXTURE = fixture
export const FAMILIES = fixture.battery_families
export const ORIGINS = fixture.origins

let store = createReservationStore(fixture)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function resetMockStore(options = {}) {
  store = createReservationStore(fixture, options)
  return getStoreSnapshot()
}

export function getStoreSnapshot() {
  return {
    stations: structuredClone(store.stations),
    serverTime: getNowIso(store),
    nowMs: store.nowMs,
    holdMinutes: store.config.holdMinutes,
  }
}

export function advanceServerClock(deltaSeconds) {
  advanceClock(store, deltaSeconds)
  return getStoreSnapshot()
}

export function updateServerHoldMinutes(minutes) {
  setHoldMinutes(store, minutes)
  return getStoreSnapshot()
}

export function runBackgroundExpirySweep() {
  const released = sweepExpiredReservations(store)
  return { released, ...getStoreSnapshot() }
}

/** Test-harness helper: drain a station's stock to simulate AE-13 race before confirm. */
export function setStationStock(stationId, familyCode, count) {
  const station = store.stations.find((s) => s.station_id === stationId)
  if (station && station.available_batteries_by_family && familyCode in station.available_batteries_by_family) {
    station.available_batteries_by_family[familyCode] = Math.max(0, count)
  }
  return getStoreSnapshot()
}

/** Test-harness helper: inject an IN_PROGRESS idempotency lock (AE-11). */
export function setIdempotencyInProgress(userId, idempotencyKey, body, inProgress) {
  const scope = `${userId}::CONFIRM_RESERVATION::${idempotencyKey}`
  if (!inProgress) {
    const existing = store.idempotency.get(scope)
    if (existing?.in_progress) store.idempotency.delete(scope)
    return
  }
  store.idempotency.set(scope, {
    user_id: userId,
    operation: 'CONFIRM_RESERVATION',
    idempotency_key: idempotencyKey,
    request_hash: JSON.stringify({
      draft_id: body.draft_id,
      family_code: body.family_code,
      quantity: body.quantity,
      station_id: body.station_id,
    }),
    reservation_id: null,
    in_progress: true,
    created_at: getNowIso(store),
  })
}

export async function apiCreateDraft(session, body, { delayMs = 180, fault = null } = {}) {
  await wait(delayMs)
  if (fault === 'network') {
    throw new TypeError('Mất kết nối mạng tới máy chủ Vinergy.')
  }
  if (fault === 'server') {
    return errorResponse(500, 'INTERNAL_ERROR', 'Dịch vụ đặt pin tạm thời gặp sự cố. Không có tồn kho nào bị thay đổi.')
  }
  return createDraft(store, session, body)
}

export async function apiGetDraftDetail(session, draftId, { delayMs = 120 } = {}) {
  await wait(delayMs)
  return getDraftDetail(store, session, draftId)
}

export async function apiConfirmReservation(
  session,
  body,
  idempotencyKey,
  { delayMs = 240, fault = null } = {},
) {
  await wait(delayMs)

  // AE-11 / AE-21: server commits the order, then the response is lost in transit.
  if (fault === 'lost_response_after_commit') {
    confirmReservation(store, session, body, idempotencyKey)
    const err = new TypeError('Quá thời gian chờ phản hồi từ máy chủ sau khi gửi xác nhận.')
    err.isNetworkUnknown = true
    throw err
  }

  if (fault === 'network') {
    const err = new TypeError('Mất kết nối mạng khi gửi xác nhận đặt pin.')
    err.isNetworkUnknown = true
    throw err
  }

  if (fault === 'server') {
    return errorResponse(500, 'INTERNAL_ERROR', 'Máy chủ gặp lỗi nội bộ khi xác nhận đặt pin.')
  }

  return confirmReservation(store, session, body, idempotencyKey)
}

export async function apiListReservations(session, { status = null, delayMs = 140, fault = null } = {}) {
  await wait(delayMs)
  if (fault === 'network') {
    throw new TypeError('Không thể kết nối tới dịch vụ đơn đặt pin.')
  }
  if (fault === 'server') {
    return errorResponse(500, 'INTERNAL_ERROR', 'Không tải được danh sách đơn do lỗi máy chủ.')
  }
  return listReservations(store, session, { status })
}

export async function apiGetReservationDetail(session, reservationId, { delayMs = 120 } = {}) {
  await wait(delayMs)
  return getReservationDetail(store, session, reservationId)
}

export async function apiCancelReservation(session, reservationId, { delayMs = 200, fault = null } = {}) {
  await wait(delayMs)
  if (fault === 'network') {
    throw new TypeError('Mất kết nối mạng khi hủy đơn. Vui lòng làm mới trạng thái từ máy chủ.')
  }
  if (fault === 'server') {
    return errorResponse(500, 'INTERNAL_ERROR', 'Dịch vụ gặp lỗi khi xử lý hủy đơn.')
  }
  return cancelReservation(store, session, reservationId)
}
