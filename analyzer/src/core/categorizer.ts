/**
 * カテゴリとタグのマッチング結果
 */
export interface CategoryMatch {
  /** カテゴリ ID */
  id: number
  /** 信頼度スコア（0.0〜1.0） */
  confidence: number
}

/**
 * カテゴリキーワードと抽出タグを照合し、マッチしたカテゴリを返す。
 * confidence = マッチしたキーワード数 / 総キーワード数（最小 0.1）。
 *
 * @param tags - 抽出されたタグ一覧
 * @param categories - カテゴリ定義一覧（id と keywords を持つ）
 * @returns マッチしたカテゴリの配列（confidence 降順）
 */
export function matchCategories(
  tags: string[],
  categories: { id: number; keywords: string[] }[]
): CategoryMatch[] {
  if (tags.length === 0 || categories.length === 0) return []

  const tagSet = new Set(tags.map((t) => t.toLowerCase()))
  const matches: CategoryMatch[] = []

  for (const category of categories) {
    if (category.keywords.length === 0) continue

    const matchedCount = category.keywords.filter((kw) =>
      tagSet.has(kw.toLowerCase())
    ).length

    if (matchedCount === 0) continue

    const confidence = Math.min(
      1,
      Math.max(0.1, matchedCount / category.keywords.length)
    )
    matches.push({ id: category.id, confidence })
  }

  return matches.toSorted((a, b) => b.confidence - a.confidence)
}
