import { expect, test } from '@playwright/test'

test('lost confirmation replays the original order from the reconciliation button', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /5\. Mất phản hồi/ }).click()
  await page.getByRole('button', { name: 'Xác nhận đặt 1 pin' }).click()
  await page.getByRole('button', { name: 'Đối soát bằng khóa cũ' }).click()

  const replay = page.getByText(/Đã đối soát thành công/)
  await expect(replay).toBeVisible()
  await expect(page.getByText('Đủ điều kiện đổi FAM_A (còn 5 pin)')).toBeVisible()
  const reservationId = (await replay.innerText()).match(/trả về đơn ([a-f0-9-]{36})/)[1]
  await expect(page.getByRole('listitem').filter({ hasText: reservationId })).toHaveCount(1)
  await expect(page.getByRole('listitem')).toHaveCount(1)
})
