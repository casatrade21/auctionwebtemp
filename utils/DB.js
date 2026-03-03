// utils/DB.js
require("dotenv").config();
const mysql = require("mysql2/promise");

// 메인 애플리케이션용 연결 풀
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  connectionLimit: 100,
  charset: "utf8mb4",
  connectTimeout: 10000,
  // 추가 안정성 설정
  idleTimeout: 300000, // 5분 후 유휴 연결 해제
  maxIdle: 40, // 최대 유휴 연결 수
});

// 세션 스토어 전용 연결 풀 (별도 관리)
const sessionPool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  connectionLimit: 20, // 세션용 전용 연결
  charset: "utf8mb4",
  connectTimeout: 10000,
  idleTimeout: 120000, // 2분 후 유휴 연결 해제
  maxIdle: 8,
});

// 연결 상태 모니터링 함수
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

// 안전한 쿼리 실행 함수
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

// 연결 풀 상태 체크 (개발 환경에서만)
if (process.env.NODE_ENV !== "production") {
  setInterval(monitorConnections, 60000); // 1분마다 모니터링
}

// test 쿼리 (수정됨)
async function testConnection() {
  let conn;
  try {
    conn = await pool.getConnection();
    console.log("Successfully connected to the database");

    // 연결 상태 확인 쿼리들
    const queries = [`SHOW INDEX FROM crawled_items`];

    // 각 쿼리 순차 실행
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

// 개발용 실행
if (require.main === module) {
  testConnection();
}

module.exports = { pool, sessionPool, safeQuery, monitorConnections };
