// utils/translator.js
const {
  TranslateClient,
  TranslateTextCommand,
} = require("@aws-sdk/client-translate");
const { pool } = require("./DB");

class Translator {
  constructor(config = {}) {
    this.client = new TranslateClient({
      // ✅ 변경
      region: config.region || "ap-northeast-2",
    });

    this.callInterval = config.callInterval || 100;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.maxCacheSize = config.maxCacheSize || 10000;
    this.cacheExpireDays = config.cacheExpireDays || 30;
    this.lastCallTime = Date.now();
  }

  async translate(text) {
    if (!text) return text;
    const cached = await this.getFromCache(text);
    if (cached) return cached;

    const translated = await this.callAPI(text);
    await this.saveToCache(text, translated);

    return translated;
  }

  async callAPI(text, retries = 0) {
    const now = Date.now();
    if (now - this.lastCallTime < this.callInterval) {
      await this.delay(this.callInterval - (now - this.lastCallTime));
    }
    this.lastCallTime = Date.now();

    const params = {
      Text: text,
      SourceLanguageCode: "ja",
      TargetLanguageCode: "en",
    };

    const command = new TranslateTextCommand(params);

    try {
      const result = await this.client.send(command); // ✅ 변경
      return result.TranslatedText;
    } catch (error) {
      if (error.name === "ThrottlingException" && retries < this.maxRetries) {
        console.log(
          `Throttled. Retrying in ${this.retryDelay}ms... (${retries + 1}/${
            this.maxRetries
          })`,
        );
        await this.delay(this.retryDelay);
        return this.callAPI(text, retries + 1);
      }
      console.error("Translation error:", error.message);
      throw error;
    }
  }

  async getFromCache(text) {
    let conn;
    try {
      conn = await pool.getConnection();
      const [rows] = await conn.query(
        "SELECT translated_text FROM translation_cache WHERE source_text = ?",
        [text],
      );

      if (rows.length > 0) {
        await conn.query(
          "UPDATE translation_cache SET updated_at = NOW() WHERE source_text = ?",
          [text],
        );
        return rows[0].translated_text;
      }

      return null;
    } catch (error) {
      console.error("Cache read error:", error);
      return null;
    } finally {
      if (conn) conn.release();
    }
  }

  async saveToCache(sourceText, translatedText) {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.query(
        "INSERT INTO translation_cache (source_text, translated_text) VALUES (?, ?) " +
          "ON DUPLICATE KEY UPDATE translated_text = VALUES(translated_text), updated_at = NOW()",
        [sourceText, translatedText],
      );
    } catch (error) {
      console.error("Cache save error:", error);
    } finally {
      if (conn) conn.release();
    }
  }

  async cleanupCache() {
    let conn;
    try {
      conn = await pool.getConnection();

      const [countRows] = await conn.query(
        "SELECT COUNT(*) as count FROM translation_cache",
      );
      const count = countRows[0].count;

      if (count > this.maxCacheSize) {
        const deleteCount = count - this.maxCacheSize;
        await conn.query(
          "DELETE FROM translation_cache ORDER BY updated_at ASC LIMIT ?",
          [deleteCount],
        );
        console.log(`Cleaned up ${deleteCount} old cache entries (size limit)`);
      }

      const [result] = await conn.query(
        "DELETE FROM translation_cache WHERE updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
        [this.cacheExpireDays],
      );

      if (result.affectedRows > 0) {
        console.log(`Cleaned up ${result.affectedRows} expired cache entries`);
      }
    } catch (error) {
      console.error("Cleanup error:", error);
    } finally {
      if (conn) conn.release();
    }
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const translator = new Translator({
  region: "ap-northeast-2",
  callInterval: 50,
  maxRetries: 2,
  retryDelay: 500,
  maxCacheSize: 50000,
  cacheExpireDays: 365,
});

module.exports = translator;
