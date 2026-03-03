const express = require("express");
const router = express.Router();
const MyGoogleSheetsManager = require("../utils/googleSheets");
const { pool } = require("../utils/DB");

function formatDate(dateString) {
  const date = new Date(dateString);
  // UTC 시간에 9시간(KST)을 더함
  const kstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kstDate.toISOString().split("T")[0];
}

router.post("/place-reservation", async (req, res) => {
  const { itemId, bidAmount, isFinalBid } = req.body;
  const linkFunc = {
    1: (itemId) => `https://www.ecoauc.com/client/auction-items/view/${itemId}`,
    2: (itemId) => itemId,
    3: (itemId) => `https://www.starbuyers-global-auction.com/item/${itemId}`, // StarAuc 링크 추가
  };
  if (!itemId || !bidAmount) {
    return res
      .status(400)
      .json({ message: "Item ID, bid amount are required" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (!req.session.user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 기존 입찰 확인
    const [existingBids] = await connection.query(
      "SELECT * FROM bids WHERE item_id = ? AND user_id = ?",
      [itemId, req.session.user.id]
    );

    let bid = null;
    if (isFinalBid) {
      bid = existingBids[0];
      if (!bid) {
        await connection.rollback();
        return res.status(404).json({ message: "Bid not found" });
      }
      // 최종 입찰 중복 체크
      if (bid.final_price !== null) {
        await connection.rollback();
        return res.status(400).json({ message: "Final bid already exists" });
      }
      // DB 업데이트 추가
      await connection.query("UPDATE bids SET final_price = ? WHERE id = ?", [
        bidAmount,
        bid.id,
      ]);
      await MyGoogleSheetsManager.updateFinalBidAmount(bid.id, bidAmount);
      bid.final_price = bidAmount;
    } else {
      // 초기 입찰 중복 체크
      if (existingBids.length > 0) {
        await connection.rollback();
        return res.status(400).json({ message: "Initial bid already exists" });
      }
      // 기존 초기 입찰 로직...
      const [items] = await connection.query(
        "SELECT * FROM crawled_items WHERE item_id = ?",
        [itemId]
      );
      const item = items[0];

      if (!item) {
        await connection.rollback();
        return res.status(404).json({ message: "Item not found" });
      }

      const [result] = await connection.query(
        "INSERT INTO bids (item_id, user_id, first_price, image) VALUES (?, ?, ?, ?)",
        [itemId, req.session.user.id, bidAmount, item.image]
      );

      const bidData = [
        result.insertId + "",
        req.session.user.email,
        req.session.user.id,
        item.scheduled_date ? formatDate(item.scheduled_date) : "",
        linkFunc[item.auc_num](item.item_id),
        item.category,
        item.brand,
        item.original_title,
        item.rank,
        item.starting_price,
        `=IMAGE("${
          item.image[0] == "/"
            ? "http://casastrade.com/" + item.image
            : item.image
        }")`,
        bidAmount,
      ];
      bid = {
        item_id: itemId,
        user_id: req.session.user.id,
        first_price: bidAmount,
      };
      await MyGoogleSheetsManager.appendToSpreadsheet(bidData);
    }

    await connection.commit();

    res.status(201).json({
      message: "Bid reservation placed successfully",
      bidInfo: bid,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error placing bid reservation:", err);

    if (!isFinalBid && bid) {
      try {
        await connection.query(
          "DELETE FROM bids WHERE item_id = ? AND user_id = ?",
          [itemId, req.session.user.id]
        );
        console.log("Rolled back bid insertion due to error");
      } catch (deleteErr) {
        console.error("Error deleting bid after rollback:", deleteErr);
      }
    }

    res.status(500).json({ message: "Error placing bid reservation" });
  } finally {
    connection.release();
  }
});

module.exports = router;
