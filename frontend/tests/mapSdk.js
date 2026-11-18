// Minimal AMap renderer for browser tests. Requests for stations go to FastAPI.
export function installMapSdk() {
  class MapView {
    constructor(container, options) {
      this.container = container
      this.container.dataset.oversea = String(options.showOversea)
    }
    on(event, callback) { if (event === 'complete') queueMicrotask(callback) }
    add(overlays) {
      for (const overlay of overlays) {
        if (overlay.content) this.container.append(overlay.content)
      }
    }
    remove(overlays) {
      for (const overlay of overlays) overlay.content?.remove()
    }
    setCenter(position) { this.container.dataset.center = JSON.stringify(position) }
    setFitView() {}
    setZoomAndCenter() {}
    destroy() { this.container.replaceChildren() }
  }
  class Marker {
    constructor({ position, content }) {
      this.position = position
      this.content = content
      content.dataset.position = JSON.stringify(position)
    }
    on(event, callback) { this.content.addEventListener(event, callback) }
    setzIndex(index) { this.content.style.zIndex = index }
    getPosition() { return this.position }
  }
  window.AMap = { Map: MapView, Marker, Circle: class {} }
}
