// utils/appr.js - 워터마크 최적화 버전
const QRCode = require("qrcode");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

// 워터마크 설정
const WATERMARK_CONFIG = {
  path: path.join(__dirname, "../public/images/watermark.png"),
  opacity: 0.4,
  widthPercent: 0.25,
  position: "center",
};

// 워터마크 캐시 변수들
let watermarkCache = {
  buffer: null,
  metadata: null,
  isLoading: false,
  loadPromise: null,
};

/**
 * 워터마크를 한 번만 로드하고 캐시하는 함수
 */
async function loadWatermarkOnce() {
  // 이미 로드된 경우
  if (watermarkCache.buffer && watermarkCache.metadata) {
    return watermarkCache;
  }

  // 로딩 중인 경우 기존 Promise 반환
  if (watermarkCache.isLoading && watermarkCache.loadPromise) {
    return await watermarkCache.loadPromise;
  }

  // 워터마크 파일이 없는 경우
  if (!fs.existsSync(WATERMARK_CONFIG.path)) {
    console.warn("워터마크 파일을 찾을 수 없습니다:", WATERMARK_CONFIG.path);
    return null;
  }

  // 워터마크 로딩 시작
  watermarkCache.isLoading = true;
  watermarkCache.loadPromise = (async () => {
    try {
      const watermarkImage = sharp(WATERMARK_CONFIG.path);
      const metadata = await watermarkImage.metadata();
      const buffer = await watermarkImage.png().toBuffer();

      watermarkCache.buffer = buffer;
      watermarkCache.metadata = metadata;
      watermarkCache.isLoading = false;

      console.log("워터마크 캐시 로드 완료");
      return watermarkCache;
    } catch (error) {
      console.error("워터마크 로드 실패:", error);
      watermarkCache.isLoading = false;
      return null;
    }
  })();

  return await watermarkCache.loadPromise;
}

/**
 * 워터마크 적용 여부 확인
 */
function isWatermarked(filename) {
  if (!filename) return false;
  return (
    filename.includes("-wm-") ||
    filename.includes("-wm.") ||
    filename.startsWith("wm-")
  );
}

/**
 * 단일 이미지에 워터마크를 적용하는 최적화된 함수
 */
