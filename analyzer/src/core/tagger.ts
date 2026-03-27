import * as kuromoji from '@patdx/kuromoji'
import NodeDictionaryLoader from '@patdx/kuromoji/node'

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
 * URL 由来のノイズトークンを除外するブロックリスト（小文字で比較）。
 * kuromoji が URL を形態素分解した際に名詞として出力する断片を除外する。
 */
const URL_NOISE_BLOCKLIST = new Set(['https', 'http', 'ftp', 'co', 'www'])

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
 * 連続する英字大文字始まりのトークン列を 1 つの複合語トークンに結合する。
 * 例: ["Claude", "Code"] → [{ surface_form: "Claude Code", pos: "名詞", ... }]
 * 例: ["Visual", "Studio", "Code"] → [{ surface_form: "Visual Studio Code", ... }]
 *
 * @param tokens - kuromoji トークン列
 * @returns 複合語を結合済みのトークン列
 */
/**
 * kuromoji が空白を記号トークンとして出力するかどうかを判定する。
 *
 * @param token - kuromoji トークン
 * @returns 空白トークンなら true
 */
function isSpaceToken(token: KuromojiToken): boolean {
  return token.pos === '記号' && token.pos_detail_1 === '空白'
}

function mergeConsecutiveEnglishTokens(
  tokens: KuromojiToken[]
): KuromojiToken[] {
  const result: KuromojiToken[] = []
  let i = 0
  while (i < tokens.length) {
    // 英字大文字始まり 2 文字以上のトークンを連続する限り結合する
    // kuromoji は単語間の空白を「記号/空白」トークンとして出力するため読み飛ばす
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
 * テキストから名詞を抽出してタグ候補として返す。
 * 1 文字の単語は除外し、重複を除去して返す。
 *
 * @param tokenizer - kuromoji トークナイザー
 * @param text - 解析対象テキスト
 * @returns 抽出された名詞の配列（重複なし）
 */
export function extractNouns(
  tokenizer: KuromojiTokenizer,
  text: string
): string[] {
  const tokens = mergeConsecutiveEnglishTokens(tokenizer.tokenize(text))
  const seen = new Set<string>()
  const nouns: string[] = []

  for (const token of tokens) {
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

    // URL 由来のノイズトークンは除外
    if (URL_NOISE_BLOCKLIST.has(word.toLowerCase())) continue

    if (!seen.has(word)) {
      seen.add(word)
      nouns.push(word)
    }
  }

  return nouns
}
