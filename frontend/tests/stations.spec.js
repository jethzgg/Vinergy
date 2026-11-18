import { test, expect } from '@playwright/test'
import { installMapSdk } from './mapSdk.js'

const card = (page, id) => page.locator('#station-list').getByRole('button', { name: new RegExp(id) })
const submit = page => page.getByRole('button', { name: 'Tìm trạm', exact: true }).click()
const dialog = page => page.getByRole('dialog')
const pins = page => page.locator('#station-map [data-position]:has(button[title^="ST-"])')
const sdkUrl = 'https://sg-webapi.opnavi.com/maps?**'

test.beforeEach(async ({ page }) => {
  await page.route(sdkUrl, route => route.abort())
})

async function enableMap(page) {
  await page.route(sdkUrl, async route => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('key')).toBe('test-web-key')
    expect(url.searchParams.get('v')).toBe('2.0')
    const callback = JSON.stringify(url.searchParams.get('callback'))
    await route.fulfill({
      contentType: 'application/javascript',
      body: `(${installMapSdk.toString()})(); window[${callback}]();`,
    })
  })
}

test('AE-01 list and map share order, selection, stock and directions', async ({ page, context }) => {
  await enableMap(page)
  await page.goto('/')
  const rows = page.locator('#station-list li button')
  await expect(rows).toHaveText([
    /ST-01.*0\.0 km/s, /ST-03.*0\.9 km/s, /ST-05.*1\.3 km/s, /ST-06.*1\.7 km/s,
  ])
  await expect(pins(page)).toHaveText(['ST-01', 'ST-03', 'ST-05', 'ST-06'])
  await expect(pins(page).first()).toHaveAttribute('data-position', '[105.8435,21.005]')
  expect(await page.evaluate(() => ({
    region: window._AMapServiceConfig.type,
    security: window._AMapSecurityConfig,
  }))).toEqual({
    region: 'oversea_sg',
    security: { serviceHost: 'http://127.0.0.1:5183/_AMapService' },
  })
  const detailRequest = page.waitForRequest(/stations\/ST-05\?/)
  await card(page, 'ST-05').click()
  const params = new URL((await detailRequest).url()).searchParams
  expect(Object.fromEntries(params)).toEqual({ family_code: 'FAM_A', lat: '21.005', lng: '105.8435' })
  await expect(pins(page).filter({ hasText: 'ST-05' })).toHaveClass(/vg-pin--selected/)
  await expect(dialog(page)).toContainText('Hết pin khả dụng')
  await expect(dialog(page).getByRole('button', { name: /Sprint 2/ })).toBeDisabled()
  await expect(dialog(page).getByRole('listitem').filter({ hasText: 'đang chọn' })).toHaveText(/FAM_A.*0$/)
  const link = dialog(page).getByRole('link', { name: /Chỉ đường/ })
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await context.route('https://www.google.com/maps/dir/**', route => route.fulfill({ body: 'Directions' }))
  const opened = context.waitForEvent('page')
  await link.click()
  const tab = await opened
  await expect(tab).toHaveURL('https://www.google.com/maps/dir/?api=1&destination=21.0032%2C105.856')
  await tab.close()
  await page.keyboard.press('Escape')
  await expect(card(page, 'ST-05')).toBeFocused()
  await pins(page).filter({ hasText: 'ST-03' }).click()
  await expect(card(page, 'ST-03')).toHaveAttribute('aria-current', 'true')
  await expect(dialog(page)).toContainText('Vinergy Demo Station 03')
  await expect(dialog(page)).toContainText('không hỗ trợ')
})

