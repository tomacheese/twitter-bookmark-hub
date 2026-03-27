<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BookmarkItem, UrlEntity } from '../api'

/** タッチデバイス判定 */
const isTouchDevice =
  globalThis.window !== undefined &&
  ('ontouchstart' in globalThis || navigator.maxTouchPoints > 0)

const properties = defineProps<{
  /** ブックマークアイテム */
  item: BookmarkItem
}>()

// ---- アバター ---------------------------------------------------------------

/**
 * スクリーンネームからアバターの色相を生成する（プロフィール画像がない場合に使用）
 */
const avatarHue = computed(
  () =>
    [...properties.item.screenName].reduce(
      (accumulator, c) => accumulator + (c.codePointAt(0) ?? 0),
      0
    ) % 360
)
const initial = computed(() => properties.item.userName.charAt(0).toUpperCase())

const quotedAvatarHue = computed(() => {
  if (!properties.item.quotedTweet) return 0
  return (
    [...properties.item.quotedTweet.screenName].reduce(
      (accumulator, c) => accumulator + (c.codePointAt(0) ?? 0),
      0
    ) % 360
  )
})

// ---- タイムスタンプ ----------------------------------------------------------

/**
 * Twitter スタイルの相対時刻を返す
 * 1分未満: "たった今"
 * 60分未満: "Xm"
 * 24時間未満: "Xh"
 * 7日未満: "Xd"
 * 同じ年: "3月15日"
 * 年をまたぐ: "2023年3月15日"
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr = Math.floor(diffMs / 3_600_000)
  const diffDay = Math.floor(diffMs / 86_400_000)

  if (diffMin < 1) return 'たった今'
  if (diffMin < 60) return `${diffMin}分`
  if (diffHr < 24) return `${diffHr}時間`
  if (diffDay < 7) return `${diffDay}日`

  const sameYear = date.getFullYear() === now.getFullYear()
  const m = date.getMonth() + 1
  const d = date.getDate()
  if (sameYear) return `${m}月${d}日`
  return `${date.getFullYear()}年${m}月${d}日`
}

/**
 * ツールチップ用のフル日時文字列を返す（yyyy/mm/dd HH:MM）
 */
