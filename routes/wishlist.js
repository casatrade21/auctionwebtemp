// routes/wishlist.js
const express = require("express");
const router = express.Router();
const { pool } = require("../utils/DB");

// Add item to wishlist with favorite number
router.post("/", async (req, res) => {
  const { itemId, favoriteNumber = 1 } = req.body;

  if (!itemId) {
    return res.status(400).json({ message: "Item ID is required" });
  }

  // 즐겨찾기 번호 유효성 검사
  if (![1, 2, 3].includes(Number(favoriteNumber))) {
    return res
      .status(400)
      .json({ message: "Favorite number must be 1, 2, or 3" });
  }

  try {
    const userId = req.session.user.id;

    // Check if item exists
    const [items] = await pool.query(
      "SELECT item_id FROM crawled_items WHERE item_id = ?",
      [itemId]
    );

    if (items.length === 0) {
      return res.status(404).json({ message: "Item not found" });
    }

    // Check if item is already in wishlist with the same favorite number
    const [existingItems] = await pool.query(
      "SELECT * FROM wishlists WHERE user_id = ? AND item_id = ? AND favorite_number = ?",
      [userId, itemId, favoriteNumber]
    );

    if (existingItems.length > 0) {
      return res.status(400).json({
        message: "Item already in wishlist with this favorite number",
      });
    }

    // Add to wishlist with favorite number
    await pool.query(
      "INSERT INTO wishlists (user_id, item_id, favorite_number) VALUES (?, ?, ?)",
      [userId, itemId, favoriteNumber]
    );

    res.status(201).json({ message: "Item added to wishlist" });
  } catch (err) {
    console.error("Error adding to wishlist:", err);
    res.status(500).json({ message: "Error adding to wishlist" });
  }
});

// Get wishlist with favorite numbers
router.get("/", async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [wishlist] = await pool.query(
      `
      SELECT ci.*, w.favorite_number 
      FROM wishlists w
      JOIN crawled_items ci ON w.item_id = ci.item_id
      WHERE w.user_id = ?
      ORDER BY w.favorite_number, ci.item_id
      `,
      [userId]
    );

    res.json(wishlist);
  } catch (err) {
    console.error("Error fetching wishlist:", err);
    res.status(500).json({ message: "Error fetching wishlist" });
  }
});

// Remove item from wishlist for specific favorite number
router.delete("/", async (req, res) => {
  const { itemId, favoriteNumber } = req.body;

  if (!itemId) {
    return res.status(400).json({ message: "Item ID is required" });
  }

  try {
    const userId = req.session.user.id;

    // If favoriteNumber is provided, delete only that specific wishlist entry
    if (favoriteNumber) {
      await pool.query(
        "DELETE FROM wishlists WHERE user_id = ? AND item_id = ? AND favorite_number = ?",
        [userId, itemId, favoriteNumber]
      );
    } else {
      // Otherwise, delete all wishlist entries for this item
      await pool.query(
        "DELETE FROM wishlists WHERE user_id = ? AND item_id = ?",
        [userId, itemId]
      );
    }

    res.json({ message: "Item removed from wishlist" });
  } catch (err) {
    console.error("Error removing from wishlist:", err);
    res.status(500).json({ message: "Error removing from wishlist" });
  }
});

// Update favorite number for an item
router.put("/", async (req, res) => {
  const { itemId, oldFavoriteNumber, newFavoriteNumber } = req.body;

  if (!itemId || !oldFavoriteNumber || !newFavoriteNumber) {
    return res.status(400).json({
      message:
        "Item ID, old favorite number, and new favorite number are required",
    });
  }

  if (![1, 2, 3].includes(Number(newFavoriteNumber))) {
    return res
      .status(400)
      .json({ message: "New favorite number must be 1, 2, or 3" });
  }

  try {
    const userId = req.session.user.id;

    // Check if the item with oldFavoriteNumber exists
    const [existingItems] = await pool.query(
      "SELECT * FROM wishlists WHERE user_id = ? AND item_id = ? AND favorite_number = ?",
      [userId, itemId, oldFavoriteNumber]
    );

    if (existingItems.length === 0) {
      return res.status(404).json({
        message: "Item not found in wishlist with specified favorite number",
      });
    }

    // Check if the item with newFavoriteNumber already exists
    const [conflictItems] = await pool.query(
      "SELECT * FROM wishlists WHERE user_id = ? AND item_id = ? AND favorite_number = ?",
      [userId, itemId, newFavoriteNumber]
    );

    if (conflictItems.length > 0) {
      return res
        .status(400)
        .json({ message: "Item already exists with the new favorite number" });
    }

    // Update favorite number
    await pool.query(
      "UPDATE wishlists SET favorite_number = ? WHERE user_id = ? AND item_id = ? AND favorite_number = ?",
      [newFavoriteNumber, userId, itemId, oldFavoriteNumber]
    );

    res.json({ message: "Favorite number updated" });
  } catch (err) {
    console.error("Error updating favorite number:", err);
    res.status(500).json({ message: "Error updating favorite number" });
  }
});

module.exports = router;
