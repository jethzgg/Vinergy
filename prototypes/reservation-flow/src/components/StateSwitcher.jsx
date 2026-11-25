import { FlaskConical } from 'lucide-react'

export const REVIEW_SCENARIOS = [
  {
    id: 'confirm-draft',
    label: '1. Xác nhận bản nháp',
    hint: 'AE-09 / AE-10 · ST-01 · FAM_A · bản nháp chưa giữ pin',
  },
  {
    id: 'orders-active',
    label: '2. Đơn & Hủy đơn',
    hint: 'AE-15 / AE-16 · xem đơn ACTIVE, thử hủy hoặc tua +15p',
  },
  {
    id: 'stock-race',
    label: '3. Hết pin lúc xác nhận',
    hint: 'AE-13 · viên pin cuối bị giữ trước khi xác nhận (409 OUT_OF_STOCK)',
  },
  {
    id: 'draft-stale',
    label: '4. Bản nháp hết hạn',
    hint: 'AE-17 · đồng hồ vượt expires_at của bản nháp (409 DRAFT_STALE)',
  },
  {
    id: 'lost-response',
    label: '5. Mất phản hồi & Gửi lại',
    hint: 'AE-11 / AE-21 · lỗi mạng sau khi commit → đối soát bằng khóa cũ',
  },
  {
    id: 'ownership-session',
    label: '6. Quyền sở hữu / Phiên',
    hint: 'AE-14 / AE-23f · USER-B xem đơn USER-A (404) & phiên hết hạn (401)',
  },
  {
    id: 'nearest-eligible',
    label: '7. Trạm gần nhất đủ ĐK',
    hint: 'AE-18 · từ ST-05 (0 pin A) tự chọn ST-03 (1.2 km)',
  },
]

export function StateSwitcher({ activeScenario, onSelectScenario, scenarioHint }) {
  return (
    <section
      aria-label="Thanh chuyển kịch bản rà soát (không thuộc giao diện người dùng cuối)"
      className="border-b border-dashed border-slate-300 bg-slate-100/80"
    >
      <div className="mx-auto max-w-6xl px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <FlaskConical aria-hidden="true" className="size-3.5" />
            Kịch bản rà soát:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {REVIEW_SCENARIOS.map((item) => {
              const active = activeScenario === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectScenario(item.id)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>
        {scenarioHint && (
          <p role="status" aria-live="polite" className="mt-1.5 text-xs text-slate-600">
            {scenarioHint}
          </p>
        )}
      </div>
    </section>
  )
}
