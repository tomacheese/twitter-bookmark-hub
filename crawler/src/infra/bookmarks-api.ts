import {
  TwitterOpenApi,
  type TwitterOpenApiClient,
  type TweetApiUtilsData,
} from 'twitter-openapi-typescript'
import type {
  BookmarkEntry,
  CardInfo,
  MediaItem,
  QuotedTweet,
  UrlEntity,
} from '../shared/types'
import { withRetry } from '../shared/retry'
import { cycleTLSFetch } from './cycletls'

/**
 * レガシーエンティティから URL エンティティを抽出する
 *
 * @param entities ツイートのエンティティオブジェクト
 * @returns URL エンティティ一覧
 */
function extractUrlEntities(entities: {
  urls?: { url: string; expandedUrl?: string; displayUrl: string }[]
}): UrlEntity[] {
  if (!entities.urls) return []
  return entities.urls
    .filter(
      (u): u is { url: string; expandedUrl: string; displayUrl: string } =>
        Boolean(u.url && u.expandedUrl)
    )
    .map((u) => ({
      url: u.url,
      expandedUrl: u.expandedUrl,
      displayUrl: u.displayUrl,
    }))
}

/**
 * レガシーエンティティからメディアアイテム一覧を抽出する。
 * 動画・GIF の場合は最高ビットレートの mp4 URL を videoUrl として含める。
 *
 * @param legacy ツイートのレガシーオブジェクト
 * @returns メディアアイテム一覧
 */
