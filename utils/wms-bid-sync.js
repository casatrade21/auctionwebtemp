const WORKFLOW_BID_STATUSES = new Set([
  "completed",
  "domestic_arrived",
  "processing",
  "shipped",
]);

const PROCESSING_LOCATION_CODES = new Set([
  "REPAIR_TEAM_CHECK_ZONE",
  "AUTH_ZONE",
  "REPAIR_ZONE",
  "INTERNAL_REPAIR_ZONE",
  "EXTERNAL_REPAIR_ZONE",
  "REPAIR_DONE_ZONE",
]);

function statusByLocation(locationCode) {
  switch (locationCode) {
    case "DOMESTIC_ARRIVAL_ZONE":
    case "INBOUND_ZONE":
      return "DOMESTIC_ARRIVED";
    case "REPAIR_TEAM_CHECK_ZONE":
      return "REPAIR_TEAM_CHECKING";
    case "AUTH_ZONE":
      return "AUTH_IN_PROGRESS";
    case "REPAIR_ZONE":
    case "INTERNAL_REPAIR_ZONE":
      return "INTERNAL_REPAIR_IN_PROGRESS";
    case "EXTERNAL_REPAIR_ZONE":
      return "EXTERNAL_REPAIR_IN_PROGRESS";
    case "REPAIR_DONE_ZONE":
      return "REPAIR_DONE";
    case "HOLD_ZONE":
      return "HOLD";
    case "OUTBOUND_ZONE":
      return "SHIPPED";
    default:
      return "UNKNOWN";
  }
}

function targetLocationByBidStatus(nextStatus, currentLocationCode) {
  if (nextStatus === "completed" || nextStatus === "domestic_arrived") {
    // domestic_arrived는 DOMESTIC_ARRIVAL_ZONE 또는 HOLD_ZONE일 수 있음
    // 현재 HOLD_ZONE에 있다면 유지, 아니면 DOMESTIC_ARRIVAL_ZONE으로
    if (currentLocationCode === "HOLD_ZONE") {
      return "HOLD_ZONE";
    }
    return "DOMESTIC_ARRIVAL_ZONE";
  }
  if (nextStatus === "processing") {
    if (PROCESSING_LOCATION_CODES.has(currentLocationCode)) {
      return currentLocationCode;
    }
    return "REPAIR_TEAM_CHECK_ZONE";
  }
  if (nextStatus === "shipped") {
    return "OUTBOUND_ZONE";
  }
  return null;
}

function targetStatusByBidStatus(nextStatus, targetLocationCode) {
  // 완료는 WMS 운영보드/수선목록에서 숨김 처리하기 위해 별도 상태로 저장한다.
  if (nextStatus === "completed") {
    return "COMPLETED";
  }
  return statusByLocation(targetLocationCode);
}

function sourceByAuctionNum(aucNum) {
  const key = String(aucNum || "");
  if (key === "1") return "ecoring";
  if (key === "2") return "oaknet";
  if (key === "4") return "mekiki";
  return `auc-${key || "unknown"}`;
}

