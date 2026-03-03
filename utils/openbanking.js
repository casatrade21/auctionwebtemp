// utils/openbanking.js
const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();

const OPENBANKING_BASE_URL =
  process.env.OPENBANKING_BASE_URL || "https://openapi.openbanking.or.kr";
const CLIENT_ID = process.env.OPENBANKING_CLIENT_ID;
const CLIENT_SECRET = process.env.OPENBANKING_CLIENT_SECRET;
const REDIRECT_URI = process.env.OPENBANKING_REDIRECT_URI;
const USE_CODE = process.env.OPENBANKING_USE_CODE;
const COMPANY_ACCOUNT_NUM = process.env.COMPANY_ACCOUNT_NUM;

/**
 * 1. OAuth 인증 URL 생성 (수동 문자열 조합)
 * - URLSearchParams 사용 금지 (공백을 +로 바꾸는 문제 해결)
 * - encodeURIComponent 사용 (공백을 %20으로 바꿈)
 */
function generateAuthUrl(state) {
  // 스코프: 공백을 명시적으로 %20으로 변환
  const scope = "login inquiry transfer".replace(/ /g, "%20");

  // 리다이렉트 URI: 특수문자(: /) 인코딩
  const encodedRedirectUri = encodeURIComponent(REDIRECT_URI);

  // 문자열 직접 조합 (가장 안전)
  return (
    `${OPENBANKING_BASE_URL}/oauth/2.0/authorize?` +
    `response_type=code` +
    `&client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodedRedirectUri}` +
    `&scope=${scope}` +
    `&state=${state}` +
    `&auth_type=0`
  );
}

/**
 * 2. 토큰 발급 요청
 */
async function handleCallback(code) {
  try {
    // POST 요청의 Body는 URLSearchParams 사용해도 무방 (x-www-form-urlencoded 표준)
    const params = new URLSearchParams();
    params.append("code", code);
    params.append("client_id", CLIENT_ID);
    params.append("client_secret", CLIENT_SECRET);
    params.append("redirect_uri", REDIRECT_URI);
    params.append("grant_type", "authorization_code");

    const response = await axios.post(
      `${OPENBANKING_BASE_URL}/oauth/2.0/token`,
      params,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    return response.data;
  } catch (error) {
    console.error("Token Error:", error.response?.data || error.message);
    throw new Error(error.response?.data?.rsp_message || "토큰 발급 실패");
  }
}

/**
 * 3. 사용자 계좌 조회 (핀테크이용번호 획득)
 */
async function registerUserAccount(accessToken, userSeqNo) {
  try {
    const response = await axios.get(`${OPENBANKING_BASE_URL}/v2.0/user/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { user_seq_no: userSeqNo },
    });

    // 출금 가능한 첫 번째 계좌 찾기
    const account = response.data.res_list.find(
      (acc) => acc.inquiry_agree_yn === "Y" && acc.transfer_agree_yn === "Y",
    );

    // 계좌가 없으면 목록의 첫 번째라도 반환
    const targetAccount = account || response.data.res_list[0];

    if (!targetAccount) {
      throw new Error("등록된 계좌가 없습니다.");
    }

    return {
      fintech_use_num: targetAccount.fintech_use_num,
      account_list: response.data.res_list,
    };
  } catch (error) {
    console.error("User Info Error:", error.response?.data || error.message);
    throw new Error("사용자 정보 조회 실패");
  }
}

/**
 * 4. 출금이체 (충전)
 */
async function withdrawTransfer(
  accessToken,
  fintechUseNum,
  amount,
  memo = "충전",
) {
  // 9자리 난수 생성
  const randomStr = Math.random()
    .toString(36)
    .substring(2, 11)
    .toUpperCase()
    .padEnd(9, "0");
  const tranId = `${USE_CODE}U${randomStr}`;

  // 현재 시간
  const now = new Date();
  const tranDtime = now
    .toISOString()
    .replace(/[-:T.]/g, "")
    .slice(0, 14); // YYYYMMDDHHmmss

  try {
    const requestBody = {
      bank_tran_id: tranId,
      cntr_account_type: "N",
      cntr_account_num: COMPANY_ACCOUNT_NUM,
      dps_print_content: memo.slice(0, 10),
      fintech_use_num: fintechUseNum,
      tran_amt: amount.toString(),
      tran_dtime: tranDtime,
      req_client_name: "MYSERVICE",
      req_client_fintech_use_num: fintechUseNum,
      req_client_num: "USER1234",
      transfer_purpose: "TR",
      recv_client_name: "CORP",
      recv_client_bank_code: "097",
      recv_client_account_num: COMPANY_ACCOUNT_NUM,
    };

    const response = await axios.post(
      `${OPENBANKING_BASE_URL}/v2.0/transfer/withdraw/fin_num`,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      },
    );

    if (response.data.rsp_code !== "A0000") {
      throw new Error(
        `[${response.data.rsp_code}] ${response.data.rsp_message}`,
      );
    }

    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.rsp_message || error.message);
  }
}

module.exports = {
  generateAuthUrl,
  handleCallback,
  registerUserAccount,
  withdrawTransfer,
};
