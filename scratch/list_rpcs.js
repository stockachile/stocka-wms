const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const adminJs = fs.readFileSync('js/admin.js', 'utf-8');
const rpcs = new Set();
const regex = /\.rpc\s*\(\s*['"]([^'"]+)['"]/g;
let match;
while ((match = regex.exec(adminJs)) !== null) {
  rpcs.add(match[1]);
}
console.log('RPCs found in admin.js:', Array.from(rpcs));
