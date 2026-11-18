export const PIN_COLORS = {
  swap: '#059669',
  charge: '#0284c7',
  warn: '#d97706',
  muted: '#64748b',
}

/** Marker colour mirrors why a station can or cannot serve the request. */
export function pinColor(station, serviceType) {
  if (station.opening_status !== 'OPEN') return PIN_COLORS.muted
  if (serviceType === 'CHARGING') return PIN_COLORS.charge
  if (station.ineligibility_reason === 'OUT_OF_STOCK') return PIN_COLORS.warn
  return PIN_COLORS.swap
}
