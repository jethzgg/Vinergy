# Reservation confirmation, order view and cancellation — UI prototype (WBS 2.1.2)

Reviewable front end for the Sprint 2 reservation lifecycle: draft confirmation,
my orders list/detail, cancellation dialog, simulated server clock for expiry
reconciliation, and stock/draft/idempotency/API error handling. **Draft for
review — not a release.**

All data uses the fictional fixture in
[`data/seed_stations_v0.json`](../../data/seed_stations_v0.json) (BR-01). Design
specification and wireframes live in
[`docs/design/Reservation_UI_Design.md`](../../docs/design/Reservation_UI_Design.md).

## Run it

```bash
cd prototypes/reservation-flow
npm install
npm run dev          # http://localhost:5174
```

Other scripts:

```bash
npm run check:oracle # assert reservation domain rules & API v2.2 contract (15 checks)
npx playwright install chromium  # one-time browser setup for the regression test
npm run test:e2e     # lost response, same-key retry, one order and one stock hold
npm run build        # production bundle into dist/
npm run preview      # serve the built bundle
```

## Review scenarios (state switcher)

The dashed bar under the header is a review harness, not product UI:

| # | Scenario | Acceptance examples |
| --- | --- | --- |
| 1 | Xác nhận bản nháp | AE-09, AE-10 — shows station, family, locked `quantity = 1`, draft expiry; draft holds 0 stock |
| 2 | Đơn & Hủy đơn | AE-15, AE-16 — active order countdown, cancel dialog, and `+15p` server clock to test `EXPIRED` reconciliation |
| 3 | Hết pin lúc xác nhận | AE-13 — `409 STATION_NOT_ELIGIBLE (OUT_OF_STOCK)` with nearest-eligible recovery |
| 4 | Bản nháp hết hạn | AE-17 — `409 DRAFT_STALE` with fresh-draft recovery |
| 5 | Mất phản hồi & Gửi lại | AE-11, AE-21 — lost response after commit → unknown outcome → reconcile with same `Idempotency-Key` (`200 Idempotent-Replayed`) |
| 6 | Quyền sở hữu / Phiên | AE-14, AE-23f — `USER-B` probing `USER-A`'s order gets `404 RESERVATION_NOT_FOUND`; expired session gets `401 SESSION_EXPIRED` |
| 7 | Trạm gần nhất đủ ĐK | AE-18 — from zero-stock `ST-05`, server selects `ST-03` (`1.2 km`) |
