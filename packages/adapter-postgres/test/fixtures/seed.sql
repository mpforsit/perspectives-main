-- Seed fixture used by both the testcontainers integration tests and the
-- docker-compose dev stack. Exercises every introspection corner the adapter
-- needs to handle (compound primary keys, compound foreign keys,
-- self-referential foreign keys, views, comments) AND seeds enough volume
-- (3000 customers, 9000 orders) for the runtime tests' keyset pagination,
-- count, and filter assertions.

-- ---------------------------------------------------------------------------
-- Reference / lookup tables
-- ---------------------------------------------------------------------------

CREATE TABLE warehouses (
  tenant_id INTEGER NOT NULL,
  code      TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  PRIMARY KEY (tenant_id, code)
);

CREATE TABLE products (
  id       BIGSERIAL PRIMARY KEY,
  name     TEXT NOT NULL,
  category TEXT,
  price    NUMERIC(10, 2)
);

CREATE TABLE tags (
  id   BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- ---------------------------------------------------------------------------
-- Customers + comments
-- ---------------------------------------------------------------------------

CREATE TABLE customers (
  id              BIGSERIAL PRIMARY KEY,
  full_name       TEXT NOT NULL,
  email           TEXT UNIQUE,
  country_code    TEXT,
  lifetime_value  NUMERIC(12, 2),
  last_login_at   TIMESTAMPTZ,
  last_order_at   TIMESTAMPTZ,
  assignee_id     BIGINT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  tier            TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  customers IS 'End customers of the business.';
COMMENT ON COLUMN customers.lifetime_value IS 'Total revenue from this customer, in USD.';

CREATE INDEX customers_country_code_idx ON customers (country_code);

-- ---------------------------------------------------------------------------
-- Customer ↔ tag (compound primary key, two simple FKs)
-- ---------------------------------------------------------------------------

CREATE TABLE customer_tags (
  customer_id BIGINT NOT NULL REFERENCES customers (id),
  tag_id      BIGINT NOT NULL REFERENCES tags (id),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- Inventory: compound foreign key (tenant_id, warehouse_code) → warehouses
-- ---------------------------------------------------------------------------

CREATE TABLE inventory (
  tenant_id      INTEGER NOT NULL,
  warehouse_code TEXT    NOT NULL,
  product_id     BIGINT  NOT NULL REFERENCES products (id),
  quantity       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, warehouse_code, product_id),
  CONSTRAINT inventory_warehouse_fk
    FOREIGN KEY (tenant_id, warehouse_code)
    REFERENCES warehouses (tenant_id, code)
);

-- ---------------------------------------------------------------------------
-- Self-referential FK: employees.manager_id → employees.id
-- ---------------------------------------------------------------------------

CREATE TABLE employees (
  id         BIGSERIAL PRIMARY KEY,
  full_name  TEXT NOT NULL,
  email      TEXT UNIQUE,
  manager_id BIGINT REFERENCES employees (id)
);

-- ---------------------------------------------------------------------------
-- Orders: regular FK to customers + a covering index. The runtime test
-- paginates this table fully.
-- ---------------------------------------------------------------------------

CREATE TABLE orders (
  id          BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers (id),
  placed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status      TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX orders_customer_id_idx ON orders (customer_id);

-- ---------------------------------------------------------------------------
-- View that filters on a boolean: introspection should classify this as a
-- view, not a table.
-- ---------------------------------------------------------------------------

CREATE VIEW active_customers AS
  SELECT id, full_name, email, country_code
  FROM customers
  WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- Reference data + bulk fixtures.
-- ---------------------------------------------------------------------------

INSERT INTO products (name, category, price) VALUES
  ('Widget',   'hardware',    19.99),
  ('Gadget',   'electronics', 49.50),
  ('Sprocket', 'hardware',     7.25);

INSERT INTO warehouses (tenant_id, code, name) VALUES
  (1, 'A1', 'Main warehouse'),
  (1, 'B2', 'Overflow warehouse');

-- Exactly 3000 customers, 10 countries with even distribution (300 per country).
INSERT INTO customers (full_name, email, country_code, lifetime_value, is_active)
SELECT
  'Customer ' || i,
  'customer' || i || '@example.com',
  (ARRAY['DE','FR','NL','IT','ES','PL','US','UK','BR','JP'])[1 + (i % 10)],
  (i * 12.50)::numeric(12, 2),
  (i % 7 <> 0)
FROM generate_series(1, 3000) AS i;

-- 9000 orders distributed across the 3000 customers. Status cycles over 4
-- values so the pagination test sees a non-unique sort key on `status`.
INSERT INTO orders (customer_id, placed_at, status)
SELECT
  1 + (i % 3000),
  NOW() - (i || ' minutes')::interval,
  (ARRAY['pending','shipped','delivered','cancelled'])[1 + (i % 4)]
FROM generate_series(1, 9000) AS i;

-- estimateCount falls back to pg_class.reltuples for unfiltered plans, which
-- is zero until ANALYZE has run. Refresh statistics so the estimate is in the
-- right order of magnitude immediately.
ANALYZE customers;
ANALYZE orders;
