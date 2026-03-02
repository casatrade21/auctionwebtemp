/**
 * DB.js — MySQL 연결 풀 관리
 *
 * pool        — 메인 앱용 (connectionLimit: 100)
 * sessionPool — 세션 스토어 전용 (connectionLimit: 20)
 * safeQuery   — 커넥션 자동 해제 쿼리 함수
 */
require("dotenv").config();
const mysql = require("mysql2/promise");

// 메인 커넥션 풀 (100개)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  connectionLimit: 100,
  charset: "utf8mb4",
  connectTimeout: 10000,
  idleTimeout: 300000, // 5분
  maxIdle: 40,
});

// 세션 전용 커넥션 풀 (20개)
const sessionPool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  connectionLimit: 20,
  charset: "utf8mb4",
  connectTimeout: 10000,
  idleTimeout: 120000, // 2분
  maxIdle: 8,
});

/** 커넥션 풀 상태 출력 (개발 환경 전용) */
async function monitorConnections() {
  try {
    const [maxConn] = await pool.query("SHOW VARIABLES LIKE 'max_connections'");
    const [currentConn] = await pool.query(
      "SHOW STATUS LIKE 'Threads_connected'",
    );

    console.log(`MySQL Max Connections: ${maxConn[0].Value}`);
    console.log(`Current Active Connections: ${currentConn[0].Value}`);
    console.log(
      `Pool Status - Active: ${pool.pool._allConnections.length}, Free: ${pool.pool._freeConnections.length}`,
    );
  } catch (err) {
    console.error("Connection monitoring error:", err);
  }
}

/** 커넥션 자동 해제 쿼리 — conn.release() 누락 방지 */
async function safeQuery(query, params = []) {
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.query(query, params);
    return rows;
  } catch (error) {
    console.error("Query error:", error);
    throw error;
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

// 개발 환경: 1분 간격 모니터링
if (process.env.NODE_ENV !== "production") {
  setInterval(monitorConnections, 60000);
}

/** DB 연결 테스트 (CLI 직접 실행용) */
async function testConnection() {
  let conn;
  try {
    conn = await pool.getConnection();
    console.log("Successfully connected to the database");

    const queries = [`SHOW INDEX FROM crawled_items`];
    for (const query of queries) {
      const [rows, fields] = await conn.query(query);
      console.log(`Executed: ${query}`);
      console.log("Result:", rows);
      console.log(`Affected rows: ${rows.affectedRows}`);
    }
  } catch (err) {
    if (err.code === "ER_ACCESS_DENIED_ERROR") {
      console.error("Invalid credentials:", err.message);
    } else if (err.code === "ECONNREFUSED") {
      console.error("Connection refused:", err.message);
    } else if (err.code === "ER_CON_COUNT_ERROR") {
      console.error("Too many connections:", err.message);
    } else {
      console.error("Database connection or query error:", err.message);
    }
  } finally {
    if (conn) {
      conn.release();
      console.log("Database connection released");
    }
  }
}

if (require.main === module) {
  testConnection();
}

module.exports = { pool, sessionPool, safeQuery, monitorConnections };
