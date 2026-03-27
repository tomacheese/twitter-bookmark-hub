import * as kuromoji from '@patdx/kuromoji'
import NodeDictionaryLoader from '@patdx/kuromoji/node'
import { eng as engStopWords } from 'stopword'

/**
 * 抽出対象とする名詞の品詞詳細一覧。
 * - 「非自立」（こと・もの等）と「数」は除外する。
 * - 「形容動詞語幹」は除外する: 簡単・便利・重要・必要 等の形容詞は話題を表さないため。
 *   （セキュアなどの専門語は「固有名詞」に分類されるため問題ない）
 * - 「代名詞」は除外する: 誰か・あなた等は話題を表さないため。
 */
const NOUN_DETAIL_ALLOWLIST = new Set([
  '一般',
  '固有名詞',
  'サ変接続',
  'ナイ形容詞語幹',
])

/**
 * stopword ライブラリの英語 stop word を Set 化したもの（小文字で比較）。
 * 前置詞・接続詞・冠詞・助動詞など話題を表さない英語語を除外する。
 */
const ENGLISH_STOP_WORDS = new Set(engStopWords)

/**
 * stopword ライブラリでカバーされない追加ノイズトークン（小文字で比較）。
 *
 * 2 文字以下の英字断片（`wi`, `fi`, `ac`, `io` 等）は extractNouns 内の
 * 「2 文字・非全大文字 ASCII フィルタ」で一括除外するため登録不要。
 * `AI`, `PC`, `UI` のような全大文字 2 文字略語はそのフィルタを通過して保持される。
 */
const EXTRA_NOISE_BLOCKLIST = new Set([
  // URL 断片（URL 除去後も稀に残る）
  // ※ https/http/ftp はコーパス上で 0 件のためデッドコード扱いで登録しない
  'www',
  // stopword ライブラリ未収録の英語汎用語・副詞
  'just',
  'everything', // 汎用代名詞
  'entirely', // 副詞（kuromoji が名詞扱いする）
  'new', // 形容詞（"new feature" 等の断片）
])

/**
 * アルゴリズムで除去できない日本語ノイズ語の除外リスト（完全一致）。
 *
 * 以下の 3 種類の語のみ登録する。それ以外は品詞フィルタ・コンテキスト検出・
 * stopword ライブラリで対処すること。
 *
 * 1. **代名詞・スラング**: kuromoji が「名詞/一般」または「名詞/固有名詞」に
 *    誤分類するため品詞フィルタで除去できない語
 *    （例: 自分 → 名詞/一般、ガチ → 名詞/固有名詞）
 *
 * 2. **サ変接続語のうちコンテキスト検出が効かないもの**: isUsedAsVerbalNoun() は
 *    「直後に する/できる/させる」パターンしか検出できない。助詞を介した
 *    「〜に参考する」「〜との関係」型は false negative になる語
 *
 * 3. **意味不明スラング・記号**: 特定の SNS 文化依存語で上記以外に分類できないもの
 *
 * ─────────────────────────────────────────────────────────────────────
 * 不要な登録パターン（追加禁止）:
 * - 形容動詞語幹（簡単・便利 等）→ NOUN_DETAIL_ALLOWLIST から除外済み
 * - 感動詞（いや 等）→ pos = '感動詞' でフィルタ済み
 * - 代名詞（誰か 等）→ 文脈によっては pos_detail_1='一般' に分類されるため JAPANESE_GENERIC_NOUNS で対処
 * - サ変接続語で「〜する/なる」型の行為語（確認・利用・参考 等）→ isUsedAsVerbalNoun() で対処
 * - `〜的に` 副詞形（個人・基本・定期 等）→ isUsedAsAdverbialTeki() で対処
 * - 形式名詞（おかげ・とこ 等）→ isUsedAsFormalNoun() で対処
 * - カタカナ断片（ワーク・フロー等）→ mergeConsecutiveKatakanaTokens() で再結合済み
 * - 2 文字・非全大文字 ASCII（wi・fi・ac・io 等）→ extractNouns() の長さフィルタで対処
 * ─────────────────────────────────────────────────────────────────────
 */
