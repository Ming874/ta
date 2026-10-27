// 聖心醫院的劇情互動物件包(給互動引擎的擺放器使用)。
//
// 每一件物件都要回答三個問題:是誰的、為什麼在這裡、它指向什麼(STORY.md §1.11、§11)。
// 文字內容在 ../notes.js(NOTES)與 ../lines.js(PHONE、RADIO、TV、PA、TYPEWRITER、HIS);這裡只放 id。
//
// 物件格式:
//   { id: 'h.ix.…', kind, zone: 區域 id, mount: 'wall' | 'floor' | 'surface' | 'auto',
//     near: 'door' | 'corner' | 區域 id | null, why: 一句話(誰放的、為什麼), ...參數 }
// kind 與參數見互動引擎的清單;本包額外帶的欄位(keypad.power、circuit.initial)寫在 items_doc.extensions。
// 2F 沒有護理站區域:護理站的東西一律放在 f2_corridor,near: 'f2_ward_207'。
//
// 目標鏈(STORY.md §5.2):
//   二、查出 207 號病歷在哪裡:H06(1F 印表機)、登記簿(2F)、HIS 終端 → 密碼 1024。
//   三、恢復 B1 發電機:三顆保險絲(洗衣房、鍋爐房、太平間)→ B1 配電盤 → h.gen.on。
//       取得保全識別證(R5 呂建國掉落)→ 3F 監控室 → 鍵盤 1024 → h.207.unlock。
//   四、207 的門被撞開(R10)→ 床墊底下的 H10(由劇情放出,不在本包)。

const B1_LIT = ['b1_tunnel', 'b1_morgue', 'b1_autopsy', 'b1_laundry', 'b1_boiler', 'b1_supply', 'b1_archive', 'b1_pump'];