function extractMediaItems(legacy: {
  extendedEntities?: {
    media?: {
      type?: string
      mediaUrlHttps?: string
      videoInfo?: {
        variants?: { bitrate?: number; contentType: string; url: string }[]
      }
    }[]
  }
}): MediaItem[] {
  const items: MediaItem[] = []
  if (!legacy.extendedEntities?.media) return items

  for (const media of legacy.extendedEntities.media) {
    const thumbUrl = media.mediaUrlHttps
    if (!thumbUrl) continue

    const type =
      media.type === 'video'
        ? 'video'
        : media.type === 'animated_gif'
          ? 'animated_gif'
          : 'photo'

    if (type === 'video' || type === 'animated_gif') {
      // mp4 バリアントから最高ビットレートのものを選ぶ
      const mp4Variants = (media.videoInfo?.variants ?? [])
        .filter((v) => v.contentType === 'video/mp4')
        .toSorted((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
      const videoUrl = mp4Variants[0]?.url
      items.push({ type, thumbUrl, videoUrl })
    } else {
      items.push({ type: 'photo', thumbUrl })
    }
  }
  return items
}

/**
 * TweetApiUtilsData からブックマーク 1 件分のデータを抽出する。
 *
 * @param tweetResult TweetApiUtilsData
 * @returns BookmarkEntry または null (データ不足の場合)
 */
export function extractBookmarkEntry(
  tweetResult: TweetApiUtilsData
): BookmarkEntry | null {
  const tweet = tweetResult.tweet
  const user = tweetResult.user
  const legacy = tweet.legacy
  // User.legacy は必須フィールドのため optional chain 不要
  const userLegacy = user.legacy

  const tweetId = legacy?.idStr ?? tweet.restId
  // User.restId は必須フィールドのため fallback 不要
  const userId = user.restId
  const fullText = legacy?.fullText
  // UserLegacy.screenName / name は必須フィールドのため optional chain 不要
  const screenName = userLegacy.screenName
  const userName = userLegacy.name
  // Twitter API は "Wed Sep 24 11:28:06 +0000 2025" 形式で返すため ISO 8601 に変換する
  const createdAt = legacy?.createdAt
    ? new Date(legacy.createdAt).toISOString()
    : undefined

  // createdAt が取得できない場合は不正な日時を DB に保存しないよう null を返す
  if (
    !tweetId ||
    !userId ||
    !fullText ||
    !createdAt ||
    !screenName ||
    !userName
  ) {
    return null
  }

  // fullText が truthy なら legacy は TweetLegacy に narrowing される
  const mediaItems = extractMediaItems(legacy)
  const urlEntities = extractUrlEntities(legacy.entities)

  // 引用ツイートの抽出
  let quotedTweet: QuotedTweet | null = null
  if (tweetResult.quoted) {
    const qt = tweetResult.quoted
    // TweetApiUtilsData.tweet は Tweet 型（非 optional）のため optional chain 不要
    const qtLegacy = qt.tweet.legacy
    const qtUser = qt.user
    // User.legacy は必須フィールドのため optional chain 不要
    const qtUserLegacy = qtUser.legacy

    if (qtLegacy) {
      quotedTweet = {
        // TweetLegacy.idStr は必須フィールド
        tweetId: qtLegacy.idStr,
        // User.restId は必須フィールド
        userId: qtUser.restId,
        // TweetLegacy.fullText は必須フィールド
        fullText: qtLegacy.fullText,
        // TweetLegacy.createdAt は必須フィールド
        createdAt: new Date(qtLegacy.createdAt).toISOString(),
        // UserLegacy.screenName / name は必須フィールド
        screenName: qtUserLegacy.screenName,
        userName: qtUserLegacy.name,
        profileImageUrl: qtUserLegacy.profileImageUrlHttps,
        mediaItems: extractMediaItems(qtLegacy),
        // TweetLegacy.entities は必須フィールド
        urlEntities: extractUrlEntities(qtLegacy.entities),
      }
    }
  }

  // カード情報の抽出（player / summary / summary_large_image）
  let cardPlayerUrl: string | null = null
  let cardInfo: CardInfo | null = null
  const card = tweet.card
  if (card?.legacy?.bindingValues) {
    // binding values を Map に変換して効率よくアクセスする
    const bvMap = new Map(
      card.legacy.bindingValues.map((bv) => [bv.key, bv.value])
    )
    // TweetCardLegacy.name は必須フィールドのため fallback 不要
    const cardName = card.legacy.name

    if (cardName.includes('player')) {
      // 動画プレーヤーカード（YouTube 等）
      cardPlayerUrl = bvMap.get('player_url')?.stringValue ?? null
    } else if (cardName.includes('summary')) {
      // リンクカード（summary / summary_large_image）
      const cardUrl = bvMap.get('card_url')?.stringValue
      if (cardUrl) {
        const isLarge = cardName.includes('summary_large_image')
        const thumbImage =
          bvMap.get('thumbnail_image_original')?.imageValue ??
          bvMap.get('thumbnail_image')?.imageValue ??
          null
        // vanity_url がない場合、cardUrl から hostname を取り出すが
        // 不正な URL の場合は例外を避けるため cardUrl 自体をフォールバックにする
        let vanityUrl: string
        try {
          vanityUrl =
            bvMap.get('vanity_url')?.stringValue ?? new URL(cardUrl).hostname
        } catch {
          vanityUrl = bvMap.get('vanity_url')?.stringValue ?? cardUrl
        }
        cardInfo = {
          cardType: isLarge ? 'summary_large_image' : 'summary',
          cardUrl,
          vanityUrl,
          title: bvMap.get('title')?.stringValue ?? '',
          description: bvMap.get('description')?.stringValue ?? '',
          thumbnailUrl: thumbImage?.url ?? null,
        }
      }
    }
  }

  return {
    tweetId,
    userId,
    fullText,
    screenName,
    userName,
    // UserLegacy.profileImageUrlHttps は必須フィールドのため optional chain 不要
    profileImageUrl: userLegacy.profileImageUrlHttps,
    createdAt,
    mediaItems,
    urlEntities,
    quotedTweet,
    cardPlayerUrl,
    cardInfo,
  }
}

/**
 * 指定ツイートをブックマークに追加する。
 * PostApiUtils のラッパーには未実装のため、内部の generated PostApi を直接呼び出す。
 *
 * @param client TwitterOpenApi クライアント
 * @param tweetId ツイート ID
 * @throws CreateBookmark フラグが存在しない、または queryId が不正な場合
 */
export async function addBookmark(
  client: TwitterOpenApiClient,
  tweetId: string
): Promise<void> {
  const postApiUtils = client.getPostApi()
  // DefaultFlag は { [key: string]: { [key: string]: any } } 型だが、
  // 実行時に Twitter 初期ページから取得した queryId が格納されており存在しない場合がある
  const flagEntry = postApiUtils.flag.CreateBookmark as
    | { queryId: string }
    | undefined
  // flagEntry が存在しない、または queryId が文字列でない・空文字の場合は実行不可
  if (
    !flagEntry ||
    typeof flagEntry.queryId !== 'string' ||
    flagEntry.queryId.length === 0
  ) {
    throw new Error(
      'CreateBookmark flag not found or queryId is invalid. The API may not support this operation.'
    )
  }
  const queryId = flagEntry.queryId
  await withRetry(
    () =>
      postApiUtils.api.postCreateBookmark(
        {
          pathQueryId: queryId,
          postCreateBookmarkRequest: {
            queryId,
            variables: { tweetId },
          },
        },
        postApiUtils.initOverrides(flagEntry)
      ),
    { operationName: `addBookmark(${tweetId})` }
  )
}

/**
 * 指定ツイートをブックマークから削除する。
 * PostApiUtils のラッパーには未実装のため、内部の generated PostApi を直接呼び出す。
 * ブックマークが存在しない場合は冪等な削除として正常終了する。
 *
 * @param client TwitterOpenApi クライアント
 * @param tweetId ツイート ID
 * @throws DeleteBookmark フラグが存在しない、または queryId が不正な場合
 */
export async function removeBookmark(
  client: TwitterOpenApiClient,
  tweetId: string
): Promise<void> {
  const postApiUtils = client.getPostApi()
  // DefaultFlag は { [key: string]: { [key: string]: any } } 型だが、
  // 実行時に Twitter 初期ページから取得した queryId が格納されており存在しない場合がある
  const flagEntry = postApiUtils.flag.DeleteBookmark as
    | { queryId: string }
    | undefined
  // flagEntry が存在しない、または queryId が文字列でない・空文字の場合は実行不可
  if (
    !flagEntry ||
    typeof flagEntry.queryId !== 'string' ||
    flagEntry.queryId.length === 0
  ) {
    throw new Error(
      'DeleteBookmark flag not found or queryId is invalid. The API may not support this operation.'
    )
  }
  const queryId = flagEntry.queryId
  try {
    await withRetry(
      () =>
        postApiUtils.api.postDeleteBookmark(
          {
            pathQueryId: queryId,
            postDeleteBookmarkRequest: {
              queryId,
              variables: { tweetId },
            },
          },
          postApiUtils.initOverrides(flagEntry)
        ),
      { operationName: `removeBookmark(${tweetId})` }
    )
  } catch (error) {
    // twitter-openapi-typescript は存在しないブックマークを削除しようとすると
    // レスポンスの特定フィールドが undefined になり TypeError が発生する。
    // ブックマークが既に存在しない（冪等な削除）として無視する。
    if (
      error instanceof TypeError &&
      error.message.includes('Cannot read properties of undefined')
    ) {
      return
    }
    throw error
  }
}

/**
 * 認証情報を使って TwitterOpenApi クライアントを生成する。
 * CycleTLS を使った fetch でリクエストを送信する。
 *
 * @param authToken auth_token Cookie の値
 * @param ct0 ct0 Cookie の値
 * @returns TwitterOpenApi クライアント
 */
export async function getBookmarksClient(
  authToken: string,
  ct0: string
): Promise<TwitterOpenApiClient> {
  const api = new TwitterOpenApi()
  TwitterOpenApi.fetchApi = cycleTLSFetch
  return api.getClientFromCookies({ auth_token: authToken, ct0 })
}