const JAPANESE_GENERIC_NOUNS = new Set([
  // --- 1. 代名詞・スラング（品詞分類では除去不可）---
  '自分', // 名詞/一般 → reflexive pronoun（"自分なりに" 型）
  '誰か', // 名詞/一般 → 不定代名詞（文脈によって 代名詞 ではなく 一般 に分類される）
  'ワイ', // 名詞/固有名詞 → 関西弁一人称代名詞
  'アレ', // 名詞/固有名詞 → 指示代名詞（"アレがいい" 型）
  'ガチ', // 名詞/固有名詞 → SNS 強調スラング
  'リプ', // 名詞/固有名詞 → Twitter リプライ略語
  '感じ', // 名詞/一般 → 汎用感情語（"〜な感じ" 型）
  '最高', // 名詞/一般 → 汎用称賛語
  // --- 2a. 接続・指示語（名詞/一般 だが非トピック）---
  'あと', // 接続的用法（"あと、〜も" 型）
  '一つ', // 数詞的指示語
  '最後', // 時間的汎用語
  // --- 2b. 汎用修飾語・抽象語（名詞/一般 だが非トピック）---
  '個人', // "個人的に" 型の副詞的用法
  '全員', // 汎用集合名詞
  '割合', // 比率・非トピック語
  '理由', // 理由・非トピック語（"〜の理由は" 型）
  'まとめ', // 汎用集合語（"〜のまとめ" 型）
  '内容', // 汎用容器語（"内容を確認" 型）
  '基本', // "基本的に" 型の副詞的用法
  '方法', // 汎用手段語（"〜する方法" 型）
  // --- 2c. サ変接続語（コンテキスト検出が効かないパターン）---
  // isUsedAsVerbalNoun() は「直後に する/なる 系動詞」と「〜に + なる/する」を検出する。
  // 以下の語は「助詞 + 動詞」または「名詞として完結」する非トピック用法が主体で
  // かつ検出アルゴリズムが適用できない。
  // ※ `参考` は `〜に + なる/する` パターンで全件検出できるため削除済み。
  '是非', // 副詞的用法（"是非試して"）→ "是非する" とは言わない・格助詞も介さない
  '意味', // "意味がない/わかる" 型 → 格助詞`が`後続が主体（アルゴリズム対象外）
  '関係', // "〜との関係" 型 → "依存関係" 断片も含む・格助詞を介するため対象外
  '反応', // "反応が来た" 型 → 格助詞`が`後続が主体（アルゴリズム対象外）
  // --- 3. 修辞的・非トピック語 ---
  '人類', // "全人類やりましょう" 型の修辞的用法
  '人間', // 修辞的・哲学的汎用語
])

/**
 * 形式名詞として使われる語のセット。
 * これらは単独では意味を持たず、直前の動詞・助動詞・「の」と文法的に結びついて使われる。
 * isUsedAsFormalNoun() と組み合わせてコンテキストベースで除外する。
 */
