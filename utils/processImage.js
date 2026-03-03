// utils/processImage.js
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const { ProxyManager } = require("./proxy");

let pLimit;
(async () => {
  pLimit = (await import("p-limit")).default;
})();

// 설정
const MAX_WIDTH = 800;
const MAX_HEIGHT = 800;
const CONCURRENT_DOWNLOADS = 200;
const MAX_RETRIES = 5;
const INITIAL_DELAY = 100;
const MAX_DELAY = 5 * 60 * 1000; // 5분
const PRIORITY_LEVELS = 3; // 우선순위 레벨 수 (1: 높음, 2: 중간, 3: 낮음)
const PROCESSING_BATCH_SIZE = 5000; // 한 번에 5000개씩만 처리

// Crop 설정 format:
// - width/height: 최종 크기 (null이면 원본 크기 유지)
// - cropTop/cropBottom: 위/아래에서 자를 픽셀 수
// - cropLeft/cropRight: 좌/우에서 자를 픽셀 수
const CROP_SETTINGS = {
  brand: { cropTop: 25, cropBottom: 25, cropLeft: 0, cropRight: 0 },
};

/**
 * 이미지 하위 폴더 경로 생성
 * @param {string} scheduledDate - 아이템의 scheduled_date
 * @param {string} fileName - 파일명
 * @returns {string} 하위 폴더 경로 (예: "2025-01/a")
 */
function getImageSubFolder(scheduledDate, fileName) {
  let yearMonth;

  if (scheduledDate) {
    try {
      const date = new Date(scheduledDate);
      if (!isNaN(date.getTime())) {
        yearMonth = date.toISOString().slice(0, 7); // "2025-01"
      }
    } catch (e) {
      yearMonth = "legacy";
    }
  }

  if (!yearMonth) {
    yearMonth = "legacy";
  }

  const firstChar = fileName.charAt(0).toLowerCase();
  return `${yearMonth}/${firstChar}`;
}

// 우선순위별 이미지 처리 큐 및 상태
const queues = Array(PRIORITY_LEVELS)
  .fill()
  .map(() => []);
let isProcessing = false;
let currentDelay = INITIAL_DELAY;
let consecutiveFailures = 0;
let processingPaused = false;

// 프록시 관리
let proxyManager = null;
let clients = [];
let currentClientIndex = 0;

// 프록시 초기화
function initializeProxy() {
  if (!proxyManager) {
    proxyManager = new ProxyManager();
    clients = proxyManager.createAllClients();
    console.log(`이미지 프로세서: ${clients.length}개 클라이언트 초기화`);
  }
}

