/**
 * Vinergy — WBS 1.2.1 prototype: station search, map and station details.
 *
 * One interactive component over the repository fixture
 * (data/seed_stations_v0.json) and the mock of
 * docs/architecture/api_contracts.md §4.3–§4.4 in src/lib/stationsApi.js.
 *
 * Covers, as reviewable UI:
 *   AE-01  LOC-01 / SWAPPING / FAM_A / 2 km  → ST-01, ST-03, ST-05, ST-06
 *   AE-04  geolocation denied → manual coordinates, no silent fallback
 *   AE-05  empty result ≠ service error (markers cleared in both cases)
 *   AE-06  map unavailable → list, details and directions still work
 *   AE-07  per-field validation errors
 *
 * Scope (README "Scope decisions"): charging is discovery only; a swapping
 * reservation is Sprint 2 (1.2.4), so the button here holds no battery.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import {
  AlertTriangle,
  Ban,
  Battery,
  BatteryCharging,
  ChevronRight,
  CircleCheck,
  Clock,
  Crosshair,
  Info,
  Loader2,
  MapPin,
  MapPinOff,
  Navigation,
  RotateCcw,
  Search,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import {
  FAMILIES,
  FAMILY_CODES,
  FIXTURE,
  INELIGIBILITY_TEXT,
  ORIGINS,
  getStationDetail,
  searchStations,
  validateSearchField,
} from './lib/stationsApi.js'

/* -------------------------------------------------------------------------- */
/* Presets                                                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_FORM = {
  lat: '21.0050',
  lng: '105.8435',
  service_type: 'SWAPPING',
  family_code: 'FAM_A',
  radius_km: '2',
  only_open: true,
}

const SAMPLE_ORIGINS = [
  { id: 'LOC-01', label: 'LOC-01 · Hai Bà Trưng', ...ORIGINS['LOC-01'] },
  { id: 'LOC-02', label: 'LOC-02 · Hoàn Kiếm', ...ORIGINS['LOC-02'] },
  { id: 'LOC-03', label: 'LOC-03 · ngoại thành', ...ORIGINS['LOC-03'] },
]

const TEST_STATES = [
  { id: 1, label: 'Bình thường', hint: 'LOC-01 · đổi pin · FAM_A · 2 km → 4 trạm' },
  { id: 2, label: 'Không có kết quả', hint: 'AE-05 · LOC-03 · bán kính 0.5 km' },
  { id: 3, label: 'Bị chặn vị trí', hint: 'AE-04 · nhập tọa độ thủ công' },
  { id: 4, label: 'Bản đồ gián đoạn', hint: 'AE-06 · danh sách vẫn hoạt động' },
  { id: 5, label: 'Nhập liệu sai', hint: 'AE-07 · tọa độ và bán kính không hợp lệ' },
]

const STATUS_META = {
  OPEN: { label: 'Đang mở', icon: CircleCheck, tone: 'text-swap-600' },
  CLOSED: { label: 'Đóng cửa', icon: Ban, tone: 'text-stop-600' },
  MAINTENANCE: { label: 'Bảo trì', icon: Wrench, tone: 'text-warn-600' },
}

/* -------------------------------------------------------------------------- */
/* Map marker rendering                                                       */
/* -------------------------------------------------------------------------- */

const PIN_COLORS = {
  swap: '#059669',
  charge: '#0284c7',
  warn: '#d97706',
  muted: '#64748b',
}

/** Marker colour mirrors why a station can or cannot serve the request. */
function pinColor(station, serviceType) {
  if (station.opening_status !== 'OPEN') return PIN_COLORS.muted
  if (serviceType === 'CHARGING') return PIN_COLORS.charge
  if (station.ineligibility_reason === 'OUT_OF_STOCK') return PIN_COLORS.warn
  return PIN_COLORS.swap
}

/**
 * The pin keeps one size and colour for its whole life: hover and selection are
 * a CSS class on the wrapper, so the pin scales smoothly instead of being
 * replaced mid-interaction (and never shifts off its own coordinates).
 */
function buildIcon(station, serviceType) {
  const color = pinColor(station, serviceType)
  return L.divIcon({
    className: 'vg-pin',
    html: `<div class="vg-pin__inner"><svg width="58" height="32" viewBox="0 0 58 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M29 32 L21.5 22.5 L36.5 22.5 Z" fill="#ffffff"/>
  <path d="M29 29.5 L23.5 22.5 L34.5 22.5 Z" fill="${color}"/>
  <rect x="1.5" y="1.5" width="55" height="21" rx="5" fill="${color}" stroke="#ffffff" stroke-width="2"/>
  <text x="29" y="16.3" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
        font-size="12" font-weight="600" letter-spacing="0.2" fill="#ffffff">${station.station_id}</text>
</svg></div>`,
    iconSize: [58, 32],
    iconAnchor: [29, 32],
  })
}

/** Sent exactly as typed, minus surrounding whitespace (§1.2 rejects padding). */
const normalise = (value) => (typeof value === 'string' ? value.trim() : value)

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true

const originIcon = L.divIcon({
  className: 'vg-origin',
  html: '<div class="relative"><div class="vg-origin__ring"></div><div class="vg-origin__dot"></div></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

/* -------------------------------------------------------------------------- */
/* Small presentational pieces                                                */
/* -------------------------------------------------------------------------- */

function ServiceBadges({ services }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {services.includes('SWAPPING') && (
        <span className="inline-flex items-center gap-1 rounded border border-swap-200 bg-swap-50 px-2 py-1 text-xs font-medium text-swap-700">
          <BatteryCharging aria-hidden="true" className="size-3" />
          Đổi pin
        </span>
      )}
      {services.includes('CHARGING') && (
        <span className="inline-flex items-center gap-1 rounded border border-charge-200 bg-charge-50 px-2 py-1 text-xs font-medium text-charge-700">
          <Zap aria-hidden="true" className="size-3" />
          Sạc
        </span>
      )}
    </span>
  )
}

function StatusLine({ status }) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${meta.tone}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {meta.label}
    </span>
  )
}

