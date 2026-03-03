// routes/detail.js
const express = require("express");
const router = express.Router();
const { processItem } = require("../utils/processItem"); // 경로는 실제 위치에 맞게 조정하세요
const { TranslateClient, TranslateTextCommand } = require("@aws-sdk/client-translate");

const translateClient = new TranslateClient({
  region: process.env.AWS_REGION || "ap-northeast-2",
});
const descriptionKoCache = new Map();
const DESCRIPTION_CACHE_LIMIT = 500;

function isKoreanText(text = "") {
  return /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(String(text));
}

function setDescriptionCache(sourceText, translatedText) {
  if (!sourceText || !translatedText) return;
  if (descriptionKoCache.has(sourceText)) {
    descriptionKoCache.delete(sourceText);
  }
  descriptionKoCache.set(sourceText, translatedText);
  if (descriptionKoCache.size > DESCRIPTION_CACHE_LIMIT) {
    const oldestKey = descriptionKoCache.keys().next().value;
    descriptionKoCache.delete(oldestKey);
  }
}

async function translateDescriptionToKo(text) {
  const sourceText = String(text || "").trim();
  if (!sourceText) return "";
  if (isKoreanText(sourceText)) return sourceText;
  if (descriptionKoCache.has(sourceText)) return descriptionKoCache.get(sourceText);

  try {
    const result = await translateClient.send(
      new TranslateTextCommand({
        Text: sourceText,
        SourceLanguageCode: "auto",
        TargetLanguageCode: "ko",
      }),
    );
    const translated = result?.TranslatedText || sourceText;
    setDescriptionCache(sourceText, translated);
    return translated;
  } catch (error) {
    console.error("[detail] description ko translate failed:", error?.message || error);
    return sourceText;
  }
}

// 일반 아이템 상세 정보 요청 처리
router.post("/item-details/:itemId", async (req, res) => {
  // async 추가
  try {
    const { itemId } = req.params;
    const { aucNum, translateDescription } = req.body || {};
    const shouldTranslateKo = String(translateDescription || "").toLowerCase() === "ko";
    // 세션에서 사용자 ID 가져오기 (로그인하지 않았으면 undefined)
    const userId = req.session?.user?.id; // 옵셔널 체이닝 사용

    // 한국어 번역 요청이 아니면 기존 동작을 그대로 사용
    if (!shouldTranslateKo) {
      await processItem(itemId, false, res, false, userId, 1, aucNum);
      return;
    }

    // 한국어 번역 요청 시 응답 데이터를 받아 description_ko를 추가해서 반환
    const item = await processItem(itemId, false, null, true, userId, 1, aucNum);
    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }
    const descriptionKo = await translateDescriptionToKo(item.description || "");
    return res.json({
      ...item,
      description_ko: descriptionKo || item.description || "",
    });
  } catch (error) {
    // 혹시 processItem 호출 전에 에러가 발생할 경우 대비
    console.error("Error in /item-details/:itemId route:", error);
    if (!res.headersSent) {
      // 응답이 아직 전송되지 않았다면 에러 응답 전송
      res
        .status(500)
        .json({ message: "Error processing item details request" });
    }
  }
});

// 가치평가 아이템 상세 정보 요청 처리
router.post("/value-details/:itemId", async (req, res) => {
  // async 추가
  try {
    const { itemId } = req.params;
    // 세션에서 사용자 ID 가져오기 (로그인하지 않았으면 undefined)
    const userId = req.session?.user?.id; // 옵셔널 체이닝 사용

    // processItem 호출 시 userId 전달
    await processItem(itemId, true, res, false, userId, 1);
  } catch (error) {
    console.error("Error in /value-details/:itemId route:", error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ message: "Error processing value details request" });
    }
  }
});

module.exports = router;
