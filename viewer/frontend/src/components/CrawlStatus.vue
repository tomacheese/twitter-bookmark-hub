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
      @click="triggerCrawl">
      クロール実行
    </button>
  </div>
</template>

<style scoped>
.crawl-status {
  display: flex;
  align-items: center;
  gap: 12px;
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
  background: #00ba7c;
}

.status-dot.error {
  background: #f4212e;
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
  color: #f4212e;
}

.crawl-button {
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: 9999px;
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
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
