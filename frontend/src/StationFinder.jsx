import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, BatteryCharging, Clock, Crosshair, Info, Loader2, MapPin, MapPinOff, RotateCcw, Search, Zap } from 'lucide-react'
import DetailDrawer from './DetailDrawer.jsx'
import StationCard from './StationCard.jsx'
import { DEFAULT_FORM, FAMILIES, FAMILY_CODES, SAMPLE_ORIGINS } from './lib/searchOptions.js'
import { validateSearchField } from './lib/formFields.js'
import { PIN_COLORS } from './lib/pinColor.js'

const EMPTY_STATIONS = []
const normalise = (value) => (typeof value === 'string' ? value.trim() : value)

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true

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

export default function StationFinder({
  searchStations, getStationDetail, MapView, children,
  initialForm = DEFAULT_FORM, initialNotice = null, mapUnavailable = false,
}) {
  const [form, setForm] = useState(initialForm)
  const [fieldErrors, setFieldErrors] = useState({})
  const [phase, setPhase] = useState('loading')
  const [result, setResult] = useState(null)
  const [apiError, setApiError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)
  const [drawerId, setDrawerId] = useState(null)
  const [mapDegraded, setMapDegraded] = useState(mapUnavailable)
  const [geoNotice, setGeoNotice] = useState(initialNotice)
  const [showMapOnMobile, setShowMapOnMobile] = useState(true)
  const [showLocation, setShowLocation] = useState(false)
  const [sampleOrigin, setSampleOrigin] = useState(() => SAMPLE_ORIGINS.find(
    origin => initialForm.lat && initialForm.lng && origin.lat === Number(initialForm.lat) && origin.lng === Number(initialForm.lng),
  ))

  const latRef = useRef(null)
  const cardRefs = useRef(new Map())
  const searchRequest = useRef(null)
  const locationRequest = useRef(0)
  const query = result?.query
  const stations = result?.stations ?? EMPTY_STATIONS
  const onMapError = useCallback((reason) => setMapDegraded(reason || true), [])
  const closeDrawer = useCallback(() => setDrawerId(null), [])

  /* ---------------------------------------------------------------- search */

  const runSearch = useCallback(
    async (nextForm) => {
      searchRequest.current?.abort()
      const controller = new AbortController()
      searchRequest.current = controller
      locationRequest.current += 1
      setResult(null)
      setSelectedId(null)
      setHoveredId(null)
      setPhase('loading')
      setApiError(null)
      setFieldErrors({})
      setDrawerId(null)
      setGeoNotice(null)
      const errors = {}
      for (const name of ['lat', 'lng', 'radius_km', 'family_code', 'service_type']) {
        const message = validateSearchField(name, normalise(nextForm[name]), FAMILY_CODES)
        if (message) errors[name] = message
      }
      if (Object.keys(errors).length) {
        setFieldErrors(errors)
        setApiError({ code: 'INVALID_INPUT', message: 'Hãy sửa các trường được đánh dấu.' })
        setPhase('error')
        return
      }
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
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        if (!res.ok) {
          // A 4xx/5xx is never shown as an empty result (AE-05): stale rows go.
          setApiError(res.body.error)
          setFieldErrors(
            Object.fromEntries((res.body.error.details ?? []).map((d) => [d.field, d.message])),
          )
          setPhase('error')
          return
        }
        setResult(res.body)
        setPhase(res.body.stations.length === 0 ? 'empty' : 'results')
      } catch (err) {
        if (controller.signal.aborted) return
        setApiError({ code: 'NETWORK', message: err.message })
        setPhase('network')
      }
    },
    [searchStations],
  )

  useEffect(() => {
    if (initialNotice) setPhase('noLocation')
    else runSearch(initialForm)
    return () => {
      searchRequest.current?.abort()
      locationRequest.current += 1
    }
  }, [runSearch, initialForm, initialNotice])

  const onSubmit = (event) => {
    event.preventDefault()
    runSearch(form)
  }

  // Errors clear the moment the field is edited, and are raised again on blur —
  // never while the driver is still typing a coordinate.
  const setField = (name, value) => {
    locationRequest.current += 1
    const next = { ...form, [name]: value }
    setForm(next)
    setGeoNotice(null)
    if (['family_code', 'service_type', 'only_open'].includes(name)) {
      runSearch(next)
    } else {
      if (name === 'lat' || name === 'lng') setSampleOrigin(null)
      searchRequest.current?.abort()
      setResult(null)
      setPhase('editing')
    }
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

  const useBrowserLocation = () => {
    searchRequest.current?.abort()
    const attempt = ++locationRequest.current
    setSampleOrigin(null)
    setForm({ ...form, lat: '', lng: '' })
    setResult(null)
    setSelectedId(null)
    setHoveredId(null)
    setDrawerId(null)
    setFieldErrors({})
    setPhase('noLocation')
    const unavailable = (message) => {
      if (attempt !== locationRequest.current) return
      setGeoNotice(message + ' Hãy nhập tọa độ thủ công hoặc chọn điểm mẫu.')
      latRef.current?.focus()
    }
    if (!navigator.geolocation) {
      unavailable('Trình duyệt này không hỗ trợ định vị.')
      return
    }
    setGeoNotice('Đang chờ vị trí từ trình duyệt…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (attempt !== locationRequest.current) return
        setGeoNotice(null)
        const next = { ...form, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }
        setForm(next)
        runSearch(next)
      },
      (error) => unavailable(error.code === 1 ? 'Quyền vị trí bị từ chối.' :
        error.code === 3 ? 'Hết thời gian chờ vị trí.' : 'Không lấy được vị trí.'),
      { timeout: 8000 },
    )
  }

  const pickSampleOrigin = (origin) => {
    setSampleOrigin(origin)
    const next = { ...form, lat: origin.lat.toFixed(4), lng: origin.lng.toFixed(4) }
    setForm(next)
    runSearch(next)
  }

  const widenRadius = () => {
    const next = { ...form, radius_km: '' }
    setForm(next)
    runSearch(next)
  }

  useEffect(() => {
    cardRefs.current.get(selectedId)?.scrollIntoView({
      block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
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

  const selectStation = useCallback((id) => {
    setSelectedId(id)
    setDrawerId(id)
  }, [])

  /* ------------------------------------------------------------------ view */

  // A validation error or a missing origin forces the fields back into view.
  const locationOpen =
    showLocation || Boolean(fieldErrors.lat) || Boolean(fieldErrors.lng) || phase === 'noLocation'

  const resultSummary =
    phase === 'results'
      ? `${result.total} trạm phù hợp${query.radius_km ? ` trong bán kính ${query.radius_km} km` : ''}`
      : { loading: 'Đang tìm trạm…', empty: 'Không có trạm nào phù hợp' }[phase] ?? ''

  return (
    <div className="flex min-h-full flex-col bg-slate-100 text-slate-900 lg:h-full lg:overflow-hidden">
      <a
        href="#station-list"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[1300] focus:m-2 focus:rounded focus:bg-slate-900 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Bỏ qua tới danh sách trạm
      </a>

      {/* BR-01 — simulation disclaimer, always visible. */}
      <div className="sticky top-0 z-[1100] flex shrink-0 items-center gap-2 bg-slate-900 px-4 py-2 text-xs text-slate-200">
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
            </div>
          </div>
        </div>
        {children}
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ------------------------------------------------ sidebar: filters */}
        <aside className="flex min-h-0 flex-col overflow-y-auto border-slate-200 bg-white lg:h-full lg:w-[440px] lg:shrink-0 lg:border-r">
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
                      className={`flex cursor-pointer items-center justify-center focus-within:ring-2 gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
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
                aria-describedby={fieldErrors.family_code ? 'err-family' : undefined}
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
                  <p className="text-xs text-slate-500">Vị trí xuất phát {sampleOrigin && `· Điểm mẫu ${sampleOrigin.label}`}</p>
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
          <div className="flex min-h-40 flex-col lg:flex-1 lg:overflow-hidden">
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
              {phase === 'loading' && <SkeletonList />}
              {phase === 'editing' && <p className="p-4 text-sm text-slate-600">Nhấn Tìm trạm để áp dụng thay đổi.</p>}

              {phase === 'results' && (
                <ul className="space-y-2 p-3" onKeyDown={onListKeyDown}>
                  {stations.map((station, i) => (
                    <StationCard
                      key={station.station_id}
                      index={i}
                      station={station}
                      familyCode={query.family_code}
                      hovered={hoveredId === station.station_id}
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
                        Tìm không giới hạn bán kính
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
                      Danh sách và dấu trạm sẽ cập nhật sau khi tìm kiếm thành công.
                    </p>
                    {apiError?.code !== 'INVALID_INPUT' && (
                      <button
                        type="button"
                        onClick={() =>
                          runSearch(form)
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
                {typeof mapDegraded === 'string' ? mapDegraded : 'Không tải được dịch vụ bản đồ.'}
                {' '}Bạn vẫn có thể tìm trạm, xem chi tiết và mở chỉ đường từ danh sách.
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
              <MapView query={query} stations={stations} selectedId={selectedId} hoveredId={hoveredId}
                onSelect={selectStation} onHover={setHoveredId} onError={onMapError} />
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
          key={drawerId}
          getStationDetail={getStationDetail}
          stationId={drawerId}
          query={query}
          onClose={closeDrawer}
        />
      )}
    </div>
  )
}
