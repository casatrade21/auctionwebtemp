// utils/proxy.js
const tough = require("tough-cookie");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");
const {
  HttpCookieAgent,
  HttpsCookieAgent,
  createCookieAgent,
} = require("http-cookie-agent/http");

let hasLoggedMissingProxyConfig = false;

class ProxyManager {
  constructor(config = {}) {
    this.proxyIPs = this.loadProxyIPs();
    this.defaultHeaders = config.headers || {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    this.defaultTimeout = config.timeout || 30000;
    this.defaultMaxRedirects = config.maxRedirects || 5;
  }

  loadProxyIPs() {
    const proxyIPsString = process.env.PROXY_IPS;
    if (!proxyIPsString || !proxyIPsString.trim()) {
      if (!hasLoggedMissingProxyConfig) {
        console.log("No PROXY_IPS found, using direct connection only");
        hasLoggedMissingProxyConfig = true;
      }
      return [];
    }
    return proxyIPsString
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean);
  }

  /**
   * 직접 연결 클라이언트 생성
   */
  createDirectClient() {
    const cookieJar = new tough.CookieJar();

    const client = axios.create({
      httpAgent: new HttpCookieAgent({
        cookies: { jar: cookieJar },
      }),
      httpsAgent: new HttpsCookieAgent({
        cookies: { jar: cookieJar },
      }),
      headers: this.defaultHeaders,
      maxRedirects: this.defaultMaxRedirects,
      timeout: this.defaultTimeout,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      },
    });

    return {
      client,
      cookieJar,
      type: "direct",
      name: "직접연결",
      proxyInfo: null,
    };
  }

  /**
   * 프록시 클라이언트 생성
   */
  createProxyClient(proxyIP, port = 3128) {
    const cookieJar = new tough.CookieJar();

    const HttpProxyCookieAgent = createCookieAgent(HttpProxyAgent);
    const HttpsProxyCookieAgent = createCookieAgent(HttpsProxyAgent);

    const client = axios.create({
      httpAgent: new HttpProxyCookieAgent({
        cookies: { jar: cookieJar },
        host: proxyIP,
        port: port,
        protocol: "http:",
      }),
      httpsAgent: new HttpsProxyCookieAgent({
        cookies: { jar: cookieJar },
        host: proxyIP,
        port: port,
        protocol: "http:",
      }),
      headers: this.defaultHeaders,
      maxRedirects: this.defaultMaxRedirects,
      timeout: this.defaultTimeout,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      },
    });

    return {
      client,
      cookieJar,
      type: "proxy",
      name: `프록시(${proxyIP})`,
      proxyInfo: { ip: proxyIP, port },
    };
  }

  /**
   * 모든 가능한 클라이언트 생성 (직접 연결 + 모든 프록시)
   */
  createAllClients() {
    const clients = [];

    // 직접 연결 클라이언트
    clients.push({
      index: 0,
      ...this.createDirectClient(),
      isLoggedIn: false,
      loginTime: null,
    });

    // 프록시 클라이언트들
    this.proxyIPs.forEach((ip, index) => {
      clients.push({
        index: index + 1,
        ...this.createProxyClient(ip),
        isLoggedIn: false,
        loginTime: null,
      });
    });

    return clients;
  }

  /**
   * 특정 클라이언트 재생성
   */
  recreateClient(clientIndex) {
    if (clientIndex === 0) {
      return {
        index: 0,
        ...this.createDirectClient(),
        isLoggedIn: false,
        loginTime: null,
      };
    } else {
      const proxyIP = this.proxyIPs[clientIndex - 1];
      if (!proxyIP) {
        throw new Error(`Invalid client index: ${clientIndex}`);
      }
      return {
        index: clientIndex,
        ...this.createProxyClient(proxyIP),
        isLoggedIn: false,
        loginTime: null,
      };
    }
  }

  /**
   * 클라이언트 연결 테스트
   */
  async testClient(clientInfo, testUrl = "https://httpbin.org/ip") {
    try {
      const response = await clientInfo.client.get(testUrl, { timeout: 10000 });
      return {
        success: true,
        status: response.status,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 모든 클라이언트 연결 테스트
   */
  async testAllClients(clients, testUrl = "https://httpbin.org/ip") {
    const results = await Promise.allSettled(
      clients.map(async (client) => {
        const result = await this.testClient(client, testUrl);
        return {
          name: client.name,
          index: client.index,
          ...result,
        };
      })
    );

    return results.map((result, index) => ({
      client: clients[index],
      test:
        result.status === "fulfilled"
          ? result.value
          : { success: false, error: result.reason.message },
    }));
  }

  /**
   * 사용 가능한 프록시 수 반환
   */
  getAvailableProxyCount() {
    return this.proxyIPs.length;
  }

  /**
   * 총 클라이언트 수 반환 (직접 연결 + 프록시)
   */
  getTotalClientCount() {
    return 1 + this.proxyIPs.length;
  }
}

module.exports = { ProxyManager };