const items = [
  // ================================================================== 目標鏈:H 檔案
  { id: 'h.ix.h01', kind: 'note', zone: 'f1_lobby', mount: 'floor', near: null, note: 'H01', style: 'paper',
    why: '萬嵐在大廳發的回神說明會傳單；集合那一夜，家屬手上都拿著一張。' },
  { id: 'h.ix.h09', kind: 'pickup', zone: 'f1_lobby', mount: 'floor', near: null, note: 'H09',
    why: '阿哲在大廳等了一整晚，把錄著語音備忘的手機忘在一張輪椅上。' },
  { id: 'h.ix.h06', kind: 'note', zone: 'f1_waiting', mount: 'surface', near: null, note: 'H06', style: 'paper',
    why: '1F 門診護理站的印表機；七月初三跳電重開機後，把卡在佇列裡的 207 異動單印了出來。' },
  { id: 'h.ix.h04', kind: 'cassette', zone: 'f1_chapel', mount: 'surface', near: null, tape: 'H04',
    why: '安修女在禮拜堂替昏迷的秀鈴放錄音帶，最後一捲還在錄音機裡。' },
  { id: 'h.ix.h08', kind: 'note', zone: 'b1_morgue', mount: 'wall', near: null, note: 'H08', style: 'clipboard',
    why: '夜班回收班的交接清冊，掛在冰櫃旁。' },
  { id: 'h.ix.h03', kind: 'drawer', zone: 'f2_ward_207', mount: 'surface', near: null, loot: { note: 'H03' },
    why: '207 的床頭櫃；安修女把信放在這裡，等醒來的秀鈴哪天走進來。' },
  { id: 'h.ix.h07', kind: 'note', zone: 'f3_cell_1', mount: 'wall', near: 'door', note: 'H07', style: 'clipboard',
    why: '萬嵐試驗病房的護理紀錄夾板，掛在受試者 001 的門口。' },
  { id: 'h.ix.h02', kind: 'drawer', zone: 'f3_dorm', mount: 'surface', near: null, loot: { note: 'H02' },
    why: '安修女在宿舍的抽屜，收著她每年寫給秀鈴、沒有寄出的信。' },
  { id: 'h.ix.h05', kind: 'drawer', zone: 'f3_director', mount: 'wall', near: 'corner', loot: { note: 'H05' }, label: '院長室保險箱', code: '1024',
    why: '院長室保險箱，密碼是 207 的入院日；何啟明把合照與焚化排程鎖在這裡。' },

  // ================================================================== 目標鏈:密碼 1024(調查幕)
  { id: 'h.ix.terminal', kind: 'terminal', zone: 'f1_waiting', mount: 'surface', near: null,
    why: '門診掛號櫃台的 HIS v2.3 終端；輸入 207 會看到入院日。' },
  { id: 'h.ix.sticky0277', kind: 'note', zone: 'f1_waiting', mount: 'surface', near: null, note: 'h.s05', style: 'paper',
    why: '阿哲查他媽媽時貼在螢幕邊的便利貼。' },
  { id: 'h.ix.logbook', kind: 'logbook', zone: 'f2_corridor', mount: 'surface', near: 'f2_ward_207', note: 'h.s04', sign: { flag: 'h.visit.signed' },
    why: '2F 護理站的探病登記簿；第一行是 1999/10/24，最後兩個星期日是空的。簽名就能送走鄭玉蘭。' },

  // ================================================================== 目標鏈:保險絲與發電機(解鎖幕)
  { id: 'h.ix.arrow', kind: 'note', zone: 'b1_tunnel', mount: 'wall', near: null, note: 'h.s01', style: 'paper',
    why: '小芳寫在 B1 電梯呼叫鈕旁的鉛筆字「↓ 冷」，提醒自己保險絲放在太平間。' },
  { id: 'h.ix.slip', kind: 'pickup', zone: 'f2_corridor', mount: 'floor', near: null, note: 'h.s02',
    why: '電梯每次都回到 2 樓；小芳寫給護理長的回收單被車廂帶到二樓電梯口（H-EV2 若觸發，沿用同一張）。' },
  { id: 'h.ix.morgueboard', kind: 'note', zone: 'b1_morgue', mount: 'wall', near: null, note: 'h.s03', style: 'whiteboard',
    why: '回收班的冰櫃登記白板：1、3、5 號空格不必巡，2、4、6 號有人或預約。' },
  { id: 'h.ix.morgue', kind: 'morgue', zone: 'b1_morgue', mount: 'wall', near: null, doors: 6, order: [3, 1, 5], loot: { item: 'fuse' }, wrong: 'crawler',
    why: '小芳把第三顆保險絲藏在 5 號空冰櫃，紙條寫「三號、一號、五號，照這個順序拉」；拉到 2、4、6 號會放出裡面的人。' },
  { id: 'h.ix.fuse.laundry', kind: 'pickup', zone: 'b1_laundry', mount: 'floor', near: 'corner', item: 'fuse',
    why: '小芳把一顆保險絲藏在烘衣機後面；回收班不進洗衣房。' },
  { id: 'h.ix.fuse.boiler', kind: 'locker', zone: 'b1_boiler', mount: 'wall', near: 'corner', loot: { item: 'fuse' }, label: '工務室備品',
    why: '小芳把第二顆塞回工務室的備品櫃，夾在一堆燒壞的保險絲中間。' },
  { id: 'h.ix.notice.power', kind: 'note', zone: 'b1_boiler', mount: 'wall', near: null, note: 'h.s12', style: 'poster',
    why: '工務室七月初二貼的停電通知，列出發電機的三條供電迴路。' },
  { id: 'h.ix.fusebox', kind: 'fusebox', zone: 'b1_boiler', mount: 'wall', near: null, slots: 3, item: 'fuse',
    circuits: [
      { id: 'h.pwr.207', label: '207 病房（延長線）', zones: ['f2_ward_207'], initial: true },
      { id: 'h.pwr.monitor', label: '3F 監控室', zones: ['f3_monitor'] },
      { id: 'h.pwr.b1', label: 'B1 照明・電梯', zones: B1_LIT },
    ],
    capacity: 'fuses', onFull: { flag: 'h.gen.on' },
    why: 'B1 的配電盤。小芳照護理長的意思拔掉三顆主保險絲，讓電梯停住、回收班上不了樓；裝回去會很吵。加急單只夠兩條迴路（207 的燈或監控室）。' },
  { id: 'h.ix.oil', kind: 'pickup', zone: 'b1_boiler', mount: 'floor', near: 'corner', item: 'oil',
    why: '鍋爐房的柴油桶；北側後勤巷那台發電機燒的就是這個，207 的燈靠它亮著（支線「207 的燈」）。' },
  { id: 'h.ix.lock.monitor', kind: 'lock', zone: 'f3_monitor', mount: 'wall', near: 'door', door: 'f3_monitor', item: 'card.security', flag: null, text: '監控室 · 請刷保全識別證',
    why: '萬嵐保全管的監控室，只有保全識別證打得開；識別證在呂建國身上（R5）。' },
  { id: 'h.ix.keypad', kind: 'keypad', zone: 'f3_monitor', mount: 'wall', near: null, code: '1024', title: '3F 監控室 · 207 門禁授權', onSolve: { flag: 'h.207.unlock' }, wrong: '授權碼錯誤。', power: 'h.pwr.monitor',
    why: '207 的電子鎖由監控室控制；授權碼是「她來的那一天」。' },
  { id: 'h.ix.lock.207', kind: 'lock', zone: 'f2_ward_207', mount: 'wall', near: 'door', door: 'f2_ward_207', item: null, flag: 'h.207.unlock', text: '電子鎖 · 需要授權',
    why: '2025/02/27 無名氏移入 207 時萬嵐裝的電子鎖；門上「207 不要開門」是鄭玉蘭同一天寫的。' },

  // ================================================================== 2F 護理站(鄭玉蘭)
  { id: 'h.ix.nursecall', kind: 'nursecall', zone: 'f2_corridor', mount: 'wall', near: 'f2_ward_207', room: '207',
    why: '護理站的呼叫面板；207 的叫人鈴一直被按住，R10 時全院的燈都會亮成 207。' },
  { id: 'h.ix.phone.nurse', kind: 'phone', zone: 'f2_corridor', mount: 'surface', near: 'f2_ward_207', style: 'nurse', ext: '2F 護理站', calls: ['ph.n01', 'ph.n02', 'ph.n03', 'ph.n04'], ring: 'tension', special: null,
    why: '2F 護理站的電話；R2 會響兩聲半，放出 1999 年的舊廣播錄音。' },
  { id: 'h.ix.answering', kind: 'answering', zone: 'f2_corridor', mount: 'surface', near: 'f2_ward_207', message: 'ph.vm01',
    why: '護理站的答錄機，紅燈還在閃：安修女七月初三 00:41 的留言，鄭玉蘭聽過，沒有刪（H-EV5）。' },
  { id: 'h.ix.whiteboard', kind: 'note', zone: 'f2_corridor', mount: 'wall', near: 'f2_ward_207', note: 'h.s06', style: 'whiteboard',
    why: '鄭玉蘭寫的夜間遊走白板：每個病人晚上會走回哪裡，還有交班時間。' },
  { id: 'h.ix.handover4', kind: 'note', zone: 'f2_corridor', mount: 'surface', near: 'f2_ward_207', note: 'h.s23', style: 'clipboard',
    why: '鄭玉蘭七月初四清晨的交班，沒有人來接班。' },
  { id: 'h.ix.internbook', kind: 'note', zone: 'f2_corridor', mount: 'surface', near: 'f2_ward_208', note: 'h.s07', style: 'paper',
    why: '小芳的實習筆記，攤在護理站桌上；她七月初四被護理長送下 B1 時沒帶走。' },
  { id: 'h.ix.zhenglocker', kind: 'locker', zone: 'f2_corridor', mount: 'wall', near: 'f2_ward_208', loot: { note: 'h.s08' }, label: '鄭玉蘭', code: '2330',
    why: '護理長的置物櫃，密碼是大夜交班時間；裡面是她過世前一晚寫的最後一頁交班。' },
  { id: 'h.ix.tape1998', kind: 'cassette', zone: 'f2_corridor', mount: 'surface', near: 'f2_ward_207', tape: 'h.s09',
    why: '金水伯的錄音帶收在護理站；封鎖後的星期日，鄭玉蘭用這台錄音機替他放。' },
  { id: 'h.ix.notice.ward', kind: 'note', zone: 'f2_ward_206', mount: 'wall', near: 'door', note: 'h.s24', style: 'poster',
    why: '病房門內的住院須知；第五條是 001 醒來後鄭玉蘭加的。' },
  { id: 'h.ix.switch203', kind: 'switch', zone: 'f2_ward_203', mount: 'wall', near: 'door', target: 'f2_ward_203',
    why: '203 的燈開關；牆上的「別開燈」是 203 病人的女兒寫的，開燈會讓她父親躁動。' },

  // ================================================================== 支線:地下室有人(林小芳)
  { id: 'h.ix.phone.b12', kind: 'phone', zone: 'f1_er', mount: 'wall', near: null, style: 'wall', ext: 'B12', calls: ['ph.b12a', 'ph.b12b'], ring: 'flag:h.ev.pipes', special: null,
    why: '急診的牆上電話；小芳從營養部倉庫的分機 B12 撥內線（H-EV1 或 G-EV02）。第二通在敲完水管之後。' },
  { id: 'h.ix.pipes', kind: 'note', zone: 'b1_tunnel', mount: 'wall', near: null, note: 'h.s11', style: 'paper',
    why: '小芳畫在主水管上的粉筆記號：三短三長三短，是她跟護理長約好的敲法。' },
  { id: 'h.ix.b1poster', kind: 'note', zone: 'b1_stair_w', mount: 'wall', near: null, note: 'h.s10', style: 'poster',
    why: '小芳七月初六貼在 B1 樓梯口告示板的紙條（現有告示）。' },

  // ================================================================== 支線:洗衣房 14 號櫃(王進財)
  { id: 'h.ix.wanglocker', kind: 'locker', zone: 'b1_laundry', mount: 'wall', near: null, loot: { note: 'h.s26' }, label: '王進財', code: '1968',
    why: '王進財在洗衣房用了四十年的櫃子；他住進 205 以後每晚走回來站在這裡，嘴裡念著到職那一年。' },

  // ================================================================== 支線:呂建國的置物櫃(保全室)
  { id: 'h.ix.flyer', kind: 'note', zone: 'f1_security', mount: 'wall', near: null, note: 'h.s13', style: 'poster',
    why: '呂建國釘在保全室軟木板上的女兒鋼琴發表會傳單。' },
  { id: 'h.ix.lulocker', kind: 'locker', zone: 'f1_security', mount: 'wall', near: 'corner', loot: { note: 'h.s14' }, label: '呂建國', code: '0720',
    why: '保全組長的置物櫃，密碼改成女兒發表會那天；裡面是沒寄出的信。' },
  { id: 'h.ix.piano', kind: 'piano', zone: 'f1_lobby', mount: 'floor', near: null,
    why: '大廳的公益鋼琴（有自動演奏）；呂建國的女兒在爸爸值大夜的晚上在這裡練〈少女的祈禱〉。' },

  // ================================================================== 支線:頂樓的物資箱(應變中心)
  { id: 'h.ix.radio.security', kind: 'radio', zone: 'f1_security', mount: 'surface', near: null, broadcasts: ['ra.drop', 'ra.emerg', 'ra.1206', 'ra.recovery', 'ra.hum'], label: '多頻收音機',
    why: '保全室值班用的多頻收音機，收得到應變中心、正規電台與回收班的頻道。' },
  { id: 'h.ix.tv.store', kind: 'tv', zone: 'f1_store', mount: 'wall', near: null, cards: ['tv.emerg', 'tv.nohosp', 'tv.drop', 'tv.night', 'tv.ad', 'tv.live'],
    why: '金水商行補給站的電視，輪播市府跑馬燈；G-EV10 時被夜班切成作業直播。' },
  { id: 'h.ix.crate', kind: 'locker', zone: 'f3_roof', mount: 'floor', near: null, loot: { ammo: true }, label: '應變中心物資箱', code: '0817',
    why: '應變中心七月初五投在頂樓北側水塔下的物資箱；密碼只在廣播念過，三樓被封住，一直沒有人上來拿。' },

  // ================================================================== 支線:急救車(陳怡君)
  { id: 'h.ix.ernote', kind: 'note', zone: 'f1_er', mount: 'surface', near: null, note: 'h.s25', style: 'clipboard',
    why: '急診護理師陳怡君七月初四凌晨留給同事的交班；「牠們聽得到」也是她寫的。' },
  { id: 'h.ix.ercart', kind: 'medcab', zone: 'f1_er', mount: 'auto', near: null, loot: 'random', label: '急救車', code: '0816',
    why: '陳怡君怕推車的輪子聲引來宿主，把急救車鎖住，密碼是她寫下交班那天的日期。' },

  // ================================================================== 支線:安修女的錄音帶與聖詩
  { id: 'h.ix.tapebox', kind: 'note', zone: 'f1_chapel', mount: 'surface', near: null, note: 'h.s21', style: 'paper',
    why: '安修女的錄音帶盒少了一捲：10/20 在錄音機裡，聖詩借給了廣播機房。' },
  { id: 'h.ix.radio.chapel', kind: 'radio', zone: 'f1_chapel', mount: 'surface', near: null, broadcasts: ['ra.1207a', 'ra.1207b', 'ra.1999'], label: 'AM 1207',
    why: '安修女的收音機，一直調在 AM 1207。' },
  { id: 'h.ix.candle', kind: 'candle', zone: 'f1_chapel', mount: 'surface', near: null,
    why: '禮拜堂的蠟燭；點一根記入怪談錄，沒有數值好處（§13）。' },
  { id: 'h.ix.pa', kind: 'pa', zone: 'f1_corridor', mount: 'wall', near: 'f1_chapel', lines: ['pa.echo', 'pa.override', 'pa.thanks', 'pa.ho1999'],
    why: '禮拜堂旁廣播機房的麥克風；萬嵐的主機會用集合廣播蓋過任何人的聲音。R8 停電時要守住這裡 40 秒。' },
  { id: 'h.ix.hymn', kind: 'cassette', zone: 'f1_corridor', mount: 'surface', near: 'f1_chapel', tape: 'h.s22',
    why: '廣播機房的錄音座，放著安修女錄的聖詩備用帶（h.hymn.full）。' },
  { id: 'h.ix.fountain', kind: 'fountain', zone: 'f1_courtyard', mount: 'floor', near: null, coins: 7, note: 'h.s19',
    why: '乾涸噴水池的聖母像；丟滿七枚點數，底座縫裡安修女的禱告字條才會露出來（只記入怪談錄）。' },

  // ================================================================== 支線:阿哲 #0277
  { id: 'h.ix.carradio', kind: 'carradio', zone: 'f1_parking', mount: 'auto', near: null, broadcasts: ['ra.1207a', 'ra.1207b'], label: 'AM 1207',
    why: '阿哲第一次接單時把車停在這裡，收音機一直開著，調在 AM 1207。' },

  // ================================================================== 電話、廣播、電視、打字機
  { id: 'h.ix.payphone', kind: 'phone', zone: 'f1_lobby', mount: 'wall', near: null, style: 'pay', ext: null, calls: ['ph.p01', 'ph.p02', 'ph.p03', 'ph.p04'], ring: 'tension', special: null,
    why: '大廳的公共電話；市話早就斷了，只有大廳的人（鬼）的聲音進得來。' },
  { id: 'h.ix.phone.store', kind: 'phone', zone: 'f1_store', mount: 'surface', near: null, style: 'desk', ext: '夜班特約', calls: ['ph.shop01'], ring: 'flag:h.shop.open', special: null,
    why: '補給站櫃台的電話是夜班特約專線，金水伯每局第一次開店會打來。' },
  { id: 'h.ix.phone.pharmacy', kind: 'phone', zone: 'f1_pharmacy', mount: 'surface', near: null, style: 'desk', ext: '1F 藥局', calls: ['ph.r01', 'ph.r02', 'ph.r05'], ring: 'tension', special: null,
    why: '藥局的內線電話；萬嵐的總機會自動撥進來放集合廣播。' },
  { id: 'h.ix.phone.icu', kind: 'phone', zone: 'f2_icu', mount: 'surface', near: null, style: 'desk', ext: '2F 加護病房', calls: ['ph.r06', 'ph.r07', 'ph.r04'], ring: 'tension', special: 'callback',
    why: '加護病房的內線；掛掉之後，鄭玉蘭會從護理站打回來（PHONE.callback）。' },
  { id: 'h.ix.phone.secretary', kind: 'phone', zone: 'f3_secretary', mount: 'surface', near: null, style: 'desk', ext: '院長室', calls: ['ph.ho01', 'ph.ho02'], ring: 'flag:ev.ho', special: null,
    why: '院長室秘書的電話；何啟明用萬嵐的網路打來（G-EV05；引擎也可以改由離玩家最近的電話響）。' },
  { id: 'h.ix.typewriter', kind: 'typewriter', zone: 'f3_secretary', mount: 'surface', near: null, lines: ['tw.v3', 'tw.loop', 'tw.burn', 'tw.001', 'tw.207', 'tw.recover'],
    why: '秘書室的電動打字機接在院內網路上當印表機；萬嵐的主機一直把排程送過來。' },

  // ================================================================== 電梯
  { id: 'h.ix.elev.b1', kind: 'elevator', zone: 'b1_tunnel', mount: 'wall', near: null, why: '病床電梯的 B1 呼叫鈕；旁邊就是小芳的鉛筆字。' },
  { id: 'h.ix.elev.f1', kind: 'elevator', zone: 'f1_corridor', mount: 'wall', near: null, why: '1F 電梯口；停用告示說「它會自己停在這一層」。' },
  { id: 'h.ix.elev.f2', kind: 'elevator', zone: 'f2_corridor', mount: 'wall', near: null, why: '2F 是消防返回樓層，電梯一跳電就回到這裡。' },
  { id: 'h.ix.lift.morgue', kind: 'lift', zone: 'b1_morgue', mount: 'wall', near: 'door', contents: 'sheet', label: '遺體專用',
    why: '太平間的遺體專用貨梯；回收班用它把人送下來，車廂裡還有一張白布。' },

  // ================================================================== 彩蛋與小互動
  { id: 'h.ix.vending', kind: 'vending', zone: 'f1_waiting', mount: 'floor', near: 'corner', price: 5, heal: 5, perRound: 3,
    special: { chance: 0.033, note: 'h.s15', name: '冬瓜茶', label: '207 特調' },
    why: '候診區的販賣機，金水伯以夜班特約商家的身分補貨，偷偷塞了「207 特調」。' },
  { id: 'h.ix.musicbox', kind: 'musicbox', zone: 'f2_nursery', mount: 'surface', near: null, note: 'h.s16',
    why: '金水伯 2001 年送給新生兒室的音樂盒，播走音的霧港夜話片頭曲（H-EV3）。' },
  { id: 'h.ix.mobile', kind: 'mobile', zone: 'f2_nursery', mount: 'surface', near: null,
    why: '嬰兒床的吊飾；新生兒室的通風還接在發電機上，吊飾被風吹動。這裡的孩子都平安離開了。' },
  { id: 'h.ix.drawing', kind: 'note', zone: 'f2_playroom', mount: 'wall', near: null, note: 'h.s17', style: 'drawing',
    why: '小兒科孩子畫的「收音機阿姨講故事」；畫裡山上的紅點，在頂樓看得到。' },
  { id: 'h.ix.polaroid', kind: 'note', zone: 'f3_roof', mount: 'wall', near: null, note: 'h.s18', style: 'polaroid',
    why: '夾在頂樓水塔爬梯上的拍立得；水塔上還綁著秀鈴的自製天線。' },
  { id: 'h.ix.snack', kind: 'snack', zone: 'f3_monitor', mount: 'surface', near: null,
    why: '監控室電腦旁的綠色「聽話」零食，機房的老習慣；拿走它，監視器雜訊 10 秒。' },
  { id: 'h.ix.hearse', kind: 'note', zone: 'f1_alley', mount: 'auto', near: null, note: 'h.s20', style: 'paper',
    why: '北側後勤巷的靈車，後車廂的空棺木上貼著回收單。' },

];

