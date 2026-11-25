import { useEffect, useRef } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'

export function CancelOrderDialog({ reservation, busy, onClose, onConfirmCancel }) {
  const cancelBtnRef = useRef(null)

  useEffect(() => {
    cancelBtnRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  if (!reservation) return null

  return (
    <div
      className="vg-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-dialog-title"
        aria-describedby="cancel-dialog-desc"
        className="vg-rise w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-stop-700">
            <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />
            <h2 id="cancel-dialog-title" className="text-base font-semibold text-slate-900">
              Hủy đơn đặt pin?
            </h2>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Đóng hộp thoại hủy đơn"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div id="cancel-dialog-desc" className="mt-3 space-y-2 text-sm text-slate-700">
          <p>
            Bạn sắp hủy lượt giữ <strong className="font-semibold text-slate-900">1 pin</strong>{' '}
            nhóm <span className="num font-semibold">{reservation.family_code}</span> tại{' '}
            <span className="num font-semibold">{reservation.station.station_id}</span> ·{' '}
            {reservation.station.name}.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
            <li>
              Mã đơn:{' '}
              <span className="num font-medium text-slate-800">{reservation.reservation_id}</span>
            </li>
            <li>
              Thao tác này không thể hoàn tác. 1 pin sẽ được hoàn lại tồn kho trạm{' '}
              <strong className="font-medium text-slate-800">đúng một lần</strong> (BR-09).
            </li>
            <li>
              Nếu đơn đã vượt mốc hết hạn theo giờ máy chủ tại thời điểm xử lý, trạng thái sẽ được
              đối soát thành <span className="num font-medium">EXPIRED</span> thay vì{' '}
              <span className="num font-medium">CANCELLED</span> (AE-16b).
            </li>
          </ul>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelBtnRef}
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-[40px] rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Giữ lại đơn
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirmCancel(reservation.reservation_id)}
            className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-md bg-stop-600 px-4 py-2 text-sm font-semibold text-white hover:bg-stop-700 disabled:opacity-60"
          >
            {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Xác nhận hủy đơn
          </button>
        </div>
      </div>
    </div>
  )
}
