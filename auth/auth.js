/**
 * auth/auth.js — Passport 초기화
 *
 * Express 앱에 Passport 미들웨어를 등록하고
 * 세션 기반 사용자 직렬화/역직렬화를 설정한다.
 */
const passport = require("passport");
const { localStrategy } = require("./strategies");
const pool = require("../utils/DB");
const logger = require("../utils/logger");

function initializeAuth(app) {
  passport.use(localStrategy);

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const [users] = await pool.query("SELECT * FROM users WHERE id = ?", [
        id,
      ]);
      if (users.length === 0) {
        return done(null, false);
      }
      done(null, users[0]);
    } catch (err) {
      logger.error("Error during user deserialization:", err);
      done(err);
    }
  });

  app.use(passport.initialize());
  app.use(passport.session());
}

module.exports = { initializeAuth };
