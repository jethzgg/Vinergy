import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Navigation, X } from 'lucide-react'
import { ServiceBadges, StatusLine } from './StationCard.jsx'
import { FAMILIES } from './lib/searchOptions.js'
import { INELIGIBILITY_TEXT } from './lib/formFields.js'
export default function DetailDrawer({ stationId, query, onClose, getStationDetail }) {
  const [state, setState] = useState({ loading: true, station: null, error: null })
  const [attempt, setAttempt] = useState(0)
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const titleId = useId()

  useEffect(() => {
    let alive = true
    setState({ loading: true, station: null, error: null })
    const controller = new AbortController()
    getStationDetail(stationId, {
      family_code: query?.family_code,
      lat: query?.lat,
      lng: query?.lng,
    }, { signal: controller.signal })
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
      controller.abort()
    }
  }, [stationId, query, attempt, getStationDetail])

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
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([station.coordinates.lat, station.coordinates.lng].join(','))}`
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
            <p className="num text-xs font-semibold tracking-wide text-slate-500">{stationId} · Dữ liệu mô phỏng</p>
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
            <div role="alert" className="rounded-md border border-stop-200 bg-stop-50 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-stop-700">
                <AlertTriangle aria-hidden="true" className="size-4" />
                {state.error.code === 'STATION_NOT_FOUND' ? 'Không tìm thấy trạm' : 'Không tải được chi tiết trạm'}
              </p>
              <p className="mt-1 text-sm text-slate-700">{state.error.message}</p>
              {state.error.code !== 'STATION_NOT_FOUND' && (
                <button type="button" className="mt-2 rounded border px-3 py-2" onClick={() => setAttempt((n) => n + 1)}>Thử lại</button>
              )}
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
                <p className="mt-1 text-sm text-slate-700">
                  {station.booking_eligible === true
                    ? `Đủ điều kiện đổi pin ${familyCode}.`
                    : INELIGIBILITY_TEXT[station.ineligibility_reason] ?? 'Chưa xét điều kiện đặt.'}
                </p>
                <button type="button" disabled className="mt-3 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-500">
                  Đặt giữ pin · chưa khả dụng (Sprint 2)
                </button>
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
