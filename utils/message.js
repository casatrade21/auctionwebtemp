// utils/message.js
const axios = require("axios");
const { pool } = require("./DB");
const cron = require("node-cron");
require("dotenv").config();

const MAX_PARAM_LENGTH = 40;
const ACCOUNT_TEXT = `국민은행 024801-04-544857
황승하(까사플랫폼)`;

// 유저 전화번호 조회 함수
async function getUsersWithPhone(userIds) {
  if (!userIds || userIds.length === 0) return [];

  const connection = await pool.getConnection();
  try {
    const placeholders = userIds.map(() => "?").join(",");
    const [users] = await connection.query(
      `SELECT id, phone FROM users WHERE id IN (${placeholders}) AND phone IS NOT NULL AND phone != ''`,
      userIds,
    );
    return users;
  } catch (error) {
    console.error("Error fetching users with phone:", error);
    return [];
  } finally {
    connection.release();
  }
}

// 안전한 메시지 발송 함수
async function safeSendMessage(messageService, method, messages, context = "") {
  if (!messages || messages.length === 0) {
    console.log(`No messages to send for ${context}`);
    return;
  }

  try {
    const result = await messageService[method](messages);
    console.log(`${context} message result:`, {
      success: result.success,
      successCount: result.successCount,
      errorCount: result.errorCount,
    });
    return result;
  } catch (error) {
    console.error(`Error sending ${context} message:`, error);
    return { success: false, error: error.message };
  }
}

class MessageService {
  constructor({ apiKey, userId, sender, senderKey }) {
    this.apiKey = apiKey;
    this.userId = userId;
    this.sender = sender;
    this.senderKey = senderKey;
    this.baseUrl = "https://kakaoapi.aligo.in/akv10/alimtalk/send/";
  }

  formatMessage(template, params) {
    let message = template;
    Object.entries(params).forEach(([key, value]) => {
      const truncatedValue =
        value && value.length > MAX_PARAM_LENGTH
          ? value.substring(0, MAX_PARAM_LENGTH) + "..."
          : value;
      message = message.replace(`#{${key}}`, truncatedValue);
    });
    return message;
  }

