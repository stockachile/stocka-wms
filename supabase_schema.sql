-- WMS STOCKA - Supabase Schema

-- 1. Profiles Table
-- Se crea un perfil por cada usuario registrado en auth.users
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  role TEXT CHECK (role IN ('admin', 'client')) DEFAULT 'client',
  company_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Políticas para Profiles
CREATE POLICY "Usuarios pueden ver su propio perfil" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- (Opcional) Política para que admins vean todos los perfiles - se omite por ahora para simplicidad MVP


-- 2. Warehouses Table
CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  location TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

-- Políticas: Todos los usuarios autenticados pueden ver las bodegas (lectura)
CREATE POLICY "Autenticados pueden ver bodegas" ON warehouses
  FOR SELECT USING (auth.role() = 'authenticated');


-- 3. Merchants_Warehouses Table (Relación Cliente -> Bodegas asignadas por Admin)
CREATE TABLE merchants_warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(merchant_id, warehouse_id)
);

ALTER TABLE merchants_warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clientes ven sus bodegas asignadas" ON merchants_warehouses
  FOR SELECT USING (auth.uid() = merchant_id);


-- 4. Products Table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(merchant_id, sku) -- SKU único por cliente
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clientes ven sus propios productos" ON products
  FOR SELECT USING (auth.uid() = merchant_id);


-- 5. Inventory Table (Stock actual)
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(product_id, warehouse_id)
);

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

-- Para ver el inventario, el usuario debe ser el dueño del producto
CREATE POLICY "Clientes ven inventario de sus productos" ON inventory
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM products WHERE products.id = inventory.product_id AND products.merchant_id = auth.uid()
    )
  );


-- 6. Movements Table (Historial de Entradas/Salidas)
CREATE TABLE movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('in', 'out')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  date TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  reference_doc TEXT
);

ALTER TABLE movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clientes ven movimientos de sus productos" ON movements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM products WHERE products.id = movements.product_id AND products.merchant_id = auth.uid()
    )
  );


-- ==========================================
-- Trigger para crear un profile automáticamente al registrarse en auth.users
-- ==========================================
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, role, company_name)
  VALUES (new.id, 'client', 'Mi Empresa ' || split_part(new.email, '@', 1));
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ==========================================
-- DATOS DE PRUEBA (MOCK DATA)
-- ¡Importante!: Ejecuta esto solo después de que tu usuario de prueba (auth) ya esté creado.
-- Asegúrate de cambiar 'TU_USER_ID_AQUI' por el ID (UUID) de tu usuario en la tabla auth.users
-- ==========================================
/*
-- 1. Insertar Bodegas de ejemplo
INSERT INTO warehouses (name, location) VALUES ('Bodega Central', 'Santiago, RM'), ('Bodega Norte', 'Antofagasta');

-- 2. Asignar bodegas a tu usuario (reemplaza TU_USER_ID_AQUI)
-- INSERT INTO merchants_warehouses (merchant_id, warehouse_id) 
-- SELECT 'TU_USER_ID_AQUI', id FROM warehouses;

-- 3. Crear productos de prueba para tu usuario
-- INSERT INTO products (merchant_id, sku, name, description) VALUES
-- ('TU_USER_ID_AQUI', 'SKU-001', 'Camiseta Básica Blanca M', 'Ropa de algodón'),
-- ('TU_USER_ID_AQUI', 'SKU-002', 'Zapatillas Running', 'Calzado deportivo');

-- 4. Asignar stock inicial (Inventario)
-- INSERT INTO inventory (product_id, warehouse_id, quantity)
-- VALUES 
-- ((SELECT id FROM products WHERE sku = 'SKU-001'), (SELECT id FROM warehouses WHERE name = 'Bodega Central'), 150),
-- ((SELECT id FROM products WHERE sku = 'SKU-002'), (SELECT id FROM warehouses WHERE name = 'Bodega Norte'), 12);

-- 5. Crear movimientos de prueba
-- INSERT INTO movements (product_id, warehouse_id, type, quantity, reference_doc)
-- VALUES
-- ((SELECT id FROM products WHERE sku = 'SKU-001'), (SELECT id FROM warehouses WHERE name = 'Bodega Central'), 'in', 150, 'OC-123'),
-- ((SELECT id FROM products WHERE sku = 'SKU-002'), (SELECT id FROM warehouses WHERE name = 'Bodega Norte'), 'in', 12, 'OC-124');
*/
