require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { sendMail } = require('./mailer');

const app = express();

app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'fixai',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});


/* ==================== DATABASE ==================== */

const dbPath = process.env.DB_PATH || path.join(__dirname, 'fixai.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL,
 phone TEXT DEFAULT '',
 password TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('student','Service_Provider','admin','owner')),
 otp_code TEXT,
 otp_expires INTEGER,
 otp_verified INTEGER DEFAULT 0,
 skills TEXT DEFAULT '',
 experience INTEGER DEFAULT 0,
 charges INTEGER DEFAULT 0,
 note TEXT DEFAULT '',
 profile_picture TEXT DEFAULT '',
 created_at INTEGER
);

CREATE TABLE IF NOT EXISTS complaints(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 ticket TEXT UNIQUE NOT NULL,
 title TEXT NOT NULL,
 issue TEXT NOT NULL,
 location TEXT NOT NULL,
 description TEXT NOT NULL,
 images TEXT DEFAULT '[]',
 student_id INTEGER NOT NULL,
 status TEXT DEFAULT 'pending',
 assigned_to INTEGER,
 created_at INTEGER
);

CREATE TABLE IF NOT EXISTS updates(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 complaint_id INTEGER NOT NULL,
 text TEXT NOT NULL,
 created_at INTEGER
);

CREATE TABLE IF NOT EXISTS applications(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 complaint_id INTEGER NOT NULL,
 Service_Provider_id INTEGER NOT NULL,
 skills TEXT DEFAULT '',
 charge INTEGER DEFAULT 0,
 note TEXT DEFAULT '',
 status TEXT DEFAULT 'pending',
 created_at INTEGER
);

CREATE TABLE IF NOT EXISTS chats(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 complaint_id INTEGER NOT NULL,
 sender_id INTEGER NOT NULL,
 text TEXT NOT NULL,
 created_at INTEGER
);

CREATE TABLE IF NOT EXISTS ratings(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 complaint_id INTEGER NOT NULL,
 student_id INTEGER NOT NULL,
 Service_Provider_id INTEGER NOT NULL,
 rating INTEGER NOT NULL,
 review TEXT DEFAULT '',
 created_at INTEGER
);

CREATE TABLE IF NOT EXISTS payments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 complaint_id INTEGER NOT NULL,
 amount INTEGER NOT NULL,
 fixai_share INTEGER NOT NULL,
 Service_Provider_share INTEGER NOT NULL,
 qr_code TEXT DEFAULT '',
 created_at INTEGER
);