const FORMAL_NOUNS = new Set([
  'おかげ', // 「〜のおかげで」「〜できたおかげ」型：恩恵の依存関係を表す形式名詞
  'とこ', // 「〜したとこ」「〜してるとこ」型：ところ の口語形（形式名詞的用法）
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

/** `する/できる/させる/なる/なれる` 系動詞の基本形セット */
const VERBAL_BASIC_FORMS = new Set([
  'する',
  'できる',
  'させる',
  'なる',
  'なれる',
])

/**
 * サ変接続名詞が動詞的用法で使われているかを判定する。
 *
 * 以下の 2 パターンを検出する:
 * 1. **直後に する系動詞**: `確認する`・`利用できる`・`追加しました`・`参加させる` 等
 * 2. **`〜に + なる/する/できる`**: `参考になる`・`勉強になる`・`参考にする` 等
 *    直後が `に`(格助詞) で、その直後（記号・助詞をスキップ）が する系動詞の場合
 *
 * 以下のパターンは検出対象外（false を返す）:
 * - "管理ツール" → 直後が名詞 → 複合名詞として保持
 * - "確認が取れた" → 直後が格助詞`が` → 名詞用法として保持
 * - "関係がある" → 直後が格助詞`が` → 名詞用法として保持
 *
 * @param tokens - mergeConsecutiveEnglishTokens 適用後のトークン列
 * @param index - 判定対象トークンのインデックス
 * @returns 動詞的用法なら true
 */
function isUsedAsVerbalNoun(tokens: KuromojiToken[], index: number): boolean {
  let j = index + 1
  // 空白トークンを読み飛ばす
  while (j < tokens.length && isSpaceToken(tokens[j])) j++
  if (j >= tokens.length) return false
  const next = tokens[j]

  // パターン 1: 直後が する/できる/させる/なる 系動詞
  if (next.pos === '動詞' && VERBAL_BASIC_FORMS.has(next.basic_form))
    return true

  // パターン 2: 直後が「に」(格助詞) → その後に する/なる 系動詞（"参考になる" 型）
  if (next.pos === '助詞' && next.surface_form === 'に') {
    let k = j + 1
    // 記号・助詞をスキップ（補助動詞が挟まる場合を考慮）
    while (
      k < tokens.length &&
      (isSpaceToken(tokens[k]) || tokens[k].pos === '助詞')
    )
      k++
    if (
      k < tokens.length &&
      tokens[k].pos === '動詞' &&
      VERBAL_BASIC_FORMS.has(tokens[k].basic_form)
    )
      return true
  }

  return false
}

/**
 * 名詞が副詞的な `〜的に` の形で使われているかを判定する。
 *
 * 直後に `的`(接尾) が来て、その直後に `に`(助詞) が来る場合に true を返す。
 * - 除外例: `個人的に`・`基本的に`・`定期的に`・`効率的に`（副詞用法）
 * - 保持例: `非破壊的編集`（`的` の後が名詞）・`批判的思考`（`に` が後続しない）
 *
 * @param tokens - mergeConsecutiveEnglishTokens 適用後のトークン列
 * @param index - 判定対象トークンのインデックス
 * @returns 副詞的 `〜的に` 用法なら true
 */
function isUsedAsAdverbialTeki(
  tokens: KuromojiToken[],
  index: number
): boolean {
  let j = index + 1
  while (j < tokens.length && isSpaceToken(tokens[j])) j++
  if (j >= tokens.length) return false
  // 直後が「的」
  if (tokens[j].surface_form !== '的') return false
  // 「的」の次が「に」(助詞)
  let k = j + 1
  while (k < tokens.length && isSpaceToken(tokens[k])) k++
  return (
    k < tokens.length &&
    tokens[k].pos === '助詞' &&
    tokens[k].surface_form === 'に'
  )
}

/**
 * 形式名詞として使われているかを判定する。
 *
 * 形式名詞は具体的な意味を持たず、直前の語と文法的に結びついて使われる名詞。
 * 以下のいずれかが直前のトークンの場合に形式名詞と判定する:
 * - 動詞（「したとこ」「できたおかげ」等）
 * - 助動詞（「だったとこ」「なかったおかげ」等）
 * - 助詞「の」（「みんなのおかげ」「いいとこ」等）
 * - トークン先頭（前文脈への指示：「おかげで助かった」等）
 *
 * @param tokens - トークン列
 * @param index - 判定対象トークンのインデックス
 * @returns 形式名詞的用法なら true
 */
function isUsedAsFormalNoun(tokens: KuromojiToken[], index: number): boolean {
  let j = index - 1
  while (j >= 0 && isSpaceToken(tokens[j])) j--
  // 先頭に来た場合も形式名詞扱い（前文脈への指示・依存関係）
  if (j < 0) return true
  const prev = tokens[j]
  return (
    prev.pos === '動詞' ||
    prev.pos === '助動詞' ||
    (prev.pos === '助詞' && prev.surface_form === 'の')
  )
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
 * 連続するカタカナ名詞トークンをスペースなしで結合する。
 * kuromoji の辞書に未登録のカタカナ複合語（ワークフロー・タイムライン・
 * フレームワーク等）が分割されてしまう問題に対処する。
 *
 * 結合条件:
 * - 両トークンの pos が `名詞`
 * - surface_form がカタカナのみ（U+30A0–U+30FF）かつ 2 文字以上
 * - 間に空白トークンが存在しない（元テキストにスペースがない）
 *
 * 例: `ワーク`[一般] + `フロー`[一般] → `ワークフロー`[一般]
 * 例: `クラ`[固有名詞] + `ウド`[一般] + `サービス`[サ変接続] → `クラウドサービス`[一般]
 *
 * @param tokens - mergeConsecutiveEnglishTokens 適用後のトークン列
 * @returns カタカナ複合語を結合済みのトークン列
 */
/** カタカナのみ（長音符ー含む）かつ 2 文字以上かどうかを判定する */
const isKatakana = (s: string) => /^[\u30A0-\u30FF]{2,}$/.test(s)

function mergeConsecutiveKatakanaTokens(
  tokens: KuromojiToken[]
): KuromojiToken[] {
  const result: KuromojiToken[] = []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t.pos === '名詞' && isKatakana(t.surface_form)) {
      const parts: string[] = [t.surface_form]
      let j = i + 1
      while (j < tokens.length) {
        // 空白トークンが来たら終了（元テキストにスペースがある）
        if (isSpaceToken(tokens[j])) break
        // 次もカタカナ名詞なら結合
        if (tokens[j].pos === '名詞' && isKatakana(tokens[j].surface_form)) {
          parts.push(tokens[j].surface_form)
          j++
        } else {
          break
        }
      }
      if (parts.length > 1) {
        const combined = parts.join('')
        result.push({
          surface_form: combined,
          pos: '名詞',
          pos_detail_1: '一般',
          basic_form: combined,
        })
        i = j
      } else {
        result.push(t)
        i++
      }
    } else {
      result.push(t)
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
  const tokens = mergeConsecutiveKatakanaTokens(
    mergeConsecutiveEnglishTokens(tokenizer.tokenize(cleanedText))
  )

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

    // 2 文字の英字かつ全大文字でないトークンを除外（Wi, Fi, ac, io, ok, md 等の断片）
    // 全大文字 2 文字（AI, PC, UI 等）はトピックとして有効なため保持する
    if (
      word.length === 2 &&
      /^[A-Za-z]{2}$/.test(word) &&
      word !== word.toUpperCase()
    )
      continue

    // サ変接続名詞が動詞的用法（〜する/できる/させる/なる 系）で使われている場合は除外
    // パターン 1: "確認する", "利用できる", "追加しました" 等の行為語
    // パターン 2: "参考になる", "勉強になる" 等の「〜に + なる/する」型
    if (token.pos_detail_1 === 'サ変接続' && isUsedAsVerbalNoun(tokens, i))
      continue

    // 名詞が「〜的に」の形で副詞的に使われている場合は除外
    // （"個人的に", "基本的に", "定期的に", "効率的に" 等）
    if (isUsedAsAdverbialTeki(tokens, i)) continue

    // 形式名詞（おかげ・とこ 等）が文法的用法で使われている場合は除外
    // 直前が動詞・助動詞・助詞「の」のいずれかである場合に除外する
    if (FORMAL_NOUNS.has(word) && isUsedAsFormalNoun(tokens, i)) continue

    // アルゴリズムで除去できない代名詞・スラング・断片等を除外
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
