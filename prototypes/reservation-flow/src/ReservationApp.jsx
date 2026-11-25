import { useCallback, useEffect, useState } from 'react'
import {
  ORIGINS,
  advanceServerClock,
  apiCancelReservation,
  apiConfirmReservation,
  apiCreateDraft,
  apiGetReservationDetail,
  apiListReservations,
  getStoreSnapshot,
  makeUuid,
  resetMockStore,
  setStationStock,
  updateServerHoldMinutes,
} from './lib/reservationApi.js'
import { CancelOrderDialog } from './components/CancelOrderDialog.jsx'
import { ConfirmDraftModal } from './components/ConfirmDraftModal.jsx'
import { DemoHeader } from './components/DemoHeader.jsx'
import { ErrorBanner } from './components/ErrorBanner.jsx'
import { OrderDetailPanel } from './components/OrderDetailPanel.jsx'
import { OrderList } from './components/OrderList.jsx'
import { REVIEW_SCENARIOS, StateSwitcher } from './components/StateSwitcher.jsx'
import { StationBookingBar } from './components/StationBookingBar.jsx'

const makeSession = (user, expired = false) => ({
  demo_user: user,
  expired,
  expires_at: expired ? '2026-11-25T18:00:00Z' : '2026-11-26T18:30:00Z',
})

/** Build exact API v2.1 / v2.2 confirmation payload (§6.7, §6.12 #1). */
const buildConfirmPayload = (draft) => ({
  draft_id: draft.draft_id,
  station_id: draft.station.station_id,
  family_code: draft.family_code,
  quantity: draft.quantity,
})

