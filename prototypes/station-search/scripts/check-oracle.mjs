/**
 * Oracle check for the 1.2.1 prototype's domain logic.
 *
 * Asserts src/lib/stationsCore.js against the published test oracles in
 * docs/requirements/Acceptance_Examples_and_Sample_Data.md and
 * docs/architecture/api_contracts.md (§4.2 reference table, §4.3/§4.4 examples).
 * Distances are compared with an absolute tolerance of 1e-6, as §4.3 requires.
 *
 * Run: npm run check:oracle
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { detailOver, searchOver } from '../src/lib/stationsCore.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.resolve(here, '../../../data/seed_stations_v0.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const STATIONS = fixture.stations
const FAMILIES = fixture.battery_families.map((f) => f.family_code)
const LOC_01 = fixture.origins['LOC-01']
const LOC_03 = fixture.origins['LOC-03']

let failures = 0
let checks = 0

function check(label, actual, expected) {
  checks += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`)
  } else {
    console.log(`ok    ${label}`)
  }
}

function checkClose(label, actual, expected, tol = 1e-6) {
  checks += 1
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tol
  if (!ok) {
    failures += 1
    console.error(`FAIL  ${label}\n      expected ${expected} ±${tol}\n      actual   ${actual}`)
  } else {
    console.log(`ok    ${label}`)
  }
}

const search = (params) => searchOver(STATIONS, params, FAMILIES)
const detail = (id, params = {}) => detailOver(STATIONS, id, params, FAMILIES)

/* -- AE-01: LOC-01 / SWAPPING / FAM_A / only_open / 2 km ------------------- */
{
  const res = search({
    lat: String(LOC_01.lat),
    lng: String(LOC_01.lng),
    service_type: 'SWAPPING',
    family_code: 'FAM_A',
    radius_km: '2',
  })
  check('AE-01 status', res.status, 200)
  check('AE-01 total', res.body.total, 4)
  check(
    'AE-01 order',
    res.body.stations.map((s) => s.station_id),
    ['ST-01', 'ST-03', 'ST-05', 'ST-06'],
  )
  const by = Object.fromEntries(res.body.stations.map((s) => [s.station_id, s]))
  checkClose('AE-01 ST-01 distance_km', by['ST-01'].distance_km, 0)
  checkClose('AE-01 ST-03 distance_km', by['ST-03'].distance_km, 0.934066, 1e-6)
  checkClose('AE-01 ST-05 distance_km', by['ST-05'].distance_km, 1.312928, 1e-6)
  checkClose('AE-01 ST-06 distance_km', by['ST-06'].distance_km, 1.653278, 1e-6)
  check(
    'AE-01 distance_display',
    res.body.stations.map((s) => s.distance_display),
    ['0.0 km', '0.9 km', '1.3 km', '1.7 km'],
  )
  check('AE-01 ST-01 bookable', by['ST-01'].booking_eligible, true)
  check('AE-01 ST-05 blocked', by['ST-05'].booking_eligible, false)
  check('AE-01 ST-05 reason', by['ST-05'].ineligibility_reason, 'OUT_OF_STOCK')
  check('AE-01 ST-04 filtered out (FAM_B only)', 'ST-04' in by, false)
  check('AE-01 ST-09 filtered out (CLOSED)', 'ST-09' in by, false)
  check('AE-01 radius echoed', res.body.query.radius_km, 2)
  check('AE-01 only_open defaults to true', res.body.query.only_open, true)
}

/* -- AE-02: nearest *eligible* station is not the nearest station ---------- */
{
  const st05 = STATIONS.find((s) => s.station_id === 'ST-05').coordinates
  const res = search({
    lat: String(st05.lat),
    lng: String(st05.lng),
    service_type: 'SWAPPING',
    family_code: 'FAM_A',
  })
  const rows = res.body.stations
  check('AE-02 ST-05 first at 0.0 km', [rows[0].station_id, rows[0].distance_display], [
    'ST-05',
    '0.0 km',
  ])
  check('AE-02 ST-05 out of stock', rows[0].ineligibility_reason, 'OUT_OF_STOCK')
  const eligible = rows.filter((s) => s.booking_eligible)
  check('AE-02 nearest eligible is ST-03', eligible[0].station_id, 'ST-03')
  checkClose('AE-02 ST-03 distance_km', eligible[0].distance_km, 1.161907, 1e-6)
  check('AE-02 ST-03 display', eligible[0].distance_display, '1.2 km')
  check('AE-02 ST-01 comes after ST-03', eligible[1].station_id, 'ST-01')
}

/* -- AE-05 / AE-07f: valid coordinates outside the fixture area ------------ */
{
  const res = search({
    lat: String(LOC_03.lat),
    lng: String(LOC_03.lng),
    service_type: 'SWAPPING',
    family_code: 'FAM_A',
    radius_km: '0.5',
  })
  check('AE-05 empty result is 200', res.status, 200)
  check('AE-05 total', res.body.total, 0)
  check('AE-05 stations', res.body.stations, [])
}

