const crypto = require("crypto");
const pool = require("./db");

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

// Same shape as the front-end's activity log, so the two stay compatible if
// you ever migrate that data over. Async because pg (unlike better-sqlite3)
// is promise-based — callers should `await` this or it's fine to let it run
// in the background, since a logging failure shouldn't block the request.
async function logActivity(actor, actorType, action) {
  await pool.query(
    `INSERT INTO activity_log (id, actor, "actorType", action) VALUES ($1, $2, $3, $4)`,
    [uid("log"), actor, actorType, action]
  );
}

module.exports = { uid, logActivity };