function formatFullDate(dateString: string): string {
  const d = new Date(dateString)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${y}/${mo}/${dy} ${h}:${mi}`
}

const relativeTime = computed(() =>
  formatRelativeTime(properties.item.createdAt)
)
const fullDateTitle = computed(() => formatFullDate(properties.item.createdAt))

// ---- ライトボックス ----------------------------------------------------------

/** ライトボックスに表示中の画像 URL */
const lightboxUrl = ref<string | null>(null)

/**
 * 指定した画像 URL でライトボックスを開く
 * @param url 表示する画像 URL（大きいサイズに変換される）
 */
function openLightbox(url: string) {
  lightboxUrl.value = upgradedImageUrl(url, 'large')
}
/** ライトボックスを閉じる */
function closeLightbox() {
  lightboxUrl.value = null
}

// ---- モバイル開くメニュー ---------------------------------------------------

/** モバイル向けのツイート開く選択メニュー表示状態 */
const showOpenMenu = ref(false)

// ---- カードクリック ---------------------------------------------------------

/**
 * カードのアクティベート処理。
 * PC: 別タブで Web を開く / モバイル: 選択メニューを表示する
 */
function activateCard() {
  if (isTouchDevice) {
    showOpenMenu.value = true
  } else {
    window.open(properties.item.tweetUrl, '_blank', 'noopener,noreferrer')
  }
}

/**
 * カード本体クリック時の処理。
 * インタラクティブ要素へのクリックは無視する。
 */
function onCardClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (
    target.closest(
      'a, button, video, .media-image, .quoted-tweet, .lightbox, .open-menu'
    )
  )
    return
  activateCard()
}

/**
 * カード本体のキーボード操作ハンドラー。
 * Enter / Space キーでカードをアクティベートする。
 * フォーカスが子要素にある場合は無視する。
 */
function onCardKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  if (event.target !== event.currentTarget) return
  event.preventDefault()
  activateCard()
}

// ---- テキストパーサー -------------------------------------------------------

/** テキストセグメント型 */
type TextSegment =
  | { type: 'text'; content: string }
  | { type: 'url'; url: string; display: string }
  | { type: 'hashtag'; tag: string }

/**
 * URL エンティティから short URL → 展開 URL・表示 URL のマップを生成する
 * @param urlEntities URL エンティティ一覧
 * @returns short URL をキーとしたマップ
 */
function buildUrlMap(
  urlEntities: UrlEntity[]
): Map<string, { expanded: string; display: string }> {
  const map = new Map<string, { expanded: string; display: string }>()
  for (const u of urlEntities) {
    map.set(u.url, { expanded: u.expandedUrl, display: u.displayUrl })
  }
  return map
}

/**
 * テキストを URL・ハッシュタグ・プレーンテキストのセグメントに分割する
 */
function parseTextSegments(
  text: string,
  urlEntities: UrlEntity[]
): TextSegment[] {
  const urlMap = buildUrlMap(urlEntities)
  const segments: TextSegment[] = []
  const regex = /(https?:\/\/[^\s]+|#[\w\u3000-\u9FFF\uAC00-\uD7A3]+)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      })
    }
    const token = match[0]
    if (token.startsWith('#')) {
      segments.push({ type: 'hashtag', tag: token.slice(1) })
    } else {
      const mapped = urlMap.get(token)
      if (mapped) {
        segments.push({
          type: 'url',
          url: mapped.expanded,
          display: mapped.display,
        })
      } else if (token.includes('t.co/')) {
        // メディアプレースホルダー URL は除去
      } else {
        segments.push({ type: 'url', url: token, display: token })
      }
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) })
  }
  return segments
}

const textSegments = computed(() =>
  parseTextSegments(properties.item.fullText, properties.item.urlEntities)
)
const quotedTextSegments = computed(() => {
  if (!properties.item.quotedTweet) return []
  return parseTextSegments(
    properties.item.quotedTweet.fullText,
    properties.item.quotedTweet.urlEntities
  )
})

// ---- YouTube 埋め込み -------------------------------------------------------

/** YouTube の embed を許可するホスト名一覧 */
const YOUTUBE_EMBED_HOSTS = new Set(['youtube.com', 'www.youtube.com'])
/** YouTube 動画 ID の形式（11 文字の英数字・ハイフン・アンダースコア） */
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

/**
 * cardPlayerUrl から YouTube の embed URL を生成する。
 * protocol と hostname を厳密に検証し、許可ホスト以外は null を返す。
 */
const youtubeEmbedUrl = computed(() => {
  const raw = properties.item.cardPlayerUrl
  if (!raw) return null

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null

  // すでに embed URL の場合はそのまま返す
  if (
    YOUTUBE_EMBED_HOSTS.has(parsed.hostname) &&
    parsed.pathname.startsWith('/embed/')
  ) {
    return raw
  }

  // /watch?v= 形式
  if (YOUTUBE_EMBED_HOSTS.has(parsed.hostname)) {
    const videoId = parsed.searchParams.get('v')
    if (videoId && YOUTUBE_VIDEO_ID_RE.test(videoId))
      return `https://www.youtube.com/embed/${videoId}`
  }

  // youtu.be 短縮 URL
  if (parsed.hostname === 'youtu.be') {
    const videoId = parsed.pathname.slice(1)
    if (videoId && YOUTUBE_VIDEO_ID_RE.test(videoId))
      return `https://www.youtube.com/embed/${videoId}`
  }

  return null
})

// ---- メディアグリッド -------------------------------------------------------

/**
 * 写真の枚数に応じたメディアグリッドのクラスを返す
 */
