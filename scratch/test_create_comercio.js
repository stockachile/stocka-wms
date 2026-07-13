const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith('#')) return;
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key.trim()] = value;
    }
  });
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function testCreate() {
  console.log('Testing INSERT into v_comercios_config with generated UUID...');
  const testId = crypto.randomUUID();
  const testName = 'STOCKA_TEST_CREATION_' + Date.now();
  const testSigla = 'TC1';
  
  const { data, error } = await supabase
    .from('v_comercios_config')
    .insert([
      { id: testId, nombre: testName, sigla: testSigla }
    ])
    .select();
  
  if (error) {
    console.error('Error inserting into view:', error);
  } else {
    console.log('Insert result:', data);
    
    // Clean up
    if (data && data[0]) {
      console.log('Cleaning up test commerce...');
      const { error: delError } = await supabase
        .from('v_comercios_config')
        .delete()
        .eq('id', data[0].id);
      
      if (delError) {
        console.error('Error deleting test commerce:', delError);
      } else {
        console.log('Test commerce deleted successfully.');
      }
    }
  }
}

testCreate();
