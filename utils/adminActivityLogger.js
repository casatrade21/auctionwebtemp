const { pool } = require("./DB");
const { isAdminUser } = require("./adminAuth");

const TRACKED_PREFIXES = [
  "/api/admin",
  "/api/live-bids",
  "/api/direct-bids",
  "/api/instant-purchases",
  "/api/wms",
  "/api/repair-management",
  "/api/deposits",
  "/api/popbill",
  "/api/crawler",
  "/api/bid-results",
];

const MENU_RULES = [
  { prefix: "/api/wms", menu: "WMS" },
  { prefix: "/api/repair-management", menu: "수선관리" },
  { prefix: "/api/live-bids", menu: "현장경매" },
  { prefix: "/api/direct-bids", menu: "직접경매" },
  { prefix: "/api/instant-purchases", menu: "바로구매" },
  { prefix: "/api/bid-results", menu: "입찰결과/정산" },
  { prefix: "/api/admin", menu: "관리자설정" },
  { prefix: "/api/deposits", menu: "입금/정산" },
  { prefix: "/api/popbill", menu: "팝빌" },
  { prefix: "/api/crawler", menu: "크롤러" },
];

let ensureTablePromise = null;

function guessMenu(path) {
  const matched = MENU_RULES.find((rule) => path.startsWith(rule.prefix));
  return matched ? matched.menu : "기타";
}

