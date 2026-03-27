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
 * URL 断片・ファイル拡張子由来の断片・英語副詞・単位略称などを除外する。
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
  // stopword ライブラリ未収録の英語汎用語・副詞
  'everything', // 汎用代名詞
  'entirely', // 副詞（kuromoji が名詞扱いする）
  'ok', // 汎用感嘆詞
  'new', // 形容詞（"new feature" 等の断片）
  // 単位・不明瞭な略称
  'gb', // 容量単位（gigabyte）
  'ma', // 不明瞭な 2 文字略称
  // Wi-Fi 規格の分割断片（"Wi-Fi"→"Wi"/"Fi"、"802.11ac"→"ac"/"ax"）
  'wi',
  'fi',
  'ac',
  'ax',
  // ドメイン拡張子・シェルスクリプト拡張子・その他 2 文字断片
  'io',
  'sh',
  'jp',
  // "we've" 等の縮約形の分割断片
  've',
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
 * 3. **カタカナ断片**: kuromoji が複合語を分割して生成する意味のない断片
 *    （例: ワークフロー → ワーク + フロー）
 *
 * ─────────────────────────────────────────────────────────────────────
 * 不要な登録パターン（追加禁止）:
 * - 形容動詞語幹（簡単・便利 等）→ NOUN_DETAIL_ALLOWLIST から除外済み
 * - 感動詞（いや 等）→ pos = '感動詞' でフィルタ済み
 * - 代名詞（誰か 等）→ 文脈によっては pos_detail_1='一般' に分類されるため JAPANESE_GENERIC_NOUNS で対処
 * - サ変接続語で「〜する」型の行為語（確認・利用 等）→ isUsedAsVerbalNoun() で対処
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
  // isUsedAsVerbalNoun() は「直後に する/できる/させる」のみ検出する。
  // 以下の語は「助詞 + 動詞」または「名詞として完結」する非トピック用法が主体。
  '是非', // 副詞的用法（"是非試して"）→ "是非する" とは言わない
  '意味', // "意味がない/わかる" 型 → "意味する" より格助詞後続が多い
  '参考', // "参考に（する）" 型 → に を介するためコンテキスト検出不可
  '関係', // "〜との関係" 型 → "依存関係" 断片も含む
  '反応', // "反応が来た" 型 → 助詞を介するためコンテキスト検出不可
  // --- 3. カタカナ断片（複合語分割ノイズ）---
  'ワーク', // 「ワークフロー」の断片
  'ライン', // 「タイムライン」の断片
  // --- 4. 修辞的・非トピック語 ---
  '人類', // "全人類やりましょう" 型の修辞的用法
  '人間', // 修辞的・哲学的汎用語
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
 * サ変接続名詞が動詞的用法（〜する・〜できる・〜させる）で使われているかを判定する。
 *
 * トークン列の index の直後（空白スキップ）に「する」系動詞が来る場合に true を返す。
 * これにより "確認する", "利用できる", "追加しました" 等の行為語を除外できる。
 *
 * 以下のパターンは検出対象外（false を返す）:
 * - "管理ツール" → 直後が名詞 → 複合名詞として保持
 * - "確認が取れた" → 直後が助詞 → 名詞用法として保持
 * - "参考にする" → 直後が助詞 → isUsedAsVerbalNoun は false （JAPANESE_GENERIC_NOUNS で対処）
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
  // 直後が「する」「できる」「させる」のいずれかの動詞形
  return (
    next.pos === '動詞' &&
    (next.basic_form === 'する' ||
      next.basic_form === 'できる' ||
      next.basic_form === 'させる')
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

    // サ変接続名詞が「〜する/できる/させる」型の動詞的用法で使われている場合は除外
    // （"確認する", "利用できる", "追加しました" 等の行為語を除去する）
    if (token.pos_detail_1 === 'サ変接続' && isUsedAsVerbalNoun(tokens, i))
      continue

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
