'use strict';
// tools/check-scripts.js — compile every inline <script> of the app with Babel
// (JSX), the way the browser does at load time. Fails on any syntax error.
//   npm i --no-save @babel/standalone@7 && node tools/check-scripts.js
const fs = require('fs'), path = require('path');
const Babel = require('@babel/standalone');
const file = process.argv[2] || path.join(__dirname, '..', 'ShiftScheduler_latest loop.html');
const html = fs.readFileSync(file, 'utf8'), re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m, count = 0, failed = 0;
while ((m = re.exec(html))) {
  if (/\bsrc=/.test(m[1]) || !m[2].trim()) continue;
  count++;
  try { Babel.transform(m[2], { presets: [['react', { pragma: 'h' }]], sourceType: 'script', compact: true }); }
  catch (e) { failed++; console.error(`script ${count}${m[1]}: ${e.message.split('\n')[0]}`); }
}
console.log(`${count} inline scripts, ${failed} failed`);
process.exitCode = failed || !count ? 1 : 0;