function compactValue(v) {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 80)}...` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.join(", ");
  return "[object]";
}

function humanWmsZone(code) {
  const map = {
    DOMESTIC_ARRIVAL_ZONE: "국내도착존",
    REPAIR_TEAM_CHECK_ZONE: "수선팀검수중존",
    AUTH_ZONE: "감정출력존",
    INTERNAL_REPAIR_ZONE: "내부수선존",
    EXTERNAL_REPAIR_ZONE: "외부수선존",
    REPAIR_DONE_ZONE: "수선완료존",
    HOLD_ZONE: "HOLD존",
    OUTBOUND_ZONE: "출고존",
  };
  const key = String(code || "").trim();
  if (!key) return "";
  return map[key] ? `${map[key]}(${key})` : key;
}

function buildHumanAction(req) {
  const path = req.path || "";
  const body = req.body || {};
  const menu = guessMenu(path);

  let title = `${req.method} 작업`;
  const summaryParts = [];

  if (path === "/api/wms/scan") {
    title = "WMS 스캔 처리";
    if (body.barcode)
      summaryParts.push(`바코드: ${compactValue(body.barcode)}`);
    if (body.toLocationCode || body.locationCode) {
      summaryParts.push(
        `이동존: ${compactValue(humanWmsZone(body.toLocationCode || body.locationCode))}`,
      );
    }
    if (body.actionType)
      summaryParts.push(`처리유형: ${compactValue(body.actionType)}`);
  } else if (path === "/api/wms/items") {
    title = "WMS 물건 등록";
    if (body.externalBarcode)
      summaryParts.push(`외부바코드: ${compactValue(body.externalBarcode)}`);
    if (body.internalBarcode)
      summaryParts.push(`내부바코드: ${compactValue(body.internalBarcode)}`);
  } else if (path === "/api/wms/auction-labels") {
    title = "내부바코드 생성/출력";
    if (Array.isArray(body.items))
      summaryParts.push(`선택건수: ${body.items.length}건`);
    if (body.scheduledDate)
      summaryParts.push(`날짜: ${compactValue(body.scheduledDate)}`);
    if (body.aucNum) summaryParts.push(`경매장: ${compactValue(body.aucNum)}`);
  } else if (path === "/api/repair-management/cases") {
    title = "수선 제안 등록";
    if (body.internalBarcode)
      summaryParts.push(`내부바코드: ${compactValue(body.internalBarcode)}`);
    if (body.repairType)
      summaryParts.push(`수선구분: ${compactValue(body.repairType)}`);
    if (body.vendorName)
      summaryParts.push(`외주업체: ${compactValue(body.vendorName)}`);
    if (body.amount) summaryParts.push(`금액: ${compactValue(body.amount)}원`);
  } else if (path === "/api/repair-management/vendors") {
    title = "외주업체 추가";
    if (body.vendorName)
      summaryParts.push(`업체명: ${compactValue(body.vendorName)}`);
  } else if (
    /^\/api\/admin\/admin-accounts$/.test(path) &&
    req.method === "POST"
  ) {
    title = "관리자 계정 생성";
    if (body.loginId)
      summaryParts.push(`아이디: ${compactValue(body.loginId)}`);
    if (body.name) summaryParts.push(`담당자: ${compactValue(body.name)}`);
  } else if (
    /^\/api\/admin\/admin-accounts\/\d+\/permissions$/.test(path) &&
    req.method === "PUT"
  ) {
    title = "관리자 권한 변경";
    if (Array.isArray(body.allowedMenus)) {
      summaryParts.push(`권한: ${body.allowedMenus.join(", ")}`);
    }
  } else if (
    /^\/api\/admin\/admin-accounts\/\d+\/password$/.test(path) &&
    req.method === "PUT"
  ) {
    title = "관리자 비밀번호 변경";
  } else if (
    /^\/api\/admin\/admin-accounts\/\d+$/.test(path) &&
    req.method === "DELETE"
  ) {
    title = "관리자 계정 삭제";
  } else if (
    /^\/api\/live-bids\/complete$/.test(path) &&
    req.method === "PUT"
  ) {
    title = "현장경매 낙찰완료 처리";
    if (Array.isArray(body.bidIds))
      summaryParts.push(`처리건수: ${body.bidIds.length}건`);
  } else if (
    /^\/api\/direct-bids\/complete$/.test(path) &&
    req.method === "PUT"
  ) {
    title = "직접경매 낙찰완료 처리";
    if (Array.isArray(body.bidIds))
      summaryParts.push(`처리건수: ${body.bidIds.length}건`);
  } else if (/^\/api\/live-bids\/cancel$/.test(path) && req.method === "PUT") {
    title = "현장경매 낙찰실패 처리";
    if (Array.isArray(body.bidIds))
      summaryParts.push(`처리건수: ${body.bidIds.length}건`);
  } else if (
    /^\/api\/direct-bids\/cancel$/.test(path) &&
    req.method === "PUT"
  ) {
    title = "직접경매 낙찰실패 처리";
    if (Array.isArray(body.bidIds))
      summaryParts.push(`처리건수: ${body.bidIds.length}건`);
  } else if (
    /^\/api\/instant-purchases\/cancel$/.test(path) &&
    req.method === "PUT"
  ) {
    title = "바로구매 취소 처리";
    if (Array.isArray(body.purchaseIds))
      summaryParts.push(`처리건수: ${body.purchaseIds.length}건`);
  } else if (
    /^\/api\/instant-purchases\/shipping-status$/.test(path) &&
    req.method === "PUT"
  ) {
    title = "바로구매 배송상태 변경";
    if (body.shippingStatus)
      summaryParts.push(`상태: ${compactValue(body.shippingStatus)}`);
  } else if (/^\/api\/instant-purchases$/.test(path) && req.method === "POST") {
    title = "바로구매 주문";
    if (body.itemId) summaryParts.push(`상품: ${compactValue(body.itemId)}`);
  } else if (
    /^\/api\/live-bids\/\d+$/.test(path) &&
    ["PUT", "PATCH"].includes(req.method)
  ) {
    const bidId = path.split("/").pop();
    title = "현장경매 항목 수정";
    summaryParts.push(`bidId: ${bidId}`);
    const changedKeys = Object.keys(body || {}).filter(
      (k) => !["id", "token"].includes(k),
    );
    if (changedKeys.length)
      summaryParts.push(`수정필드: ${changedKeys.slice(0, 8).join(", ")}`);
  } else if (
    /^\/api\/direct-bids\/\d+$/.test(path) &&
    ["PUT", "PATCH"].includes(req.method)
  ) {
    const bidId = path.split("/").pop();
    title = "직접경매 항목 수정";
    summaryParts.push(`bidId: ${bidId}`);
    const changedKeys = Object.keys(body || {}).filter(
      (k) => !["id", "token"].includes(k),
    );
    if (changedKeys.length)
      summaryParts.push(`수정필드: ${changedKeys.slice(0, 8).join(", ")}`);
  } else if (
    /^\/api\/bid-results\/admin\/settlements\/\d+$/.test(path) &&
    req.method === "PUT"
  ) {
    title = "정산 수동 처리";
    if (body.paymentAmount)
      summaryParts.push(`입금액: ${compactValue(body.paymentAmount)}원`);
    if (body.depositorName)
      summaryParts.push(`입금자: ${compactValue(body.depositorName)}`);
  } else {
    if (req.method === "POST") title = "등록";
    else if (req.method === "PUT" || req.method === "PATCH") title = "수정";
    else if (req.method === "DELETE") title = "삭제";
    summaryParts.push(`경로: ${path}`);
  }

  return {
    menu,
    title,
    summary: summaryParts.join(" | "),
  };
}

async function ensureAdminActivityTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = pool
      .query(
        `
        CREATE TABLE IF NOT EXISTS admin_activity_logs (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          actor_user_id BIGINT NULL,
          actor_login_id VARCHAR(120) NULL,
          actor_name VARCHAR(200) NULL,
          actor_role VARCHAR(60) NULL,
          action_method VARCHAR(10) NOT NULL,
          action_path VARCHAR(255) NOT NULL,
          action_menu VARCHAR(120) NULL,
          action_title VARCHAR(255) NULL,
          action_summary TEXT NULL,
          action_label VARCHAR(255) NULL,
          target_type VARCHAR(100) NULL,
          target_id VARCHAR(120) NULL,
          ip_address VARCHAR(64) NULL,
          user_agent VARCHAR(255) NULL,
          http_status INT NULL,
          detail_json JSON NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_admin_activity_created_at (created_at),
          KEY idx_admin_activity_actor (actor_login_id),
          KEY idx_admin_activity_path (action_path)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `,
      )
      .then(async () => {
        const [menuCol] = await pool.query(
          "SHOW COLUMNS FROM admin_activity_logs LIKE 'action_menu'",
        );
        if (!menuCol.length) {
          await pool.query(
            "ALTER TABLE admin_activity_logs ADD COLUMN action_menu VARCHAR(120) NULL AFTER action_path",
          );
        }

        const [titleCol] = await pool.query(
          "SHOW COLUMNS FROM admin_activity_logs LIKE 'action_title'",
        );
        if (!titleCol.length) {
          await pool.query(
            "ALTER TABLE admin_activity_logs ADD COLUMN action_title VARCHAR(255) NULL AFTER action_menu",
          );
        }

        const [summaryCol] = await pool.query(
          "SHOW COLUMNS FROM admin_activity_logs LIKE 'action_summary'",
        );
        if (!summaryCol.length) {
          await pool.query(
            "ALTER TABLE admin_activity_logs ADD COLUMN action_summary TEXT NULL AFTER action_title",
          );
        }
      })
      .catch((error) => {
        ensureTablePromise = null;
        throw error;
      });
  }
  return ensureTablePromise;
}

function isTrackedRequest(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return false;
  return TRACKED_PREFIXES.some((prefix) => req.path.startsWith(prefix));
}

function guessTarget(req) {
  const path = String(req.path || "");
  const matchPathId = path.match(
    /^\/api\/(?:live-bids|direct-bids|instant-purchases|wms|repair-management)\/(\d+)(?:\/|$)/,
  );
  if (matchPathId?.[1]) return { type: "id", id: matchPathId[1] };
  if (req.params?.id) return { type: "id", id: String(req.params.id) };
  if (req.body?.id) return { type: "id", id: String(req.body.id) };
  if (req.body?.item_id) return { type: "item", id: String(req.body.item_id) };
  if (req.body?.bid_id) return { type: "bid", id: String(req.body.bid_id) };
  if (req.body?.barcode)
    return { type: "barcode", id: String(req.body.barcode) };
  if (req.body?.internalBarcode)
    return { type: "barcode", id: String(req.body.internalBarcode) };
  if (Array.isArray(req.body?.bidIds) && req.body.bidIds.length > 0) {
    return { type: "bidIds", id: req.body.bidIds.slice(0, 10).join(",") };
  }
  if (req.query?.id) return { type: "id", id: String(req.query.id) };
  return { type: null, id: null };
}

function sanitizeBody(body) {
  if (!body || typeof body !== "object") return null;

  const shallow = {};
  const hiddenKeys = new Set(["password", "newPassword", "token", "secret"]);
  Object.keys(body)
    .slice(0, 20)
    .forEach((key) => {
      if (hiddenKeys.has(key)) {
        shallow[key] = "***";
        return;
      }
      const value = body[key];
      if (value === null || value === undefined) {
        shallow[key] = value;
      } else if (typeof value === "string") {
        shallow[key] = value.length > 120 ? `${value.slice(0, 120)}...` : value;
      } else if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        Array.isArray(value)
      ) {
        shallow[key] = value;
      } else {
        shallow[key] = "[object]";
      }
    });
  return shallow;
}

async function enrichSummaryByRoute(req, human, target) {
  try {
    const path = String(req.path || "");
    const directMatch = path.match(/^\/api\/direct-bids\/(\d+)$/);
    const liveMatch = path.match(/^\/api\/live-bids\/(\d+)$/);
    const instantMatch = path.match(/^\/api\/instant-purchases\/(\d+)$/);

    if (directMatch && ["PUT", "PATCH"].includes(req.method)) {
      const bidId = Number(directMatch[1]);
      const [rows] = await pool.query(
        `SELECT id, item_id, status FROM direct_bids WHERE id = ? LIMIT 1`,
        [bidId],
      );
      const row = rows?.[0];
      if (row) {
        const extra = [
          `item_id: ${row.item_id || "-"}`,
          `상태: ${row.status || "-"}`,
        ].join(" | ");
        return {
          human: {
            ...human,
            summary: [human.summary, extra].filter(Boolean).join(" | "),
          },
          target: {
            type: target.type || "bid",
            id: target.id || String(row.id),
          },
        };
      }
    }

    if (liveMatch && ["PUT", "PATCH"].includes(req.method)) {
      const bidId = Number(liveMatch[1]);
      const [rows] = await pool.query(
        `SELECT id, item_id, status FROM live_bids WHERE id = ? LIMIT 1`,
        [bidId],
      );
      const row = rows?.[0];
      if (row) {
        const extra = [
          `item_id: ${row.item_id || "-"}`,
          `상태: ${row.status || "-"}`,
        ].join(" | ");
        return {
          human: {
            ...human,
            summary: [human.summary, extra].filter(Boolean).join(" | "),
          },
          target: {
            type: target.type || "bid",
            id: target.id || String(row.id),
          },
        };
      }
    }

    if (instantMatch && ["PUT", "PATCH"].includes(req.method)) {
      const purchaseId = Number(instantMatch[1]);
      const [rows] = await pool.query(
        `SELECT id, item_id, status FROM instant_purchases WHERE id = ? LIMIT 1`,
        [purchaseId],
      );
      const row = rows?.[0];
      if (row) {
        const extra = [
          `item_id: ${row.item_id || "-"}`,
          `상태: ${row.status || "-"}`,
        ].join(" | ");
        return {
          human: {
            ...human,
            summary: [human.summary, extra].filter(Boolean).join(" | "),
          },
          target: {
            type: target.type || "purchase",
            id: target.id || String(row.id),
          },
        };
      }
    }
  } catch (_) {
    // 로그 보강 실패는 무시하고 기본 로그를 남긴다.
  }
  return { human, target };
}

function adminActivityLogger(req, res, next) {
  if (!isTrackedRequest(req) || !isAdminUser(req.session?.user)) {
    return next();
  }

  const actor = req.session.user || {};
  const ipAddress =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;

  res.on("finish", async () => {
    try {
      const target = guessTarget(req);
      const human = buildHumanAction(req);
      const context = req.adminActivityContext || {};
      const finalHuman = {
        menu: context.menu || human.menu,
        title: context.title || human.title,
        summary: context.summary
          ? [human.summary, context.summary].filter(Boolean).join(" | ")
          : human.summary,
      };
      let finalTarget = {
        type: context.targetType || target.type,
        id: context.targetId || target.id,
      };
      const enriched = await enrichSummaryByRoute(req, finalHuman, finalTarget);
      const finalHumanEnriched = enriched.human || finalHuman;
      finalTarget = enriched.target || finalTarget;
      const label = finalHumanEnriched.summary || `${req.method} ${req.path}`;
      const detail = {
        menu: finalHumanEnriched.menu,
        title: finalHumanEnriched.title,
        summary: finalHumanEnriched.summary,
        query: req.query || {},
        body: sanitizeBody(req.body),
        context: context.detail || null,
      };

      await ensureAdminActivityTable();
      await pool.query(
        `
        INSERT INTO admin_activity_logs (
          actor_user_id, actor_login_id, actor_name, actor_role,
          action_method, action_path, action_menu, action_title, action_summary, action_label, target_type, target_id,
          ip_address, user_agent, http_status, detail_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          actor.id || null,
          actor.login_id || null,
          actor.company_name || actor.email || actor.login_id || null,
          actor.role || null,
          req.method,
          req.path,
          finalHumanEnriched.menu || null,
          finalHumanEnriched.title || null,
          finalHumanEnriched.summary || null,
          label,
          finalTarget.type,
          finalTarget.id,
          ipAddress,
          req.headers["user-agent"] || null,
          Number(res.statusCode || 0) || null,
          JSON.stringify(detail),
        ],
      );
    } catch (error) {
      console.error("adminActivityLogger error:", error);
    }
  });

  return next();
}

module.exports = {
  adminActivityLogger,
  ensureAdminActivityTable,
};
