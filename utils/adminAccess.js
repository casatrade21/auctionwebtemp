const ADMIN_MENU_KEYS = [
  "dashboard",
  "live-bids",
  "direct-bids",
  "instant-purchases",
  "all-bids",
  "bid-results",
  "transactions",
  "invoices",
  "users",
  "recommend-filters",
  "settings",
  "wms",
  "repair-management",
  "activity-logs",
];

function isSuperAdminUser(user) {
  if (!user) return false;
  return (
    String(user.login_id || "").toLowerCase() === "admin" ||
    Number(user.is_superadmin || 0) === 1
  );
}

function parseAllowedMenus(raw) {
  if (!raw) return [];
  if (Array.isArray(raw))
    return raw.filter((x) => ADMIN_MENU_KEYS.includes(String(x)));
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        return parsed.filter((x) => ADMIN_MENU_KEYS.includes(String(x)));
    } catch (_) {
      return [];
    }
  }
  return [];
}

function sanitizeAllowedMenus(menus) {
  if (!Array.isArray(menus)) return [];
  return [
    ...new Set(
      menus.map((x) => String(x)).filter((x) => ADMIN_MENU_KEYS.includes(x)),
    ),
  ];
}

function isAdminUser(user) {
  if (!user) return false;
  if (isSuperAdminUser(user)) return true;
  if (Number(user.is_admin_panel || 0) === 1) return true;

  const role = String(user.role || "").toLowerCase();
  if (role === "admin" || role.includes("admin")) return true;
  return false;
}

function canAccessAdminMenu(user, menuKey) {
  if (!isAdminUser(user)) return false;
  if (isSuperAdminUser(user)) return true;
  if (!menuKey) return true;

  const menus = parseAllowedMenus(user.allowed_menus);
  return menus.includes(menuKey);
}

async function ensureAdminPermissionTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_panel_permissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      is_superadmin TINYINT(1) NOT NULL DEFAULT 0,
      allowed_menus TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

module.exports = {
  ADMIN_MENU_KEYS,
  isSuperAdminUser,
  isAdminUser,
  canAccessAdminMenu,
  parseAllowedMenus,
  sanitizeAllowedMenus,
  ensureAdminPermissionTable,
};
