// routes/certificate.js
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");
const { v4: uuidv4 } = require("uuid");
const PDFDocument = require("pdfkit"); // PDF 생성을 위해
const QRCode = require("qrcode"); // QR 코드 생성을 위해
const fs = require("fs"); // 파일 시스템 접근 (임시 QR 저장용)
const path = require("path"); // 경로 조작용

// 미들웨어: 인증 확인
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({
      success: false,
      message: "인증되지 않은 사용자입니다.",
      code: "UNAUTHORIZED",
    });
  }
};

// 감정서 번호 생성 로직
async function generateCertificateNumber(conn, brand) {
  const brandInitial = brand ? brand.substring(0, 1).toUpperCase() : "X";
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = `CAS-${brandInitial}${year}-`;

  const [countResult] = await conn.query(
    "SELECT COUNT(*) as count FROM certificates WHERE certificate_number LIKE ?",
    [`${prefix}%`],
  );
  const nextSerial = (countResult[0].count + 1).toString().padStart(4, "0");
  return `${prefix}${nextSerial}`;
}

// 3.2.1 감정서 발급 신청
router.post("/issue", isAuthenticated, async (req, res) => {
  const { appraisal_id, type, delivery_info, payment_info } = req.body;
  const user_id = req.session.user.id;

  if (!appraisal_id || !type) {
    return res.status(400).json({
      success: false,
      message: "필수 정보(감정 ID, 발급 유형)가 누락되었습니다.",
      code: "INVALID_INPUT",
    });
  }
  if (type === "physical" && !delivery_info) {
    return res.status(400).json({
      success: false,
      message: "실물 감정서 발급 시 배송 정보는 필수입니다.",
      code: "INVALID_INPUT",
    });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [appraisalRows] = await conn.query(
      "SELECT id, result, brand FROM appraisals WHERE id = ? AND status = 'completed'",
      [appraisal_id],
    );
    if (appraisalRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message:
          "유효한 감정 건을 찾을 수 없거나 아직 감정이 완료되지 않았습니다.",
        code: "APPRAISAL_NOT_FOUND_OR_PENDING",
      });
    }
    const appraisal = appraisalRows[0];
    if (appraisal.result === "pending" || appraisal.result === "uncertain") {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: `감정 결과가 '${appraisal.result}'이므로 감정서를 발급할 수 없습니다.`,
        code: "CANNOT_ISSUE_CERTIFICATE",
      });
    }

    const [existingCert] = await conn.query(
      "SELECT id FROM certificates WHERE appraisal_id = ?",
      [appraisal_id],
    );
    if (existingCert.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: "이미 해당 감정 건에 대한 감정서가 존재합니다.",
        code: "CERTIFICATE_ALREADY_EXISTS",
      });
    }

    const certificateId = uuidv4();
    const certificate_number = await generateCertificateNumber(
      conn,
      appraisal.brand,
    );
    const verification_code = uuidv4().replace(/-/g, "").substring(0, 12); // 더 긴 유니크 코드로 변경
    const initialStatus = payment_info ? "pending_issuance" : "pending_payment";

    const sql = `
      INSERT INTO certificates (
        id, appraisal_id, certificate_number, user_id, type, status, 
        verification_code, delivery_info, payment_info, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await conn.query(sql, [
      certificateId,
      appraisal_id,
      certificate_number,
      user_id,
      type,
      initialStatus,
      verification_code,
      delivery_info ? JSON.stringify(delivery_info) : null,
      payment_info ? JSON.stringify(payment_info) : null,
    ]);

    await conn.commit();
    res.status(201).json({
      success: true,
      message: "감정서 발급 신청이 완료되었습니다.",
      certificate: {
        id: certificateId,
        certificate_number: certificate_number,
        appraisal_id: appraisal_id,
        type: type,
        status: initialStatus,
      },
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("감정서 발급 신청 중 오류:", error);
    res.status(500).json({
      success: false,
      message: "감정서 발급 신청 중 오류가 발생했습니다.",
      code: "SERVER_ERROR",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 3.2.2 사용자의 감정서 목록 조회
router.get("/", isAuthenticated, async (req, res) => {
  const user_id = req.session.user.id;
  const { status: queryStatus, page = 1, limit = 10 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let conn;
  try {
    conn = await pool.getConnection();
    let sql = `
      SELECT 
        c.id, c.certificate_number, c.type, c.status, c.issued_date, c.created_at,
        a.brand, a.model_name, a.result as appraisal_result, JSON_UNQUOTE(JSON_EXTRACT(a.images, '$[0]')) as representative_image
      FROM certificates c
      JOIN appraisals a ON c.appraisal_id = a.id
      WHERE c.user_id = ?
    `;
    const params = [user_id];

    if (queryStatus) {
      sql += " AND c.status = ?";
      params.push(queryStatus);
    }
    sql += " ORDER BY c.created_at DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);

    const [certsFromDb] = await conn.query(sql, params);

    const certificates = certsFromDb.map((cert) => ({
      id: cert.id,
      certificate_number: cert.certificate_number,
      type: cert.type,
      status: cert.status,
      issued_date: cert.issued_date,
      appraisal: {
        brand: cert.brand,
        model_name: cert.model_name,
        result: cert.appraisal_result,
        representative_image: cert.representative_image,
      },
      created_at: cert.created_at,
    }));

    let countSql =
      "SELECT COUNT(*) as totalItems FROM certificates WHERE user_id = ?";
    const countParams = [user_id];
    if (queryStatus) {
      countSql += " AND status = ?";
      countParams.push(queryStatus);
    }
    const [totalResult] = await conn.query(countSql, countParams);
    const totalItems = totalResult[0].totalItems;
    const totalPages = Math.ceil(totalItems / parseInt(limit));

    res.json({
      success: true,
      certificates,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("사용자 감정서 목록 조회 중 오류:", error);
    res.status(500).json({
      success: false,
      message: "감정서 목록 조회 중 오류가 발생했습니다.",
      code: "SERVER_ERROR",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 3.2.3 감정서 정보 조회 (공개)
router.get("/:certificateNumber", async (req, res) => {
  const { certificateNumber } = req.params;
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.query(
      `SELECT 
         c.certificate_number, c.type, c.status, c.issued_date, c.verification_code,
         a.id as appraisal_id, a.brand, a.model_name, a.category, a.result as appraisal_result, 
         a.images as appraisal_images, a.result_notes as appraisal_result_notes
       FROM certificates c
       JOIN appraisals a ON c.appraisal_id = a.id
       WHERE c.certificate_number = ?`,
      [certificateNumber],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "해당 감정서를 찾을 수 없습니다.",
        code: "NOT_FOUND",
      });
    }
    const certData = rows[0];
    res.json({
      success: true,
      certificate: {
        certificate_number: certData.certificate_number,
        type: certData.type,
        status: certData.status,
        issued_date: certData.issued_date,
        appraisal: {
          appraisal_id: certData.appraisal_id,
          brand: certData.brand,
          model_name: certData.model_name,
          category: certData.category,
          result: certData.appraisal_result,
          images: certData.appraisal_images
            ? JSON.parse(certData.appraisal_images)
            : [],
          result_notes: certData.appraisal_result_notes,
        },
        verification_code: certData.verification_code,
      },
    });
  } catch (error) {
    console.error("감정서 조회 중 오류:", error);
    res.status(500).json({
      success: false,
      message: "감정서 조회 중 오류가 발생했습니다.",
      code: "SERVER_ERROR",
    });
  } finally {
    if (conn) conn.release();
  }
});

// 3.2.4 감정서 발급 완료 처리
router.put(
  "/:certificateNumber/completion",
  isAuthenticated,
  async (req, res) => {
    const { certificateNumber } = req.params;
    const { delivery_info, payment_info, status_to_update } = req.body;
    const user_id = req.session.user.id;

    if (!payment_info) {
      return res.status(400).json({
        success: false,
        message: "결제 정보가 누락되었습니다.",
        code: "INVALID_INPUT",
      });
    }

    let conn;
    try {
      conn = await pool.getConnection();
      const [certs] = await conn.query(
        "SELECT id, type, status, user_id, delivery_info as existing_delivery_info FROM certificates WHERE certificate_number = ?",
        [certificateNumber],
      );

      if (certs.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 감정서를 찾을 수 없습니다.",
          code: "NOT_FOUND",
        });
      }
      const certificate = certs[0];

      if (
        certificate.user_id !== user_id &&
        req.session.user &&
        req.session.user.role !== "admin"
      ) {
        // 관리자 예외 추가
        return res.status(403).json({
          success: false,
          message: "접근 권한이 없습니다.",
          code: "FORBIDDEN",
        });
      }

      if (
        certificate.type === "physical" &&
        !delivery_info &&
        !certificate.existing_delivery_info
      ) {
        return res.status(400).json({
          success: false,
          message: "실물 감정서 발급 시 배송 정보는 필수입니다.",
          code: "INVALID_INPUT",
        });
      }

      // 현재는 모든 상태에서 업데이트 가능하도록 하지만, 필요시 특정 상태에서만 가능하도록 제한
      // if (certificate.status !== 'pending_payment' && certificate.status !== 'pending_issuance') {
      //     return res.status(400).json({ success: false, message: `현재 상태(${certificate.status})에서는 발급 완료 처리를 할 수 없습니다.`, code: "INVALID_STATUS_FOR_COMPLETION" });
      // }

      let newStatus = status_to_update;
      if (
        !newStatus &&
        (certificate.status === "pending_payment" ||
          certificate.status === "pending_issuance")
      ) {
        newStatus = certificate.type === "physical" ? "shipped" : "issued"; // 결제 완료 후 기본 상태
      } else if (!newStatus) {
        newStatus = certificate.status; // 상태 변경 없으면 기존 상태 유지
      }

      const updateFields = {
        payment_info: JSON.stringify(payment_info),
        status: newStatus,
        updated_at: new Date(),
      };

      if (newStatus === "issued" || newStatus === "shipped") {
        if (!certificate.issued_date) {
          // issued_date가 아직 설정되지 않았을 때만 업데이트
          updateFields.issued_date = new Date();
        }
      }
      if (delivery_info) {
        updateFields.delivery_info = JSON.stringify(delivery_info);
      }

      const sql = "UPDATE certificates SET ? WHERE certificate_number = ?";
      await conn.query(sql, [updateFields, certificateNumber]);

      res.json({
        success: true,
        message: "감정서 발급 처리가 완료되었습니다.",
        certificate: {
          certificate_number: certificateNumber,
          status: newStatus,
          delivery_info_updated: !!delivery_info,
        },
      });
    } catch (error) {
      console.error("감정서 발급 완료 처리 중 오류:", error);
      res.status(500).json({
        success: false,
        message: "감정서 발급 완료 처리 중 오류가 발생했습니다.",
        code: "SERVER_ERROR",
      });
    } finally {
      if (conn) conn.release();
    }
  },
);

// 3.2.5 PDF 감정서 다운로드
router.get(
  "/:certificateNumber/download",
  isAuthenticated,
  async (req, res) => {
    const { certificateNumber } = req.params;
    const user_id = req.session.user.id;
    let conn;
    try {
      conn = await pool.getConnection();
      const [rows] = await conn.query(
        `SELECT c.*, 
              a.brand, a.model_name, a.category, a.result as appraisal_result, 
              a.images as appraisal_images, a.result_notes as appraisal_result_notes
       FROM certificates c
       JOIN appraisals a ON c.appraisal_id = a.id
       WHERE c.certificate_number = ?`,
        [certificateNumber],
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "해당 감정서를 찾을 수 없습니다.",
          code: "NOT_FOUND",
        });
      }
      const certData = rows[0];

      if (
        certData.user_id !== user_id &&
        req.session.user &&
        req.session.user.role !== "admin"
      ) {
        return res.status(403).json({
          success: false,
          message: "다운로드 권한이 없습니다.",
          code: "FORBIDDEN",
        });
      }

      // PDF 생성 시작
      const doc = new PDFDocument({ margin: 50, font: "Helvetica" }); // 기본 폰트 지정
      // 한글 지원을 위해 폰트 파일 로드 (프로젝트 내에 폰트 파일이 있어야 함)
      // 예시: 'NanumGothic.ttf' 파일을 프로젝트 루트에 fonts 폴더를 만들고 넣어둔 경우
      // const fontPath = path.join(__dirname, '..', 'fonts', 'NanumGothic.ttf');
      // if (fs.existsSync(fontPath)) {
      //     doc.font(fontPath);
      // } else {
      //     console.warn("경고: 한글 폰트 파일을 찾을 수 없습니다. PDF에 한글이 깨질 수 있습니다.");
      // }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="CAS_Certificate_${certificateNumber.replace(
          /-/g,
          "_",
        )}.pdf"`,
      );
      doc.pipe(res);

      // --- PDF 내용 구성 ---
      // Header
      doc
        .fontSize(20)
        .text("CAS 명품 감정 시스템 - 공식 감정서", { align: "center" });
      doc.moveDown(2);

      // 감정서 정보
      doc.fontSize(12).text(`감정서 번호: ${certData.certificate_number}`);
      doc.text(
        `발급일: ${
          certData.issued_date
            ? new Date(certData.issued_date).toLocaleDateString("ko-KR")
            : "미발급"
        }`,
      );
      doc.text(
        `감정 유형: ${
          certData.type === "physical" ? "실물 감정서" : "디지털 감정서"
        }`,
      );
      doc.moveDown();

      // 감정 대상 정보
      doc.fontSize(14).text("감정 대상 정보", { underline: true });
      doc.moveDown(0.5);
      doc
        .fontSize(11)
        .text(`브랜드: ${certData.brand || "정보 없음"}`)
        .text(`모델명: ${certData.model_name || "정보 없음"}`)
        .text(`카테고리: ${certData.category || "정보 없음"}`);
      doc.moveDown();

      // 감정 결과
      doc.fontSize(14).text("감정 결과", { underline: true });
      doc.moveDown(0.5);
      let resultText = "결과 정보 없음";
      let resultColor = "black";
      if (certData.appraisal_result === "authentic") {
        resultText = "정품 (Authentic)";
        resultColor = "green";
      } else if (certData.appraisal_result === "fake") {
        resultText = "가품 (Counterfeit)";
        resultColor = "red";
      } else if (certData.appraisal_result === "uncertain") {
        resultText = "판단 보류 (Uncertain)";
        resultColor = "orange";
      }
      doc
        .fontSize(16)
        .fillColor(resultColor)
        .text(resultText, { align: "center" });
      doc.fillColor("black"); // 기본 색상으로 복원
      doc.moveDown(0.5);
      if (certData.appraisal_result_notes) {
        doc
          .fontSize(10)
          .text(`감정사 소견: ${certData.appraisal_result_notes}`);
      }
      doc.moveDown();

      // 대표 이미지 (첫번째 이미지가 있다면)
      const images = certData.appraisal_images
        ? JSON.parse(certData.appraisal_images)
        : [];
      if (images.length > 0) {
        const imagePath = path.join(__dirname, "..", "public", images[0]); // 'public' 폴더 기준
        if (fs.existsSync(imagePath)) {
          doc
            .addPage() // 새 페이지에 이미지 추가 (선택 사항)
            .fontSize(14)
            .text("참고 이미지", { underline: true })
            .moveDown(0.5);
          doc.image(imagePath, {
            fit: [400, 300], // 이미지 크기 조절
            align: "center",
            valign: "center",
          });
          doc.moveDown();
        } else {
          // doc.text(`(이미지 파일 경로를 찾을 수 없습니다: ${images[0]})`);
        }
      }

      // QR 코드 (선택 사항: PDF 내에 QR 코드 삽입)
      // const frontendUrl = process.env.FRONTEND_URL || 'https://casastrade.com';
      // const verificationUrlForQR = `${frontendUrl}/appr/result-detail/${certificateNumber}`; // 프론트엔드 상세 페이지
      // try {
      //     const qrCodeDataURL = await QRCode.toDataURL(verificationUrlForQR, { errorCorrectionLevel: 'M', margin: 1, width: 80 });
      //     doc.addPage().image(qrCodeDataURL, doc.page.width - 100 - 50, 50, { fit: [100, 100] }); // 우측 상단 예시
      // } catch (qrErr) {
      //     console.error("PDF 내 QR 코드 생성 오류:", qrErr);
      // }

      // Footer
      doc.addPage(); // 마지막 페이지 또는 적절한 위치에
      const pageHeight = doc.page.height;
      doc
        .fontSize(8)
        .text(
          "본 감정서는 CAS 명품 감정 시스템에 의해 발급되었습니다.",
          50,
          pageHeight - 100,
          { align: "center" },
        );
      doc.text(`고유 확인 코드: ${certData.verification_code || "N/A"}`, {
        align: "center",
      });
      doc.text(
        `온라인 확인: ${process.env.FRONTEND_URL}/appr/result-detail/${certificateNumber}`,
        {
          align: "center",
          link: `${process.env.FRONTEND_URL}/appr/result-detail/${certificateNumber}`,
          underline: true,
        },
      );

      doc.end();
    } catch (error) {
      console.error("PDF 감정서 다운로드 중 오류:", error);
      if (!res.headersSent) {
        // 헤더가 전송되지 않았을 경우에만 오류 응답
        res.status(500).json({
          success: false,
          message: "PDF 감정서 다운로드 중 오류가 발생했습니다.",
          code: "SERVER_ERROR",
        });
      }
    } finally {
      if (conn) conn.release();
    }
  },
);

// 3.2.6 감정서 QR코드 이미지 제공
router.get("/:certificateNumber/qrcode", async (req, res) => {
  const { certificateNumber } = req.params;
  try {
    const frontendUrl = process.env.FRONTEND_URL || "https://casastrade.com";
    // QR코드가 가리킬 URL: 프론트엔드의 감정서 상세 조회 페이지
    const verificationUrl = `${frontendUrl}/appr/result-detail/${certificateNumber}`;

    const qrCodeBuffer = await QRCode.toBuffer(verificationUrl, {
      errorCorrectionLevel: "H", // 오류 복원 수준 높음
      margin: 2, // 여백
      width: 200, // 이미지 너비
      color: {
        dark: "#000000FF", // QR 코드 색상
        light: "#FFFFFFFF", // 배경 색상
      },
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="qrcode_${certificateNumber}.png"`,
    ); // 브라우저에서 바로 보거나, 다운로드 이름 제안
    res.send(qrCodeBuffer);
  } catch (error) {
    console.error("QR 코드 생성 중 오류:", error);
    res.status(500).json({
      success: false,
      message: "QR 코드 생성 중 오류가 발생했습니다.",
      code: "SERVER_ERROR",
    });
  }
});

module.exports = router;
