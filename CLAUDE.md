# Class-Management 專案規則

> **最優先**：只要這次對話要修改程式或增加新功能，第一則回覆就要先提醒導師下面這段，提醒完才開始讀程式或動手。其他規則都排在這條之後。

## 修改程式或增加新功能前，一定要先提醒導師

開始動手之前，先用幾行話提醒導師下面這段，並確認這次會不會改到 `gas/Code.gs`：

> 後端只有一份正式版。直接上傳新程式，等於拿真實的學生資料做測試。
> 所以有改後端時，要把測試版暫時再部署一次：
> 1. 執行 `clasp create-deployment`，會拿到一個新的測試網址。
> 2. 分支上的 `config.js` 暫時改成這個測試網址，然後驗收。
> 3. 合併回 `main` 之前，`config.js` 一定要改回正式網址，用完的測試網址也可以關掉。

## 修改流程

- 開分支修改，驗收沒問題再合併回 `main`。GitHub Pages 只發布 `main`。
- **只改前端**：在分支上用本機預覽驗收。本機預覽連的是 `config.js` 的正式版後端，只看畫面，不新增或修改資料。
- **有改 `Code.gs`**：照上面三步用測試版後端驗收，不可以先推到正式版。
- 合併前檢查 `config.js` 的 `GAS_URL` 是正式版網址（開頭 `AKfycbyv`）。
- 合併後才更新正式版後端：`clasp -P .clasp-prod.json push` → `clasp -P .clasp-prod.json redeploy <正式版部署 ID> -d "說明"`（部署 ID 見 `導師操作清單.md`）。

## clasp 設定

- 測試版：`.clasp.json`（不加 `-P` 的 clasp 指令都作用在測試版）。
- 正式版：`.clasp-prod.json`，指令一定要加 `-P .clasp-prod.json`。
- 兩個檔案都在 `.gitignore`，不可以進 Git。

## 後端改版要相容正式試算表

正式試算表已有真實資料。改 `Code.gs` 時不可以要求重跑 `setup()` 或手動改欄位；新增欄位要像「作業」表的「已點收」欄一樣，讀取時自動補欄並填預設值。

## 權限範圍

`gas/appsscript.json` 維持 `https://www.googleapis.com/auth/spreadsheets.currentonly`，不可以改成 `spreadsheets` 或加 drive 權限（上一層 CLAUDE.md 的 `spreadsheets` 只是範例，這個專案用更小的範圍）。

## 不能改名的卡片

「再抽一次」「幸運女神」的自動效果靠卡名辨識。改程式或卡片資料時不可以改這兩個名稱，也不要改成用其他欄位辨識，除非導師要求。

## 文件要跟著改

功能或流程有變動時，同步更新 `README.md`（第五節驗收表、第六節實作決定）與 `導師操作清單.md`。

## 前端快取版本號

改了任何 CSS、JS（含 `config.js`），四個 HTML 裡的 `?v=N` 和 `sw.js` 的 `class-mgmt-vN` 要一起加大，並同步 `README.md` 實作決定第 28 項。

## 指令小陷阱

- 查部署用 `clasp deployments --json` 或 `clasp versions`；文字清單會延遲顯示舊版號。
- 用 curl 測 GAS 要用 `curl -sL -d '...'`，不要加 `-X POST`（轉址後會回 411）；送中文內容改用 Node，curl 會編碼錯誤。
- 測試時只用錯誤的存取碼（預期回 `UNAUTHORIZED`），不要向導師索取真正的存取碼。
