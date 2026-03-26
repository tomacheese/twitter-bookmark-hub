/** ロガーインターフェース */
interface LoggerInstance {
  /** 情報ログを出力する */
  log: (...args: unknown[]) => void
  /** 警告ログを出力する */
  warn: (...args: unknown[]) => void
  /** エラーログを出力する */
  error: (...args: unknown[]) => void
}

/** ロガーユーティリティ */
export const Logger = {
  /**
   * 指定した名前でロガーインスタンスを生成する
   * @param name - ロガー名（ログプレフィックスに使用）
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
