const fs = require('fs');
const readline = require('readline');
const path = require('path');

const logFile = 'C:\\Users\\felip\\.gemini\\antigravity\\brain\\865c3f4b-1365-40e4-bcd4-478f36cc7430\\.system_generated\\logs\\transcript.jsonl';

async function main() {
  const fileStream = fs.createReadStream(logFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.includes('supabase_schema_unification_phase19.sql')) {
      console.log('MATCH:', line.substring(0, 300));
    }
  }
}

main().catch(console.error);
