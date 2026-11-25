import { AlertTriangle, RefreshCw, RotateCcw, Search, ShieldAlert, WifiOff } from 'lucide-react'

const ERROR_HEADINGS = {
  STATION_NOT_ELIGIBLE: 'Trạm không còn đủ điều kiện đặt pin',
  NO_ELIGIBLE_STATION: 'Không tìm thấy trạm đổi pin khả dụng',
  DRAFT_STALE: 'Bản nháp đã hết hiệu lực',
  DRAFT_ALREADY_USED: 'Bản nháp đã được sử dụng',
  IDEMPOTENCY_KEY_REUSED: 'Xung đột khóa chống xử lý lặp',
  REQUEST_IN_PROGRESS: 'Yêu cầu xác nhận đang được xử lý',
  SESSION_EXPIRED: 'Phiên demo đã hết hạn',
  SESSION_REQUIRED: 'Chưa chọn phiên người dùng demo',
  RESERVATION_NOT_FOUND: 'Không tìm thấy đơn trong phiên hiện tại',
  DRAFT_NOT_FOUND: 'Không tìm thấy bản nháp trong phiên hiện tại',
  INVALID_INPUT: 'Thông tin đặt pin chưa hợp lệ',
  INTERNAL_ERROR: 'Dịch vụ đang gặp sự cố',
  UNKNOWN_OUTCOME: 'Chưa rõ kết quả xác nhận (mất phản hồi)',
}

export function ErrorBanner({
  error,
  onRetrySameKey,
  onCreateFreshDraft,
  onFindNearest,
  onRestoreSession,
  onViewOrders,
  onRetry,
  busy = false,
}) {
  if (!error) return null

  const code = error.code ?? 'INTERNAL_ERROR'
  const isUnknown = code === 'UNKNOWN_OUTCOME' || code === 'REQUEST_IN_PROGRESS'
  const isAuth = code === 'SESSION_EXPIRED' || code === 'SESSION_REQUIRED'
  const isStock = code === 'STATION_NOT_ELIGIBLE' || code === 'NO_ELIGIBLE_STATION'
  const isDraft =
    code === 'DRAFT_STALE' ||
    code === 'DRAFT_ALREADY_USED' ||
    code === 'DRAFT_NOT_FOUND' ||
    code === 'IDEMPOTENCY_KEY_REUSED'

  const tone = isUnknown
    ? 'border-warn-200 bg-warn-50 text-warn-700'
    : 'border-stop-200 bg-stop-50 text-stop-700'

  const Icon = isUnknown ? WifiOff : isAuth ? ShieldAlert : AlertTriangle

  return (
    <div role="alert" className={`vg-rise rounded-lg border p-3.5 text-left ${tone}`}>
      <p className="flex items-start gap-2 text-sm font-semibold">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{ERROR_HEADINGS[code] ?? 'Không thể hoàn tất thao tác'}</span>
      </p>
      <p className="mt-1 text-sm text-slate-800">{error.message}</p>

      {Array.isArray(error.details) && error.details.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-700">
          {error.details.map((d, idx) => (
            <li key={`${d.field}-${d.reason}-${idx}`}>
              <span className="num font-medium">{d.field}</span>: {d.message}
            </li>
          ))}
        </ul>
      )}

      {isUnknown && (
        <p className="mt-2 text-xs text-slate-700">
          Theo BR-08 / FR-12, không tự tạo khóa mới hoặc mặc định thất bại. Hãy đối soát bằng đúng{' '}
          <span className="num font-medium">Idempotency-Key</span> cũ để nhận lại đơn gốc nếu máy
          chủ đã ghi nhận.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {isUnknown && onRetrySameKey && (
          <button
            type="button"
            disabled={busy}
            onClick={onRetrySameKey}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
            Đối soát bằng khóa cũ
          </button>
        )}
        {(isUnknown || code === 'DRAFT_ALREADY_USED') && onViewOrders && (
          <button
            type="button"
            onClick={onViewOrders}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
          >
            Kiểm tra Đơn của tôi
          </button>
        )}
        {isStock && onFindNearest && (
          <button
            type="button"
            disabled={busy}
            onClick={onFindNearest}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-swap-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-swap-700 disabled:opacity-60"
          >
            <Search aria-hidden="true" className="size-3.5" />
            Tìm trạm gần nhất còn pin
          </button>
        )}
        {isDraft && onCreateFreshDraft && (
          <button
            type="button"
            disabled={busy}
            onClick={onCreateFreshDraft}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            Tạo bản nháp mới
          </button>
        )}
        {isAuth && onRestoreSession && (
          <button
            type="button"
            onClick={onRestoreSession}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Khôi phục phiên demo
          </button>
        )}
        {code === 'INTERNAL_ERROR' && onRetry && (
          <button
            type="button"
            disabled={busy}
            onClick={onRetry}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            Thử lại
          </button>
        )}
      </div>
    </div>
  )
}
