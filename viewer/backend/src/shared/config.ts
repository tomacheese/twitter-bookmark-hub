/** クローラーサービスの URL（環境変数 CRAWLER_URL で上書き可能） */
export const CRAWLER_URL = process.env.CRAWLER_URL ?? 'http://crawler:3001'