/* -- AE-07: validation collects every error -------------------------------- */
{
  const res = search({
    lng: String(LOC_01.lng),
    service_type: 'SWAPPING',
    family_code: 'FAM_A',
    radius_km: '0',
  })
  check('AE-07 status', res.status, 400)
  check('AE-07 code', res.body.error.code, 'INVALID_INPUT')
  check(
    'AE-07 details',
    res.body.error.details.map((d) => [d.field, d.reason]),
    [
      ['lat', 'REQUIRED'],
      ['radius_km', 'NOT_POSITIVE'],
    ],
  )
}
{
  const res = search({ lat: '', lng: '21abc', service_type: 'BOTH', family_code: 'FAM_C' })
  check(
    'AE-07 empty / non-numeric / unknown enum',
    res.body.error.details.map((d) => [d.field, d.reason]),
    [
      ['lat', 'EMPTY'],
      ['lng', 'NOT_A_NUMBER'],
      ['service_type', 'NOT_IN_ENUM'],
      ['family_code', 'NOT_IN_ENUM'],
    ],
  )
}
{
  const res = search({
    lat: '95',
    lng: String(LOC_01.lng),
    service_type: 'SWAPPING',
    family_code: 'FAM_A',
    only_open: 'yes',
  })
  check(
    'AE-07 out of range + non-boolean',
    res.body.error.details.map((d) => [d.field, d.reason]),
    [
      ['lat', 'OUT_OF_RANGE'],
      ['only_open', 'NOT_BOOLEAN'],
    ],
  )
}

/* -- §1.2 number format: the client must not be looser than the endpoint ---- */
{
  const base = {
    lng: String(LOC_01.lng),
    service_type: 'SWAPPING',
    family_code: 'FAM_A',
  }
  for (const bad of ['2.1e1', '1e3', '+21', '.5', '21abc', 'NaN', 'Infinity', ' 21.005', '21.005 ']) {
    const res = search({ ...base, lat: bad })
    check(
      `§1.2 rejects lat ${JSON.stringify(bad)}`,
      [res.status, res.body.error?.details?.[0]?.reason],
      [400, 'NOT_A_NUMBER'],
    )
  }
  check(
    '§1.2 rejects padded boolean',
    search({ ...base, lat: '21', only_open: ' true' }).body.error.details[0].reason,
    'NOT_BOOLEAN',
  )
  check(
    '§1.2 rejects padded enum',
    search({ ...base, lat: '21', service_type: ' SWAPPING' }).body.error.details[0].reason,
    'NOT_IN_ENUM',
  )
  check(
    '§1.2 accepts a plain decimal',
    search({ ...base, lat: String(LOC_01.lat), radius_km: '2' }).status,
    200,
  )
  const negZero = search({ ...base, lat: '-0', radius_km: '2' })
  check('§1.2 normalises -0 to 0', Object.is(negZero.body.query.lat, 0), true)
}

/* -- §4.2 reference table -------------------------------------------------- */
{
  const charging = search({
    lat: String(LOC_01.lat),
    lng: String(LOC_01.lng),
    service_type: 'CHARGING',
    family_code: 'FAM_A',
  })
  const by = Object.fromEntries(charging.body.stations.map((s) => [s.station_id, s]))
  check('§4.2 ST-02 CHARGING_ONLY', by['ST-02'].ineligibility_reason, 'CHARGING_ONLY')
  check('§4.2 ST-01 bookable from a CHARGING search', by['ST-01'].booking_eligible, true)

  const closed = search({
    lat: String(LOC_01.lat),
    lng: String(LOC_01.lng),
    service_type: 'SWAPPING',
    family_code: 'FAM_A',
    only_open: 'false',
  })
  const byClosed = Object.fromEntries(closed.body.stations.map((s) => [s.station_id, s]))
  check('§4.2 ST-09 STATION_CLOSED', byClosed['ST-09'].ineligibility_reason, 'STATION_CLOSED')
  check(
    '§4.2 ST-13 STATION_MAINTENANCE',
    byClosed['ST-13'].ineligibility_reason,
    'STATION_MAINTENANCE',
  )
}

/* -- §4.4 station detail --------------------------------------------------- */
{
  const res = detail('ST-04', {
    family_code: 'FAM_A',
    lat: String(LOC_01.lat),
    lng: String(LOC_01.lng),
  })
  check('§4.4 status', res.status, 200)
  checkClose('§4.4 ST-04 distance_km', res.body.station.distance_km, 1.284229, 1e-6)
  check('§4.4 ST-04 display', res.body.station.distance_display, '1.3 km')
  check('§4.4 ST-04 family_supported', res.body.station.family_supported, false)
  check('§4.4 ST-04 reason', res.body.station.ineligibility_reason, 'UNSUPPORTED_FAMILY')

  const bare = detail('ST-04')
  check('§4.4 no query → nulls', [
    bare.body.station.distance_km,
    bare.body.station.distance_display,
    bare.body.station.family_supported,
    bare.body.station.booking_eligible,
    bare.body.station.ineligibility_reason,
  ], [null, null, null, null, null])

  check('§4.4 unknown id', detail('ST-99').body.error.code, 'STATION_NOT_FOUND')
  check('§4.4 lone lat', detail('ST-01', { lat: '21' }).body.error.details[0].reason, 'MISSING_PAIR')
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