const mediaGridClass = computed(() => {
  const count = properties.item.mediaItems.filter(
    (m) => m.type === 'photo'
  ).length
  if (count === 1) return 'media-grid-1'
  if (count === 2) return 'media-grid-2'
  if (count === 3) return 'media-grid-3'
  return 'media-grid-4'
})

/**
 * pbs.twimg.com の画像 URL をより高解像度のサイズに書き換える
 * @param url 元の画像 URL
 * @param size 変換先サイズ（'medium' または 'large'）
 */
function upgradedImageUrl(
  url: string,
  size: 'medium' | 'large' = 'medium'
): string {
  return url
    .replace(/\bname=small\b/, `name=${size}`)
    .replace(/\bname=thumb\b/, `name=${size}`)
    .replace(/:small$/, `:${size}`)
    .replace(/:thumb$/, `:${size}`)
}

// ---- その他 ----------------------------------------------------------------

/** Twitter アプリ用のディープリンク URL */
const twitterAppUrl = computed(
  () => `twitter://status?id=${properties.item.tweetId}`
)
</script>

<template>
  <article
    class="tweet"
    tabindex="0"
    @click="onCardClick"
    @keydown="onCardKeydown">
    <!-- 左カラム: アバター -->
    <div class="tweet-avatar-col">
      <div
        class="avatar"
        :style="
          item.profileImageUrl
            ? {}
            : { background: `hsl(${avatarHue}, 60%, 40%)` }
        ">
        <img
          v-if="item.profileImageUrl"
          :src="item.profileImageUrl"
          :alt="item.userName"
          class="avatar-img"
          referrerpolicy="no-referrer" />
        <span v-else class="avatar-initial">{{ initial }}</span>
      </div>
    </div>

    <!-- 右カラム: コンテンツ -->
    <div class="tweet-content">
      <!-- ヘッダー: 表示名・ハンドル・時刻・リンクボタン -->
      <div class="tweet-header">
        <div class="tweet-meta" :title="fullDateTitle">
          <span class="display-name">{{ item.userName }}</span>
          <span class="meta-right">
            <span class="screen-name">@{{ item.screenName }}</span>
            <span class="meta-sep" aria-hidden="true">·</span>
            <time class="tweet-time">{{ relativeTime }}</time>
          </span>
        </div>
        <!-- ヘッダー右: 外部リンクボタン -->
        <div class="tweet-nav-btns">
          <a
            :href="item.tweetUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="tweet-nav-btn"
            title="ブラウザで開く"
            @click.stop>
            <svg viewBox="0 0 24 24" class="nav-icon" aria-hidden="true">
              <path
                d="M18.36 5.64a9 9 0 1 0 0 12.73A9 9 0 0 0 18.36 5.64zM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm1-7.5V9h-2v2.5H8.5V13H11v3h2v-3h2.5v-1.5H13z"
                fill="currentColor" />
            </svg>
          </a>
          <a
            :href="twitterAppUrl"
            class="tweet-nav-btn"
            title="アプリで開く"
            @click.stop>
            <svg viewBox="0 0 24 24" class="nav-icon" aria-hidden="true">
              <path
                d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
                fill="currentColor" />
            </svg>
          </a>
        </div>
      </div>

      <!-- ツイート本文 -->
      <div class="tweet-text">
        <template v-for="(seg, i) in textSegments" :key="i">
          <a
            v-if="seg.type === 'url'"
            :href="seg.url"
            target="_blank"
            rel="noopener noreferrer"
            class="text-link"
            @click.stop
            >{{ seg.display }}</a
          >
          <a
            v-else-if="seg.type === 'hashtag'"
            :href="`https://twitter.com/hashtag/${seg.tag}`"
            target="_blank"
            rel="noopener noreferrer"
            class="text-link"
            @click.stop
            >#{{ seg.tag }}</a
          >
          <span v-else>{{ seg.content }}</span>
        </template>
      </div>

      <!-- YouTube 埋め込み -->
      <div v-if="youtubeEmbedUrl" class="embed-container">
        <iframe
          :src="youtubeEmbedUrl"
          class="embed-iframe"
          frameborder="0"
          allowfullscreen
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          allow="
            accelerometer;
            autoplay;
            clipboard-write;
            encrypted-media;
            gyroscope;
            picture-in-picture;
          " />
      </div>

      <!-- 動画 / GIF -->
      <template v-for="(media, i) in item.mediaItems" :key="`v${i}`">
        <div
          v-if="
            (media.type === 'video' || media.type === 'animated_gif') &&
            media.videoUrl
          "
          class="media-container media-grid-1">
          <video
            class="media-video"
            :src="media.videoUrl"
            :poster="media.thumbUrl"
            :autoplay="media.type === 'animated_gif'"
            :loop="media.type === 'animated_gif'"
            :muted="media.type === 'animated_gif'"
            :controls="media.type === 'video'"
            playsinline
            preload="metadata"
            referrerpolicy="no-referrer" />
        </div>
      </template>

      <!-- 写真グリッド -->
      <div
        v-if="item.mediaItems.some((m) => m.type === 'photo')"
        class="media-container"
        :class="mediaGridClass">
        <img
          v-for="(media, i) in item.mediaItems
            .filter((m) => m.type === 'photo')
            .slice(0, 4)"
          :key="i"
          :src="upgradedImageUrl(media.thumbUrl, 'medium')"
          class="media-image"
          loading="lazy"
          alt=""
          @click="openLightbox(media.thumbUrl)" />
      </div>

      <!-- OGP リンクカード -->
      <a
        v-if="item.cardInfo"
        :href="item.cardInfo.cardUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="link-card"
        :class="{
          'link-card-large': item.cardInfo.cardType === 'summary_large_image',
        }"
        @click.stop>
        <!-- summary_large_image: 大きい画像を上部に表示 -->
        <div
          v-if="
            item.cardInfo.cardType === 'summary_large_image' &&
            item.cardInfo.thumbnailUrl
          "
          class="link-card-image-top">
          <img :src="item.cardInfo.thumbnailUrl" loading="lazy" alt="" />
        </div>
        <div class="link-card-body">
          <!-- summary: 小さい画像を左に表示 -->
          <img
            v-if="
              item.cardInfo.cardType === 'summary' && item.cardInfo.thumbnailUrl
            "
            :src="item.cardInfo.thumbnailUrl"
            class="link-card-image-side"
            loading="lazy"
            alt="" />
          <div class="link-card-text">
            <div class="link-card-domain">{{ item.cardInfo.vanityUrl }}</div>
            <div class="link-card-title">{{ item.cardInfo.title }}</div>
            <div v-if="item.cardInfo.description" class="link-card-desc">
              {{ item.cardInfo.description }}
            </div>
          </div>
        </div>
      </a>

      <!-- 引用ツイート -->
      <div v-if="item.quotedTweet" class="quoted-tweet">
        <!-- 引用ツイートのヘッダー -->
        <div class="quoted-header">
          <div
            class="quoted-avatar"
            :style="
              item.quotedTweet.profileImageUrl
                ? {}
                : { background: `hsl(${quotedAvatarHue}, 60%, 40%)` }
            ">
            <img
              v-if="item.quotedTweet.profileImageUrl"
              :src="item.quotedTweet.profileImageUrl"
              :alt="item.quotedTweet.userName"
              class="avatar-img"
              referrerpolicy="no-referrer" />
            <span v-else class="avatar-initial" style="font-size: 9px">
              {{ item.quotedTweet.userName.charAt(0).toUpperCase() }}
            </span>
          </div>
          <span class="quoted-display-name">{{
            item.quotedTweet.userName
          }}</span>
          <span class="quoted-screen-name"
            >@{{ item.quotedTweet.screenName }}</span
          >
        </div>
        <!-- 引用ツイートの本文 -->
        <div class="quoted-text">
          <template v-for="(seg, i) in quotedTextSegments" :key="i">
            <a
              v-if="seg.type === 'url'"
              :href="seg.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-link"
              @click.stop
              >{{ seg.display }}</a
            >
            <a
              v-else-if="seg.type === 'hashtag'"
              :href="`https://twitter.com/hashtag/${seg.tag}`"
              target="_blank"
              rel="noopener noreferrer"
              class="text-link"
              @click.stop
              >#{{ seg.tag }}</a
            >
            <span v-else>{{ seg.content }}</span>
          </template>
        </div>
        <!-- 引用ツイートのメディア -->
        <template v-for="(media, i) in item.quotedTweet.mediaItems" :key="i">
          <div
            v-if="
              (media.type === 'video' || media.type === 'animated_gif') &&
              media.videoUrl
            "
            class="media-container media-grid-1 quoted-media">
            <video
              class="media-video"
              :src="media.videoUrl"
              :poster="media.thumbUrl"
              :autoplay="media.type === 'animated_gif'"
              :loop="media.type === 'animated_gif'"
              :muted="media.type === 'animated_gif'"
              :controls="media.type === 'video'"
              playsinline
              preload="metadata"
              referrerpolicy="no-referrer" />
          </div>
        </template>
        <div
          v-if="item.quotedTweet.mediaItems.some((m) => m.type === 'photo')"
          class="media-container media-grid-1 quoted-media">
          <img
            :src="
              upgradedImageUrl(
                item.quotedTweet.mediaItems.find((m) => m.type === 'photo')!
                  .thumbUrl
              )
            "
            class="media-image"
            loading="lazy"
            alt=""
            @click="
              openLightbox(
                item.quotedTweet.mediaItems.find((m) => m.type === 'photo')!
                  .thumbUrl
              )
            " />
        </div>
      </div>

      <!-- フッター: ブックマーク済みアカウント -->
      <div class="tweet-footer">
        <div class="bookmarked-by">
          <svg viewBox="0 0 24 24" class="bookmark-icon" aria-hidden="true">
            <path
              d="M6 2a2 2 0 0 0-2 2v17.586l8-4 8 4V4a2 2 0 0 0-2-2H6zm0 2h12v14.414l-6-3-6 3V4z"
              fill="currentColor" />
          </svg>
          <span
            v-for="account in item.bookmarkedBy"
            :key="account"
            class="bookmark-account"
            >@{{ account }}</span
          >
        </div>
      </div>
    </div>
  </article>

  <!-- モバイル向けツイート開く選択メニュー -->
  <Teleport to="body">
    <div
      v-if="showOpenMenu"
      class="open-menu-overlay"
      @click.self="showOpenMenu = false">
      <div class="open-menu">
        <div class="open-menu-title">ツイートを開く</div>
        <a
          :href="item.tweetUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="open-menu-item"
          @click="showOpenMenu = false">
          <svg
            viewBox="0 0 24 24"
            class="open-menu-icon-svg"
            aria-hidden="true">
            <path
              d="M18.36 5.64a9 9 0 1 0 0 12.73A9 9 0 0 0 18.36 5.64zM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm1-7.5V9h-2v2.5H8.5V13H11v3h2v-3h2.5v-1.5H13z"
              fill="currentColor" />
          </svg>
          <span>ブラウザで開く</span>
        </a>
        <a
          :href="`twitter://status?id=${item.tweetId}`"
          class="open-menu-item"
          @click="showOpenMenu = false">
          <svg
            viewBox="0 0 24 24"
            class="open-menu-icon-svg"
            aria-hidden="true">
            <path
              d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
              fill="currentColor" />
          </svg>
          <span>X アプリで開く</span>
        </a>
        <button class="open-menu-cancel" @click="showOpenMenu = false">
          キャンセル
        </button>
      </div>
    </div>
  </Teleport>

  <!-- 画像ライトボックス -->
  <Teleport to="body">
    <div v-if="lightboxUrl" class="lightbox" @click="closeLightbox">
      <img :src="lightboxUrl" class="lightbox-img" alt="" @click.stop />
      <button class="lightbox-close" aria-label="閉じる" @click="closeLightbox">
        ✕
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* ============================================================
   ツイートカード全体
   パディング 12px 16px は Twitter の実測値に準拠
   ============================================================ */
