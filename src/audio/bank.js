// 樣本清單:事件 key → 變體檔案(相對 public/audio/)。cat 決定載入批次,g 增益,p 音高隨機(半音),v 音量隨機(dB)。
// 檔案缺少時該事件自動用合成版本。授權與署名見 public/credits/audio.md。
export const CATS = ['weapons', 'steps', 'zombies', 'impacts', 'ui', 'world', 'scare', 'amb'];

export const BANK = {};

// 錄音配樂(串流):依配樂狀態挑選。g 音量、loop 循環、xf 結尾交叉淡化秒數、at 起播位置
export const TRACKS = {};