  async sendKakaoMessage(messages, config) {
    try {
      const formData = new URLSearchParams({
        apikey: this.apiKey,
        userid: this.userId,
        senderkey: this.senderKey,
        tpl_code: config.templateCode,
        sender: this.sender,
        failover: "N",
        testMode: "N",
      });

      messages.forEach(({ phone, params }, index) => {
        const num = index + 1;
        formData.append(`receiver_${num}`, phone);
        formData.append(`subject_${num}`, config.subject);
        formData.append(
          `emtitle_${num}`,
          this.formatMessage(config.emtitle, params),
        );
        formData.append(
          `message_${num}`,
          this.formatMessage(config.message, params),
        );

        if (config.fmessage) {
          formData.append(
            `fmessage_${num}`,
            this.formatMessage(config.fmessage, params),
          );
        }

        if (config.buttons) {
          formData.append(
            `button_${num}`,
            JSON.stringify({ button: config.buttons }),
          );
        }
      });

      const response = await axios.post(this.baseUrl, formData.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      return {
        success: response.data.code === 0,
        successCount: response.data.info.scnt,
        errorCount: response.data.info.fcnt,
        messages,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        messages,
      };
    }
  }

  // 낙찰 완료 알림
  async sendWinningNotification(messages) {
    const config = {
      templateCode: "UC_2621",
      subject: "낙찰완료",
      emtitle: "#{날짜} 경매 #{건수}건 낙찰",
      message: `#{고객명}님 #{날짜}입찰하신 상품중 #{건수}건 낙찰되었습니다.

#{계좌텍스트}`,
      fmessage: `#{고객명}님 #{날짜}입찰하신 상품중 #{건수}건 낙찰되었습니다.

#{계좌텍스트}`,
      buttons: [
        {
          name: "채널추가",
          linkType: "AC",
          linkTypeName: "채널 추가",
        },
        {
          name: "입찰결과 페이지",
          linkType: "WL",
          linkTypeName: "웹링크",
          linkPc: "https://casastrade.com/bidResultsPage",
          linkMo: "https://casastrade.com/bidResultsPage",
        },
      ],
    };

    return this.sendKakaoMessage(messages, config);
  }

  // 최종 입찰 요청
  async sendFinalBidRequest(messages) {
    const config = {
      templateCode: "UB_8707",
      subject: "2차제안금액",
      emtitle: "최종금액 입찰 요청",
      message: `#{고객명}님 입찰하신 현장경매 모든상품에 대한 제안금액이 업데이트 되었습니다.

입찰하실 상품에 한하여 최종입찰 부탁드립니다:)
감사합니다:)`,
      fmessage: `2차 제안가 등록 완료
최종금액 입찰 요청

#{고객명}님 입찰하신 현장경매 모든상품에 대한 제안금액이 업데이트 되었습니다.

입찰하실 상품에 한하여 최종입찰 부탁드립니다:)
감사합니다:)

해당 제안 금액 업데이트 알림 메시지는 고객님의 알림 신청에 의해 발송됩니다.`,
      buttons: [
        {
          name: "채널추가",
          linkType: "AC",
          linkTypeName: "채널 추가",
        },
        {
          name: "입찰",
          linkType: "WL",
          linkTypeName: "웹링크",
          linkPc: "https://casastrade.com/bidProductsPage?bidType=live",
          linkMo: "https://casastrade.com/bidProductsPage?bidType=live",
        },
      ],
    };

    return this.sendKakaoMessage(messages, config);
  }

  // 더 높은 입찰 알림
  async sendHigherBidAlert(messages) {
    const config = {
      templateCode: "UB_8489",
      subject: "더높은입찰",
      emtitle: "#{상품명}",
      message:
        "입찰하신 #{상품명}에 입찰하신 금액보다 높은 입찰이 발생하였습니다.",
      buttons: [
        {
          name: "입찰 항목",
          linkType: "WL",
          linkTypeName: "웹링크",
          linkPc: "https://casastrade.com/bidProductsPage",
          linkMo: "https://casastrade.com/bidProductsPage",
        },
      ],
    };

    return this.sendKakaoMessage(messages, config);
  }
}

// 인스턴스 생성 팩토리 함수
function createMessageService() {
  return new MessageService({
    apiKey: process.env.SMS_API_KEY,
    userId: process.env.SMS_USER_ID,
    sender: process.env.SMS_SENDER,
    senderKey: process.env.CASATRADE_SENDER_KEY,
  });
}

// 비즈니스 로직별 메시지 발송 함수들

// 낙찰 완료 알림 발송
async function sendWinningNotifications(completedBids) {
  const messageService = createMessageService();
  const userIds = [...new Set(completedBids.map((bid) => bid.user_id))];
  const users = await getUsersWithPhone(userIds);

  if (users.length === 0) return;

  const messages = [];

  // 유저별, 날짜별로 그룹핑
  users.forEach((user) => {
    const userBids = completedBids.filter((bid) => bid.user_id === user.id);

    // 날짜별로 그룹핑
    const bidsByDate = userBids.reduce((acc, bid) => {
      const bidDate = bid.scheduled_date
        ? new Date(bid.scheduled_date).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0];

      if (!acc[bidDate]) {
        acc[bidDate] = [];
      }
      acc[bidDate].push(bid);
      return acc;
    }, {});

    // 각 날짜별로 메시지 생성
    Object.entries(bidsByDate).forEach(([date, dateBids]) => {
      const bidCount = dateBids.length;

      messages.push({
        phone: user.phone,
        params: {
          날짜: date,
          고객명: user.id,
          건수: bidCount.toString(),
          계좌텍스트: ACCOUNT_TEXT,
        },
      });
    });
  });

  return await safeSendMessage(
    messageService,
    "sendWinningNotification",
    messages,
    "winning notification",
  );
}

// 최종 입찰 요청 발송
async function sendFinalBidRequests(secondBids) {
  const messageService = createMessageService();
  const userIds = [...new Set(secondBids.map((bid) => bid.user_id))];
  const users = await getUsersWithPhone(userIds);

  if (users.length === 0) return;

  const messages = users.map((user) => ({
    phone: user.phone,
    params: {
      고객명: user.id,
    },
  }));

  return await safeSendMessage(
    messageService,
    "sendFinalBidRequest",
    messages,
    "final bid request",
  );
}

// 더 높은 입찰 알림 발송
async function sendHigherBidAlerts(cancelledBids) {
  const messageService = createMessageService();
  const userIds = [...new Set(cancelledBids.map((bid) => bid.user_id))];
  const users = await getUsersWithPhone(userIds);

  if (users.length === 0) return;

  const messages = users.map((user) => {
    const userBid = cancelledBids.find((bid) => bid.user_id === user.id);
    return {
      phone: user.phone,
      params: {
        상품명: userBid.title || userBid.item_id,
      },
    };
  });

  return await safeSendMessage(
    messageService,
    "sendHigherBidAlert",
    messages,
    "higher bid alert",
  );
}

