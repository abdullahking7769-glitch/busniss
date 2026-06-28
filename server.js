require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const staffAuthRoutes = require("./routes/staffAuth");
const customerAuthRoutes = require("./routes/customerAuth");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 4000;

// Only browsers loading your actual deployed dashboard can call this API —
// without this, ANY website could call your login endpoints from a
// visitor's browser. Set ALLOWED_ORIGINS in .env once you have a real
// dashboard URL; localhost is allowed by default for local development.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map((s) => s.trim());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
}));

app.use(express.json());

// Slows down password-guessing: caps login/signup attempts per IP. Without
// this, hashing being "slow on purpose" (bcrypt) is the only brake on
// someone scripting thousands of guesses per minute against one account.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/staff/login", authLimiter);
app.use("/api/customers/login", authLimiter);
app.use("/api/customers/signup", authLimiter);

app.use("/api/staff", staffAuthRoutes);
app.use("/api/customers", customerAuthRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Catch-all error handler — never leak stack traces or internal error
// details to the client; log them server-side instead.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end." });
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
