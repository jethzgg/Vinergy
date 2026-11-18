import { Ban, Battery, BatteryCharging, ChevronRight, CircleCheck, Wrench, Zap } from 'lucide-react'
import { INELIGIBILITY_TEXT } from './lib/formFields.js'
import { pinColor } from './lib/pinColor.js'
const STATUS_META = {
  OPEN: { label: 'Đang mở', icon: CircleCheck, tone: 'text-swap-600' },
  CLOSED: { label: 'Đóng cửa', icon: Ban, tone: 'text-stop-600' },
  MAINTENANCE: { label: 'Bảo trì', icon: Wrench, tone: 'text-warn-600' },
}

export function ServiceBadges({ services }) {
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

export function StatusLine({ status }) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${meta.tone}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {meta.label}
    </span>
  )
}

export default function StationCard({ station, familyCode, serviceType, hovered, selected, index, onSelect, onHover, cardRef }) {
  const batteries = station.available_batteries_by_family ?? {}
  const ports = station.available_charging_ports_by_family ?? {}
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
            : hovered ? 'border-slate-300 bg-slate-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
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
