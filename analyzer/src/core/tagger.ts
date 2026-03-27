import * as kuromoji from '@patdx/kuromoji'
import NodeDictionaryLoader from '@patdx/kuromoji/node'
import { eng as engStopWords } from 'stopword'

/**
 * 抽出対象とする名詞の品詞詳細一覧。
 * 「非自立」（こと・もの等）と「数」は除外する。
 */
const NOUN_DETAIL_ALLOWLIST = new Set([
  '一般',
  '固有名詞',
  'サ変接続',
  '形容動詞語幹',
  'ナイ形容詞語幹',
])

/**
 * stopword ライブラリの英語 stop word を Set 化したもの（小文字で比較）。
 * 前置詞・接続詞・冠詞・助動詞など話題を表さない英語語を除外する。
 */
const ENGLISH_STOP_WORDS = new Set(engStopWords)

/**
 * stopword ライブラリでカバーされない追加ノイズトークン（小文字で比較）。
 * URL 断片・ファイル拡張子由来の断片など、形態素解析後に残る記号的な断片を除外する。
 */
const EXTRA_NOISE_BLOCKLIST = new Set([
  // URL 断片
  'https',
  'http',
  'ftp',
  'co',
  'www',
  // ファイル拡張子・時刻略語由来の断片
  'just',
  'md',
  'pm',
])

/**
 * kuromoji が「名詞/一般」と分類するが、話題を表さない語の除外リスト（完全一致）。
 * YAKE スコアリングのみでは統計的に区別できない代名詞・感情語・スラングを対象とする。
 * 英語 stop word は ENGLISH_STOP_WORDS が担当するため、日本語固有の語のみ登録する。
 */
const JAPANESE_GENERIC_NOUNS = new Set([
  '自分', // 代名詞（reflexive pronoun）
  '感じ', // 汎用感情語（vague feeling noun）
  'マジ', // SNS スラング
  '全員', // 汎用集合名詞（non-topic）
  '元気', // 汎用状態語（non-topic）
  '是非', // 副詞的に使われる汎用語（non-topic）
])

/**
 * kuromoji IPAdic 形態素の最低限の型定義。
 * @patdx/kuromoji には型宣言ファイルがないため独自に定義する。
 */
interface KuromojiToken {
  /** 表層形（テキスト上に出現する文字列） */
  surface_form: string
  /** 品詞（「名詞」「動詞」等） */
  pos: string
  /** 品詞細分類 1 */
  pos_detail_1: string
  /** 基本形（辞書形）。取得できない場合は "*" */
  basic_form: string
}

/**
 * kuromoji トークナイザーの最低限のインターフェース。
 * @patdx/kuromoji には型宣言ファイルがないため独自に定義する。
 */
export interface KuromojiTokenizer {
  /** テキストを形態素に分割する */
  tokenize(text: string): KuromojiToken[]
}

/**
 * kuromoji トークナイザーを初期化する（起動時に 1 度だけ呼ぶ）。
 * 辞書の読み込みに時間がかかるため Promise を返す。
 * @returns 初期化済みトークナイザー
 */
export function initTokenizer(): Promise<KuromojiTokenizer> {
  return (
    new kuromoji.TokenizerBuilder({
      loader: new NodeDictionaryLoader({
        dic_path: 'node_modules/@patdx/kuromoji/dict/',
      }),
    }).build() as Promise<unknown>
  ).then((t) => t as KuromojiTokenizer)
}

/**
 * kuromoji が空白を記号トークンとして出力するかどうかを判定する。
 *
 * @param token - kuromoji トークン
 * @returns 空白トークンなら true
 */
function isSpaceToken(token: KuromojiToken): boolean {
  return token.pos === '記号' && token.pos_detail_1 === '空白'
}

/**
 * 連続する英字大文字始まりのトークン列を 1 つの複合語トークンに結合する。
 * 例: ["Claude", "Code"] → [{ surface_form: "Claude Code", pos: "名詞", ... }]
 * 例: ["Visual", "Studio", "Code"] → [{ surface_form: "Visual Studio Code", ... }]
 *
 * kuromoji は単語間の空白を「記号/空白」トークンとして出力するため、
 * 空白トークンを読み飛ばしながら隣接する大文字始まり語を結合する。
 *
 * @param tokens - kuromoji トークン列
 * @returns 複合語を結合済みのトークン列
 */
function mergeConsecutiveEnglishTokens(
  tokens: KuromojiToken[]
): KuromojiToken[] {
  const result: KuromojiToken[] = []
  let i = 0
  while (i < tokens.length) {
    // 英字大文字始まり 2 文字以上のトークンを連続する限り結合する
    if (/^[A-Z][A-Za-z]+$/.test(tokens[i].surface_form)) {
      const wordIndices: number[] = [i]
      let j = i + 1
      while (j < tokens.length) {
        if (isSpaceToken(tokens[j])) {
          // 空白の次も英字大文字始まりなら読み飛ばして続行、そうでなければ終了
          if (
            j + 1 < tokens.length &&
            /^[A-Z][A-Za-z]+$/.test(tokens[j + 1].surface_form)
          ) {
            j++
            continue
          }
          break
        }
        if (/^[A-Z][A-Za-z]+$/.test(tokens[j].surface_form)) {
          wordIndices.push(j)
          j++
        } else {
          break
        }
      }
      if (wordIndices.length > 1) {
        // 2 語以上連続した場合は結合して固有名詞として扱う
        const combined = wordIndices
          .map((idx) => tokens[idx].surface_form)
          .join(' ')
        result.push({
          surface_form: combined,
          pos: '名詞',
          pos_detail_1: '固有名詞',
          basic_form: combined,
        })
        i = j
      } else {
        result.push(tokens[i])
        i++
      }
    } else {
      result.push(tokens[i])
      i++
    }
  }
  return result
}