async function applyWatermarkToImageOptimized(
  inputPath,
  outputPath,
  watermarkCache
) {
  try {
    // 워터마크 캐시가 없는 경우 원본 복사
    if (!watermarkCache || !watermarkCache.buffer) {
      console.warn("워터마크 캐시 없음. 원본 이미지 사용:", inputPath);
      await sharp(inputPath).toFile(outputPath);
      return false;
    }

    // 원본 이미지 정보 가져오기
    const originalImage = sharp(inputPath);
    const originalMetadata = await originalImage.metadata();

    if (!originalMetadata.width || !originalMetadata.height) {
      throw new Error("이미지 메타데이터를 읽을 수 없습니다");
    }

    // 워터마크 크기 계산
    const watermarkWidth = Math.round(
      originalMetadata.width * WATERMARK_CONFIG.widthPercent
    );

    // 워터마크 리사이징 (캐시된 버퍼 사용)
    const resizedWatermarkBuffer = await sharp(watermarkCache.buffer)
      .resize(watermarkWidth, null, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .composite([
        {
          input: Buffer.from([
            255,
            255,
            255,
            Math.round(255 * WATERMARK_CONFIG.opacity),
          ]),
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: "dest-in",
        },
      ])
      .toBuffer();

    // 워터마크 위치 계산 (중앙)
    const resizedWatermarkMetadata = await sharp(
      resizedWatermarkBuffer
    ).metadata();
    const left = Math.round(
      (originalMetadata.width - resizedWatermarkMetadata.width) / 2
    );
    const top = Math.round(
      (originalMetadata.height - resizedWatermarkMetadata.height) / 2
    );

    // 워터마크 합성
    await originalImage
      .composite([
        {
          input: resizedWatermarkBuffer,
          left: left,
          top: top,
          blend: "over",
        },
      ])
      .toFile(outputPath);

    return true;
  } catch (error) {
    console.error("워터마크 적용 실패:", error);
    // 실패 시 원본 이미지 복사
    try {
      await sharp(inputPath).toFile(outputPath);
      return false;
    } catch (copyError) {
      console.error("원본 이미지 복사 실패:", copyError);
      throw copyError;
    }
  }
}

/**
 * 기존 인터페이스 유지 - 내부만 최적화
 */
async function applyWatermarkToImage(inputPath, outputPath) {
  const watermarkCache = await loadWatermarkOnce();
  return await applyWatermarkToImageOptimized(
    inputPath,
    outputPath,
    watermarkCache
  );
}

/**
 * 단일 파일 처리 함수 (병렬 처리용)
 */
async function processSingleFile(
  file,
  destinationDir,
  watermarkCache,
  options = {}
) {
  const {
    skipExisting = true,
    forceReprocess = false,
    preserveOriginal = false,
  } = options;

  try {
    // 파일 정보 검증
    if (!file || !file.filename || !file.path) {
      console.warn("잘못된 파일 정보:", file);
      return null;
    }

    // 이미지 파일 여부 확인
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      console.log(`이미지가 아닌 파일 건너뛰기: ${file.filename}`);
      return `/images/appraisals/${file.filename}`;
    }

    const originalPath = file.path;

    // 이미 워터마크가 적용된 파일인지 확인
    if (skipExisting && isWatermarked(file.filename) && !forceReprocess) {
      console.log(`이미 워터마크된 파일 건너뛰기: ${file.filename}`);
      return `/images/appraisals/${file.filename}`;
    }

    // 원본 파일 존재 여부 확인
    if (!fs.existsSync(originalPath)) {
      console.warn(`원본 파일을 찾을 수 없음: ${originalPath}`);
      return `/images/appraisals/${file.filename}`;
    }

    // 새 파일명 생성 (워터마크 표시)
    const fileExt = path.extname(file.filename);
    const baseName = path.basename(file.filename, fileExt);
    const watermarkedFilename = `${baseName}-wm${fileExt}`;
    const watermarkedPath = path.join(destinationDir, watermarkedFilename);

    // 워터마크 적용
    const success = await applyWatermarkToImageOptimized(
      originalPath,
      watermarkedPath,
      watermarkCache
    );

    if (success) {
      // 원본 파일 삭제 (보존 옵션이 false인 경우만)
      if (!preserveOriginal) {
        setImmediate(() => {
          try {
            if (fs.existsSync(originalPath)) {
              fs.unlinkSync(originalPath);
              console.log(`원본 파일 삭제 완료: ${originalPath}`);
            }
          } catch (error) {
            console.error(`원본 파일 삭제 실패: ${originalPath}`, error);
          }
        });
      }
      return `/images/appraisals/${watermarkedFilename}`;
    } else {
      // 워터마크 적용 실패 시 원본 파일 사용
      console.warn(`워터마크 적용 실패, 원본 사용: ${file.filename}`);
      return `/images/appraisals/${file.filename}`;
    }
  } catch (error) {
    console.error(`파일 ${file?.filename} 처리 실패:`, error);

    // 처리 실패 시 원본 파일 사용
    if (file && file.filename) {
      return `/images/appraisals/${file.filename}`;
    }
    return null;
  }
}

/**
 * 업로드된 파일들에 워터마크를 일괄 적용하는 최적화된 함수
 * 외부 인터페이스는 완전히 동일하게 유지
 */
async function processUploadedImages(files, destinationDir, options = {}) {
  if (!files || files.length === 0) return [];

  try {
    // 워터마크 캐시 미리 로드
    console.log(`${files.length}개 이미지 처리 시작...`);
    const watermarkCache = await loadWatermarkOnce();

    const limit = pLimit(5); // 동시 처리 개수 제한

    // 병렬 처리 (p-limit 사용)
    const processPromises = files.map((file) =>
      limit(() =>
        processSingleFile(file, destinationDir, watermarkCache, options)
      )
    );

    const results = await Promise.all(processPromises);
    const processedImages = results.filter(Boolean);

    console.log(`이미지 처리 완료: ${processedImages.length}/${files.length}`);
    return processedImages;
  } catch (error) {
    console.error("이미지 일괄 처리 중 오류:", error);
    // 실패 시 기존 방식으로 폴백
    return await processUploadedImagesFallback(files, destinationDir, options);
  }
}

