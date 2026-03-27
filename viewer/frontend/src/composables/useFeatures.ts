import { ref, onMounted } from 'vue'
import { fetchFeatures } from '../api'

/**
 * 機能フラグを管理する composable。
 * アプリ起動時に /api/features を取得し、analyzer の有効/無効を管理する。
 */
export function useFeatures() {
  /** analyzer サービスが有効かどうか */
  const analyzerEnabled = ref(false)
  /** 取得中かどうか */
  const loading = ref(true)

  onMounted(async () => {
    try {
      const features = await fetchFeatures()
      analyzerEnabled.value = features.analyzer
    } catch {
      analyzerEnabled.value = false
    } finally {
      loading.value = false
    }
  })

  return { analyzerEnabled, loading }
}
