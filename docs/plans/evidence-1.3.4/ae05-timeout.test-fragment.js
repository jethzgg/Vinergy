
// Append to frontend/tests/stations.spec.js to reuse the suite's demo map and selectors.
test('AE-05 search timeout clears stale results and retry restores seed stations', async ({ page }) => {
  await enableMap(page)
  await page.goto('/')
  const cards = page.locator('#station-list li button')
  const ids = ['ST-01', 'ST-03', 'ST-05', 'ST-06']
  await expect(pins(page)).toHaveText(ids)
  await expect(cards).toHaveCount(4)

  await page.clock.install()
  const searchSent = page.waitForRequest(/\/api\/v1\/stations\?/)
  await page.route('**/stations?**', () => {}, { times: 1 })
  await submit(page)
  await searchSent
  await expect(page.getByText('Đang tìm trạm…')).toBeVisible()
  await page.clock.fastForward(15001)

  await expect(page.getByRole('alert')).toContainText('Hết thời gian chờ dịch vụ trạm.')
  await expect(page.getByText('Đang tìm trạm…')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /Không tìm thấy trạm phù hợp/ })).toHaveCount(0)
  await expect(cards).toHaveCount(0)
  await expect(pins(page)).toHaveCount(0)

  const retryResponse = page.waitForResponse(/\/api\/v1\/stations\?/)
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
  expect((await retryResponse).status()).toBe(200)
  await expect(pins(page)).toHaveText(ids)
  await expect(cards).toHaveText(ids.map(id => new RegExp(id)))
})
