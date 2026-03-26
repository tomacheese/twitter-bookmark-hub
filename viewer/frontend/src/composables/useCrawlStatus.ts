import { ref, onMounted, onUnmounted } from 'vue'
import { fetchCrawlStatus, triggerCrawl as apiTriggerCrawl } from '../api'
import type { CrawlJobStatus } from '../api'

/**
 * クロールステータスのポーリングとクロール実行を管理する composable
 */
export function useCrawlStatus() {
  const status = ref<CrawlJobStatus | null>(null)
  const triggering = ref(false)
  const error = ref<string | null>(null)
  let intervalId: ReturnType<typeof setInterval> | null = null

  /** ステータスを取得する */
  async function refresh() {
    try {
      status.value = await fetchCrawlStatus()
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : 'Unknown error'
    }
  }

  /** クロールを手動実行する */
  async function triggerCrawl() {
    triggering.value = true
    try {
      await apiTriggerCrawl()
      await refresh()
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : 'Unknown error'
    } finally {
      triggering.value = false
    }
  }

  onMounted(() => {
    refresh().catch((error_: unknown) => {
      error.value = error_ instanceof Error ? error_.message : 'Unknown error'
    })
    // 10 秒ごとにポーリング
    intervalId = setInterval(() => {
      refresh().catch((error_: unknown) => {
        error.value = error_ instanceof Error ? error_.message : 'Unknown error'
      })
    }, 10_000)
  })

  onUnmounted(() => {
    if (intervalId !== null) {
      clearInterval(intervalId)
    }
  })

  return {
    status,
    triggering,
    error,
    triggerCrawl,
  }
}
