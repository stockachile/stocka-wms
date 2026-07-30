// URL y Anon Key proporcionadas por el usuario
const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MzExODUsImV4cCI6MjA5NTQwNzE4NX0.cnuyxOpbqr-182Q3MJFJu0prtFSvwk1RgbiVBhjYUak';

// Inicializar cliente Supabase usando UMD script cargado en el HTML
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

window.fetchAllSupabaseRows = async function(tableName, selectStr, filterCallback) {
  let allData = [];
  let from = 0;
  const step = 1000;
  while (true) {
    let q = supabase.from(tableName).select(selectStr);
    if (filterCallback) q = filterCallback(q);
    const { data, error } = await q.range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < step) break;
    from += step;
  }
  return allData;
};

export default supabase;
