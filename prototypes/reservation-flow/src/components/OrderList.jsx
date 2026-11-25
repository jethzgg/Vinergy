import { ClipboardList, PlusCircle, RefreshCw } from 'lucide-react'
import { ErrorBanner } from './ErrorBanner.jsx'
import { CountdownPill, OrderStatusBadge, formatUtcTime } from './StatusBadge.jsx'

const FILTER_TABS = [
  { id: 'ALL', label: 'Tất cả' },
  { id: 'ACTIVE', label: 'Đang giữ' },
  { id: 'CANCELLED', label: 'Đã hủy' },
  { id: 'EXPIRED', label: 'Hết hạn' },
]

export function OrderList({
  session,
  orders,
  filter,
  selectedOrderId,
  loading,
  error,
  nowMs,
  onFilterChange,
  onSelectOrder,
  onRefresh,
  onCreateFirstDraft,
  onRestoreSession,
}) {
  const counts = {
    ALL: orders.length,
    ACTIVE: orders.filter((o) => o.status === 'ACTIVE').length,
    CANCELLED: orders.filter((o) => o.status === 'CANCELLED').length,
    EXPIRED: orders.filter((o) => o.status === 'EXPIRED').length,
  }

  const visible = filter === 'ALL' ? orders : orders.filter((o) => o.status === filter)

  return (
    <section
      aria-labelledby="orders-list-heading"
      className="flex flex-col rounded-lg border border-slate-200 bg-white"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 id="orders-list-heading" className="text-sm font-semibold text-slate-900">
            Đơn của tôi ({session?.expired ? 'Hết phiên' : session?.demo_user})
          </h2>
          <p className="text-xs text-slate-500">Chỉ hiển thị đơn thuộc phiên hiện tại (BR-10)</p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          aria-label="Làm mới danh sách đơn từ máy chủ"
          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw aria-hidden="true" className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </button>
      </div>

      {/* Status filter tabs */}
      <div
        role="tablist"
        aria-label="Lọc đơn theo trạng thái"
        className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 px-3 py-2"
      >
        {FILTER_TABS.map((tab) => {
          const active = filter === tab.id
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onFilterChange(tab.id)}
              className={`min-h-[32px] rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-200/70'
              }`}
            >
              {tab.label} <span className="num opacity-80">({counts[tab.id]})</span>
            </button>
          )
        })}
      </div>

      <div className="min-h-[260px] flex-1 bg-slate-50/70 p-3">
        {error ? (
          <ErrorBanner error={error} onRestoreSession={onRestoreSession} onRetry={onRefresh} />
        ) : loading && orders.length === 0 ? (
          <div role="status" aria-busy="true" className="space-y-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg border border-slate-200 bg-white p-3"
              />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div
            role="status"
            className="vg-rise flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-8 text-center"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-slate-100">
              <ClipboardList aria-hidden="true" className="size-5 text-slate-400" />
            </span>
            <h3 className="mt-3 text-sm font-semibold text-slate-900">
              {orders.length === 0
                ? `Chưa có đơn nào trong phiên ${session?.demo_user ?? ''}`
                : 'Không có đơn thuộc trạng thái này'}
            </h3>
            <p className="mt-1 max-w-xs text-xs text-slate-600">
              {orders.length === 0
                ? 'Tạo bản nháp và xác nhận đặt 1 pin ở khung phía trên để xem vòng đời đơn.'
                : 'Chọn tab "Tất cả" để xem các đơn ở trạng thái khác.'}
            </p>
            {orders.length === 0 && (
              <button
                type="button"
                onClick={onCreateFirstDraft}
                className="mt-3 inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-swap-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-swap-700"
              >
                <PlusCircle aria-hidden="true" className="size-3.5" />
                Tạo bản nháp ST-01
              </button>
            )}
          </div>
        ) : (
          <ul role="list" className="space-y-2">
            {visible.map((order) => {
              const selected = order.reservation_id === selectedOrderId
              return (
                <li key={order.reservation_id}>
                  <button
                    type="button"
                    onClick={() => onSelectOrder(order.reservation_id)}
                    aria-current={selected ? 'true' : undefined}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      selected
                        ? 'border-slate-900 bg-white ring-1 ring-slate-900'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="num truncate text-xs font-semibold text-slate-900">
                        {order.reservation_id}
                      </span>
                      <OrderStatusBadge status={order.status} />
                    </div>
                    <p className="mt-1 text-xs font-medium text-slate-800">
                      <span className="num">{order.station.station_id}</span> · {order.station.name}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                      <span>
                        <span className="num font-semibold text-slate-800">{order.family_code}</span>{' '}
                        · <span className="num">{order.quantity}</span> pin
                      </span>
                      {order.status === 'ACTIVE' ? (
                        <CountdownPill expiresAt={order.expires_at} nowMs={nowMs} label="Còn" />
                      ) : order.status === 'CANCELLED' ? (
                        <span className="num text-[11px] text-slate-500">
                          Hủy: {formatUtcTime(order.cancelled_at)}
                        </span>
                      ) : (
                        <span className="num text-[11px] text-warn-700">
                          Hết hạn: {formatUtcTime(order.expired_at ?? order.expires_at)}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
