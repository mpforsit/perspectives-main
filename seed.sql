-- =============================================================================
-- Perspectives — sample seed database
--
-- Purpose: a realistic Postgres schema for developing and testing Perspectives.
-- It deliberately exercises every relationship shape the product must handle:
--
--   n:1            customers -> companies         (FK customers.company_id)
--   1:n            customers -> orders            (FK orders.customer_id)
--   n:1 chain      order_items -> orders -> customers
--   m:n            customers <-> tags             (junction customer_tags)
--   self-ref       employees -> employees         (FK employees.manager_id)
--   compound FK    inventory -> warehouses        (FK on (tenant_id, warehouse_code))
--   a VIEW         active_customers               (to test table-vs-view introspection)
--   comments       on a table and a column        (to test comment introspection)
--   indexes        on common FK / sort columns    (to test index introspection)
--
-- The relation ids referenced in the plan's Appendix B map to relations the
-- introspector will discover here once Phase 2 builds relation detection.
--
-- Usage:
--   psql -v ON_ERROR_STOP=1 -f seed.sql
--
-- Volume: by default this creates a few thousand rows — enough that keyset
-- pagination and grid virtualization are exercised. To stress-test, raise the
-- two :scale variables near the bottom (e.g. to 50000 customers / 200000 orders).
-- =============================================================================

BEGIN;

-- Clean slate so the script is idempotent for local dev.
DROP VIEW  IF EXISTS active_customers CASCADE;
DROP TABLE IF EXISTS inventory      CASCADE;
DROP TABLE IF EXISTS warehouses     CASCADE;
DROP TABLE IF EXISTS customer_tags  CASCADE;
DROP TABLE IF EXISTS tags           CASCADE;
DROP TABLE IF EXISTS order_items    CASCADE;
DROP TABLE IF EXISTS orders         CASCADE;
DROP TABLE IF EXISTS products       CASCADE;
DROP TABLE IF EXISTS customers      CASCADE;
DROP TABLE IF EXISTS employees      CASCADE;
DROP TABLE IF EXISTS companies      CASCADE;

