<script setup lang="ts">
import { useCrawlStatus } from '../composables/useCrawlStatus'

const { status, triggering, triggerCrawl } = useCrawlStatus()

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
      </span>
      <span
        v-else-if="status.status === 'error'"
        class="status-text error-text">
        エラー
      </span>
    </div>
    <button
      class="crawl-button"
      :disabled="triggering || status?.status === 'running'"
      aria-label="クロール実行"
      @click="triggerCrawl">
      <!-- PC: テキスト表示 / スマホ: アイコンのみ表示 -->
      <svg viewBox="0 0 24 24" class="crawl-icon" aria-hidden="true">
        <path
          d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
          fill="currentColor" />
      </svg>
      <span class="crawl-btn-label">クロール実行</span>
    </button>
  </div>
</template>

<style scoped>
.crawl-status {
  display: flex;
  align-items: center;
  gap: 12px;
}

.crawl-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  /* PC ではアイコンを非表示 */
  display: none;
}

/* スマホではアイコンを表示し、テキストを非表示にする */
@media (max-width: 768px) {
  .crawl-icon {
    display: block;
  }

  .crawl-btn-label {
    display: none;
  }

  /* アイコンのみになるため正方形に近いパディングに変更 */
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
</style>