CREATE TABLE IF NOT EXISTS notifications(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 text TEXT NOT NULL,
 created_at INTEGER,
 read INTEGER DEFAULT 0
);
`);

/* ==================== DATABASE MIGRATION ==================== */

/*
  IMPORTANT:
  SQLite does not change an existing CHECK constraint when
  CREATE TABLE IF NOT EXISTS is executed.

  The old database allowed:
  student, support, admin, owner

  FixAI now uses:
  student, Service_Provider, admin, owner

  This migration safely recreates the users table with the
  correct role constraint while preserving existing users.
*/

function migrateUsersTable() {
  const tableExists = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type='table'
      AND name='users'
  `).get();

  if (!tableExists) {
    return;
  }

  const tableSQL = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type='table'
      AND name='users'
  `).get();

  if (
    tableSQL &&
    tableSQL.sql &&
    tableSQL.sql.includes("'Service_Provider'")
  ) {
    console.log('✅ Users table schema is already up to date.');
    return;
  }

  console.log('🔄 Updating users table role schema...');

  const columns = db
    .prepare(`PRAGMA table_info(users)`)
    .all()
    .map(column => column.name);

  /*
    Keep only columns that actually exist in the old database.
    New columns get safe default values.
  */

  const has = column => columns.includes(column);

  const nameExpr =
    has('name') ? 'name' : "''";

  const emailExpr =
    has('email') ? 'email' : "''";

  const phoneExpr =
    has('phone') ? 'phone' : "''";

  const passwordExpr =
    has('password') ? 'password' : "''";

  const roleExpr =
    has('role')
      ? `
        CASE
          WHEN role='support'
            THEN 'Service_Provider'
          ELSE role
        END
      `
      : "'student'";

  const otpCodeExpr =
    has('otp_code') ? 'otp_code' : 'NULL';

  const otpExpiresExpr =
    has('otp_expires') ? 'otp_expires' : 'NULL';

  const otpVerifiedExpr =
    has('otp_verified') ? 'otp_verified' : '0';

  const skillsExpr =
    has('skills') ? 'skills' : "''";

  const experienceExpr =
    has('experience') ? 'experience' : '0';

  const chargesExpr =
    has('charges') ? 'charges' : '0';

  const noteExpr =
    has('note') ? 'note' : "''";

  const profilePictureExpr =
    has('profile_picture')
      ? 'profile_picture'
      : "''";

  const createdAtExpr =
    has('created_at')
      ? 'created_at'
      : 'NULL';

  const migrate = db.transaction(() => {

    /*
      Rename old table first.
    */
    db.exec(`
      ALTER TABLE users
      RENAME TO users_old;
    `);

    /*
      Create the correct users table.
    */
    db.exec(`
      CREATE TABLE users(

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        name TEXT NOT NULL,

        email TEXT UNIQUE NOT NULL,

        phone TEXT DEFAULT '',

        password TEXT NOT NULL,

        role TEXT NOT NULL
          CHECK(role IN (
            'student',
            'Service_Provider',
            'admin',
            'owner'
          )),

        otp_code TEXT,

        otp_expires INTEGER,

        otp_verified INTEGER DEFAULT 0,

        skills TEXT DEFAULT '',

        experience INTEGER DEFAULT 0,

        charges INTEGER DEFAULT 0,

        note TEXT DEFAULT '',

        profile_picture TEXT DEFAULT '',

        created_at INTEGER

      );
    `);

    /*
      Copy existing users into the new table.

      IMPORTANT:
      Existing "support" users are converted to
      "Service_Provider" so they remain usable.
    */

    db.exec(`
      INSERT INTO users(
        id,
        name,
        email,
        phone,
        password,
        role,
        otp_code,
        otp_expires,
        otp_verified,
        skills,
        experience,
        charges,
        note,
        profile_picture,
        created_at
      )

      SELECT
        id,
        ${nameExpr},
        ${emailExpr},
        ${phoneExpr},
        ${passwordExpr},
        ${roleExpr},
        ${otpCodeExpr},
        ${otpExpiresExpr},
        ${otpVerifiedExpr},
        ${skillsExpr},
        ${experienceExpr},
        ${chargesExpr},
        ${noteExpr},
        ${profilePictureExpr},
        ${createdAtExpr}

      FROM users_old;
    `);

    /*
      Remove old table after successful copy.
    */
    db.exec(`
      DROP TABLE users_old;
    `);
  });

  migrate();

  console.log(
    '✅ Users table migration completed successfully.'
  );
}

migrateUsersTable();
/* ==================== DATABASE MIGRATION ==================== */

function addColumnIfMissing(table, column, definition) {

  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map(row => row.name);

  if (!columns.includes(column)) {

    db.exec(`
      ALTER TABLE ${table}
      ADD COLUMN ${column} ${definition}
    `);

    console.log(
      `✅ Database updated: ${table}.${column}`
    );
  }
}


/* Service Provider ID migrations */

addColumnIfMissing(
  'applications',
  'Service_Provider_id',
  'INTEGER DEFAULT 0'
);

addColumnIfMissing(
  'ratings',
  'Service_Provider_id',
  'INTEGER DEFAULT 0'
);


/* Payment QR migration */

addColumnIfMissing(
  'payments',
  'qr_code',
  "TEXT DEFAULT ''"
);

/* ==================== SEED OWNER ==================== */


 

const OWNER_EMAIL = (process.env.OWNER_EMAIL || '').toLowerCase();

if (OWNER_EMAIL && process.env.OWNER_PASSWORD) {

  const existingOwner = db
    .prepare('SELECT id FROM users WHERE email=?')
    .get(OWNER_EMAIL);

  if (!existingOwner) {

    db.prepare(`
      INSERT INTO users(
        name,
        email,
        password,
        role,
        otp_verified,
        created_at
      )
      VALUES(?,?,?,?,1,?)
    `).run(
      'FixAI Owner',
      OWNER_EMAIL,
      bcrypt.hashSync(process.env.OWNER_PASSWORD, 10),
      'owner',
      Date.now()
    );

    console.log(
      '✅ Owner account created:',
      OWNER_EMAIL
    );
  }
}


/* ==================== HELPERS ==================== */

const JWT_SECRET =
  process.env.JWT_SECRET || 'change-me';

const FIXAI_CUT = 0.20;

const CAPTCHAS = new Map();

const ok = (res, data = {}) =>
  res.json({
    ok: true,
    ...data
  });

const fail = (res, code, msg) =>
  res.status(code).json({
    ok: false,
    msg
  });


/* ==================== AUTHENTICATION ==================== */

function auth(roles) {

  return (req, res, next) => {

    const token =
      (req.headers.authorization || '')
        .replace('Bearer ', '');

    if (!token) {
      return fail(
        res,
        401,
        'Not logged in'
      );
    }

    try {

      const payload =
        jwt.verify(token, JWT_SECRET);

      const user = db
        .prepare(
          'SELECT * FROM users WHERE id=?'
        )
        .get(payload.id);

      if (!user) {
        return fail(
          res,
          401,
          'User not found'
        );
      }

      if (
        roles &&
        !roles.includes(user.role)
      ) {
        return fail(
          res,
          403,
          'Access denied'
        );
      }

      req.user = user;

      next();

    } catch (e) {

      return fail(
        res,
        401,
        'Session expired. Please log in again.'
      );
    }
  };
}


const genOTP = () =>
  String(
    Math.floor(
      100000 +
      Math.random() * 900000
    )
  );


const genTicket = () =>
  'FX-' +
  Math.floor(
    1000 +
    Math.random() * 9000
  );


function addUpdate(complaintId, text) {

  db.prepare(`
    INSERT INTO updates(
      complaint_id,
      text,
      created_at
    )
    VALUES(?,?,?)
  `).run(
    complaintId,
    text,
    Date.now()
  );
}


function notify(userId, text) {

  db.prepare(`
    INSERT INTO notifications(
      user_id,
      text,
      created_at
    )
    VALUES(?,?,?)
  `).run(
    userId,
    text,
    Date.now()
  );
}


function notifyAdmins(text) {

  db.prepare(
    "SELECT id FROM users WHERE role IN ('admin','owner')"
  )
    .all()
    .forEach(user => {
      notify(user.id, text);
    });
}


function ticketFor(id) {

  return db
    .prepare(
      'SELECT ticket FROM complaints WHERE id=?'
    )
    .get(id)
    .ticket;
}
function publicUser(user) {

  if (!user) return null;

  let rating = {
    a: null,
    c: 0
  };

  try {

    const ratingColumns = db
      .prepare(`PRAGMA table_info(ratings)`)
      .all()
      .map(column => column.name);

    if (
      ratingColumns.includes(
        'Service_Provider_id'
      )
    ) {

      rating = db.prepare(`
        SELECT
          AVG(rating) AS a,
          COUNT(*) AS c
        FROM ratings
        WHERE Service_Provider_id=?
      `).get(user.id);

    } else if (
      ratingColumns.includes(
        'service_provider_id'
      )
    ) {

      rating = db.prepare(`
        SELECT
          AVG(rating) AS a,
          COUNT(*) AS c
        FROM ratings
        WHERE service_provider_id=?
      `).get(user.id);
    }

  } catch (error) {

    console.log(
      '⚠️ Rating lookup skipped:',
      error.message
    );
  }

  return {

    id: user.id,

    name: user.name,

    email: user.email,

    phone: user.phone,

    role: user.role,

    skills: user.skills,

    experience: user.experience,

    charges: user.charges,

    note: user.note,

    /* ==================== PROFILE PICTURE ==================== */

    profile_picture:
      user.profile_picture || '',

    /* ==================== RATING ==================== */

    avg_rating:
      Math.round(
        (rating.a || 0) * 10
      ) / 10,

    rating_count:
      rating.c || 0
  };
}

function complaintRow(complaint) {

  return {
    ...complaint,

    images:
      JSON.parse(
        complaint.images || '[]'
      ),

    student:
      publicUser(
        db.prepare(
          'SELECT * FROM users WHERE id=?'
        ).get(complaint.student_id)
      ),

    Service_Provider:
      complaint.assigned_to
        ? publicUser(
            db.prepare(
              'SELECT * FROM users WHERE id=?'
            ).get(complaint.assigned_to)
          )
        : null,

    updates:
      db.prepare(`
        SELECT *
        FROM updates
        WHERE complaint_id=?
        ORDER BY id
      `).all(complaint.id),

    rating:
      db.prepare(`
        SELECT *
        FROM ratings
        WHERE complaint_id=?
      `).get(complaint.id) || null,

    payment:
      db.prepare(`
        SELECT *
        FROM payments
        WHERE complaint_id=?
      `).get(complaint.id) || null
  };
}


/* ==================== CAPTCHA ==================== */

function svgCaptcha(text) {

  let noise = '';

  for (let i = 0; i < 3; i++) {

    noise += `
      <line
        x1="${Math.floor(Math.random() * 110)}"
        y1="0"
        x2="${Math.floor(Math.random() * 110)}"
        y2="42"
        stroke="#c3cfe4"
      />
    `;
  }

  let chars = '';

  text.split('').forEach((character, index) => {

    chars += `
      <text
        x="${10 + index * 19}"
        y="27"
        font-size="20"
        font-family="monospace"
        font-weight="bold"
        fill="#2563eb"
        transform="rotate(
          ${Math.round(Math.random() * 24 - 12)}
          ${10 + index * 19}
          25
        )"
      >
        ${character}
      </text>
    `;
  });

  return `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="110"
      height="42"
      viewBox="0 0 110 42"
    >
      <rect
        width="110"
        height="42"
        rx="7"
        fill="#eef2f9"
      />

      ${noise}
      ${chars}
    </svg>
  `;
}


app.get('/api/captcha', (req, res) => {

  const characters =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const code =
    Array.from(
      { length: 5 },
      () =>
        characters[
          Math.floor(
            Math.random() *
            characters.length
          )
        ]
    ).join('');

  const id =
    Math.random()
      .toString(36)
      .slice(2);

  CAPTCHAS.set(
    id,
    {
      answer: code,
      exp:
        Date.now() +
        5 * 60 * 1000
    }
  );

  ok(res, {
    id,
    svg: svgCaptcha(code)
  });
});


function checkCaptcha(req, res) {

  const captcha =
    CAPTCHAS.get(
      req.body.captcha_id
    );

  if (
    !captcha ||
    Date.now() > captcha.exp ||
    captcha.answer !==
      (req.body.captcha_answer || '')
        .toUpperCase()
  ) {
    return false;
  }

  CAPTCHAS.delete(
    req.body.captcha_id
  );

  return true;
}


/* ==================== AUTH API ==================== */

app.post(
  '/api/auth/register',
  async (req, res) => {

    const {
      name,
      email,
      phone,
      password,
      role
    } = req.body;

    if (
      ![
        'student',
        'Service_Provider'
      ].includes(role)
    ) {
      return fail(
        res,
        400,
        'Only Student or Service Provider can register here. Admin accounts are created by FixAI.'
      );
    }

    const mail =
      (email || '').toLowerCase();

    if (
      db.prepare(
        'SELECT id FROM users WHERE email=?'
      ).get(mail)
    ) {
      return fail(
        res,
        400,
        'This email is already registered.'
      );
    }

    const otp = genOTP();

    db.prepare(`
      INSERT INTO users(
        name,
        email,
        phone,
        password,
        role,
        otp_code,
        otp_expires,
        created_at
      )
      VALUES(?,?,?,?,?,?,?,?)
    `).run(
      name.trim(),
      mail,
      phone || '',
      bcrypt.hashSync(password, 10),
      role,
      otp,
      Date.now() +
        10 * 60 * 1000,
      Date.now()
    );

    await sendMail(
      mail,
      'FixAI - Verify Your Email',
      `
        <h2>Welcome to FixAI 👋</h2>
        <p>Your verification OTP is:</p>
        <h1 style="letter-spacing:6px">
          ${otp}
        </h1>
        <p>This OTP is valid for 10 minutes.</p>
      `
    );

    ok(res, {
      message:
        'OTP sent to your email. Please verify your email address.'
    });
  }
);


app.post(
  '/api/auth/resend-otp',
  async (req, res) => {

    const mail =
      (req.body.email || '')
        .toLowerCase();

    const user =
      db.prepare(
        'SELECT * FROM users WHERE email=?'
      ).get(mail);

    if (!user) {
      return fail(
        res,
        404,
        'Account not found.'
      );
    }

    const otp = genOTP();

    db.prepare(`
      UPDATE users
      SET otp_code=?,
          otp_expires=?
      WHERE id=?
    `).run(
      otp,
      Date.now() +
        10 * 60 * 1000,
      user.id
    );

    await sendMail(
      mail,
      'FixAI - New OTP',
      `
        <p>Your new verification OTP is:</p>
        <h1 style="letter-spacing:6px">
          ${otp}
        </h1>
      `
    );

    ok(res, {
      message:
        'A new OTP has been sent to your email.'
    });
  }
);


app.post(
  '/api/auth/verify-otp',
  (req, res) => {

    const mail =
      (req.body.email || '')
        .toLowerCase();

    const user =
      db.prepare(
        'SELECT * FROM users WHERE email=?'
      ).get(mail);

    if (!user) {
      return fail(
        res,
        404,
        'Account not found.'
      );
    }

    if (user.otp_verified) {
      return ok(res, {
        message:
          'Your email is already verified. Please sign in.'
      });
    }

    if (
      Date.now() >
      user.otp_expires
    ) {
      return fail(
        res,
        400,
        'OTP expired. Please request a new one.'
      );
    }

    if (
      user.otp_code !==
      String(req.body.otp || '')
    ) {
      return fail(
        res,
        400,
        'Incorrect OTP. Please try again.'
      );
    }

    db.prepare(`
      UPDATE users
      SET otp_verified=1
      WHERE id=?
    `).run(user.id);

    ok(res, {
      message:
        'Email verified successfully. You can now sign in.'
    });
  }
);


app.post(
  '/api/auth/login',
  (req, res) => {

    const {
      email,
      password,
      role
    } = req.body;

    if (!checkCaptcha(req, res)) {
      return fail(
        res,
        400,
        'Incorrect captcha. Please try again.'
      );
    }

    const mail =
      (email || '')
        .toLowerCase();

    const user =
      db.prepare(
        'SELECT * FROM users WHERE email=?'
      ).get(mail);

    if (!user) {
      return fail(
        res,
        400,
        'No account was found with this email.'
      );
    }

    if (
      !bcrypt.compareSync(
        password || '',
        user.password
      )
    ) {
      return fail(
        res,
        400,
        'Incorrect password.'
      );
    }

    const allowed =
      user.role === role ||
      (
        user.role === 'owner' &&
        role === 'admin'
      );

    if (!allowed) {
      return fail(
        res,
        400,
        'Incorrect role selected. Please choose ' +
          user.role +
          '.'
      );
    }

    if (
      !user.otp_verified &&
      [
        'student',
        'Service_Provider'
      ].includes(user.role)
    ) {
      return fail(
        res,
        403,
        'Email not verified. Please verify your email using the OTP before signing in.'
      );
    }

    const token =
      jwt.sign(
        { id: user.id },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

    ok(res, {
      token,
      user: publicUser(user)
    });
  }
);


app.get(
  '/api/auth/me',
  auth(null),
  (req, res) =>
    ok(res, {
      user: publicUser(req.user)
    })
);

/* ==================== PROFILE PICTURE ==================== */

app.put(
  '/api/profile/picture',
  auth([
    'student',
    'Service_Provider',
    'admin',
    'owner'
  ]),
  (req, res) => {

    const {
      profile_picture
    } = req.body;

    if (
      typeof profile_picture !== 'string'
    ) {
      return fail(
        res,
        400,
        'Invalid profile picture.'
      );
    }

    /*
      Maximum image size:
      approximately 5 MB as a data URL.
    */

    if (
      profile_picture.length > 7 * 1024 * 1024
    ) {

      return fail(
        res,
        400,
        'Profile picture is too large. Please choose an image smaller than 5 MB.'
      );
    }

    /*
      Allow only common image data URLs.
    */

    const validImage =
      /^data:image\/(jpeg|jpg|png|webp);base64,/i
        .test(profile_picture);

    if (
      profile_picture !== '' &&
      !validImage
    ) {

      return fail(
        res,
        400,
        'Only JPG, PNG, and WEBP images are supported.'
      );
    }

    db.prepare(`
      UPDATE users
      SET profile_picture=?
      WHERE id=?
    `).run(
      profile_picture,
      req.user.id
    );

    const updatedUser =
      db.prepare(`
        SELECT *
        FROM users
        WHERE id=?
      `).get(
        req.user.id
      );

    ok(res, {
      message:
        profile_picture
          ? 'Profile picture updated successfully.'
          : 'Profile picture removed successfully.',

      user:
        publicUser(updatedUser)
    });
  }
);

/* ==================== COMPLAINTS ==================== */

app.post(
  '/api/complaints',
  auth(['student']),
  (req, res) => {

    const {
      title,
      issue,
      location,
      description,
      images
    } = req.body;

    if (
      !title ||
      !issue ||
      !location ||
      !description
    ) {
      return fail(
        res,
        400,
        'All fields are required.'
      );
    }

    const ticket = genTicket();

    const info =
      db.prepare(`
        INSERT INTO complaints(
          ticket,
          title,
          issue,
          location,
          description,
          images,
          student_id,
          status,
          created_at
        )
        VALUES(?,?,?,?,?,?,?,'pending',?)
      `).run(
        ticket,
        title.trim(),
        issue.trim(),
        location.trim(),
        description.trim(),
        JSON.stringify(images || []),
        req.user.id,
        Date.now()
      );

    addUpdate(
      info.lastInsertRowid,
      'Complaint raised — ' + ticket
    );

    notifyAdmins(
      '🆕 New complaint ' +
      ticket +
      ': ' +
      title
    );

    ok(res, {
      complaint:
        complaintRow(
          db.prepare(
            'SELECT * FROM complaints WHERE id=?'
          ).get(
            info.lastInsertRowid
          )
        )
    });
  }
);


app.get(
  '/api/complaints',
  auth(null),
  (req, res) => {

    let rows;

    if (
      req.user.role === 'student'
    ) {

      rows =
        db.prepare(`
          SELECT *
          FROM complaints
          WHERE student_id=?
          ORDER BY id DESC
        `).all(req.user.id);

    } else if (
      req.user.role === 'Service_Provider'
    ) {

      rows =
        db.prepare(`
          SELECT *
          FROM complaints
          WHERE status IN ('pending','applied')
             OR assigned_to=?
          ORDER BY id DESC
        `).all(req.user.id);

    } else {

      rows =
        db.prepare(`
          SELECT *
          FROM complaints
          ORDER BY id DESC
        `).all();
    }

    let myApplications = [];

    if (
      req.user.role === 'Service_Provider'
    ) {

      myApplications =
        db.prepare(`
          SELECT *
          FROM applications
          WHERE Service_Provider_id=?
        `).all(req.user.id);
    }

    ok(res, {
      complaints:
        rows.map(complaintRow),

      myApplications
    });
  }
);


app.get(
  '/api/complaints/:id',
  auth(null),
  (req, res) => {

    const complaint =
      db.prepare(
        'SELECT * FROM complaints WHERE id=?'
      ).get(
        +req.params.id
      );

    if (!complaint) {
      return fail(
        res,
        404,
        'Complaint not found.'
      );
    }

    const row =
      complaintRow(complaint);

    if (
      req.user.role === 'student' &&
      complaint.student_id !==
        req.user.id
    ) {
      return fail(
        res,
        403,
        'Access denied.'
      );
    }

    if (
      req.user.role === 'Service_Provider' &&
      complaint.assigned_to !==
        req.user.id &&
      ![
        'pending',
        'applied'
      ].includes(
        complaint.status
      )
    ) {
      return fail(
        res,
        403,
        'Access denied.'
      );
    }

    ok(res, {
      complaint: row
    });
  }
);


app.post(
  '/api/complaints/:id/action',
  auth(['Service_Provider']),
  (req, res) => {

    const complaint =
      db.prepare(
        'SELECT * FROM complaints WHERE id=?'
      ).get(
        +req.params.id
      );

    if (!complaint) {
      return fail(
        res,
        404,
        'Complaint not found.'
      );
    }

    if (
      complaint.assigned_to !==
      req.user.id
    ) {
      return fail(
        res,
        403,
        'This job is not assigned to you.'
      );
    }

    const { action } =
      req.body;

    if (
      action === 'start' &&
      complaint.status === 'assigned'
    ) {

      db.prepare(`
        UPDATE complaints
        SET status=?
        WHERE id=?
      `).run(
        'in_progress',
        complaint.id
      );

      addUpdate(
        complaint.id,
        'Service Provider accepted the job and started work.'
      );

    } else if (
      action === 'complete' &&
      complaint.status === 'in_progress'
    ) {

      db.prepare(`
        UPDATE complaints
        SET status=?
        WHERE id=?
      `).run(
        'completed',
        complaint.id
      );

      addUpdate(
        complaint.id,
        'Work completed — awaiting payment.'
      );

      notifyAdmins(
        '✅ ' +
        complaint.ticket +
        ' completed by ' +
        req.user.name +
        '. Please mark it as paid.'
      );

    } else {

      return fail(
        res,
        400,
        'Invalid action for the current status.'
      );
    }

    ok(res, {
      status:
        db.prepare(
          'SELECT status FROM complaints WHERE id=?'
        ).get(
          complaint.id
        ).status
    });
  }
);


/* ==================== APPLICATIONS ==================== */

app.post(
  '/api/applications',
  auth(['Service_Provider']),
  (req, res) => {

    const {
      complaint_id,
      skills,
      charge,
      note
    } = req.body;

    const complaint =
      db.prepare(
        'SELECT * FROM complaints WHERE id=?'
      ).get(
        +complaint_id
      );

    if (!complaint) {
      return fail(
        res,
        404,
        'Complaint not found.'
      );
    }

    if (
      ![
        'pending',
        'applied'
      ].includes(
        complaint.status
      )
    ) {
      return fail(
        res,
        400,
        'This complaint has already been assigned.'
      );
    }

    const duplicate =
      db.prepare(`
        SELECT id
        FROM applications
        WHERE complaint_id=?
        AND Service_Provider_id=?
      `).get(
        complaint.id,
        req.user.id
      );

    if (duplicate) {
      return fail(
        res,
        400,
        'You have already applied for this complaint.'
      );
    }

    db.prepare(`
      INSERT INTO applications(
        complaint_id,
        Service_Provider_id,
        skills,
        charge,
        note,
        created_at
      )
      VALUES(?,?,?,?,?,?)
    `).run(
      complaint.id,
      req.user.id,
      skills || '',
      +charge || 0,
      note || '',
      Date.now()
    );

    if (
      complaint.status === 'pending'
    ) {

      db.prepare(`
        UPDATE complaints
        SET status=?
        WHERE id=?
      `).run(
        'applied',
        complaint.id
      );

      addUpdate(
        complaint.id,
        'A Service Provider applied for this complaint.'
      );
    }

    notifyAdmins(
      '📨 New application for ' +
      complaint.ticket +
      ' from ' +
      req.user.name
    );

    ok(res, {
      message:
        'Application sent to the admin.'
    });
  }
);


app.get(
  '/api/applications/mine',
  auth(['Service_Provider']),
  (req, res) => {

    ok(res, {
      applications:
        db.prepare(`
          SELECT *
          FROM applications
          WHERE Service_Provider_id=?
          ORDER BY id DESC
        `).all(req.user.id)
    });
  }
);


app.get(
  '/api/applications',
  auth(['admin', 'owner']),
  (req, res) => {

    ok(res, {
      applications:
        db.prepare(`
          SELECT *
          FROM applications
          WHERE status=?
          ORDER BY id DESC
        `).all('pending')
    });
  }
);


app.post(
  '/api/applications/:id/respond',
  auth(['admin', 'owner']),
  (req, res) => {

    const application =
      db.prepare(
        'SELECT * FROM applications WHERE id=?'
      ).get(
        +req.params.id
      );

    if (!application) {
      return fail(
        res,
        404,
        'Application not found.'
      );
    }

    const { action } =
      req.body;

    const complaint =
      db.prepare(
        'SELECT * FROM complaints WHERE id=?'
      ).get(
        application.complaint_id
      );

    const serviceProvider =
      db.prepare(
        'SELECT * FROM users WHERE id=?'
      ).get(
        application.Service_Provider_id
      );

    if (
      action === 'accept'
    ) {

      db.prepare(`
        UPDATE applications
        SET status=?
        WHERE id=?
      `).run(
        'accepted',
        application.id
      );

      db.prepare(`
        UPDATE complaints
        SET status=?,
            assigned_to=?
        WHERE id=?
      `).run(
        'assigned',
        serviceProvider.id,
        complaint.id
      );

      addUpdate(
        complaint.id,
        'Application accepted and assigned to ' +
        serviceProvider.name
      );

      notify(
        serviceProvider.id,
        '🎉 Your application for ' +
        complaint.ticket +
        ' was accepted by the admin.'
      );

      sendMail(
        serviceProvider.email,
        'FixAI - Application Accepted',
        `
          <p>
            Your application for
            <b>${complaint.ticket}</b>
            (${complaint.title})
            was accepted.
          </p>

          <p>
            You have been assigned this job.
          </p>
        `
      );

    } else if (
      action === 'reject'
    ) {

      db.prepare(`
        UPDATE applications
        SET status=?
        WHERE id=?
      `).run(
        'rejected',
        application.id
      );

      notify(
        serviceProvider.id,
        '❌ Your application for ' +
        complaint.ticket +
        ' was rejected.'
      );

    } else {

      return fail(
        res,
        400,
        'Invalid action.'
      );
    }

    ok(res, {
      message: 'Done.'
    });
  }
);


/* ==================== SERVICE PROVIDER PROFILE ==================== */

app.put(
  '/api/Service_Provider/profile',
  auth(['Service_Provider']),
  (req, res) => {

    const {
      skills,
      experience,
      charges,
      note
    } = req.body;

    db.prepare(`
      UPDATE users
      SET skills=?,
          experience=?,
          charges=?,
          note=?
      WHERE id=?
    `).run(
      skills || '',
      +experience || 0,
      +charges || 0,
      note || '',
      req.user.id
    );

    const user =
      db.prepare(
        'SELECT * FROM users WHERE id=?'
      ).get(
        req.user.id
      );

    ok(res, {
      user: publicUser(user)
    });
  }
);


/* ==================== ADMIN / OWNER ==================== */

app.get(
  '/api/admin/stats',
  auth(['admin', 'owner']),
  (req, res) => {

    const count = query =>
      db.prepare(query).get();

    ok(res, {

      total:
        count(
          'SELECT COUNT(*) n FROM complaints'
        ).n,

      pending:
        count(`
          SELECT COUNT(*) n
          FROM complaints
          WHERE status IN ('pending','applied')
        `).n,

      progress:
        count(`
          SELECT COUNT(*) n
          FROM complaints
          WHERE status IN ('assigned','in_progress')
        `).n,

      completed:
        count(`
          SELECT COUNT(*) n
          FROM complaints
          WHERE status IN ('completed','paid')
        `).n,

      paid:
        count(`
          SELECT COUNT(*) n
          FROM complaints
          WHERE status='paid'
        `).n,

      Service_Providers:
        count(`
          SELECT COUNT(*) n
          FROM users
          WHERE role='Service_Provider'
        `).n,

      applications:
        count(`
          SELECT COUNT(*) n
          FROM applications
          WHERE status='pending'
        `).n
    });
  }
);


app.get(
  '/api/admin/Service_Providers',
  auth(['admin', 'owner']),
  (req, res) => {

    const rows =
      db.prepare(`
        SELECT *
        FROM users
        WHERE role='Service_Provider'
      `).all();

    ok(res, {
      Service_Providers:
        rows.map(publicUser)
    });
  }
);


app.post(
  '/api/admin/assign',
  auth(['admin', 'owner']),
  async (req, res) => {

    const {
      complaint_id,
      Service_Provider_id
    } = req.body;

    const complaint =
      db.prepare(
        'SELECT * FROM complaints WHERE id=?'
      ).get(
        +complaint_id
      );

    const serviceProvider =
      db.prepare(
        'SELECT * FROM users WHERE id=?'
      ).get(
        +Service_Provider_id
      );

    if (
      !complaint ||
      !serviceProvider
    ) {
      return fail(
        res,
        404,
        'Complaint or Service Provider not found.'
      );
    }

    db.prepare(`
      UPDATE complaints
      SET status=?,
          assigned_to=?
      WHERE id=?
    `).run(
      'assigned',
      serviceProvider.id,
      complaint.id
    );

    addUpdate(
      complaint.id,
      'Assigned to ' +
      serviceProvider.name
    );

    const application =
      db.prepare(`
        SELECT id
        FROM applications
        WHERE complaint_id=?
        AND Service_Provider_id=?
        AND status=?
      `).get(
        complaint.id,
        serviceProvider.id,
        'pending'
      );

    if (application) {

      db.prepare(`
        UPDATE applications
        SET status=?
        WHERE id=?
      `).run(
        'accepted',
        application.id
      );
    }

    notify(
      serviceProvider.id,
      '🔧 You have been assigned ' +
      complaint.ticket +
      ' — ' +
      complaint.title
    );

    notifyAdmins(
      '📌 ' +
      complaint.ticket +
      ' assigned to ' +
      serviceProvider.name
    );

    await sendMail(
      serviceProvider.email,
      'FixAI - New Job Assigned',
      `
        <p>
          You have been assigned complaint
          <b>${complaint.ticket}</b>
          (${complaint.title}).
        </p>

        <p>
          Location: ${complaint.location}
        </p>

        <p>
          Please log in to FixAI to manage the job.
        </p>
      `
    );

    ok(res, {
      message:
        'Assigned to ' +
        serviceProvider.name
    });
  }
);


app.get(
  '/api/admin/admins',
  auth(['owner']),
  (req, res) => {

    ok(res, {
      admins:
        db.prepare(`
          SELECT
            id,
            name,
            email,
            phone,
            created_at
          FROM users
          WHERE role='admin'
          ORDER BY id DESC
        `).all()
    });
  }
);

/* ==================== UNASSIGN SERVICE PROVIDER ==================== */

app.post(
  '/api/admin/unassign',
  auth(['admin', 'owner']),
  async (req, res) => {

    const complaintId =
      +req.body.complaint_id;

    const complaint =
      db.prepare(
        'SELECT * FROM complaints WHERE id=?'
      ).get(complaintId);

    if (!complaint) {
      return fail(
        res,
        404,
        'Complaint not found.'
      );
    }

    if (!complaint.assigned_to) {
      return fail(
        res,
        400,
        'This complaint is already unassigned.'
      );
    }

    const oldServiceProvider =
      db.prepare(
        'SELECT * FROM users WHERE id=?'
      ).get(
        complaint.assigned_to
      );

    /* Remove Service Provider assignment */
    db.prepare(`
      UPDATE complaints
      SET assigned_to=NULL,
          status='pending'
      WHERE id=?
    `).run(
      complaint.id
    );

    /* Add complaint history */
    addUpdate(
      complaint.id,
      'Service Provider assignment removed. Complaint is now Unassigned.'
    );

    /* Notify previous Service Provider */
    if (oldServiceProvider) {

      notify(
        oldServiceProvider.id,
        '⚠️ Your assignment for ' +
        complaint.ticket +
        ' has been removed by the admin.'
      );
    }

    /* Notify admins */
    notifyAdmins(
      '📌 ' +
      complaint.ticket +
      ' is now Unassigned.'
    );

    ok(res, {
      message:
        'Service Provider unassigned successfully.'
    });
  }
);


/* ==================== CREATE ADMIN ==================== */

app.post(
  '/api/admin/create-admin',
  auth(['owner']),
  async (req, res) => {

    const {
      name,
      email,
      phone
    } = req.body;

    const mail =
      (email || '')
        .toLowerCase();

    if (!name || !mail) {
      return fail(
        res,
        400,
        'Name and email are required.'
      );
    }

    if (
      db.prepare(
        'SELECT id FROM users WHERE email=?'
      ).get(mail)
    ) {
      return fail(
        res,
        400,
        'This email is already in use.'
      );
    }

    const password =
      Math.random()
        .toString(36)
        .slice(2, 8) +
      '@F1x';

    /*
      Fixed SQL:
      The original query had a mismatch between
      the number of columns and values.
    */

    db.prepare(`
      INSERT INTO users(
        name,
        email,
        phone,
        password,
        role,
        otp_verified,
        created_at
      )
      VALUES(?,?,?,?,?,1,?)
    `).run(
      name.trim(),
      mail,
      phone || '',
      bcrypt.hashSync(
        password,
        10
      ),
      'admin',
      Date.now()
    );

    await sendMail(
      mail,
      'FixAI - Your Admin Account',
      `
        <p>Hi ${name},</p>

        <p>
          You now have Admin access to FixAI.
        </p>

        <p>
          Login email:
          <b>${mail}</b>
          <br>

          Temporary password:
          <b>${password}</b>
        </p>

        <p>
          Please keep your login credentials secure.
        </p>
      `
    );

    /* Notify the FixAI owner */

    const owner =
      db.prepare(
        'SELECT * FROM users WHERE role=?'
      ).get('owner');

    if (owner) {

      notify(
        owner.id,
        '👑 New FixAI admin account created: ' +
        mail +
        ' (' +
        name +
        ')'
      );

      await sendMail(
        owner.email,
        'FixAI Owner - New Admin Account Created',
        `
          <p>
            A new admin account has been created.
          </p>

          <p>
            Name:
            <b>${name}</b>
            <br>

            Email:
            <b>${mail}</b>
            <br>

            Phone:
            ${phone || '-'}
          </p>
        `
      );
    }

    ok(res, {
      message:
        'Admin account created successfully. Login credentials were sent to ' +
        mail +
        ' and the owner has been notified.'
    });
  }
);


/* ==================== CHAT ==================== */

app.get(
  '/api/chat/:complaintId',
  auth(null),
  (req, res) => {

    const complaint =
      db.prepare(
        'SELECT * FROM complaints WHERE id=?'
      ).get(
        +req.params.complaintId
      );

    if (!complaint) {
      return fail(
        res,
        404,
        'Complaint not found.'
      );
    }

    if (
      !['admin', 'owner']
        .includes(req.user.role) &&
      complaint.assigned_to !==
        req.user.id
    ) {
      return fail(
        res,
        403,
        'Access denied.'
      );
    }

    ok(res, {
      messages:
        db.prepare(`
          SELECT *
          FROM chats
          WHERE complaint_id=?
          ORDER BY id
        `).all(complaint.id)
    });
  }
);


app.post(
  '/api/chat/:complaintId',
  auth(null),
  (req, res) => {

    const complaint =
      db.prepare(
        'SELECT * FROM complaints WHERE id=?'
      ).get(
        +req.params.complaintId
      );

    if (!complaint) {
      return fail(
        res,
        404,
        'Complaint not found.'
      );
    }

    if (
      !['admin', 'owner']
        .includes(req.user.role) &&
      complaint.assigned_to !==
        req.user.id
    ) {
      return fail(
        res,
        403,
        'Access denied.'
      );
    }

    const text =
      (req.body.text || '')
        .trim();

    if (!text) {
      return fail(
        res,
        400,
        'Message cannot be empty.'
      );
    }

    db.prepare(`
      INSERT INTO chats(
        complaint_id,
        sender_id,
        text,
        created_at
      )
      VALUES(?,?,?,?)
    `).run(
      complaint.id,
      req.user.id,
      text,
      Date.now()
    );

    ok(res, {
      message: 'Message sent.'
    });
  }
);


/* ==================== RATINGS ==================== */

app.post(
  '/api/ratings',
  auth(['student']),
  (req, res) => {

    const {
      complaint_id,
      rating,
      review
    } = req.body;

    const complaint =
      db.prepare(
        'SELECT * FROM complaints WHERE id=?'
      ).get(
        +complaint_id
      );

    if (
      !complaint ||
      complaint.student_id !==
        req.user.id
    ) {
      return fail(
        res,
        403,
        'Access denied.'
      );
    }

    if (
      ![
        'completed',
        'paid'
      ].includes(
        complaint.status
      )
    ) {
      return fail(
        res,
        400,
        'You can rate the Service Provider only after the job is completed.'
      );
    }

    if (!complaint.assigned_to) {
      return fail(
        res,
        400,
        'No Service Provider has been assigned.'
      );
    }

    if (
      db.prepare(
        'SELECT id FROM ratings WHERE complaint_id=?'
      ).get(complaint.id)
    ) {
      return fail(
        res,
        400,
        'This complaint has already been rated.'
      );
    }

    db.prepare(`
      INSERT INTO ratings(
        complaint_id,
        student_id,
        Service_Provider_id,
        rating,
        review,
        created_at
      )
      VALUES(?,?,?,?,?,?)
    `).run(
      complaint.id,
      req.user.id,
      complaint.assigned_to,
      +rating,
      review || '',
      Date.now()
    );

    const serviceProvider =
      db.prepare(
        'SELECT * FROM users WHERE id=?'
      ).get(
        complaint.assigned_to
      );

    notify(
      serviceProvider.id,
      '⭐ You received a ' +
      rating +
      '/5 rating for ' +
      complaint.ticket
    );

    ok(res, {
      message:
        'Thank you for your rating.'
    });
  }
);


/* ==================== PAYMENTS ==================== */

/*
  FixAI Payment Flow:

  1. Service Provider completes the job.
  2. Admin/Owner handles the payment.
  3. FixAI QR is used for payment.
  4. FixAI keeps 20%.
  5. Service Provider gets 80%.
*/

app.post(
  '/api/payments/mark-paid',
  auth(['admin', 'owner']),
  async (req, res) => {

    const complaint =
      db.prepare(
        'SELECT * FROM complaints WHERE id=?'
      ).get(
        +req.body.complaint_id
      );

    if (!complaint) {
      return fail(
        res,
        404,
        'Complaint not found.'
      );
    }

    if (complaint.status !== 'completed') {
      return fail(
        res,
        400,
        'Only completed jobs can be marked as paid.'
      );
    }

    /*
      Service Provider MUST be assigned
      before payment.
    */

    if (!complaint.assigned_to) {
      return fail(
        res,
        400,
        'No Service Provider is assigned to this complaint.'
      );
    }

    const serviceProvider =
      db.prepare(
        'SELECT * FROM users WHERE id=? AND role=?'
      ).get(
        complaint.assigned_to,
        'Service_Provider'
      );

    if (!serviceProvider) {
      return fail(
        res,
        404,
        'Assigned Service Provider not found.'
      );
    }

    /*
      Payment amount comes from
      Service Provider charges.

      Minimum payment = ₹100
    */

    const amount =
      Math.max(
        100,
        Number(serviceProvider.charges || 0)
      );

    /*
      FixAI = 20%
      Service Provider = 80%
    */

    const fixaiShare =
      Math.round(
        amount * FIXAI_CUT
      );

    const serviceProviderShare =
      amount - fixaiShare;

    /*
      Mark complaint as paid
    */

    db.prepare(`
      UPDATE complaints
      SET status=?
      WHERE id=?
    `).run(
      'paid',
      complaint.id
    );

    /*
      Save payment record
    */

    db.prepare(`
      INSERT INTO payments(
        complaint_id,
        amount,
        fixai_share,
        Service_Provider_share,
        qr_code,
        created_at
      )
      VALUES(?,?,?,?,?,?)
    `).run(
      complaint.id,
      amount,
      fixaiShare,
      serviceProviderShare,
      req.body.qr_code || '',
      Date.now()
    );

    /*
      Add complaint update
    */

    addUpdate(
      complaint.id,
      'Payment completed — FixAI ₹' +
      fixaiShare +
      ' (20%), Service Provider ₹' +
      serviceProviderShare +
      ' (80%)'
    );

    /*
      Notify Service Provider
    */

    notify(
      serviceProvider.id,
      '💰 Payment received: ₹' +
      serviceProviderShare +
      ' for ' +
      complaint.ticket +
      ' (80% after FixAI 20% commission)'
    );

    /*
      Email Service Provider
    */

    await sendMail(
      serviceProvider.email,
      'FixAI - Payment Received',
      `
        <p>
          ₹<b>${serviceProviderShare}</b>
          has been recorded as your payment
          for <b>${complaint.ticket}</b>.
        </p>

        <p>
          Total amount: ₹${amount}
        </p>

        <p>
          FixAI commission: ₹${fixaiShare} (20%)
        </p>

        <p>
          Service Provider share: ₹${serviceProviderShare} (80%)
        </p>
      `
    );

    /*
      Notify FixAI Owner
    */

    const owner =
      db.prepare(
        'SELECT * FROM users WHERE role=?'
      ).get('owner');

    if (owner) {

      notify(
        owner.id,
        '💳 Job ' +
        complaint.ticket +
        ' paid — FixAI earned ₹' +
        fixaiShare
      );
    }

    /*
      Response
    */

    ok(res, {
      message: 'Payment marked successfully.',
      amount,
      fixai_share: fixaiShare,
      Service_Provider_share:
        serviceProviderShare,
      qr_code:
        req.body.qr_code || ''
    });
  }
);
/* ==================== NOTIFICATIONS ==================== */

app.get(
  '/api/notifications',
  auth(null),
  (req, res) => {

    ok(res, {
      notifications:
        db.prepare(`
          SELECT *
          FROM notifications
          WHERE user_id=?
          ORDER BY id DESC
          LIMIT 60
        `).all(req.user.id)
    });
  }
);


app.post(
  '/api/notifications/read',
  auth(null),
  (req, res) => {

    db.prepare(`
      UPDATE notifications
      SET read=1
      WHERE user_id=?
    `).run(req.user.id);

    ok(res);
  }
);


/* ==================== PAGES ==================== */

app.get(
  '/student',
  (req, res) =>
    res.sendFile(
      path.join(
        __dirname,
        'public/student.html'
      )
    )
);


const serviceProviderFile =
  fs.existsSync(
    path.join(
      __dirname,
      'public',
      'Service_Provider.html'
    )
  )
    ? path.join(
        __dirname,
        'public',
        'Service_Provider.html'
      )
    : path.join(
        __dirname,
        'public',
        'support.html'
      );

app.get(
  ['/Service_Provider', '/service_provider', '/service-provider', '/support'],
  (req, res) =>
    res.sendFile(serviceProviderFile)
);


app.get(
  '/admin',
  (req, res) =>
    res.sendFile(
      path.join(
        __dirname,
        'public/admin.html'
      )
    )
);


/* ==================== SERVER ==================== */

const PORT = Number(process.env.PORT || 3000);

function startServer(port) {
  const server = app.listen(
    port,
    '0.0.0.0',
    () => {
      console.log(
        `✅ FixAI running → http://localhost:${port}`
      );

      const newLocal = `🌐 Network access enabled on port ${port}`;
      console.log(
        newLocal
      );
    }
  );

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
        console.error(`Port ${port} is already in use in production. Exiting.`);
        process.exit(1);
      }
      const nextPort = port + 1;
      console.warn(
        `Port ${port} is already in use. Retrying on ${nextPort}...`
      );
      startServer(nextPort);
      return;
    }

    throw err;
  });
}

startServer(PORT);