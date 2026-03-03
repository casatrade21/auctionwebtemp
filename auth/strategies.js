// auth/strategies.js
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const pool = require('../utils/DB');
const logger = require('../utils/logger');

const localStrategy = new LocalStrategy(
  async (username, password, done) => {
    try {
      const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

      if (users.length === 0) {
        return done(null, false, { message: 'Incorrect username.' });
      }

      const user = users[0];

      if (!user.password) {
        return done(null, false, { message: 'Password not found.' });
      }

      const isValid = await bcrypt.compare(password, user.password);

      if (!isValid) {
        return done(null, false, { message: 'Incorrect password.' });
      }

      return done(null, user);
    } catch (err) {
      logger.error('Error during local strategy authentication:', err);
      return done(err);
    }
  }
);

module.exports = { localStrategy };