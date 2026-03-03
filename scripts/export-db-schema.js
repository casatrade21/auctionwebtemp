// scripts/export-db-schema.js
// DB 스키마를 조회하여 documents/db-schema.md 파일로 정리하는 스크립트
require("dotenv").config();
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

async function exportSchema() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME,
    connectionLimit: 5,
    charset: "utf8mb4",
    connectTimeout: 10000,
  });

  let conn;
  try {
    conn = await pool.getConnection();
    const dbName = process.env.DB_NAME;
    console.log(`Connected to database: ${dbName}`);

    // 1. 전체 테이블 목록 조회
    const [tables] = await conn.query(
      `SELECT TABLE_NAME, TABLE_COMMENT, ENGINE, TABLE_ROWS, 
              AUTO_INCREMENT, CREATE_TIME, UPDATE_TIME, TABLE_COLLATION
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? 
       ORDER BY TABLE_NAME`,
      [dbName],
    );

    console.log(`Found ${tables.length} tables`);

    let md = `# Database Schema: ${dbName}\n\n`;
    md += `> 자동 생성일: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}\n\n`;

    // 2. 테이블 요약 목차
    md += `## 테이블 목록 (총 ${tables.length}개)\n\n`;
    md += `| # | 테이블명 | 설명 | 엔진 | 예상 행 수 | 생성일 |\n`;
    md += `|---|----------|------|------|------------|--------|\n`;

    tables.forEach((t, i) => {
      const created = t.CREATE_TIME
        ? new Date(t.CREATE_TIME).toLocaleDateString("ko-KR")
        : "-";
      md += `| ${i + 1} | [${t.TABLE_NAME}](#${t.TABLE_NAME.toLowerCase()}) | ${t.TABLE_COMMENT || "-"} | ${t.ENGINE || "-"} | ${t.TABLE_ROWS ?? "-"} | ${created} |\n`;
    });

    md += `\n---\n\n`;

    // 3. 각 테이블 상세 스키마
    for (const table of tables) {
      const tableName = table.TABLE_NAME;
      console.log(`  Processing: ${tableName}`);

      // 컬럼 정보
      const [columns] = await conn.query(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, 
                COLUMN_KEY, EXTRA, COLUMN_COMMENT, ORDINAL_POSITION
         FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [dbName, tableName],
      );

      // 인덱스 정보
      const [indexes] = await conn.query(
        `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX, INDEX_TYPE
         FROM INFORMATION_SCHEMA.STATISTICS 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [dbName, tableName],
      );

      // 외래 키 정보
      const [foreignKeys] = await conn.query(
        `SELECT CONSTRAINT_NAME, COLUMN_NAME, 
                REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? 
           AND REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY CONSTRAINT_NAME`,
        [dbName, tableName],
      );

      // 테이블 헤더
      md += `## ${tableName}\n\n`;
      if (table.TABLE_COMMENT) {
        md += `> ${table.TABLE_COMMENT}\n\n`;
      }
      md += `- **엔진**: ${table.ENGINE || "-"} | **문자셋**: ${table.TABLE_COLLATION || "-"} | **예상 행 수**: ${table.TABLE_ROWS ?? "-"}`;
      if (table.AUTO_INCREMENT) {
        md += ` | **Auto Increment**: ${table.AUTO_INCREMENT}`;
      }
      md += `\n\n`;

      // 컬럼 테이블
      md += `### 컬럼\n\n`;
      md += `| # | 컬럼명 | 타입 | NULL | 기본값 | 키 | 기타 | 설명 |\n`;
      md += `|---|--------|------|------|--------|-----|------|------|\n`;

      columns.forEach((col, i) => {
        const nullable = col.IS_NULLABLE === "YES" ? "O" : "X";
        const defaultVal =
          col.COLUMN_DEFAULT === null
            ? "NULL"
            : col.COLUMN_DEFAULT === undefined
              ? "-"
              : `\`${col.COLUMN_DEFAULT}\``;
        const key = col.COLUMN_KEY || "-";
        const extra = col.EXTRA || "-";
        const comment = col.COLUMN_COMMENT || "-";
        md += `| ${i + 1} | \`${col.COLUMN_NAME}\` | \`${col.COLUMN_TYPE}\` | ${nullable} | ${defaultVal} | ${key} | ${extra} | ${comment} |\n`;
      });

      // 인덱스 정보
      if (indexes.length > 0) {
        md += `\n### 인덱스\n\n`;
        md += `| 인덱스명 | 컬럼 | 유니크 | 타입 |\n`;
        md += `|----------|------|--------|------|\n`;

        // 인덱스를 그룹화
        const indexMap = new Map();
        indexes.forEach((idx) => {
          if (!indexMap.has(idx.INDEX_NAME)) {
            indexMap.set(idx.INDEX_NAME, {
              columns: [],
              nonUnique: idx.NON_UNIQUE,
              type: idx.INDEX_TYPE,
            });
          }
          indexMap.get(idx.INDEX_NAME).columns.push(idx.COLUMN_NAME);
        });

        indexMap.forEach((val, name) => {
          const unique = val.nonUnique === 0 ? "YES" : "NO";
          md += `| \`${name}\` | ${val.columns.map((c) => `\`${c}\``).join(", ")} | ${unique} | ${val.type} |\n`;
        });
      }

      // 외래 키 정보
      if (foreignKeys.length > 0) {
        md += `\n### 외래 키\n\n`;
        md += `| 제약조건명 | 컬럼 | 참조 테이블 | 참조 컬럼 |\n`;
        md += `|------------|------|-------------|----------|\n`;

        foreignKeys.forEach((fk) => {
          md += `| \`${fk.CONSTRAINT_NAME}\` | \`${fk.COLUMN_NAME}\` | \`${fk.REFERENCED_TABLE_NAME}\` | \`${fk.REFERENCED_COLUMN_NAME}\` |\n`;
        });
      }

      md += `\n---\n\n`;
    }

    // 4. 파일 저장
    const outputPath = path.join(__dirname, "..", "documents", "db-schema.md");
    fs.writeFileSync(outputPath, md, "utf8");
    console.log(`\nSchema exported to: ${outputPath}`);
    console.log(`Total tables: ${tables.length}`);
  } catch (err) {
    console.error("Error exporting schema:", err.message);
    throw err;
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

exportSchema().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
