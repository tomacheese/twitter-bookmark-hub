import { ref, onMounted } from 'vue'
import { fetchAccounts } from '../api'
import type { AccountInfo } from '../api'

/**
 * アカウント一覧を取得・管理する composable
 */
export function useAccounts() {
  const accounts = ref<AccountInfo[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  onMounted(async () => {
    loading.value = true
    try {
      accounts.value = await fetchAccounts()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
    } finally {
      loading.value = false
    }
  })

  return {
    accounts,
    loading,
    error,
  }
}
