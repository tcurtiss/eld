// Lint only (no formatting rules): the sources are deliberately dense.
'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  // core.js and ui.js are inlined into one classic <script> in the page, so ui.js
  // sees core.js's top-level functions as globals. core.js also runs under Node.
  {
    files: ['src/core.js', 'src/relationships.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, module: 'readonly' } },
  },
  {
    files: ['src/ui.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, d3: 'readonly', generateSample: 'readonly', analyze: 'readonly', isColumnar: 'readonly',
        RelationshipModel: 'readonly', explorerModel: 'readonly', exNodeTip: 'readonly', exEndpoint: 'readonly', exAttribution: 'readonly', exFocus: 'readonly',
        renderExplorer: 'readonly', openRelationshipExplorer: 'readonly' },
    },
  },
  {
    files: ['src/explorer.js'],
    languageOptions: {sourceType: 'script', globals: {...globals.browser, d3: 'readonly', RelationshipModel: 'readonly',
      A: 'readonly', C: 'readonly', state: 'readonly', $: 'readonly', esc: 'readonly', fmtB: 'readonly', pctS: 'readonly', num: 'readonly',
      KIND_NAME: 'readonly', PALETTE: 'readonly', domColor: 'readonly', cssVar: 'readonly', tipShow: 'readonly', tipHide: 'readonly',
      renderInspector: 'readonly', renderDSM: 'readonly', renderPairFocus: 'readonly', renderCollocation: 'readonly', renderAll: 'readonly',
      activateWorkspace: 'readonly', scrollToElement: 'readonly', go: 'readonly', reduceMotion: 'readonly'}},
  },
  {
    files: ['tools/**/*.js', 'eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  { ignores: ['dist/', 'node_modules/', 'samples/'] },
];
