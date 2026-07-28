const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\felip\\.gemini\\antigravity\\brain\\865c3f4b-1365-40e4-bcd4-478f36cc7430';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== '.git' && file !== 'node_modules') {
        results = results.concat(walk(fullPath));
      }
    } else {
      results.push(fullPath);
    }
  });
  return results;
}

try {
  const files = walk(brainDir);
  console.log(`Searching through ${files.length} files...`);
  files.forEach(file => {
    if (file.endsWith('.js') || file.endsWith('.sql') || file.endsWith('.jsonl') || file.endsWith('.json')) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('postgresql://') || content.includes('password') || content.includes('V97VoP8utl6o71T9')) {
        console.log(`Match in file: ${file}`);
        // print matching lines
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (line.includes('postgresql://') || line.includes('password') || line.includes('V97VoP8utl6o71T9')) {
            console.log(`  L${idx+1}: ${line.trim().substring(0, 150)}`);
          }
        });
      }
    }
  });
} catch (e) {
  console.error(e);
}
