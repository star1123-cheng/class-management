/*
 * 公開設定檔（會跟著網頁一起公開，不可放存取碼、Token 或密碼）
 * 存取碼只存在 GAS 的「指令碼屬性 ACCESS_CODE」，前端由導師在設定頁輸入。
 */
window.APP_CONFIG = {
  // 部署 GAS 網頁應用程式後，把網址（以 /exec 結尾）貼在這裡
  // 【測試中】分支驗收用的測試版網址；合併回 main 前一定要改回正式版（開頭 AKfycbyv）
  GAS_URL: 'https://script.google.com/macros/s/AKfycbzX4y5sw2l4qe1PNtglmIIIGhCN8KwNgHqocUJKGWJUYeJAiIGJSaOSSX72WZ7RT05yOg/exec',

  // 抽籤頁背景音樂來源："youtube"（預設）、"mp3"（assets/lottery-bgm.mp3）、"none"（只用合成音效）
  MUSIC_SOURCE: 'youtube',

  // NCS〈Invisible〉Julius Dreisig & Zeus X Crona
  YOUTUBE_VIDEO_ID: 'QglaLzo_aPk'
};
