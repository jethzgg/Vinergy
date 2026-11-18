let pending
let callbackId = 0

// Share the script across React StrictMode mounts. Failed loads can be retried.
export function loadOpNavi() {
  if (window.AMap?.Map) return Promise.resolve(window.AMap)
  const key = import.meta.env.VITE_OPNAVI_API_KEY
  if (!key) return Promise.reject(new Error('Thiếu VITE_OPNAVI_API_KEY trong file .env.'))
  if (import.meta.env.DEV && !__OPNAVI_PROXY_CONFIGURED__) {
    return Promise.reject(new Error('Thiếu OPNAVI_SECURITY_JS_CODE trong file .env.'))
  }
  if (pending) return pending

  pending = new Promise((resolve, reject) => {
    const callback = `vinergyMapsReady${++callbackId}`
    const script = document.createElement('script')
    const cleanup = () => {
      clearTimeout(timer)
      delete window[callback]
      script.onerror = null
    }
    const fail = () => {
      cleanup()
      script.remove()
      pending = undefined
      reject(new Error('Không tải được SDK OpNavi. Kiểm tra kết nối, vùng và quyền của Web/JS key.'))
    }
    const timer = setTimeout(fail, 15000)
    window[callback] = () => {
      if (!window.AMap?.Map) return fail()
      cleanup()
      resolve(window.AMap)
    }
    script.onerror = fail
    script.async = true
    const region = import.meta.env.VITE_OPNAVI_REGION === 'de' ? 'de' : 'sg'
    window._AMapServiceConfig = { type: 'oversea_' + region }
    window._AMapSecurityConfig = { serviceHost: window.location.origin + '/_AMapService' }
    const params = new URLSearchParams({ key, callback, v: '2.0' })
    script.src = `https://${region}-webapi.opnavi.com/maps?${params}`
    document.head.appendChild(script)
  })
  return pending
}