test('AE-05 empty, network failure and retry clear stale pins and cards', async ({ page }) => {
  await enableMap(page)
  await page.goto('/')
  await expect(pins(page)).toHaveCount(4)
  await page.getByRole('button', { name: 'Đổi vị trí' }).click()
  await page.locator('#radius').fill('0.5')
  await page.getByRole('button', { name: 'LOC-03', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Không tìm thấy trạm phù hợp/ })).toBeVisible()
  await expect(pins(page)).toHaveCount(0)
  await expect(page.locator('#station-list li button')).toHaveCount(0)
  await page.getByRole('button', { name: 'LOC-01', exact: true }).click()
  await expect(pins(page)).toHaveCount(1)
  await page.route('**/stations?**', route => route.abort(), { times: 1 })
  await submit(page)
  await expect(page.getByRole('alert')).toContainText('Không kết nối')
  await expect(pins(page)).toHaveCount(0)
  await expect(card(page, 'ST-01')).toHaveCount(0)
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
  await expect(pins(page)).toHaveCount(1)
})

for (const [mode, notice] of [[1, 'Quyền vị trí bị từ chối'], [3, 'Hết thời gian chờ'], [0, 'không hỗ trợ định vị']]) {
  test(`AE-04 location failure ${mode} permits manual recovery; AE-07 field validation`, async ({ page }) => {
    await page.addInitScript(code => Object.defineProperty(navigator, 'geolocation', {
      value: code ? { getCurrentPosition: (_, fail) => fail({ code }) } : undefined,
    }), mode)
    await page.goto('/')
    await page.getByRole('button', { name: 'Đổi vị trí' }).click()
    await page.getByRole('button', { name: 'Dùng vị trí của tôi' }).click()
    await expect(page.getByRole('status')).toContainText(notice)
    await expect(page.locator('#lat')).toHaveValue('')
    await expect(page.locator('#lng')).toHaveValue('')
    await page.locator('#lat').fill('91')
    await page.locator('#radius').fill('-1')
    await submit(page)
    for (const id of ['lat', 'lng', 'radius']) await expect(page.locator('#' + id)).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('alert')).toContainText('Thông tin tìm kiếm chưa hợp lệ')
    await page.locator('#radius').fill('')
    const search = page.waitForRequest(/stations\?/)
    await page.getByRole('button', { name: 'LOC-02', exact: true }).click()
    const query = new URL((await search).url()).searchParams
    expect(query.has('radius_km')).toBe(false)
    expect(query.get('lat')).toBe('21.0285')
    await expect(card(page, 'ST-08')).toBeVisible()
  })
}

test('AE-06 unavailable OpNavi SDK preserves filters, list and station details', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Bản đồ tạm thời gián đoạn')).toBeVisible()
  await page.locator('#radius').fill('')
  await page.getByLabel('Chỉ trạm đang mở').uncheck()
  await expect(card(page, 'ST-09')).toContainText('Trạm đang đóng cửa')
  await page.getByRole('radio', { name: 'Sạc', exact: true }).check({ force: true })
  await card(page, 'ST-02').click()
  await expect(dialog(page)).toContainText('Chỉ có cổng sạc')
  await expect(dialog(page)).toContainText('Cổng sạc')
  await expect(dialog(page).getByRole('link')).toHaveAttribute('href', /20.9958%2C105.8675/)
})

test('AE-02 drawer shows authoritative incompatibility after a compatibility change', async ({ page }) => {
  // Represent an earlier list snapshot that still included ST-04. Detail
  // requests go directly to FastAPI with the real current family (FAM_A).
  await page.route('**/stations?**', async route => {
    const response = await route.fetch()
    const body = await response.json()
    const url = new URL(route.request().url())
    url.searchParams.set('family_code', 'FAM_B')
    const previous = await (await route.fetch({ url: url.href })).json()
    body.stations.push(previous.stations.find(station => station.station_id === 'ST-04'))
    body.total = body.stations.length
    await route.fulfill({ response, json: body })
  })
  await page.goto('/')
  await card(page, 'ST-04').click()
  await expect(dialog(page)).toContainText('Không hỗ trợ nhóm pin đang chọn')
  await expect(dialog(page).getByRole('listitem').filter({ hasText: 'FAM_A' })).toContainText('không hỗ trợ')
  await expect(dialog(page).getByRole('listitem').filter({ hasText: 'FAM_B' })).toContainText('5')
})