export default {
  id: 'hospital',
  items,

  // 本包讀寫的旗標(單局,game.story.flag;依 STORY.md 附錄 A,新增的標註「新」)
  flags: {
    'h.gen.on': 'B1 配電盤三顆保險絲都裝上（fusebox onFull）。啟動很吵，可提早叫來一波（§4.2）。',
    'h.pwr.207': '迴路：207 病房的燈。開局就亮（延長線從北側後勤巷發電機直接供電）；加急單容量只有 2 時，要開監控室就得先關掉它，或先完成運油支線。',
    'h.pwr.monitor': '迴路：3F 監控室。鍵盤 1024 需要它（keypad.power）。',
    'h.pwr.b1': '迴路：B1 照明與電梯。',
    'h.207.unlock': '監控室鍵盤輸入 1024。207 的電子鎖解除，門被撞開，R10 立刻開始（§5.2 第四幕）。',
    'h.visit.signed': '新。在 2F 探病登記簿簽名：送走鄭玉蘭（寫入 meta.ghost.zheng、meta.signed.h207；耳語 #12）。',
    'h.light': '附錄 A：207 的燈的狀態（運油支線；R6 開始閃，R8 前沒加油就熄）。',
    'h.hymn.full': '附錄 A：R8 守住廣播機房 40 秒，聖詩播完。',
    'h.ev.pipes': '附錄 A（H-EV1）：B1 管線敲擊；分機 B12 的電話因此響起，開啟救援支線。',
    'h.ev.lift': '附錄 A（H-EV2）：電梯自己下來，車廂裡是 h.s02。',
    'h.ev.musicbox': '附錄 A（H-EV3）：音樂盒自己上了發條。',
    'h.ev.voicemail': '附錄 A（H-EV5）：答錄機紅燈在閃。',
    'h.ev.cctv': '附錄 A（H-EV7）：監控畫面裡 207 的燈下坐著一個人。',
    'h.shop.open': '新。補給站本局第一次開店；金水伯的電話響。',
    'ev.ho': '新。G-EV05 何董來電的觸發旗標；接聽結果寫入 ev.ho.answered 或 ev.ho.hungup（§4.6）。',
    'know.code1024': '跨局知識旗標（meta.know）：學過 1024 之後，保險箱與鍵盤每局都能直接開。',
  },

  items_doc: {
    items: {
      fuse: '保險絲 ×3：B1 洗衣房（烘衣機後）、鍋爐房備品櫃、太平間 5 號冰櫃。裝進 B1 配電盤。',
      oil: '柴油桶：鍋爐房。扛到北側後勤巷的發電機（按住 E 4 秒，由劇情處理），維持 207 的燈（h.light）。',
      'card.security': '保全識別證：R5 名牌巨屍「萬嵐保全組長 呂建國」掉落，刷開 3F 監控室。',
    },
    codes: {
      '1024': '207 的入院日 1999/10/24：院長室保險箱、監控室 207 門禁。來源：H06、登記簿第一行、HIS 輸入 207 或 1024、鄭玉蘭的耳語「是她來的那一天」。',
      '2330': '鄭玉蘭的置物櫃：大夜交班時間。來源：2F 白板最後一行、小芳的實習筆記。',
      '1968': '王進財的洗衣房 14 號櫃：他到職那一年。來源：2F 白板（205）、HIS 輸入 205。',
      '0720': '呂建國的置物櫃：女兒的鋼琴發表會。來源：保全室的傳單、R5 名牌背面、HIS 輸入 0720。',
      '0817': '頂樓物資箱：應變中心的投放密碼。來源：保全室多頻收音機（ra.drop）；電視跑馬燈只給地點。',
      '0816': '急診急救車：陳怡君寫下交班那天的日期。來源：急診檢傷台的夾板。',
    },
    chains: {
      objective_code: 'H06（1F 印表機）+ 登記簿第一行 + HIS「207」→ 監控室鍵盤 1024 → h.207.unlock → 207',
      objective_power: '「↓ 冷」（B1 電梯鈕）+ 回收單背面（電梯）+ 冰櫃登記白板 → 太平間 3、1、5 → 保險絲；洗衣房、鍋爐房各一顆 → 配電盤 → h.gen.on',
      rescue_xiaofang: '分機 B12 來電 + 水管粉筆記號 + B1 樓梯口紙條 → 敲水管三短三長三短 → B1 營養部倉庫（救援由劇情處理）',
      zheng: '2F 白板「大夜 23:30」+ 小芳的實習筆記 → 鄭玉蘭的置物櫃 2330 → 最後一頁交班（指向運油支線）→ 登記簿簽名送走她',
      wang: '2F 白板「205 → 洗衣房 14 號櫃，一九六八」+ HIS「205」→ 王進財的置物櫃 1968 → 秀琴的便當紙條',
      lu: '保全室的發表會傳單 + R5 名牌背面 + HIS「0720」→ 呂建國的置物櫃 0720 → 沒寄出的信；大廳鋼琴彈〈少女的祈禱〉',
      drop: '保全室多頻收音機念出 0817 + 電視跑馬燈「頂樓北側水塔下」→ 頂樓物資箱 → 彈藥',
      chen: '急診夾板「密碼是今天的日期 8/16」→ 急救車 0816 → 隨機物資',
      anna: '禮拜堂錄音帶盒的目錄卡 → H04（禮拜堂錄音機）與聖詩備用帶（廣播機房）→ R8 守住廣播機房（h.hymn.full）',
      zhe: 'HIS 便利貼「0277＝？」+ 大廳輪椅上的手機（H09）+ 停車場的車用收音機 AM 1207',
    },
    extensions: {
      'keypad.power': '本包新增：鍵盤需要這條迴路的旗標才有電（監控室在 h.pwr.monitor 之前是黑的）。引擎不支援時可以忽略。',
      'circuit.initial': '本包新增：開局就通電的迴路（207 的燈）。',
      'fusebox.capacity': 'capacity 寫 \'fuses\'；加急單以上請引擎改成 2（§5.2「加急條款」）。',
      'h.ix.slip': 'H-EV2 若由電梯事件放出回收單，請沿用 h.s02，不要另生一張。',
      H10: '207 號病歷正本由劇情在 R10 擊倒無名氏後放在 207 床墊底下（按住 E 2 秒），不在本包。',
    },
  },
};
