import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, external_order_number, agenda, shipping_city, created_at')
    .ilike('external_order_number', '%1066%');

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Orders found:', data);
  }
}

main();
