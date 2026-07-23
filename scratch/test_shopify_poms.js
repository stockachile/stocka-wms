async function main() {
  const shopUrl = 's3kuyk-0w.myshopify.com';
  const token = process.env.SHOPIFY_ACCESS_TOKEN || 'YOUR_SHOPIFY_ACCESS_TOKEN';

  const url = `https://${shopUrl}/admin/api/2024-04/products.json?limit=10`;
  console.log('Fetching products from:', url);

  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    }
  });

  console.log('Status:', res.status, res.statusText);
  if (res.ok) {
    const data = await res.json();
    console.log('Products count:', data.products?.length);
    if (data.products && data.products.length > 0) {
      console.log('First product sample variants:', JSON.stringify(data.products[0].variants, null, 2));
    }
  } else {
    console.log('Error text:', await res.text());
  }
}

main().catch(console.error);
