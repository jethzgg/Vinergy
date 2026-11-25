import {
  BatteryCharging,
  Clock,
  FastForward,
  Info,
  RotateCcw,
  ShieldOff,
  Timer,
  User,
} from 'lucide-react'
import { DEMO_USERS } from '../lib/reservationApi.js'
import { formatUtcTime } from './StatusBadge.jsx'

const HOLD_MINUTE_OPTIONS = [10, 15, 25, 30]

export function DemoHeader({
  session,
  serverTime,
  holdMinutes,
  onSelectUser,
  onExpireSession,
  onAdvanceClock,
  onChangeHoldMinutes,
  onResetAll,
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-swap-600 text-white">
            <BatteryCharging aria-hidden="true" className="size-4" />
          </span>
          <div>
            <h1 className="text-sm font-semibold text-slate-900">
              Vinergy — Đặt pin &amp; Quản lý đơn
            </h1>
            <p className="text-xs text-slate-500">
              WBS 2.1.2 · Nguyên mẫu xác nhận, xem và hủy đơn (API v2.2)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
            <User aria-hidden="true" className="size-3.5 text-slate-500" />
            <label htmlFor="demo-user-select" className="text-slate-600">
              Phiên:
            </label>
            <select
              id="demo-user-select"
              value={session?.expired ? 'EXPIRED' : (session?.demo_user ?? '')}
              onChange={(e) => {
                if (e.target.value === 'EXPIRED') onExpireSession()
                else onSelectUser(e.target.value)
              }}
              className="num rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-900"
            >
              {DEMO_USERS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
              <option value="EXPIRED">Hết hạn (401)</option>
            </select>
            {session?.expired && (
              <ShieldOff aria-label="Phiên đã hết hạn" className="size-3.5 text-stop-600" />
            )}
          </div>

          <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
            <Timer aria-hidden="true" className="size-3.5 text-slate-500" />
            <label htmlFor="server-hold-minutes" className="text-slate-600">
              Giữ pin:
            </label>
            <select
              id="server-hold-minutes"
              value={holdMinutes}
              onChange={(e) => onChangeHoldMinutes(Number(e.target.value))}
              className="num rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-900"
              title="Cấu hình RESERVATION_HOLD_MINUTES của máy chủ mô phỏng (trả trong draft.hold_minutes)"
            >
              {HOLD_MINUTE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}p
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
            <Clock aria-hidden="true" className="size-3.5 text-slate-500" />
            <span className="num font-medium text-slate-800" title="Đồng hồ máy chủ mô phỏng">
              {formatUtcTime(serverTime)}
            </span>
            <button
              type="button"
              onClick={() => onAdvanceClock(5 * 60)}
              className="ml-1 inline-flex items-center gap-0.5 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
              title="Tua đồng hồ máy chủ thêm 5 phút (hết hạn bản nháp)"
            >
              <FastForward aria-hidden="true" className="size-3" />
              +5p
            </button>
            <button
              type="button"
              onClick={() => onAdvanceClock(15 * 60)}
              className="inline-flex items-center gap-0.5 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
              title="Tua đồng hồ máy chủ thêm 15 phút (hết hạn đơn giữ pin)"
            >
              <FastForward aria-hidden="true" className="size-3" />
              +15p
            </button>
          </div>

          <button
            type="button"
            onClick={onResetAll}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            Đặt lại mẫu
          </button>
        </div>
      </div>

      {/* BR-01 mandatory simulated data notice */}
      <div className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5 text-xs text-slate-600">
          <Info aria-hidden="true" className="size-3.5 shrink-0 text-slate-500" />
          <p>
            <strong className="font-semibold text-slate-800">
              Dữ liệu mô phỏng — việc đặt pin không có hiệu lực tại các trạm thực tế.
            </strong>{' '}
            Thời lượng giữ pin hiển thị trực tiếp từ <span className="num">draft.hold_minutes</span>{' '}
            do máy chủ trả về (không mặc định 15 phút ở phía trình duyệt).
          </p>
        </div>
      </div>
    </header>
  )
}