// 이미지 다운로드 및 저장 (프록시 로테이션 적용)
async function downloadAndSaveImage(
  url,
  folderName,
  cropType = null,
  scheduledDate = null,
  options = null,
) {
  // folderName 검증 및 기본값 설정
  if (!folderName || typeof folderName !== "string") {
    console.warn(`Invalid folderName: ${folderName}, using default 'products'`);
    folderName = "products";
  }

  initializeProxy();

  const dateString = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .split(".")[0];

  const fileName = `${dateString}_${uuidv4()}${
    cropType ? `_${cropType}` : ""
  }.webp`;

  // 하위 폴더 구조 생성 (values 폴더만)
  let subFolder = "";
  if (folderName === "values") {
    subFolder = getImageSubFolder(scheduledDate, fileName);
  }

  const IMAGE_DIR = path.join(
    __dirname,
    "..",
    "public",
    "images",
    folderName,
    subFolder,
  );

  // 폴더가 없으면 생성 (하위 폴더 포함)
  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
  }

  // 모든 클라이언트 시도
  for (let attempt = 0; attempt < clients.length; attempt++) {
    const client = clients[currentClientIndex];
    currentClientIndex = (currentClientIndex + 1) % clients.length;

    try {
      const response = await client.client({
        method: "GET",
        url: url,
        responseType: "arraybuffer",
        ...(options || {}),
      });

      const filePath = path.join(IMAGE_DIR, fileName);

      const metadata = await sharp(response.data).metadata();
      let processedImage = sharp(response.data);

      // Crop 처리 로직
      if (cropType && CROP_SETTINGS[cropType]) {
        const cropConfig = CROP_SETTINGS[cropType];

        // 크롭 영역 계산
        const left = cropConfig.cropLeft || 0;
        const top = cropConfig.cropTop || 0;
        const width = metadata.width - left - (cropConfig.cropRight || 0);
        const height = metadata.height - top - (cropConfig.cropBottom || 0);

        // 크롭 적용
        processedImage = processedImage.extract({
          left: left,
          top: top,
          width: width,
          height: height,
        });

        // 크롭 후 기본 리사이즈 로직도 적용
        if (width > MAX_WIDTH || height > MAX_HEIGHT) {
          processedImage = processedImage.resize({
            width: Math.min(width, MAX_WIDTH),
            height: Math.min(height, MAX_HEIGHT),
            fit: "inside",
            withoutEnlargement: true,
          });
        }
      } else {
        // 기존 리사이즈 로직 (cropType이 null인 경우)
        if (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT) {
          processedImage = processedImage.resize({
            width: Math.min(metadata.width, MAX_WIDTH),
            height: Math.min(metadata.height, MAX_HEIGHT),
            fit: "inside",
            withoutEnlargement: true,
          });
        }
      }

      await processedImage.webp({ quality: 100 }).toFile(filePath);

      // 성공 시 연속 실패 카운터 초기화
      consecutiveFailures = 0;

      // 성공 시 딜레이를 점진적으로 감소
      if (currentDelay > INITIAL_DELAY) {
        currentDelay = Math.max(INITIAL_DELAY, currentDelay * 0.9); // 10%씩 감소
      }

      // 반환 경로 (하위 폴더 포함)
      const relativePath = subFolder
        ? `${folderName}/${subFolder}/${fileName}`
        : `${folderName}/${fileName}`;
      return `/images/${relativePath}`;
    } catch (error) {
      console.error(
        `${client.name} 이미지 다운로드 실패: ${url}`,
        error.message,
      );

      // 404인 경우 다른 프록시로 재시도하지 않음
      if (error.response && error.response.status === 404) {
        return 404;
      }

      // 마지막 클라이언트가 아니면 다음 클라이언트로 계속 시도
      if (attempt < clients.length - 1) {
        console.log(`다음 클라이언트로 재시도: ${url}`);
        continue;
      }
    }
  }

  // 모든 클라이언트 실패
  console.error(`모든 클라이언트로 이미지 처리 실패: ${url}`);

  // 연속 실패 카운터 증가
  consecutiveFailures++;

  if (consecutiveFailures >= 2) {
    processingPaused = true;
    console.log(`연속 실패 감지! 처리 일시 중지, 딜레이 ${currentDelay}ms`);

    setTimeout(() => {
      processingPaused = false;
      processQueue();
    }, currentDelay);

    // 딜레이 증가
    currentDelay = Math.min(currentDelay * 2, MAX_DELAY);
  }

  return null;
}

// 큐에서 다음 처리할 항목 가져오기 (높은 우선순위부터)
function getNextBatch() {
  for (let priority = 0; priority < PRIORITY_LEVELS; priority++) {
    if (queues[priority].length > 0) {
      return {
        batch: queues[priority].splice(0, CONCURRENT_DOWNLOADS),
        priority,
      };
    }
  }
  return { batch: [], priority: -1 };
}

// 큐가 비어있는지 확인
function isQueuesEmpty() {
  return queues.every((queue) => queue.length === 0);
}

// 큐 프로세서
async function processQueue() {
  if (isProcessing || processingPaused || isQueuesEmpty()) return;

  isProcessing = true;

  try {
    const { batch, priority } = getNextBatch();

    if (batch.length === 0) {
      isProcessing = false;
      return;
    }

    const limit = pLimit(CONCURRENT_DOWNLOADS);
    const tasks = batch.map((task) =>
      limit(() => processQueueItem(task, priority)),
    );

    await Promise.all(tasks);
  } catch (error) {
    console.error("큐 처리 오류:", error);
  } finally {
    isProcessing = false;

    if (!isQueuesEmpty() && !processingPaused) {
      setTimeout(() => processQueue(), 100);
    }
  }
}

