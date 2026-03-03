const { isAdminUser } = require("./adminAccess");

function requireAdmin(req, res, next) {
  if (isAdminUser(req.session?.user)) return next();
  return res.status(403).json({
    success: false,
    message: "관리자 권한이 필요합니다.",
    code: "FORBIDDEN_ADMIN",
  });
}

module.exports = {
  isAdminUser,
  requireAdmin,
};
