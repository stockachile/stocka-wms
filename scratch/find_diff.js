const { execSync } = require('child_process');

try {
  const diff = execSync('git diff d789feb~1 d789feb -- js/app.js', { encoding: 'utf8' });
  const lines = diff.split('\n');
  for (let line of lines) {
    if ((line.startsWith('+') || line.startsWith('-')) && (line.includes('td') || line.includes('th') || line.includes('badge') || line.includes('Pack') || line.includes('pack'))) {
      if (line.includes('git diff')) continue;
      console.log(line);
    }
  }
} catch (err) {
  console.error(err);
}
