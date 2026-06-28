// Real authentication primitives — this is the part the browser-only
// version of this app could never do safely, because hashing only means
// something if it happens somewhere the user can't read or skip it.

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

if (!JWT_SECRET || JWT_SECRET === "replace_this_with_a_long_random_string") {
  // Fail loudly at startup rather than silently signing tokens with a
  // guessable secret — a weak/default secret means anyone could forge a
  // valid login token without ever knowing a password.
  console.error(
    "\nFATAL: JWT_SECRET is not set (or still has its placeholder value).\n" +
    "Generate one with:\n  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"\n" +
    "and put it in your .env file before starting the server.\n"
  );
  process.exit(1);
}

const SALT_ROUNDS = 12; // higher = slower to compute but harder to brute-force; 12 is a solid default in 2026

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

async function verifyPassword(plainPassword, storedHash) {
  if (!storedHash) return false;
  return bcrypt.compare(plainPassword, storedHash);
}

// A token identifies who's logged in (id, role/type) without the server
// needing to keep session state — the token itself, signed with JWT_SECRET,
// is the proof. type distinguishes a staff session from a customer session,
// since they're authorized for completely different endpoints.
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Express middleware: reads "Authorization: Bearer <token>", verifies it,
// and attaches the decoded payload to req.user. Rejects the request
// entirely if the token is missing, malformed, or expired — routes using
// this never need to re-check authentication themselves.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in." });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Session expired or invalid. Please sign in again." });

  req.user = payload;
  next();
}

// Use after requireAuth on routes that only Staff/Admin/Super Admin should
// reach — e.g. anything that lists or edits other customers' data.
function requireStaff(req, res, next) {
  if (req.user?.type !== "staff") return res.status(403).json({ error: "Staff access only." });
  next();
}

// Use after requireAuth on routes restricted to Admin or Super Admin
// specifically (not plain Staff) — e.g. creating new staff accounts.
function requireAdmin(req, res, next) {
  if (req.user?.type !== "staff" || !["Admin", "Super Admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Admin access only." });
  }
  next();
}

// The Danger Zone (full data wipe) is Super Admin only, deliberately
// stricter than requireAdmin — mirrors the front-end's own Danger Zone gate.
function requireSuperAdmin(req, res, next) {
  if (req.user?.type !== "staff" || req.user.role !== "Super Admin") {
    return res.status(403).json({ error: "Super Admin access only." });
  }
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  requireAuth,
  requireStaff,
  requireAdmin,
  requireSuperAdmin,
};
