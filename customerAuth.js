// Customer auth. Unlike staff accounts, signup IS public here — anyone can
// create a customer account — but it enforces the same rules the front-end
// dashboard already promised: one phone number = one account, duplicates
// blocked, password hashed (really, this time), terms acceptance required.

const express = require("express");
const pool = require("../db");
const { hashPassword, verifyPassword, signToken, requireAuth } = require("../auth");
const { uid, logActivity } = require("../utils");

const router = express.Router();

function normalizePhone(phone) {
  return (phone || "").replace(/[\s-]/g, "");
}

// POST /api/customers/signup
router.post("/signup", async (req, res) => {
  const {
    name, phone, email, password, address, city, area,
    country, province, district, referralCode, termsAccepted, mobileVerified,
  } = req.body || {};

  if (!name || !name.trim()) return res.status(400).json({ error: "Full name is required." });
  if (!phone || !phone.trim()) return res.status(400).json({ error: "Mobile number is required." });
  if (!password || password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters." });
  if (!address || !address.trim()) return res.status(400).json({ error: "Address is required." });
  if (!city) return res.status(400).json({ error: "City is required." });
  if (!area) return res.status(400).json({ error: "Area is required." });
  if (!termsAccepted) return res.status(400).json({ error: "You must accept the Terms & Conditions." });

  const normalizedPhone = normalizePhone(phone);

  // One mobile number = one account, duplicates blocked. This check and the
  // UNIQUE constraint on customers.phone both enforce this — the UNIQUE
  // constraint is the real guarantee (handles any race condition between
  // two simultaneous signups); this check just gives a friendlier error
  // message in the common case.
  const existingResult = await pool.query(`SELECT * FROM customers WHERE phone = $1`, [normalizedPhone]);
  const existing = existingResult.rows[0];
  if (existing && existing.passwordHash) {
    await logActivity(name, "Customer", "Failed sign-up attempt (phone already registered)");
    return res.status(409).json({ error: "An account already exists for this mobile number. One mobile number can only have one account." });
  }

  const passwordHash = await hashPassword(password);

  if (existing) {
    // Staff created this customer manually before they ever signed up —
    // link this signup to that existing record instead of creating a
    // duplicate, same behavior as the front-end prototype.
    await pool.query(
      `UPDATE customers SET
        name = $1, email = COALESCE($2, email), "passwordHash" = $3, "mobileVerified" = $4,
        address = COALESCE($5, address), city = COALESCE($6, city), area = COALESCE($7, area),
        country = COALESCE($8, country), province = COALESCE($9, province), district = COALESCE($10, district),
        "referralCode" = COALESCE("referralCode", $11), "termsAccepted" = TRUE
      WHERE id = $12`,
      [name, email || null, passwordHash, !!mobileVerified, address || null, city || null, area || null,
       country || null, province || null, district || null, referralCode || null, existing.id]
    );
    const updatedResult = await pool.query(`SELECT * FROM customers WHERE id = $1`, [existing.id]);
    await logActivity(name, "Customer", "Signed up (linked to existing record)");
    const token = signToken({ type: "customer", id: existing.id, name });
    return res.status(200).json({
      token,
      customer: sanitizeCustomer(updatedResult.rows[0]),
      message: "We found your existing record and linked it to this login.",
    });
  }

  const id = uid("cus");
  await pool.query(
    `INSERT INTO customers
      (id, name, phone, email, "passwordHash", "mobileVerified", address, city, area, country, province, district, "referralCode", "termsAccepted")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE)`,
    [id, name, normalizedPhone, email || null, passwordHash, !!mobileVerified,
     address, city, area, country || "Pakistan", province || null, district || null, referralCode || null]
  );

  const createdResult = await pool.query(`SELECT * FROM customers WHERE id = $1`, [id]);
  await logActivity(name, "Customer", "Signed up (new account)");
  const token = signToken({ type: "customer", id, name });
  res.status(201).json({ token, customer: sanitizeCustomer(createdResult.rows[0]), message: "Account created — you're signed in." });
});

// POST /api/customers/login
router.post("/login", async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) return res.status(400).json({ error: "Phone/email and password are required." });

  const normalizedPhoneInput = normalizePhone(identifier);
  const normalizedEmailInput = identifier.toLowerCase();

  const result = await pool.query(
    `SELECT * FROM customers WHERE (phone = $1 OR LOWER(email) = $2) AND "passwordHash" IS NOT NULL`,
    [normalizedPhoneInput, normalizedEmailInput]
  );
  const customer = result.rows[0];

  if (!customer) {
    await logActivity(identifier, "Customer", "Failed sign-in attempt");
    return res.status(401).json({ error: "We couldn't find an account with that phone/email and password." });
  }
  if (customer.status === "Blocked") {
    return res.status(403).json({ error: "This account has been blocked. Contact us for help." });
  }

  const ok = await verifyPassword(password, customer.passwordHash);
  if (!ok) {
    await logActivity(identifier, "Customer", "Failed sign-in attempt");
    return res.status(401).json({ error: "We couldn't find an account with that phone/email and password." });
  }

  await logActivity(customer.name, "Customer", "Signed in");
  const token = signToken({ type: "customer", id: customer.id, name: customer.name });
  res.json({ token, customer: sanitizeCustomer(customer) });
});

router.post("/logout", requireAuth, async (req, res) => {
  if (req.user.type === "customer") await logActivity(req.user.name, "Customer", "Signed out");
  res.json({ ok: true });
});

// GET /api/customers/me — the logged-in customer's own profile, package, and orders
router.get("/me", requireAuth, async (req, res) => {
  if (req.user.type !== "customer") return res.status(403).json({ error: "Customer access only." });

  const customerResult = await pool.query(`SELECT * FROM customers WHERE id = $1`, [req.user.id]);
  const customer = customerResult.rows[0];
  if (!customer) return res.status(404).json({ error: "Account no longer exists." });

  const packageResult = await pool.query(
    `SELECT cp.*, p.name as "packageName", p.price, p."durationDays", p."milkQtyLitres"
     FROM customer_packages cp
     JOIN packages p ON p.id = cp."packageId"
     WHERE cp."customerId" = $1
     ORDER BY cp."assignmentDate" DESC
     LIMIT 1`,
    [customer.id]
  );

  const ordersResult = await pool.query(
    `SELECT o.*, p.name as "packageName"
     FROM orders o
     LEFT JOIN packages p ON p.id = o."packageId"
     WHERE o."customerId" = $1
     ORDER BY o."orderDate" DESC
     LIMIT 100`,
    [customer.id]
  );

  res.json({ customer: sanitizeCustomer(customer), currentPackage: packageResult.rows[0] || null, orders: ordersResult.rows });
});

// Never send passwordHash back to any client, ever.
function sanitizeCustomer(row) {
  const { passwordHash, ...rest } = row;
  return rest;
}

module.exports = router;