async function sendDailyWinningNotifications() {
  const connection = await pool.getConnection();

  try {
    // 발송되지 않은 완료된 live 입찰들 조회
    const [liveBids] = await connection.query(`
      SELECT 'live' as bid_type, l.id as bid_id, l.user_id, 
             i.title, i.scheduled_date
      FROM live_bids l
      JOIN crawled_items i ON l.item_id = i.item_id
      WHERE l.status IN ('completed', 'shipped')
        AND l.notification_sent_at IS NULL
        AND COALESCE(l.winning_price, l.final_price) > 0
    `);

    // 발송되지 않은 완료된 direct 입찰들 조회
    const [directBids] = await connection.query(`
      SELECT 'direct' as bid_type, d.id as bid_id, d.user_id,
             i.title, i.scheduled_date
      FROM direct_bids d
      JOIN crawled_items i ON d.item_id = i.item_id
      WHERE d.status IN ('completed', 'shipped')
        AND d.notification_sent_at IS NULL
        AND d.winning_price > 0
    `);

    // 발송되지 않은 완료된 instant 구매들 조회
    const [instantPurchases] = await connection.query(`
      SELECT 'instant' as bid_type, p.id as bid_id, p.user_id,
             i.title, i.scheduled_date
      FROM instant_purchases p
      JOIN crawled_items i ON p.item_id = i.item_id
      WHERE p.status IN ('completed', 'shipped')
        AND p.notification_sent_at IS NULL
        AND p.purchase_price > 0
    `);

    const completedBids = [...liveBids, ...directBids, ...instantPurchases];

    if (completedBids.length === 0) {
      console.log("No completed bids to notify");
      return;
    }

    // 기존 sendWinningNotifications 함수 재사용 (필드명 통일된 데이터로)
    const result = await sendWinningNotifications(completedBids);

    if (result && result.success) {
      // 발송 완료 플래그 업데이트 (내부적으로 live/direct 구분)
      await updateNotificationTimestamp(connection, completedBids);
    }
  } catch (error) {
    console.error("Error in daily winning notifications:", error);
  } finally {
    connection.release();
  }
}

async function updateNotificationTimestamp(connection, bids) {
  const now = new Date();

  const liveBids = bids.filter((b) => b.bid_type === "live");
  const directBids = bids.filter((b) => b.bid_type === "direct");

  if (liveBids.length > 0) {
    const liveIds = liveBids.map((b) => b.bid_id);
    const placeholders = liveIds.map(() => "?").join(",");
    await connection.query(
      `UPDATE live_bids SET notification_sent_at = ? WHERE id IN (${placeholders})`,
      [now, ...liveIds],
    );
  }

  if (directBids.length > 0) {
    const directIds = directBids.map((b) => b.bid_id);
    const placeholders = directIds.map(() => "?").join(",");
    await connection.query(
      `UPDATE direct_bids SET notification_sent_at = ? WHERE id IN (${placeholders})`,
      [now, ...directIds],
    );
  }

  const instantBids = bids.filter((b) => b.bid_type === "instant");
  if (instantBids.length > 0) {
    const instantIds = instantBids.map((b) => b.bid_id);
    const placeholders = instantIds.map(() => "?").join(",");
    await connection.query(
      `UPDATE instant_purchases SET notification_sent_at = ? WHERE id IN (${placeholders})`,
      [now, ...instantIds],
    );
  }

  console.log(`Updated notification timestamp for ${bids.length} bids`);
}

async function sendDailyFinalBidReminders() {
  const connection = await pool.getConnection();

  try {
    // 내일 경매인데 아직 final_price가 없는 second 상태 입찰들 조회
    const [secondBids] = await connection.query(`
      SELECT l.id as bid_id, l.user_id
      FROM live_bids l
      JOIN crawled_items i ON l.item_id = i.item_id
      WHERE l.status = 'second'
        AND l.request_sent_at IS NULL
        AND DATE(i.scheduled_date) <= DATE(DATE_ADD(NOW(), INTERVAL 1 DAY))
        AND DATE(i.scheduled_date) >= DATE(NOW())
    `);

    if (secondBids.length === 0) {
      console.log("No second bids to remind for tomorrow's auction");
      return;
    }

    // 기존 sendFinalBidRequests 함수 재사용
    const result = await sendFinalBidRequests(secondBids);

    if (result && result.success) {
      // 발송 완료 플래그 업데이트
      const bidIds = secondBids.map((b) => b.bid_id);
      const placeholders = bidIds.map(() => "?").join(",");
      const now = new Date();

      await connection.query(
        `UPDATE live_bids SET request_sent_at = ? WHERE id IN (${placeholders})`,
        [now, ...bidIds],
      );

      console.log(`Updated request_sent_at for ${bidIds.length} second bids`);
    }
  } catch (error) {
    console.error("Error in daily final bid reminders:", error);
  } finally {
    connection.release();
  }
}

// 평일(월-금) 16시에 실행
cron.schedule("0 16 * * 1-5", async () => {
  console.log("Starting daily winning notifications...");
  await sendDailyWinningNotifications();
});

// 매일 18시에 실행
cron.schedule("0 18 * * *", async () => {
  console.log("Starting daily final bid reminders...");
  await sendDailyFinalBidReminders();
});

module.exports = {
  MessageService,
  createMessageService,
  sendWinningNotifications,
  sendFinalBidRequests,
  sendHigherBidAlerts,
};
