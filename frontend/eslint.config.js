import reactHooks from 'eslint-plugin-react-hooks'

// Flat ESLint config. Its single job is to enforce the React Rules of Hooks as a
// BUILD-FAILING error. A conditional hook, or a hook placed after an early
// `return`, are the ONLY causes of React error #310 ("Rendered more hooks than
// during the previous render") — this gate makes that class of bug impossible to
// ship again. We intentionally do NOT pull in js.configs.recommended so the gate
// stays focused on hooks and never fails the build on pre-existing stylistic noise.
export default [
  { ignores: ['dist/**', 'node_modules/**', '**/*.config.js'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // ── The guardrail that prevents #310 from ever recurring ──
      'react-hooks/rules-of-hooks': 'error',
      // Dependency hygiene is reported as a warning only (does not fail build).
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
