// utils/elasticsearch.js
const { Client } = require("@elastic/elasticsearch");

class ElasticsearchManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.indices = {}; // 인덱스 설정 저장
  }

  /**
   * ES 연결 초기화
   */
  async connect(
    url = process.env.ELASTICSEARCH_URL || "http://localhost:9200"
  ) {
    try {
      this.client = new Client({
        node: url,
        maxRetries: 3,
        requestTimeout: 60000,
        sniffOnStart: false, // Cloud 환경에서는 false
      });

      await this.client.ping();
      this.isConnected = true;
      console.log("✓ Elasticsearch connected successfully");
      return true;
    } catch (error) {
      this.isConnected = false;
      console.error("✗ Elasticsearch connection failed:", error.message);
      return false;
    }
  }

  /**
   * 인덱스 설정 등록
   * @param {string} name - 인덱스 이름
   * @param {Object} config - 설정 객체
   * @param {Object} config.mappings - 필드 매핑
   * @param {Object} config.settings - 인덱스 설정 (analyzer 등)
   */
  registerIndex(name, config) {
    this.indices[name] = {
      mappings: config.mappings || {},
      settings: config.settings || {},
    };
    console.log(`✓ Index config registered: ${name}`);
  }

  /**
   * 인덱스 생성
   */
  async createIndex(name) {
    try {
      if (!this.indices[name]) {
        throw new Error(`Index config not found: ${name}`);
      }

      const exists = await this.client.indices.exists({ index: name });

      if (exists) {
        console.log(`→ Index already exists: ${name}`);
        return false;
      }

      await this.client.indices.create({
        index: name,
        body: {
          settings: this.indices[name].settings,
          mappings: this.indices[name].mappings,
        },
      });

      console.log(`✓ Index created: ${name}`);
      return true;
    } catch (error) {
      console.error(`✗ Error creating index ${name}:`, error.message);
      throw error;
    }
  }

  /**
   * 인덱스 삭제
   */
  async deleteIndex(name) {
    try {
      await this.client.indices.delete({ index: name });
      console.log(`✓ Index deleted: ${name}`);
      return true;
    } catch (error) {
      console.error(`✗ Error deleting index ${name}:`, error.message);
      throw error;
    }
  }

  /**
   * 퍼지 검색
   * @param {string} indexName - 인덱스 이름
   * @param {string} searchText - 검색어
   * @param {Object} filters - 필터 객체 (키: 필드명, 값: 배열)
   * @param {Object} options - 검색 옵션
   * @returns {Array} 검색 결과 (item_id 배열)
   */
  async search(indexName, searchText, filters = {}, options = {}) {
    try {
      if (!this.isConnected) {
        throw new Error("Elasticsearch not connected");
      }

      const {
        fields = ["title^2", "brand"], // 기본 검색 필드
        fuzziness = "AUTO", // 오타 허용 정도
        operator = "and", // 검색어 조합 방식
        size = 5000, // 최대 결과 수
      } = options;

      // 쿼리 빌드
      const query = {
        multi_match: {
          query: searchText,
          fields: fields,
          fuzziness: fuzziness,
          prefix_length: 1, // 첫 글자는 정확해야 함
          operator: operator,
        },
      };

      // 필터 빌드
      const mustFilters = [];
      Object.entries(filters).forEach(([field, values]) => {
        if (Array.isArray(values) && values.length > 0) {
          // brand와 title은 .keyword 서브필드 사용, 나머지는 직접 사용
          const fieldName =
            field === "brand" || field === "title" ? `${field}.keyword` : field;
          mustFilters.push({
            terms: { [fieldName]: values },
          });
        }
      });

      // 검색 실행
      const response = await this.client.search({
        index: indexName,
        body: {
          query: {
            bool: {
              must: [query],
              filter: mustFilters,
            },
          },
          size: size,
          _source: false, // item_id만 필요하므로 source는 가져오지 않음
        },
      });

      // item_id 배열 반환
      return response.hits.hits.map((hit) => hit._id);
    } catch (error) {
      console.error(`✗ Search error in ${indexName}:`, error.message);
      // ES 실패 시 빈 배열 반환 (fallback 가능하도록)
      return [];
    }
  }

  /**
   * 단일 문서 인덱싱
   */
  async indexDocument(indexName, id, document) {
    try {
      await this.client.index({
        index: indexName,
        id: id,
        document: document,
        refresh: false, // 대량 작업 시 false, 즉시 검색 필요하면 true
      });
      return true;
    } catch (error) {
      console.error(`✗ Error indexing document ${id}:`, error.message);
      return false;
    }
  }

  /**
   * 벌크 인덱싱
   * @param {string} indexName - 인덱스 이름
   * @param {Array} documents - 문서 배열 (각 문서는 item_id 필드 필수)
   * @returns {Object} 결과 { indexed, errors }
   */
  async bulkIndex(indexName, documents) {
    if (!documents || documents.length === 0) {
      return { indexed: 0, errors: 0 };
    }

    try {
      const body = documents.flatMap((doc) => [
        { index: { _index: indexName, _id: doc.item_id } },
        doc,
      ]);

      const response = await this.client.bulk({
        body,
        refresh: false,
      });

      if (response.errors) {
        const errorItems = response.items.filter((item) => item.index.error);
        console.error(`✗ Bulk indexing errors: ${errorItems.length}`);
        return {
          indexed: documents.length - errorItems.length,
          errors: errorItems.length,
        };
      }

      console.log(`✓ Bulk indexed: ${documents.length} documents`);
      return {
        indexed: documents.length,
        errors: 0,
      };
    } catch (error) {
      console.error("✗ Bulk indexing failed:", error.message);
      return {
        indexed: 0,
        errors: documents.length,
      };
    }
  }

  /**
   * 문서 삭제
   */
  async deleteDocument(indexName, id) {
    try {
      await this.client.delete({
        index: indexName,
        id: id,
      });
      return true;
    } catch (error) {
      // 404 에러는 무시 (이미 없는 문서)
      if (error.meta?.statusCode === 404) {
        return true;
      }
      console.error(`✗ Error deleting document ${id}:`, error.message);
      return false;
    }
  }

  /**
   * 인덱스 통계
   */
  async getStats(indexName) {
    try {
      const response = await this.client.count({ index: indexName });
      return { total: response.count };
    } catch (error) {
      console.error(`✗ Error getting stats for ${indexName}:`, error.message);
      return { total: 0 };
    }
  }

  /**
   * 연결 상태 확인
   */
  isHealthy() {
    return this.isConnected;
  }

  /**
   * 인덱스 새로고침 (테스트용, 프로덕션에서는 사용 주의)
   */
  async refresh(indexName) {
    try {
      await this.client.indices.refresh({ index: indexName });
      console.log(`✓ Index refreshed: ${indexName}`);
    } catch (error) {
      console.error(`✗ Refresh error for ${indexName}:`, error.message);
    }
  }

  /**
   * 연결 종료
   */
  async close() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      console.log("✓ Elasticsearch connection closed");
    }
  }
}

// 싱글톤 인스턴스
const esManager = new ElasticsearchManager();

module.exports = esManager;
