// utils/logen.js - 로젠택배 API 래퍼
const axios = require("axios");

const IS_TEST = (process.env.LOGEN_IS_TEST || "true") === "true";
const BASE_URL = IS_TEST
  ? "https://topenapi.ilogen.com/lrm02b-edi/edi"
  : "https://openapi.ilogen.com/lrm02b-edi/edi";
const USER_ID = process.env.LOGEN_USER_ID || "";
const CUST_CD = process.env.LOGEN_CUST_CD || "";
const TIMEOUT = Number(process.env.LOGEN_TIMEOUT) || 30000;

// 발신자 기본값 (.env)
const DEFAULT_SENDER = {
  name: process.env.LOGEN_SENDER_NAME || "카사스트레이드",
  tel: process.env.LOGEN_SENDER_TEL || "",
  cell: process.env.LOGEN_SENDER_CELL || "",
  address: process.env.LOGEN_SENDER_ADDRESS || "",
};

// ── 공통 HTTP ────────────────────────────────────────

async function callAPI(endpoint, body) {
  const url = `${BASE_URL}/${endpoint}`;
  try {
    const res = await axios.post(url, body, {
      headers: { "Content-Type": "application/json" },
      timeout: TIMEOUT,
    });
    return res.data;
  } catch (error) {
    const detail = error.response
      ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
      : error.message;
    throw new Error(`[로젠 API] ${endpoint} 호출 실패: ${detail}`);
  }
}

function assertSuccess(result, label) {
  if (!result) throw new Error(`[로젠 API] ${label}: 응답 없음`);
  if (result.sttsCd === "FAIL") {
    throw new Error(`[로젠 API] ${label}: ${result.sttsMsg || "FAIL"}`);
  }
  // data 내부 resultCd 체크
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  if (data?.resultCd === "FALSE") {
    throw new Error(`[로젠 API] ${label}: ${data.resultMsg || "FALSE"}`);
  }
  return result;
}

// ── 1. 계약정보 통합조회 ─────────────────────────────

async function getContractInfo(custCd) {
  const result = await callAPI("contractTotalInfo", {
    userId: USER_ID,
    data: [{ custCd: custCd || CUST_CD }],
  });
  assertSuccess(result, "contractTotalInfo");
  const info = Array.isArray(result.data) ? result.data[0] : result.data;
  return {
    custCd: info.custCd,
    pickSalesCd: info.pickSalesCd,
    pickSalesNm: info.pickSalesNm,
    pickBranCd: info.pickBranCd,
    pickBranNm: info.pickBranNm,
    fareTy: info.fareTy,
    fareTyNm: info.fareTyNm,
    useYn: info.useYn,
  };
}

// ── 2. 송장 출력정보 통합조회 (주소 → 배송점코드) ────

async function getDeliveryInfo(address, custCd) {
  const result = await callAPI("integratedInquiry", {
    userId: USER_ID,
    data: [{ custCd: custCd || CUST_CD, addr: address }],
  });
  assertSuccess(result, "integratedInquiry");
  const info = Array.isArray(result.data) ? result.data[0] : result.data;
  return {
    branCd: info.branCd,
    dongNm: info.dongNm,
    classCd: info.classCd,
    zipCd: info.zipCd,
    jejuRegYn: info.jejuRegYn === "Y",
    shipYn: info.shipYn === "Y",
    montYn: info.montYn === "Y",
    salesNm: info.salesNm,
    tmlNm: info.tmlNm || null,
    branShareYn: info.branShareYn === "Y",
  };
}

// ── 3. 계약운임 조회 ────────────────────────────────

async function getContractFares(fareTy, custCd) {
  const result = await callAPI("contPickFares", {
    userId: USER_ID,
    data: [{ custCd: custCd || CUST_CD, fareTy }],
  });
  assertSuccess(result, "contPickFares");
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  const fares = (data.data1 || []).map((f) => ({
    boxTypeCd: f.boxTyCd,
    boxTypeName: f.boxTyNm,
    dlvFare: Number(f.dlvFare) || 0,
  }));
  return { fareTy: data.fareTy, custCd: data.custCd, fares };
}

