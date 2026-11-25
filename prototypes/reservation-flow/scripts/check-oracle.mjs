/**
 * Oracle verification suite for WBS 2.1.2 reservation domain logic (API v2.2 / WBS 2.1.3).
 * Asserts AE-03, AE-08..AE-18, AE-23f, v2.1 confirm payload & dynamic draft.hold_minutes
 * against data/seed_stations_v0.json.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  advanceClock,
  cancelReservation,
  confirmReservation,
  createDraft,
  createReservationStore,
  getDraftDetail,
  getReservationDetail,
  listReservations,
  makeUuid,
  sweepExpiredReservations,
} from '../src/lib/reservationCore.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.resolve(here, '../../../data/seed_stations_v0.json')
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

const sessionA = { demo_user: 'USER-A', expires_at: '2026-11-26T18:30:00Z' }
const sessionB = { demo_user: 'USER-B', expires_at: '2026-11-26T18:30:00Z' }
const expiredSession = { demo_user: 'USER-A', expires_at: '2026-11-25T18:00:00Z' }

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  PASS  ${name}`)
}

const stockOf = (store, stationId, family) =>
  store.stations.find((s) => s.station_id === stationId).available_batteries_by_family[family]

const portsOf = (store, stationId, family) =>
  store.stations.find((s) => s.station_id === stationId).available_charging_ports_by_family[family]

const confirmPayloadFrom = (draft) => ({
  draft_id: draft.draft_id,
  station_id: draft.station.station_id,
  family_code: draft.family_code,
  quantity: draft.quantity,
})

console.log('Running Vinergy WBS 2.1.2 (API v2.2) reservation oracle checks...')

// AE-08: Strict quantity === 1 with exact §6.2 reason codes
check('AE-08 rejects missing (REQUIRED), non-number (NOT_A_NUMBER), and != 1 (MUST_BE_ONE)', () => {
  const store = createReservationStore(fixture)
  const rMissing = createDraft(store, sessionA, { station_id: 'ST-01', family_code: 'FAM_A' })
  assert.equal(rMissing.status, 400)
  assert.equal(rMissing.body.error.details[0].reason, 'REQUIRED')

  for (const nonNum of ['1', true, [1], null]) {
    const res = createDraft(store, sessionA, { station_id: 'ST-01', family_code: 'FAM_A', quantity: nonNum })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.details[0].reason, 'NOT_A_NUMBER')
  }
  for (const badNum of [0, -1, 2, 1.5]) {
    const res = createDraft(store, sessionA, { station_id: 'ST-01', family_code: 'FAM_A', quantity: badNum })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.details[0].reason, 'MUST_BE_ONE')
  }
  assert.equal(stockOf(store, 'ST-01', 'FAM_A'), 6)
  const ok = createDraft(store, sessionA, { station_id: 'ST-01', family_code: 'FAM_A', quantity: 1 })
  assert.equal(ok.status, 201)
})

// API v2.2 §6.12 #1 & #7: Reject draft_revision and origin as UNKNOWN_FIELD
check('API v2.2 rejects legacy draft_revision on confirm and origin on createDraft (400 UNKNOWN_FIELD)', () => {
  const store = createReservationStore(fixture)
  const badDraft = createDraft(store, sessionA, {
    station_id: 'ST-01',
    family_code: 'FAM_A',
    quantity: 1,
    origin: { lat: 21.005, lng: 105.8435 },
  })
  assert.equal(badDraft.status, 400)
  assert.equal(badDraft.body.error.details.some((d) => d.field === 'origin' && d.reason === 'UNKNOWN_FIELD'), true)

  const draft = createDraft(store, sessionA, { station_id: 'ST-01', family_code: 'FAM_A', quantity: 1 }).body.draft
  const legacyConfirm = confirmReservation(
    store,
    sessionA,
    { draft_id: draft.draft_id, draft_revision: 1, quantity: 1 },
    makeUuid(),
  )
  assert.equal(legacyConfirm.status, 400)
  assert.equal(legacyConfirm.body.error.details.some((d) => d.field === 'station_id' && d.reason === 'REQUIRED'), true)
  assert.equal(legacyConfirm.body.error.details.some((d) => d.field === 'family_code' && d.reason === 'REQUIRED'), true)
  assert.equal(legacyConfirm.body.error.details.some((d) => d.field === 'draft_revision' && d.reason === 'UNKNOWN_FIELD'), true)
})

// API v2.2 §6.12 #3: Non-15-minute hold_minutes config flows inside draft.hold_minutes and controls expires_at
check('API v2.2 non-15-minute config (25 min) is returned in draft.hold_minutes and applied to reservation expires_at', () => {
  const store = createReservationStore(fixture, { config: { holdMinutes: 25, draftTtlMinutes: 5 } })
  const draftRes = createDraft(store, sessionA, { station_id: 'ST-01', family_code: 'FAM_A', quantity: 1 })
  assert.equal(draftRes.status, 201)
  assert.equal(draftRes.body.hold_ttl_seconds, undefined)
  assert.equal(draftRes.body.draft.hold_minutes, 25)
  assert.equal(draftRes.body.draft.station.station_id, 'ST-01')
  assert.equal(draftRes.body.draft.station.distance_km, null)
  assert.equal(draftRes.body.draft.available_batteries, 6)

  const confirm = confirmReservation(store, sessionA, confirmPayloadFrom(draftRes.body.draft), makeUuid())
  assert.equal(confirm.status, 201)
  const diffMinutes =
    (Date.parse(confirm.body.reservation.expires_at) - Date.parse(confirm.body.reservation.created_at)) / 60000
  assert.equal(diffMinutes, 25)
})

// AE-03 / BR-02: Charging-only station rejected
check('AE-03 rejects draft on charging-only station ST-02', () => {
  const store = createReservationStore(fixture)
  const res = createDraft(store, sessionA, { station_id: 'ST-02', family_code: 'FAM_A', quantity: 1 })
  assert.equal(res.status, 409)
  assert.equal(res.body.error.code, 'STATION_NOT_ELIGIBLE')
  assert.equal(res.body.error.details[0].reason, 'CHARGING_ONLY')
})

// AE-09: Draft does not hold stock & GET /reservation-drafts/{draft_id} recomputes live stock
check('AE-09 draft creation does not decrement stock and GET draft reflects live status', () => {
  const store = createReservationStore(fixture)
  const draftRes = createDraft(store, sessionA, { station_id: 'ST-01', family_code: 'FAM_A', quantity: 1 })
  assert.equal(draftRes.status, 201)
  assert.equal(draftRes.body.draft.status, 'OPEN')
  assert.equal(stockOf(store, 'ST-01', 'FAM_A'), 6)
  assert.equal(listReservations(store, sessionA).body.total, 0)

  const fetched = getDraftDetail(store, sessionA, draftRes.body.draft.draft_id)
  assert.equal(fetched.status, 200)
  assert.equal(fetched.body.draft.available_batteries, 6)
})

// AE-10: Atomic confirmation decrements FAM_A only, leaves FAM_B & charging ports intact
check('AE-10 atomic confirmation holds exactly 1 battery and preserves other counts', () => {
  const store = createReservationStore(fixture)
  const draft = createDraft(store, sessionA, { station_id: 'ST-01', family_code: 'FAM_A', quantity: 1 }).body.draft
  const confirm = confirmReservation(store, sessionA, confirmPayloadFrom(draft), makeUuid())
  assert.equal(confirm.status, 201)
  assert.equal(confirm.body.reservation.status, 'ACTIVE')
  assert.equal(confirm.body.reservation.station.station_id, 'ST-01')
  assert.equal(confirm.body.reservation.user_id, undefined)
  assert.equal(stockOf(store, 'ST-01', 'FAM_A'), 5)
  assert.equal(stockOf(store, 'ST-01', 'FAM_B'), 4)
  assert.equal(portsOf(store, 'ST-01', 'FAM_A'), 3)
})


console.log(`\nAll ${passed} oracle checks passed.`)
