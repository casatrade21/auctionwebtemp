// routes/appr/restorations.js
const express = require("express");
const router = express.Router();
const { pool } = require("../../utils/DB");
const { isAuthenticated, isAdmin } = require("../../utils/middleware");
const { v4: uuidv4 } = require("uuid");

// 복원 서비스 목록 조회 - GET /api/appr/restorations/services
router.get("/services", async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();

    const [rows] = await conn.query(
      "SELECT id, name, description, price, estimated_days, before_image, after_image, is_active FROM restoration_services WHERE is_active = true"
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
});

// 복원 서비스 신청 - POST /api/appr/restorations
router.post("/", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const { certificate_number, services, delivery_info, notes } = req.body;

    // 필수 필드 검증
    if (
      !certificate_number ||
      !services ||
      !Array.isArray(services) ||
      services.length === 0 ||
      !delivery_info
    ) {
      return res.status(400).json({
        success: false,
        message: "필수 입력 항목이 누락되었습니다.",
      });
    }

    conn = await pool.getConnection();

    // 사용자 ID 가져오기
    const user_id = req.session.user.id;

    // 감정 정보 확인 (certificate_number로 조회)
    const [appraisalRows] = await conn.query(
      "SELECT id, brand, model_name FROM appraisals WHERE certificate_number = ? AND user_id = ?",
      [certificate_number, user_id]
    );

    if (appraisalRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 감정 정보를 찾을 수 없습니다.",
      });
    }

    const appraisal_id = appraisalRows[0].id;

    // 서비스 가격 및 유효성 검증
    let total_price = "견적 문의"; // 기본값을 문자열로 설정
    const validServices = [];

    for (const service of services) {
      const [serviceRows] = await conn.query(
        "SELECT id, name, price FROM restoration_services WHERE id = ? AND is_active = true",
        [service.service_id]
      );

      if (serviceRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: `서비스 ID ${service.service_id}는 유효하지 않습니다.`,
        });
      }

      const dbService = serviceRows[0];
      validServices.push({
        service_id: dbService.id,
        service_name: dbService.name,
        price: dbService.price, // 문자열 그대로 저장
        status: "pending",
      });

      // 가격이 숫자인 경우에만 합계 계산
      if (!isNaN(parseFloat(dbService.price))) {
        if (total_price === "견적 문의") {
          total_price = parseFloat(dbService.price);
        } else if (!isNaN(parseFloat(total_price))) {
          total_price = parseFloat(total_price) + parseFloat(dbService.price);
        }
      } else {
        // 하나라도 문자열 가격이 있으면 전체를 "견적 문의"로 설정
        total_price = "견적 문의";
      }
    }

    // 복원 ID 생성
    const restoration_id = uuidv4();

    // 복원 요청 저장 부분
    const [result] = await conn.query(
      `INSERT INTO restoration_requests (
    id, appraisal_id, certificate_number, user_id, services, status, total_price,
    delivery_info, notes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        restoration_id,
        appraisal_id,
        certificate_number,
        user_id,
        JSON.stringify(validServices),
        "pending",
        typeof total_price === "number" ? total_price.toString() : total_price, // 문자열로 저장
        JSON.stringify(delivery_info),
        notes || null,
      ]
    );

    // 예상 완료일 계산 (서비스 중 가장 긴 소요일 + 현재 날짜)
    const [serviceEstimates] = await conn.query(
      "SELECT MAX(estimated_days) as max_days FROM restoration_services WHERE id IN (?)",
      [services.map((s) => s.service_id)]
    );

    const maxDays = serviceEstimates[0].max_days || 7;
    const estimatedDate = new Date();
    estimatedDate.setDate(estimatedDate.getDate() + maxDays);

    // 예상 완료일 업데이트
    await conn.query(
      "UPDATE restoration_requests SET estimated_completion_date = ? WHERE id = ?",
      [estimatedDate, restoration_id]
    );

    res.status(201).json({
      success: true,
      restoration: {
        id: restoration_id,
        appraisal_id,
        certificate_number,
        status: "pending",
        total_price,
        estimated_completion_date: estimatedDate,
        created_at: new Date(),
      },
    });
  } catch (err) {
    console.error("복원 서비스 신청 중 오류 발생:", err);
    res.status(500).json({
      success: false,
      message: "복원 서비스 신청 중 서버 오류가 발생했습니다.",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 복원 요청 목록 조회 - GET /api/appr/restorations
router.get("/", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const user_id = req.session.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status;

    conn = await pool.getConnection();

    // 기본 쿼리
    let query = `
      SELECT r.id, r.appraisal_id, r.status, r.total_price, 
        r.created_at, r.estimated_completion_date, r.completed_at,
        a.brand, a.model_name
      FROM restoration_requests r
      JOIN appraisals a ON r.appraisal_id = a.id
      WHERE r.user_id = ?
    `;

    const queryParams = [user_id];

    // 상태 필터 적용
    if (status) {
      query += " AND r.status = ?";
      queryParams.push(status);
    }

    // 최신순 정렬 및 페이지네이션
    query += " ORDER BY r.created_at DESC LIMIT ? OFFSET ?";
    queryParams.push(limit, offset);

    // 쿼리 실행
    const [rows] = await conn.query(query, queryParams);

    // 전체 개수 조회
    let countQuery =
      "SELECT COUNT(*) as total FROM restoration_requests WHERE user_id = ?";
    const countParams = [user_id];

    if (status) {
      countQuery += " AND status = ?";
      countParams.push(status);
    }

    const [countResult] = await conn.query(countQuery, countParams);
    const total = countResult[0].total;

    // 결과 반환
    res.json({
      success: true,
      restorations: rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        limit,
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

// 복원 요청 상세 조회 - GET /api/appr/restorations/:id
router.get("/:id", isAuthenticated, async (req, res) => {
  let conn;
  try {
    const restoration_id = req.params.id;
    const user_id = req.session.user.id;

    conn = await pool.getConnection();

    // 복원 요청 정보 조회
    const [rows] = await conn.query(
      `SELECT r.*, a.brand, a.model_name, a.category, a.images
      FROM restoration_requests r
      JOIN appraisals a ON r.appraisal_id = a.id
      WHERE r.id = ? AND r.user_id = ?`,
      [restoration_id, user_id]
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
    if (restoration.appraisal) {
      if (restoration.appraisal.images) {
        restoration.appraisal.images = JSON.parse(restoration.appraisal.images);
      }
    }

    // 감정 정보 포맷팅
    const appraisal = {
      id: restoration.appraisal_id,
      brand: restoration.brand,
      model_name: restoration.model_name,
      category: restoration.category,
      images: restoration.images,
    };

    // 불필요한 필드 제거
    delete restoration.brand;
    delete restoration.model_name;
    delete restoration.category;
    delete restoration.images;

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

module.exports = router;