.tweet {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  transition: background 0.15s;
  /* テキスト選択を妨げないようにする */
  -webkit-tap-highlight-color: transparent;
}

.tweet:hover {
  background: rgba(255, 255, 255, 0.03);
}

/* ============================================================
   アバター (40px — Twitter タイムラインの実測値)
   ============================================================ */
.tweet-avatar-col {
  flex-shrink: 0;
  width: 40px;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  flex-shrink: 0;
  background: var(--color-bg-secondary);
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avatar-initial {
  line-height: 1;
  user-select: none;
}

/* ============================================================
   コンテンツ列
   ============================================================ */
.tweet-content {
  flex: 1;
  min-width: 0;
}

/* ============================================================
   ヘッダー行: 表示名・ハンドル・時刻 + ナビゲーションボタン
   ============================================================ */
.tweet-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  line-height: 20px;
  margin-bottom: 2px;
}

.tweet-meta {
  display: flex;
  align-items: baseline;
  gap: 0;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  flex: 1;
}

/* 表示名: オーバーフロー時に省略 */
.display-name {
  font-weight: 700;
  font-size: 15px;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  min-width: 0;
}

/* @handle・セパレーター・時刻: 常に表示（縮まない） */
.meta-right {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 4px;
}

.screen-name,
.meta-sep,
.tweet-time {
  font-size: 15px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

/* 外部リンクボタン群 */
.tweet-nav-btns {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.tweet-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: var(--color-text-secondary);
  text-decoration: none;
  transition:
    background 0.15s,
    color 0.15s;
}

.tweet-nav-btn:hover {
  background: rgba(29, 155, 240, 0.1);
  color: var(--color-accent);
}

.nav-icon {
  width: 18px;
  height: 18px;
}

/* ============================================================
   ツイート本文
   Twitter 実測値: font-size 15px / line-height 20px
   ============================================================ */
.tweet-text {
  font-size: 15px;
  line-height: 20px;
  color: var(--color-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.text-link {
  color: var(--color-accent);
  text-decoration: none;
}

.text-link:hover {
  text-decoration: underline;
}

/* ============================================================
   YouTube 埋め込み
   ============================================================ */
.embed-container {
  margin-top: 12px;
  border-radius: 16px;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  background: #000;
}

.embed-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}

/* ============================================================
   メディアコンテナ共通
   gap 2px・border-radius 16px は Twitter の実測値に準拠
   ============================================================ */
.media-container {
  margin-top: 12px;
  display: grid;
  gap: 2px;
  border-radius: 16px;
  overflow: hidden;
}

/* 1 枚: 自然なアスペクト比を維持しつつ最大高さ 504px */
.media-grid-1 {
  grid-template-columns: 1fr;
}

.media-grid-1 .media-image {
  width: 100%;
  max-height: 504px;
  object-fit: cover;
  display: block;
}

/* 2 枚: 横並び、コンテナ全体 7:4 (各セル 7:8) */
.media-grid-2 {
  grid-template-columns: 1fr 1fr;
  aspect-ratio: 7 / 4;
}

/* 3 枚: 左に縦長 1 枚 (7:8)・右に 2 枚縦積み (各 4:7)
         コンテナ全体 16:9 */
.media-grid-3 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  aspect-ratio: 16 / 9;
}

.media-grid-3 .media-image:first-child {
  grid-row: 1 / 3;
}

/* 4 枚: 2×2 グリッド、コンテナ全体 2:1 */
.media-grid-4 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  aspect-ratio: 2 / 1;
}

