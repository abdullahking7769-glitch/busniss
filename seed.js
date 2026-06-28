// Run once after migrating, to create the very first account. After this,
// that Super Admin can create every other account through the API/UI — this
// script exists purely to solve the chicken-and-egg problem of "staff
// signup isn't public, so how does the first account ever get created?"
//
// Usage: node src/seed.js <username> <password>
// Example: node src/seed.js admin "a-strong-password-here"

require("dotenv").config();
const pool = require("./db");
const { hashPassword } = require("./auth");
const { uid } = require("./utils");

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error("Usage: node src/seed.js <username> <password>");
    process.exit(1);
  }
  if (password.length < 4) {
    console.error("Password must be at least 4 characters.");
    process.exit(1);
  }

  const existing = await pool.query(`SELECT id FROM accounts WHERE username = $1`, [username]);
  if (existing.rows[0]) {
    console.error(`An account with username "${username}" already exists.`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const id = uid("acct");
  await pool.query(
    `INSERT INTO accounts (id, username, "passwordHash", role) VALUES ($1, $2, $3, 'Super Admin')`,
    [id, username, passwordHash]
  );

  console.log(`Super Admin account "${username}" created. You can now log in with it.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
