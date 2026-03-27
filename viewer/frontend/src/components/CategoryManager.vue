<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useCategories } from '../composables/useCategories'
import type { CategoryItem } from '../api'

const {
  categories,
  tags,
  loading,
  error,
  loadCategories,
  loadTags,
  addCategory,
  editCategory,
  removeCategory,
} = useCategories()

onMounted(async () => {
  await Promise.all([loadCategories(), loadTags()])
})

/** 新規作成フォームの表示状態 */
const showCreateForm = ref(false)

/** 新規作成フォームの入力値 */
const newName = ref('')
const newColor = ref('#3B82F6')
const newKeyword = ref('')
const newKeywords = ref<string[]>([])

/** 編集中のカテゴリ ID */
const editingId = ref<number | null>(null)

/** 編集フォームの入力値 */
const editName = ref('')
const editColor = ref('')
const editKeyword = ref('')
const editKeywords = ref<string[]>([])

/**
 * 新規キーワードをフォームに追加する
 * @param keyword - 追加するキーワード
 */
function addNewKeyword(keyword: string) {
  const trimmed = keyword.trim()
  if (trimmed && !newKeywords.value.includes(trimmed)) {
    newKeywords.value.push(trimmed)
  }
  newKeyword.value = ''
}

/**
 * 新規キーワードリストから削除する
 * @param keyword - 削除するキーワード
 */
function removeNewKeyword(keyword: string) {
  newKeywords.value = newKeywords.value.filter((k) => k !== keyword)
}

/**
 * 編集キーワードをフォームに追加する
 * @param keyword - 追加するキーワード
 */
function addEditKeyword(keyword: string) {
  const trimmed = keyword.trim()
  if (trimmed && !editKeywords.value.includes(trimmed)) {
    editKeywords.value.push(trimmed)
  }
  editKeyword.value = ''
}

/**
 * 編集キーワードリストから削除する
 * @param keyword - 削除するキーワード
 */
function removeEditKeyword(keyword: string) {
  editKeywords.value = editKeywords.value.filter((k) => k !== keyword)
}

/** 新規カテゴリを作成する */
async function handleCreate() {
  if (!newName.value.trim()) return
  await addCategory({
    name: newName.value.trim(),
    color: newColor.value,
    keywords: newKeywords.value,
  })
  // エラーがなければフォームをリセットして閉じる
  if (!error.value) {
    newName.value = ''
    newColor.value = '#3B82F6'
    newKeywords.value = []
    showCreateForm.value = false
  }
}

/**
 * カテゴリの編集を開始する
 * @param category - 編集対象カテゴリ
 */
function startEdit(category: CategoryItem) {
  editingId.value = category.id
  editName.value = category.name
  editColor.value = category.color
  editKeywords.value = [...category.keywords]
}

/** 編集をキャンセルする */
function cancelEdit() {
  editingId.value = null
}

/** カテゴリを更新する */
async function handleUpdate() {
  if (editingId.value === null || !editName.value.trim()) return
  await editCategory(editingId.value, {
    name: editName.value.trim(),
    color: editColor.value,
    keywords: editKeywords.value,
  })
  // エラーがなければ編集モードを終了する
  if (!error.value) {
    editingId.value = null
  }
}

/**
 * カテゴリを削除する
 * @param id - 削除するカテゴリ ID
 */
async function handleDelete(id: number) {
  await removeCategory(id)
}

/**
 * 新規作成フォームでのキーボード入力処理
 * Enter キーでキーワードを追加する
 */
function onNewKeywordKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    addNewKeyword(newKeyword.value)
  }
}

/**
 * 編集フォームでのキーボード入力処理
 * Enter キーでキーワードを追加する
 */
function onEditKeywordKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    addEditKeyword(editKeyword.value)
  }
}

/** 新規フォームに表示するサジェストタグ（すでに追加済みのものは除外） */
const newSuggestedTags = computed(() =>
  tags.value.filter((t) => !newKeywords.value.includes(t.name)).slice(0, 20)
)

/** 編集フォームに表示するサジェストタグ（すでに追加済みのものは除外） */
const editSuggestedTags = computed(() =>
  tags.value.filter((t) => !editKeywords.value.includes(t.name)).slice(0, 20)
)
</script>

