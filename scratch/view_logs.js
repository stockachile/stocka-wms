const fs = require('fs');
const path = require('path');

const logPath = path.join('C:', 'Users', 'felip', '.gemini', 'antigravity', 'brain', '237bda54-44c1-455c-a314-b4bc8558866a', '.system_generated', 'logs', 'transcript_full.jsonl');

if (!fs.existsSync(logPath)) {
  console.log('Log file not found at:', logPath);
  return;
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.trim().split('\n');

for (const line of lines) {
  if (!line) continue;
  try {
    const step = JSON.parse(line);
    if (step.tool_calls) {
      for (const tc of step.tool_calls) {
        if (tc.name === 'run_command' && tc.args?.CommandLine?.includes('check_orders_table.js')) {
          console.log(`Step ${step.step_index} Command:`, tc.args.CommandLine);
          // Look for system response of this step
          const responseLineIndex = lines.findIndex(l => {
            try {
              const s = JSON.parse(l);
              return s.step_index === step.step_index && s.source === 'SYSTEM';
            } catch { return false; }
          });
          if (responseLineIndex !== -1) {
            const resp = JSON.parse(lines[responseLineIndex]);
            console.log('Response content:\n', resp.content);
          }
        }
      }
    }
  } catch (err) {
    // ignore
  }
}
