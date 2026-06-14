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
    // Vite 設定ファイルは Node.js 環境で実行されるため、tsconfig.node.json を使用する
    files: ['vite.config.ts'],
    languageOptions: {
      parserOptions: {
        project: ['tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
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
      // unicorn/filename-case のルールは ESLint flat config の「最後に定義したルールが勝つ」仕様により、
      // @book000/eslint-config の **/*.vue ブロック（pascalCase + checkDirectories: false）が
      // プロジェクト側でオーバーライドされると上書きされてしまう。
      // @book000/eslint-config が .vue 向け pascalCase ブロックを提供した後も、
      // プロジェクト側に vue-eslint-parser 設定ブロックが存在する限りこの override は必要。
      'unicorn/filename-case': [
        'error',
        { case: 'pascalCase', checkDirectories: false },
      ],
      // null は Vue テンプレートおよびリアクティブ state で「未選択」を表す慣用的な値として使用する
      // unicorn は null より undefined を好むが、Vue の v-model や Optional Chaining と
      // の相性を考慮して .vue ファイルに限り無効化する
      'unicorn/no-null': 'off',
      // .ts/.tsx 同様に省略形を許可する（unicorn flat/recommended が .vue にも適用されるため明示的に無効化）
      'unicorn/prevent-abbreviations': 'off',
      // vue-eslint-parser が生成する仮想ファイルには型情報が不完全なため、
      // TypeScript の unsafe 系ルールを .vue ファイルに限り無効化する
      // @see https://github.com/vuejs/vue-eslint-parser/issues/104
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