<template>
  <div class="category-manager">
    <div class="manager-header">
      <h2 class="manager-title">カテゴリ管理</h2>
      <button
        class="btn-create"
        :class="{ active: showCreateForm }"
        @click="showCreateForm = !showCreateForm">
        {{ showCreateForm ? 'キャンセル' : '+ 新しいカテゴリ' }}
      </button>
    </div>

    <p class="manager-desc">
      ブックマークを自動分類するカテゴリを定義します。
      キーワードに一致するタグが含まれるブックマークが自動的に分類されます。
    </p>

    <!-- エラーメッセージ -->
    <p v-if="error" class="error-msg">{{ error }}</p>

    <!-- 新規作成フォーム -->
    <div v-if="showCreateForm" class="category-form">
      <h3 class="form-title">新しいカテゴリ</h3>
      <div class="form-row">
        <label class="form-label">名前</label>
        <input
          v-model="newName"
          type="text"
          class="form-input"
          placeholder="例: 技術・プログラミング"
          @keydown.enter.prevent="handleCreate" />
      </div>
      <div class="form-row">
        <label class="form-label">色</label>
        <input v-model="newColor" type="color" class="form-color" />
        <span class="color-preview" :style="{ background: newColor }" />
      </div>
      <div class="form-row">
        <label class="form-label">キーワード</label>
        <input
          v-model="newKeyword"
          type="text"
          class="form-input"
          placeholder="キーワードを入力して Enter"
          @keydown="onNewKeywordKeydown" />
      </div>
      <div v-if="newKeywords.length > 0" class="keyword-chips">
        <span v-for="kw in newKeywords" :key="kw" class="keyword-chip">
          {{ kw }}
          <button class="chip-remove" @click="removeNewKeyword(kw)">×</button>
        </span>
      </div>
      <!-- タグサジェスト -->
      <div v-if="newSuggestedTags.length > 0" class="tag-suggestions">
        <span class="suggestions-label">よく使われているタグ:</span>
        <button
          v-for="tag in newSuggestedTags"
          :key="tag.id"
          class="tag-suggest-btn"
          @click="addNewKeyword(tag.name)">
          {{ tag.name }}
          <span class="tag-count">{{ tag.count }}</span>
        </button>
      </div>
      <div class="form-actions">
        <button
          class="btn-primary"
          :disabled="!newName.trim()"
          @click="handleCreate">
          作成
        </button>
        <button class="btn-secondary" @click="showCreateForm = false">
          キャンセル
        </button>
      </div>
    </div>

    <!-- カテゴリ一覧 -->
    <div v-if="loading" class="loading">読み込み中...</div>
    <div v-else-if="categories.length === 0" class="empty">
      カテゴリがありません。「+ 新しいカテゴリ」から作成してください。
    </div>
    <ul v-else class="category-list">
      <li
        v-for="category in categories"
        :key="category.id"
        class="category-item">
        <!-- 編集フォーム -->
        <div v-if="editingId === category.id" class="edit-form">
          <div class="form-row">
            <label class="form-label">名前</label>
            <input v-model="editName" type="text" class="form-input" />
          </div>
          <div class="form-row">
            <label class="form-label">色</label>
            <input v-model="editColor" type="color" class="form-color" />
            <span class="color-preview" :style="{ background: editColor }" />
          </div>
          <div class="form-row">
            <label class="form-label">キーワード</label>
            <input
              v-model="editKeyword"
              type="text"
              class="form-input"
              placeholder="キーワードを入力して Enter"
              @keydown="onEditKeywordKeydown" />
          </div>
          <div v-if="editKeywords.length > 0" class="keyword-chips">
            <span v-for="kw in editKeywords" :key="kw" class="keyword-chip">
              {{ kw }}
              <button class="chip-remove" @click="removeEditKeyword(kw)">
                ×
              </button>
            </span>
          </div>
          <div v-if="editSuggestedTags.length > 0" class="tag-suggestions">
            <span class="suggestions-label">よく使われているタグ:</span>
            <button
              v-for="tag in editSuggestedTags"
              :key="tag.id"
              class="tag-suggest-btn"
              @click="addEditKeyword(tag.name)">
              {{ tag.name }}
              <span class="tag-count">{{ tag.count }}</span>
            </button>
          </div>
          <div class="form-actions">
            <button class="btn-primary" @click="handleUpdate">保存</button>
            <button class="btn-secondary" @click="cancelEdit">
              キャンセル
            </button>
          </div>
        </div>
        <!-- 通常表示 -->
        <div v-else class="category-row">
          <span class="category-dot" :style="{ background: category.color }" />
          <div class="category-info">
            <span class="category-name">{{ category.name }}</span>
            <div class="category-keywords">
              <span
                v-for="kw in category.keywords"
                :key="kw"
                class="keyword-chip small">
                {{ kw }}
              </span>
              <span v-if="category.keywords.length === 0" class="no-keywords">
                キーワードなし
              </span>
            </div>
          </div>
          <span class="category-badge"
            >{{ category.bookmarkCount ?? 0 }} 件</span
          >
          <div class="category-actions">
            <button class="btn-edit" @click="startEdit(category)">編集</button>
            <button class="btn-delete" @click="handleDelete(category.id)">
              削除
            </button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.category-manager {
  padding: 24px;
  max-width: 800px;
}

