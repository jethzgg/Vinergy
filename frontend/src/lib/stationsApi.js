const apiBase = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api/v1').replace(/\/+$/, '')

async function request(path, params, { signal } = {}) {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (value != null) query.set(name, String(value))
  }
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const timeout = setTimeout(cancel, 15000)
  try {
    const response = await fetch(`${apiBase}/stations${path}?${query}`, { signal: controller.signal })
    const body = await response.json().catch((error) => {
      if (controller.signal.aborted) throw error
      return null
    })
    if (!response.ok) {
      const error = body?.error ?? { message: `Dịch vụ trả lỗi HTTP ${response.status}.` }
      return { ok: false, body: { error } }
    }
    const valid = path
      ? body?.station?.station_id === decodeURIComponent(path.slice(1))
      : Array.isArray(body?.stations) && body.query && body.total === body.stations.length
    if (!valid) {
      throw new Error('Phản hồi dịch vụ trạm không hợp lệ.')
    }
    return { ok: true, body }
  } catch (error) {
    if (signal?.aborted) throw error
    if (controller.signal.aborted) throw new Error('Hết thời gian chờ dịch vụ trạm.')
    if (error instanceof TypeError) throw new Error('Hãy kiểm tra kết nối và thử lại.')
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
  }
}

export function searchStations(params, options) {
  return request('', { ...params, radius_km: params.radius_km === '' ? undefined : params.radius_km }, options)
}

export function getStationDetail(stationId, params = {}, options) {
  return request('/' + encodeURIComponent(stationId), params, options)
}
