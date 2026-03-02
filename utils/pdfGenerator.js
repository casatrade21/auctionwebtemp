/**
 * pdfGenerator.js — 감정서 PDF 생성기 (pdf-lib)
 *
 * 템플릿 PDF 위에 한관 텍스트(NotoSansKR), QR 코드,
 * 상품 이미지를 좌표 기반으로 배치한다.
 * Lazy 생성(데이터 변경 시만 재생성), ZIP 번들링 지원.
 */
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const archiver = require("archiver");
const fontkit = require("@pdf-lib/fontkit");

/**
 * PDF 템플릿 좌표 기본값 (이미지 좌표를 PDF 좌표로 변환)
 * 이미지 크기: 1190.4 x 839.04 px
 * PDF 크기: 595.276 x 419.528 포인트
 * 변환 공식: scaleX = PDF_WIDTH / IMAGE_WIDTH, scaleY = PDF_HEIGHT / IMAGE_HEIGHT
 *           pdf_x = img_x * scaleX, pdf_y = PDF_HEIGHT - (img_y * scaleY)
 */
const IMAGE_WIDTH = 1190.4;
const IMAGE_HEIGHT = 839.04;
const PDF_WIDTH = 595.276;
const PDF_HEIGHT = 419.528;
const SCALE_X = PDF_WIDTH / IMAGE_WIDTH;
const SCALE_Y = PDF_HEIGHT / IMAGE_HEIGHT;

const DEFAULT_PDF_COORDINATES = {
  brand: {
    x: Math.round(566 * SCALE_X),
    y: Math.round(PDF_HEIGHT - 700 * SCALE_Y),
    size: 14,
  },
  model: {
    x: Math.round(566 * SCALE_X),
    y: Math.round(PDF_HEIGHT - 746 * SCALE_Y),
    size: 12,
  },
  tccode: {
    x: Math.round(566 * SCALE_X),
    y: Math.round(PDF_HEIGHT - 792 * SCALE_Y),
    size: 10,
  },
  result: {
    x: Math.round(1161 * SCALE_X),
    y: Math.round(PDF_HEIGHT - 112 * SCALE_Y),
    size: 16,
  },
  date: {
    x: Math.round(1161 * SCALE_X),
    y: Math.round(PDF_HEIGHT - 156 * SCALE_Y),
    size: 10,
  },
  serial: {
    x: Math.round(1161 * SCALE_X),
    y: Math.round(PDF_HEIGHT - 202 * SCALE_Y),
    size: 10,
  },
  report: {
    x: Math.round(625 * SCALE_X),
    y: Math.round(PDF_HEIGHT - 361 * SCALE_Y),
    width: Math.round((1161 - 625) * SCALE_X),
    height: Math.round((361 - 267) * SCALE_Y),
    size: 10,
  },
  qrcode: {
    x: Math.round(917 * SCALE_X),
    y: Math.round(PDF_HEIGHT - 654 * SCALE_Y),
    width: Math.round((1153 - 917) * SCALE_X),
    height: Math.round((654 - 418) * SCALE_Y),
  },
  image: {
    x: Math.round(29 * SCALE_X),
    y: Math.round(PDF_HEIGHT - 621 * SCALE_Y),
    width: Math.round((566 - 29) * SCALE_X),
    height: Math.round((621 - 194) * SCALE_Y),
  },
};

/**
 * 필요한 디렉토리 자동 생성
 */
function ensureDirectories() {
  const dirs = [
    path.join(__dirname, "../public/certificates"),
    path.join(__dirname, "../public/downloads"),
  ];

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`디렉토리 생성: ${dir}`);
    }
  });
}

/**
 * 현재 감정 데이터에서 PDF용 데이터 추출
 */
function extractPdfData(appraisal) {
  let imageUrl = null;

  // images 필드 파싱
  if (appraisal.images) {
    try {
      const images = JSON.parse(appraisal.images);
      if (Array.isArray(images) && images.length > 0) {
        imageUrl = images[0].url || images[0];
      }
    } catch (error) {
      console.error("이미지 파싱 오류:", error);
    }
  }

  return {
    brand: appraisal.brand || "",
    model: appraisal.model_name || "",
    result: appraisal.result || "pending",
    certificate_number: appraisal.certificate_number || "",
    tccode: appraisal.tccode || "NONE",
    date: appraisal.appraised_at
      ? new Date(appraisal.appraised_at).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0],
    qrcode_url: appraisal.qrcode_url || null,
    image_url: imageUrl,
    generated_at: new Date().toISOString(),
  };
}

