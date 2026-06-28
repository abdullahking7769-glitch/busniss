// Staff-facing data routes: listing customers/packages, and the Danger Zone
// full wipe. Kept intentionally minimal here — this is a starting point to
// extend with the rest of the dashboard's features (orders, payments,
// deliveries, etc.) following the same pattern.

const express = require("express");
const pool = require("../db");
const { requireAuth, requireStaff, requireSuperAdmin } = require("../auth");
const { logActivity } = require("../utils");

const router = express.Router();

router.get("/customers", requireAuth, requireStaff, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, phone, email, "mobileVerified", address, city, area, country, province, district, status, "createdAt" FROM customers ORDER BY "createdAt" DESC`
  );
  res.json({ customers: rows });
});

router.get("/packages", requireAuth, requireStaff, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM packages ORDER BY "createdAt" DESC`);
  res.json({ packages: rows });
});

// DELETE /api/admin/danger-zone — Super Admin only. Permanently wipes every
// table and re-seeds nothing. The front-end's own Danger Zone requires
// typing "DELETE EVERYTHING" before even calling this — this route trusts
// that the front-end already did that confirmation, since by the time a
// valid Super Admin request reaches here, confirmation is the front-end's
// job, authorization is this route's job.
router.delete("/danger-zone", requireAuth, requireSuperAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tables = ["activity_log", "payments", "orders", "customer_packages", "packages", "customers", "accounts"];
    for (const table of tables) {
      await client.query(`DELETE FROM ${table}`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Log after the wipe (activity_log was just cleared) so this is the first
  // entry in the fresh log — confirms the wipe happened and by whom, even
  // though "by whom" no longer has an account in the system after this.
  await logActivity(req.user.username, "Staff", "DANGER ZONE: erased all data");
  res.json({ ok: true, message: "All data has been permanently erased." });
});

module.exports = router;
