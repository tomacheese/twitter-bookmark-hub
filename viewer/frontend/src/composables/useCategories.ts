import { ref } from 'vue'
import {
  fetchCategories,
  createCategory as apiCreateCategory,
  updateCategory as apiUpdateCategory,
  deleteCategory as apiDeleteCategory,
  fetchTags,
} from '../api'
import type { CategoryItem, TagItem } from '../api'

// モジュールスコープの状態（シングルトン）
// App と Settings/CategoryManager で同じインスタンスを共有する
const categories = ref<CategoryItem[]>([])
const tags = ref<TagItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

/**
 * カテゴリ一覧の取得・作成・更新・削除を管理する composable
 */
export function useCategories() {
  /** カテゴリ一覧を取得する */
  async function loadCategories() {
    loading.value = true
    error.value = null
    try {
      categories.value = await fetchCategories()
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : 'Unknown error'
    } finally {
      loading.value = false
    }
  }

  /** タグサジェスト用に頻出タグを取得する */
  async function loadTags() {
    try {
      tags.value = await fetchTags(100)
    } catch {
      tags.value = []
    }
  }

  /**
   * カテゴリを作成する
   * @param data - カテゴリデータ
   */
  async function addCategory(data: {
    name: string
    color: string
    keywords: string[]
  }): Promise<void> {
    error.value = null
    try {
      await apiCreateCategory(data)
      await loadCategories()
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : 'Unknown error'
    }
  }

  /**
   * カテゴリを更新する
   * @param id - カテゴリ ID
   * @param data - 更新データ
   */
  async function editCategory(
    id: number,
    data: { name: string; color: string; keywords: string[] }
  ): Promise<void> {
    error.value = null
    try {
      await apiUpdateCategory(id, data)
      await loadCategories()
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : 'Unknown error'
    }
  }

  /**
   * カテゴリを削除する
   * @param id - カテゴリ ID
   */
  async function removeCategory(id: number): Promise<void> {
    error.value = null
    try {
      await apiDeleteCategory(id)
      await loadCategories()
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : 'Unknown error'
    }
  }

  return {
    categories,
    tags,
    loading,
    error,
    loadCategories,
    loadTags,
    addCategory,
    editCategory,
    removeCategory,
  }
}
