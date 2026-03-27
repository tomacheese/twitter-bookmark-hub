import * as kuromoji from "@patdx/kuromoji";
import NodeDictionaryLoader from "@patdx/kuromoji/node";

/**
 * 抽出対象とする名詞の品詞詳細一覧。
 * 「非自立」（こと・もの等）と「数」は除外する。
 */
const NOUN_DETAIL_ALLOWLIST = new Set([
  "一般",
  "固有名詞",
  "サ変接続",
  "形容動詞語幹",
  "ナイ形容詞語幹",
]);

/**
 * kuromoji IPAdic 形態素の最低限の型定義。
 * @patdx/kuromoji には型宣言ファイルがないため独自に定義する。
 */
interface KuromojiToken {
  /** 表層形（テキスト上に出現する文字列） */
  surface_form: string;
  /** 品詞（「名詞」「動詞」等） */
  pos: string;
  /** 品詞細分類 1 */
  pos_detail_1: string;
  /** 基本形（辞書形）。取得できない場合は "*" */
  basic_form: string;
}

/**
 * kuromoji トークナイザーの最低限のインターフェース。
 * @patdx/kuromoji には型宣言ファイルがないため独自に定義する。
 */
export interface KuromojiTokenizer {
  /** テキストを形態素に分割する */
  tokenize(text: string): KuromojiToken[];
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
        dic_path: "node_modules/@patdx/kuromoji/dict/",
      }),
    }).build() as Promise<unknown>
  ).then((t) => t as KuromojiTokenizer);
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
  text: string,
): string[] {
  const tokens = tokenizer.tokenize(text);
  const seen = new Set<string>();
  const nouns: string[] = [];

  for (const token of tokens) {
    if (token.pos !== "名詞") continue;
    if (!NOUN_DETAIL_ALLOWLIST.has(token.pos_detail_1)) continue;

    // 基本形を優先して使用（辞書形がなければ表層形）
    const word =
      token.basic_form && token.basic_form !== "*"
        ? token.basic_form
        : token.surface_form;

    // 1 文字の単語は除外（ノイズが多い）
    if (word.length <= 1) continue;

    if (!seen.has(word)) {
      seen.add(word);
      nouns.push(word);
    }
  }

  return nouns;
}
