import { useCallback, useRef, useState } from 'react'
import StationFinder from '../../../frontend/src/StationFinder.jsx'
import { DEFAULT_FORM } from '../../../frontend/src/lib/searchOptions.js'
import LeafletStationMap from './LeafletStationMap.jsx'
import { searchStations, getStationDetail } from './lib/stationsApi.js'
const TEST_STATES = [
  { id: 1, label: 'Bình thường', hint: 'LOC-01 · đổi pin · FAM_A · 2 km → 4 trạm' },
  { id: 2, label: 'Không có kết quả', hint: 'AE-05 · LOC-03 · bán kính 0.5 km' },
  { id: 3, label: 'Bị chặn vị trí', hint: 'AE-04 · nhập tọa độ thủ công' },
  { id: 4, label: 'Bản đồ gián đoạn', hint: 'AE-06 · danh sách vẫn hoạt động' },
  { id: 5, label: 'Nhập liệu sai', hint: 'AE-07 · tọa độ và bán kính không hợp lệ' },
]

const scenarios = {
  1: DEFAULT_FORM,
  2: { ...DEFAULT_FORM, lat: '21.2', lng: '105.2', radius_km: '0.5' },
  3: { ...DEFAULT_FORM, lat: '', lng: '' },
  4: DEFAULT_FORM,
  5: { ...DEFAULT_FORM, lat: '95', lng: '', radius_km: '-1' },
}

export default function Prototype() {
  const [activeTestState, setState] = useState(1)
  const [revision, setRevision] = useState(0)
  const failure = useRef(false)
  const [simulateServerError, setSimulateServerError] = useState(false)
  const search = useCallback(params => searchStations(params, { failure: failure.current ? 'server' : null }), [])
  function chooseScenario(id) {
    failure.current = false
    setSimulateServerError(false)
    setState(id)
    setRevision(n => n + 1)
  }
  return (
    <StationFinder key={revision} MapView={LeafletStationMap} searchStations={search}
      getStationDetail={getStationDetail} initialForm={scenarios[activeTestState]}
      initialNotice={activeTestState === 3 ? 'Quyền vị trí bị từ chối. Hãy nhập tọa độ thủ công.' : null}
      mapUnavailable={activeTestState === 4}>
        {/* Interactive state switcher — a review harness, not product UI. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-slate-300 bg-slate-50 px-4 py-2">
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Trạng thái kiểm thử
          </span>
          {/* Narrow screens scroll this row instead of stacking it five deep. */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
            {TEST_STATES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => chooseScenario(s.id)}
                aria-pressed={activeTestState === s.id}
                title={s.hint}
                className={`shrink-0 rounded border px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors duration-150 ${
                  activeTestState === s.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-white'
                }`}
              >
                <span className="num mr-1 opacity-60">{s.id}</span>
                {s.label}
              </button>
            ))}
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={simulateServerError}
              onChange={(e) => { failure.current = e.target.checked; setSimulateServerError(e.target.checked) }}
              className="size-4 accent-stop-600"
            />
            Mô phỏng lỗi dịch vụ
          </label>
          <p className="basis-full text-xs text-slate-500 lg:basis-auto">
            {TEST_STATES.find((s) => s.id === activeTestState)?.hint}
          </p>
        </div>
    </StationFinder>
  )
}
