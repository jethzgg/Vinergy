# Station search, map and details — UI prototype (WBS 1.2.1)

Reviewable front end for station discovery: filters, result list, interactive map
and the station detail drawer. **Draft for review — not a release.**

All data is the fictional fixture in [`data/seed_stations_v0.json`](../../data/seed_stations_v0.json)
(BR-01). No battery is ever held: the reservation lifecycle is Sprint 2.

The [production frontend](../../frontend/README.md) runs the shared interface against FastAPI with an OpNavi map and Google Maps directions. This review harness keeps the WBS 1.2.1 fixture scenarios and Leaflet renderer.

## Run it

```bash
cd prototypes/station-search
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

```bash
npm run check:oracle # assert the domain logic against the AE oracles (54 checks)
npm run build        # production bundle into dist/
npm run preview      # serve the built bundle
```

Node 20.19+ or 22.12+. Map tiles come from OpenStreetMap, so the first run needs
network access; without it the map falls back to its degraded state and the list
keeps working.

## What is implemented

| Area | Behaviour |
| --- | --- |
| Search | `lat`, `lng`, `service_type`, `family_code`, `only_open` (default `true`), `radius_km` (no hidden default) |
| Distance | Haversine at full precision for sorting and the radius test; `0.9 km` style display rounded half-up, labelled "đường thẳng", with no travel-time promise |
| Filtering | BR-02/BR-03 — service and family must match; stock is not a filter, so a compatible zero-stock station still appears |
| Booking state | §4.2 ladder: `CHARGING_ONLY` → `UNSUPPORTED_FAMILY` → `STATION_CLOSED` → `STATION_MAINTENANCE` → `OUT_OF_STOCK` |
| Map | Custom SVG pins carrying the station code, coloured by why the station can or cannot serve the request; pulsing origin marker; radius ring; hover and selection synchronised both ways with the list |
| Details | Drawer with coordinates, per-family battery and port counts, the booking verdict, and directions that use the station's own coordinates |
| Motion | Staggered result rows, shimmer skeletons, a pin that scales on hover and pops on selection, `flyTo` when a station is chosen, and a sliding drawer — all on one easing and three durations, and all switched off under `prefers-reduced-motion` |

Charging is discovery only — the detail drawer says so and offers no port
reservation. A swapping station with zero batteries stays listed, labelled
"Hết pin khả dụng", with the booking button disabled.

## Interactive state switcher

The dashed bar under the header is a review harness, not product UI. Each button
puts the screen into one acceptance example:

| # | State | Example |
| --- | --- | --- |
| 1 | Bình thường | AE-01 — LOC-01 / SWAPPING / FAM_A / 2 km → ST-01 (0.0), ST-03 (0.9), ST-05 (1.3, hết pin), ST-06 (1.7) |
| 2 | Không có kết quả | AE-05 — LOC-03 at 0.5 km: old markers cleared, empty card offers a wider radius |
| 3 | Bị chặn vị trí | AE-04 — no coordinates invented; focus moves to the latitude field, sample origins offered |
| 4 | Bản đồ gián đoạn | AE-06 — map banner only; list, details and directions keep working |
| 5 | Nhập liệu sai | AE-07 — per-field validation errors |

"Mô phỏng lỗi dịch vụ" makes the next search return `500 INTERNAL_ERROR`, which
is shown as an error with a retry — never as an empty result (AE-05).

## Layout

- `src/StationFinder.jsx` selects a review scenario and wires the fixture adapter to the shared finder in `frontend/src/`.
- `src/LeafletStationMap.jsx` renders fixture results in the prototype map.
- `src/lib/stationsCore.js` holds the fixture oracle for distance, filtering and eligibility.
- `src/lib/stationsApi.js` supplies fixture transport, latency and review failures.
- `scripts/check-oracle.mjs` compares the prototype results with the published examples.

## Known gaps

- The language and framework decision (AD-10) is still open; React here is a
  prototype choice, not a commitment.
- No demo session, CSRF or rate limiting — those endpoints are §3 and Sprint 2.
- `npm run check:oracle` covers the domain logic only; component tests are 1.3.x.
