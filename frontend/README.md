# Vinergy station discovery

The production frontend opens the simulated Hanoi station finder. Its first search uses the explicitly labelled **LOC-01 demo origin**, SWAPPING, FAM_A, open stations and a 2 km radius. The FastAPI Station Service supplies each row, marker position, displayed distance and booking verdict.

## Run locally

From the repository root, start FastAPI in one terminal. These commands use PowerShell and Python 3.10+.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --reload --no-access-log
```

The backend serves an in-memory SQLite copy of the repository seed when `DATABASE_URL` is unset. An existing seeded PostgreSQL database can be selected with the backend's `DATABASE_URL`. The versioned health endpoint is available at `http://127.0.0.1:8000/api/v1/health`.

In another terminal, from the repository root, use Node 20+ and npm.

```sh
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite loads the repository-root `.env` as described in `.env.example`. Restart Vite after editing the environment and rebuild for production.

| Setting | Use |
| --- | --- |
| `VITE_API_BASE_URL` | Versioned backend base URL. Defaults to `http://127.0.0.1:8000/api/v1`. For a separate frontend origin, add its full origin to the backend's comma-separated `CORS_ORIGINS`. |
| `VITE_OPNAVI_API_KEY` | Public Web/JS application key from the OpNavi Console, with permission to display international maps. Allow the local frontend origin in the key settings if website restrictions are enabled. |
| `VITE_OPNAVI_REGION` | Match the project's deployment region. Use `sg` for Singapore (default) or `de` for Germany. |
| `OPNAVI_SECURITY_JS_CODE` | Security JS Code paired with the Web/JS key. Only the server-side proxy reads this variable. |

The integrated demo uses OpNavi for the embedded map and a Google Maps URL for external directions. In the repository-root `.env`, enter the Web/JS key and its paired Security JS Code, save, then restart Vite. The SDK loads the international map centred on Hanoi. [OpNavi Console](https://console.opnavi.com/keys) · [OpNavi web map setup](https://mapsplatform.opnavi.com/api/maps-javascript-api/add-a-map)

Vite dev and preview forward `/_AMapService/` to the regional OpNavi REST service and add the Security JS Code on the server. For a static deployment, configure the same path on the hosting reverse proxy with the matching regional upstream and server-side code. Only the browser key belongs in the JavaScript bundle. [OpNavi proxy setup](https://mapsplatform.opnavi.com/api/maps-javascript-api/guide/abc/jscode)

The app retains React 18 and Vite 5. Tailwind CSS and its Vite plugin are pinned to the compatible 4.1.13 release for the prototype's utility classes and theme. Lucide React supplies the existing icons. The WBS 1.2.1 review harness imports the same controls, cards and drawer and injects its fixture transport and Leaflet map.

## Verify the increment

| Scenario | What to check |
| --- | --- |
| AE-01 | At the default origin, compare the list and pins for ST-01, ST-03, ST-05, ST-06 in distance order (0.0, 0.9, 1.3, 1.7 km). Select a card, close with Escape, then select a pin. Both open fresh details for the same station. |
| AE-02 | ST-05 has zero FAM_A batteries and stays discoverable. ST-04 is absent for FAM_A. Switch to FAM_B and inspect ST-04's five FAM_B batteries and unsupported FAM_A row. Direct API detail at `/api/v1/stations/ST-04?family_code=FAM_A` reports `UNSUPPORTED_FAMILY`. |
| AE-04 / AE-07 | Under **Đổi vị trí**, try browser location on localhost or HTTPS. Deny permission, enter an out-of-range latitude and submit. Correct the coordinates or choose LOC-02 to search again. A blank radius means unlimited range. |
| AE-05 | Set radius to 0.5 km and choose LOC-03. Both result surfaces clear. Stop FastAPI and search again to see the service error. Restart it and use **Thử lại**. |
| AE-06 | Leave the Maps key unset, reload, and open a station from the list. **Chỉ đường tới trạm** opens a new tab at that station's coordinates. With a working key, repeat AE-01 and confirm the tiles, pins, hover and selection on the live map. |

All inventory and locations are simulated. The distance shown is straight-line distance. Charging is discovery-only. The reservation button is disabled for Sprint 1. Reservation creation, cancellation, expiry and stock locking belong to Sprint 2.

## Automated checks

From `frontend/`, with the backend virtual environment activated so `python` can import Uvicorn, run the following.

```sh
npm run build
npx playwright install chromium
npm test
```

Playwright starts FastAPI on port 8013 and Vite on 5183 using an isolated seeded SQLite repository. Tests use real HTTP search and detail responses, control failures and response ordering, and substitute the OpNavi renderer for deterministic marker checks. Set `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome. On PowerShell, use `$env:PLAYWRIGHT_CHANNEL = 'chrome'`.

Run `python -m pytest -q` from `backend/` for the service suite and `npm run check:oracle` from `prototypes/station-search/` for the prototype oracle. PostgreSQL tests require a separately provisioned, disposable `TEST_DATABASE_URL` as described in the backend test module.
