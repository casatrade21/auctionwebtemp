// utils/popbill.js
const popbill = require("popbill");
const { pool } = require("./DB");

// 팝빌 SDK 초기화
popbill.config({
  LinkID: process.env.POPBILL_LINKID,
  SecretKey: process.env.POPBILL_SECRET_KEY,
  IsTest: process.env.POPBILL_IS_TEST === "true",
  IPRestrictOnOff: true,
  UseStaticIP: false,
  UseLocalTimeYN: true,
  defaultErrorHandler: function (error) {
    console.error("Popbill Default Error:", error.code, error.message);
  },
});

const bankService = popbill.EasyFinBankService();
const taxService = popbill.TaxinvoiceService();
const cashService = popbill.CashbillService();

class PopbillService {
  constructor() {
    this.CORP_NUM = process.env.POPBILL_CORP_NUM;
    this.BANK_CODE = process.env.COMPANY_BANK_CODE;
    this.ACCOUNT_NUMBER = process.env.COMPANY_ACCOUNT_NUMBER;
  }

  /**
   * 입금 확인 (계좌조회 API) - deposit & settlement 통합
   * @param {Object} data - { amount/final_amount, depositor_name, company_name }
   * @param {String} type - 'deposit' 또는 'settlement'
   * @returns {Object|null} 매칭된 거래 또는 null
   */
  async checkTransaction(data, type, startDate, endDate) {
    try {
      const today = new Date();
      const start = this.formatDate(startDate ?? today);
      const end = this.formatDate(endDate ?? today);

      const amount = type === "deposit" ? data.amount : data.final_amount;
      const depositorName = data.depositor_name && data.depositor_name.trim();

      if (!depositorName) {
        return null;
      }

      const jobID = await this.requestBankJobHardcoded(start, end);
      await this.waitJob(jobID);
      const transactions = await this.getTransactions(jobID);

      const matched = transactions.find((t) => {
        const amountMatch = Number(t.accIn) === Number(amount);
        const nameMatch =
          this.nameMatch(depositorName, t.remark1) ||
          this.nameMatch(depositorName, t.remark2);
        return amountMatch && nameMatch;
      });

      return matched || null;
    } catch (error) {
      console.error(`❌ ${type} 확인 오류:`, error.message);
      throw error;
    }
  }

  // 하위 호환성을 위한 alias
  async checkPayment(transaction, startDate, endDate) {
    return this.checkTransaction(transaction, "deposit", startDate, endDate);
  }

  async checkSettlement(settlement, startDate, endDate) {
    return this.checkTransaction(settlement, "settlement", startDate, endDate);
  }

  /**
   * 현금영수증 발행
   * @param {Object} transaction - { id, amount, depositor_name, processed_at }
   * @param {Object} user - { email, phone, company_name }
   * @param {String} itemName - "예치금 충전" 또는 "입찰결과 정산"
   * @returns {Object} { confirmNum, tradeDate, mgtKey }
   */
  async issueCashbill(transaction, user, itemName = "예치금 충전") {
    try {
      const mgtKey = `CB-${transaction.id}-${Date.now()}`;

      // ⭐ 금액을 정수로 변환
      const amount = Math.round(parseFloat(transaction.amount));

      const cleanPhone = user.phone
        ? user.phone.replace(/-/g, "")
        : "01000001234";
      const isBusinessCustomer =
        user.business_number && user.business_number.length >= 10;
      const identityNum = isBusinessCustomer
        ? user.business_number.replace(/-/g, "")
        : cleanPhone;
      const tradeUsage = isBusinessCustomer ? "지출증빙용" : "소득공제용";

      const cashbillData = {
        mgtKey,
        tradeDT: this.formatDateTime(transaction.processed_at || new Date()),
        tradeType: "승인거래",
        tradeUsage: tradeUsage,
        taxationType: "과세",
        totalAmount: amount.toString(),
        supplyCost: Math.round(amount / 1.1).toString(),
        tax: Math.round(amount - amount / 1.1).toString(),
        serviceFee: "0",

        // 가맹점 (공급자)
        franchiseCorpNum: this.CORP_NUM.replace(/-/g, ""),
        franchiseCorpName: process.env.COMPANY_NAME,
        franchiseCEOName: process.env.COMPANY_CEO,
        franchiseAddr: process.env.COMPANY_ADDRESS,
        franchiseTEL: (process.env.COMPANY_TEL || "").replace(/-/g, ""),

        // 고객 (공급받는자)
        identityNum: identityNum,
        customerName: user.company_name || "고객명",
        itemName: itemName,
        email: user.email || "",
        hp: cleanPhone,
        smssendYN: false,
      };

      const result = await new Promise((resolve, reject) => {
        cashService.registIssue(
          this.CORP_NUM.replace(/-/g, ""),
          cashbillData,
          null,
          null,
          null,
          resolve,
          reject,
        );
      });

      return { ...result, mgtKey };
    } catch (error) {
      console.error("❌ [현금영수증 발행 오류]", error.message);
      throw error;
    }
  }

