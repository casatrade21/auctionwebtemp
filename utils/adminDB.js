// utils/adminDB.js
const { pool } = require("./DB");
const fs = require("fs").promises;
const path = require("path");

async function getAdminSettings() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      "SELECT * FROM admin_settings WHERE id = 1"
    );
    if (rows.length > 0) {
      return {
        crawlSchedule: rows[0].crawl_schedule,
        requireLoginForFeatures: rows[0].require_login_for_features || false,
      };
    }
    return {
      crawlSchedule: null,
      requireLoginForFeatures: false,
    };
  } catch (error) {
    console.error("Error getting admin settings:", error);
    throw error;
  } finally {
    conn.release();
  }
}

async function updateAdminSettings(settings) {
  const conn = await pool.getConnection();
  try {
    const [currentSettings] = await conn.query(
      "SELECT * FROM admin_settings WHERE id = 1"
    );

    if (currentSettings.length === 0) {
      throw new Error("Admin settings not found");
    }

    const updates = [];
    const values = [];

    if (settings.crawlSchedule !== undefined) {
      updates.push("crawl_schedule = ?");
      values.push(settings.crawlSchedule);
    }

    if (settings.requireLoginForFeatures !== undefined) {
      updates.push("require_login_for_features = ?");
      values.push(settings.requireLoginForFeatures);
    }

    if (updates.length === 0) {
      return currentSettings[0];
    }

    values.push(1); // WHERE id = 1

    await conn.query(
      `UPDATE admin_settings SET ${updates.join(", ")} WHERE id = ?`,
      values
    );

    console.log("Admin settings updated successfully");

    // 업데이트된 설정 반환
    const [updatedRows] = await conn.query(
      "SELECT * FROM admin_settings WHERE id = 1"
    );

    return {
      crawlSchedule: updatedRows[0].crawl_schedule,
      requireLoginForFeatures:
        updatedRows[0].require_login_for_features || false,
    };
  } catch (error) {
    console.error("Error updating admin settings:", error);
    throw error;
  } finally {
    conn.release();
  }
}

// 이미지-URL 기반 공지사항 조회
async function getNotices() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(`
      SELECT id, title, image_url as imageUrl, target_url as targetUrl, 
             created_at as createdAt, updated_at as updatedAt 
      FROM notices 
      ORDER BY created_at DESC
    `);
    return rows;
  } catch (error) {
    console.error("Error getting notices:", error);
    throw error;
  } finally {
    conn.release();
  }
}

// 특정 공지사항 조회
async function getNoticeById(id) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `
      SELECT id, title, image_url as imageUrl, target_url as targetUrl, 
             created_at as createdAt, updated_at as updatedAt 
      FROM notices 
      WHERE id = ?
    `,
      [id]
    );
    return rows[0];
  } catch (error) {
    console.error("Error getting notice by id:", error);
    throw error;
  } finally {
    conn.release();
  }
}

// 이미지 파일 삭제 함수
async function deleteImageFile(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith("/images/notices/")) {
    return;
  }

  const imagePath = path.join(__dirname, "..", "public", imageUrl);
  try {
    await fs.unlink(imagePath);
    console.log(`Deleted image: ${imagePath}`);
  } catch (error) {
    console.error(`Error deleting image ${imagePath}:`, error);
    // 파일 삭제 실패는 무시하고 계속 진행
  }
}

// 공지사항 삭제
async function deleteNotice(id) {
  const conn = await pool.getConnection();
  try {
    const notice = await getNoticeById(id);
    if (!notice) {
      return false;
    }

    // 연결된 이미지 파일 삭제
    if (notice.imageUrl) {
      await deleteImageFile(notice.imageUrl);
    }

    const [result] = await conn.query("DELETE FROM notices WHERE id = ?", [id]);
    return result.affectedRows > 0;
  } catch (error) {
    console.error("Error deleting notice:", error);
    throw error;
  } finally {
    conn.release();
  }
}

// 새 공지사항 추가
async function addNotice(title, imageUrl, targetUrl = null) {
  const conn = await pool.getConnection();
  try {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    const [result] = await conn.query(
      "INSERT INTO notices (title, image_url, target_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [title, imageUrl, targetUrl, now, now]
    );

    return {
      id: result.insertId,
      title,
      imageUrl,
      targetUrl,
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    console.error("Error adding notice:", error);
    throw error;
  } finally {
    conn.release();
  }
}

// 공지사항 업데이트
async function updateNotice(id, title, imageUrl, targetUrl = null) {
  const conn = await pool.getConnection();
  try {
    const notice = await getNoticeById(id);
    if (!notice) {
      return null;
    }

    // 이미지가 변경된 경우 기존 이미지 파일 삭제
    if (notice.imageUrl && notice.imageUrl !== imageUrl) {
      await deleteImageFile(notice.imageUrl);
    }

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    const [result] = await conn.query(
      "UPDATE notices SET title = ?, image_url = ?, target_url = ?, updated_at = ? WHERE id = ?",
      [title, imageUrl, targetUrl, now, id]
    );

    return result.affectedRows > 0
      ? {
          id,
          title,
          imageUrl,
          targetUrl,
          updatedAt: now,
        }
      : null;
  } catch (error) {
    console.error("Error updating notice:", error);
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  getAdminSettings,
  updateAdminSettings,
  getNotices,
  getNoticeById,
  addNotice,
  updateNotice,
  deleteNotice,
};
