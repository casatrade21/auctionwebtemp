// utils/metrics.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cron = require("node-cron"); // node-cron 추가

// 메트릭스 데이터 파일 경로
const METRICS_FILE = path.join(__dirname, "data", "metrics.json");
const INACTIVE_TIMEOUT = 30 * 60 * 1000; // 30분

// 초기 메트릭스 객체
const defaultMetrics = {
  memberActiveUsers: new Map(),
  guestActiveUsers: new Map(),
  memberDailyUsers: new Set(),
  guestDailyUsers: new Set(),
  totalRequests: 0,
  uniquePageviews: 0,
  lastReset: new Date().setHours(0, 0, 0, 0),
  lastSaved: Date.now(),
  lastManualReset: null,
};

// 메트릭스 객체 (Map과 Set을 직렬화하기 위해 객체로 변환)
let metrics = { ...defaultMetrics };

// 페이지뷰 중복 방지를 위한 집합
// 형식: Set<`${ip}-${userAgent}-${page}`>
const pageviewTracker = new Set();

// IP 주소 + 브라우저 지문으로 고유 방문자 식별
function getVisitorIdentifier(req) {
  const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  const userAgent = req.headers["user-agent"] || "unknown";

  // IP와 User-Agent로 간단한 해시 생성
  const hash = crypto
    .createHash("md5")
    .update(`${ip}-${userAgent}`)
    .digest("hex");

  return hash;
}