// 개별 큐 항목 처리
async function processQueueItem(task, priority) {
  const {
    url,
    resolve,
    attempt = 0,
    cropType,
    folderName,
    scheduledDate,
    options,
  } = task;

  // folderName 검증
  if (!folderName) {
    console.error(`Missing folderName for task: ${url}`);
    resolve(null);
    return;
  }

  // 최대 재시도 횟수에 도달했으면 종료
  if (attempt >= MAX_RETRIES) {
    console.error(`Max retries reached for ${url} in folder ${folderName}`);
    resolve(null);
    return;
  }

  // 이미지 다운로드 시도
  const result = await downloadAndSaveImage(
    url,
    folderName,
    cropType,
    scheduledDate,
    options,
  );

  // 결과 처리
  if (typeof result === "string") {
    // 성공적으로 이미지 다운로드
    resolve(result);
  } else if (result === 404) {
    // 404 오류는 딱 한 번만 재시도
    if (attempt === 0) {
      queues[priority].push({
        url,
        resolve,
        attempt: 1,
        cropType,
        folderName,
        scheduledDate,
        options,
      });
    } else {
      console.warn(`404 error after retry for ${url} in folder ${folderName}`);
      resolve(null);
    }
  } else {
    // 그 외 오류는 계속 재시도
    if (attempt < MAX_RETRIES - 1) {
      queues[priority].push({
        url,
        resolve,
        attempt: attempt + 1,
        cropType,
        folderName,
        scheduledDate,
        options,
      });
    } else {
      console.error(
        `Failed after ${MAX_RETRIES} retries for ${url} in folder ${folderName}`,
      );
      resolve(null);
    }
  }
}

// 큐에 항목 추가
function enqueueImage(
  url,
  folderName,
  priority = 2,
  cropType = null,
  scheduledDate = null,
  options = null,
) {
  // 파라미터 검증
  if (!url || typeof url !== "string") {
    console.error(`Invalid url: ${url}`);
    return Promise.resolve(null);
  }

  if (!folderName || typeof folderName !== "string") {
    console.error(`Invalid folderName: ${folderName} for url: ${url}`);
    return Promise.resolve(null);
  }

  // 유효한 우선순위 범위로 조정 (1부터 PRIORITY_LEVELS까지)
  const validPriority = Math.max(1, Math.min(PRIORITY_LEVELS, priority)) - 1;

  return new Promise((resolve) => {
    queues[validPriority].push({
      url,
      resolve,
      cropType,
      folderName,
      scheduledDate,
      options,
    });

    if (!isProcessing && !processingPaused) {
      processQueue();
    }
  });
}

