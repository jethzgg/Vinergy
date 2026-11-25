import { Battery, Compass, PlusCircle } from 'lucide-react'
import { FAMILY_CODES, INELIGIBILITY_TEXT, evaluateBooking } from '../lib/reservationApi.js'
import { StationStatusInline } from './StatusBadge.jsx'

const FEATURED_STATION_IDS = ['ST-01', 'ST-03', 'ST-05', 'ST-02', 'ST-09', 'ST-13']

export function StationBookingBar({
  stations,
  selectedStationId,
  familyCode,
  onSelectStation,
  onSelectFamily,
  onPrepareDraft,
  onPrepareNearest,
  busy,
}) {
  const featured = FEATURED_STATION_IDS.map((id) =>
    stations.find((s) => s.station_id === id),
  ).filter(Boolean)

  const currentStation = stations.find((s) => s.station_id === selectedStationId) ?? featured[0]
  const verdict = currentStation
    ? evaluateBooking(currentStation, familyCode)
    : { booking_eligible: false, ineligibility_reason: 'OUT_OF_STOCK' }

  const stock = currentStation?.available_batteries_by_family?.[familyCode]

  return (
    <section
      aria-labelledby="quick-book-heading"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="quick-book-heading" className="text-sm font-semibold text-slate-900">
            Chuẩn bị bản nháp đặt 1 pin (UC-02 · BR-05, BR-06)
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Chọn trạm đổi pin hoặc dùng chế độ trạm gần nhất đủ điều kiện. Bản nháp{' '}
            <strong className="font-medium text-slate-800">chưa giữ tồn kho</strong> cho tới khi xác
            nhận.
          </p>
        </div>

        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Chọn nhóm pin</legend>
          {FAMILY_CODES.map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={familyCode === code}
              onClick={() => onSelectFamily(code)}
              className={`num min-h-[34px] rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
                familyCode === code
                  ? 'border-swap-600 bg-swap-50 text-swap-700'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {code}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {featured.map((station) => {
          const v = evaluateBooking(station, familyCode)
          const stStock = station.available_batteries_by_family?.[familyCode]
          const selected = station.station_id === currentStation?.station_id
          return (
            <button
              key={station.station_id}
              type="button"
              onClick={() => onSelectStation(station.station_id)}
              aria-pressed={selected}
              className={`flex flex-col items-start rounded-md border p-2.5 text-left transition-colors ${
                selected
                  ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
              }`}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="num text-xs font-semibold text-slate-900">
                  {station.station_id}
                </span>
                <StationStatusInline status={station.opening_status} />
              </div>
              <span className="mt-0.5 text-xs text-slate-700">{station.name}</span>
              <div className="mt-1.5 flex w-full items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1 text-slate-600">
                  <Battery aria-hidden="true" className="size-3.5" />
                  {stStock === undefined ? (
                    <span>Không hỗ trợ đổi {familyCode}</span>
                  ) : (
                    <span className="num font-semibold text-slate-900">{stStock} pin</span>
                  )}
                </span>
                {!v.booking_eligible && (
                  <span className="text-[11px] font-medium text-warn-700">
                    {v.ineligibility_reason === 'OUT_OF_STOCK'
                      ? 'Hết pin'
                      : v.ineligibility_reason === 'CHARGING_ONLY'
                        ? 'Chỉ sạc'
                        : 'Không thể đặt'}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
        <div className="text-xs text-slate-600">
          {currentStation && (
            <>
              Đang chọn <span className="num font-semibold text-slate-900">{currentStation.station_id}</span>
              {' · '}
              {verdict.booking_eligible ? (
                <span className="text-swap-700">
                  Đủ điều kiện đổi <span className="num font-semibold">{familyCode}</span> (còn{' '}
                  <span className="num font-semibold">{stock}</span> pin)
                </span>
              ) : (
                <span className="text-stop-700">
                  {INELIGIBILITY_TEXT[verdict.ineligibility_reason]}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onPrepareNearest()}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            <Compass aria-hidden="true" className="size-3.5" />
            Trạm gần nhất đủ ĐK (từ ST-05)
          </button>
          <button
            type="button"
            disabled={busy || !currentStation}
            onClick={() => onPrepareDraft(currentStation.station_id)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-swap-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-swap-700 disabled:opacity-60"
          >
            <PlusCircle aria-hidden="true" className="size-3.5" />
            Tạo bản nháp đặt 1 pin
          </button>
        </div>
      </div>
    </section>
  )
}
