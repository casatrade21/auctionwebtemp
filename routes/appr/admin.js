// routes/appr/admin.js
const express = require("express");
const router = express.Router();
const { pool } = require("../../utils/DB");
const { isAuthenticated, isAdmin } = require("../../utils/middleware");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const {
  generateCertificateNumber,
  generateQRCode,
  processUploadedImages,
  ensureWatermarkOnExistingImages,
  isWatermarked,
  structureImageData,
} = require("../../utils/appr");
const {
  ensureCertificatePDF,
  createZipStream,
  DEFAULT_PDF_COORDINATES,
} = require("../../utils/pdfGenerator");

// Multer 설정 - 감정 이미지 저장
const appraisalStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "public/images/appraisals";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + uuidv4();
    cb(null, "appraisal-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const appraisalUpload = multer({
  storage: appraisalStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB 제한
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/pdf"
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "유효하지 않은 파일 형식입니다. 이미지 또는 PDF만 업로드 가능합니다.",
        ),
        false,
      );
    }
  },
});

// Multer 설정 - 복원 서비스 이미지 저장
const restorationStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "public/images/restorations";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + uuidv4();
    cb(null, "restoration-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const restorationUpload = multer({
  storage: restorationStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB 제한
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(
        new Error("유효하지 않은 파일 형식입니다. 이미지만 업로드 가능합니다."),
        false,
      );
    }
  },
});

const authenticityStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "public/images/authenticity";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + uuidv4();
    cb(null, "authenticity-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const authenticityUpload = multer({
  storage: authenticityStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 제한
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(
        new Error("유효하지 않은 파일 형식입니다. 이미지만 업로드 가능합니다."),
        false,
      );
    }
  },
});

// Multer 설정 - 배너 이미지 저장
const bannerStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "public/images/banners";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + uuidv4();
    cb(null, "banner-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const bannerUpload = multer({
  storage: bannerStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 제한
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(
        new Error("유효하지 않은 파일 형식입니다. 이미지만 업로드 가능합니다."),
        false,
      );
    }
  },
});

function normalizeImageData(images) {
  if (!images) return [];

  try {
    const parsed = JSON.parse(images);

    if (!Array.isArray(parsed)) return [];
    if (parsed.length === 0) return [];

    // 새 구조 확인 (첫 번째 요소가 객체이고 id 속성을 가짐)
    const isNewFormat = parsed.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof item.id === "string" &&
        typeof item.url === "string",
    );

    if (isNewFormat) {
      // 새 구조인 경우 order 필드 보장
      return parsed.map((item, index) => ({
        id: item.id,
        url: item.url,
        order: typeof item.order === "number" ? item.order : index,
      }));
    }

    // Legacy 구조 (문자열 배열) 변환
    const isLegacyFormat = parsed.every((item) => typeof item === "string");

    if (isLegacyFormat) {
      return parsed.map((url, index) => ({
        id: `legacy-${uuidv4()}-${index}`, // UUID 사용으로 중복 방지
        url: url,
        order: index,
      }));
    }

    console.warn("인식할 수 없는 이미지 데이터 형식:", parsed);
    return [];
  } catch (error) {
    console.error("이미지 데이터 파싱 오류:", error);
    return [];
  }
}