/**
 * 폴백 함수 (기존 방식)
 */
async function processUploadedImagesFallback(
  files,
  destinationDir,
  options = {}
) {
  const processedImages = [];

  for (const file of files) {
    try {
      if (file && file.filename) {
        processedImages.push(`/images/appraisals/${file.filename}`);
      }
    } catch (error) {
      console.error(`폴백 처리 실패: ${file?.filename}`, error);
    }
  }

  return processedImages;
}

/**
 * 기존 이미지 배열에서 워터마크 적용 (최적화됨)
 * 외부 인터페이스는 완전히 동일하게 유지
 */
async function ensureWatermarkOnExistingImages(imageUrls, options = {}) {
  if (!imageUrls || !Array.isArray(imageUrls)) return [];

  const { forceReprocess = false } = options;

  try {
    // 워터마크 캐시 미리 로드
    const watermarkCache = await loadWatermarkOnce();
    const appraisalsDir = path.join(__dirname, "../public/images/appraisals");

    const limit = pLimit(5); // 동시 처리 개수 제한

    // 병렬 처리
    const processPromises = imageUrls.map((imageUrl) =>
      limit(async () => {
        try {
          if (!imageUrl || typeof imageUrl !== "string") {
            console.warn("잘못된 이미지 URL:", imageUrl);
            return imageUrl;
          }

          const filename = path.basename(imageUrl);

          // 이미 워터마크가 적용된 이미지인지 확인
          if (isWatermarked(filename) && !forceReprocess) {
            return imageUrl;
          }

          const originalPath = path.join(
            __dirname,
            "../public",
            imageUrl.replace(/^\//, "")
          );

          // 파일 존재 여부 확인
          if (!fs.existsSync(originalPath)) {
            console.warn(`이미지 파일을 찾을 수 없음: ${originalPath}`);
            return imageUrl; // 원본 URL 유지
          }

          // 워터마크 적용된 새 파일명 생성
          const fileExt = path.extname(filename);
          const baseName = path.basename(filename, fileExt);
          const watermarkedFilename = `${baseName}-wm${fileExt}`;
          const watermarkedPath = path.join(appraisalsDir, watermarkedFilename);

          // 워터마크 적용
          const success = await applyWatermarkToImageOptimized(
            originalPath,
            watermarkedPath,
            watermarkCache
          );

          if (success) {
            return `/images/appraisals/${watermarkedFilename}`;
          } else {
            return imageUrl; // 실패 시 원본 URL 유지
          }
        } catch (error) {
          console.error(`기존 이미지 워터마크 적용 실패: ${imageUrl}`, error);
          return imageUrl; // 실패 시 원본 URL 유지
        }
      })
    );

    const processedUrls = await Promise.all(processPromises);
    return processedUrls;
  } catch (error) {
    console.error("기존 이미지 워터마크 일괄 적용 중 오류:", error);
    return imageUrls; // 실패 시 원본 배열 반환
  }
}

/**
 * 감정서 번호 생성 함수 (기존과 동일)
 */
async function generateCertificateNumber(conn, customNumber = null) {
  if (customNumber) {
    const certPattern = /^cas\d+$/i;
    if (!certPattern.test(customNumber)) {
      throw new Error(
        "감정 번호는 CAS + 숫자 형식이어야 합니다. (예: CAS04312)"
      );
    }

    const normalizedNumber = customNumber.toLowerCase();
    const [existing] = await conn.query(
      "SELECT certificate_number FROM appraisals WHERE certificate_number = ?",
      [normalizedNumber]
    );

    if (existing.length > 0) {
      throw new Error("이미 존재하는 감정 번호입니다.");
    }

    return normalizedNumber;
  }

  try {
    const [rows] = await conn.query(
      `SELECT certificate_number 
       FROM appraisals 
       WHERE certificate_number REGEXP '^cas[0-9]+$' 
       ORDER BY created_at DESC 
       LIMIT 1`
    );

    let nextNumber = 1;
    let digitCount = 6;

    if (rows.length > 0) {
      const lastCertNumber = rows[0].certificate_number;
      const match = lastCertNumber.match(/^cas(\d+)$/i);
      if (match) {
        const numberPart = match[1];
        digitCount = numberPart.length;
        const lastNumber = parseInt(numberPart);
        nextNumber = lastNumber + 1;
      }
    }

    let certificateNumber;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 1000;

    while (!isUnique && attempts < maxAttempts) {
      const paddedNumber = nextNumber.toString().padStart(digitCount, "0");
      certificateNumber = `cas${paddedNumber}`;

      const [existing] = await conn.query(
        "SELECT certificate_number FROM appraisals WHERE certificate_number = ?",
        [certificateNumber]
      );

      if (existing.length === 0) {
        isUnique = true;
      } else {
        nextNumber++;
        attempts++;
      }
    }

    if (!isUnique) {
      console.warn("순차 번호 생성 실패, 랜덤 번호로 폴백");
      const randomNum = Math.floor(100000 + Math.random() * 900000);
      certificateNumber = `cas${randomNum}`;

      const [randomCheck] = await conn.query(
        "SELECT certificate_number FROM appraisals WHERE certificate_number = ?",
        [certificateNumber]
      );

      if (randomCheck.length > 0) {
        throw new Error("인증서 번호 생성에 실패했습니다. 다시 시도해주세요.");
      }
    }

    return certificateNumber;
  } catch (error) {
    console.error("인증서 번호 생성 중 오류:", error);
    throw new Error("인증서 번호 생성 중 오류가 발생했습니다.");
  }
}

/**
 * QR 코드 생성 함수 (기존과 동일)
 */
async function generateQRCode(certificateNumber) {
  try {
    const qrDir = path.join(__dirname, "../public/images/qrcodes");
    if (!fs.existsSync(qrDir)) {
      fs.mkdirSync(qrDir, { recursive: true });
    }

    const qrFileName = `qr-${certificateNumber}.png`;
    const qrPath = path.join(qrDir, qrFileName);

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const certificateUrl = `${frontendUrl}/appr/result/${certificateNumber}`;

    await QRCode.toFile(qrPath, certificateUrl, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 300,
    });

    return `/images/qrcodes/${qrFileName}`;
  } catch (error) {
    console.error("QR 코드 생성 중 오류:", error);
    return null;
  }
}