.manager-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.manager-title {
  font-size: 24px;
  font-weight: 800;
  color: var(--color-text-primary);
}

.manager-desc {
  color: var(--color-text-secondary);
  font-size: 14px;
  margin-bottom: 24px;
}

.error-msg {
  color: #ef4444;
  margin-bottom: 16px;
  font-size: 14px;
}

.loading,
.empty {
  color: var(--color-text-secondary);
  padding: 32px 0;
  text-align: center;
}

/* フォーム */
.category-form,
.edit-form {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 24px;
}

.form-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 16px;
  color: var(--color-text-primary);
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.form-label {
  font-size: 13px;
  color: var(--color-text-secondary);
  width: 80px;
  flex-shrink: 0;
}

.form-input {
  flex: 1;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px 12px;
  color: var(--color-text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus {
  border-color: var(--color-accent);
}

.form-color {
  width: 40px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  cursor: pointer;
  background: transparent;
}

.color-preview {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

/* キーワードチップ */
.keyword-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 12px;
  padding-left: 92px;
}

.keyword-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--color-text-primary);
}

.keyword-chip.small {
  font-size: 11px;
  padding: 1px 8px;
}

.chip-remove {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
}

.chip-remove:hover {
  color: #ef4444;
}

/* タグサジェスト */
.tag-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin: 8px 0 12px;
  padding-left: 92px;
}

.suggestions-label {
  font-size: 12px;
  color: var(--color-text-secondary);
  width: 100%;
  margin-bottom: 4px;
}

.tag-suggest-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    border-color 0.2s,
    color 0.2s;
}

.tag-suggest-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.tag-count {
  font-size: 10px;
  opacity: 0.7;
}

/* アクションボタン */
.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}

.btn-primary {
  padding: 8px 20px;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: 9999px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover {
  background: var(--color-accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 8px 20px;
  background: transparent;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  font-size: 14px;
  cursor: pointer;
  transition:
    border-color 0.2s,
    color 0.2s;
}

.btn-secondary:hover {
  border-color: var(--color-text-primary);
  color: var(--color-text-primary);
}

.btn-create {
  padding: 8px 16px;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: 9999px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-create:hover,
.btn-create.active {
  background: var(--color-accent-hover);
}

/* カテゴリリスト */
.category-list {
  list-style: none;
}

.category-item {
  border-bottom: 1px solid var(--color-border);
}

.category-item:last-child {
  border-bottom: none;
}

.category-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
}

.category-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.category-info {
  flex: 1;
  min-width: 0;
}

.category-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
  display: block;
  margin-bottom: 4px;
}

.category-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.no-keywords {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.category-badge {
  font-size: 13px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.category-actions {
  display: flex;
  gap: 6px;
}

.btn-edit {
  padding: 4px 12px;
  background: transparent;
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
  border-radius: 9999px;
  font-size: 12px;
  cursor: pointer;
  transition:
    background 0.2s,
    color 0.2s;
}

.btn-edit:hover {
  background: var(--color-accent);
  color: #fff;
}

.btn-delete {
  padding: 4px 12px;
  background: transparent;
  color: #ef4444;
  border: 1px solid #ef4444;
  border-radius: 9999px;
  font-size: 12px;
  cursor: pointer;
  transition:
    background 0.2s,
    color 0.2s;
}

.btn-delete:hover {
  background: #ef4444;
  color: #fff;
}
</style>
