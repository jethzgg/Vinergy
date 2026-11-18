/**
 * Browser-side stand-in for the station discovery endpoints.
 *
 * Binds the repository fixture (data/seed_stations_v0.json — README "Station
 * fixture JSON") to the domain logic in stationsCore.js and adds the latency
 * and failure injection the 1.2.1 state switcher needs. Response and error
 * envelopes match docs/architecture/api_contracts.md, so replacing these two
 * functions with `fetch()` later changes only the transport.
 *
 * SIMULATED DATA ONLY (BR-01). No stock is ever held here.
 */
import fixture from '@fixture'
import { detailOver, searchOver } from './stationsCore.js'

export {
  INELIGIBILITY_TEXT,
  SERVICE_TYPES,
  formatDistance,
  haversineKm,
  validateSearchField,
} from './stationsCore.js'

export const FIXTURE = fixture
export const STATIONS = fixture.stations
export const ORIGINS = fixture.origins
export const FAMILIES = fixture.battery_families
export const FAMILY_CODES = FAMILIES.map((f) => f.family_code)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {object} params raw form values, exactly as a query string delivers them.
 * @param {{latency?: number, failure?: 'timeout'|'server'|null}} [options]
 */
export async function searchStations(params, options = {}) {
  const { latency = 420, failure = null } = options
  await wait(latency)

  if (failure === 'timeout') {
    // Surfaces as a network/timeout state in the client, never as an empty result.
    throw Object.assign(new Error('Hết thời gian chờ khi gọi dịch vụ tìm trạm.'), {
      name: 'TimeoutError',
    })
  }
  if (failure === 'server') {
    return {
      status: 500,
      ok: false,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Dịch vụ tìm trạm đang gặp sự cố. Vui lòng thử lại.',
          details: [],
        },
        request_id: 'req_SIMULATED_INTERNAL_ERROR',
      },
    }
  }

  const res = searchOver(STATIONS, params, FAMILY_CODES)
  if (res.ok) res.body.data_notice = FIXTURE.data_notice
  return res
}

export async function getStationDetail(stationId, params = {}, options = {}) {
  const { latency = 180 } = options
  await wait(latency)
  return detailOver(STATIONS, stationId, params, FAMILY_CODES)
}