// 데이터 디렉토리 확인 및 생성
function ensureDataDirectory() {
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// 메트릭스 데이터 로드
function loadMetrics() {
  if (process.env.NODE_ENV === "development") {
    return;
  }

  ensureDataDirectory();

  try {
    if (fs.existsSync(METRICS_FILE)) {
      const data = JSON.parse(fs.readFileSync(METRICS_FILE, "utf8"));

      // Map과 Set 복원
      metrics.memberActiveUsers = new Map(
        Object.entries(data.memberActiveUsers || {}),
      );
      metrics.guestActiveUsers = new Map(
        Object.entries(data.guestActiveUsers || {}),
      );
      metrics.memberDailyUsers = new Set(data.memberDailyUsers || []);
      metrics.guestDailyUsers = new Set(data.guestDailyUsers || []);
      metrics.totalRequests = data.totalRequests || 0;
      metrics.uniquePageviews = data.uniquePageviews || 0;
      metrics.lastReset = data.lastReset || new Date().setHours(0, 0, 0, 0);
      metrics.lastSaved = data.lastSaved || Date.now();
      metrics.lastManualReset = data.lastManualReset || null;

      console.log("메트릭스 데이터를 로드했습니다.");
    }
  } catch (error) {
    console.error("메트릭스 데이터 로드 중 오류:", error);
  }
}

// 일일 메트릭스 초기화 (자정에 실행)
function resetDailyMetrics() {
  console.log("자정이 되어 일일 사용자 통계를 초기화합니다.");

  // 일일 사용자 통계 초기화
  metrics.memberDailyUsers.clear();
  metrics.guestDailyUsers.clear();
  metrics.lastReset = new Date().setHours(0, 0, 0, 0);

  // 페이지뷰 추적기도 초기화
  pageviewTracker.clear();

  // 변경사항 즉시 저장
  saveMetrics();

  console.log("일일 통계 초기화 완료:", new Date().toISOString());
}

// 메트릭스 데이터 저장
function saveMetrics() {
  if (process.env.NODE_ENV === "development") {
    return;
  }

  ensureDataDirectory();

  try {
    // Map과 Set을 직렬화 가능한 형태로 변환
    const dataToSave = {
      memberActiveUsers: Object.fromEntries(metrics.memberActiveUsers),
      guestActiveUsers: Object.fromEntries(metrics.guestActiveUsers),
      memberDailyUsers: Array.from(metrics.memberDailyUsers),
      guestDailyUsers: Array.from(metrics.guestDailyUsers),
      totalRequests: metrics.totalRequests,
      uniquePageviews: metrics.uniquePageviews,
      lastReset: metrics.lastReset,
      lastSaved: Date.now(),
      lastManualReset: metrics.lastManualReset,
    };

    fs.writeFileSync(METRICS_FILE, JSON.stringify(dataToSave, null, 2));
    metrics.lastSaved = Date.now();
  } catch (error) {
    console.error("메트릭스 데이터 저장 중 오류:", error);
  }
}

// 비활성 사용자 정리
function cleanupInactiveUsers() {
  const now = Date.now();
  let inactiveUsersRemoved = 0;

  // 30분 이상 비활성 사용자 제거
  for (const [userId, lastActivity] of metrics.memberActiveUsers) {
    if (now - lastActivity > INACTIVE_TIMEOUT) {
      metrics.memberActiveUsers.delete(userId);
      inactiveUsersRemoved++;
    }
  }

  for (const [visitorId, lastActivity] of metrics.guestActiveUsers) {
    if (now - lastActivity > INACTIVE_TIMEOUT) {
      metrics.guestActiveUsers.delete(visitorId);
      inactiveUsersRemoved++;
    }
  }

  if (inactiveUsersRemoved > 0) {
    // console.log(`${inactiveUsersRemoved}명의 비활성 사용자를 제거했습니다.`);
  }
}

// 리소스 요청 여부 확인 (JS, CSS, 이미지 등)
function isResourceRequest(req) {
  let requestPath = "";
  try {
    const requestUrl = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`,
    );
    requestPath = requestUrl.pathname || "";
  } catch (error) {
    requestPath = req.path || (req.url ? req.url.split("?")[0] : "");
  }

  // 정적 리소스 요청인지 확인
  const ext = requestPath.split(".").pop().toLowerCase();
  const resourceExtensions = [
    "css",
    "js",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "svg",
    "ico",
    "woff",
    "woff2",
    "ttf",
    "eot",
    "map",
  ];

  // API 요청이거나 정적 리소스, 또는 favicon 요청이면 제외
  if (
    requestPath.startsWith("/api/") ||
    resourceExtensions.includes(ext) ||
    requestPath.includes("favicon.ico")
  ) {
    return true;
  }

  return false;
}

// 메트릭스 미들웨어
function metricsMiddleware(req, res, next) {
  if (process.env.NODE_ENV === "development") {
    return next();
  }

  // 항상 총 요청 수는 증가 (모든 HTTP 요청)
  metrics.totalRequests++;

  // 정적 리소스 요청 및 API 요청은 사용자 추적에서 제외
  if (isResourceRequest(req)) {
    return next();
  }

  const now = Date.now();
  const currentPath = req.path || req.url;

  // 세션ID와 방문자 식별자 생성
  const sessionId = req.session?.user?.id || req.sessionID;
  const visitorId = getVisitorIdentifier(req);
  const isMember = !!req.session?.user?.id;

  // 페이지뷰 중복 체크
  const pageviewKey = `${visitorId}-${currentPath}`;
  const THIRTY_MINUTES = 30 * 60 * 1000; // 30분

  // 페이지뷰 중복 방지를 위한 처리
  if (!pageviewTracker.has(pageviewKey)) {
    // 새 페이지뷰로 등록
    pageviewTracker.add(pageviewKey);
    metrics.uniquePageviews++;

    // 30분 후 자동 제거 (메모리 관리)
    setTimeout(() => {
      pageviewTracker.delete(pageviewKey);
    }, THIRTY_MINUTES);

    // 회원/비회원 분리하여 추적
    if (isMember) {
      // 처음 방문한 회원만 추가
      if (!metrics.memberDailyUsers.has(sessionId)) {
        metrics.memberDailyUsers.add(sessionId);
      }
      metrics.memberActiveUsers.set(sessionId, now);
    } else {
      // 처음 방문한 비회원만 추가 (브라우저 지문 기반)
      if (!metrics.guestDailyUsers.has(visitorId)) {
        metrics.guestDailyUsers.add(visitorId);
      }
      metrics.guestActiveUsers.set(visitorId, now);
    }
  }

  // 5분마다 파일에 저장 (성능 최적화)
  if (now - metrics.lastSaved > 5 * 60 * 1000) {
    saveMetrics();
  }

  next();
}

// 메트릭스 스케줄러 설정
function setupMetricsJobs() {
  if (process.env.NODE_ENV === "development") {
    return;
  }

  // 초기 로드
  loadMetrics();

  // 자정에 실행되는 cron 작업 (0 0 * * * = 매일 00:00에 실행)
  cron.schedule("0 0 * * *", resetDailyMetrics, {
    timezone: "Asia/Seoul", // 한국 시간 기준
  });

  // 5분마다 실행되는 cron 작업
  cron.schedule("*/5 * * * *", () => {
    // 비활성 사용자 정리
    cleanupInactiveUsers();

    // 메트릭스 저장
    saveMetrics();
  });

  // 서버 종료 시 메트릭스 저장
  process.on("SIGINT", () => {
    console.log("서버 종료 중... 메트릭스 데이터 저장");
    saveMetrics();
    process.exit(0);
  });
}

// 메트릭스 조회 엔드포인트 핸들러
function getMetrics(req, res) {
  if (!req.session?.user?.id || req.session.user.login_id !== "admin") {
    return res.status(403).json({ message: "Unauthorized" });
  }

  const now = Date.now();

  // 활성 사용자 계산 (30분 이내 활동)
  const activeMemberCount = Array.from(
    metrics.memberActiveUsers.values(),
  ).filter((lastActivity) => now - lastActivity <= INACTIVE_TIMEOUT).length;

  const activeGuestCount = Array.from(metrics.guestActiveUsers.values()).filter(
    (lastActivity) => now - lastActivity <= INACTIVE_TIMEOUT,
  ).length;

  res.json({
    activeMemberUsers: activeMemberCount,
    activeGuestUsers: activeGuestCount,
    totalActiveUsers: activeMemberCount + activeGuestCount,
    dailyMemberUsers: metrics.memberDailyUsers.size,
    dailyGuestUsers: metrics.guestDailyUsers.size,
    totalDailyUsers:
      metrics.memberDailyUsers.size + metrics.guestDailyUsers.size,
    totalRequests: metrics.totalRequests,
    uniquePageviews: metrics.uniquePageviews,
    lastReset: new Date(metrics.lastReset).toISOString(),
    lastManualReset: metrics.lastManualReset
      ? new Date(metrics.lastManualReset).toISOString()
      : null,
  });
}

// 메트릭스 초기화 엔드포인트 핸들러
function resetMetrics(req, res) {
  if (!req.session?.user?.id || req.session.user.login_id !== "admin") {
    return res.status(403).json({ message: "Unauthorized" });
  }

  // 모든 메트릭스 초기화
  metrics.memberActiveUsers.clear();
  metrics.guestActiveUsers.clear();
  metrics.memberDailyUsers.clear();
  metrics.guestDailyUsers.clear();
  metrics.totalRequests = 0;
  metrics.uniquePageviews = 0;
  metrics.lastManualReset = Date.now();

  // 페이지뷰 추적기 초기화
  pageviewTracker.clear();

  // 변경사항 저장
  saveMetrics();

  res.json({
    success: true,
    message: "메트릭스가 초기화되었습니다.",
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  metricsMiddleware,
  setupMetricsJobs,
  getMetrics,
  resetMetrics,
};
