import { useEffect, useRef } from 'react'
import {
  BatteryCharging,
  Clock,
  Info,
  KeyRound,
  Loader2,
  Lock,
  MapPin,
  ShieldCheck,
  X,
} from 'lucide-react'
import { FAMILIES } from '../lib/reservationApi.js'
import { ErrorBanner } from './ErrorBanner.jsx'
import { CountdownPill, formatCountdown, formatUtcTime } from './StatusBadge.jsx'

export function ConfirmDraftModal({
  draft,
  sessionUser,
  idempotencyKey,
  nowMs,
  submitting,
  confirmError,
  faultMode,
  onFaultModeChange,
  onClose,
  onConfirm,
  onRetrySameKey,
  onCreateFreshDraft,
  onFindNearest,
  onRestoreSession,
  onViewOrders,
}) {
  const closeBtnRef = useRef(null)

  useEffect(() => {
    closeBtnRef.current?.focus()
  }, [draft?.draft_id])

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [submitting, onClose])

  if (!draft) return null

  const familyMeta = FAMILIES.find((f) => f.family_code === draft.family_code)
  const countdown = formatCountdown(draft.expires_at, nowMs)
  const isUnknownOutcome =
    confirmError?.code === 'UNKNOWN_OUTCOME' || confirmError?.code === 'REQUEST_IN_PROGRESS'
  const canConfirm = !submitting && !countdown.expired && !isUnknownOutcome

  // API v2.2 §6.3 & §6.12 #3: read draft.hold_minutes directly; never hard-code a 15-minute fallback.
  const hasHoldMinutes = typeof draft.hold_minutes === 'number' && Number.isFinite(draft.hold_minutes)

  return (
    <div
      className="vg-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-draft-title"
        aria-describedby="confirm-draft-notice"
        className="vg-rise max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="confirm-draft-title" className="text-base font-semibold text-slate-900">
              Xác nhận đặt 1 pin đổi
            </h2>
            <p id="confirm-draft-notice" className="mt-0.5 text-xs text-slate-500">
              Dữ liệu mô phỏng — việc đặt pin không có hiệu lực tại các trạm thực tế.
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Đóng hộp thoại xác nhận"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        {/* BR-06 / AE-09: Draft holds no stock */}
        <div className="mt-3 flex items-start gap-2 rounded-md border border-charge-200 bg-charge-50 px-3 py-2 text-xs text-charge-700">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong className="font-semibold">Bản nháp chưa giữ tồn kho.</strong> 1 pin chỉ được
            trừ nguyên tử khi bạn nhấn <em>“Xác nhận đặt 1 pin”</em> và máy chủ trả về mã đơn.
          </p>
        </div>

        {/* Station summary (§6.3 nested draft.station) */}
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <MapPin aria-hidden="true" className="size-3.5" />
              Trạm đổi pin
            </span>
            <span className="num rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
              {draft.status}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            <span className="num">{draft.station.station_id}</span> · {draft.station.name}
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            {draft.station.area_label}
            {draft.station.distance_display ? (
              <>
                {' · '}
                <span className="num font-medium text-slate-800">
                  {draft.station.distance_display}
                </span>{' '}
                đường thẳng
              </>
            ) : null}
          </p>
          <p className="mt-1.5 text-xs text-slate-600">
            Tồn kho hiện tại ({draft.family_code}):{' '}
            <span className="num font-semibold text-swap-700">
              {draft.available_batteries ?? '—'} pin khả dụng
            </span>
          </p>
        </div>

        {/* Battery family & fixed quantity (BR-05) */}
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
              <BatteryCharging aria-hidden="true" className="size-3.5 text-swap-600" />
              Nhóm pin tương thích
            </span>
            <p className="num mt-1 text-sm font-semibold text-slate-900">{draft.family_code}</p>
            <p className="text-xs text-slate-500">{familyMeta?.label ?? 'Nhóm pin giả lập'}</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
              <Lock aria-hidden="true" className="size-3.5 text-slate-500" />
              Số lượng (BR-05)
            </span>
            <p className="num mt-1 text-sm font-semibold text-slate-900">
              {draft.quantity} pin{' '}
              <span className="font-sans text-xs font-normal text-slate-500">(cố định)</span>
            </p>
            <p className="text-xs text-slate-500">Chỉ cho phép đặt đúng 1 pin mỗi đơn</p>
          </div>
        </div>

        {/* Draft expiry & server-provided draft.hold_minutes (§6.3) */}
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <Clock aria-hidden="true" className="size-3.5 text-slate-500" />
              Thời hạn bản nháp (BR-06)
            </span>
            <CountdownPill expiresAt={draft.expires_at} nowMs={nowMs} label="Hiệu lực còn" />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-1 text-xs text-slate-600">
            <span>
              Hết hạn bản nháp:{' '}
              <span className="num font-medium text-slate-800">{formatUtcTime(draft.expires_at)}</span>
            </span>
            <span>
              Thời lượng giữ pin sau xác nhận:{' '}
              {hasHoldMinutes ? (
                <span className="num font-medium text-slate-800">{draft.hold_minutes} phút</span>
              ) : (
                <span className="font-medium text-warn-700">Chưa có thông tin từ máy chủ</span>
              )}
            </span>
          </div>
        </div>

        {/* Draft metadata & idempotency key */}
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Bản nháp: <span className="num font-medium text-slate-800">{draft.draft_id}</span>
            </span>
            {sessionUser && (
              <span>
                Phiên: <span className="num font-medium text-slate-800">{sessionUser}</span>
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <KeyRound aria-hidden="true" className="size-3 shrink-0 text-slate-500" />
            <span className="truncate">
              Idempotency-Key: <span className="num font-medium text-slate-800">{idempotencyKey}</span>
            </span>
          </div>
        </div>

        {/* Review fault injection toggle */}
        <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50/70 px-3 py-2 text-xs">
          <label htmlFor="fault-mode-select" className="font-medium text-slate-700">
            Mô phỏng sự cố khi xác nhận (rà soát):
          </label>
          <select
            id="fault-mode-select"
            value={faultMode}
            onChange={(e) => onFaultModeChange(e.target.value)}
            disabled={submitting}
            className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
          >
            <option value="none">Bình thường (201 Created)</option>
            <option value="lost_response_after_commit">
              Mất phản hồi sau khi máy chủ đã giữ pin (AE-11 / AE-21)
            </option>
            <option value="server">Lỗi máy chủ 500 INTERNAL_ERROR</option>
          </select>
        </div>

        {/* Local expiry notice when timer hits 00:00 */}
        {countdown.expired && !confirmError && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-warn-200 bg-warn-50 p-3 text-xs text-warn-700"
          >
            <p className="font-semibold">Bản nháp đã hết hiệu lực theo đồng hồ máy chủ.</p>
            <p className="mt-0.5 text-slate-700">
              Bạn có thể thử gửi xác nhận để xem phản hồi{' '}
              <span className="num">409 DRAFT_STALE (DRAFT_EXPIRED)</span> hoặc tạo bản nháp mới ngay.
            </p>
          </div>
        )}

        {/* API / Stock / Draft / Unknown Outcome errors */}
        {confirmError && (
          <div className="mt-3">
            <ErrorBanner
              error={confirmError}
              busy={submitting}
              onRetrySameKey={onRetrySameKey}
              onCreateFreshDraft={onCreateFreshDraft}
              onFindNearest={onFindNearest}
              onRestoreSession={onRestoreSession}
              onViewOrders={onViewOrders}
              onRetry={onConfirm}
            />
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="min-h-[42px] rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Quay lại
          </button>
          <button
            type="button"
            disabled={!canConfirm && !countdown.expired}
            onClick={onConfirm}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-md bg-swap-600 px-4 py-2 text-sm font-semibold text-white hover:bg-swap-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                Đang xác nhận nguyên tử…
              </>
            ) : (
              <>
                <ShieldCheck aria-hidden="true" className="size-4" />
                Xác nhận đặt 1 pin
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