  /**
   * 세금계산서 발행
   * @param {Object} settlement - { id, settlement_date, final_amount, item_count }
   * @param {Object} user - { business_number, company_name, email }
   * @param {String} itemName - "입찰결과 정산" 등
   * @returns {Object} { ntsConfirmNum, issueDT, invoicerMgtKey }
   */
  async issueTaxinvoice(settlement, user, itemName = "입찰결과 정산") {
    try {
      if (!user.business_number) {
        throw new Error("사업자등록번호가 없습니다.");
      }

      const mgtKey = `TAX-${settlement.id}-${Date.now()}`;

      // ⭐ 금액을 정수로 변환
      const amount = Math.round(parseFloat(settlement.final_amount));

      const taxinvoiceData = {
        issueType: "정발행",
        taxType: "과세",
        chargeDirection: "정과금",
        writeDate: this.formatDate(settlement.settlement_date),
        purposeType: "영수",
        supplyCostTotal: Math.round(amount / 1.1).toString(),
        taxTotal: Math.round(amount - amount / 1.1).toString(),
        totalAmount: amount.toString(),
        invoicerMgtKey: mgtKey,

        // 공급자 (우리 회사)
        invoicerCorpNum: this.CORP_NUM.replace(/-/g, ""),
        invoicerCorpName: process.env.COMPANY_NAME,
        invoicerCEOName: process.env.COMPANY_CEO,
        invoicerAddr: process.env.COMPANY_ADDRESS,
        invoicerBizType: process.env.COMPANY_BUSINESS_TYPE,
        invoicerBizClass: process.env.COMPANY_BUSINESS_CLASS,
        invoicerTEL: (process.env.COMPANY_TEL || "").replace(/-/g, ""),

        // 공급받는자 (고객)
        invoiceeType: "사업자",
        invoiceeCorpNum: user.business_number.replace(/-/g, ""),
        invoiceeCorpName: user.company_name,
        invoiceeCEOName: user.company_name,
        invoiceeAddr: "",
        invoiceeBizType: "",
        invoiceeBizClass: "",
        invoiceeEmail1: user.email,

        // 품목
        detailList: [
          {
            serialNum: 1,
            purchaseDT: this.formatDate(settlement.settlement_date),
            itemName: itemName,
            spec: `낙찰 ${settlement.item_count || 1}건`,
            qty: "1",
            supplyCost: Math.round(amount / 1.1).toString(),
            tax: Math.round(amount - amount / 1.1).toString(),
          },
        ],
      };

      const result = await new Promise((resolve, reject) => {
        taxService.registIssue(
          this.CORP_NUM.replace(/-/g, ""),
          taxinvoiceData,
          false,
          true,
          null,
          null,
          null,
          null,
          resolve,
          reject,
        );
      });

      return { ...result, invoicerMgtKey: mgtKey };
    } catch (error) {
      console.error("❌ [세금계산서 발행 오류]", error.message);
      throw error;
    }
  }

  // ===== 내부 헬퍼 함수 =====

