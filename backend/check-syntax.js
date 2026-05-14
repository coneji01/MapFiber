const fs = require('fs');
const code = fs.readFileSync(__dirname + '/server.js', 'utf8');
try {
  // Check syntax by wrapping in a function
  new Function(code);
  console.log('✅ Syntax OK');
} catch(e) {
  console.error('❌ Syntax Error:', e.message);
  const m = e.stack.match(/:(\d+):(\d+)/);
  if (m) {
    const ln = parseInt(m[1]);
    const lines = code.split('\n');
    for (let i = Math.max(0, ln - 4); i < Math.min(lines.length, ln + 2); i++) {
      console.error(`${i === ln - 1 ? '>>' : '  '} ${i + 1}: ${lines[i]}`);
    }
  }
}