-- -----------------------------------------------------------------------------
-- companies
-- -----------------------------------------------------------------------------
CREATE TABLE companies (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text NOT NULL,
  industry      text,
  country_code  char(2),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- employees (self-referential: manager_id -> employees.id)
-- -----------------------------------------------------------------------------
CREATE TABLE employees (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name   text NOT NULL,
  email       text NOT NULL UNIQUE,
  manager_id  bigint REFERENCES employees(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- customers (n:1 companies; n:1 employees via assignee_id)
-- -----------------------------------------------------------------------------
CREATE TABLE customers (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name      text NOT NULL,
  email          text NOT NULL UNIQUE,
  country_code   char(2),
  company_id     bigint REFERENCES companies(id),
  assignee_id    bigint REFERENCES employees(id),
  tier           text CHECK (tier IN ('bronze','silver','gold','platinum')),
  lifetime_value numeric(12,2) NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  notes          text,
  last_login_at  timestamptz,
  last_order_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  customers IS 'End customers who place orders';
COMMENT ON COLUMN customers.lifetime_value IS 'Sum of all delivered order totals';

-- -----------------------------------------------------------------------------
-- products
-- -----------------------------------------------------------------------------
CREATE TABLE products (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  category    text,
  unit_price  numeric(10,2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- orders (1:n from customers)
-- -----------------------------------------------------------------------------
CREATE TABLE orders (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id),
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','paid','shipped','delivered','cancelled')),
  placed_at   timestamptz NOT NULL DEFAULT now(),
  total       numeric(12,2) NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------------------------
-- order_items (n:1 orders, n:1 products)
-- -----------------------------------------------------------------------------
CREATE TABLE order_items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders(id),
  product_id  bigint NOT NULL REFERENCES products(id),
  quantity    integer NOT NULL DEFAULT 1,
  unit_price  numeric(10,2) NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------------------------
-- tags + customer_tags (m:n junction)
-- -----------------------------------------------------------------------------
CREATE TABLE tags (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL UNIQUE
);

CREATE TABLE customer_tags (
  customer_id bigint NOT NULL REFERENCES customers(id),
  tag_id      bigint NOT NULL REFERENCES tags(id),
  PRIMARY KEY (customer_id, tag_id)
);

-- -----------------------------------------------------------------------------
-- warehouses + inventory (compound foreign key)
-- inventory references warehouses on (tenant_id, warehouse_code)
-- -----------------------------------------------------------------------------
CREATE TABLE warehouses (
  tenant_id  bigint NOT NULL,
  code       text   NOT NULL,
  name       text   NOT NULL,
  PRIMARY KEY (tenant_id, code)
);

CREATE TABLE inventory (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       bigint  NOT NULL,
  warehouse_code  text    NOT NULL,
  product_id      bigint  NOT NULL REFERENCES products(id),
  quantity        integer NOT NULL DEFAULT 0,
  CONSTRAINT inventory_warehouse_fk
    FOREIGN KEY (tenant_id, warehouse_code)
    REFERENCES warehouses(tenant_id, code)
);

-- -----------------------------------------------------------------------------
-- Indexes (to exercise index introspection)
-- -----------------------------------------------------------------------------
CREATE INDEX idx_orders_customer_id   ON orders(customer_id);
CREATE INDEX idx_orders_placed_at     ON orders(placed_at);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_customers_company_id ON customers(company_id);

-- -----------------------------------------------------------------------------
-- A view (to exercise table-vs-view introspection)
-- -----------------------------------------------------------------------------
CREATE VIEW active_customers AS
  SELECT id, full_name, email, country_code, company_id, tier, lifetime_value
  FROM customers
  WHERE is_active;

-- =============================================================================
-- Reference data
-- =============================================================================
INSERT INTO companies (name, industry, country_code) VALUES
  ('Helios Manufacturing', 'Industrial', 'DE'),
  ('Northwind Trading',    'Retail',     'NL'),
  ('Lumière Studios',      'Media',      'FR'),
  ('Tessera Software',     'Technology', 'DE'),
  ('Adriatic Foods',       'Food',       'IT');

-- Employees with a small management hierarchy.
INSERT INTO employees (full_name, email, manager_id) VALUES
  ('Mara Voss',     'mara.voss@example.com',     NULL);
INSERT INTO employees (full_name, email, manager_id) VALUES
  ('Tomas Reuter',  'tomas.reuter@example.com',  1),
  ('Ines Adler',    'ines.adler@example.com',    1);
INSERT INTO employees (full_name, email, manager_id) VALUES
  ('Felix Brandt',  'felix.brandt@example.com',  2),
  ('Sara Klein',    'sara.klein@example.com',    2),
  ('Jonas Weber',   'jonas.weber@example.com',   3);

INSERT INTO tags (name) VALUES
  ('vip'), ('newsletter'), ('high-value'), ('at-risk'), ('beta-tester');

INSERT INTO products (name, category, unit_price) VALUES
  ('Solar Panel 400W',     'Energy',      189.00),
  ('Inverter 5kW',         'Energy',      640.00),
  ('Mounting Kit',         'Accessories',  45.50),
  ('Battery Pack 10kWh',   'Energy',     3200.00),
  ('Cable Bundle 25m',     'Accessories',  29.90),
  ('Smart Meter',          'Electronics', 120.00),
  ('Maintenance Plan',     'Services',    240.00);

-- =============================================================================
-- Generated data — scale via the two variables below.
-- =============================================================================
-- Default modest volume. For pagination / virtualization stress testing,
-- bump these (e.g. 50000 and 200000) and re-run.
\set num_customers 3000
\set num_orders    9000

-- Customers
INSERT INTO customers
  (full_name, email, country_code, company_id, assignee_id, tier,
   lifetime_value, is_active, last_login_at, last_order_at, created_at)
SELECT
  'Customer ' || g,
  'customer' || g || '@example.com',
  (ARRAY['DE','FR','NL','IT','ES','PL','AT','BE'])[1 + (g % 8)],
  1 + (g % 5),
  2 + (g % 5),
  (ARRAY['bronze','silver','gold','platinum'])[1 + (g % 4)],
  round((random() * 25000)::numeric, 2),
  (g % 7 <> 0),
  now() - ((g % 120) || ' days')::interval,
  now() - ((g % 90)  || ' days')::interval,
  now() - ((g % 365) || ' days')::interval
FROM generate_series(1, :num_customers) AS g;

-- A handful of customer_tags (m:n)
INSERT INTO customer_tags (customer_id, tag_id)
SELECT c, 1 + (c % 5)
FROM generate_series(1, :num_customers) AS c
WHERE c % 3 = 0
ON CONFLICT DO NOTHING;

-- Orders
INSERT INTO orders (customer_id, status, placed_at, total)
SELECT
  1 + (g % :num_customers),
  (ARRAY['pending','paid','shipped','delivered','cancelled'])[1 + (g % 5)],
  now() - ((g % 200) || ' days')::interval,
  round((random() * 5000)::numeric, 2)
FROM generate_series(1, :num_orders) AS g;

-- Order items (1-3 per order)
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT
  o,
  1 + (o % 7),
  1 + (o % 3),
  round((random() * 600)::numeric, 2)
FROM generate_series(1, :num_orders) AS o;

INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT
  o,
  1 + ((o + 2) % 7),
  1 + (o % 2),
  round((random() * 600)::numeric, 2)
FROM generate_series(1, :num_orders) AS o
WHERE o % 2 = 0;

-- Warehouses + inventory (compound FK)
INSERT INTO warehouses (tenant_id, code, name) VALUES
  (1, 'BER', 'Berlin DC'),
  (1, 'HAM', 'Hamburg DC'),
  (2, 'AMS', 'Amsterdam DC');

INSERT INTO inventory (tenant_id, warehouse_code, product_id, quantity)
SELECT
  1 + (g % 2),
  (ARRAY['BER','HAM','AMS'])[1 + (g % 3)],
  1 + (g % 7),
  (g * 13) % 500
FROM generate_series(1, 21) AS g
-- keep tenant/warehouse combinations valid against the 3 warehouses above
WHERE (1 + (g % 2), (ARRAY['BER','HAM','AMS'])[1 + (g % 3)]) IN
      ((1,'BER'),(1,'HAM'),(2,'AMS'));

COMMIT;

-- Make planner statistics available immediately (helps estimate_count).
ANALYZE;