// 공개 인터페이스
async function processImagesInChunks(
  items,
  folderName,
  priority = 2,
  cropType = null,
  options = null,
) {
  // 파라미터 검증
  if (!Array.isArray(items)) {
    console.error(`Invalid items parameter: ${items}`);
    return [];
  }

  if (!folderName || typeof folderName !== "string") {
    console.error(
      `Invalid folderName: ${folderName}, aborting image processing`,
    );
    return items;
  }

  console.log(
    `Starting image processing for ${
      items.length
    } items in folder: ${folderName}, priority: ${priority}${
      cropType ? `, crop: ${cropType}` : ""
    }${options ? `, with custom options` : ""}`,
  );

  const itemsWithImages = [];
  const itemsWithoutImages = [];

  items.forEach((item) => {
    if (
      item.image ||
      (item.additional_images && JSON.parse(item.additional_images).length > 0)
    ) {
      itemsWithImages.push(item);
    } else {
      itemsWithoutImages.push(item);
    }
  });

  // 개별 아이템 처리 함수
  const processItem = async (item) => {
    const tasks = [];
    const scheduledDate = item.scheduled_date || null;

    if (item.image) {
      tasks.push(
        enqueueImage(
          item.image,
          folderName,
          priority,
          cropType,
          scheduledDate,
          options,
        ).then((savedPath) => {
          item.image = savedPath;
        }),
      );
    }

    if (item.additional_images) {
      try {
        const additionalImages = JSON.parse(item.additional_images);
        const savedImages = [];

        additionalImages.forEach((imgUrl) => {
          tasks.push(
            enqueueImage(
              imgUrl,
              folderName,
              priority,
              cropType,
              scheduledDate,
              options,
            ).then((savedPath) => {
              if (savedPath) {
                savedImages.push(savedPath);
              }
            }),
          );
        });

        await Promise.all(tasks);
        item.additional_images = JSON.stringify(savedImages);
      } catch (err) {
        console.error("추가 이미지 처리 오류:", err);
      }
    } else {
      await Promise.all(tasks);
    }

    return item;
  };

  // 진행 상황 모니터링
  let completed = 0;
  const total = itemsWithImages.length;

  let logInterval;
  if (total > 0) {
    logInterval = setInterval(() => {
      const queueSizes = queues
        .map((q, i) => `P${i + 1}: ${q.length}`)
        .join(", ");

      console.log(
        `📥 다운로드 진행률: ${completed} / ${total} (${Math.round(
          (completed / total) * 100,
        )}%), 큐 길이: [${queueSizes}], 폴더: ${folderName}, 우선순위: ${priority}${
          cropType ? `, 크롭: ${cropType}` : ""
        }`,
      );
    }, 5000);
  }

  // 배치 처리: 한 번에 PROCESSING_BATCH_SIZE개씩만 처리
  const processedItems = [];

  for (let i = 0; i < itemsWithImages.length; i += PROCESSING_BATCH_SIZE) {
    const batch = itemsWithImages.slice(i, i + PROCESSING_BATCH_SIZE);

    console.log(
      `Processing batch ${
        Math.floor(i / PROCESSING_BATCH_SIZE) + 1
      }/${Math.ceil(itemsWithImages.length / PROCESSING_BATCH_SIZE)} (${
        batch.length
      } items)`,
    );

    const results = await Promise.allSettled(
      batch.map(async (item) => {
        const result = await processItem(item);
        completed++;
        return result;
      }),
    );

    const batchProcessed = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);

    processedItems.push(...batchProcessed);

    // 배치 간 짧은 대기 (메모리 정리 시간)
    if (i + PROCESSING_BATCH_SIZE < itemsWithImages.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (logInterval) {
    clearInterval(logInterval);
  }

  console.log(
    `✅ 이미지 처리 완료: ${
      processedItems.length
    } 항목 성공, 폴더: ${folderName}, 우선순위: ${priority}${
      cropType ? `, 크롭: ${cropType}` : ""
    }`,
  );

  return [...processedItems, ...itemsWithoutImages];
}

// 큐 상태 초기화 함수
function resetQueue() {
  queues.forEach((queue) => (queue.length = 0));
  isProcessing = false;
  currentDelay = INITIAL_DELAY;
  consecutiveFailures = 0;
  processingPaused = false;
  console.log("🔄 Queue reset completed");
}

// 큐 상태 조회 함수
function getQueueStatus() {
  const status = {
    queues: queues.map((queue, index) => ({
      priority: index + 1,
      length: queue.length,
      items: queue.slice(0, 3).map((task) => ({
        url: task.url?.substring(0, 50) + "...",
        folderName: task.folderName,
        cropType: task.cropType,
        attempt: task.attempt || 0,
      })),
    })),
    isProcessing,
    currentDelay,
    consecutiveFailures,
    processingPaused,
  };

  console.log("📊 Queue Status:", JSON.stringify(status, null, 2));
  return status;
}

// 폴더별 큐 상태 조회
function getQueueStatusByFolder() {
  const folderStats = {};

  queues.forEach((queue, priority) => {
    queue.forEach((task) => {
      const folder = task.folderName || "unknown";
      if (!folderStats[folder]) {
        folderStats[folder] = { total: 0, byPriority: {} };
      }
      folderStats[folder].total++;
      folderStats[folder].byPriority[priority + 1] =
        (folderStats[folder].byPriority[priority + 1] || 0) + 1;
    });
  });

  return folderStats;
}

module.exports = {
  processImagesInChunks,
  resetQueue,
  getQueueStatus,
  getQueueStatusByFolder,
  enqueueImage,
};