// ── 4. 송장번호 채번 ────────────────────────────────

async function issueSlipNumbers(qty = 1) {
  const result = await callAPI("getSlipNo", {
    userId: USER_ID,
    data: [{ slipQty: qty }],
  });
  assertSuccess(result, "getSlipNo");

  // 채번 결과 파싱 (API 응답 구조에 따라 분기)
  const slipNumbers = [];
  if (result.data1 && Array.isArray(result.data1)) {
    result.data1.forEach((d) => {
      if (d.slipNo) slipNumbers.push(d.slipNo);
    });
  }
  if (slipNumbers.length === 0 && result.data?.startSlipNo) {
    // range 형태 응답: startSlipNo ~ closeSlipNo
    slipNumbers.push(result.data.startSlipNo);
  }
  return {
    slipNumbers,
    startSlipNo: result.data?.startSlipNo || slipNumbers[0] || null,
    closeSlipNo: result.data?.closeSlipNo || null,
    raw: result,
  };
}

// ── 5. 주문 정보 등록 (슬립 출력) ───────────────────

async function registerOrder(orderData) {
  /*
    orderData: {
      slipNo, rcvBranCd, fareTy,
      sndCustNm, sndTelNo, sndCellNo, sndCustAddr1, sndCustAddr2,
      rcvCustNm, rcvTelNo, rcvCellNo, rcvCustAddr1, rcvCustAddr2,
      goodsNm, dlvFare, extraFare, goodsAmt,
      takeDt (YYYYMMDD), fixTakeNo, remarks,
      jejuAmtTy, shipYn, jejuAmt, shipFare, montFare, wt
    }
  */
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const payload = {
    printYn: "Y", // 자체출력
    slipNo: orderData.slipNo,
    slipTy: "100",
    orgnSlipNo: "",
    custCd: orderData.custCd || CUST_CD,
    // 송하인
    sndCustNm: orderData.sndCustNm || DEFAULT_SENDER.name,
    sndTelNo: orderData.sndTelNo || DEFAULT_SENDER.tel,
    sndCellNo: orderData.sndCellNo || DEFAULT_SENDER.cell,
    sndZipCd: "",
    sndCustAddr1: orderData.sndCustAddr1 || DEFAULT_SENDER.address,
    sndCustAddr2: orderData.sndCustAddr2 || "",
    // 수하인
    rcvCustNm: orderData.rcvCustNm,
    rcvTelNo: orderData.rcvTelNo,
    rcvCellNo: orderData.rcvCellNo || "",
    rcvZipCd: "",
    rcvCustAddr1: orderData.rcvCustAddr1,
    rcvCustAddr2: orderData.rcvCustAddr2 || "",
    // 배송
    fareTy: orderData.fareTy || "040",
    qty: 1,
    rcvBranCd: orderData.rcvBranCd,
    goodsNm: orderData.goodsNm || "",
    dlvFare: orderData.dlvFare || 0,
    extraFare: orderData.extraFare || 0,
    goodsAmt: orderData.goodsAmt || 0,
    jejuAmtTy: orderData.jejuAmtTy || "",
    shipYn: orderData.shipYn || "N",
    takeDt: orderData.takeDt || today,
    remarks: orderData.remarks || "",
    fixTakeNo: orderData.fixTakeNo || "",
    jejuAmt: orderData.jejuAmt || 0,
    shipFare: orderData.shipFare || 0,
    montFare: orderData.montFare || 0,
    wt: orderData.wt || 0,
  };

  const result = await callAPI("slipPrintM", {
    userId: USER_ID,
    data: [payload],
  });
  assertSuccess(result, "slipPrintM");

  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  return {
    slipNo: data?.slipNo || orderData.slipNo,
    resultCd: data?.resultCd,
    resultMsg: data?.resultMsg,
  };
}

// ── 6. 화물추적 조회 (상세) ─────────────────────────

