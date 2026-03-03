// utils/googleSheets.js
const { google } = require("googleapis");
const path = require("path");
const { pool } = require("./DB");
const crypto = require("crypto");

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

/**
 * 다양한 형식의 날짜 문자열을 YYYY-MM-DD 형식으로 변환
 */
function formatDateString(dateStr) {
  // 입력이 없거나 null이면 null 반환
  if (!dateStr) return null;

  // 이미 YYYY-MM-DD 형식이면 그대로 반환
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // YYYY.MM.DD 또는 YYYY.M.D 형식 처리
  const dotFormat = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/;
  if (dotFormat.test(dateStr)) {
    const matches = dateStr.match(dotFormat);
    const year = matches[1];
    const month = matches[2].padStart(2, "0");
    const day = matches[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // YYYY/MM/DD 또는 YYYY/M/D 형식 처리
  const slashFormat = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
  if (slashFormat.test(dateStr)) {
    const matches = dateStr.match(slashFormat);
    const year = matches[1];
    const month = matches[2].padStart(2, "0");
    const day = matches[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // YY.MM.DD 또는 YY.M.D 형식 처리 (20xx년으로 간주)
  const shortYearFormat = /^(\d{2})\.(\d{1,2})\.(\d{1,2})$/;
  if (shortYearFormat.test(dateStr)) {
    const matches = dateStr.match(shortYearFormat);
    const year = `20${matches[1]}`; // 20xx년으로 가정 (21세기)
    const month = matches[2].padStart(2, "0");
    const day = matches[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // 그 외 형식은 Date 객체로 파싱 시도
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return null; // 유효하지 않은 날짜
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch (e) {
    return null; // 파싱 실패
  }
}

class GoogleSheetsManager {
  constructor() {
    this.CREDENTIALS_PATH = path.join("./service-account-key.json");
    this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
    this.auth = null;
    this.sheets = null;
    this.drive = null;
    this.lastModifiedTime = null;
    this.checkInterval = null;

    this.authorize();
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async authorize() {
    try {
      this.auth = new google.auth.GoogleAuth({
        keyFile: this.CREDENTIALS_PATH,
        scopes: [
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive.readonly",
        ],
      });

      const client = await this.auth.getClient();
      this.sheets = google.sheets({ version: "v4", auth: client });
      this.drive = google.drive({ version: "v3", auth: client });

      console.log("Authorization successful");
      this.startModificationCheck();
    } catch (err) {
      console.error("Error in authorization:", err);
      throw err;
    }
  }

  async checkLastModified() {
    try {
      const response = await this.drive.files.get({
        fileId: this.spreadsheetId,
        fields: "modifiedTime",
      });

      const currentModifiedTime = new Date(response.data.modifiedTime);

      if (!this.lastModifiedTime) {
        this.lastModifiedTime = currentModifiedTime;
      } else if (currentModifiedTime > this.lastModifiedTime) {
        console.log("Spreadsheet was modified. Running refresh...");
        await this.refreshAllBidInfo();
        await this.syncUsersWithDB();
        this.lastModifiedTime = currentModifiedTime;
      }
    } catch (error) {
      console.error("Error checking last modified time:", error);
    }
  }

  startModificationCheck() {
    // 기존 인터벌이 있다면 제거
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    // 1분마다 체크
    this.checkInterval = setInterval(() => {
      this.checkLastModified();
    }, 60 * 1000); // 60000ms = 1분
  }

  async findFinal(sheetName, column) {
    const searchResponse = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!${column}1:${column}`,
    });
    const keyColumn = searchResponse.data.values;
    if (!keyColumn) return 1;

    for (let i = 0; i < keyColumn.length; i++) {
      if (!keyColumn[i] || !keyColumn[i][0]) {
        return i + 1;
      }
    }

    return keyColumn.length + 1;
  }
  async appendToSpreadsheet(bidData) {
    try {
      const nextRow = await this.findFinal("Main Sheet", "A");
      const range = `Main Sheet!A${nextRow}:N${nextRow}`;

      const response = await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [bidData],
        },
      });
      console.log("Bid reservation successfully added to the spreadsheet");
      return response;
    } catch (err) {
      console.error("The API returned an error: " + err);
      throw err;
    }
  }

  async findUser(userId) {
    try {
      const sheetRow = (await this.findRows("회원목록", "C", [userId]))[0];
      if (!sheetRow) {
        console.log(`User with ID ${userId} not found.`);
        return [];
      }
      const range = `회원목록!A${sheetRow}:M${sheetRow}`;
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });
      return response.data.values;
    } catch (err) {
      console.error("Error fetching user data:", err.message);
      throw err;
    }
  }

  async findRows(sheetName, column, keys) {
    try {
      const searchResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!${column}1:${column}`,
      });
      const keyColumn = searchResponse.data.values;

      const rowIndices = keys.map((key) => {
        const rowIndex = keyColumn.findIndex((row) => row[0] == key);
        return rowIndex === -1 ? null : rowIndex + 1;
      });

      return rowIndices;
    } catch (err) {
      console.error("Error finding rows by keys:", err.message);
      return null;
    }
  }

  async getBidInfos(bidids) {
    const sheetRows = await this.findRows("Main Sheet", "A", bidids);
    const results = [];
    for (const row of sheetRows) {
      results.push(await this.getBidInfo(row));
      await this.sleep(100);
    }
    return results;
  }

  async getBidInfo(sheetRow) {
    try {
      if (!sheetRow) {
        return null;
      }

      const range = `Main Sheet!L${sheetRow}:N${sheetRow}`;

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });
      if (!response.data.values) return null;
      const values = response.data.values[0].map((e) => e.replace(/\D/g, ""));

      if (values) {
        return {
          first_price: values[0] || null,
          second_price: values[1] || null,
          final_price: values[2] || null,
        };
      }

      return null;
    } catch (err) {
      console.error("Error fetching bid information:", err);
      return null;
    }
  }

  async updateFinalBidAmount(bidId, finalBidAmount) {
    try {
      const sheetRow = (await this.findRows("Main Sheet", "A", [bidId]))[0];
      if (!sheetRow) return null;
      const range = `Main Sheet!N${sheetRow}`;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [[finalBidAmount]],
        },
      });
      console.log("Final bid amount updated successfully");
    } catch (err) {
      console.error("The API returned an error: " + err);
      throw err;
    }
  }

  async refreshAllBidInfo() {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      // 1. DB에서 모든 입찰 ID 가져오기
      const [allBids] = await conn.query(`SELECT id, item_id FROM bids`);
      const allBidIds = allBids.map((bid) => bid.id);

      // 2. 구글 시트에서 모든 입찰 ID 가져오기
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: "Main Sheet!A:A",
      });
      const sheetBidIds = response.data.values
        ?.slice(1) // 헤더 제외
        .filter((row) => row[0]) // 빈 행 제외
        .map((row) => row[0]); // ID만 추출

      if (!sheetBidIds) {
        throw new Error("Failed to fetch bid IDs from Google Sheet");
      }

      // 3. 구글 시트에 없는 입찰 ID 찾기
      const bidsToDelete = allBidIds.filter(
        (id) => !sheetBidIds.includes(id.toString())
      );

      // 4. 구글 시트에 없는 입찰 삭제
      if (bidsToDelete.length > 0) {
        await conn.query(
          `
          DELETE FROM bids 
          WHERE id IN (?)
        `,
          [bidsToDelete]
        );
        console.log(
          `Deleted bids not in Google Sheet: ${bidsToDelete.join(", ")}`
        );
      }

      // 5. 구글 시트에 있는 입찰 정보 업데이트
      const [bidsToUpdate] = await conn.query(`
        SELECT id, item_id
        FROM bids 
        WHERE second_price IS NULL OR final_price IS NULL
      `);

      // Get valid item IDs from crawled_items
      const [validItems] = await conn.query(`
        SELECT item_id FROM crawled_items
      `);
      const validItemIds = new Set(validItems.map((item) => item.item_id));

      const bidIdsToUpdate = bidsToUpdate
        .filter((bid) => validItemIds.has(bid.item_id))
        .map((bid) => bid.id);

      if (bidIdsToUpdate.length > 0) {
        const bidInfos = await this.getBidInfos(bidIdsToUpdate);

        for (let i = 0; i < bidIdsToUpdate.length; i++) {
          if (bidInfos[i]) {
            const updateFields = [];
            const updateValues = [];

            if (bidInfos[i].second_price !== undefined) {
              updateFields.push("second_price = ?");
              updateValues.push(bidInfos[i].second_price);
            }
            if (bidInfos[i].final_price !== undefined) {
              updateFields.push("final_price = ?");
              updateValues.push(bidInfos[i].final_price);
            }

            if (updateFields.length > 0) {
              const updateQuery = `
                UPDATE bids 
                SET ${updateFields.join(", ")}
                WHERE id = ?
              `;

              try {
                await conn.query(updateQuery, [
                  ...updateValues,
                  bidIdsToUpdate[i],
                ]);
              } catch (error) {
                console.error(
                  `Failed to update bid ${bidIdsToUpdate[i]}:`,
                  error
                );
                throw error;
              }
            }
          }
        }

        console.log(
          `Updated bids ${bidIdsToUpdate
            .filter((_, i) => bidInfos[i])
            .join(", ")} with new values`
        );
      }

      await conn.commit();
    } catch (error) {
      if (conn) await conn.rollback();
      console.error("Error in refreshAllBidInfo:", error);
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }
  async syncUsersWithDB() {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      // 1. 구글 시트에서 모든 사용자 가져오기
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: "회원목록!B2:M", // B열(가입일)부터 M열(활성화)까지
      });
      const users = response.data.values || [];

      // 2. 사용자 테이블이 없는 경우 생성 (commission_rate 필드 추가)
      await conn.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(50) PRIMARY KEY,
          registration_date DATE NULL,
          password VARCHAR(64),
          email VARCHAR(100),
          business_number VARCHAR(20),
          company_name VARCHAR(100),
          phone VARCHAR(20),
          address TEXT,
          is_active BOOLEAN,
          commission_rate DECIMAL(5,2) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      // 3. DB에서 현재 사용자 정보 가져오기
      const [dbUsers] = await conn.query("SELECT * FROM users");
      const dbUserMap = {};

      // DB 사용자 정보를 맵으로 변환하여 빠른 조회 가능하게 함
      dbUsers.forEach((user) => {
        dbUserMap[user.id] = user;
      });

      // 4. 각 사용자 동기화 (DB 정보 우선)
      for (const user of users) {
        // 시트 컬럼 매핑 (B열부터 시작)
        const [
          registrationDateStr, // B열: 가입일 (2025.1.8 형식)
          userId, // C열: id
          password, // D열: pw
          businessNumber, // E열: 사업자등록번호
          companyName, // F열: 업체명
          phoneRaw, // G열: 연락처
          email, // H열: 이메일
          address, // I열: 수취주소
          _J,
          _K,
          _L, // J, K, L열 (사용하지 않음)
          isActive, // M열: 활성화
        ] = user;

        // 필수 필드 확인 (userId는 반드시 있어야 함)
        if (!userId) continue;

        // DB에 이미 존재하는 사용자인지 확인
        const existingUser = dbUserMap[userId];

        // 사용자가 DB에 이미 존재하면 스킵 (DB 정보 우선)
        if (existingUser) {
          console.log(
            `사용자 ${userId}는 이미 DB에 존재합니다. 스프레드시트 데이터로 업데이트하지 않습니다.`
          );
          continue;
        }

        // 새 사용자인 경우에만 스프레드시트 데이터를 DB에 추가

        // 가입일 형식 변환 - 정규 표현식을 사용한 향상된 처리
        let registrationDate = formatDateString(registrationDateStr);

        // 전화번호 형식 정규화
        let phone = phoneRaw ? phoneRaw.replace(/[^0-9]/g, "") : null;
        if (phone) {
          // 10으로 시작하면 010으로 변경
          if (phone.startsWith("10")) {
            phone = "0" + phone;
          }
        }

        // 비밀번호 해싱
        const hashedPassword = password ? hashPassword(password) : null;

        // 새 사용자 삽입
        await conn.query(
          `
          INSERT INTO users (
            id, registration_date, password, email, 
            business_number, company_name, phone, address, is_active
          ) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            userId,
            registrationDate,
            hashedPassword,
            email,
            businessNumber,
            companyName,
            phone,
            address,
            isActive === "TRUE" || isActive === true,
          ]
        );

        console.log(
          `새 사용자 ${userId}가 스프레드시트에서 DB로 추가되었습니다.`
        );
      }

      await conn.commit();
      console.log(
        "동기화 완료: 스프레드시트의 새 사용자만 DB에 추가되었습니다."
      );
    } catch (error) {
      if (conn) await conn.rollback();
      console.error("사용자를 DB와 동기화하는 중 오류 발생:", error);
      throw error;
    } finally {
      if (conn) conn.release();
    }
  }
}

const MyGoogleSheetsManager = new GoogleSheetsManager();

module.exports = MyGoogleSheetsManager;