/* 画像共通: セルを完全に埋める */
.media-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  cursor: zoom-in;
}

/* 動画 */
.media-video {
  width: 100%;
  max-height: 400px;
  display: block;
  background: #000;
}

/* ============================================================
   OGP リンクカード
   Twitter 実測値: border 1px solid #2F3336・border-radius 16px
   ============================================================ */
.link-card {
  display: block;
  margin-top: 12px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  transition: background 0.15s;
}

.link-card:hover {
  background: rgba(255, 255, 255, 0.03);
}

/* summary_large_image: 上部に大きい画像 */
.link-card-image-top {
  width: 100%;
  aspect-ratio: 2 / 1;
  overflow: hidden;
  background: var(--color-bg-secondary);
}

.link-card-image-top img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.link-card-body {
  display: flex;
  gap: 12px;
  padding: 12px;
}

/* summary: 左に小さい画像 */
.link-card-image-side {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 8px;
  flex-shrink: 0;
  background: var(--color-bg-secondary);
}

.link-card-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  justify-content: center;
}

.link-card-domain {
  font-size: 13px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.link-card-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 20px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.link-card-desc {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 16px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* ============================================================
   引用ツイート
   ============================================================ */
.quoted-tweet {
  margin-top: 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 12px;
  cursor: default;
}

.quoted-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
  overflow: hidden;
  white-space: nowrap;
}

.quoted-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  flex-shrink: 0;
  background: var(--color-bg-secondary);
}

