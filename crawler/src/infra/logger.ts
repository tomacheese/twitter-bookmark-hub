/** ロガーインターフェース */
export interface LoggerInstance {
  /** 情報レベルのログを出力する */
  log: (...args: unknown[]) => void
  /** 警告レベルのログを出力する */
  warn: (...args: unknown[]) => void
  /** エラーレベルのログを出力する */
  error: (...args: unknown[]) => void
}

/**
 * シンプルなコンソールロガー。
 * プレフィックス付きでコンソールに出力する。
 */
export const Logger = {
  /**
   * 指定した名前でロガーインスタンスを生成する。
   * @param name ログプレフィックスに使用する名前
   * @returns ロガーインスタンス
   */
  configure(name: string): LoggerInstance {
    const prefix = `[${name}]`
    return {
      log: (...args: unknown[]) => {
        console.log(prefix, ...args)
      },
      warn: (...args: unknown[]) => {
        console.warn(prefix, ...args)
      },
      error: (...args: unknown[]) => {
        console.error(prefix, ...args)
      },
    }
  },
}