function formatDatePart(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${String(now.getFullYear()).slice(-2)}${String(
      now.getMonth() + 1,
    ).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  }
  return `${String(d.getFullYear()).slice(-2)}${String(
    d.getMonth() + 1,
  ).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeAuctionCode(aucNum) {
  const raw = String(aucNum || "00")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase();
  return (raw || "00").slice(0, 3);
}

async function generateInternalBarcode(connection, scheduledDate, aucNum) {
  const datePart = formatDatePart(scheduledDate);
  const aucPart = normalizeAuctionCode(aucNum);
  const prefix = `CB-${datePart}-${aucPart}`;

  const [rows] = await connection.query(
    `
    SELECT internal_barcode
    FROM wms_items
    WHERE internal_barcode LIKE ?
    `,
    [`${prefix}-%`],
  );

  let maxSeq = 0;
  for (const row of rows) {
    const code = row.internal_barcode || "";
    const seq = Number(code.split("-").pop());
    if (!Number.isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
  }

  const nextSeq = String(maxSeq + 1).padStart(4, "0");
  return `${prefix}-${nextSeq}`;
}

function buildItemUid() {
  return `WMS-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function fetchBidMetaForWms(connection, { bidType, bidId, itemId }) {
  const tableName =
    bidType === "live"
      ? "live_bids"
      : bidType === "instant"
        ? "instant_purchases"
        : "direct_bids";
  const numericBidId = Number(bidId);
  const [rows] = await connection.query(
    `
    SELECT
      b.id AS bid_id,
      b.item_id,
      b.user_id,
      COALESCE(u.company_name, u.login_id) AS member_name,
      ci.auc_num,
      COALESCE(ci.original_scheduled_date, ci.scheduled_date, b.updated_at, b.created_at) AS scheduled_at
    FROM ${tableName} b
    LEFT JOIN users u ON u.id = b.user_id
    LEFT JOIN crawled_items ci
      ON CONVERT(ci.item_id USING utf8mb4) = CONVERT(b.item_id USING utf8mb4)
    WHERE b.id = ?
    LIMIT 1
    `,
    [numericBidId],
  );

  if (rows[0]) return rows[0];
  if (!itemId) return null;

  const [fallbackRows] = await connection.query(
    `
    SELECT
      b.id AS bid_id,
      b.item_id,
      b.user_id,
      COALESCE(u.company_name, u.login_id) AS member_name,
      ci.auc_num,
      COALESCE(ci.original_scheduled_date, ci.scheduled_date, b.updated_at, b.created_at) AS scheduled_at
    FROM ${tableName} b
    LEFT JOIN users u ON u.id = b.user_id
    LEFT JOIN crawled_items ci
      ON CONVERT(ci.item_id USING utf8mb4) = CONVERT(b.item_id USING utf8mb4)
    WHERE CONVERT(b.item_id USING utf8mb4) = CONVERT(? USING utf8mb4)
    ORDER BY b.updated_at DESC, b.id DESC
    LIMIT 1
    `,
    [String(itemId)],
  );

  return fallbackRows[0] || null;
}

async function createWmsItemForBid(
  connection,
  { bidType, bidId, itemId, nextStatus, targetLocationCode, targetStatusCode },
) {
  const bidMeta = await fetchBidMetaForWms(connection, {
    bidType,
    bidId,
    itemId,
  });
  if (!bidMeta) return null;

  const sourceItemId = String(bidMeta.item_id || itemId || "").trim() || null;
  const metadata = {
    generatedFrom: "wms-bid-sync",
    nextStatus: String(nextStatus || ""),
  };

  let insertId = null;
  let lastDuplicateError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const generatedBarcode = await generateInternalBarcode(
      connection,
      bidMeta.scheduled_at,
      bidMeta.auc_num,
    );
    try {
      const [insertResult] = await connection.query(
        `
        INSERT INTO wms_items (
          item_uid, member_name, auction_source, auction_lot_no,
          external_barcode, internal_barcode, request_type,
          current_status, current_location_code, metadata_text,
          source_bid_type, source_bid_id, source_item_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          buildItemUid(),
          bidMeta.member_name || null,
          sourceByAuctionNum(bidMeta.auc_num),
          sourceItemId,
          null,
          generatedBarcode,
          0,
          targetStatusCode,
          targetLocationCode,
          JSON.stringify(metadata),
          bidType,
          Number(bidMeta.bid_id || bidId),
          sourceItemId,
        ],
      );
      insertId = insertResult.insertId;
      break;
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") {
        lastDuplicateError = error;
        continue;
      }
      throw error;
    }
  }

  if (!insertId && lastDuplicateError) {
    throw lastDuplicateError;
  }
  if (!insertId) return null;

  const [rows] = await connection.query(
    `
    SELECT
      id,
      source_bid_type,
      source_bid_id,
      source_item_id,
      current_location_code,
      current_status,
      internal_barcode,
      external_barcode
    FROM wms_items
    WHERE id = ?
    LIMIT 1
    `,
    [insertId],
  );
  return rows[0] || null;
}

async function findWmsItemByBid(connection, { bidType, bidId, itemId }) {
  const params = [bidType, Number(bidId)];
  let whereClause = "source_bid_type = ? AND source_bid_id = ?";

  if (itemId) {
    whereClause = `(
      ${whereClause}
      OR CONVERT(NULLIF(TRIM(source_item_id), '') USING utf8mb4) = CONVERT(? USING utf8mb4)
      OR CONVERT(NULLIF(TRIM(auction_lot_no), '') USING utf8mb4) = CONVERT(? USING utf8mb4)
    )`;
    params.push(String(itemId), String(itemId));
  }

  const [rows] = await connection.query(
    `
    SELECT
      id,
      source_bid_type,
      source_bid_id,
      source_item_id,
      current_location_code,
      current_status,
      auction_lot_no,
      internal_barcode,
      external_barcode
    FROM wms_items
    WHERE ${whereClause}
    ORDER BY
      CASE
        WHEN source_bid_type = ? AND source_bid_id = ? THEN 0
        WHEN CONVERT(NULLIF(TRIM(source_item_id), '') USING utf8mb4) = CONVERT(? USING utf8mb4) THEN 1
        WHEN CONVERT(NULLIF(TRIM(auction_lot_no), '') USING utf8mb4) = CONVERT(? USING utf8mb4) THEN 2
        ELSE 3
      END,
      updated_at DESC,
      id DESC
    LIMIT 1
    `,
    [
      ...params,
      bidType,
      Number(bidId),
      itemId ? String(itemId) : null,
      itemId ? String(itemId) : null,
    ],
  );

  return rows[0] || null;
}

async function assignInternalBarcodeIfMissing(
  connection,
  { wmsItemId, bidType, bidId, itemId },
) {
  const [currentRows] = await connection.query(
    `
    SELECT
      id,
      source_bid_type,
      source_bid_id,
      source_item_id,
      current_location_code,
      current_status,
      internal_barcode,
      external_barcode
    FROM wms_items
    WHERE id = ?
    LIMIT 1
    `,
    [wmsItemId],
  );
  const current = currentRows[0];
  if (!current) return null;

  const hasInternal = Boolean(String(current.internal_barcode || "").trim());
  const hasExternal = Boolean(String(current.external_barcode || "").trim());
  if (hasInternal || hasExternal) {
    return current;
  }

  const bidMeta = await fetchBidMetaForWms(connection, {
    bidType,
    bidId,
    itemId,
  });
  if (!bidMeta) {
    return current;
  }

  let updated = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const generatedBarcode = await generateInternalBarcode(
      connection,
      bidMeta.scheduled_at,
      bidMeta.auc_num,
    );
    try {
      await connection.query(
        `
        UPDATE wms_items
        SET
          internal_barcode = COALESCE(NULLIF(TRIM(internal_barcode), ''), ?),
          updated_at = NOW()
        WHERE id = ?
        `,
        [generatedBarcode, current.id],
      );
      updated = true;
      break;
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") continue;
      throw error;
    }
  }

  if (!updated) return current;

  const [rows] = await connection.query(
    `
    SELECT
      id,
      source_bid_type,
      source_bid_id,
      source_item_id,
      current_location_code,
      current_status,
      internal_barcode,
      external_barcode
    FROM wms_items
    WHERE id = ?
    LIMIT 1
    `,
    [current.id],
  );
  return rows[0] || current;
}

async function syncWmsByBidStatus(
  connection,
  { bidType, bidId, itemId, nextStatus },
) {
  if (!WORKFLOW_BID_STATUSES.has(nextStatus)) {
    return { updated: false, reason: "unsupported-status" };
  }

  const targetLocationCode = targetLocationByBidStatus(nextStatus, null);
  if (!targetLocationCode) {
    return { updated: false, reason: "target-location-not-found" };
  }
  const provisionalStatusCode = targetStatusByBidStatus(
    nextStatus,
    targetLocationCode,
  );

  let wmsItem = await findWmsItemByBid(connection, { bidType, bidId, itemId });
  if (!wmsItem) {
    wmsItem = await createWmsItemForBid(connection, {
      bidType,
      bidId,
      itemId,
      nextStatus,
      targetLocationCode,
      targetStatusCode: provisionalStatusCode,
    });
    if (!wmsItem) {
      return { updated: false, reason: "wms-item-not-found" };
    }
  }

  const ensuredBarcodeItem = await assignInternalBarcodeIfMissing(connection, {
    wmsItemId: wmsItem.id,
    bidType,
    bidId: Number(bidId),
    itemId: itemId || wmsItem.source_item_id || null,
  });
  if (ensuredBarcodeItem) {
    wmsItem = ensuredBarcodeItem;
  }

  const resolvedTargetLocationCode = targetLocationByBidStatus(
    nextStatus,
    wmsItem.current_location_code,
  );
  if (!resolvedTargetLocationCode) {
    return { updated: false, reason: "target-location-not-found" };
  }

  const targetStatusCode = targetStatusByBidStatus(
    nextStatus,
    resolvedTargetLocationCode,
  );
  const noLocationChange =
    wmsItem.current_location_code === resolvedTargetLocationCode;
  const noStatusChange =
    String(wmsItem.current_status || "") === targetStatusCode;

  if (
    noLocationChange &&
    noStatusChange &&
    wmsItem.source_bid_type === bidType &&
    Number(wmsItem.source_bid_id) === Number(bidId)
  ) {
    return { updated: false, reason: "already-synced", wmsItemId: wmsItem.id };
  }

  const [result] = await connection.query(
    `
    UPDATE wms_items
    SET
      current_location_code = ?,
      current_status = ?,
      source_bid_type = ?,
      source_bid_id = ?,
      source_item_id = COALESCE(NULLIF(TRIM(source_item_id), ''), ?),
      auction_lot_no = COALESCE(NULLIF(TRIM(auction_lot_no), ''), ?),
      updated_at = NOW()
    WHERE id = ?
    `,
    [
      resolvedTargetLocationCode,
      targetStatusCode,
      bidType,
      Number(bidId),
      itemId ? String(itemId) : null,
      itemId ? String(itemId) : null,
      wmsItem.id,
    ],
  );

  return {
    updated: result.affectedRows > 0,
    wmsItemId: wmsItem.id,
    targetLocationCode: resolvedTargetLocationCode,
    targetStatusCode,
  };
}

async function backfillMissingInternalBarcodesByBidLink(connection) {
  const [rows] = await connection.query(
    `
    SELECT
      id,
      source_bid_type,
      source_bid_id,
      source_item_id
    FROM wms_items
    WHERE current_status <> 'COMPLETED'
      AND NULLIF(TRIM(internal_barcode), '') IS NULL
      AND NULLIF(TRIM(external_barcode), '') IS NULL
      AND source_bid_type IN ('direct', 'live', 'instant')
      AND source_bid_id IS NOT NULL
    ORDER BY updated_at DESC, id DESC
    LIMIT 2000
    `,
  );

  for (const row of rows) {
    await assignInternalBarcodeIfMissing(connection, {
      wmsItemId: Number(row.id),
      bidType: String(row.source_bid_type),
      bidId: Number(row.source_bid_id),
      itemId: row.source_item_id || null,
    });
  }
}

async function backfillCompletedWmsItemsByBidStatus(connection) {
  // ========== shipping_status → WMS 동기화 ==========

  // 1. shipping_status = 'domestic_arrived' → WMS를 DOMESTIC_ARRIVAL_ZONE으로
  await connection.query(
    `
    UPDATE wms_items wi
    INNER JOIN direct_bids d
      ON wi.source_bid_type = 'direct' AND wi.source_bid_id = d.id
    SET wi.current_location_code = 'DOMESTIC_ARRIVAL_ZONE',
        wi.current_status = 'DOMESTIC_ARRIVED',
        wi.updated_at = NOW()
    WHERE d.status = 'completed'
      AND d.shipping_status = 'domestic_arrived'
      AND (
        wi.current_location_code NOT IN ('DOMESTIC_ARRIVAL_ZONE', 'INBOUND_ZONE', 'HOLD_ZONE')
        OR wi.current_status = 'COMPLETED'
      )
    `,
  );

  await connection.query(
    `
    UPDATE wms_items wi
    INNER JOIN live_bids l
      ON wi.source_bid_type = 'live' AND wi.source_bid_id = l.id
    SET wi.current_location_code = 'DOMESTIC_ARRIVAL_ZONE',
        wi.current_status = 'DOMESTIC_ARRIVED',
        wi.updated_at = NOW()
    WHERE l.status = 'completed'
      AND l.shipping_status = 'domestic_arrived'
      AND (
        wi.current_location_code NOT IN ('DOMESTIC_ARRIVAL_ZONE', 'INBOUND_ZONE', 'HOLD_ZONE')
        OR wi.current_status = 'COMPLETED'
      )
    `,
  );

  // 2. shipping_status = 'processing' → WMS를 수선존으로 (이미 수선존이면 유지)
  await connection.query(
    `
    UPDATE wms_items wi
    INNER JOIN direct_bids d
      ON wi.source_bid_type = 'direct' AND wi.source_bid_id = d.id
    SET wi.current_location_code = 
          IF(wi.current_location_code IN ('INTERNAL_REPAIR_ZONE', 'EXTERNAL_REPAIR_ZONE', 'REPAIR_DONE_ZONE'),
             wi.current_location_code,
             'INTERNAL_REPAIR_ZONE'),
        wi.current_status = 'INTERNAL_REPAIR_IN_PROGRESS',
        wi.updated_at = NOW()
    WHERE d.status = 'completed'
      AND d.shipping_status = 'processing'
      AND (
        wi.current_location_code NOT IN ('INTERNAL_REPAIR_ZONE', 'EXTERNAL_REPAIR_ZONE', 'REPAIR_DONE_ZONE')
        OR wi.current_status = 'COMPLETED'
      )
    `,
  );

  await connection.query(
    `
    UPDATE wms_items wi
    INNER JOIN live_bids l
      ON wi.source_bid_type = 'live' AND wi.source_bid_id = l.id
    SET wi.current_location_code = 
          IF(wi.current_location_code IN ('INTERNAL_REPAIR_ZONE', 'EXTERNAL_REPAIR_ZONE', 'REPAIR_DONE_ZONE'),
             wi.current_location_code,
             'INTERNAL_REPAIR_ZONE'),
        wi.current_status = 'INTERNAL_REPAIR_IN_PROGRESS',
        wi.updated_at = NOW()
    WHERE l.status = 'completed'
      AND l.shipping_status = 'processing'
      AND (
        wi.current_location_code NOT IN ('INTERNAL_REPAIR_ZONE', 'EXTERNAL_REPAIR_ZONE', 'REPAIR_DONE_ZONE')
        OR wi.current_status = 'COMPLETED'
      )
    `,
  );

  // 3. shipping_status = 'shipped' → WMS를 OUTBOUND_ZONE으로
  await connection.query(
    `
    UPDATE wms_items wi
    INNER JOIN direct_bids d
      ON wi.source_bid_type = 'direct' AND wi.source_bid_id = d.id
    SET wi.current_location_code = 'OUTBOUND_ZONE',
        wi.current_status = 'OUTBOUND_READY',
        wi.updated_at = NOW()
    WHERE d.status = 'completed'
      AND d.shipping_status = 'shipped'
      AND (
        wi.current_location_code <> 'OUTBOUND_ZONE'
        OR wi.current_status = 'COMPLETED'
      )
    `,
  );

  await connection.query(
    `
    UPDATE wms_items wi
    INNER JOIN live_bids l
      ON wi.source_bid_type = 'live' AND wi.source_bid_id = l.id
    SET wi.current_location_code = 'OUTBOUND_ZONE',
        wi.current_status = 'OUTBOUND_READY',
        wi.updated_at = NOW()
    WHERE l.status = 'completed'
      AND l.shipping_status = 'shipped'
      AND (
        wi.current_location_code <> 'OUTBOUND_ZONE'
        OR wi.current_status = 'COMPLETED'
      )
    `,
  );

  // 4. shipping_status = 'completed' → WMS를 COMPLETED로
  await connection.query(
    `
    UPDATE wms_items wi
    INNER JOIN direct_bids d
      ON wi.source_bid_type = 'direct' AND wi.source_bid_id = d.id
    SET wi.current_status = 'COMPLETED',
        wi.updated_at = NOW()
    WHERE d.status = 'completed'
      AND d.shipping_status = 'completed'
      AND wi.current_status <> 'COMPLETED'
    `,
  );

  await connection.query(
    `
    UPDATE wms_items wi
    INNER JOIN live_bids l
      ON wi.source_bid_type = 'live' AND wi.source_bid_id = l.id
    SET wi.current_status = 'COMPLETED',
        wi.updated_at = NOW()
    WHERE l.status = 'completed'
      AND l.shipping_status = 'completed'
      AND wi.current_status <> 'COMPLETED'
    `,
  );

  // === instant_purchases 동기화 ===

  // instant: domestic_arrived
  await connection.query(
    `
    UPDATE wms_items wi
    INNER JOIN instant_purchases p
      ON wi.source_bid_type = 'instant' AND wi.source_bid_id = p.id
    SET wi.current_location_code = 'DOMESTIC_ARRIVAL_ZONE',
        wi.current_status = 'DOMESTIC_ARRIVED',
        wi.updated_at = NOW()
    WHERE p.status = 'completed'
      AND p.shipping_status = 'domestic_arrived'
      AND (
        wi.current_location_code NOT IN ('DOMESTIC_ARRIVAL_ZONE', 'INBOUND_ZONE', 'HOLD_ZONE')
        OR wi.current_status = 'COMPLETED'
      )
    `,
  );

  // instant: processing
  await connection.query(
    `
    UPDATE wms_items wi
    INNER JOIN instant_purchases p
      ON wi.source_bid_type = 'instant' AND wi.source_bid_id = p.id
    SET wi.current_location_code = 
          IF(wi.current_location_code IN ('INTERNAL_REPAIR_ZONE', 'EXTERNAL_REPAIR_ZONE', 'REPAIR_DONE_ZONE'),
             wi.current_location_code,
             'INTERNAL_REPAIR_ZONE'),
        wi.current_status = 'INTERNAL_REPAIR_IN_PROGRESS',
        wi.updated_at = NOW()
    WHERE p.status = 'completed'
      AND p.shipping_status = 'processing'
      AND (
        wi.current_location_code NOT IN ('INTERNAL_REPAIR_ZONE', 'EXTERNAL_REPAIR_ZONE', 'REPAIR_DONE_ZONE')
        OR wi.current_status = 'COMPLETED'
      )
    `,
  );

  // instant: shipped
  await connection.query(
    `
    UPDATE wms_items wi
    INNER JOIN instant_purchases p
      ON wi.source_bid_type = 'instant' AND wi.source_bid_id = p.id
    SET wi.current_location_code = 'OUTBOUND_ZONE',
        wi.current_status = 'OUTBOUND_READY',
        wi.updated_at = NOW()
    WHERE p.status = 'completed'
      AND p.shipping_status = 'shipped'
      AND (
        wi.current_location_code <> 'OUTBOUND_ZONE'
        OR wi.current_status = 'COMPLETED'
      )
    `,
  );

  // instant: completed
  await connection.query(
    `
    UPDATE wms_items wi
    INNER JOIN instant_purchases p
      ON wi.source_bid_type = 'instant' AND wi.source_bid_id = p.id
    SET wi.current_status = 'COMPLETED',
        wi.updated_at = NOW()
    WHERE p.status = 'completed'
      AND p.shipping_status = 'completed'
      AND wi.current_status <> 'COMPLETED'
    `,
  );

  // ========== WMS → shipping_status 동기화 (역방향) ==========

  await connection.query(
    `
    UPDATE direct_bids d
    INNER JOIN wms_items wi
      ON wi.source_bid_type = 'direct' AND wi.source_bid_id = d.id
    SET d.shipping_status = 
        CASE 
          WHEN wi.current_status = 'COMPLETED' THEN 'completed'
          WHEN wi.current_location_code IN ('DOMESTIC_ARRIVAL_ZONE', 'INBOUND_ZONE', 'HOLD_ZONE') 
            THEN 'domestic_arrived'
          WHEN wi.current_location_code IN ('INTERNAL_REPAIR_ZONE', 'EXTERNAL_REPAIR_ZONE', 'REPAIR_DONE_ZONE')
            THEN 'processing'
          WHEN wi.current_location_code = 'OUTBOUND_ZONE'
            THEN 'shipped'
          ELSE d.shipping_status
        END,
        d.updated_at = NOW()
    WHERE d.status = 'completed'
      AND d.shipping_status <> CASE 
          WHEN wi.current_status = 'COMPLETED' THEN 'completed'
          WHEN wi.current_location_code IN ('DOMESTIC_ARRIVAL_ZONE', 'INBOUND_ZONE', 'HOLD_ZONE') 
            THEN 'domestic_arrived'
          WHEN wi.current_location_code IN ('INTERNAL_REPAIR_ZONE', 'EXTERNAL_REPAIR_ZONE', 'REPAIR_DONE_ZONE')
            THEN 'processing'
          WHEN wi.current_location_code = 'OUTBOUND_ZONE'
            THEN 'shipped'
          ELSE d.shipping_status
        END
    `,
  );

  await connection.query(
    `
    UPDATE live_bids l
    INNER JOIN wms_items wi
      ON wi.source_bid_type = 'live' AND wi.source_bid_id = l.id
    SET l.shipping_status = 
        CASE 
          WHEN wi.current_status = 'COMPLETED' THEN 'completed'
          WHEN wi.current_location_code IN ('DOMESTIC_ARRIVAL_ZONE', 'INBOUND_ZONE', 'HOLD_ZONE') 
            THEN 'domestic_arrived'
          WHEN wi.current_location_code IN ('INTERNAL_REPAIR_ZONE', 'EXTERNAL_REPAIR_ZONE', 'REPAIR_DONE_ZONE')
            THEN 'processing'
          WHEN wi.current_location_code = 'OUTBOUND_ZONE'
            THEN 'shipped'
          ELSE l.shipping_status
        END,
        l.updated_at = NOW()
    WHERE l.status = 'completed'
      AND l.shipping_status <> CASE 
          WHEN wi.current_status = 'COMPLETED' THEN 'completed'
          WHEN wi.current_location_code IN ('DOMESTIC_ARRIVAL_ZONE', 'INBOUND_ZONE', 'HOLD_ZONE') 
            THEN 'domestic_arrived'
          WHEN wi.current_location_code IN ('INTERNAL_REPAIR_ZONE', 'EXTERNAL_REPAIR_ZONE', 'REPAIR_DONE_ZONE')
            THEN 'processing'
          WHEN wi.current_location_code = 'OUTBOUND_ZONE'
            THEN 'shipped'
          ELSE l.shipping_status
        END
    `,
  );

  // instant_purchases: WMS → shipping_status 역방향 동기화
  await connection.query(
    `
    UPDATE instant_purchases p
    INNER JOIN wms_items wi
      ON wi.source_bid_type = 'instant' AND wi.source_bid_id = p.id
    SET p.shipping_status = 
        CASE 
          WHEN wi.current_status = 'COMPLETED' THEN 'completed'
          WHEN wi.current_location_code IN ('DOMESTIC_ARRIVAL_ZONE', 'INBOUND_ZONE', 'HOLD_ZONE') 
            THEN 'domestic_arrived'
          WHEN wi.current_location_code IN ('INTERNAL_REPAIR_ZONE', 'EXTERNAL_REPAIR_ZONE', 'REPAIR_DONE_ZONE')
            THEN 'processing'
          WHEN wi.current_location_code = 'OUTBOUND_ZONE'
            THEN 'shipped'
          ELSE p.shipping_status
        END,
        p.updated_at = NOW()
    WHERE p.status = 'completed'
      AND p.shipping_status <> CASE 
          WHEN wi.current_status = 'COMPLETED' THEN 'completed'
          WHEN wi.current_location_code IN ('DOMESTIC_ARRIVAL_ZONE', 'INBOUND_ZONE', 'HOLD_ZONE') 
            THEN 'domestic_arrived'
          WHEN wi.current_location_code IN ('INTERNAL_REPAIR_ZONE', 'EXTERNAL_REPAIR_ZONE', 'REPAIR_DONE_ZONE')
            THEN 'processing'
          WHEN wi.current_location_code = 'OUTBOUND_ZONE'
            THEN 'shipped'
          ELSE p.shipping_status
        END
    `,
  );

  await backfillMissingInternalBarcodesByBidLink(connection);
}

module.exports = {
  syncWmsByBidStatus,
  backfillCompletedWmsItemsByBidStatus,
};
