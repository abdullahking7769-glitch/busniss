// Staff/Admin auth. Unlike customer signup, there is NO public endpoint to
// create a staff account — that's intentional, same rule as the front-end
// dashboard: only an already-logged-in Admin/Super Admin can create new
// Staff/Admin/Super Admin accounts. A public "become an admin" endpoint
// would defeat the entire point of having roles.

const express = require("express");
const pool = require("../db");
const { hashPassword, verifyPassword, signToken, requireAuth, requireAdmin } = require("../auth");
const { uid, logActivity } = require("../utils");

const router = express.Router();

// POST /api/staff/login
router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const { rows } = await pool.query(`SELECT * FROM accounts WHERE username = $1`, [username]);
  const account = rows[0];
  if (!account) {
    await logActivity(username, "Staff", `Failed login attempt for "${username}"`);
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  if (account.status === "Suspended") {
    return res.status(403).json({ error: "This account has been suspended." });
  }

  const ok = await verifyPassword(password, account.passwordHash);
  if (!ok) {
    await logActivity(username, "Staff", `Failed login attempt for "${username}"`);
    return res.status(401).json({ error: "Incorrect username or password." });
  }

  await pool.query(`UPDATE accounts SET "lastLoginAt" = NOW() WHERE id = $1`, [account.id]);
  await logActivity(account.username, "Staff", "Logged in");

  const token = signToken({ type: "staff", id: account.id, username: account.username, role: account.role });
  res.json({
    token,
    account: { id: account.id, username: account.username, role: account.role, mobile: account.mobile, email: account.email },
  });
});

// POST /api/staff/logout — JWTs can't be "revoked" server-side without an
// extra blocklist table; for this app's threat model, just logging the
// event and letting the front-end discard its token is enough.
router.post("/logout", requireAuth, async (req, res) => {
  if (req.user.type === "staff") await logActivity(req.user.username, "Staff", "Logged out");
  res.json({ ok: true });
});

// GET /api/staff/me
router.get("/me", requireAuth, async (req, res) => {
  if (req.user.type !== "staff") return res.status(403).json({ error: "Staff access only." });
  const { rows } = await pool.query(
    `SELECT id, username, mobile, email, role, status, "createdAt" FROM accounts WHERE id = $1`,
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Account no longer exists." });
  res.json({ account: rows[0] });
});

// GET /api/staff/accounts — list all staff accounts (Admin/Super Admin only)
router.get("/accounts", requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, username, mobile, email, role, status, "createdAt", "lastLoginAt" FROM accounts ORDER BY "createdAt" DESC`
  );
  res.json({ accounts: rows });
});

// POST /api/staff/accounts — create a new staff account. Admin/Super Admin only.
router.post("/accounts", requireAuth, requireAdmin, async (req, res) => {
  const { username, password, mobile, email, role } = req.body || {};
  if (!username || !password || !role) {
    return res.status(400).json({ error: "Username, password, and role are required." });
  }
  if (!["Staff", "Admin", "Super Admin"].includes(role)) {
    return res.status(400).json({ error: "Role must be Staff, Admin, or Super Admin." });
  }

  const existing = await pool.query(`SELECT id FROM accounts WHERE username = $1`, [username]);
  if (existing.rows[0]) return res.status(409).json({ error: "That username is already taken." });

  const passwordHash = await hashPassword(password);
  const id = uid("acct");
  await pool.query(
    `INSERT INTO accounts (id, username, mobile, email, "passwordHash", role) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, username, mobile || null, email || null, passwordHash, role]
  );

  await logActivity(req.user.username, "Staff", `Created account "${username}" (${role})`);
  res.status(201).json({ account: { id, username, mobile, email, role, status: "Active" } });
});

// DELETE /api/staff/accounts/:id — Admin/Super Admin only, can't delete yourself
router.delete("/accounts/:id", requireAuth, requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't delete the account you're currently logged in as." });
  }
  const { rows } = await pool.query(`SELECT username FROM accounts WHERE id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Account not found." });

  await pool.query(`DELETE FROM accounts WHERE id = $1`, [req.params.id]);
  await logActivity(req.user.username, "Staff", `Removed account "${rows[0].username}"`);
  res.json({ ok: true });
});

module.exports = router;
