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

