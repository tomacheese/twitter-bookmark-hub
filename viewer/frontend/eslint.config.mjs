import baseConfig from '@book000/eslint-config'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import tsParser from '@typescript-eslint/parser'
import globals from 'globals'

export default [
  // Vue 3 推奨ルールセット（.vue ファイルのルール定義）
  ...pluginVue.configs['flat/recommended'],
  // TypeScript ルールセット（.ts ファイル用）
  ...baseConfig,
  {
    // .vue ファイルに vue-eslint-parser を明示的に適用する
    // baseConfig の global 設定による上書きを防ぐため、最後に定義する
    files: ['**/*.vue'],
    languageOptions: {
      globals: {
        // ブラウザ環境のグローバル変数（MouseEvent, HTMLElement 等）
        ...globals.browser,
      },
      parser: vueParser,
      parserOptions: {
        // <script lang="ts"> 内の TypeScript 解析に使用するパーサー
        parser: tsParser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
        project: ['tsconfig.json'],
        // vue-eslint-parser が生成する仮想ファイルのパスを tsconfig から除外しない
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Vue コンポーネントは PascalCase の命名規則を使用する
      'unicorn/filename-case': ['error', { case: 'pascalCase' }],
      // null は Vue の template 内および reactive state でよく使用するため許可する
      'unicorn/no-null': 'off',
      // props は Vue の慣例的な命名のため省略形の変換を許可する
      'unicorn/prevent-abbreviations': 'off',
      // <script setup> の型チェックルールを緩和する（型情報なしの場合に備える）
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // composables ディレクトリは camelCase の命名規則を使用する（use プレフィックス慣例）
    files: ['**/composables/*.ts'],
    rules: {
      'unicorn/filename-case': ['error', { case: 'camelCase' }],
    },
  },
]
