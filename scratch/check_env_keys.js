const fs = require('fs');

async function run() {
  const content = fs.readFileSync('.env', 'utf8');
  content.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts[0]) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      console.log(`Key: ${key}, Present: ${val ? 'YES' : 'NO'}, Length: ${val.length}`);
    }
  });
}

run();
