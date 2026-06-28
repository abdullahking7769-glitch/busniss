// Creates all tables if they don't exist yet — safe to run multiple times.
// Run with: npm run migrate

require("dotenv").config();
const pool = require("./db");

async function migrate() {
  await pool.query(`
    -- Staff / Admin accounts. passwordHash is a real bcrypt hash, never the
    -- plain password — see src/auth.js for how it's created and checked.
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      mobile TEXT,
      email TEXT,
      "passwordHash" TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('Staff', 'Admin', 'Super Admin')),
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended')),
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "lastLoginAt" TIMESTAMPTZ
    );

    -- Customers. passwordHash is NULL until the customer actually signs up
    -- for portal access — a customer record can exist (created by staff)
    -- without ever having a login.
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      email TEXT,
      "passwordHash" TEXT,
      "mobileVerified" BOOLEAN NOT NULL DEFAULT FALSE,
      address TEXT,
      city TEXT,
      area TEXT,
      country TEXT DEFAULT 'Pakistan',
      province TEXT,
      district TEXT,
      "referralCode" TEXT,
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Blocked')),
      "termsAccepted" BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('Daily', 'Weekly', 'Monthly', 'Custom')),
      description TEXT,
      price NUMERIC NOT NULL DEFAULT 0,
      "durationDays" INTEGER NOT NULL DEFAULT 30,
      "milkQtyLitres" NUMERIC NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Draft', 'Inactive')),
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- One row per assignment event — never overwritten, so this table IS the
    -- package history (assigned/changed/renewed/suspended/cancelled).
    CREATE TABLE IF NOT EXISTS customer_packages (
      id TEXT PRIMARY KEY,
      "customerId" TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      "packageId" TEXT NOT NULL REFERENCES packages(id),
      "previousPackageId" TEXT REFERENCES packages(id),
      "assignedBy" TEXT,
      "assignmentDate" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "expiryDate" TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended', 'Cancelled')),
      "renewalOf" TEXT REFERENCES customer_packages(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      "customerId" TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      "packageId" TEXT REFERENCES packages(id),
      "isSubscription" BOOLEAN NOT NULL DEFAULT FALSE,
      "orderDate" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      amount NUMERIC NOT NULL DEFAULT 0,
      "orderStatus" TEXT NOT NULL DEFAULT 'Pending' CHECK ("orderStatus" IN ('Pending', 'Approved', 'Completed', 'Cancelled')),
      "deliveryStatus" TEXT NOT NULL DEFAULT 'Not Dispatched' CHECK ("deliveryStatus" IN ('Not Dispatched', 'In Transit', 'Delivered', 'Returned')),
      "cancelReason" TEXT
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      "orderId" TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      "customerId" TEXT NOT NULL REFERENCES customers(id),
      amount NUMERIC NOT NULL DEFAULT 0,
      method TEXT,
      status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Unpaid', 'Pending Verification', 'Paid')),
      "paidDate" TIMESTAMPTZ,
      "receiptNumber" TEXT,
      "verifiedBy" TEXT
    );

    -- Every sign-in / sign-out / sign-up event, for both staff and customers.
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      "actorType" TEXT NOT NULL CHECK ("actorType" IN ('Staff', 'Customer')),
      action TEXT NOT NULL,
      at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders("customerId");
    CREATE INDEX IF NOT EXISTS idx_payments_order ON payments("orderId");
    CREATE INDEX IF NOT EXISTS idx_cp_customer ON customer_packages("customerId");
    CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_log(at);
  `);

  console.log("Database tables are ready.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