test('detail loading, closing during request, retry and station not found', async ({ page }) => {
  await page.goto('/')
  let release, delivered
  const finished = new Promise(resolve => { delivered = resolve })
  const delay = new Promise(resolve => { release = resolve })
  await page.route('**/stations/ST-01?**', async route => {
    const response = await route.fetch()
    await delay
    await route.fulfill({ response })
    delivered()
  })
  await card(page, 'ST-01').click()
  await expect(dialog(page)).toContainText('Đang tải chi tiết')
  await page.keyboard.press('Escape')
  await page.route('**/stations/ST-03?**', route => route.fulfill({ status: 503, body: '' }))
  await card(page, 'ST-03').click()
  await expect(dialog(page).getByRole('alert')).toContainText('HTTP 503')
  await page.unroute('**/stations/ST-03?**')
  await dialog(page).getByRole('button', { name: 'Thử lại' }).click()
  await expect(dialog(page)).toContainText('Vinergy Demo Station 03')
  release()
  await finished
  await expect(dialog(page)).toContainText('Vinergy Demo Station 03')
  await page.keyboard.press('Escape')
  await page.route('**/stations/ST-05?**', async route => {
    await route.fulfill({ response: await route.fetch({ url: route.request().url().replace('ST-05', 'ST-99') }) })
  })
  await card(page, 'ST-05').click()
  await expect(dialog(page).getByRole('alert')).toContainText('Không tìm thấy trạm')
})

test('a newer family search wins when responses arrive out of order', async ({ page }) => {
  await page.goto('/')
  await expect(card(page, 'ST-03')).toBeVisible()
  let release, delivered
  const finished = new Promise(resolve => { delivered = resolve })
  const delay = new Promise(resolve => { release = resolve })
  await page.route('**/stations?**', async route => {
    const response = await route.fetch()
    const delayed = new URL(route.request().url()).searchParams.get('family_code') === 'FAM_B'
    if (delayed) await delay
    await route.fulfill({ response })
    if (delayed) delivered()
  })
  await page.locator('#family').selectOption('FAM_B')
  await expect(page.getByText('Đang tìm trạm…')).toBeVisible()
  await page.locator('#family').selectOption('FAM_A')
  await expect(card(page, 'ST-03')).toBeVisible()
  release()
  await finished
  await expect(card(page, 'ST-04')).toHaveCount(0)
})

test('geolocation success searches from the granted coordinates on mobile', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 21.0285, longitude: 105.8542 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Ẩn bản đồ' }).click()
  await page.getByRole('button', { name: 'Đổi vị trí' }).click()
  await page.getByRole('button', { name: 'Dùng vị trí của tôi' }).click()
  await expect(page.locator('#lat')).toHaveValue('21.028500')
  await expect(card(page, 'ST-08')).toBeVisible()
  await card(page, 'ST-08').click()
  await expect(dialog(page)).toContainText('Vinergy Demo Station 08')
})

test('a server failure is retryable and does not become an empty search', async ({ page }) => {
  await page.route('**/stations?**', route => route.fulfill({
    status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi máy chủ.', details: [] } },
  }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Dịch vụ tìm trạm đang gặp sự cố')
  await expect(page.getByRole('heading', { name: /Không tìm thấy trạm phù hợp/ })).toHaveCount(0)
  await page.unroute('**/stations?**')
  await page.getByRole('button', { name: 'Thử lại' }).click()
  await expect(card(page, 'ST-01')).toBeVisible()
})

test('retry loads OpNavi after a failed script request', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Bản đồ tạm thời gián đoạn')).toBeVisible()
  await enableMap(page)
  await page.getByRole('button', { name: 'Tải lại bản đồ' }).click()
  await expect(pins(page)).toHaveCount(4)
  await expect(page.locator('[data-oversea="true"]')).toBeVisible()
})
