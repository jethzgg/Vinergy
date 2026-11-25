import { useState } from 'react'
import {
  BatteryCharging,
  CheckCircle2,
  ExternalLink,
  MapPin,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { ErrorBanner } from './ErrorBanner.jsx'
import { CountdownPill, OrderStatusBadge, formatUtcTime } from './StatusBadge.jsx'

export function OrderDetailPanel({
  order,
  sessionUser,
  nowMs,
  busy,
  statusNotice,
  lookupError,
  onRefreshOrder,
  onRequestCancel,
  onLookupById,
  onRestoreSession,
}) {
  const [lookupId, setLookupId] = useState('')

  const mapsUrl = order?.station?.coordinates
    ? `https://www.google.com/maps/dir/?api=1&destination=${order.station.coordinates.lat},${order.station.coordinates.lng}`
    : null

  return (
    <section
      aria-labelledby="order-detail-heading"
      className="flex flex-col rounded-lg border border-slate-200 bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 id="order-detail-heading" className="text-sm font-semibold text-slate-900">
            Chi tiết đơn đặt pin (UC-03)
          </h2>
          <p className="text-xs text-slate-500">
            Trạng thái và mốc thời gian do máy chủ quyết định (BR-09)
          </p>
        </div>

        {/* AE-14 ownership verification input (UUID format per §6.1) */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (lookupId.trim()) onLookupById(lookupId.trim())
          }}
          className="flex items-center gap-1.5"
        >
          <label htmlFor="lookup-order-id" className="sr-only">
            Tra cứu theo UUID đơn
          </label>
          <input
            id="lookup-order-id"
            type="text"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="Tra UUID đơn (AE-14)…"
            className="num w-44 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-900 placeholder:font-sans placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={busy || !lookupId.trim()}
            className="inline-flex min-h-[30px] items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Search aria-hidden="true" className="size-3.5" />
            Xem
          </button>
        </form>
      </div>

      <div className="flex-1 p-4">
        {statusNotice && (
          <div
            role="status"
            aria-live="polite"
            className={`vg-rise mb-4 flex items-start gap-2 rounded-lg border p-3 text-xs ${
              statusNotice.tone === 'warn'
                ? 'border-warn-200 bg-warn-50 text-warn-700'
                : 'border-swap-200 bg-swap-50 text-swap-700'
            }`}
          >
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p className="text-slate-800">{statusNotice.message}</p>
          </div>
        )}

        {lookupError && (
          <div className="mb-4">
            <ErrorBanner error={lookupError} onRestoreSession={onRestoreSession} />
          </div>
        )}

        {!order ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center">
            <p className="text-sm font-medium text-slate-700">Chưa chọn đơn nào</p>
            <p className="mt-1 max-w-sm text-xs text-slate-500">
              Chọn một đơn từ danh sách bên trái để xem thời hạn giữ pin, làm mới trạng thái từ máy
              chủ hoặc hủy đơn.
            </p>
          </div>
        ) : (
          <div className="vg-rise space-y-4">
            {/* Status header */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Mã đơn đặt pin (UUID)</p>
                <p className="num mt-0.5 break-all text-sm font-semibold text-slate-900">
                  {order.reservation_id}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <OrderStatusBadge status={order.status} showCode />
                {order.status === 'ACTIVE' && (
                  <CountdownPill expiresAt={order.expires_at} nowMs={nowMs} label="Hết hạn sau" />
                )}
              </div>
            </div>

            {/* Key details grid (§6.6 nested order.station) */}
            <dl className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3.5 text-xs sm:grid-cols-2">
              <div>
                <dt className="flex items-center gap-1 text-slate-500">
                  <MapPin aria-hidden="true" className="size-3.5" />
                  Trạm đổi pin
                </dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  <span className="num">{order.station.station_id}</span> · {order.station.name}
                </dd>
                <dd className="text-slate-600">{order.station.area_label}</dd>
              </div>

              <div>
                <dt className="flex items-center gap-1 text-slate-500">
                  <BatteryCharging aria-hidden="true" className="size-3.5" />
                  Nhóm pin &amp; Số lượng
                </dt>
                <dd className="num mt-1 font-semibold text-slate-900">
                  {order.family_code} · {order.quantity} pin
                </dd>
                <dd className="text-slate-600">Chủ sở hữu phiên: {sessionUser ?? '—'}</dd>
              </div>

              <div>
                <dt className="text-slate-500">Thời điểm tạo (máy chủ)</dt>
                <dd className="num mt-1 font-medium text-slate-900">
                  {formatUtcTime(order.created_at)}
                </dd>
              </div>

              <div>
                <dt className="text-slate-500">Mốc hết hạn giữ pin (expires_at)</dt>
                <dd className="num mt-1 font-medium text-slate-900">
                  {formatUtcTime(order.expires_at)}
                </dd>
              </div>

              {order.cancelled_at && (
                <div>
                  <dt className="text-slate-500">Thời điểm hủy (cancelled_at)</dt>
                  <dd className="num mt-1 font-medium text-slate-900">
                    {formatUtcTime(order.cancelled_at)}
                  </dd>
                </div>
              )}

              {order.expired_at && (
                <div>
                  <dt className="text-slate-500">Thời điểm đối soát hết hạn (expired_at)</dt>
                  <dd className="num mt-1 font-medium text-warn-700">
                    {formatUtcTime(order.expired_at)}
                  </dd>
                </div>
              )}
            </dl>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRefreshOrder(order.reservation_id)}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                >
                  <RefreshCw aria-hidden="true" className="size-3.5" />
                  Làm mới từ máy chủ
                </button>
                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                  >
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                    Chỉ đường (Maps)
                  </a>
                )}
              </div>

              {order.status === 'ACTIVE' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRequestCancel(order)}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-stop-200 bg-stop-50 px-3.5 py-1.5 text-xs font-semibold text-stop-700 hover:bg-stop-200/50 disabled:opacity-60"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                  Hủy đơn này
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
