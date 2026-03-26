/**
 * 指定ミリ秒だけ待機する。
 * @param ms 待機時間 (ミリ秒)
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * レートリミット時の待機処理。
 * x-rate-limit-reset ヘッダーから再試行可能時刻を計算して待機する。
 *
 * @param response レートリミットを返したレスポンス
 * @param operationName 操作名（ログ用）
 * @param status HTTP ステータスコード
 */
async function waitForRateLimit(
  response: Response,
  operationName: string,
  status: number
): Promise<void> {
  const resetHeader = response.headers.get('x-rate-limit-reset')
  const resetAt = resetHeader ? Number(resetHeader) * 1000 : Number.NaN
  const delay = Number.isNaN(resetAt)
    ? 60_000
    : Math.max(resetAt - Date.now() + 1000, 1000)
  const resetDate = new Date(
    Number.isNaN(resetAt) ? Date.now() + delay : resetAt
  )
  console.warn(
    `[withRetry] ${operationName}: Rate limit (${status}). Waiting until ${resetDate.toLocaleString()} (${Math.ceil(delay / 1000)}s)...`
  )
  await sleep(delay)
}

/**
 * 非同期処理をリトライしながら実行する。
 * 429/403 はレートリミットとして x-rate-limit-reset まで待機し（リトライ回数に含めない）、
 * それ以外は指数バックオフでリトライする。
 *
 * @param fn 実行する処理
 * @param options リトライ設定
 * @returns 処理結果
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    baseDelayMs?: number
    operationName?: string
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 2000,
    operationName = 'operation',
  } = options
  let retries = 0

  for (;;) {
    try {
      return await fn()
    } catch (error: unknown) {
      const response = (error as { response?: Response }).response
      const status = response?.status

      // レートリミット (429/403): リトライ回数を消費せずに待機してから再試行する
      // Twitter は 429 だけでなく 403 もレートリミットとして返すことがある
      if ((status === 429 || status === 403) && response) {
        await waitForRateLimit(response, operationName, status)
        continue
      }

      if (retries >= maxRetries) {
        throw error
      }

      retries++
      const delay = Math.min(baseDelayMs * Math.pow(2, retries - 1), 30_000)
      console.warn(
        `[withRetry] ${operationName}: Failed (attempt ${retries}/${maxRetries}, status=${status ?? 'unknown'}). Retrying in ${delay / 1000}s...`
      )
      await sleep(delay)
    }
  }
}