function FieldError({ message, id }) {
  if (!message) return null
  return (
    <p id={id} className="mt-1 flex items-start gap-1 text-xs text-stop-600">
      <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>{message}</span>
    </p>
  )
}

function SkeletonList() {
  return (
    <ul className="space-y-2 p-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="vg-rise rounded-lg border border-slate-200 bg-white p-3"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <div className="vg-skeleton h-3.5 w-16 rounded" />
              <div className="vg-skeleton h-3 w-40 rounded" />
              <div className="vg-skeleton h-3 w-28 rounded" />
            </div>
            <div className="vg-skeleton h-3.5 w-12 rounded" />
          </div>
        </li>
      ))}
    </ul>
  )
}

/* -------------------------------------------------------------------------- */
/* Station card                                                               */
/* -------------------------------------------------------------------------- */

function StationCard({ station, serviceType, selected, index, onSelect, onHover, cardRef }) {
  const batteries = station.available_batteries_by_family ?? {}
  const ports = station.available_charging_ports_by_family ?? {}
  const familyCode = station.__familyCode
  const batteryCount = batteries[familyCode]
  const portCount = ports[familyCode]
  const blocked = station.booking_eligible === false
  const reasonTone =
    station.ineligibility_reason === 'STATION_CLOSED' ? 'text-stop-600' : 'text-warn-700'

  return (
    <li
      ref={cardRef}
      className="vg-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <button
        type="button"
        onClick={() => onSelect(station.station_id)}
        onMouseEnter={() => onHover(station.station_id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(station.station_id)}
        onBlur={() => onHover(null)}
        aria-current={selected ? 'true' : undefined}
        className={`group w-full rounded-lg border bg-white p-3 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 active:scale-[0.995] ${
          selected
            ? 'border-swap-600 bg-swap-50/40 ring-1 ring-swap-600'
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <div className="flex items-start gap-2">
          {/* The code chip carries the marker's colour, tying row to pin.
              mt-0.5 is a 2px optical offset: it sits the chip's cap height on
              the station name's baseline grid, which box alignment misses. */}
          <span
            className="num mt-0.5 shrink-0 rounded px-2 py-1 text-xs font-semibold text-white"
            style={{ backgroundColor: pinColor(station, serviceType) }}
          >
            {station.station_id}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{station.name}</p>
            <p className="truncate text-xs text-slate-500">{station.area_label}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <div className="text-right">
              <p className="num text-sm font-semibold text-slate-900">{station.distance_display}</p>
              <p className="text-xs text-slate-400">đường thẳng</p>
            </div>
            <ChevronRight
              aria-hidden="true"
              className="size-4 text-slate-300 transition-[transform,color] duration-150 group-hover:translate-x-0.5 group-hover:text-slate-500"
            />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <ServiceBadges services={station.services} />
          {serviceType === 'SWAPPING' && batteryCount !== undefined && (
            <span className="inline-flex items-center gap-1 text-sm text-slate-600">
              <Battery aria-hidden="true" className="size-4 text-slate-400" />
              <span className="num font-medium text-slate-900">{batteryCount}</span>
              pin {familyCode}
            </span>
          )}
          {serviceType === 'CHARGING' && portCount !== undefined && (
            <span className="inline-flex items-center gap-1 text-sm text-slate-600">
              <Zap aria-hidden="true" className="size-4 text-slate-400" />
              <span className="num font-medium text-slate-900">{portCount}</span>
              cổng {familyCode}
            </span>
          )}
          {/* "Đang mở" on every row is noise while only_open is on — show the exception. */}
          {station.opening_status !== 'OPEN' && <StatusLine status={station.opening_status} />}
        </div>

        {blocked && (
          <p className={`mt-2 flex items-center gap-1 text-xs font-medium ${reasonTone}`}>
            <Ban aria-hidden="true" className="size-3.5 shrink-0" />
            {INELIGIBILITY_TEXT[station.ineligibility_reason]}
          </p>
        )}
      </button>
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* Detail drawer                                                              */
/* -------------------------------------------------------------------------- */

function DetailDrawer({ stationId, query, onClose }) {
  const [state, setState] = useState({ loading: true, station: null, error: null })
  const [holdNote, setHoldNote] = useState(false)
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const titleId = useId()

  useEffect(() => {
    let alive = true
    setState({ loading: true, station: null, error: null })
    setHoldNote(false)
    getStationDetail(stationId, {
      family_code: query?.family_code,
      lat: query?.lat,
      lng: query?.lng,
    })
      .then((res) => {
        if (!alive) return
        if (res.ok) setState({ loading: false, station: res.body.station, error: null })
        else setState({ loading: false, station: null, error: res.body.error })
      })
      .catch((err) => {
        if (!alive) return
        setState({ loading: false, station: null, error: { message: err.message } })
      })
    return () => {
      alive = false
    }
  }, [stationId, query])

  // Focus moves into the panel, is trapped while open, and returns on close.
  useEffect(() => {
    const previous = document.activeElement
    closeRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusables = panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables?.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [onClose])

  const station = state.station
  const familyCode = query?.family_code
  const directions = station
    ? `https://www.google.com/maps/dir/?api=1&destination=${station.coordinates.lat},${station.coordinates.lng}`
    : null

  return (
    <div className="fixed inset-0 z-[1200] flex justify-end">
      <button
        type="button"
        aria-label="Đóng chi tiết trạm"
        onClick={onClose}
        className="vg-backdrop absolute inset-0 bg-slate-900/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="vg-drawer relative flex h-full w-full max-w-[460px] flex-col border-l border-slate-200 bg-white shadow-[0_8px_30px_rgb(15_23_42/0.07)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0">
            <p className="num text-xs font-semibold tracking-wide text-slate-500">{stationId}</p>
            <h2 id={titleId} className="truncate text-lg font-semibold text-slate-900">
              {station ? station.name : 'Chi tiết trạm'}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            title="Đóng (Esc)"
            aria-label="Đóng chi tiết trạm"
            className="shrink-0 rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {state.loading && (
            <div className="space-y-3" aria-live="polite" aria-busy="true">
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                Đang tải chi tiết trạm…
              </p>
              <div className="h-16 rounded-md bg-slate-100" />
              <div className="h-24 rounded-md bg-slate-100" />
            </div>
          )}

          {state.error && (
            <div className="rounded-md border border-stop-200 bg-stop-50 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-stop-700">
                <AlertTriangle aria-hidden="true" className="size-4" />
                Không tải được chi tiết trạm
              </p>
              <p className="mt-1 text-sm text-slate-700">{state.error.message}</p>
            </div>
          )}

          {station && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <StatusLine status={station.opening_status} />
                <ServiceBadges services={station.services} />
              </div>

              <dl className="divide-y divide-slate-100 rounded-md border border-slate-200">
                <div className="flex items-baseline justify-between gap-3 p-3">
                  <dt className="text-xs text-slate-500">Khu vực</dt>
                  <dd className="text-sm text-slate-900">{station.area_label}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 p-3">
                  <dt className="text-xs text-slate-500">Tọa độ</dt>
                  <dd className="num text-sm text-slate-900">
                    {station.coordinates.lat.toFixed(4)}, {station.coordinates.lng.toFixed(4)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 p-3">
                  <dt className="text-xs text-slate-500">Khoảng cách</dt>
                  <dd className="text-right">
                    <span className="num text-sm font-semibold text-slate-900">
                      {station.distance_display ?? '—'}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {station.distance_display
                        ? 'đường thẳng · không cam kết thời gian di chuyển'
                        : 'chưa có tọa độ xuất phát'}
                    </span>
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 p-3">
                  <dt className="text-xs text-slate-500">Nhóm pin hỗ trợ</dt>
                  <dd className="num text-sm text-slate-900">
                    {station.supported_families.join(', ')}
                  </dd>
                </div>
              </dl>

              {station.services.includes('SWAPPING') && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Pin đổi khả dụng
                  </h3>
                  <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                    {FAMILIES.map((f) => {
                      const value = station.available_batteries_by_family?.[f.family_code]
                      const isQuery = f.family_code === familyCode
                      return (
                        <li
                          key={f.family_code}
                          className={`flex items-center justify-between gap-3 p-3 ${
                            isQuery ? 'bg-slate-50' : ''
                          }`}
                        >
                          <span className="num text-sm text-slate-700">
                            {f.family_code}
                            {isQuery && (
                              <span className="ml-2 rounded bg-slate-200 px-2 py-1 font-sans text-xs font-medium text-slate-700">
                                đang chọn
                              </span>
                            )}
                          </span>
                          <span className="num text-sm font-semibold text-slate-900">
                            {value === undefined ? 'không hỗ trợ' : value}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              {station.services.includes('CHARGING') && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Cổng sạc
                  </h3>
                  <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                    {FAMILIES.map((f) => {
                      const value = station.available_charging_ports_by_family?.[f.family_code]
                      return (
                        <li
                          key={f.family_code}
                          className="flex items-center justify-between gap-3 p-3"
                        >
                          <span className="num text-sm text-slate-700">{f.family_code}</span>
                          <span className="num text-sm font-semibold text-slate-900">
                            {value === undefined ? 'không hỗ trợ' : value}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="mt-2 text-xs text-slate-500">
                    Không hỗ trợ đặt trước cổng sạc — chỉ tra cứu.
                  </p>
                </section>
              )}

              <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <h3 className="text-sm font-semibold text-slate-900">Đặt giữ pin</h3>
                {station.booking_eligible === true ? (
                  <>
                    <p className="mt-1 text-xs text-slate-600">
                      Giữ đúng 1 pin {familyCode} tại trạm này.
                    </p>
                    <button
                      type="button"
                      onClick={() => setHoldNote(true)}
                      className="mt-3 w-full rounded-md bg-swap-600 px-3 py-2 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-swap-700 active:scale-[0.99]"
                    >
                      Đặt giữ 1 pin
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mt-1 flex items-start gap-2 text-xs text-slate-600">
                      <Info aria-hidden="true" className="mt-px size-3.5 shrink-0 text-slate-400" />
                      <span>
                        {station.ineligibility_reason
                          ? INELIGIBILITY_TEXT[station.ineligibility_reason]
                          : 'Chưa chọn nhóm pin nên chưa xét điều kiện đặt.'}
                      </span>
                    </p>
                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      className="mt-3 w-full cursor-not-allowed rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-400"
                    >
                      Đặt giữ 1 pin
                    </button>
                  </>
                )}
                {holdNote && (
                  <p className="mt-2 rounded border border-charge-200 bg-charge-50 p-2 text-xs text-charge-700">
                    Prototype 1.2.1 chỉ tra cứu. Vòng đời đặt giữ pin thuộc Sprint 2 (1.2.4) nên
                    chưa có pin nào được giữ.
                  </p>
                )}
              </section>

              <a
                href={directions}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
              >
                <Navigation aria-hidden="true" className="size-4" />
                Chỉ đường tới trạm
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function StationFinder() {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [fieldErrors, setFieldErrors] = useState({})
  const [phase, setPhase] = useState('loading') // loading | results | empty | error | network | noLocation
  const [result, setResult] = useState(null)
  const [apiError, setApiError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)
  const [drawerId, setDrawerId] = useState(null)
  const [mapDegraded, setMapDegraded] = useState(false)
  const [geoNotice, setGeoNotice] = useState(null)
  const [activeTestState, setActiveTestState] = useState(1)
  const [simulateServerError, setSimulateServerError] = useState(false)
  const [showMapOnMobile, setShowMapOnMobile] = useState(true)
  const [showLocation, setShowLocation] = useState(false)
  const [searchSeq, setSearchSeq] = useState(0)

  const latRef = useRef(null)
  const mapElRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(new Map())
  const overlaysRef = useRef([])
  const cardRefs = useRef(new Map())
  const boundsRef = useRef(null)
  const requestRef = useRef(0)
  const [mapReady, setMapReady] = useState(false)

  const query = result?.query ?? null
  const stations = useMemo(() => {
    if (!result) return []
    return result.stations.map((s) => ({ ...s, __familyCode: result.query.family_code }))
  }, [result])

  /* ---------------------------------------------------------------- search */

  const runSearch = useCallback(
    async (nextForm, { failure = null } = {}) => {
      // Only the newest request may write state: an answer that arrives after
      // the screen has moved on (a test state, another search) is dropped.
      const token = (requestRef.current += 1)
      setPhase('loading')
      setApiError(null)
      setFieldErrors({})
      setDrawerId(null)
      try {
        const res = await searchStations(
          {
            // Explicit normalisation before the request: the contract rejects
            // padded values (§1.2), so the client trims rather than relying on
            // a looser validator than the real endpoint has.
            lat: normalise(nextForm.lat),
            lng: normalise(nextForm.lng),
            service_type: normalise(nextForm.service_type),
            family_code: normalise(nextForm.family_code),
            only_open: nextForm.only_open,
            // An empty radius box means "no radius", not an empty parameter.
            radius_km: normalise(nextForm.radius_km) || undefined,
          },
          { failure },
        )
        if (token !== requestRef.current) return
        if (!res.ok) {
          // A 4xx/5xx is never shown as an empty result (AE-05): stale rows go.
          setResult(null)
          setSelectedId(null)
          setApiError(res.body.error)
          setFieldErrors(
            Object.fromEntries((res.body.error.details ?? []).map((d) => [d.field, d.message])),
          )
          setPhase('error')
          return
        }
        setResult(res.body)
        setSelectedId(null)
        setSearchSeq((n) => n + 1)
        setPhase(res.body.total === 0 ? 'empty' : 'results')
      } catch (err) {
        if (token !== requestRef.current) return
        setResult(null)
        setSelectedId(null)
        setApiError({ code: 'NETWORK', message: err.message })
        setPhase('network')
      }
    },
    [],
  )

  useEffect(() => {
    runSearch(DEFAULT_FORM)
  }, [runSearch])

  const onSubmit = (event) => {
    event.preventDefault()
    runSearch(form, { failure: simulateServerError ? 'server' : null })
  }

  // Errors clear the moment the field is edited, and are raised again on blur —
  // never while the driver is still typing a coordinate.
  const setField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }))
    setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev))
  }

  const validateOnBlur = (name, value) => {
    // Trim on leaving the field, so what stays on screen is exactly what gets
    // sent — and blur cannot disagree with submit about a padded value.
    const cleaned = normalise(value)
    if (cleaned !== value) setForm((prev) => ({ ...prev, [name]: cleaned }))
    const message = validateSearchField(name, cleaned, FAMILY_CODES)
    setFieldErrors((prev) => ({ ...prev, [name]: message ?? undefined }))
  }

  /* ----------------------------------------------------------- test states */

  const applyTestState = (id) => {
    setActiveTestState(id)
    setSimulateServerError(false)
    setGeoNotice(null)
    setDrawerId(null)

    if (id === 1) {
      setMapDegraded(false)
      setForm(DEFAULT_FORM)
      runSearch(DEFAULT_FORM)
      return
    }
    if (id === 2) {
      setMapDegraded(false)
      const next = { ...DEFAULT_FORM, lat: '21.2', lng: '105.2', radius_km: '0.5' }
      setForm(next)
      runSearch(next)
      return
    }
    if (id === 3) {
      // Abandon any search still in flight, or its answer would restore results
      // the driver no longer has a location for.
      requestRef.current += 1
      setMapDegraded(false)
      const next = { ...DEFAULT_FORM, lat: '', lng: '' }
      setForm(next)
      setResult(null)
      setSelectedId(null)
      setApiError(null)
      setFieldErrors({})
      setPhase('noLocation')
      setGeoNotice(
        'Trình duyệt đã chặn quyền truy cập vị trí. Hãy nhập tọa độ thủ công hoặc chọn một điểm mẫu — ứng dụng không tự suy ra vị trí của bạn.',
      )
      requestAnimationFrame(() => latRef.current?.focus())
      return
    }
    if (id === 4) {
      setMapDegraded(true)
      setForm(DEFAULT_FORM)
      runSearch(DEFAULT_FORM)
      return
    }
    setMapDegraded(false)
    const next = { ...DEFAULT_FORM, lat: '95', lng: '', radius_km: '-1' }
    setForm(next)
    runSearch(next)
  }

  const useBrowserLocation = () => {
    if (!navigator.geolocation) {
      setGeoNotice('Trình duyệt này không hỗ trợ định vị. Hãy nhập tọa độ thủ công.')
      latRef.current?.focus()
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoNotice(null)
        const next = {
          ...form,
          lat: pos.coords.latitude.toFixed(4),
          lng: pos.coords.longitude.toFixed(4),
        }
        setForm(next)
        runSearch(next)
      },
      () => {
        setGeoNotice(
          'Không lấy được vị trí từ trình duyệt. Hãy nhập tọa độ thủ công hoặc chọn một điểm mẫu.',
        )
        latRef.current?.focus()
      },
      { timeout: 8000 },
    )
  }

  const pickSampleOrigin = (origin) => {
    setGeoNotice(null)
    const next = { ...form, lat: origin.lat.toFixed(4), lng: origin.lng.toFixed(4) }
    setForm(next)
    runSearch(next)
  }

  const widenRadius = () => {
    const next = { ...form, radius_km: '10' }
    setForm(next)
    runSearch(next)
  }

  /* -------------------------------------------------------------- map init */

  useEffect(() => {
    if (mapDegraded) return undefined
    const el = mapElRef.current
    if (!el || mapRef.current) return undefined

    const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(
      [21.012, 105.84],
      13,
    )
    let tileErrors = 0
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    })
      .on('tileerror', () => {
        tileErrors += 1
        if (tileErrors > 10) setMapDegraded(true)
      })
      .addTo(map)

    mapRef.current = map
    setMapReady(true)

    // A resized container keeps the same stations in view, not the same centre.
    const observer = new ResizeObserver(() => {
      map.invalidateSize()
      if (boundsRef.current) map.fitBounds(boundsRef.current, { animate: false })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      markersRef.current.clear()
      overlaysRef.current = []
      setMapReady(false)
    }
  }, [mapDegraded])

  // Markers follow the result set exactly: an error or an empty result clears them.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current.clear()
    overlaysRef.current.forEach((layer) => layer.remove())
    overlaysRef.current = []

    if (!query) return

    const origin = L.latLng(query.lat, query.lng)
    const originMarker = L.marker(origin, { icon: originIcon, zIndexOffset: 500 })
      .addTo(map)
      .bindTooltip('Vị trí của bạn', { direction: 'top', offset: [0, -10] })
    overlaysRef.current.push(originMarker)

    if (query.radius_km) {
      const circle = L.circle(origin, {
        radius: query.radius_km * 1000,
        color: '#059669',
        weight: 1,
        dashArray: '4 4',
        fillColor: '#059669',
        fillOpacity: 0.04,
      }).addTo(map)
      overlaysRef.current.push(circle)
    }

    stations.forEach((station) => {
      const marker = L.marker([station.coordinates.lat, station.coordinates.lng], {
        icon: buildIcon(station, query.service_type),
        keyboard: false,
        title: `${station.station_id} — ${station.name}`,
      })
        .addTo(map)
        .on('click', () => {
          setSelectedId(station.station_id)
          setDrawerId(station.station_id)
        })
        .on('mouseover', () => setHoveredId(station.station_id))
        .on('mouseout', () => setHoveredId(null))
      markersRef.current.set(station.station_id, marker)
    })

    const points = [origin, ...stations.map((s) => L.latLng(s.coordinates.lat, s.coordinates.lng))]
    if (points.length > 1) {
      boundsRef.current = L.latLngBounds(points).pad(0.22)
      map.fitBounds(boundsRef.current, { animate: false })
    } else {
      boundsRef.current = null
      map.setView(origin, 14, { animate: false })
    }
  }, [mapReady, query, stations])

  // Hover or selection in either direction restyles the matching pin. Toggling a
  // class keeps the same element, so the pin scales instead of being swapped.
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const el = marker.getElement()
      if (!el) return
      el.classList.toggle('vg-pin--active', id === selectedId || id === hoveredId)
      el.classList.toggle('vg-pin--selected', id === selectedId)
      marker.setZIndexOffset(id === selectedId ? 500 : id === hoveredId ? 400 : 0)
    })
  }, [selectedId, hoveredId, stations])

  // Selecting from the map brings the matching card into view, and vice versa.
  useEffect(() => {
    if (!selectedId) return
    const reduce = prefersReducedMotion()
    cardRefs.current
      .get(selectedId)
      ?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
    const marker = markersRef.current.get(selectedId)
    const map = mapRef.current
    if (!marker || !map) return
    const zoom = Math.max(map.getZoom(), 14)
    if (reduce) map.setView(marker.getLatLng(), zoom, { animate: false })
    else map.flyTo(marker.getLatLng(), zoom, { duration: 0.55 })
  }, [selectedId])

  const onListKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = Array.from(
      event.currentTarget.querySelectorAll('button[type="button"]'),
    ).filter((b) => !b.disabled)
    const index = buttons.indexOf(document.activeElement)
    if (index === -1) return
    event.preventDefault()
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1
    buttons[(next + buttons.length) % buttons.length]?.focus()
  }

  const selectStation = (id) => {
    setSelectedId(id)
    setDrawerId(id)
  }

  /* ------------------------------------------------------------------ view */

  // A validation error or a missing origin forces the fields back into view.
  const locationOpen =
    showLocation || Boolean(fieldErrors.lat) || Boolean(fieldErrors.lng) || phase === 'noLocation'

  const resultSummary =
    phase === 'results'
      ? `${result.total} trạm phù hợp${query.radius_km ? ` trong bán kính ${query.radius_km} km` : ''}`
      : phase === 'empty'
        ? 'Không có trạm nào phù hợp'
        : ''

  return (
    <div className="flex min-h-full flex-col bg-slate-100 text-slate-900 lg:h-full lg:overflow-hidden">
      <a
        href="#station-list"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[1300] focus:m-2 focus:rounded focus:bg-slate-900 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Bỏ qua tới danh sách trạm
      </a>

      {/* BR-01 — simulation disclaimer, always visible. */}
      <div className="flex shrink-0 items-center gap-2 bg-slate-900 px-4 py-2 text-xs text-slate-200">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warn-600" />
        <p>
          <span className="font-semibold text-white">DỮ LIỆU MÔ PHỎNG</span> (Simulation Demo) — chỉ
          áp dụng dữ liệu mẫu <span className="num">FAM_A</span> &{' '}
          <span className="num">FAM_B</span> tại Hà Nội. Tên trạm, tọa độ và số lượng là hư cấu, không
          phải cơ sở dịch vụ thật.
        </p>
      </div>

      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded bg-swap-600">
              <BatteryCharging aria-hidden="true" className="size-4 text-white" />
            </span>
            <div>
              <h1 className="text-base leading-tight font-semibold">Vinergy — Tìm trạm</h1>
              <p className="text-xs text-slate-500">
                WBS 1.2.1 · fixture <span className="num">{FIXTURE.schema_version}</span>
              </p>
            </div>
          </div>
          <p className="num text-xs text-slate-500">
            {FIXTURE.stations.length} trạm mẫu · Hà Nội
          </p>
        </div>

        {/* Interactive state switcher — a review harness, not product UI. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-slate-300 bg-slate-50 px-4 py-2">
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Trạng thái kiểm thử
          </span>
          {/* Narrow screens scroll this row instead of stacking it five deep. */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
            {TEST_STATES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => applyTestState(s.id)}
                aria-pressed={activeTestState === s.id}
                title={s.hint}
                className={`shrink-0 rounded border px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors duration-150 ${
                  activeTestState === s.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-white'
                }`}
              >
                <span className="num mr-1 opacity-60">{s.id}</span>
                {s.label}
              </button>
            ))}
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={simulateServerError}
              onChange={(e) => setSimulateServerError(e.target.checked)}
              className="size-4 accent-stop-600"
            />
            Mô phỏng lỗi dịch vụ
          </label>
          <p className="basis-full text-xs text-slate-500 lg:basis-auto">
            {TEST_STATES.find((s) => s.id === activeTestState)?.hint}
          </p>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ------------------------------------------------ sidebar: filters */}
        <aside className="flex min-h-0 flex-col border-slate-200 bg-white lg:h-full lg:w-[440px] lg:shrink-0 lg:border-r">
          <form onSubmit={onSubmit} noValidate className="shrink-0 border-b border-slate-200 p-4">
            <fieldset className="mb-3">
              <legend className="mb-2 block text-xs font-medium text-slate-700">
                Loại dịch vụ
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'SWAPPING', label: 'Đổi pin', icon: BatteryCharging },
                  { value: 'CHARGING', label: 'Sạc', icon: Zap },
                ].map((opt) => {
                  const Icon = opt.icon
                  const on = form.service_type === opt.value
                  return (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                        on
                          ? opt.value === 'SWAPPING'
                            ? 'border-swap-600 bg-swap-50 text-swap-700'
                            : 'border-charge-600 bg-charge-50 text-charge-700'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="service_type"
                        value={opt.value}
                        checked={on}
                        onChange={(e) => setField('service_type', e.target.value)}
                        className="sr-only"
                      />
                      <Icon aria-hidden="true" className="size-4" />
                      {opt.label}
                    </label>
                  )
                })}
              </div>
              {form.service_type === 'CHARGING' && (
                <p className="mt-2 flex items-start gap-1 text-xs text-charge-700">
                  <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                  Trạm sạc chỉ để tra cứu — không hỗ trợ đặt trước cổng sạc.
                </p>
              )}
            </fieldset>

            <div className="mb-3">
              <label htmlFor="family" className="mb-2 block text-xs font-medium text-slate-700">
                Nhóm pin
              </label>
              <select
                id="family"
                value={form.family_code}
                onChange={(e) => setField('family_code', e.target.value)}
                aria-invalid={fieldErrors.family_code ? 'true' : undefined}
                className="num w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {FAMILIES.map((f) => (
                  <option key={f.family_code} value={f.family_code}>
                    {f.family_code}
                  </option>
                ))}
              </select>
              <FieldError id="err-family" message={fieldErrors.family_code} />
            </div>

            {/* Collapsed by default: the list, not the coordinates, is the screen. */}
            <div className="mb-3">
              <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">Vị trí xuất phát</p>
                  <p className="num truncate text-sm text-slate-900">
                    {form.lat && form.lng ? `${form.lat}, ${form.lng}` : 'chưa chọn'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLocation((v) => !v)}
                  aria-expanded={locationOpen}
                  aria-controls="location-panel"
                  className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
                >
                  {locationOpen ? 'Thu gọn' : 'Đổi vị trí'}
                </button>
              </div>
            </div>

            {locationOpen && (
              <div id="location-panel" className="vg-expand mb-3 grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="lat" className="mb-2 block text-xs font-medium text-slate-700">
                  Vĩ độ (lat)
                </label>
                <input
                  id="lat"
                  ref={latRef}
                  value={form.lat}
                  onChange={(e) => setField('lat', e.target.value)}
                  onBlur={(e) => validateOnBlur('lat', e.target.value)}
                  inputMode="decimal"
                  placeholder="21.0050"
                  aria-invalid={fieldErrors.lat ? 'true' : undefined}
                  aria-describedby={fieldErrors.lat ? 'err-lat' : undefined}
                  className={`num w-full rounded-md border px-3 py-2 text-sm ${
                    fieldErrors.lat ? 'border-stop-600 bg-stop-50' : 'border-slate-300'
                  }`}
                />
                <FieldError id="err-lat" message={fieldErrors.lat} />
              </div>
              <div>
                <label htmlFor="lng" className="mb-2 block text-xs font-medium text-slate-700">
                  Kinh độ (lng)
                </label>
                <input
                  id="lng"
                  value={form.lng}
                  onChange={(e) => setField('lng', e.target.value)}
                  onBlur={(e) => validateOnBlur('lng', e.target.value)}
                  inputMode="decimal"
                  placeholder="105.8435"
                  aria-invalid={fieldErrors.lng ? 'true' : undefined}
                  aria-describedby={fieldErrors.lng ? 'err-lng' : undefined}
                  className={`num w-full rounded-md border px-3 py-2 text-sm ${
                    fieldErrors.lng ? 'border-stop-600 bg-stop-50' : 'border-slate-300'
                  }`}
                />
                <FieldError id="err-lng" message={fieldErrors.lng} />
              </div>

                <div className="col-span-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={useBrowserLocation}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <Crosshair aria-hidden="true" className="size-3.5" />
                    Dùng vị trí của tôi
                  </button>
                  {SAMPLE_ORIGINS.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => pickSampleOrigin(o)}
                      className="num rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      title={`${o.lat}, ${o.lng}`}
                    >
                      {o.id}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {geoNotice && (
              <p
                role="status"
                className="mb-3 flex items-start gap-2 rounded-md border border-warn-200 bg-warn-50 p-3 text-xs text-warn-700"
              >
                <MapPinOff aria-hidden="true" className="mt-px size-4 shrink-0" />
                <span>{geoNotice}</span>
              </p>
            )}

            <div className="mb-3 grid grid-cols-2 items-start gap-2">
              <div>
                <label htmlFor="radius" className="mb-2 block text-xs font-medium text-slate-700">
                  Bán kính (km)
                </label>
                <input
                  id="radius"
                  value={form.radius_km}
                  onChange={(e) => setField('radius_km', e.target.value)}
                  onBlur={(e) => validateOnBlur('radius_km', e.target.value)}
                  inputMode="decimal"
                  placeholder="để trống = không giới hạn"
                  aria-invalid={fieldErrors.radius_km ? 'true' : undefined}
                  aria-describedby={fieldErrors.radius_km ? 'err-radius' : undefined}
                  className={`num w-full rounded-md border px-3 py-2 text-sm ${
                    fieldErrors.radius_km ? 'border-stop-600 bg-stop-50' : 'border-slate-300'
                  }`}
                />
                <FieldError id="err-radius" message={fieldErrors.radius_km} />
              </div>
              <label className="mt-6 flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={form.only_open}
                  onChange={(e) => setField('only_open', e.target.checked)}
                  className="size-4 accent-swap-600"
                />
                Chỉ trạm đang mở
              </label>
            </div>

            <button
              type="submit"
              disabled={phase === 'loading'}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-3 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-slate-800 active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100"
            >
              {phase === 'loading' ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Search aria-hidden="true" className="size-4" />
              )}
              Tìm trạm
            </button>
          </form>

          {/* ------------------------------------------- sidebar: result list */}
          <div className="flex min-h-0 flex-col lg:flex-1 lg:overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Kết quả
              </p>
              <p aria-live="polite" className="text-xs text-slate-600">
                {resultSummary}
              </p>
            </div>

            {/* The list is its own surface: white rows sit one step above it. */}
            <div id="station-list" className="min-h-0 bg-slate-50 lg:flex-1 lg:overflow-y-auto">
              {/* A sub-second refetch keeps its rows. Skeletons are for a first
                  load only, where there is nothing to preserve. */}
              {phase === 'loading' && stations.length === 0 && <SkeletonList />}

              {(phase === 'results' || (phase === 'loading' && stations.length > 0)) && (
                // Keyed by search, so a new result set replays the entrance.
                <ul
                  key={searchSeq}
                  aria-busy={phase === 'loading' ? 'true' : undefined}
                  className={`space-y-2 p-3 transition-opacity duration-150 ${
                    phase === 'loading' ? 'pointer-events-none opacity-50' : ''
                  }`}
                  onKeyDown={onListKeyDown}
                >
                  {stations.map((station, i) => (
                    <StationCard
                      key={station.station_id}
                      index={i}
                      station={station}
                      serviceType={query.service_type}
                      selected={selectedId === station.station_id}
                      onSelect={selectStation}
                      onHover={setHoveredId}
                      cardRef={(el) => {
                        if (el) cardRefs.current.set(station.station_id, el)
                        else cardRefs.current.delete(station.station_id)
                      }}
                    />
                  ))}
                </ul>
              )}

              {phase === 'empty' && (
                <div className="p-4">
                  <div className="vg-rise rounded-lg border border-slate-200 bg-white p-4 text-center">
                    <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-slate-100">
                      <MapPin aria-hidden="true" className="size-5 text-slate-400" />
                    </span>
                    <h2 className="mt-3 text-sm font-semibold text-slate-900">
                      Không tìm thấy trạm phù hợp
                      {query?.radius_km ? ` trong bán kính ${query.radius_km} km` : ''}
                    </h2>
                    <p className="mt-1 text-xs text-slate-600">
                      Tìm kiếm đã chạy thành công nhưng không có trạm nào thỏa dịch vụ{' '}
                      <span className="num">{query?.service_type}</span> và nhóm pin{' '}
                      <span className="num">{query?.family_code}</span> quanh vị trí này.
                    </p>
                    <div className="mt-3 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={widenRadius}
                        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                      >
                        Mở rộng bán kính lên 10 km
                      </button>
                      <button
                        type="button"
                        onClick={() => pickSampleOrigin(SAMPLE_ORIGINS[0])}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Chuyển về điểm mẫu LOC-01
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {(phase === 'error' || phase === 'network') && (
                <div className="p-4">
                  <div
                    role="alert"
                    className="vg-rise rounded-lg border border-stop-200 bg-stop-50 p-4 text-left"
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold text-stop-700">
                      <AlertTriangle aria-hidden="true" className="size-4" />
                      {phase === 'network'
                        ? 'Không kết nối được dịch vụ tìm trạm'
                        : apiError?.code === 'INVALID_INPUT'
                          ? 'Thông tin tìm kiếm chưa hợp lệ'
                          : 'Dịch vụ tìm trạm đang gặp sự cố'}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{apiError?.message}</p>
                    {apiError?.details?.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {apiError.details.map((d) => (
                          <li key={`${d.field}-${d.reason}`} className="text-xs text-slate-700">
                            {d.message}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-xs text-slate-500">
                      Đây là lỗi, không phải kết quả rỗng — danh sách và dấu đánh dấu cũ đã được xóa.
                    </p>
                    {apiError?.code !== 'INVALID_INPUT' && (
                      <button
                        type="button"
                        onClick={() =>
                          runSearch(form, { failure: simulateServerError ? 'server' : null })
                        }
                        className="mt-3 inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
                      >
                        <RotateCcw aria-hidden="true" className="size-3.5" />
                        Thử lại
                      </button>
                    )}
                  </div>
                </div>
              )}

              {phase === 'noLocation' && (
                <div className="p-4">
                  <div className="vg-rise rounded-lg border border-slate-200 bg-white p-4 text-center">
                    <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-slate-100">
                      <Crosshair aria-hidden="true" className="size-5 text-slate-400" />
                    </span>
                    <h2 className="mt-3 text-sm font-semibold text-slate-900">
                      Chưa có vị trí xuất phát
                    </h2>
                    <p className="mt-1 text-xs text-slate-600">
                      Nhập tọa độ vào ô phía trên, hoặc chọn một điểm mẫu để xem kết quả.
                    </p>
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      {SAMPLE_ORIGINS.slice(0, 2).map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => pickSampleOrigin(o)}
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* The toggle lives outside the collapsing region: inside it, hiding the
            map would collapse the only control that brings it back. */}
        <div className="order-first flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Bản đồ</p>
          <button
            type="button"
            onClick={() => setShowMapOnMobile((v) => !v)}
            aria-expanded={showMapOnMobile}
            aria-controls="station-map"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            {showMapOnMobile ? 'Ẩn bản đồ' : 'Hiện bản đồ'}
          </button>
        </div>

        {/* ---------------------------------------------------------- the map */}
        <section
          id="station-map"
          aria-label="Bản đồ trạm"
          className={`relative order-first shrink-0 border-b border-slate-200 lg:order-none lg:h-full lg:flex-1 lg:border-b-0 ${
            showMapOnMobile ? 'h-[46vh]' : 'h-0 overflow-hidden border-b-0'
          } lg:h-full`}
        >
          {mapDegraded ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 bg-slate-200 p-6 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-white">
                <MapPinOff aria-hidden="true" className="size-5 text-warn-600" />
              </span>
              <p className="text-sm font-semibold text-slate-900">Bản đồ tạm thời gián đoạn</p>
              <p className="max-w-sm text-xs text-slate-600">
                Không tải được dịch vụ bản đồ. Danh sách trạm, chi tiết trạm và chỉ đường vẫn hoạt
                động bình thường — kết quả bên dưới không được đồng bộ với bản đồ.
              </p>
              <button
                type="button"
                onClick={() => setMapDegraded(false)}
                className="mt-1 inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
              >
                <RotateCcw aria-hidden="true" className="size-3.5" />
                Tải lại bản đồ
              </button>
            </div>
          ) : (
            <>
              <div ref={mapElRef} className="h-full w-full" />
              <div className="pointer-events-none absolute bottom-6 left-2 z-[1000] flex max-w-[calc(100%-1rem)] flex-wrap gap-2 sm:bottom-2">
                {[
                  { color: PIN_COLORS.swap, label: 'Sẵn pin' },
                  { color: PIN_COLORS.warn, label: 'Hết pin' },
                  { color: PIN_COLORS.charge, label: 'Trạm sạc' },
                  { color: PIN_COLORS.muted, label: 'Đóng / bảo trì' },
                ].map((item) => (
                  <span
                    key={item.label}
                    className="flex items-center gap-1 rounded border border-slate-200 bg-white/95 px-2 py-1 text-xs text-slate-700"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-sm"
                      style={{ background: item.color }}
                    />
                    {item.label}
                  </span>
                ))}
              </div>
              {phase === 'loading' && (
                <div className="vg-fade absolute top-2 left-1/2 z-[1000] -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">
                  <span className="flex items-center gap-2">
                    <Clock aria-hidden="true" className="size-3.5" />
                    Đang cập nhật trạm…
                  </span>
                </div>
              )}
              {!query && phase !== 'loading' && (
                <div className="pointer-events-none absolute inset-0 z-[900] flex items-center justify-center p-6">
                  <p className="vg-fade rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-center text-xs text-slate-600">
                    Chọn vị trí xuất phát để xem các trạm trên bản đồ.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {drawerId && (
        <DetailDrawer
          stationId={drawerId}
          query={query ?? { family_code: form.family_code }}
          onClose={() => setDrawerId(null)}
        />
      )}
    </div>
  )
}
