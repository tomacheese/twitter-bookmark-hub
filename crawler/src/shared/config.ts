import fs from 'node:fs'
import path from 'node:path'
import type { AppConfig } from './types.js'

/** データディレクトリのパス (環境変数 DATA_DIR またはデフォルト /data) */
export const DATA_DIR = process.env.DATA_DIR ?? '/data'

/**
 * 設定ファイルを読み込んで AppConfig を返す。
 * ファイルパスは `${DATA_DIR}/config.json`。
 * @returns アプリケーション設定
 * @throws 設定ファイルが見つからない、または不正な場合
 */
export function loadConfig(): AppConfig {
  const configPath = path.join(DATA_DIR, 'config.json')
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`)
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8')) as AppConfig
}