// 배너 목록 조회 - GET /api/appr/admin/banners
router.get("/banners", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();

    const [rows] = await conn.query(
      "SELECT * FROM main_banners ORDER BY display_order ASC, created_at DESC",
    );

    res.json({
      success: true,
      banners: rows,
    });
  } catch (err) {
    console.error("배너 목록 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "배너 목록 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 배너 추가 - POST /api/appr/admin/banners
router.post(
  "/banners",
  isAuthenticated,
  isAdmin,
  bannerUpload.single("banner_image"),
  async (req, res) => {
    let conn;
    try {
      const {
        title,
        subtitle,
        description,
        button_text,
        button_link,
        display_order,
        is_active,
      } = req.body;

      let banner_image = null;
      if (req.file) {
        banner_image = `/images/banners/${req.file.filename}`;
      }

      conn = await pool.getConnection();

      const banner_id = uuidv4();

      await conn.query(
        `INSERT INTO main_banners (
          id, title, subtitle, description, banner_image,
          button_text, button_link, display_order, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          banner_id,
          title?.trim() || null,
          subtitle?.trim() || null,
          description.trim(),
          banner_image,
          button_text?.trim() || null,
          button_link?.trim() || null,
          parseInt(display_order) || 0,
          is_active === "true" || is_active === true,
        ],
      );

      res.status(201).json({
        success: true,
        banner: {
          id: banner_id,
          title: title?.trim() || null,
          subtitle: subtitle?.trim() || null,
          description: description.trim(),
          banner_image,
          button_text: button_text?.trim() || null,
          button_link: button_link?.trim() || null,
          display_order: parseInt(display_order) || 0,
          is_active: is_active === "true" || is_active === true,
        },
      });
    } catch (err) {
      console.error("배너 추가 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "배너 추가 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 배너 수정 - PUT /api/appr/admin/banners/:id
router.put(
  "/banners/:id",
  isAuthenticated,
  isAdmin,
  bannerUpload.single("banner_image"),
  async (req, res) => {
    let conn;
    try {
      const banner_id = req.params.id;
      const {
        title,
        subtitle,
        description,
        button_text,
        button_link,
        display_order,
        is_active,
      } = req.body;

      conn = await pool.getConnection();

      // 배너 존재 여부 확인
      const [bannerRows] = await conn.query(
        "SELECT * FROM main_banners WHERE id = ?",
        [banner_id],
      );

      if (bannerRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 배너를 찾을 수 없습니다.",
        });
      }

      const banner = bannerRows[0];
      let banner_image = banner.banner_image;

      // 새 이미지가 업로드된 경우
      if (req.file) {
        banner_image = `/images/banners/${req.file.filename}`;
      }

      // 업데이트할 필드 구성
      const updateData = {};
      const updateFields = [];
      const updateValues = [];

      if (title !== undefined) {
        updateFields.push("title = ?");
        updateValues.push(title);
        updateData.title = title;
      }

      if (subtitle !== undefined) {
        updateFields.push("subtitle = ?");
        updateValues.push(subtitle);
        updateData.subtitle = subtitle;
      }

      if (description !== undefined) {
        updateFields.push("description = ?");
        updateValues.push(description);
        updateData.description = description;
      }

      if (banner_image !== banner.banner_image) {
        updateFields.push("banner_image = ?");
        updateValues.push(banner_image);
        updateData.banner_image = banner_image;
      }

      if (button_text !== undefined) {
        updateFields.push("button_text = ?");
        updateValues.push(button_text);
        updateData.button_text = button_text;
      }

      if (button_link !== undefined) {
        updateFields.push("button_link = ?");
        updateValues.push(button_link);
        updateData.button_link = button_link;
      }

      if (display_order !== undefined) {
        updateFields.push("display_order = ?");
        updateValues.push(parseInt(display_order));
        updateData.display_order = parseInt(display_order);
      }

      if (is_active !== undefined) {
        updateFields.push("is_active = ?");
        updateValues.push(is_active === "true" || is_active === true);
        updateData.is_active = is_active === "true" || is_active === true;
      }

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: "업데이트할 정보가 없습니다.",
        });
      }

      // 업데이트 쿼리 실행
      const query = `UPDATE main_banners SET ${updateFields.join(
        ", ",
      )} WHERE id = ?`;
      updateValues.push(banner_id);

      await conn.query(query, updateValues);

      res.json({
        success: true,
        banner: {
          id: banner_id,
          ...banner,
          ...updateData,
        },
      });
    } catch (err) {
      console.error("배너 수정 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "배너 수정 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 배너 삭제 - DELETE /api/appr/admin/banners/:id
router.delete("/banners/:id", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const banner_id = req.params.id;

    conn = await pool.getConnection();

    // 배너 존재 여부 확인
    const [bannerRows] = await conn.query(
      "SELECT * FROM main_banners WHERE id = ?",
      [banner_id],
    );

    if (bannerRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 배너를 찾을 수 없습니다.",
      });
    }

    // 배너 삭제
    await conn.query("DELETE FROM main_banners WHERE id = ?", [banner_id]);

    res.json({
      success: true,
      message: "배너가 삭제되었습니다.",
    });
  } catch (err) {
    console.error("배너 삭제 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "배너 삭제 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 회원 목록 조회 - GET /api/appr/admin/users
router.get("/users", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    conn = await pool.getConnection();

    let queryParams = [];
    let query = `
      SELECT u.id, u.email, u.company_name, u.phone, u.created_at,
        a.tier, a.quick_link_credits_remaining, a.quick_link_monthly_limit,
        a.quick_link_subscription_type, a.quick_link_subscription_expires_at
      FROM users u
      LEFT JOIN appr_users a ON u.id = a.user_id
      WHERE 1=1
    `;

    // 검색 조건 추가
    if (search) {
      query += " AND (u.id LIKE ? OR u.email LIKE ? OR u.company_name LIKE ?)";
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern, searchPattern);
    }

    // 정렬 및 페이지네이션
    query += " ORDER BY u.created_at DESC LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    const [rows] = await conn.query(query, queryParams);

    // 전체 개수 조회
    let countQuery = "SELECT COUNT(*) as total FROM users u WHERE 1=1";
    const countParams = [];

    if (search) {
      countQuery +=
        " AND (u.id LIKE ? OR u.email LIKE ? OR u.company_name LIKE ?)";
      const searchPattern = `%${search}%`;
      countParams.push(searchPattern, searchPattern, searchPattern);
    }

    const [countResult] = await conn.query(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      users: rows,
      pagination: {
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
        currentPage: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("회원 목록 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "회원 목록 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 회원 정보 수정 - PUT /api/appr/admin/users/:id
router.put("/users/:id", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const user_id = req.params.id;
    const {
      tier,
      quick_link_credits_remaining,
      quick_link_monthly_limit,
      offline_appraisal_fee,
      quick_link_subscription_type,
      quick_link_subscription_expires_at,
    } = req.body;

    conn = await pool.getConnection();

    // 사용자 존재 여부 확인
    const [userRows] = await conn.query("SELECT * FROM users WHERE id = ?", [
      user_id,
    ]);

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    // appr_users 테이블에 사용자 존재 여부 확인
    const [apprUserRows] = await conn.query(
      "SELECT * FROM appr_users WHERE user_id = ?",
      [user_id],
    );

    if (apprUserRows.length === 0) {
      // 새 사용자 등록
      await conn.query(
        `INSERT INTO appr_users (
          user_id, tier, quick_link_credits_remaining, quick_link_monthly_limit,
          quick_link_subscription_type, quick_link_subscription_expires_at, offline_appraisal_fee
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          user_id,
          tier || "일반회원",
          quick_link_credits_remaining || 0,
          quick_link_monthly_limit || 0,
          quick_link_subscription_type || "free",
          quick_link_subscription_expires_at || null,
          offline_appraisal_fee || 38000,
        ],
      );
    } else {
      // 기존 사용자 정보 업데이트
      let updateQuery = "UPDATE appr_users SET ";
      const updateParams = [];
      const updates = [];

      if (tier !== undefined) {
        updates.push("tier = ?");
        updateParams.push(tier);
      }

      if (quick_link_credits_remaining !== undefined) {
        updates.push("quick_link_credits_remaining = ?");
        updateParams.push(quick_link_credits_remaining);
      }

      if (quick_link_monthly_limit !== undefined) {
        updates.push("quick_link_monthly_limit = ?");
        updateParams.push(quick_link_monthly_limit);
      }

      if (offline_appraisal_fee !== undefined) {
        updates.push("offline_appraisal_fee = ?");
        updateParams.push(offline_appraisal_fee);
      }

      if (quick_link_subscription_type !== undefined) {
        updates.push("quick_link_subscription_type = ?");
        updateParams.push(quick_link_subscription_type);
      }
      if (quick_link_subscription_expires_at !== undefined) {
        updates.push("quick_link_subscription_expires_at = ?");
        updateParams.push(quick_link_subscription_expires_at);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: "업데이트할 정보가 없습니다.",
        });
      }

      updateQuery += updates.join(", ") + " WHERE user_id = ?";
      updateParams.push(user_id);

      await conn.query(updateQuery, updateParams);
    }

    // 업데이트된 사용자 정보 조회
    const [updatedRows] = await conn.query(
      `SELECT u.id, u.email, u.company_name, u.phone,
        a.tier, a.quick_link_credits_remaining, a.quick_link_monthly_limit,
        a.quick_link_subscription_type, a.quick_link_subscription_expires_at, a.offline_appraisal_fee
      FROM users u
      JOIN appr_users a ON u.id = a.user_id
      WHERE u.id = ?`,
      [user_id],
    );

    res.json({
      success: true,
      user: updatedRows[0],
    });
  } catch (err) {
    console.error("회원 정보 수정 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "회원 정보 수정 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 관리자 감정 생성 - POST /api/appr/admin/appraisals
router.post(
  "/appraisals",
  isAuthenticated,
  isAdmin,
  appraisalUpload.array("images", 20),
  async (req, res) => {
    let conn;
    try {
      const {
        user_id,
        appraisal_type,
        brand,
        model_name,
        category,
        remarks,
        product_link,
        platform,
        purchase_year,
        components_included,
        delivery_info,
        certificate_number,
      } = req.body;

      if (!user_id || !appraisal_type || !brand || !model_name || !category) {
        return res.status(400).json({
          success: false,
          message: "필수 입력 항목이 누락되었습니다.",
        });
      }

      conn = await pool.getConnection();

      const [userRows] = await conn.query("SELECT id FROM users WHERE id = ?", [
        user_id,
      ]);

      if (userRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 사용자를 찾을 수 없습니다.",
        });
      }

      // ✅ 새 구조로 이미지 처리 - utils/appr.js와 동일한 방식 사용
      let finalImages = [];
      if (req.files && req.files.length > 0) {
        const imageUrls = await processUploadedImages(
          req.files,
          path.join(__dirname, "../../public/images/appraisals"),
          { skipExisting: true },
        );

        // ✅ 통일된 방식으로 구조화
        finalImages = structureImageData(imageUrls);
      }

      const finalCertificateNumber = await generateCertificateNumber(
        conn,
        certificate_number,
      );

      await conn.query(
        `INSERT INTO appraisals (
        user_id, appraisal_type, brand, model_name, category, 
        remarks, product_link, platform, purchase_year, 
        components_included, delivery_info, status, result,
        certificate_number, images
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user_id,
          appraisal_type,
          brand,
          model_name,
          category,
          remarks || null,
          product_link || null,
          platform || null,
          purchase_year || null,
          components_included ? JSON.stringify(components_included) : null,
          delivery_info ? JSON.stringify(delivery_info) : null,
          "pending",
          "pending",
          finalCertificateNumber,
          // ✅ 통일된 방식으로 저장 (utils/appr.js와 동일)
          finalImages.length > 0 ? JSON.stringify(finalImages) : null,
        ],
      );

      const [createdAppraisal] = await conn.query(
        `SELECT a.*, u.email as user_email, u.company_name
       FROM appraisals a
       JOIN users u ON a.user_id = u.id
       WHERE a.certificate_number = ?`,
        [finalCertificateNumber],
      );

      res.status(201).json({
        success: true,
        appraisal: createdAppraisal[0],
      });
    } catch (err) {
      console.error("관리자 감정 생성 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: err.message || "감정 생성 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 전체 감정 목록 조회 - GET /api/appr/admin/appraisals
router.get("/appraisals", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const { page = 1, limit = 20, status, result, type, search } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    conn = await pool.getConnection();

    let query = `
      SELECT 
        a.id, a.user_id, a.appraisal_type, a.status, a.brand, a.model_name,
        a.category, a.result, a.certificate_number, a.created_at,
        u.email as user_email, u.company_name as company_name, u.login_id as user_login_id,
        a.images
      FROM appraisals a
      JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;

    const queryParams = [];

    // 필터 적용 (기존과 동일)
    if (status) {
      query += " AND a.status = ?";
      queryParams.push(status);
    }

    if (result) {
      query += " AND a.result = ?";
      queryParams.push(result);
    }

    if (type) {
      query += " AND a.appraisal_type = ?";
      queryParams.push(type);
    }

    if (search) {
      query +=
        " AND (a.brand LIKE ? OR a.model_name LIKE ? OR a.user_id LIKE ? OR a.certificate_number LIKE ? OR u.login_id LIKE ? OR u.company_name LIKE ?)";
      const searchPattern = `%${search}%`;
      queryParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
      );
    }

    query += " ORDER BY a.created_at DESC LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    const [rows] = await conn.query(query, queryParams);

    // ✅ 대표 이미지 추출 시 호환성 처리
    const processedRows = rows.map((row) => {
      const normalizedImages = normalizeImageData(row.images);
      return {
        ...row,
        representative_image:
          normalizedImages.length > 0 ? normalizedImages[0] : null,
      };
    });

    // 전체 개수 조회 (기존과 동일)
    let countQuery =
      "SELECT COUNT(*) as total FROM appraisals a JOIN users u ON a.user_id = u.id WHERE 1=1";
    const countParams = [];

    if (status) {
      countQuery += " AND a.status = ?";
      countParams.push(status);
    }

    if (result) {
      countQuery += " AND a.result = ?";
      countParams.push(result);
    }

    if (type) {
      countQuery += " AND a.appraisal_type = ?";
      countParams.push(type);
    }

    if (search) {
      countQuery +=
        " AND (a.brand LIKE ? OR a.model_name LIKE ? OR a.user_id LIKE ? OR a.certificate_number LIKE ? OR u.login_id LIKE ? OR u.company_name LIKE ?)";
      const searchPattern = `%${search}%`;
      countParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
      );
    }

    const [countResult] = await conn.query(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      appraisals: processedRows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("감정 목록 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "감정 목록 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 감정 삭제 - DELETE /api/appr/admin/appraisals (다중/단일 삭제 통합)
router.delete("/appraisals", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const { ids } = req.body;

    // 입력 검증
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "삭제할 감정 ID 목록이 필요합니다.",
      });
    }

    // ID 개수 제한 (안전을 위해)
    if (ids.length > 100) {
      return res.status(400).json({
        success: false,
        message: "한 번에 최대 100개까지만 삭제할 수 있습니다.",
      });
    }

    conn = await pool.getConnection();

    // 감정 정보들 조회 (존재 여부 확인 및 관련 정보 수집)
    const placeholders = ids.map(() => "?").join(", ");
    const [appraisalRows] = await conn.query(
      `SELECT * FROM appraisals WHERE id IN (${placeholders})`,
      ids,
    );

    if (appraisalRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "삭제할 감정 정보를 찾을 수 없습니다.",
      });
    }

    // 실제로 존재하는 감정 ID들만 추출
    const foundIds = appraisalRows.map((appraisal) => appraisal.id);
    const notFoundIds = ids.filter((id) => !foundIds.includes(id));

    // 트랜잭션 시작
    await conn.beginTransaction();

    let deletedCount = 0;
    let creditRestoredCount = 0;
    let relatedRestorationsDeleted = 0;
    const deletedAppraisals = [];
    const filesToDelete = []; // 나중에 삭제할 파일들

    try {
      for (const appraisal of appraisalRows) {
        // 1. 관련 복원 요청이 있는지 확인하고 삭제
        const [restorationRequests] = await conn.query(
          "SELECT id FROM restoration_requests WHERE appraisal_id = ?",
          [appraisal.id],
        );

        if (restorationRequests.length > 0) {
          // 복원 요청도 함께 삭제
          await conn.query(
            "DELETE FROM restoration_requests WHERE appraisal_id = ?",
            [appraisal.id],
          );
          relatedRestorationsDeleted += restorationRequests.length;
        }

        // 2. 결제 정보가 있는지 확인하고 관련 리소스 정보 업데이트
        await conn.query(
          `UPDATE payments 
           SET related_resource_id = NULL, related_resource_type = NULL 
           WHERE related_resource_id = ? AND related_resource_type = 'appraisal'`,
          [appraisal.id],
        );

        // 3. 크레딧이 차감된 경우 복구 (퀵링크만)
        if (
          appraisal.credit_deducted &&
          appraisal.appraisal_type === "quicklink"
        ) {
          const [userRows] = await conn.query(
            "SELECT * FROM appr_users WHERE user_id = ?",
            [appraisal.user_id],
          );

          if (userRows.length > 0) {
            // 크레딧 1개 복구
            await conn.query(
              "UPDATE appr_users SET quick_link_credits_remaining = quick_link_credits_remaining + 1 WHERE user_id = ?",
              [appraisal.user_id],
            );
            creditRestoredCount++;
          }
        }

        // 4. 감정 정보 삭제
        await conn.query("DELETE FROM appraisals WHERE id = ?", [appraisal.id]);
        deletedCount++;

        // 5. 삭제된 감정 정보 저장
        deletedAppraisals.push({
          id: appraisal.id,
          certificate_number: appraisal.certificate_number,
          brand: appraisal.brand,
          model_name: appraisal.model_name,
          user_id: appraisal.user_id,
          appraisal_type: appraisal.appraisal_type,
        });

        // 6. 삭제할 파일 목록에 추가
        // 이미지 파일들
        if (appraisal.images) {
          try {
            const normalizedImages = normalizeImageData(appraisal.images);
            normalizedImages.forEach((img) => {
              if (img.url) {
                filesToDelete.push(
                  path.join(__dirname, "../../public", img.url),
                );
              }
            });
          } catch (error) {
            console.error("이미지 처리 오류:", error);
          }
        }

        // PDF 파일
        if (appraisal.certificate_url) {
          filesToDelete.push(
            path.join(__dirname, "../../public", appraisal.certificate_url),
          );
        }

        // QR 코드 파일
        if (appraisal.qrcode_url) {
          filesToDelete.push(
            path.join(__dirname, "../../public", appraisal.qrcode_url),
          );
        }
      }

      // 트랜잭션 커밋
      await conn.commit();

      // 7. 관련 파일 삭제 (비동기로 처리하여 응답 속도 개선)
      setImmediate(() => {
        filesToDelete.forEach((filePath) => {
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (fileError) {
            console.error(`파일 삭제 중 오류 (${filePath}):`, fileError);
            // 파일 삭제 실패는 로그만 남기고 계속 진행
          }
        });
      });

      // 응답 구성
      const responseMessage =
        ids.length === 1
          ? "감정 정보가 성공적으로 삭제되었습니다."
          : `${deletedCount}개의 감정 정보가 성공적으로 삭제되었습니다.`;

      const response = {
        success: true,
        message: responseMessage,
        summary: {
          requested_count: ids.length,
          deleted_count: deletedCount,
          credit_restored_count: creditRestoredCount,
          related_restorations_deleted: relatedRestorationsDeleted,
          files_scheduled_for_deletion: filesToDelete.length,
        },
        deleted_appraisals: deletedAppraisals,
      };

      // 찾지 못한 ID가 있는 경우 추가 정보 제공
      if (notFoundIds.length > 0) {
        response.not_found_ids = notFoundIds;
        response.message += ` (${notFoundIds.length}개 ID를 찾을 수 없어 건너뛰었습니다.)`;
      }

      res.json(response);
    } catch (error) {
      // 트랜잭션 롤백
      await conn.rollback();
      throw error;
    }
  } catch (err) {
    console.error("감정 삭제 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: err.message || "감정 삭제 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 복원 서비스 목록 조회 - GET /api/appr/admin/restoration-services
router.get(
  "/restoration-services",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    let conn;
    try {
      conn = await pool.getConnection();

      const [rows] = await conn.query(
        "SELECT * FROM restoration_services ORDER BY name ASC",
      );

      res.json({
        success: true,
        services: rows,
      });
    } catch (err) {
      console.error("복원 서비스 목록 조회 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "복원 서비스 목록 조회 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 복원 서비스 추가 - POST /api/appr/admin/restoration-services
router.post(
  "/restoration-services",
  isAuthenticated,
  isAdmin,
  restorationUpload.fields([
    { name: "before_image", maxCount: 1 },
    { name: "after_image", maxCount: 1 },
  ]),
  async (req, res) => {
    let conn;
    try {
      const { name, description, price, estimated_days } = req.body;

      // 필수 필드 검증
      if (!name || !description || !price || !estimated_days) {
        return res.status(400).json({
          success: false,
          message: "필수 입력 항목이 누락되었습니다.",
        });
      }

      let before_image = null;
      let after_image = null;

      // 이미지 처리
      if (req.files) {
        if (req.files.before_image && req.files.before_image.length > 0) {
          before_image = `/images/restorations/${req.files.before_image[0].filename}`;
        }

        if (req.files.after_image && req.files.after_image.length > 0) {
          after_image = `/images/restorations/${req.files.after_image[0].filename}`;
        }
      }

      conn = await pool.getConnection();

      // 서비스 ID 생성
      const service_id = uuidv4();

      // 서비스 정보 저장 - price와 estimated_days 모두 문자열로 저장
      await conn.query(
        `INSERT INTO restoration_services (
        id, name, description, price, estimated_days,
        before_image, after_image, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          service_id,
          name,
          description,
          price, // 문자열로 저장
          estimated_days, // 문자열로 저장 (변경됨)
          before_image,
          after_image,
          true,
        ],
      );

      res.status(201).json({
        success: true,
        service: {
          id: service_id,
          name,
          description,
          price: price,
          estimated_days: estimated_days, // 문자열로 반환
          before_image,
          after_image,
          is_active: true,
        },
      });
    } catch (err) {
      console.error("복원 서비스 추가 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "복원 서비스 추가 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 복원 서비스 수정 - PUT /api/appr/admin/restoration-services/:id
router.put(
  "/restoration-services/:id",
  isAuthenticated,
  isAdmin,
  restorationUpload.fields([
    { name: "before_image", maxCount: 1 },
    { name: "after_image", maxCount: 1 },
  ]),
  async (req, res) => {
    let conn;
    try {
      const service_id = req.params.id;
      const { name, description, price, estimated_days } = req.body;

      conn = await pool.getConnection();

      // 서비스 존재 여부 확인
      const [serviceRows] = await conn.query(
        "SELECT * FROM restoration_services WHERE id = ?",
        [service_id],
      );

      if (serviceRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 복원 서비스를 찾을 수 없습니다.",
        });
      }

      const service = serviceRows[0];
      let before_image = service.before_image;
      let after_image = service.after_image;

      // 이미지 처리
      if (req.files) {
        if (req.files.before_image && req.files.before_image.length > 0) {
          before_image = `/images/restorations/${req.files.before_image[0].filename}`;
        }

        if (req.files.after_image && req.files.after_image.length > 0) {
          after_image = `/images/restorations/${req.files.after_image[0].filename}`;
        }
      }

      // 업데이트할 필드 구성
      const updateData = {};
      const updateFields = [];
      const updateValues = [];

      if (name) {
        updateFields.push("name = ?");
        updateValues.push(name);
        updateData.name = name;
      }

      if (description) {
        updateFields.push("description = ?");
        updateValues.push(description);
        updateData.description = description;
      }

      if (price) {
        updateFields.push("price = ?");
        updateValues.push(price); // 문자열로 저장
        updateData.price = price;
      }

      if (estimated_days) {
        updateFields.push("estimated_days = ?");
        updateValues.push(estimated_days); // 문자열로 저장 (변경됨)
        updateData.estimated_days = estimated_days;
      }

      if (before_image !== service.before_image) {
        updateFields.push("before_image = ?");
        updateValues.push(before_image);
        updateData.before_image = before_image;
      }

      if (after_image !== service.after_image) {
        updateFields.push("after_image = ?");
        updateValues.push(after_image);
        updateData.after_image = after_image;
      }

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: "업데이트할 정보가 없습니다.",
        });
      }

      // 업데이트 쿼리 실행
      const query = `UPDATE restoration_services SET ${updateFields.join(
        ", ",
      )} WHERE id = ?`;
      updateValues.push(service_id);

      await conn.query(query, updateValues);

      res.json({
        success: true,
        service: {
          id: service_id,
          ...service,
          ...updateData,
        },
      });
    } catch (err) {
      console.error("복원 서비스 수정 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "복원 서비스 수정 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 복원 서비스 비활성화 - DELETE /api/appr/admin/restoration-services/:id
router.delete(
  "/restoration-services/:id",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    let conn;
    try {
      const service_id = req.params.id;

      conn = await pool.getConnection();

      // 서비스 존재 여부 확인
      const [serviceRows] = await conn.query(
        "SELECT * FROM restoration_services WHERE id = ?",
        [service_id],
      );

      if (serviceRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 복원 서비스를 찾을 수 없습니다.",
        });
      }

      // 서비스 비활성화 (실제 삭제하지 않음)
      await conn.query(
        "UPDATE restoration_services SET is_active = ? WHERE id = ?",
        [false, service_id],
      );

      res.json({
        success: true,
        message: "복원 서비스가 비활성화되었습니다.",
      });
    } catch (err) {
      console.error("복원 서비스 비활성화 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "복원 서비스 비활성화 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 전체 복원 요청 목록 조회 - GET /api/appr/admin/restorations
router.get("/restorations", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const { page = 1, limit = 20, status, search } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    conn = await pool.getConnection();

    let query = `
      SELECT 
        r.id, r.appraisal_id, r.status, r.total_price, 
        r.created_at, r.estimated_completion_date, r.completed_at,
        a.brand, a.model_name,
        u.id as user_id, u.email as user_email, u.company_name, u.login_id as user_login_id
      FROM restoration_requests r
      JOIN appraisals a ON r.appraisal_id = a.id
      JOIN users u ON r.user_id = u.id
      WHERE 1=1
    `;

    const queryParams = [];

    // 상태 필터 적용
    if (status) {
      query += " AND r.status = ?";
      queryParams.push(status);
    }

    // 검색 조건 추가
    if (search) {
      query +=
        " AND (a.brand LIKE ? OR a.model_name LIKE ? OR u.id LIKE ? OR u.email LIKE ? OR u.login_id LIKE ? OR u.company_name LIKE ?)";
      const searchPattern = `%${search}%`;
      queryParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
      );
    }

    // 최신순 정렬 및 페이지네이션
    query += " ORDER BY r.created_at DESC LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    const [rows] = await conn.query(query, queryParams);

    // 전체 개수 조회
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM restoration_requests r
      JOIN appraisals a ON r.appraisal_id = a.id
      JOIN users u ON r.user_id = u.id
      WHERE 1=1
    `;

    const countParams = [];

    if (status) {
      countQuery += " AND r.status = ?";
      countParams.push(status);
    }

    if (search) {
      countQuery +=
        " AND (a.brand LIKE ? OR a.model_name LIKE ? OR u.id LIKE ? OR u.email LIKE ? OR u.login_id LIKE ? OR u.company_name LIKE ?)";
      const searchPattern = `%${search}%`;
      countParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
      );
    }

    const [countResult] = await conn.query(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      restorations: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("복원 요청 목록 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "복원 요청 목록 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 복원 요청 상세 정보 조회 - GET /api/appr/admin/restorations/:id
router.get("/restorations/:id", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const restoration_id = req.params.id;

    conn = await pool.getConnection();

    const [rows] = await conn.query(
      `SELECT r.*, a.brand, a.model_name, a.category, a.images as appraisal_images,
        u.email as user_email, u.company_name
      FROM restoration_requests r
      JOIN appraisals a ON r.appraisal_id = a.id
      JOIN users u ON r.user_id = u.id
      WHERE r.id = ?`,
      [restoration_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 복원 요청 정보를 찾을 수 없습니다.",
      });
    }

    // JSON 데이터 파싱
    const restoration = rows[0];
    if (restoration.services) {
      restoration.services = JSON.parse(restoration.services);
    }
    if (restoration.delivery_info) {
      restoration.delivery_info = JSON.parse(restoration.delivery_info);
    }
    if (restoration.images) {
      restoration.images = JSON.parse(restoration.images);
    }
    if (restoration.appraisal_images) {
      restoration.appraisal_images = JSON.parse(restoration.appraisal_images);
    }

    // 감정 정보 포맷팅
    const appraisal = {
      id: restoration.appraisal_id,
      brand: restoration.brand,
      model_name: restoration.model_name,
      category: restoration.category,
      images: restoration.appraisal_images,
    };

    // 불필요한 필드 제거
    delete restoration.brand;
    delete restoration.model_name;
    delete restoration.category;
    delete restoration.appraisal_images;

    // 응답 구성
    restoration.appraisal = appraisal;

    res.json({
      success: true,
      restoration,
    });
  } catch (err) {
    console.error("복원 요청 상세 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "복원 요청 상세 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 복원 상태 및 이미지 업데이트 - PUT /api/appr/admin/restorations/:id
router.put(
  "/restorations/:id",
  isAuthenticated,
  isAdmin,
  restorationUpload.fields([
    { name: "before_images", maxCount: 10 },
    { name: "after_images", maxCount: 10 },
    { name: "progress_images", maxCount: 10 },
  ]),
  async (req, res) => {
    let conn;
    try {
      const restoration_id = req.params.id;
      const {
        status,
        estimated_completion_date,
        completed_at,
        services: servicesJSON,
      } = req.body;

      conn = await pool.getConnection();

      // 복원 요청 정보 조회
      const [restorationRows] = await conn.query(
        "SELECT * FROM restoration_requests WHERE id = ?",
        [restoration_id],
      );

      if (restorationRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 복원 요청 정보를 찾을 수 없습니다.",
        });
      }

      const restoration = restorationRows[0];
      let existingImages = restoration.images
        ? JSON.parse(restoration.images)
        : { before: [], after: [], progress: [] };
      let services = restoration.services
        ? JSON.parse(restoration.services)
        : [];

      // 이미지 처리
      if (req.files) {
        if (req.files.before_images) {
          const newBeforeImages = req.files.before_images.map(
            (file) => `/images/restorations/${file.filename}`,
          );
          existingImages.before = [
            ...(existingImages.before || []),
            ...newBeforeImages,
          ];
        }

        if (req.files.after_images) {
          const newAfterImages = req.files.after_images.map(
            (file) => `/images/restorations/${file.filename}`,
          );
          existingImages.after = [
            ...(existingImages.after || []),
            ...newAfterImages,
          ];
        }

        if (req.files.progress_images) {
          const newProgressImages = req.files.progress_images.map(
            (file) => `/images/restorations/${file.filename}`,
          );
          existingImages.progress = [
            ...(existingImages.progress || []),
            ...newProgressImages,
          ];
        }
      }

      // 서비스 상태 업데이트
      if (servicesJSON) {
        try {
          const updatedServices = JSON.parse(servicesJSON);

          // 서비스 ID를 기반으로 기존 서비스 업데이트
          services = services.map((service) => {
            const updatedService = updatedServices.find(
              (s) => s.service_id === service.service_id,
            );
            if (updatedService && updatedService.status) {
              return { ...service, status: updatedService.status };
            }
            return service;
          });
        } catch (error) {
          console.error("서비스 JSON 파싱 오류:", error);
        }
      }

      // 업데이트할 필드 구성
      const updateData = {};
      const updateFields = [];
      const updateValues = [];

      if (status) {
        updateFields.push("status = ?");
        updateValues.push(status);
        updateData.status = status;

        // 완료 상태로 변경 시 완료 시간 자동 설정
        if (status === "completed" && !completed_at) {
          updateFields.push("completed_at = NOW()");
          updateData.completed_at = new Date();
        }
      }

      if (estimated_completion_date) {
        updateFields.push("estimated_completion_date = ?");
        updateValues.push(estimated_completion_date);
        updateData.estimated_completion_date = estimated_completion_date;
      }

      if (completed_at) {
        updateFields.push("completed_at = ?");
        updateValues.push(completed_at);
        updateData.completed_at = completed_at;
      }

      if (services.length > 0) {
        updateFields.push("services = ?");
        updateValues.push(JSON.stringify(services));
        updateData.services = services;
      }

      updateFields.push("images = ?");
      updateValues.push(JSON.stringify(existingImages));
      updateData.images = existingImages;

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: "업데이트할 정보가 없습니다.",
        });
      }

      // 업데이트 쿼리 실행
      const query = `UPDATE restoration_requests SET ${updateFields.join(
        ", ",
      )} WHERE id = ?`;
      updateValues.push(restoration_id);

      await conn.query(query, updateValues);

      res.json({
        success: true,
        restoration: {
          id: restoration_id,
          status: updateData.status || restoration.status,
          estimated_completion_date:
            updateData.estimated_completion_date ||
            restoration.estimated_completion_date,
          services: updateData.services || services,
          images: existingImages,
        },
      });
    } catch (err) {
      console.error("복원 상태 업데이트 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "복원 상태 업데이트 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 결제 내역 조회 - GET /api/appr/admin/payments
router.get("/payments", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const {
      page = 1,
      limit = 20,
      status,
      type,
      startDate,
      endDate,
      search,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    conn = await pool.getConnection();

    let query = `
      SELECT 
        p.id, p.user_id, p.order_id, p.product_type, p.product_name,
        p.amount, p.status, p.payment_method, p.paid_at, p.created_at,
        u.email as user_email, u.company_name
      FROM payments p
      JOIN users u ON p.user_id = u.id
      WHERE 1=1
    `;

    const queryParams = [];

    // 상태 필터 적용
    if (status) {
      query += " AND p.status = ?";
      queryParams.push(status);
    }

    // 상품 유형 필터 적용
    if (type) {
      query += " AND p.product_type = ?";
      queryParams.push(type);
    }

    // 날짜 범위 필터
    if (startDate) {
      query += " AND DATE(p.created_at) >= ?";
      queryParams.push(startDate);
    }

    if (endDate) {
      query += " AND DATE(p.created_at) <= ?";
      queryParams.push(endDate);
    }

    // 검색 조건 추가
    if (search) {
      query +=
        " AND (p.order_id LIKE ? OR p.product_name LIKE ? OR p.user_id LIKE ? OR u.email LIKE ?)";
      const searchPattern = `%${search}%`;
      queryParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
      );
    }

    // 최신순 정렬 및 페이지네이션
    query += " ORDER BY p.created_at DESC LIMIT ? OFFSET ?";
    queryParams.push(parseInt(limit), offset);

    const [rows] = await conn.query(query, queryParams);

    // 전체 개수 조회
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM payments p
      JOIN users u ON p.user_id = u.id
      WHERE 1=1
    `;

    const countParams = [];

    if (status) {
      countQuery += " AND p.status = ?";
      countParams.push(status);
    }

    if (type) {
      countQuery += " AND p.product_type = ?";
      countParams.push(type);
    }

    if (startDate) {
      countQuery += " AND DATE(p.created_at) >= ?";
      countParams.push(startDate);
    }

    if (endDate) {
      countQuery += " AND DATE(p.created_at) <= ?";
      countParams.push(endDate);
    }

    if (search) {
      countQuery +=
        " AND (p.order_id LIKE ? OR p.product_name LIKE ? OR p.user_id LIKE ? OR u.email LIKE ?)";
      const searchPattern = `%${search}%`;
      countParams.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
      );
    }

    const [countResult] = await conn.query(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      payments: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("결제 내역 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "결제 내역 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 결제 상세 정보 조회 - GET /api/appr/admin/payments/:id
router.get("/payments/:id", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const payment_id = req.params.id;

    conn = await pool.getConnection();

    const [rows] = await conn.query(
      `SELECT p.*, u.email as user_email, u.company_name
      FROM payments p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?`,
      [payment_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 결제 정보를 찾을 수 없습니다.",
      });
    }

    const payment = rows[0];

    // 관련 리소스 정보 조회 (연관된 리소스가 있는 경우)
    let relatedResource = null;

    if (payment.related_resource_id && payment.related_resource_type) {
      if (payment.related_resource_type === "appraisal") {
        const [appraisalRows] = await conn.query(
          "SELECT id, brand, model_name, appraisal_type, status, result FROM appraisals WHERE id = ?",
          [payment.related_resource_id],
        );

        if (appraisalRows.length > 0) {
          relatedResource = {
            type: "appraisal",
            data: appraisalRows[0],
          };
        }
      } else if (payment.related_resource_type === "restoration") {
        const [restorationRows] = await conn.query(
          `SELECT r.id, r.status, r.total_price, a.brand, a.model_name
          FROM restoration_requests r
          JOIN appraisals a ON r.appraisal_id = a.id
          WHERE r.id = ?`,
          [payment.related_resource_id],
        );

        if (restorationRows.length > 0) {
          relatedResource = {
            type: "restoration",
            data: restorationRows[0],
          };
        }
      }
    }

    // PG사 응답 데이터 파싱
    if (payment.raw_response_data) {
      try {
        payment.raw_response_data = JSON.parse(payment.raw_response_data);
      } catch (error) {
        console.error("PG사 응답 데이터 파싱 오류:", error);
      }
    }

    res.json({
      success: true,
      payment,
      related_resource: relatedResource,
    });
  } catch (err) {
    console.error("결제 상세 정보 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "결제 상세 정보 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 정품 구별법 목록 조회 - GET /api/appr/admin/authenticity-guides
router.get(
  "/authenticity-guides",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    let conn;
    try {
      const { brand, is_active } = req.query;

      conn = await pool.getConnection();

      let query = `
      SELECT 
        id, brand, guide_type, title, description, 
        authentic_image, fake_image, is_active, created_at, updated_at
      FROM authenticity_guides
      WHERE 1=1
    `;

      const queryParams = [];

      if (brand) {
        query += " AND brand = ?";
        queryParams.push(brand);
      }

      if (is_active !== undefined) {
        query += " AND is_active = ?";
        queryParams.push(is_active === "true");
      }

      query += " ORDER BY brand, guide_type, created_at DESC";

      const [rows] = await conn.query(query, queryParams);

      res.json({
        success: true,
        guides: rows,
      });
    } catch (err) {
      console.error("정품 구별법 목록 조회 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "정품 구별법 목록 조회 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 정품 구별법 추가 - POST /api/appr/admin/authenticity-guides
router.post(
  "/authenticity-guides",
  isAuthenticated,
  isAdmin,
  authenticityUpload.fields([
    { name: "authentic_image", maxCount: 1 },
    { name: "fake_image", maxCount: 1 },
  ]),
  async (req, res) => {
    let conn;
    try {
      const { brand, guide_type, title, description } = req.body;

      // 필수 필드 검증
      if (!brand || !guide_type || !title || !description) {
        return res.status(400).json({
          success: false,
          message: "필수 입력 항목이 누락되었습니다.",
        });
      }

      // 이미지 처리
      let authentic_image = null;
      let fake_image = null;

      if (req.files) {
        if (req.files.authentic_image && req.files.authentic_image.length > 0) {
          authentic_image = `/images/authenticity/${req.files.authentic_image[0].filename}`;
        }

        if (req.files.fake_image && req.files.fake_image.length > 0) {
          fake_image = `/images/authenticity/${req.files.fake_image[0].filename}`;
        }
      }

      conn = await pool.getConnection();

      // 구별법 ID 생성
      const guide_id = uuidv4();

      // 정보 저장
      await conn.query(
        `INSERT INTO authenticity_guides (
          id, brand, guide_type, title, description,
          authentic_image, fake_image, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          guide_id,
          brand,
          guide_type,
          title,
          description,
          authentic_image,
          fake_image,
          true,
        ],
      );

      res.status(201).json({
        success: true,
        guide: {
          id: guide_id,
          brand,
          guide_type,
          title,
          description,
          authentic_image,
          fake_image,
          is_active: true,
        },
      });
    } catch (err) {
      console.error("정품 구별법 추가 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "정품 구별법 추가 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 정품 구별법 수정 - PUT /api/appr/admin/authenticity-guides/:id
router.put(
  "/authenticity-guides/:id",
  isAuthenticated,
  isAdmin,
  authenticityUpload.fields([
    { name: "authentic_image", maxCount: 1 },
    { name: "fake_image", maxCount: 1 },
  ]),
  async (req, res) => {
    let conn;
    try {
      const guide_id = req.params.id;
      const { brand, guide_type, title, description, is_active } = req.body;

      conn = await pool.getConnection();

      // 구별법 존재 여부 확인
      const [guideRows] = await conn.query(
        "SELECT * FROM authenticity_guides WHERE id = ?",
        [guide_id],
      );

      if (guideRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 정품 구별법을 찾을 수 없습니다.",
        });
      }

      const guide = guideRows[0];

      // 이미지 처리
      let authentic_image = guide.authentic_image;
      let fake_image = guide.fake_image;

      if (req.files) {
        if (req.files.authentic_image && req.files.authentic_image.length > 0) {
          authentic_image = `/images/authenticity/${req.files.authentic_image[0].filename}`;
        }

        if (req.files.fake_image && req.files.fake_image.length > 0) {
          fake_image = `/images/authenticity/${req.files.fake_image[0].filename}`;
        }
      }

      // 업데이트할 필드 구성
      const updateData = {};
      const updateFields = [];
      const updateValues = [];

      if (brand) {
        updateFields.push("brand = ?");
        updateValues.push(brand);
        updateData.brand = brand;
      }

      if (guide_type) {
        updateFields.push("guide_type = ?");
        updateValues.push(guide_type);
        updateData.guide_type = guide_type;
      }

      if (title) {
        updateFields.push("title = ?");
        updateValues.push(title);
        updateData.title = title;
      }

      if (description) {
        updateFields.push("description = ?");
        updateValues.push(description);
        updateData.description = description;
      }

      if (authentic_image !== guide.authentic_image) {
        updateFields.push("authentic_image = ?");
        updateValues.push(authentic_image);
        updateData.authentic_image = authentic_image;
      }

      if (fake_image !== guide.fake_image) {
        updateFields.push("fake_image = ?");
        updateValues.push(fake_image);
        updateData.fake_image = fake_image;
      }

      if (is_active !== undefined) {
        updateFields.push("is_active = ?");
        updateValues.push(is_active === "true" || is_active === true);
        updateData.is_active = is_active === "true" || is_active === true;
      }

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: "업데이트할 정보가 없습니다.",
        });
      }

      // 업데이트 쿼리 실행
      const query = `UPDATE authenticity_guides SET ${updateFields.join(
        ", ",
      )} WHERE id = ?`;
      updateValues.push(guide_id);

      await conn.query(query, updateValues);

      res.json({
        success: true,
        guide: {
          id: guide_id,
          ...guide,
          ...updateData,
        },
      });
    } catch (err) {
      console.error("정품 구별법 수정 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "정품 구별법 수정 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 정품 구별법 비활성화 - DELETE /api/appr/admin/authenticity-guides/:id
router.delete(
  "/authenticity-guides/:id",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    let conn;
    try {
      const guide_id = req.params.id;

      conn = await pool.getConnection();

      // 실제 삭제 대신 비활성화 처리
      await conn.query(
        "UPDATE authenticity_guides SET is_active = false WHERE id = ?",
        [guide_id],
      );

      res.json({
        success: true,
        message: "정품 구별법이 비활성화되었습니다.",
      });
    } catch (err) {
      console.error("정품 구별법 삭제 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message: "정품 구별법 삭제 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 감정 상태 일괄 변경 - PUT /api/appr/admin/appraisals/bulk-status
router.put(
  "/appraisals/bulk-status",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    let conn;
    try {
      const { ids, status } = req.body;

      // 입력 검증
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: "변경할 감정 ID 목록이 필요합니다.",
        });
      }

      if (!status) {
        return res.status(400).json({
          success: false,
          message: "변경할 상태가 필요합니다.",
        });
      }

      // 유효한 상태값 검증
      const validStatuses = ["pending", "in_review", "completed", "cancelled"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "유효하지 않은 상태값입니다.",
        });
      }

      // ID 개수 제한 (안전을 위해)
      if (ids.length > 100) {
        return res.status(400).json({
          success: false,
          message: "한 번에 최대 100개까지만 변경할 수 있습니다.",
        });
      }

      conn = await pool.getConnection();

      // 감정 정보들 조회 (존재 여부 확인)
      const placeholders = ids.map(() => "?").join(", ");
      const [appraisalRows] = await conn.query(
        `SELECT id, certificate_number, brand, model_name, user_id, status FROM appraisals WHERE id IN (${placeholders})`,
        ids,
      );

      if (appraisalRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "변경할 감정 정보를 찾을 수 없습니다.",
        });
      }

      // 실제로 존재하는 감정 ID들만 추출
      const foundIds = appraisalRows.map((appraisal) => appraisal.id);
      const notFoundIds = ids.filter((id) => !foundIds.includes(id));

      // 트랜잭션 시작
      await conn.beginTransaction();

      try {
        let updatedCount = 0;
        const updatedAppraisals = [];

        // 상태 일괄 업데이트
        const updateQuery = `UPDATE appraisals SET status = ? WHERE id IN (${placeholders})`;
        await conn.query(updateQuery, [status, ...foundIds]);

        updatedCount = foundIds.length;

        // 업데이트된 감정 정보 수집
        for (const appraisal of appraisalRows) {
          updatedAppraisals.push({
            id: appraisal.id,
            certificate_number: appraisal.certificate_number,
            brand: appraisal.brand,
            model_name: appraisal.model_name,
            user_id: appraisal.user_id,
            old_status: appraisal.status,
            new_status: status,
          });
        }

        // 트랜잭션 커밋
        await conn.commit();

        // 응답 구성
        const responseMessage =
          ids.length === 1
            ? "감정 상태가 성공적으로 변경되었습니다."
            : `${updatedCount}개의 감정 상태가 성공적으로 변경되었습니다.`;

        const response = {
          success: true,
          message: responseMessage,
          summary: {
            requested_count: ids.length,
            updated_count: updatedCount,
            new_status: status,
          },
          updated_appraisals: updatedAppraisals,
        };

        // 찾지 못한 ID가 있는 경우 추가 정보 제공
        if (notFoundIds.length > 0) {
          response.not_found_ids = notFoundIds;
          response.message += ` (${notFoundIds.length}개 ID를 찾을 수 없어 건너뛰었습니다.)`;
        }

        res.json(response);
      } catch (error) {
        // 트랜잭션 롤백
        await conn.rollback();
        throw error;
      }
    } catch (err) {
      console.error("감정 상태 일괄 변경 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message:
          err.message || "감정 상태 일괄 변경 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 감정 결과 일괄 변경 - PUT /api/appr/admin/appraisals/bulk-result
router.put(
  "/appraisals/bulk-result",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    let conn;
    try {
      const { ids, result, result_notes } = req.body;

      // 입력 검증
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: "변경할 감정 ID 목록이 필요합니다.",
        });
      }

      if (!result) {
        return res.status(400).json({
          success: false,
          message: "변경할 결과가 필요합니다.",
        });
      }

      // 유효한 결과값 검증
      const validResults = ["pending", "authentic", "fake", "uncertain"];
      if (!validResults.includes(result)) {
        return res.status(400).json({
          success: false,
          message: "유효하지 않은 결과값입니다.",
        });
      }

      // ID 개수 제한 (안전을 위해)
      if (ids.length > 100) {
        return res.status(400).json({
          success: false,
          message: "한 번에 최대 100개까지만 변경할 수 있습니다.",
        });
      }

      conn = await pool.getConnection();

      // 감정 정보들 조회 (존재 여부 확인)
      const placeholders = ids.map(() => "?").join(", ");
      const [appraisalRows] = await conn.query(
        `SELECT id, certificate_number, brand, model_name, user_id, result, status, appraisal_type, credit_deducted FROM appraisals WHERE id IN (${placeholders})`,
        ids,
      );

      if (appraisalRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "변경할 감정 정보를 찾을 수 없습니다.",
        });
      }

      // 실제로 존재하는 감정 ID들만 추출
      const foundIds = appraisalRows.map((appraisal) => appraisal.id);
      const notFoundIds = ids.filter((id) => !foundIds.includes(id));

      // 트랜잭션 시작
      await conn.beginTransaction();

      try {
        let updatedCount = 0;
        let creditDeductedCount = 0;
        const updatedAppraisals = [];

        for (const appraisal of appraisalRows) {
          // 결과 및 상태 업데이트 쿼리 구성
          let updateQuery = "UPDATE appraisals SET result = ?";
          let updateParams = [result];

          // 결과가 pending이 아니면 status를 completed로, pending이면 in_review로 설정
          if (result !== "pending") {
            updateQuery += ", status = 'completed'";
          } else {
            updateQuery += ", status = 'in_review'";
          }

          // 결과 노트가 있으면 추가
          if (result_notes) {
            updateQuery += ", result_notes = ?";
            updateParams.push(result_notes);
          }

          // 크레딧 차감 처리 (결과가 pending이 아니고, 아직 크레딧이 차감되지 않은 퀵링크 감정)
          let creditDeducted = false;
          if (
            result !== "pending" &&
            !appraisal.credit_deducted &&
            appraisal.appraisal_type === "quicklink"
          ) {
            // 사용자 크레딧 조회 및 차감
            const [userRows] = await conn.query(
              "SELECT * FROM appr_users WHERE user_id = ?",
              [appraisal.user_id],
            );

            if (userRows.length > 0) {
              const user = userRows[0];
              const newCredits = Math.max(
                0,
                user.quick_link_credits_remaining - 1,
              );

              await conn.query(
                "UPDATE appr_users SET quick_link_credits_remaining = ? WHERE user_id = ?",
                [newCredits, appraisal.user_id],
              );

              creditDeducted = true;
              creditDeductedCount++;

              // 크레딧 차감 여부와 감정 완료 시간 업데이트
              updateQuery += ", credit_deducted = true, appraised_at = NOW()";
            }
          } else if (result !== "pending") {
            // 크레딧은 차감하지 않지만 감정 완료 시간은 설정
            updateQuery += ", appraised_at = NOW()";
          }

          updateQuery += " WHERE id = ?";
          updateParams.push(appraisal.id);

          // 감정 정보 업데이트
          await conn.query(updateQuery, updateParams);
          updatedCount++;

          // 업데이트된 감정 정보 수집
          updatedAppraisals.push({
            id: appraisal.id,
            certificate_number: appraisal.certificate_number,
            brand: appraisal.brand,
            model_name: appraisal.model_name,
            user_id: appraisal.user_id,
            old_result: appraisal.result,
            new_result: result,
            old_status: appraisal.status,
            new_status: result !== "pending" ? "completed" : "in_review",
            credit_deducted: creditDeducted,
          });
        }

        // 트랜잭션 커밋
        await conn.commit();

        // 응답 구성
        const responseMessage =
          ids.length === 1
            ? "감정 결과가 성공적으로 변경되었습니다."
            : `${updatedCount}개의 감정 결과가 성공적으로 변경되었습니다.`;

        const response = {
          success: true,
          message: responseMessage,
          summary: {
            requested_count: ids.length,
            updated_count: updatedCount,
            credit_deducted_count: creditDeductedCount,
            new_result: result,
            result_notes: result_notes || null,
          },
          updated_appraisals: updatedAppraisals,
        };

        // 찾지 못한 ID가 있는 경우 추가 정보 제공
        if (notFoundIds.length > 0) {
          response.not_found_ids = notFoundIds;
          response.message += ` (${notFoundIds.length}개 ID를 찾을 수 없어 건너뛰었습니다.)`;
        }

        res.json(response);
      } catch (error) {
        // 트랜잭션 롤백
        await conn.rollback();
        throw error;
      }
    } catch (err) {
      console.error("감정 결과 일괄 변경 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message:
          err.message || "감정 결과 일괄 변경 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 감정 상세 정보 조회 - GET /api/appr/admin/appraisals/:id
router.get("/appraisals/:id", isAuthenticated, isAdmin, async (req, res) => {
  let conn;
  try {
    const appraisal_id = req.params.id;

    conn = await pool.getConnection();

    const [rows] = await conn.query(
      `SELECT a.*, u.email as user_email, u.company_name
      FROM appraisals a
      JOIN users u ON a.user_id = u.id
      WHERE a.id = ?`,
      [appraisal_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 감정 정보를 찾을 수 없습니다.",
      });
    }

    // JSON 데이터 파싱 및 호환성 처리
    const appraisal = rows[0];
    if (appraisal.components_included) {
      appraisal.components_included = JSON.parse(appraisal.components_included);
    }
    if (appraisal.delivery_info) {
      appraisal.delivery_info = JSON.parse(appraisal.delivery_info);
    }

    // 이미지 데이터 정규화
    if (appraisal.images) {
      appraisal.images = normalizeImageData(appraisal.images);
    } else {
      appraisal.images = [];
    }

    res.json({
      success: true,
      appraisal,
    });
  } catch (err) {
    console.error("감정 상세 조회 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "감정 상세 조회 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 감정 결과 및 상태 업데이트 - PUT /api/appr/admin/appraisals/:id
router.put(
  "/appraisals/:id",
  isAuthenticated,
  isAdmin,
  appraisalUpload.fields([
    { name: "images", maxCount: 20 },
    { name: "pdf", maxCount: 1 },
  ]),
  async (req, res) => {
    let conn;
    try {
      const appraisal_id = req.params.id;
      const {
        brand,
        model_name,
        category,
        appraisal_type,
        product_link,
        platform,
        purchase_year,
        components_included,
        delivery_info,
        remarks,
        certificate_number,
        tccode,
        result,
        result_notes,
        suggested_restoration_services,
        deleted_image_ids,
        final_image_order,
      } = req.body;

      conn = await pool.getConnection();

      // 감정 정보 조회
      const [appraisalRows] = await conn.query(
        "SELECT * FROM appraisals WHERE id = ?",
        [appraisal_id],
      );

      if (appraisalRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 감정 정보를 찾을 수 없습니다.",
        });
      }

      const appraisal = appraisalRows[0];

      // 이미지 처리 로직
      let finalImages = [];

      // 1. 기존 이미지 정규화
      let existingImages = appraisal.images
        ? normalizeImageData(appraisal.images)
        : [];

      // (선택적이지만 권장) 기존 이미지에 워터마크가 없는 경우 이 시점에 적용
      const needsWatermarkUpdate = existingImages.some(
        (img) => !isWatermarked(img.url),
      );
      if (needsWatermarkUpdate) {
        const existingImageUrls = existingImages.map((img) => img.url);
        const watermarkedUrls =
          await ensureWatermarkOnExistingImages(existingImageUrls);
        // 워터마크가 적용된 URL로 기존 이미지 정보 업데이트
        existingImages.forEach((img, index) => {
          img.url = watermarkedUrls[index];
        });
      }

      // 2. 신규 업로드 파일 처리 - 임시 ID와 매칭
      let newImageUrls = [];
      if (req.files && req.files.images && req.files.images.length > 0) {
        newImageUrls = await processUploadedImages(
          req.files.images,
          path.join(__dirname, "../../public/images/appraisals"),
          { skipExisting: true },
        );
      }

      // 3. 삭제 및 순서 정보 파싱
      const deletedIds = deleted_image_ids ? JSON.parse(deleted_image_ids) : [];
      const orderInfo = final_image_order ? JSON.parse(final_image_order) : [];

      // 4. 최종 이미지 목록 재구성
      finalImages = []; // 기존 선언된 변수 재사용
      const existingImageMap = new Map(
        existingImages.map((img) => [img.id, img]),
      );
      let newImageIndex = 0; // 새 이미지 인덱스 추적

      if (orderInfo.length > 0) {
        orderInfo.forEach((orderItem, index) => {
          if (orderItem.isNew) {
            // 새 이미지: 업로드 순서대로 매칭
            if (newImageIndex < newImageUrls.length) {
              // ✅ structureImageData와 동일한 ID 생성 방식 사용
              finalImages.push({
                id: `img-${Date.now()}-${newImageIndex}`,
                url: newImageUrls[newImageIndex],
                order: index,
              });
              newImageIndex++;
            }
          } else {
            // 기존 이미지: 삭제되지 않은 것만 추가
            if (
              !deletedIds.includes(orderItem.id) &&
              existingImageMap.has(orderItem.id)
            ) {
              const existingImg = existingImageMap.get(orderItem.id);
              finalImages.push({ ...existingImg, order: index });
            }
          }
        });
      } else {
        // 순서 정보가 없는 경우의 fallback
        existingImages.forEach((img) => {
          if (!deletedIds.includes(img.id)) {
            finalImages.push(img);
          }
        });
        // 새 이미지 추가 - structureImageData와 동일한 방식
        if (newImageUrls.length > 0) {
          const newImageStructures = structureImageData(newImageUrls);
          newImageStructures.forEach((img, index) => {
            finalImages.push({
              ...img,
              order: finalImages.length + index,
            });
          });
        }
      }

      // 5. 삭제된 이미지 파일들 실제 삭제
      if (deletedIds.length > 0) {
        setImmediate(() => {
          existingImages
            .filter((img) => deletedIds.includes(img.id))
            .forEach((img) => {
              try {
                const filePath = path.join(__dirname, "../../public", img.url);
                if (fs.existsSync(filePath)) {
                  fs.unlinkSync(filePath);
                  console.log(`삭제된 이미지 파일: ${filePath}`);
                }
              } catch (error) {
                console.error(`파일 삭제 오류 (${img.url}):`, error);
              }
            });
        });
      }

      // 인증서 번호 검증 (기존과 동일)
      if (
        certificate_number &&
        certificate_number !== appraisal.certificate_number
      ) {
        const normalizedNumber = certificate_number.toLowerCase();
        const certPattern = /^cas\d+$/i;
        if (!certPattern.test(normalizedNumber)) {
          return res.status(400).json({
            success: false,
            message: "감정 번호는 CAS + 숫자 형식이어야 합니다. (예: CAS04312)",
          });
        }

        const [existing] = await conn.query(
          "SELECT certificate_number FROM appraisals WHERE certificate_number = ? AND id != ?",
          [normalizedNumber, appraisal_id],
        );

        if (existing.length > 0) {
          return res.status(400).json({
            success: false,
            message: "이미 존재하는 감정 번호입니다.",
          });
        }
      }

      // QR 코드 및 PDF 처리
      let qrcode_url = appraisal.qrcode_url;
      let certificate_url = appraisal.certificate_url;

      if (req.files && req.files.pdf && req.files.pdf.length > 0) {
        certificate_url = `/images/appraisals/${req.files.pdf[0].filename}`;
      }

      const finalCertificateNumber =
        certificate_number || appraisal.certificate_number;
      if (finalCertificateNumber && !qrcode_url) {
        qrcode_url = await generateQRCode(finalCertificateNumber);
      }

      // 업데이트 필드 구성 (기존과 동일)
      const updateData = {};
      const updateFields = [];
      const updateValues = [];

      if (brand !== undefined) {
        updateFields.push("brand = ?");
        updateValues.push(brand);
        updateData.brand = brand;
      }

      if (model_name !== undefined) {
        updateFields.push("model_name = ?");
        updateValues.push(model_name);
        updateData.model_name = model_name;
      }

      if (category !== undefined) {
        updateFields.push("category = ?");
        updateValues.push(category);
        updateData.category = category;
      }

      if (appraisal_type !== undefined) {
        updateFields.push("appraisal_type = ?");
        updateValues.push(appraisal_type);
        updateData.appraisal_type = appraisal_type;
      }

      if (product_link !== undefined) {
        updateFields.push("product_link = ?");
        updateValues.push(product_link);
        updateData.product_link = product_link;
      }

      if (platform !== undefined) {
        updateFields.push("platform = ?");
        updateValues.push(platform);
        updateData.platform = platform;
      }

      if (purchase_year !== undefined) {
        updateFields.push("purchase_year = ?");
        updateValues.push(purchase_year ? parseInt(purchase_year) : null);
        updateData.purchase_year = purchase_year
          ? parseInt(purchase_year)
          : null;
      }

      if (components_included !== undefined) {
        updateFields.push("components_included = ?");
        updateValues.push(
          components_included ? JSON.stringify(components_included) : null,
        );
        updateData.components_included = components_included;
      }

      if (delivery_info !== undefined) {
        updateFields.push("delivery_info = ?");
        updateValues.push(delivery_info ? JSON.stringify(delivery_info) : null);
        updateData.delivery_info = delivery_info;
      }

      if (remarks !== undefined) {
        updateFields.push("remarks = ?");
        updateValues.push(remarks);
        updateData.remarks = remarks;
      }

      if (certificate_number !== undefined) {
        updateFields.push("certificate_number = ?");
        updateValues.push(
          certificate_number ? certificate_number.toLowerCase() : null,
        );
        updateData.certificate_number = certificate_number
          ? certificate_number.toLowerCase()
          : null;
      }

      if (tccode !== undefined) {
        updateFields.push("tccode = ?");
        updateValues.push(tccode);
        updateData.tccode = tccode;
      }

      if (result) {
        updateFields.push("result = ?");
        updateValues.push(result);
        updateData.result = result;

        if (result !== "pending") {
          updateFields.push("status = 'completed'");
          updateData.status = "completed";
        } else {
          updateFields.push("status = 'in_review'");
          updateData.status = "in_review";
        }
      }

      if (result_notes !== undefined) {
        updateFields.push("result_notes = ?");
        updateValues.push(result_notes);
        updateData.result_notes = result_notes;
      }

      // 이미지 필드 업데이트 - 통일된 방식 사용
      updateFields.push("images = ?");
      updateValues.push(
        finalImages.length > 0 ? JSON.stringify(finalImages) : null,
      );
      updateData.images = finalImages;

      if (certificate_url) {
        updateFields.push("certificate_url = ?");
        updateValues.push(certificate_url);
        updateData.certificate_url = certificate_url;
      }

      if (qrcode_url) {
        updateFields.push("qrcode_url = ?");
        updateValues.push(qrcode_url);
        updateData.qrcode_url = qrcode_url;
      }

      if (suggested_restoration_services) {
        try {
          const serviceIds =
            typeof suggested_restoration_services === "string"
              ? JSON.parse(suggested_restoration_services)
              : suggested_restoration_services;

          updateFields.push("suggested_restoration_services = ?");
          updateValues.push(JSON.stringify(serviceIds));
          updateData.suggested_restoration_services = serviceIds;
        } catch (error) {
          console.error("복원 서비스 JSON 파싱 오류:", error);
        }
      }

      // 크레딧 차감 처리 (기존과 동일)
      let creditInfo = { deducted: false, remaining: 0 };

      if (result && result !== "pending" && !appraisal.credit_deducted) {
        if (appraisal.appraisal_type === "quicklink") {
          const [userRows] = await conn.query(
            "SELECT * FROM appr_users WHERE user_id = ?",
            [appraisal.user_id],
          );

          if (userRows.length > 0) {
            const user = userRows[0];
            const newCredits = Math.max(
              0,
              user.quick_link_credits_remaining - 1,
            );

            await conn.query(
              "UPDATE appr_users SET quick_link_credits_remaining = ? WHERE user_id = ?",
              [newCredits, appraisal.user_id],
            );

            creditInfo = { deducted: true, remaining: newCredits };
            updateFields.push("credit_deducted = ?");
            updateValues.push(true);
            updateData.credit_deducted = true;
          }
        }

        updateFields.push("appraised_at = ?");
        updateValues.push(new Date());
        updateData.appraised_at = new Date();
      }

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: "업데이트할 정보가 없습니다.",
        });
      }

      // 업데이트 쿼리 실행
      const query = `UPDATE appraisals SET ${updateFields.join(
        ", ",
      )} WHERE id = ?`;
      updateValues.push(appraisal_id);

      await conn.query(query, updateValues);

      res.json({
        success: true,
        appraisal: {
          id: appraisal_id,
          certificate_number: finalCertificateNumber,
          ...updateData,
        },
        credit_info: creditInfo,
      });
    } catch (err) {
      console.error("감정 정보 업데이트 중 오류 발생:", err);
      res.status(500).json({
        success: false,
        message:
          err.message || "감정 정보 업데이트 중 서버 오류가 발생했습니다.",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 일괄 PDF 생성 및 다운로드 - POST /api/appr/admin/appraisals/bulk-download-pdf
router.post(
  "/appraisals/bulk-download-pdf",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    let conn;
    try {
      const { ids } = req.body;

      // 입력 검증
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: "다운로드할 감정 ID 목록이 필요합니다.",
        });
      }

      // ID 개수 제한
      if (ids.length > 100) {
        return res.status(400).json({
          success: false,
          message: "한 번에 최대 100개까지만 다운로드할 수 있습니다.",
        });
      }

      // 기본 좌표 사용 (백엔드에서 관리)
      const coordinates = DEFAULT_PDF_COORDINATES;

      conn = await pool.getConnection();

      // 감정 정보들 조회
      const placeholders = ids.map(() => "?").join(", ");
      const [appraisalRows] = await conn.query(
        `SELECT * FROM appraisals WHERE id IN (${placeholders})`,
        ids,
      );

      if (appraisalRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "다운로드할 감정 정보를 찾을 수 없습니다.",
        });
      }

      const pdfPaths = [];
      const processResults = [];

      // 각 감정에 대해 PDF 생성 (Lazy Evaluation)
      for (const appraisal of appraisalRows) {
        try {
          const { pdfPath, pdfData, wasGenerated } = await ensureCertificatePDF(
            appraisal,
            coordinates,
          );

          // DB 업데이트 (새로 생성된 경우만)
          if (wasGenerated) {
            await conn.query(
              "UPDATE appraisals SET certificate_url = ?, pdf_data = ? WHERE id = ?",
              [pdfPath, pdfData, appraisal.id],
            );
          }

          pdfPaths.push(pdfPath);
          processResults.push({
            id: appraisal.id,
            certificate_number: appraisal.certificate_number,
            pdf_url: pdfPath,
            was_generated: wasGenerated,
            status: "success",
          });
        } catch (error) {
          console.error(`PDF 생성 실패 (감정 ID: ${appraisal.id}):`, error);
          processResults.push({
            id: appraisal.id,
            certificate_number: appraisal.certificate_number,
            status: "failed",
            error: error.message,
          });
        }
      }

      // ZIP 파일로 압축하여 스트림 응답
      const zipFilename = `certificates-${Date.now()}.zip`;
      const archive = createZipStream(res, pdfPaths, zipFilename);

      // ZIP 완료 처리
      archive.finalize();

      // 로그 출력
      console.log(
        `PDF 일괄 다운로드 완료: ${pdfPaths.length}/${appraisalRows.length}개 성공`,
      );
    } catch (err) {
      console.error("PDF 일괄 다운로드 중 오류 발생:", err);

      // 이미 응답이 시작된 경우 에러를 보낼 수 없음
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message:
            err.message || "PDF 일괄 다운로드 중 서버 오류가 발생했습니다.",
        });
      }
    } finally {
      if (conn) conn.release();
    }
  },
);

module.exports = router;