/**
 * YAKE（Yet Another Keyword Extractor）にインスパイアされたスコアリング。
 * ツイートテキスト内の候補語に重要度スコアを付ける。スコアが高いほど良いタグ候補。
 *
 * 採用した特徴量（YAKE の TCase・TPosition・TFreq に相当）:
 * - 位置スコア (TPosition): テキスト前半に出現するほど重要（先頭 1.0 → 末尾 0.5）
 * - 文字種スコア (TCase): 英大文字始まり > カタカナ語 > 漢字語 > ひらがなのみ
 * - 長さスコア: 長いほど特定性が高い（8 文字で上限）
 * - 頻度スコア (TFreq): 同一テキスト内で複数回出現する語はより重要
 *
 * @param word - 候補語
 * @param firstTokenIndex - トークン列内の最初の出現インデックス
 * @param totalTokens - トークン列の総数
 * @param frequency - テキスト内での出現回数
 * @returns 重要度スコア（高いほど重要）
 */
function scoreWord(
  word: string,
  firstTokenIndex: number,
  totalTokens: number,
  frequency: number
): number {
  // 位置スコア: 先頭に近いほど高い（前半 1.0 → 後半 0.5）
  const relPos = firstTokenIndex / Math.max(totalTokens - 1, 1)
  const posScore = 1 - relPos * 0.5

  // 文字種スコア: 英大文字始まり固有名詞を最重要視する
  const startsWithUpper = /^[A-Z]/.test(word)
  const hasKanji = /[\u4E00-\u9FFF]/.test(word)
  const hasKatakana = /[\u30A0-\u30FF]/.test(word)
  const isHiraganaOnly = /^[\u3040-\u309F]+$/.test(word)
  const scriptScore = startsWithUpper
    ? 1
    : hasKanji
      ? 0.7
      : hasKatakana
        ? 0.8
        : isHiraganaOnly
          ? 0.2
          : 0.5 // 小文字 ASCII

  // 長さスコア: 長いほど特定性が高い（8 文字で 1.0 に達する）
  const lengthScore = Math.min(word.length / 8, 1)

  // 頻度スコア: 対数で平滑化（4 回出現で上限付近）
  const freqScore = Math.log(1 + frequency) / Math.log(4)

  return (
    posScore * 0.15 + scriptScore * 0.4 + lengthScore * 0.35 + freqScore * 0.1
  )
}

/** ツイートごとに抽出するタグの最大件数 */
const MAX_TAGS_PER_TWEET = 15

/**
 * テキストから名詞を抽出し、YAKE インスパイアのスコアで重要度順に返す。
 * 各種ノイズ除去（英語 stop word・URL 断片・日本語汎用語）を適用後、
 * 上位 MAX_TAGS_PER_TWEET 件のみを返す。
 *
 * @param tokenizer - kuromoji トークナイザー
 * @param text - 解析対象テキスト
 * @returns 重要度降順に並んだタグ候補（最大 MAX_TAGS_PER_TWEET 件）
 */
export function extractNouns(
  tokenizer: KuromojiTokenizer,
  text: string
): string[] {
  // URL（https?://... の形式）を除去してから形態素解析する
  // t.co のような短縮 URL のパス部分がノイズトークンになるのを防ぐ
  // HTML エンティティ（&gt; &lt; &amp; 等）もデコードしてから解析する
  const cleanedText = text
    .replaceAll(/https?:\/\/\S+/g, '')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
  const tokens = mergeConsecutiveEnglishTokens(tokenizer.tokenize(cleanedText))

  // 候補語の出現情報（最初の出現インデックスと出現回数）を収集する
  const candidates = new Map<
    string,
    { firstIndex: number; frequency: number }
  >()

  for (const [i, token] of tokens.entries()) {
    if (token.pos !== '名詞') continue
    if (!NOUN_DETAIL_ALLOWLIST.has(token.pos_detail_1)) continue

    // 基本形を優先して使用（辞書形がなければ表層形）
    const word =
      token.basic_form && token.basic_form !== '*'
        ? token.basic_form
        : token.surface_form

    // 1 文字の単語は除外（ノイズが多い）
    if (word.length <= 1) continue

    // 文字（英数字・仮名・漢字）を含まない記号のみトークンは除外（"://" 等）
    if (!/[a-zA-Z0-9\u3040-\u9FFF]/.test(word)) continue

    // 英語トークン（ASCII のみ）は stopword ライブラリで stop word 判定
    if (/^[a-zA-Z]+$/.test(word) && ENGLISH_STOP_WORDS.has(word.toLowerCase()))
      continue

    // URL 断片・ファイル拡張子由来など、stopword でカバーされない追加ノイズを除外
    if (EXTRA_NOISE_BLOCKLIST.has(word.toLowerCase())) continue

    // kuromoji が「名詞/一般」と分類するが話題を表さない日本語語を除外
    if (JAPANESE_GENERIC_NOUNS.has(word)) continue

    const existing = candidates.get(word)
    if (existing) {
      existing.frequency++
    } else {
      candidates.set(word, { firstIndex: i, frequency: 1 })
    }
  }

  const totalTokens = tokens.length

  // YAKE インスパイアのスコアで降順ソートし、上位 MAX_TAGS_PER_TWEET 件を返す
  return [...candidates.entries()]
    .map(([word, { firstIndex, frequency }]) => ({
      word,
      score: scoreWord(word, firstIndex, totalTokens, frequency),
    }))
    .toSorted((a, b) => b.score - a.score)
    .slice(0, MAX_TAGS_PER_TWEET)
    .map(({ word }) => word)
}