async function trackPackage(slipNo) {
  const result = await callAPI("inquiryCargoTrackingMulti", {
    userId: USER_ID,
    data: [{ slipNo }],
  });
  assertSuccess(result, "inquiryCargoTrackingMulti");

  const shipment = Array.isArray(result.data) ? result.data[0] : result.data;
  const details = (shipment?.data1 || []).map((d) => ({
    scanDate: d.scanDt || "",
    scanTime: d.scanTm || "",
    statusName: d.statNm || "",
    branchCode: d.branCd || "",
    branchName: d.branNm || "",
    salesCode: d.salesCd || "",
    salesName: d.salesNm || "",
    acceptorType: d.acptorTyNm || "",
  }));

  // 마지막 상태로 배송 상태 판별
  const lastDetail = details.length > 0 ? details[details.length - 1] : null;

  return {
    slipNo: shipment?.slipNo || slipNo,
    details,
    lastStatus: lastDetail?.statusName || null,
    isDelivered: lastDetail?.statusName === "배송완료",
    deliveredAt:
      lastDetail?.statusName === "배송완료"
        ? formatScanDateTime(lastDetail.scanDate, lastDetail.scanTime)
        : null,
  };
}

// ── 7. 최종 화물추적 조회 ──────────────────────────

async function trackPackageLast(slipNos) {
  // slipNos: string | string[]
  const list = Array.isArray(slipNos) ? slipNos : [slipNos];
  const result = await callAPI("inquiryCargoTrackingMultiLast", {
    userId: USER_ID,
    data: list.map((no) => ({ slipNo: no })),
  });
  assertSuccess(result, "inquiryCargoTrackingMultiLast");

  const shipments = Array.isArray(result.data) ? result.data : [result.data];
  return shipments.map((s) => ({
    slipNo: s.slipNo,
    scanDate: s.scanDt || "",
    scanTime: s.scanTm || "",
    statusName: s.statNm || "",
    branchName: s.branNm || "",
    salesName: s.salesNm || "",
    salesPhone: s.salesCellNo || "",
    isDelivered: s.statNm === "배송완료",
  }));
}

// ── 배송 상태 매핑 ──────────────────────────────────

const STATUS_MAP = {
  집하: "picked_up",
  간선상차: "in_transit",
  간선하차: "in_transit",
  배달지도착: "out_for_delivery",
  배송출발: "out_for_delivery",
  배송완료: "delivered",
  반송: "returned",
  미배달: "failed",
};

function mapLogenStatus(statNm) {
  if (!statNm) return "order_registered";
  // 정확 매칭
  if (STATUS_MAP[statNm]) return STATUS_MAP[statNm];
  // 부분 매칭
  if (statNm.includes("배송완료")) return "delivered";
  if (statNm.includes("배달") || statNm.includes("배송출발"))
    return "out_for_delivery";
  if (
    statNm.includes("간선") ||
    statNm.includes("상차") ||
    statNm.includes("하차")
  )
    return "in_transit";
  if (statNm.includes("집하")) return "picked_up";
  if (statNm.includes("반송")) return "returned";
  return "in_transit";
}

// ── 유틸 ────────────────────────────────────────────

function formatScanDateTime(scanDt, scanTm) {
  if (!scanDt) return null;
  const y = scanDt.slice(0, 4);
  const m = scanDt.slice(4, 6);
  const d = scanDt.slice(6, 8);
  const hh = scanTm ? scanTm.slice(0, 2) : "00";
  const mm = scanTm ? scanTm.slice(2, 4) : "00";
  const ss = scanTm ? scanTm.slice(4, 6) : "00";
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function isConfigured() {
  return !!(USER_ID && CUST_CD);
}

module.exports = {
  // 설정
  isConfigured,
  BASE_URL,
  USER_ID,
  CUST_CD,
  DEFAULT_SENDER,
  // API
  getContractInfo,
  getDeliveryInfo,
  getContractFares,
  issueSlipNumbers,
  registerOrder,
  trackPackage,
  trackPackageLast,
  // 유틸
  mapLogenStatus,
  formatScanDateTime,
  STATUS_MAP,
};
