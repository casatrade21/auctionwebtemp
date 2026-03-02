/**
 * adminAuth.js — 관리자 인증 미들웨어
 *
 * requireAdmin: 세션의 user.role이 admin이 아니면 403 반환.
 * isAdminUser를 adminAccess에서 재익스포트한다.
 */
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
