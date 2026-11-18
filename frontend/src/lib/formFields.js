export const SERVICE_TYPES = ['SWAPPING', 'CHARGING']

// §1.2 verbatim: plain decimal only. `1e3`, `+1`, `.5`, `NaN`, `Infinity` and
// any padded value such as ` 21` are NOT_A_NUMBER — a looser client validator
// would accept values the real endpoint rejects. `Number("")` is 0 and
// `parseFloat("21abc")` is 21, so neither may be used either.
const NUMBER_RE = /^-?\d+(\.\d+)?$/

const MESSAGES = {
  REQUIRED: (f) => `${f} là bắt buộc.`,
  EMPTY: (f) => `${f} không được để trống.`,
  NOT_A_NUMBER: (f) => `${f} phải là một số hữu hạn.`,
  OUT_OF_RANGE: (f, extra) => `${f} phải nằm trong ${extra}.`,
  NOT_POSITIVE: (f) => `${f} phải lớn hơn 0.`,
  NOT_BOOLEAN: (f) => `${f} phải là true hoặc false.`,
  NOT_IN_ENUM: (f, extra) => `${f} phải là một trong: ${extra}.`,
  MISSING_PAIR: () => 'lat và lng phải đi cùng nhau.',
}

function detail(field, reason, extra) {
  return { field, reason, message: MESSAGES[reason](field, extra) }
}

const isBlank = (raw) => raw === undefined || raw === null || String(raw) === ''

function readNumber(raw, field, details, { min, max, positive } = {}) {
  if (raw === undefined || raw === null) {
    details.push(detail(field, 'REQUIRED'))
    return null
  }
  const text = String(raw)
  if (text === '') {
    details.push(detail(field, 'EMPTY'))
    return null
  }
  if (!NUMBER_RE.test(text)) {
    details.push(detail(field, 'NOT_A_NUMBER'))
    return null
  }
  const parsed = globalThis.Number(text)
  if (!globalThis.Number.isFinite(parsed)) {
    details.push(detail(field, 'NOT_A_NUMBER'))
    return null
  }
  const value = parsed === 0 ? 0 : parsed // §1.2: `-0` normalises to `0`
  if (positive && value <= 0) {
    details.push(detail(field, 'NOT_POSITIVE'))
    return null
  }
  if (min !== undefined && (value < min || value > max)) {
    details.push(detail(field, 'OUT_OF_RANGE', `[${min}, ${max}]`))
    return null
  }
  return value
}

function readEnum(raw, field, allowed, details) {
  if (raw === undefined || raw === null) {
    details.push(detail(field, 'REQUIRED'))
    return null
  }
  const text = String(raw)
  if (text === '') {
    details.push(detail(field, 'EMPTY'))
    return null
  }
  if (!allowed.includes(text)) {
    details.push(detail(field, 'NOT_IN_ENUM', allowed.join(' | ')))
    return null
  }
  return text
}

export function validateSearchField(field, value, familyCodes = []) {
  const details = []
  if (field === 'lat') readNumber(value, 'lat', details, { min: -90, max: 90 })
  else if (field === 'lng') readNumber(value, 'lng', details, { min: -180, max: 180 })
  else if (field === 'radius_km') {
    if (isBlank(value)) return null // optional: absent means no radius at all
    readNumber(value, 'radius_km', details, { positive: true })
  } else if (field === 'family_code') readEnum(value, 'family_code', familyCodes, details)
  else if (field === 'service_type') readEnum(value, 'service_type', SERVICE_TYPES, details)
  return details[0]?.message ?? null
}

/** Display labels for §4.2 reason codes (ux-writing: say the cause, not the code). */
export const INELIGIBILITY_TEXT = {
  CHARGING_ONLY: 'Chỉ có cổng sạc — không hỗ trợ đặt trước',
  UNSUPPORTED_FAMILY: 'Không hỗ trợ nhóm pin đang chọn',
  STATION_CLOSED: 'Trạm đang đóng cửa',
  STATION_MAINTENANCE: 'Trạm đang bảo trì',
  OUT_OF_STOCK: 'Hết pin khả dụng',
}

export { isBlank, readNumber, readEnum, detail }