export default function ReservationApp() {
  const [snapshot, setSnapshot] = useState(() => getStoreSnapshot())
  const [session, setSession] = useState(() => makeSession('USER-A'))
  const [selectedStationId, setSelectedStationId] = useState('ST-01')
  const [familyCode, setFamilyCode] = useState('FAM_A')

  const [orders, setOrders] = useState([])
  const [ordersFilter, setOrdersFilter] = useState('ALL')
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState(null)

  const [draft, setDraft] = useState(null)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  // §6.12 #2: Frozen { payload, idempotencyKey } sent on first attempt, reused verbatim on retry.
  const [pendingConfirm, setPendingConfirm] = useState(null)
  const [draftError, setDraftError] = useState(null)
  const [confirmError, setConfirmError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [faultMode, setFaultMode] = useState('none')

  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [statusNotice, setStatusNotice] = useState(null)
  const [lookupError, setLookupError] = useState(null)

  const [activeScenario, setActiveScenario] = useState(null)
  const [scenarioHint, setScenarioHint] = useState(
    'Chọn một kịch bản ở trên để kiểm tra nhanh các trạng thái wireframe, hoặc thao tác tự do bên dưới.',
  )

  const syncSnapshot = useCallback(() => {
    setSnapshot(getStoreSnapshot())
  }, [])

  const loadOrders = useCallback(
    async (activeSession = session) => {
      setOrdersLoading(true)
      setOrdersError(null)
      try {
        const res = await apiListReservations(activeSession, { delayMs: 80 })
        syncSnapshot()
        if (!res.ok) {
          setOrders([])
          setSelectedOrderId(null)
          setOrdersError(res.body.error)
          return []
        }
        setOrders(res.body.reservations)
        setSelectedOrderId((prev) =>
          res.body.reservations.some((o) => o.reservation_id === prev)
            ? prev
            : (res.body.reservations[0]?.reservation_id ?? null),
        )
        return res.body.reservations
      } catch (err) {
        setOrdersError({ code: 'INTERNAL_ERROR', message: err.message, details: [] })
        return []
      } finally {
        setOrdersLoading(false)
      }
    },
    [session, syncSnapshot],
  )

  useEffect(() => {
    loadOrders(session)
  }, [session, loadOrders])

  const openDraft = useCallback(
    async (payload, activeSession = session, opts = {}) => {
      setDraftError(null)
      setConfirmError(null)
      setPendingConfirm(null)
      setFaultMode(opts.faultMode ?? 'none')
      setSubmitting(true)
      try {
        const res = await apiCreateDraft(activeSession, payload, { delayMs: 100 })
        syncSnapshot()
        if (!res.ok) {
          setDraft(null)
          setDraftError(res.body.error)
          return null
        }
        setDraft(res.body.draft)
        setIdempotencyKey(makeUuid())
        return res.body.draft
      } catch (err) {
        setDraftError({ code: 'INTERNAL_ERROR', message: err.message, details: [] })
        return null
      } finally {
        setSubmitting(false)
      }
    },
    [session, syncSnapshot],
  )

  const handleConfirm = useCallback(
    async ({ isRetry = false } = {}) => {
      if (!draft) return
      setSubmitting(true)
      setConfirmError(null)

      // §6.12 #1 & #2: Freeze exact 4-field v2.1 payload + key on first send; reuse verbatim on retry.
      const submission =
        isRetry && pendingConfirm
          ? pendingConfirm
          : {
              payload: buildConfirmPayload(draft),
              idempotencyKey,
            }
      if (!pendingConfirm || !isRetry) {
        setPendingConfirm(submission)
      }

      // A lost response affects this attempt only. A replay must be able to return its result.
      if (faultMode === 'lost_response_after_commit') setFaultMode('none')
      try {
        const res = await apiConfirmReservation(
          session,
          submission.payload,
          submission.idempotencyKey,
          { delayMs: 180, fault: faultMode },
        )
        syncSnapshot()
        if (!res.ok) {
          setConfirmError(res.body.error)
          return
        }
        const created = res.body.reservation
        const replayed = res.headers?.['Idempotent-Replayed'] === 'true'
        setDraft(null)
        setPendingConfirm(null)
        setFaultMode('none')
        await loadOrders(session)
        setSelectedOrderId(created.reservation_id)
        setStatusNotice({
          tone: 'success',
          message: replayed
            ? `Đã đối soát thành công bằng Idempotency-Key và payload gốc (200 Idempotent-Replayed) — trả về đơn ${created.reservation_id}, không giữ thêm pin.`
            : `Đã xác nhận giữ 1 pin ${created.family_code} tại ${created.station.station_id}. Tồn kho trạm giảm đúng 1.`,
        })
      } catch (err) {
        syncSnapshot()
        setConfirmError({
          code: err.isNetworkUnknown ? 'UNKNOWN_OUTCOME' : 'INTERNAL_ERROR',
          message: err.message,
          details: [],
        })
      } finally {
        setSubmitting(false)
      }
    },
    [draft, faultMode, idempotencyKey, loadOrders, pendingConfirm, session, syncSnapshot],
  )

  const handleCancelOrder = useCallback(
    async (reservationId) => {
      setCancelling(true)
      try {
        const res = await apiCancelReservation(session, reservationId, { delayMs: 140 })
        syncSnapshot()
        setCancelTarget(null)
        if (!res.ok) {
          setLookupError(res.body.error)
          return
        }
        const updated = res.body.reservation
        await loadOrders(session)
        setSelectedOrderId(updated.reservation_id)
        // §6.10 & §6.12 #8: Outcome is read directly from reservation.status.
        setStatusNotice(
          updated.status === 'EXPIRED'
            ? {
                tone: 'warn',
                message: `Đơn ${reservationId} đã quá mốc hết hạn theo giờ máy chủ. Hệ thống đối soát sang EXPIRED (không gán CANCELLED) và hoàn pin đúng một lần (BR-09 / AE-16b).`,
              }
            : {
                tone: 'success',
                message: `Đã hủy đơn ${reservationId} (${updated.status}) và hoàn lại 1 pin ${updated.family_code} vào tồn kho ${updated.station.station_id}.`,
              },
        )
      } finally {
        setCancelling(false)
      }
    },
    [loadOrders, session, syncSnapshot],
  )

  const handleRefreshSingleOrder = useCallback(
    async (reservationId) => {
      setLookupError(null)
      const res = await apiGetReservationDetail(session, reservationId, { delayMs: 90 })
      syncSnapshot()
      if (!res.ok) {
        setLookupError(res.body.error)
        return
      }
      await loadOrders(session)
      setSelectedOrderId(res.body.reservation.reservation_id)
      setStatusNotice({
        tone: res.body.reservation.status === 'EXPIRED' ? 'warn' : 'success',
        message: `Đã đồng bộ trạng thái đơn ${reservationId} từ máy chủ: ${res.body.reservation.status}.`,
      })
    },
    [loadOrders, session, syncSnapshot],
  )

  const handleAdvanceClock = useCallback(
    async (seconds) => {
      advanceServerClock(seconds)
      syncSnapshot()
      await loadOrders(session)
    },
    [loadOrders, session, syncSnapshot],
  )

  const handleChangeHoldMinutes = useCallback(
    (minutes) => {
      updateServerHoldMinutes(minutes)
      syncSnapshot()
    },
    [syncSnapshot],
  )

  const handleResetAll = useCallback(async () => {
    resetMockStore()
    const freshSession = makeSession('USER-A')
    setSession(freshSession)
    setDraft(null)
    setPendingConfirm(null)
    setDraftError(null)
    setConfirmError(null)
    setLookupError(null)
    setStatusNotice(null)
    setCancelTarget(null)
    setActiveScenario(null)
    setFaultMode('none')
    setSelectedStationId('ST-01')
    setFamilyCode('FAM_A')
    syncSnapshot()
    await loadOrders(freshSession)
  }, [loadOrders, syncSnapshot])

  const runScenario = useCallback(
    async (scenarioId) => {
      resetMockStore()
      setDraft(null)
      setPendingConfirm(null)
      setDraftError(null)
      setConfirmError(null)
      setLookupError(null)
      setStatusNotice(null)
      setCancelTarget(null)
      setFaultMode('none')
      setActiveScenario(scenarioId)

      const meta = REVIEW_SCENARIOS.find((s) => s.id === scenarioId)
      setScenarioHint(meta?.hint ?? '')

      const userA = makeSession('USER-A')
      setSession(userA)
      setFamilyCode('FAM_A')
      syncSnapshot()

      if (scenarioId === 'confirm-draft') {
        setSelectedStationId('ST-01')
        await openDraft({ station_id: 'ST-01', family_code: 'FAM_A', quantity: 1 }, userA)
        return
      }

      if (scenarioId === 'orders-active') {
        const d = await apiCreateDraft(
          userA,
          { station_id: 'ST-01', family_code: 'FAM_A', quantity: 1 },
          { delayMs: 10 },
        )
        await apiConfirmReservation(userA, buildConfirmPayload(d.body.draft), makeUuid(), {
          delayMs: 10,
        })
        syncSnapshot()
        await loadOrders(userA)
        setStatusNotice({
          tone: 'success',
          message:
            'Đã tạo sẵn 1 đơn ACTIVE tại ST-01 (tồn kho FAM_A giảm 6 → 5). Thử hủy ngay hoặc tua +15p để kiểm tra AE-16b.',
        })
        return
      }

      if (scenarioId === 'stock-race') {
        setSelectedStationId('ST-01')
        setStationStock('ST-01', 'FAM_A', 1)
        const opened = await openDraft(
          { station_id: 'ST-01', family_code: 'FAM_A', quantity: 1 },
          userA,
        )
        setStationStock('ST-01', 'FAM_A', 0)
        syncSnapshot()
        if (opened) {
          const res = await apiConfirmReservation(userA, buildConfirmPayload(opened), makeUuid(), {
            delayMs: 10,
          })
          setConfirmError(res.body.error)
        }
        return
      }

      if (scenarioId === 'draft-stale') {
        setSelectedStationId('ST-01')
        const opened = await openDraft(
          { station_id: 'ST-01', family_code: 'FAM_A', quantity: 1 },
          userA,
        )
        advanceServerClock(5 * 60 + 5)
        syncSnapshot()
        if (opened) {
          const res = await apiConfirmReservation(userA, buildConfirmPayload(opened), makeUuid(), {
            delayMs: 10,
          })
          setConfirmError(res.body.error)
        }
        return
      }

      if (scenarioId === 'lost-response') {
        setSelectedStationId('ST-01')
        await openDraft(
          { station_id: 'ST-01', family_code: 'FAM_A', quantity: 1 },
          userA,
          { faultMode: 'lost_response_after_commit' },
        )
        setScenarioHint(
          'AE-11 / AE-21: Nhấn "Xác nhận đặt 1 pin" → hệ thống mô phỏng mất phản hồi sau khi đã giữ pin, sau đó nhấn "Đối soát bằng khóa cũ" để gửi lại đúng 4 trường payload + Idempotency-Key gốc.',
        )
        return
      }

      if (scenarioId === 'ownership-session') {
        const d = await apiCreateDraft(
          userA,
          { station_id: 'ST-01', family_code: 'FAM_A', quantity: 1 },
          { delayMs: 10 },
        )
        const c = await apiConfirmReservation(userA, buildConfirmPayload(d.body.draft), makeUuid(), {
          delayMs: 10,
        })
        const orderIdOfA = c.body.reservation.reservation_id
        const userB = makeSession('USER-B')
        setSession(userB)
        syncSnapshot()
        await loadOrders(userB)
        const probe = await apiGetReservationDetail(userB, orderIdOfA, { delayMs: 10 })
        setLookupError(probe.body.error)
        setScenarioHint(
          `AE-14: Đã chuyển sang USER-B và thử xem đơn ${orderIdOfA} của USER-A → máy chủ trả 404 RESERVATION_NOT_FOUND mà không lộ dữ liệu.`,
        )
        return
      }

      if (scenarioId === 'nearest-eligible') {
        const st05 = getStoreSnapshot().stations.find((s) => s.station_id === 'ST-05')
        await openDraft(
          {
            family_code: 'FAM_A',
            quantity: 1,
            nearest: { lat: st05.coordinates.lat, lng: st05.coordinates.lng },
          },
          userA,
        )
      }
    },
    [loadOrders, openDraft, syncSnapshot],
  )

  const selectedOrder = orders.find((o) => o.reservation_id === selectedOrderId) ?? null
  const st05Coords =
    snapshot.stations.find((s) => s.station_id === 'ST-05')?.coordinates ?? ORIGINS['LOC-01']

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <DemoHeader
        session={session}
        serverTime={snapshot.serverTime}
        holdMinutes={snapshot.holdMinutes}
        onSelectUser={(u) => {
          setLookupError(null)
          setStatusNotice(null)
          setSession(makeSession(u, false))
        }}
        onExpireSession={() => setSession(makeSession(session.demo_user, true))}
        onAdvanceClock={handleAdvanceClock}
        onChangeHoldMinutes={handleChangeHoldMinutes}
        onResetAll={handleResetAll}
      />

      <StateSwitcher
        activeScenario={activeScenario}
        onSelectScenario={runScenario}
        scenarioHint={scenarioHint}
      />

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-4">
        <StationBookingBar
          stations={snapshot.stations}
          selectedStationId={selectedStationId}
          familyCode={familyCode}
          onSelectStation={setSelectedStationId}
          onSelectFamily={setFamilyCode}
          onPrepareDraft={(stationId) =>
            openDraft({
              station_id: stationId,
              family_code: familyCode,
              quantity: 1,
            })
          }
          onPrepareNearest={() =>
            openDraft({
              family_code: familyCode,
              quantity: 1,
              nearest: { lat: st05Coords.lat, lng: st05Coords.lng },
            })
          }
          busy={submitting}
        />

        {draftError && (
          <ErrorBanner
            error={draftError}
            busy={submitting}
            onFindNearest={() =>
              openDraft({
                family_code: familyCode,
                quantity: 1,
                nearest: { lat: st05Coords.lat, lng: st05Coords.lng },
              })
            }
            onRestoreSession={() => {
              setDraftError(null)
              setSession(makeSession(session.demo_user || 'USER-A', false))
            }}
          />
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <OrderList
              session={session}
              orders={orders}
              filter={ordersFilter}
              selectedOrderId={selectedOrderId}
              loading={ordersLoading}
              error={ordersError}
              nowMs={snapshot.nowMs}
              onFilterChange={setOrdersFilter}
              onSelectOrder={(id) => {
                setLookupError(null)
                setSelectedOrderId(id)
              }}
              onRefresh={() => loadOrders(session)}
              onCreateFirstDraft={() =>
                openDraft({
                  station_id: 'ST-01',
                  family_code: familyCode,
                  quantity: 1,
                })
              }
              onRestoreSession={() => setSession(makeSession(session.demo_user || 'USER-A', false))}
            />
          </div>

          <div className="lg:col-span-7">
            <OrderDetailPanel
              order={selectedOrder}
              sessionUser={session.expired ? null : session.demo_user}
              nowMs={snapshot.nowMs}
              busy={cancelling || ordersLoading}
              statusNotice={statusNotice}
              lookupError={lookupError}
              onRefreshOrder={handleRefreshSingleOrder}
              onRequestCancel={setCancelTarget}
              onLookupById={handleRefreshSingleOrder}
              onRestoreSession={() => {
                setLookupError(null)
                setSession(makeSession(session.demo_user || 'USER-A', false))
              }}
            />
          </div>
        </div>
      </main>

      <ConfirmDraftModal
        draft={draft}
        sessionUser={session.expired ? null : session.demo_user}
        idempotencyKey={pendingConfirm?.idempotencyKey ?? idempotencyKey}
        nowMs={snapshot.nowMs}
        submitting={submitting}
        confirmError={confirmError}
        faultMode={faultMode}
        onFaultModeChange={setFaultMode}
        onClose={() => {
          setDraft(null)
          setPendingConfirm(null)
          setConfirmError(null)
        }}
        onConfirm={() => handleConfirm({ isRetry: false })}
        onRetrySameKey={() => handleConfirm({ isRetry: true })}
        onCreateFreshDraft={() =>
          openDraft({
            station_id: draft?.station?.station_id ?? selectedStationId,
            family_code: draft?.family_code ?? familyCode,
            quantity: 1,
          })
        }
        onFindNearest={() =>
          openDraft({
            family_code: draft?.family_code ?? familyCode,
            quantity: 1,
            nearest: { lat: st05Coords.lat, lng: st05Coords.lng },
          })
        }
        onRestoreSession={() => {
          setConfirmError(null)
          setSession(makeSession(session.demo_user || 'USER-A', false))
        }}
        onViewOrders={() => {
          setDraft(null)
          setPendingConfirm(null)
          setConfirmError(null)
          loadOrders(session)
        }}
      />

      <CancelOrderDialog
        reservation={cancelTarget}
        busy={cancelling}
        onClose={() => setCancelTarget(null)}
        onConfirmCancel={handleCancelOrder}
      />
    </div>
  )
}
