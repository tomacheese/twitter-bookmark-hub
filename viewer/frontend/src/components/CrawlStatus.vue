<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useCrawlStatus } from '../composables/useCrawlStatus'
import type { CrawlAccountResult } from '../api'

const { status, triggering, triggerCrawl } = useCrawlStatus()

/** 詳細パネルの開閉状態 */
const showDetails = ref(false)

// クロールジョブが切り替わったら詳細パネルを自動で閉じる
watch(
  () => status.value?.id,
  () => {
    showDetails.value = false
  }
)

/** 失敗したアカウント結果の一覧 */
const failedAccounts = computed<CrawlAccountResult[]>(
  () => status.value?.accountResults.filter((r) => r.status === 'error') ?? []
)

/** エラー種別の表示ラベル */
const ERROR_TYPE_LABELS: Record<string, string> = {
  auth: '🔒 認証エラー',
  rate_limit: '⏱ レート制限',
  api: '⚠ API エラー',
  network: '🌐 ネットワークエラー',
  unknown: '❓ 不明なエラー',
}

/**
 * エラー種別を日本語ラベルに変換する
 * @param errorType - エラー種別
 * @returns 表示用ラベル
 */
function errorTypeLabel(errorType: CrawlAccountResult['errorType']): string {
  if (!errorType) return ''
  return ERROR_TYPE_LABELS[errorType] ?? '❓ 不明なエラー'
}

/**
 * 日時文字列を相対時刻に変換する
 * @param dateString - ISO 8601 形式の日時文字列
 * @returns 相対時刻の文字列
 */
function relativeTime(dateString: string): string {
  const now = Date.now()
  const then = new Date(dateString).getTime()
  const diff = Math.floor((now - then) / 1000)

  if (diff < 60) return `${diff} 秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`
  if (diff < 86_400) return `${Math.floor(diff / 3600)} 時間前`
  return `${Math.floor(diff / 86_400)} 日前`
}
</script>

<template>
  <div class="crawl-status">
    <div v-if="status" class="status-info">
      <span
        class="status-dot"
        :class="{
          running: status.status === 'running',
          success: status.status === 'success',
          error: status.status === 'error',
        }"></span>
      <span v-if="status.status === 'running'" class="status-text">
        クロール中...
        <template v-if="status.accountsTotal != null">
          ({{ status.accountsSucceeded ?? 0 }}/{{ status.accountsTotal }})
        </template>
      </span>
      <span v-else-if="status.status === 'success'" class="status-text">
        最終クロール:
        {{ status.finishedAt ? relativeTime(status.finishedAt) : '-' }}
        <template
          v-if="
            status.accountsTotal != null &&
            status.accountsSucceeded != null &&
            status.accountsSucceeded < status.accountsTotal
          ">
          ({{ status.accountsSucceeded }}/{{ status.accountsTotal }})
        </template>
      </span>
      <span
        v-else-if="status.status === 'error'"
        class="status-text error-text">
        エラー
      </span>

      <!-- 失敗アカウントが存在するとき詳細トグルを表示する -->
      <button
        v-if="failedAccounts.length > 0"
        class="details-toggle"
        :aria-expanded="showDetails"
        aria-label="失敗アカウントの詳細を表示"
        @click="showDetails = !showDetails">
        {{ showDetails ? '▲' : '▼' }}
      </button>
    </div>

    <button
      class="crawl-button"
      :disabled="triggering || status?.status === 'running'"
      aria-label="クロール実行"
      @click="triggerCrawl">
      <svg viewBox="0 0 24 24" class="crawl-icon" aria-hidden="true">
        <path
          d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
          fill="currentColor" />
      </svg>
      <span class="crawl-btn-label">クロール実行</span>
    </button>

    <!-- 失敗アカウント詳細パネル（ドロップダウン） -->
    <div
      v-if="showDetails && failedAccounts.length > 0"
      class="account-errors"
      role="list"
      aria-label="認証・クロール失敗アカウント一覧">
      <div
        v-for="result in failedAccounts"
        :key="result.username"
        class="account-error-item"
        role="listitem">
        <div class="account-error-header">
          <span class="account-username">@{{ result.username }}</span>
          <span class="account-error-type">{{
            errorTypeLabel(result.errorType)
          }}</span>
        </div>
        <p v-if="result.errorMessage" class="account-error-message">
          {{ result.errorMessage }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.crawl-status {
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
}

.crawl-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: none;
}

@media (max-width: 768px) {
  .crawl-icon {
    display: block;
  }

  .crawl-btn-label {
    display: none;
  }

  .crawl-button {
    padding: 7px 10px;
  }
}

.status-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-secondary);
  flex-shrink: 0;
}

.status-dot.running {
  background: var(--color-accent);
  animation: pulse 1.5s ease-in-out infinite;
}

.status-dot.success {
  background: var(--color-success);
}

.status-dot.error {
  background: var(--color-error);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.status-text {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.error-text {
  color: var(--color-error);
}

.details-toggle {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 10px;
  cursor: pointer;
  padding: 2px 4px;
  line-height: 1;
}

.details-toggle:hover {
  color: var(--color-text-primary);
}

.crawl-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: 9999px;
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s;
}

.crawl-button:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.crawl-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 失敗アカウント詳細パネル */
.account-errors {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 100;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 8px 0;
  min-width: 280px;
  max-width: 400px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}

.account-error-item {
  padding: 8px 16px;
}

.account-error-item + .account-error-item {
  border-top: 1px solid var(--color-border);
}

.account-error-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.account-username {
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 700;
}

.account-error-type {
  color: var(--color-error);
  font-size: 12px;
  white-space: nowrap;
}

.account-error-message {
  color: var(--color-text-secondary);
  font-size: 12px;
  margin-top: 4px;
  word-break: break-all;
  /* 長いエラーメッセージを 3 行以内に収める */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
