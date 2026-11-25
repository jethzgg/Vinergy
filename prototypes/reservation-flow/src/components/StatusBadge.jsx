import { Ban, CheckCircle2, Clock, Hourglass, Wrench, XCircle } from 'lucide-react'

const ORDER_META = {
  ACTIVE: {
    label: 'Đang giữ pin',
    code: 'ACTIVE',
    icon: CheckCircle2,
    cls: 'border-swap-200 bg-swap-50 text-swap-700',
  },
  CANCELLED: {
    label: 'Đã hủy',
    code: 'CANCELLED',
    icon: XCircle,
    cls: 'border-slate-300 bg-slate-100 text-slate-700',
  },
  EXPIRED: {
    label: 'Hết hạn',
    code: 'EXPIRED',
    icon: Hourglass,
    cls: 'border-warn-200 bg-warn-50 text-warn-700',
  },
}

const STATION_META = {
  OPEN: { label: 'Đang mở', icon: CheckCircle2, cls: 'text-swap-700' },
  CLOSED: { label: 'Đóng cửa', icon: Ban, cls: 'text-stop-700' },
  MAINTENANCE: { label: 'Bảo trì', icon: Wrench, cls: 'text-warn-700' },
}

export function OrderStatusBadge({ status, showCode = false }) {
  const meta = ORDER_META[status] ?? ORDER_META.EXPIRED
  const Icon = meta.icon
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold ${meta.cls}`}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{meta.label}</span>
      {showCode && <span className="num text-[11px] opacity-80">({meta.code})</span>}
    </span>
  )
}

export function StationStatusInline({ status }) {
  const meta = STATION_META[status] ?? STATION_META.CLOSED
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${meta.cls}`}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{meta.label}</span>
    </span>
  )
}

export function formatCountdown(expiresAtIso, nowMs) {
  const diffSec = Math.max(0, Math.floor((Date.parse(expiresAtIso) - nowMs) / 1000))
  const mins = Math.floor(diffSec / 60)
  const secs = diffSec % 60
  return {
    diffSec,
    expired: diffSec <= 0,
    text: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
  }
}

export function formatUtcTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss} UTC`
}

export function CountdownPill({ expiresAt, nowMs, label = 'Còn lại' }) {
  const { diffSec, expired, text } = formatCountdown(expiresAt, nowMs)
  const tone = expired
    ? 'border-stop-200 bg-stop-50 text-stop-700'
    : diffSec <= 60
      ? 'border-warn-200 bg-warn-50 text-warn-700'
      : 'border-swap-200 bg-swap-50 text-swap-700'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${tone}`}>
      <Clock aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{expired ? 'Đã quá hạn' : `${label}:`}</span>
      {!expired && <span className="num font-semibold">{text}</span>}
    </span>
  )
}