  requestBankJob(startDate) {
    return new Promise((resolve, reject) => {
      bankService.requestJob(
        this.CORP_NUM,
        this.BANK_CODE,
        this.ACCOUNT_NUMBER,
        this.formatDate(startDate),
        this.formatDate(new Date()),
        null,
        (jobID) => {
          console.log("- 계좌조회 요청 성공");
          resolve(jobID);
        },
        (error) => {
          console.error("- 계좌조회 요청 실패:", error.message);
          reject(error);
        },
      );
    });
  }

  requestBankJobHardcoded(startDate, endDate) {
    return new Promise((resolve, reject) => {
      bankService.requestJob(
        this.CORP_NUM,
        this.BANK_CODE,
        this.ACCOUNT_NUMBER,
        startDate,
        endDate,
        null,
        resolve,
        reject,
      );
    });
  }

  async waitJob(jobID) {
    for (let i = 0; i < 20; i++) {
      const state = await new Promise((resolve, reject) => {
        bankService.getJobState(this.CORP_NUM, jobID, null, resolve, reject);
      });

      if (state.jobState === 3) {
        return;
      }

      if (state.errorCode) {
        throw new Error(`팝빌 작업 오류: ${state.errorReason}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error("팝빌 작업 타임아웃 (10초 초과)");
  }

  getTransactions(jobID) {
    return new Promise((resolve, reject) => {
      bankService.search(
        this.CORP_NUM,
        jobID,
        [], // 모든 거래 조회 (한글 필터는 URL 인코딩 오류 발생)
        "", // 검색어 없음
        1, // 페이지
        500, // 최대 500건
        "D", // 내림차순
        null,
        (result) => {
          const deposits = (result.list || []).filter(
            (t) => t.trtype === "입금" || (Number(t.accIn) > 0 && !t.trtype),
          );
          resolve(deposits);
        },
        (error) => {
          console.error("- 거래내역 조회 실패:", error.message);
          reject(error);
        },
      );
    });
  }

  nameMatch(inputName, bankName) {
    if (
      !inputName ||
      !bankName ||
      inputName.trim() === "" ||
      bankName.trim() === ""
    ) {
      return false;
    }

    const normalize = (str) =>
      str.replace(/[\s\-()주식회사유한회사]/g, "").toLowerCase();

    const a = normalize(inputName);
    const b = normalize(bankName);

    return a.includes(b) || b.includes(a);
  }

  /**
   * 중복 매칭 방지 - TID가 이미 사용되었는지 확인
   */
  async isTransactionUsed(tid) {
    const [rows] = await pool.query(
      "SELECT id FROM used_bank_transactions WHERE tid = ?",
      [tid],
    );
    return rows.length > 0;
  }

  /**
   * 사용된 거래 기록
   */
  async markTransactionUsed(tid, tradeData, usedByType, usedById) {
    await pool.query(
      `INSERT INTO used_bank_transactions (tid, trade_dt, trade_amount, account_name, used_by_type, used_by_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        tid,
        tradeData.trdt,
        tradeData.accIn,
        tradeData.remark2 || tradeData.remark1,
        usedByType,
        usedById,
      ],
    );
  }

  formatDate(date) {
    return new Date(date).toISOString().slice(0, 10).replace(/-/g, "");
  }

  formatDateTime(date) {
    return new Date(date)
      .toISOString()
      .slice(0, 19)
      .replace(/[-:T]/g, "")
      .slice(0, 14);
  }

  // ===== 테스트/디버깅 함수 =====

  /**
   * 포인트 잔액 조회
   */
  async getBalance() {
    return new Promise((resolve, reject) => {
      cashService.getBalance(this.CORP_NUM.replace(/-/g, ""), resolve, reject);
    });
  }

  /**
   * 파트너 포인트 조회
   */
  async getPartnerBalance() {
    return new Promise((resolve, reject) => {
      cashService.getPartnerBalance(
        this.CORP_NUM.replace(/-/g, ""),
        resolve,
        reject,
      );
    });
  }

  /**
   * 현금영수증 단가 조회
   */
  async getUnitCost() {
    return new Promise((resolve, reject) => {
      cashService.getUnitCost(this.CORP_NUM.replace(/-/g, ""), resolve, reject);
    });
  }
}

module.exports = new PopbillService();
