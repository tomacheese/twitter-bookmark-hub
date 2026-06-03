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
 * Tweet オブジェクトから Grok 翻訳情報を抽出する。
 * grokTranslatedPostWithAvailability が存在しない・利用不可・翻訳が空の場合は
 * 全フィールド null・空配列を返す。
 *
 * @param tweet Twitter API の Tweet オブジェクト
 * @returns 翻訳テキスト・言語コード・URL エンティティを含むオブジェクト
 */
function extractGrokTranslation(tweet: TweetApiUtilsData['tweet']): {
  translatedText: string | null
  sourceLanguage: string | null
  destinationLanguage: string | null
  translatedUrlEntities: BookmarkEntry['urlEntities']
} {
  const empty = {
    translatedText: null,
    sourceLanguage: null,
    destinationLanguage: null,
    translatedUrlEntities: [] as BookmarkEntry['urlEntities'],
  }

  const grok = tweet.grokTranslatedPostWithAvailability
  // grok 翻訳が存在しない・利用不可の場合はスキップ
  if (!grok?.isAvailable || !grok.data) return empty

  const data = grok.data
  // 翻訳テキストが空の場合はスキップ
  if (!data.translation) return empty

  return {
    translatedText: data.translation,
    sourceLanguage: data.sourceLanguage ?? null,
    destinationLanguage: data.destinationLanguage ?? null,
    translatedUrlEntities: extractUrlEntities(data.entities ?? {}),
  }
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
  // Twitter API 変更により screenName/name は user.core に移動した（user.legacy をフォールバックとして保持）
  const screenName = user.core?.screenName ?? userLegacy.screenName
  const userName = user.core?.name ?? userLegacy.name
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
  const urlEntities = extractUrlEntities(legacy.entities ?? {})

  // 引用ツイートの抽出
  let quotedTweet: QuotedTweet | null = null
  if (tweetResult.quoted) {
    const qt = tweetResult.quoted
    // TweetApiUtilsData.tweet は Tweet 型（非 optional）のため optional chain 不要
    const qtLegacy = qt.tweet.legacy
    const qtUser = qt.user
    // User.legacy は必須フィールドのため optional chain 不要
    const qtUserLegacy = qtUser.legacy

    // Twitter API 変更により screenName/name は qtUser.core に移動した（qtUserLegacy をフォールバックとして保持）
    const qtScreenName = qtUser.core?.screenName ?? qtUserLegacy.screenName
    const qtUserName = qtUser.core?.name ?? qtUserLegacy.name
    if (qtLegacy && qtScreenName && qtUserName) {
      const qtGrok = extractGrokTranslation(qt.tweet)
      quotedTweet = {
        tweetId: qtLegacy.idStr,
        userId: qtUser.restId,
        fullText: qtLegacy.fullText,
        createdAt: new Date(qtLegacy.createdAt).toISOString(),
        screenName: qtScreenName,
        userName: qtUserName,
        profileImageUrl:
          qtUser.avatar?.imageUrl ?? qtUserLegacy.profileImageUrlHttps ?? null,
        mediaItems: extractMediaItems(qtLegacy),
        urlEntities: extractUrlEntities(qtLegacy.entities ?? {}),
        translatedText: qtGrok.translatedText,
        sourceLanguage: qtGrok.sourceLanguage,
        destinationLanguage: qtGrok.destinationLanguage,
        translatedUrlEntities: qtGrok.translatedUrlEntities,
      }
    }
  }

  // Grok 翻訳情報の抽出
  const grok = extractGrokTranslation(tweet)

  // カード情報の抽出（player / summary / summary_large_image / unified_card / article）
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

  // tweet.article が存在する場合は X 記事カードとして情報を抽出する。
  // card.legacy.bindingValues に記事情報が含まれないため、article フィールドから取得する。
  if (cardInfo === null && tweet.article?.articleResults.result) {
    const articleResult = tweet.article.articleResults.result
    // URL エンティティから x.com/i/article/... の展開 URL を取得し、
    // なければ restId から構築する
    const articleUrl =
      urlEntities.find((u) => u.expandedUrl.includes('/i/article/'))
        ?.expandedUrl ?? `https://x.com/i/article/${articleResult.restId}`
    const thumbnailUrl =
      articleResult.coverMedia?.mediaInfo.originalImgUrl ?? null
    cardInfo = {
      cardType: thumbnailUrl ? 'summary_large_image' : 'summary',
      cardUrl: articleUrl,
      vanityUrl: 'x.com',
      title: articleResult.title,
      description: articleResult.previewText,
      thumbnailUrl,
    }
  }

  return {
    tweetId,
    userId,
    fullText,
    screenName,
    userName,
    profileImageUrl:
      user.avatar?.imageUrl ?? userLegacy.profileImageUrlHttps ?? null,
    createdAt,
    mediaItems,
    urlEntities,
    quotedTweet,
    cardPlayerUrl,
    cardInfo,
    translatedText: grok.translatedText,
    sourceLanguage: grok.sourceLanguage,
    destinationLanguage: grok.destinationLanguage,
    translatedUrlEntities: grok.translatedUrlEntities,
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
 * それ以外のエラー（ネットワークエラー、レート制限等）は呼び出し元に再スローする。
 *
 * @param client TwitterOpenApi クライアント
 * @param tweetId ツイート ID
 * @throws DeleteBookmark フラグが存在しない、または queryId が不正な場合
 * @throws ブックマーク不存在以外のエラー（ネットワークエラー、レート制限等）
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
  await withRetry(
    async () => {
      try {
        return await postApiUtils.api.postDeleteBookmark(
          {
            pathQueryId: queryId,
            postDeleteBookmarkRequest: {
              queryId,
              variables: { tweetId },
            },
          },
          postApiUtils.initOverrides(flagEntry)
        )
      } catch (error) {
        // twitter-openapi-typescript は存在しないブックマークを削除しようとすると
        // レスポンスの .map() 呼び出しで TypeError が発生する。
        // このケースはブックマークが既に存在しない（冪等な削除）として無視し、
        // withRetry によるリトライをスキップする。
        if (
          error instanceof TypeError &&
          error.message.includes(
            "Cannot read properties of undefined (reading 'map')"
          )
        ) {
          return
        }
        throw error
      }
    },
    { operationName: `removeBookmark(${tweetId})` }
  )
}

/**
 * 認証情報を使って TwitterOpenApi クライアントを生成する。
 * CycleTLS を使った fetch でリクエストを送信する。
 *
 * @param authToken auth_token Cookie の値
 * @param ct0 ct0 Cookie の値
 * @param clientLanguage Twitter API クライアントの言語コード (BCP47)。API レスポンスの言語に影響する。省略時は 'ja'
 * @returns TwitterOpenApi クライアント
 */
export async function getBookmarksClient(
  authToken: string,
  ct0: string,
  clientLanguage = 'ja'
): Promise<TwitterOpenApiClient> {
  const api = new TwitterOpenApi()
  TwitterOpenApi.fetchApi = cycleTLSFetch
  // twitter-openapi-typescript は x-twitter-client-language を 'en' でハードコードしているため上書きする。
  // このヘッダーは Grok 翻訳先言語を含む API レスポンスの言語全体に影響する
  api.setAdditionalApiHeaders({ 'x-twitter-client-language': clientLanguage })
  return api.getClientFromCookies({ auth_token: authToken, ct0 })
}
