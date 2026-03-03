const express = require("express");
const router = express.Router();

// Express 앱에서 실제 라우트 추출
function extractRoutes(app) {
  const routes = [];

  function collectRoutes(stack, basePath = "") {
    stack.forEach((layer) => {
      if (layer.route) {
        // 실제 라우트가 있는 경우
        if (layer.route.methods.get) {
          const fullPath = basePath + layer.route.path;
          routes.push(fullPath);
        }
      } else if (
        layer.name === "router" &&
        layer.handle &&
        layer.handle.stack
      ) {
        // 라우터인 경우 - 마운트 경로를 찾아야 함
        let mountPath = "";

        // Express 내부에서 마운트 경로를 찾는 방법
        if (layer.regexp) {
          const keys = layer.keys || [];
          const source = layer.regexp.source;

          // 간단한 경우: /^\/api\/ 형태
          const simpleMatch = source.match(/^\^\\?\/([\w-]+)/);
          if (simpleMatch) {
            mountPath = "/" + simpleMatch[1];
          }
        }

        collectRoutes(layer.handle.stack, basePath + mountPath);
      }
    });
  }

  if (app._router && app._router.stack) {
    collectRoutes(app._router.stack);
  }

  return routes;
}

// 페이지 라우트만 필터링
function filterPageRoutes(routes) {
  return routes.filter((route) => {
    // API 라우트 제외
    if (route.includes("/api")) return false;

    // 관리자 라우트 제외
    if (route.includes("/admin")) return false;

    // 동적 파라미터 제외
    if (route.includes(":")) return false;

    // 시스템 라우트 제외
    if (
      route.includes("sitemap") ||
      route.includes("robots") ||
      route.includes("debug")
    )
      return false;

    // 인증 필요한 페이지 제외
    const authPages = [
      "/valuesPage",
      "/bidResultsPage",
      "/bidProductsPage",
      "/appr/mypage",
    ];
    if (authPages.includes(route)) return false;

    return true;
  });
}

// 사이트맵 XML 생성
function generateSitemap(baseUrl, routes) {
  const lastmod = new Date().toISOString().split("T")[0];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

  routes.forEach((route) => {
    const priority = route === "/" ? "1.0" : "0.5";
    xml += `
  <url>
    <loc>${baseUrl}${route}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
  });

  xml += `
</urlset>`;
  return xml;
}

// 사이트맵 라우트
router.get("/sitemap.xml", (req, res) => {
  try {
    const host = req.headers.host;
    const protocol = req.secure ? "https" : "http";
    const baseUrl = `${protocol}://${host}`;

    // 1. 모든 라우트 추출
    const allRoutes = extractRoutes(req.app);

    // 2. 페이지만 필터링
    let pageRoutes = filterPageRoutes(allRoutes);

    // 3. 도메인별 필터링
    if (host === "cassystem.com" || host === "www.cassystem.com") {
      pageRoutes = pageRoutes.filter(
        (route) => route.startsWith("/appr") || route === "/"
      );
    } else if (host === "casastrade.com" || host === "www.casastrade.com") {
      pageRoutes = pageRoutes.filter((route) => !route.startsWith("/appr"));
    }

    // 4. XML 생성
    const sitemap = generateSitemap(baseUrl, pageRoutes);

    res.set("Content-Type", "application/xml");
    res.send(sitemap);
  } catch (error) {
    console.error("Sitemap generation error:", error);
    res.status(500).send("Error generating sitemap");
  }
});

// robots.txt
router.get("/robots.txt", (req, res) => {
  const host = req.headers.host;
  const protocol = req.secure ? "https" : "http";
  const baseUrl = `${protocol}://${host}`;

  const robots = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /appr/admin

Sitemap: ${baseUrl}/sitemap.xml`;

  res.set("Content-Type", "text/plain");
  res.send(robots);
});

// 디버그용
router.get("/debug/routes", (req, res) => {
  const allRoutes = extractRoutes(req.app);
  const pageRoutes = filterPageRoutes(allRoutes);

  res.json({
    allRoutes: allRoutes,
    pageRoutes: pageRoutes,
  });
});

module.exports = router;