/**
 * 두 PDF 데이터가 동일한지 비교
 */
function isDataEqual(data1, data2) {
  const keys = [
    "brand",
    "model",
    "result",
    "certificate_number",
    "tccode",
    "date",
    "qrcode_url",
    "image_url",
  ];

  return keys.every((key) => data1[key] === data2[key]);
}

/**
 * PDF 재생성 필요 여부 판단
 */
function needsRegeneration(appraisal) {
  // certificate_url이 없으면 생성 필요
  if (!appraisal.certificate_url) return true;

  // PDF 파일이 실제로 존재하는지 확인
  if (appraisal.certificate_url) {
    const pdfPath = path.join(
      __dirname,
      "../public",
      appraisal.certificate_url.replace(/^\//, ""),
    );
    if (!fs.existsSync(pdfPath)) return true;
  }

  // pdf_data가 없으면 생성 필요
  if (!appraisal.pdf_data) return true;

  // 현재 데이터와 스냅샷 비교
  try {
    const currentData = extractPdfData(appraisal);
    const savedData = JSON.parse(appraisal.pdf_data);
    return !isDataEqual(currentData, savedData);
  } catch (error) {
    console.error("PDF 데이터 비교 오류:", error);
    return true; // 에러 발생 시 재생성
  }
}

/**
 * Result 값을 한글로 변환
 */
function translateResult(result) {
  const mapping = {
    authentic: "정품",
    fake: "가품",
    uncertain: "판단불가",
    pending: "대기중",
  };
  return mapping[result] || result;
}

/**
 * 이미지를 지정된 사각형에 맞게 리사이징 (고화질 유지를 위한 Scale Factor 적용)
 */
async function resizeImageToFit(
  imagePath,
  targetWidth,
  targetHeight,
  scale = 3,
) {
  try {
    // scale = 3이면 3배 더 많은 픽셀을 생성 (약 216 DPI 수준)
    const widthPx = Math.round(targetWidth * scale);
    const heightPx = Math.round(targetHeight * scale);

    const image = sharp(imagePath);
    const metadata = await image.metadata();

    // 입력 파일이 PNG, JPEG 등일 수 있으므로 처리
    // 사진(상품 이미지)의 경우 jpeg로 변환하는 것이 용량 관리에 유리함
    // QR코드는 선명도가 중요하므로 png 유지
    const isPhoto = !imagePath.toLowerCase().includes("qr");

    return await image
      .resize(widthPx, heightPx, {
        fit: "inside",
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3,
      })
      .toFormat(isPhoto ? "jpeg" : "png", {
        quality: isPhoto ? 90 : 100, // JPEG 품질 90% (충분히 고화질)
      })
      .toBuffer();
  } catch (error) {
    console.error("이미지 리사이징 오류:", error);
    throw error;
  }
}

/**
 * 실제 PDF 생성 함수
 */
async function generateCertificatePDF(appraisal, coordinates) {
  try {
    ensureDirectories();

    // 템플릿 PDF 로드
    const templatePath = path.join(__dirname, "../public/appr_template.pdf");
    if (!fs.existsSync(templatePath)) {
      throw new Error(`템플릿 PDF를 찾을 수 없습니다: ${templatePath}`);
    }

    const templateBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);

    // fontkit 등록 (커스텀 폰트 사용을 위해 필수)
    pdfDoc.registerFontkit(fontkit);

    // 첫 페이지 가져오기
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width: pdfWidth, height: pdfHeight } = firstPage.getSize();

    console.log(`템플릿 PDF 크기: ${pdfWidth} x ${pdfHeight} 포인트`);

    // 한글 폰트 로드 (NotoSansKR-Bold.ttf)
    let font, boldFont;

    const fontPath = path.join(
      __dirname,
      "../public/fonts/NotoSansKR-Bold.ttf",
    );

    if (!fs.existsSync(fontPath)) {
      throw new Error(`폰트 파일을 찾을 수 없습니다: ${fontPath}`);
    }

    try {
      const fontBytes = fs.readFileSync(fontPath);
      font = await pdfDoc.embedFont(fontBytes);
      boldFont = font; // 같은 폰트 사용 (이미 Bold)
      console.log(`폰트 로드 성공: ${fontPath}`);
    } catch (error) {
      throw new Error(`폰트 로드 실패: ${error.message}`);
    }

    // 텍스트 그리기 헬퍼 함수 (커스텀 폰트의 ligature/spacing 문제 우회)
    // pdf-lib는 커스텀 폰트 사용 시 간격이 이상하게 늘어나는 버그가 있음
    // 해결책: 각 글자를 개별적으로 렌더링
    function drawTextManual(page, text, x, y, size, fontObj, color) {
      let currentX = x;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        page.drawText(char, {
          x: currentX,
          y: y,
          size: size,
          font: fontObj,
          color: color,
        });
        currentX += fontObj.widthOfTextAtSize(char, size);
      }
    }

    // PDF 데이터 추출
    const pdfData = extractPdfData(appraisal);

    // 텍스트 삽입 (우측 정렬 - 기준점 왼쪽으로 텍스트 배치)
    if (coordinates.brand) {
      const textWidth = font.widthOfTextAtSize(pdfData.brand, 10);
      drawTextManual(
        firstPage,
        pdfData.brand,
        coordinates.brand.x - textWidth,
        coordinates.brand.y,
        10,
        font,
        rgb(0, 0, 0),
      );
    }

    if (coordinates.model) {
      const textWidth = font.widthOfTextAtSize(pdfData.model, 8);
      drawTextManual(
        firstPage,
        pdfData.model,
        coordinates.model.x - textWidth,
        coordinates.model.y,
        8,
        font,
        rgb(0, 0, 0),
      );
    }

    if (coordinates.tccode) {
      const textWidth = font.widthOfTextAtSize(pdfData.tccode, 10);
      drawTextManual(
        firstPage,
        pdfData.tccode,
        coordinates.tccode.x - textWidth,
        coordinates.tccode.y,
        10,
        font,
        rgb(0, 0, 0),
      );
    }

    if (coordinates.date) {
      const textWidth = font.widthOfTextAtSize(pdfData.date, 10);
      drawTextManual(
        firstPage,
        pdfData.date,
        coordinates.date.x - textWidth,
        coordinates.date.y,
        10,
        font,
        rgb(0, 0, 0),
      );
    }

    if (coordinates.serial) {
      const textWidth = font.widthOfTextAtSize(pdfData.certificate_number, 10);
      drawTextManual(
        firstPage,
        pdfData.certificate_number,
        coordinates.serial.x - textWidth,
        coordinates.serial.y,
        10,
        font,
        rgb(0, 0, 0),
      );
    }

    if (coordinates.result) {
      const resultText = translateResult(pdfData.result);
      const textWidth = font.widthOfTextAtSize(resultText, 10);
      drawTextManual(
        firstPage,
        resultText,
        coordinates.result.x - textWidth,
        coordinates.result.y,
        10,
        boldFont,
        rgb(0, 0, 0),
      );
    }

    // Report 텍스트 박스 처리 (다중 라인 지원)
    if (coordinates.report) {
      const resultText = translateResult(pdfData.result);
      const reportText = `본 감정 결과는 CAS 감정 매뉴얼에 의거하여 '${resultText}'으로 최종 판정되었음을 소견합니다.`;

      // 텍스트를 박스 너비에 맞게 분할 (최소 여백 5)
      const maxWidth = coordinates.report.width - 5;
      const words = reportText.split("");
      const lines = [];
      let currentLine = "";

      for (const char of words) {
        const testLine = currentLine + char;
        const testWidth = font.widthOfTextAtSize(testLine, 8);

        if (testWidth > maxWidth && currentLine.length > 0) {
          lines.push(currentLine);
          currentLine = char;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine.length > 0) {
        lines.push(currentLine);
      }

      // 각 라인을 그리기 (위에서 아래로)
      const lineHeight = 8 * 1.5;
      let currentY =
        coordinates.report.y + coordinates.report.height - lineHeight;

      for (const line of lines) {
        drawTextManual(
          firstPage,
          line,
          coordinates.report.x + 3,
          currentY,
          8,
          font,
          rgb(0, 0, 0),
        );
        currentY -= lineHeight;
      }
    }

    // QR 코드 이미지 삽입 (QR은 선명한 선이 중요하므로 PNG 유지)
    if (coordinates.qrcode && pdfData.qrcode_url) {
      try {
        const qrcodePath = path.join(
          __dirname,
          "../public",
          pdfData.qrcode_url.replace(/^\//, ""),
        );

        if (fs.existsSync(qrcodePath)) {
          // QR 코드는 4배 스케일로 매우 선명하게
          const qrcodeImageBytes = await resizeImageToFit(
            qrcodePath,
            coordinates.qrcode.width,
            coordinates.qrcode.height,
            4, // Scale Factor
          );
          const qrcodeImage = await pdfDoc.embedPng(qrcodeImageBytes); // QR은 PNG

          firstPage.drawImage(qrcodeImage, {
            x: coordinates.qrcode.x,
            y: coordinates.qrcode.y,
            width: coordinates.qrcode.width, // PDF 상의 크기는 그대로 (Point)
            height: coordinates.qrcode.height, // PDF 상의 크기는 그대로 (Point)
          });
        }
      } catch (error) {
        console.error("QR 코드 삽입 오류:", error);
      }
    }

    // 상품 이미지 삽입
    if (coordinates.image && pdfData.image_url) {
      try {
        const imagePath = path.join(
          __dirname,
          "../public",
          pdfData.image_url.replace(/^\//, ""),
        );

        if (fs.existsSync(imagePath)) {
          // 상품 이미지는 3배 스케일
          const productImageBytes = await resizeImageToFit(
            imagePath,
            coordinates.image.width,
            coordinates.image.height,
            3, // Scale Factor
          );

          // 위 resizeImageToFit에서 사진은 jpeg로 변환하도록 로직을 바꿨다면 embedJpg 사용
          // 만약 무조건 png를 쓴다면 embedPng 유지
          let productImage;
          try {
            productImage = await pdfDoc.embedJpg(productImageBytes);
          } catch (e) {
            // 혹시 PNG로 넘어왔을 경우를 대비
            productImage = await pdfDoc.embedPng(productImageBytes);
          }

          firstPage.drawImage(productImage, {
            x: coordinates.image.x,
            y: coordinates.image.y,
            width: coordinates.image.width, // PDF 상의 크기는 그대로
            height: coordinates.image.height, // PDF 상의 크기는 그대로
          });
        }
      } catch (error) {
        console.error("상품 이미지 삽입 오류:", error);
      }
    }

    // PDF 저장
    const pdfBytes = await pdfDoc.save();
    const pdfFilename = `cert-${pdfData.certificate_number}.pdf`;
    const pdfPath = path.join(__dirname, "../public/certificates", pdfFilename);

    fs.writeFileSync(pdfPath, pdfBytes);

    const pdfUrl = `/certificates/${pdfFilename}`;

    console.log(`PDF 생성 완료: ${pdfUrl}`);

    return {
      pdfPath: pdfUrl,
      pdfData: JSON.stringify(pdfData),
    };
  } catch (error) {
    console.error("PDF 생성 중 오류:", error);
    throw error;
  }
}

/**
 * Lazy Evaluation - 필요 시에만 PDF 생성
 */
async function ensureCertificatePDF(appraisal, coordinates) {
  // 재생성 필요 여부 확인
  if (!needsRegeneration(appraisal)) {
    console.log(`캐시된 PDF 사용: ${appraisal.certificate_number}`);
    return {
      pdfPath: appraisal.certificate_url,
      pdfData: appraisal.pdf_data,
      wasGenerated: false,
    };
  }

  console.log(`PDF 생성 중: ${appraisal.certificate_number}`);
  const { pdfPath, pdfData } = await generateCertificatePDF(
    appraisal,
    coordinates,
  );

  return {
    pdfPath,
    pdfData,
    wasGenerated: true,
  };
}

/**
 * ZIP 파일 생성 및 스트림 반환
 */
function createZipStream(res, pdfPaths, zipFilename) {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);

  const archive = archiver("zip", {
    zlib: { level: 9 },
  });

  archive.on("error", (err) => {
    console.error("ZIP 생성 오류:", err);
    throw err;
  });

  archive.pipe(res);

  // 각 PDF 파일 추가
  pdfPaths.forEach((pdfPath) => {
    const fullPath = path.join(
      __dirname,
      "../public",
      pdfPath.replace(/^\//, ""),
    );

    if (fs.existsSync(fullPath)) {
      const fileName = path.basename(fullPath);
      archive.file(fullPath, { name: fileName });
    } else {
      console.warn(`파일을 찾을 수 없음: ${fullPath}`);
    }
  });

  return archive;
}

module.exports = {
  ensureDirectories,
  extractPdfData,
  needsRegeneration,
  translateResult,
  generateCertificatePDF,
  ensureCertificatePDF,
  createZipStream,
  DEFAULT_PDF_COORDINATES,
};

// 테스트 코드
if (require.main === module) {
  console.log("PDF 생성 테스트 시작...");

  // PDF를 이미지로 변환하는 함수
  async function convertPdfToImage(pdfPath) {
    const { pdfToPng } = require("pdf-to-png-converter");

    console.log("\n📸 PDF를 이미지로 변환 중...");
    console.log(`   입력: ${pdfPath}`);

    try {
      const pngPages = await pdfToPng(pdfPath, {
        disableFontFace: false,
        useSystemFonts: false,
        viewportScale: 2.0, // 해상도 (2.0 = 2배)
      });

      if (!pngPages || pngPages.length === 0) {
        throw new Error("PDF 변환 실패");
      }

      // 첫 페이지만 저장
      const outputPath = path.join(
        __dirname,
        "../public/certificates/template-preview.png",
      );
      fs.writeFileSync(outputPath, pngPages[0].content);

      console.log(`✅ 이미지 저장 완료: ${outputPath}`);
      console.log(`\n💡 좌표 찾는 방법:`);
      console.log(
        `   1. 이미지를 편집 프로그램에서 열기 (포토샵, GIMP, Paint.NET 등)`,
      );
      console.log(`   2. 마우스를 원하는 위치에 올리면 좌표 표시됨`);
      console.log(`   3. 좌표를 알려주시면 PDF 좌표로 변환해드립니다!`);
      console.log(`\n   이미지 크기 정보:`);
      console.log(`   - 폭: ${pngPages[0].width}px`);
      console.log(`   - 높이: ${pngPages[0].height}px`);
      console.log(`   - PDF 크기: 595 x 842 포인트 (A4)`);

      return outputPath;
    } catch (error) {
      console.error("PDF 변환 중 오류:", error);
      throw error;
    }
  }

  // 좌표 설정 (이미지 좌표를 PDF 좌표로 변환)
  // 이미지 크기: 1190.4 x 839.04 px
  // PDF 크기: 595.276 x 419.528 포인트
  // 변환 공식: scaleX = PDF_WIDTH / IMAGE_WIDTH, scaleY = PDF_HEIGHT / IMAGE_HEIGHT
  //           pdf_x = img_x * scaleX, pdf_y = PDF_HEIGHT - (img_y * scaleY)

  const IMAGE_WIDTH = 1190.4;
  const IMAGE_HEIGHT = 839.04;
  const PDF_WIDTH = 595.276;
  const PDF_HEIGHT = 419.528;

  const scaleX = PDF_WIDTH / IMAGE_WIDTH;
  const scaleY = PDF_HEIGHT / IMAGE_HEIGHT;

  const testCoordinates = {
    brand: {
      x: Math.round(566 * scaleX),
      y: Math.round(PDF_HEIGHT - 700 * scaleY),
      size: 14,
    },
    model: {
      x: Math.round(566 * scaleX),
      y: Math.round(PDF_HEIGHT - 746 * scaleY),
      size: 12,
    },
    tccode: {
      x: Math.round(566 * scaleX),
      y: Math.round(PDF_HEIGHT - 792 * scaleY),
      size: 10,
    },
    result: {
      x: Math.round(1161 * scaleX),
      y: Math.round(PDF_HEIGHT - 112 * scaleY),
      size: 16,
    },
    date: {
      x: Math.round(1161 * scaleX),
      y: Math.round(PDF_HEIGHT - 156 * scaleY),
      size: 10,
    },
    serial: {
      x: Math.round(1161 * scaleX),
      y: Math.round(PDF_HEIGHT - 202 * scaleY),
      size: 10,
    },
    report: {
      x: Math.round(625 * scaleX),
      y: Math.round(PDF_HEIGHT - 361 * scaleY), // 박스 하단
      width: Math.round((1161 - 625) * scaleX),
      height: Math.round((361 - 267) * scaleY),
      size: 10,
    },
    qrcode: {
      x: Math.round(917 * scaleX),
      y: Math.round(PDF_HEIGHT - 654 * scaleY), // QR 하단
      width: Math.round((1153 - 917) * scaleX),
      height: Math.round((654 - 418) * scaleY),
    },
    image: {
      x: Math.round(29 * scaleX),
      y: Math.round(PDF_HEIGHT - 621 * scaleY), // 이미지 하단
      width: Math.round((566 - 29) * scaleX),
      height: Math.round((621 - 194) * scaleY),
    },
  };

  // 테스트 실행 - DB에서 최신 데이터 가져오기
  (async () => {
    let conn;
    try {
      console.log("\n1. 디렉토리 생성 확인...");
      ensureDirectories();

      // 이미지 변환 옵션
      const args = process.argv.slice(2);
      if (args.includes("--image")) {
        const pdfPath = args[args.indexOf("--image") + 1];
        if (!pdfPath) {
          console.error("❌ PDF 파일 경로를 지정해주세요.");
          console.log(
            "사용법: node utils/pdfGenerator.js --image <PDF파일경로>",
          );
          process.exit(1);
        }

        if (!fs.existsSync(pdfPath)) {
          console.error(`❌ 파일을 찾을 수 없습니다: ${pdfPath}`);
          process.exit(1);
        }

        await convertPdfToImage(pdfPath);
        process.exit(0);
      }

      console.log("\n2. DB에서 최신 감정 데이터 조회 중...");
      const { pool } = require("../utils/DB");
      conn = await pool.getConnection();

      const [rows] = await conn.query(
        `SELECT * FROM appraisals 
        WHERE status = 'completed'
         ORDER BY created_at DESC 
         LIMIT 1`,
      );

      if (rows.length === 0) {
        throw new Error("테스트할 감정 데이터가 없습니다.");
      }

      const testAppraisal = rows[0];
      console.log(`   감정 번호: ${testAppraisal.certificate_number}`);
      console.log(`   브랜드: ${testAppraisal.brand}`);
      console.log(`   모델: ${testAppraisal.model_name}`);

      console.log("\n3. PDF 생성 중...");
      const result = await generateCertificatePDF(
        testAppraisal,
        testCoordinates,
      );

      console.log("\n✅ PDF 생성 성공!");
      console.log("   파일 경로:", result.pdfPath);
      console.log("   생성 데이터:", JSON.parse(result.pdfData));

      console.log("\n📄 생성된 PDF 파일을 확인하세요:");
      const fullPdfPath = path.join(__dirname, "../public", result.pdfPath);
      console.log("   " + fullPdfPath);

      console.log("\n💡 좌표 조정 가이드:");
      console.log("   1. 템플릿 PDF를 이미지로 변환:");
      console.log(
        `      node utils/pdfGenerator.js --image public/appr_template.pdf`,
      );
      console.log("\n   2. 생성된 이미지를 편집 프로그램에서 열기");
      console.log("   3. 원하는 위치의 좌표(x, y) 확인");
      console.log("   4. PDF 좌표로 변환:");
      console.log("      - x는 그대로 사용 (픽셀 → 포인트 변환 필요시 /2)");
      console.log("      - y = (이미지 높이 - 이미지의 y) / 2");
      console.log("\n   현재 좌표 설정:");
      console.log(JSON.stringify(testCoordinates, null, 2));

      // 자동으로 이미지 변환 제안
      console.log("\n📸 생성된 PDF를 이미지로 변환하시겠습니까?");
      console.log(`   node utils/pdfGenerator.js --image ${fullPdfPath}`);
    } catch (error) {
      console.error("\n❌ 테스트 실패:", error);
      console.error(error.stack);
    } finally {
      if (conn) conn.release();
      process.exit(0);
    }
  })();
}