.quoted-display-name {
  font-weight: 700;
  font-size: 14px;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.quoted-screen-name {
  color: var(--color-text-secondary);
  font-size: 14px;
  flex-shrink: 0;
}

.quoted-text {
  font-size: 14px;
  line-height: 18px;
  color: var(--color-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.quoted-media {
  margin-top: 8px;
  max-height: 200px;
  overflow: hidden;
}

.quoted-media .media-image,
.quoted-media .media-video {
  max-height: 200px;
}

/* ============================================================
   フッター: ブックマーク済みアカウント
   ============================================================ */
.tweet-footer {
  margin-top: 10px;
}

.bookmarked-by {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.bookmark-icon {
  width: 16px;
  height: 16px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.bookmark-account {
  font-size: 13px;
  color: var(--color-text-secondary);
}

/* ============================================================
   モバイル向けツイート開く選択メニュー (ボトムシート)
   ============================================================ */
.open-menu-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1000;
  padding: 0 16px 16px;
  backdrop-filter: blur(4px);
}

.open-menu {
  background: #1e2732;
  border-radius: 20px;
  width: 100%;
  max-width: 480px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.open-menu-title {
  padding: 16px;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
  border-bottom: 1px solid var(--color-border);
}

.open-menu-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  text-decoration: none;
  color: var(--color-text-primary);
  font-size: 15px;
  border-bottom: 1px solid var(--color-border);
  transition: background 0.15s;
}

.open-menu-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.open-menu-icon-svg {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.open-menu-cancel {
  display: block;
  width: 100%;
  padding: 16px;
  border: none;
  background: transparent;
  color: var(--color-accent);
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  text-align: center;
  transition: background 0.15s;
}

.open-menu-cancel:hover {
  background: rgba(255, 255, 255, 0.05);
}

/* ============================================================
   ライトボックス
   ============================================================ */
.lightbox {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  cursor: zoom-out;
}

.lightbox-img {
  max-width: 92vw;
  max-height: 92vh;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 4px 32px rgba(0, 0, 0, 0.8);
}

.lightbox-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 42px;
  height: 42px;
  border: none;
  border-radius: 50%;
  background: rgba(15, 20, 25, 0.75);
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.lightbox-close:hover {
  background: rgba(15, 20, 25, 0.9);
}
</style>
