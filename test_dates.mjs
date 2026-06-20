import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://tvuunrzzxozlksvjodwk.supabase.co'; // Using placeholder, need to extract actual from supabase.js
import fs from 'fs';

let content = fs.readFileSync('js/supabase.js', 'utf8');
let matchUrl = content.match(/const supabaseUrl = '([^']+)'/);
let matchKey = content.match(/const supabaseKey = '([^']+)'/);

if(matchUrl && matchKey) {
  const supabase = createClient(matchUrl[1], matchKey[1]);
  supabase.from('dashboard_events').select('*').limit(5).then(({data, error}) => {
    console.log(JSON.stringify(data, null, 2));
  });
}
