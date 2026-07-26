const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function run() {
  console.log('Logging in as admin...');
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: 'stockachile@gmail.com',
    password: 'Mika17187'
  });

  if (authError) {
    console.error('Login failed:', authError);
    return;
  }
  console.log('Login successful! UID:', authData.user.id);

  console.log('Fetching profile...');
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('*')
    .eq('id', authData.user.id)
    .single();

  console.log('Profile:', profile);
  console.log('Profile Error:', profileError);
}

run();