/**
 * 경매 결과로부터 감정서 생성 함수 (최적화됨)
 */
async function createAppraisalFromAuction(conn, bid, item, userId) {
  try {
    const certificateNumber = await generateCertificateNumber(conn);
    const qrcodeUrl = await generateQRCode(certificateNumber);

    // 이미지 처리
    let processedImages = [];

    // additional_images에서 이미지 가져오기
    let rawImages = [];

    if (item.image) rawImages.push(item.image);

    if (item.additional_images) {
      try {
        const additionalImages = JSON.parse(item.additional_images);
        if (Array.isArray(additionalImages)) {
          rawImages = additionalImages;
        }
      } catch (error) {
        console.error("additional_images JSON 파싱 오류:", error);
      }
    }

    // 경매 이미지들에 워터마크 적용 (최적화됨)
    if (rawImages.length > 0) {
      const watermarkedUrls = await ensureWatermarkOnExistingImages(rawImages, {
        forceReprocess: false,
      });
      processedImages = structureImageData(watermarkedUrls);
    }

    const [appraisalResult] = await conn.query(
      `INSERT INTO appraisals (
        user_id, appraisal_type, status, brand, model_name, category, 
        result, images, certificate_number, qrcode_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        "from_auction",
        "pending",
        item.brand || "기타",
        item.title || "제목 없음",
        item.category || "기타",
        "pending",
        processedImages.length > 0 ? JSON.stringify(processedImages) : null,
        certificateNumber,
        qrcodeUrl,
      ]
    );

    return {
      appraisal_id: appraisalResult.insertId,
      certificate_number: certificateNumber,
      qrcode_url: qrcodeUrl,
    };
  } catch (error) {
    console.error("감정서 생성 중 오류:", error);
    throw error;
  }
}

/**
 * 기존 감정서 이미지 워터마크 마이그레이션 (최적화됨)
 */
async function migrateExistingAppraisalImages(conn, batchSize = 10) {
  try {
    console.log("기존 감정서 이미지 워터마크 마이그레이션 시작...");

    // 워터마크 캐시 미리 로드
    await loadWatermarkOnce();

    const [appraisals] = await conn.query(
      `
      SELECT id, images 
      FROM appraisals 
      WHERE images IS NOT NULL 
      AND images != 'null' 
      AND images != '[]'
      LIMIT ?
    `,
      [batchSize]
    );

    let processedCount = 0;

    const limit = pLimit(5); // 동시 처리 개수 제한

    // 병렬 처리
    const migrationPromises = appraisals.map((appraisal) =>
      limit(async () => {
        try {
          const images = JSON.parse(appraisal.images);

          if (Array.isArray(images) && images.length > 0) {
            // 워터마크 확인 및 적용 (최적화됨)
            const watermarkedImages = await ensureWatermarkOnExistingImages(
              images,
              {
                forceReprocess: false,
              }
            );

            // 변경사항이 있으면 DB 업데이트
            const hasChanges =
              JSON.stringify(watermarkedImages) !== JSON.stringify(images);

            if (hasChanges) {
              await conn.query(
                "UPDATE appraisals SET images = ? WHERE id = ?",
                [JSON.stringify(watermarkedImages), appraisal.id]
              );

              console.log(`감정서 ${appraisal.id} 이미지 워터마크 적용 완료`);
              return 1;
            }
          }
          return 0;
        } catch (error) {
          console.error(`감정서 ${appraisal.id} 처리 실패:`, error);
          return 0;
        }
      })
    );

    const results = await Promise.all(migrationPromises);
    processedCount = results.reduce((sum, count) => sum + count, 0);

    console.log(`마이그레이션 완료: ${processedCount}개 감정서 처리됨`);
    return processedCount;
  } catch (error) {
    console.error("마이그레이션 중 오류:", error);
    throw error;
  }
}

/**
 * additional_images 파싱 유틸리티 함수 (기존과 동일)
 */
function parseAdditionalImages(additionalImagesJson) {
  if (!additionalImagesJson) return [];

  try {
    const images = JSON.parse(additionalImagesJson);
    return Array.isArray(images) ? images : [];
  } catch (error) {
    console.error("additional_images JSON 파싱 오류:", error);
    return [];
  }
}

/**
 * 이미지 URL 배열을 표준 데이터 구조로 변환하는 함수 (기존과 동일)
 */
function structureImageData(imageUrls) {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return [];
  }
  return imageUrls.map((url, index) => ({
    id: `img-${Date.now()}-${index}`,
    url: url,
    order: index,
  }));
}

/**
 * 워터마크 캐시 클리어 함수 (필요시 사용)
 */
function clearWatermarkCache() {
  watermarkCache = {
    buffer: null,
    metadata: null,
    isLoading: false,
    loadPromise: null,
  };
  console.log("워터마크 캐시가 클리어되었습니다.");
}

module.exports = {
  generateCertificateNumber,
  generateQRCode,
  createAppraisalFromAuction,
  parseAdditionalImages,
  processUploadedImages,
  ensureWatermarkOnExistingImages,
  migrateExistingAppraisalImages,
  isWatermarked,
  applyWatermarkToImage,
  structureImageData,
  clearWatermarkCache,
};
