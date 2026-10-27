// 靈異文字表(全部遊戲內文字集中在這裡,方便劇情組一次校稿;邏輯檔不寫死字串)。
// 正典:《回神》劇情聖經 STORY.md(§1.9 鬼與屍、§1.10 聲音來源、§2.10 有名字的亡者、§5.8 鬼的耳語與電話、§5.9 牆上的字、§11 文字一致性守則)。
// 原則:超自然一律「留白」,不證實也不嘲笑;怪物的來源是病原與人。鬼的聲音可能是 18.9 Hz 呼喚造成的「有人在旁邊」,也可能不是(遊戲從不回答)。
// 鬼的硬規則(§1.9、§11.5):只在靜默期(回合之間)出現;不說謊;只知道自己死前的事;一句話以內;
// 字幕標籤先顯示「？？？」,玩家認出是誰之後(game.horror.reveal(ghost))才顯示名字。
// 沒有兒童死亡:孩子只以聲音、字跡出現,而且都活著離開了。不提真實災難;宗教場所與神職人員只寫成庇護與人情;不使用「疫苗/接種/封院」。
//
// LINES 欄位(耳邊低語、電話、收音機):
//   id      唯一 id(每局不重複使用)
//   canon   STORY.md 的編號(例:'5.8#1' = §5.8 耳語表第 1 句)
//   text    字幕原文(全形標點;「……」= 停頓/吸氣;{暱稱} 換成玩家暱稱)
//   ghost   有名字的亡者 id(見 GHOSTS;字幕認出後顯示名字,沒有 = 永遠「？？？」)
//   who     說話的是誰(劇中設定;玩家不一定知道)
//   why     為什麼這樣說(對應的劇情事實)
//   when    時間軸(這句話「屬於」哪個時間點;鬼只知道自己死前的事)
//   trig    觸發:zone(第一次進某區)| lowhp | dark(在暗處站著不動)| streak(連殺之後)| prop(靠近道具,配 prop)|
//           phone(接起電話)| radio(收音機自己開)| warn(宿主從看不到的方向接近,ear = 牠的方向)| guide(引導)| idle(探索時)|
//           cue(配合某個事件,配 cue)| medkit(用急救包時)| script(只由劇情/互動代理用 id 呼叫)
//   zone    區域 id 或主題(陣列;省略 = 任何地方)
//   prop    道具錨點種類(trig 'prop')
//   cue     事件種類(trig 'cue' / 'guide')
//   prog    [最早回合, 最晚回合](省略 = 不限)
//   phase   'rest' = 只在回合間休息時
//   ear     'left' | 'right' | 'behind' | 'both' | 'auto'(省略 = auto:依情境挑)
//   filter  'phone' | 'radio'(省略 = 無)
//   mode    'syllabic'(一字一音)| 'murmur'(聽不清的喃喃)
//   hint    這句話同時是提示:引導玩家去哪裡/怕什麼(shop、egg:*、quest:*、rule:*、warn)

// 有名字的亡者(STORY.md §2.10;本圖只有鄭玉蘭有名字)
export const GHOSTS = {
  zheng: { name: '鄭玉蘭', who: '聖心夜班護理長,七月十一心臟衰竭,死在 207 的陪病椅上' },
  lobby: { name: null, who: '大廳的人:七月初三被集合廣播叫下來、再也沒有離開的人' },
  caller: { name: null, who: '叫名字的人(永遠的未解)' },
};

export const LINES = [
  // ---------- 正典 §5.8:鬼的耳語 ----------
  { id: 'h.w01', canon: '5.8#1', text: '幾床？', ghost: 'zheng', who: '鄭玉蘭', why: '她還在巡房:問你是哪一床的家屬', when: '七月十一之後', trig: 'zone', zone: ['f2_corridor'], ear: 'left' },
  { id: 'h.w02', canon: '5.8#2', text: '燈不要關。', ghost: 'zheng', who: '鄭玉蘭', why: '207 的燈接在發電機上,是安修女託付她的', when: '七月初三之後', trig: 'zone', zone: ['f2_ward_207'], ear: 'right', hint: 'quest:207light' },
  { id: 'h.w03', canon: '5.8#3', text: '星期日了。……他怎麼還沒來。', ghost: 'zheng', who: '鄭玉蘭', why: '二十五年來每個星期日金水伯都來看 207;封鎖之後他來不了(翻探病登記簿時,由互動代理呼叫)', when: '七月十一之前', trig: 'script', ear: 'right' },
  { id: 'h.w04', canon: '5.8#4', text: '正本從來不離開那一床。', ghost: 'zheng', who: '鄭玉蘭', why: '207 號病歷正本一直在 207 的床墊底下(調查幕,由劇情代理呼叫)', when: '2025/02/27 之後', trig: 'script', ear: 'left', hint: 'quest:chart' },
  { id: 'h.w05', canon: '5.8#5', text: '是她來的那一天。', ghost: 'zheng', who: '鄭玉蘭', why: '院長室保險箱的密碼是 1024:秀鈴入院那一天', when: '1999/10/24', trig: 'zone', zone: ['f3_monitor'], ear: 'right', hint: 'egg:safe' },
  { id: 'h.w06', canon: '5.8#6', text: '小芳……不要出來。燈還沒熄。', ghost: 'zheng', who: '鄭玉蘭', why: '實習護理師林小芳躲在地下室;她死前知道小芳還在那裡', when: '七月初六~十一', trig: 'zone', zone: ['b1_stair_w', 'b1_stair_e'], ear: 'left' },
  { id: 'h.w07', canon: '5.8#7', text: '那個藥……不要一直打。', ghost: 'zheng', who: '鄭玉蘭', why: '她懷疑「回神居家急救包」就是回神', when: '七月', trig: 'medkit', ear: 'right' },
  { id: 'h.w08', canon: '5.8#8', text: '車來了嗎？', ghost: 'lobby', who: '大廳的人', why: '緊急疏散公告說「由萬嵐生醫專車統一後送」,專車從來沒有來', when: '七月初三', trig: 'zone', zone: ['f1_lobby'], ear: 'left' },
  { id: 'h.w09', canon: '5.8#9', text: '廣播說會有車……', ghost: 'lobby', who: '大廳的人', why: '集合廣播的內容;正門在誘集之後被焊死', when: '七月初三', trig: 'zone', zone: ['f1_lobby'], prog: [3], ear: 'right', hint: 'rule:pa' },
  { id: 'h.w10', canon: '5.8#10', text: '我女兒還在三樓。', ghost: 'lobby', who: '大廳的人', why: '三樓是萬嵐的臨床試驗病房,家屬被擋在大廳(噴水池)', when: '七月初三', trig: 'prop', prop: ['statue_mary'], ear: 'left' },
  { id: 'h.w11', canon: '5.8#11', text: '{暱稱}……', ghost: 'caller', who: '叫名字的人', why: '永遠的未解:霧裡叫名字的是誰(頂樓水塔)', when: '不明', trig: 'zone', zone: ['f3_roof'], ear: 'right' },
  { id: 'h.w12', canon: '5.8#12', text: '有人來看她了。……好。', ghost: 'zheng', who: '鄭玉蘭(送走時)', why: '玩家在 2F 護理站的探病登記簿上簽名之後(由互動代理呼叫)', when: '現在', trig: 'script', ear: 'both' },

  // ---------- 第一次進入某區(補充;說話的都是正典裡的人或沒有名字的亡者) ----------
  { id: 'z.lobby.1', text: '……大家都在這裡集合。你也是來集合的嗎？', ghost: 'lobby', who: '大廳的人', why: '七月初三院內廣播叫所有人到大廳集合;地上只剩包包與拖鞋', when: '七月初三', trig: 'zone', zone: ['f1_lobby'], prog: [5] },
  { id: 'z.corr1', text: '那個廣播……不要過去。', ghost: 'lobby', who: '大廳的人', why: '1F 主走廊就是那晚大家走去大廳的路;鄭玉蘭隔天清晨在這裡寫了「不要相信廣播」', when: '七月初三', trig: 'zone', zone: ['f1_corridor'], hint: 'rule:pa' },
  { id: 'z.waiting', text: '叫號了嗎……我等好久了。', ghost: 'lobby', who: '候診區的人(亡者)', why: '叫號機停在七月初三的號碼', when: '七月初三', trig: 'zone', zone: ['f1_waiting'] },
  { id: 'z.er', text: '先看我……我排第幾號？', who: '急診的人(亡者)', why: '急診的檢傷卡散落一地;正門焊死後家屬逃進急診', when: '七月初三', trig: 'zone', zone: ['f1_er'] },
  { id: 'z.chapel', text: '……幫我點一根蠟燭，好不好？', who: '禮拜堂的人(亡者)', why: '安修女的習慣:有人在等,就點一根蠟燭;結局會記得你點了幾根', when: '現在', trig: 'zone', zone: ['f1_chapel'], hint: 'egg:candle' },
  { id: 'z.207.2', text: '床是空的。……我一直坐在這裡。', ghost: 'zheng', who: '鄭玉蘭', why: '監控畫面裡,207 的床空著的時候燈下還坐著一個人:她死在 207 的陪病椅上', when: '七月十一', trig: 'zone', zone: ['f2_ward_207'], prog: [4] },
  { id: 'z.nursery', text: '一、二、三……數到十，就不怕了。', who: '小兒科護理師的聲音(留白:她哄孩子躲著不要出聲;孩子們都活著離開了)', why: '新生兒室牆上「數到十就好了」;句子來自小鈴的節目', when: '七月初三夜', trig: 'zone', zone: ['f2_nursery'] },
  { id: 'z.nursery.box', text: '音樂盒……要上發條才會唱。', who: '小兒科護理師的聲音(留白)', why: '新生兒室的音樂盒,盒底刻著「2001 金水 贈」', when: '七月初三之前', trig: 'zone', zone: ['f2_nursery'], prog: [3], hint: 'egg:musicbox' },
  { id: 'z.playroom', text: '收音機阿姨……今天還會來講故事嗎？', who: '孩子的聲音(留白:遊戲室的孩子都被安修女帶到廟口,活著)', why: '001 醒來後偷偷下樓講故事;遊戲室有那張蠟筆畫', when: '2025 年春天', trig: 'zone', zone: ['f2_playroom', 'f2_peds'] },
  { id: 'z.icu', text: '機器一直叫……都沒有人過來。', who: '加護病房的病人(亡者)', why: '加護病房被改成回神的第二病房;機器的聲音會把宿主叫來', when: '七月初二', trig: 'zone', zone: ['f2_icu'], hint: 'rule:sound' },
  { id: 'z.morgue.1', text: '抽屜好冷。……你的是幾號？', who: '回收後沒有醒來的接單員(亡者)', why: '回收清冊上有你的編號「預約中」', when: '七月下旬', trig: 'zone', zone: ['b1_morgue'] },
  { id: 'z.morgue.2', text: '我在裡面敲了好久……都沒有人開。', who: '回收後沒有醒來的接單員(亡者)', why: '抽屜會從裡面被敲;一位母親在這裡寫了「他還在裡面」', when: '七月十八之前', trig: 'zone', zone: ['b1_morgue'], prog: [3] },
  { id: 'z.archive', text: '病歷被拿走了……二〇七那一本。', ghost: 'zheng', who: '鄭玉蘭', why: '2025/02/27 床位異動:207 的病歷被抽走,對外維持「207 在院」', when: '2025/02/27', trig: 'zone', zone: ['b1_archive'], prog: [2] },
  { id: 'z.tunnel', text: '這條路通去叨位？……阮欲轉去。', who: '一位沒有被叫到名字的長輩(亡者)', why: '想回家(台語:這條路通到哪裡?我要回去)', when: '七月', trig: 'zone', zone: ['b1_tunnel'] },
  { id: 'z.boiler', text: '發電機要油……燈才不會熄。', ghost: 'zheng', who: '鄭玉蘭', why: '工務室停電通知:207 的燈和監控室搶同一台發電機,油桶在鍋爐房', when: '七月初二起', trig: 'zone', zone: ['b1_boiler'], hint: 'quest:207light' },
  { id: 'z.3f', text: '三樓……你還是上來了。', who: '三樓的病人(亡者)', why: '2F 東樓梯牆上寫著「三樓不要上去」(保全組長呂建國)', when: '七月初二之後', trig: 'zone', zone: ['f3_corridor'] },
  { id: 'z.cell', text: '隔壁的姊姊……每天晚上都在數。', who: '試驗病房的病人(亡者)', why: '隔離房 1 的牆上刻著日子:001 用刻痕數日子', when: '2025/02~03', trig: 'zone', zone: ['psych_cell'] },
  { id: 'z.cell.song', text: '她一唱歌……大家就安靜了。', who: '試驗病房的病人(亡者)', why: '熟悉的人聲會讓宿主暫時安靜', when: '2025 年春天', trig: 'zone', zone: ['psych_cell'], prog: [4], hint: 'rule:voice' },
  { id: 'z.dorm', text: '修女說，燈要一直開著。', ghost: 'zheng', who: '鄭玉蘭', why: '安修女在答錄機裡說:「207 的燈,拜託妳。不要讓它熄。」', when: '七月初三', trig: 'zone', zone: ['f3_dorm'] },
  { id: 'z.cemetery', text: '七月了……門開了，我們回來看看。', who: '舊墓園的人(亡者)', why: '農曆七月鬼門開(民俗)', when: '七月', trig: 'zone', zone: ['f1_cemetery'] },
  { id: 'z.laundry', text: '床單洗好了……要拿去哪一床？', who: '洗衣房的人(亡者)', why: '洗衣房的排班表停在七月初三', when: '七月初三', trig: 'zone', zone: ['b1_laundry'] },

  // ---------- 低血量(只在靜默期) ----------
  { id: 'hp.1', text: '快了……你也快回來了。', who: '不明(亡者)', why: '每一次回收都是一次回神劑量;你也在改變', when: '現在', trig: 'lowhp' },
  { id: 'hp.2', text: '怕的時候，數到十。', who: '不明(亡者;這句話護理站每個人都會背)', why: '「霧港夜話」的結尾語;207 放了二十五年的錄音帶', when: '現在', trig: 'lowhp', hint: 'rule:voice' },
  { id: 'hp.3', text: '躺下來……這裡很安靜。', ghost: 'lobby', who: '大廳的人', why: '倒下的人都躺在大廳', when: '七月初三', trig: 'lowhp' },
  { id: 'hp.4', text: '回收班……會來接你。', who: '回收後沒有醒來的接單員(亡者)', why: '生命徵象中斷時,夜班回收班會把你撿回去', when: '現在', trig: 'lowhp', prog: [2] },
  { id: 'hp.shop', text: '店還開著……去拿藥。', who: '不明(亡者)', why: '休息時金水商行補給站開放', when: '現在', trig: 'lowhp', phase: 'rest', hint: 'shop' },

  // ---------- 暗處站著不動 ----------
  { id: 'dk.1', text: '你看不到我……我看得到你。', who: '不明(亡者)', why: '留白', when: '現在', trig: 'dark' },
  { id: 'dk.2', text: '別開燈……他們會醒。', who: '203 病人的女兒(亡者?留白)', why: '世界規則:強光讓剛轉化的人躁動;203 號房牆上的「別開燈」是她寫的', when: '七月初三', trig: 'dark', hint: 'rule:light' },
  { id: 'dk.3', text: '好暗……你也怕黑嗎？', ghost: 'zheng', who: '鄭玉蘭', why: '秀鈴怕黑,所以 207 的燈從不關', when: '現在', trig: 'dark' },
  { id: 'dk.4', text: '我就站在你後面。', who: '不明(亡者)', why: '留白', when: '現在', trig: 'dark', ear: 'behind' },
  { id: 'dk.5', text: '噓……牠們聽得到。', who: '不明(亡者)', why: '世界規則「牠們聽得到」', when: '現在', trig: 'dark', hint: 'rule:sound' },

  // ---------- 連殺之後(戰鬥結束後的靜默) ----------
  { id: 'st.1', text: '他們以前……也是病人。', ghost: 'zheng', who: '鄭玉蘭', why: '感染者穿著生前的病人服、拖鞋', when: '現在', trig: 'streak' },
  { id: 'st.2', text: '那是三號床的阿伯……他只是想回家。', ghost: 'zheng', who: '鄭玉蘭', why: '宿主會走回生前熟悉的地方', when: '七月十一之前', trig: 'streak' },
  { id: 'st.3', text: '謝謝你……讓他們休息。', who: '不明(亡者)', why: '主題「放手」', when: '現在', trig: 'streak', prog: [3] },
  { id: 'st.5', text: '輕一點……他們會痛。', ghost: 'zheng', who: '鄭玉蘭', why: '留白', when: '現在', trig: 'streak' },

  // ---------- 靠近道具 ----------
  { id: 'pr.sheet', text: '白布底下……不是她。', ghost: 'zheng', who: '鄭玉蘭', why: '2025/02/27 無名氏移入 207;她用白布蓋住他,因為他的皮膚在暗處會發光', when: '2025/02/27', trig: 'prop', prop: 'body_sheet' },
  { id: 'pr.doll', text: '娃娃要留著……那個孩子會回來拿。', ghost: 'zheng', who: '鄭玉蘭', why: '小兒科的孩子被安修女帶走了(活著);娃娃留在這裡', when: '七月初三', trig: 'prop', prop: 'doll' },
  { id: 'pr.incub', text: '……噓，寶寶在睡。', who: '值夜護理師的聲音(留白)', why: '新生兒室的保溫箱還開著', when: '七月初三之前', trig: 'prop', prop: 'incubator' },
  { id: 'pr.cell', text: '讓我出去……我不吵了。', who: '試驗病房的病人(亡者)', why: '試驗病房的門是從外面鎖的', when: '2025 年', trig: 'prop', prop: 'cell_door' },
  { id: 'pr.drawer', text: '點名了……下一個是你嗎？', who: '回收後沒有醒來的接單員(亡者)', why: '〈點名〉:抽屜一個一個晃動', when: '七月下旬', trig: 'prop', prop: 'morgue_drawer' },
  { id: 'pr.mirror', text: '你後面……那是誰？', who: '不明(亡者)', why: '留白', when: '現在', trig: 'prop', prop: 'mirror', ear: 'behind' },
  { id: 'pr.candles', text: '有人經過……燭火才會熄。', who: '禮拜堂的人(亡者)', why: '燭火熄滅的事件', when: '現在', trig: 'prop', prop: 'candles' },
  { id: 'pr.gen', text: '別讓它停……燈會熄。', ghost: 'zheng', who: '鄭玉蘭', why: '207 的燈接在這台發電機上;R6 之後油會用完', when: '七月初二起', trig: 'prop', prop: 'generator', hint: 'quest:207light' },
  { id: 'pr.curtain', text: '這是我的床。', who: '隔簾後的病人(亡者)', why: '每一床的隔簾都拉著,像還有人住', when: '七月初三之前', trig: 'prop', prop: 'bed_curtain' },
  { id: 'pr.veil', text: '修女說……要等到天亮。', ghost: 'lobby', who: '大廳的人', why: '安修女把聖像蓋起來:「這座城市現在就是苦難週」', when: '七月', trig: 'prop', prop: ['statue_veiled'] },
  { id: 'pr.coffin', text: '我不在裡面。', who: '不明(亡者)', why: '靈車後車廂的棺木是空的,貼著夜班回收單「回收第 1 次」', when: '現在', trig: 'prop', prop: 'coffin' },
  { id: 'pr.tv', text: '……請留在室內……鎖好門窗……不要前往醫院……', who: '霧港市災害應變中心的緊急廣播(真,但沒用)', why: '商店電視的跑馬燈也在播同一則', when: '七月初一起', trig: 'prop', prop: ['tv', 'cctv'], filter: 'radio', mode: 'murmur' },

  // ---------- 接起電話(互動代理呼叫 game.horror.phone;同一區內的內線還通,§11.5) ----------
  { id: 'ph.1', text: '……二〇七號房家屬，請至護理站。二〇七號房家屬……', who: '院內呼叫的舊錄音', why: 'R2 護理站的舊電話會自己響,放的是 207 家屬的呼叫錄音', when: '2025 年之前', trig: 'phone', filter: 'phone' },
  { id: 'ph.2', text: '喂？……是你嗎？你怎麼還不回家？', who: '不明(內線;亡者)', why: '你是來找家人的;這通內線像是反過來在找你', when: '現在', trig: 'phone', filter: 'phone' },
  { id: 'ph.3', text: '……我在你後面那間房間，打給你。', who: '不明(內線;亡者)', why: '同一區內的內線還通', when: '現在', trig: 'phone', filter: 'phone' },
  { id: 'ph.4', text: '這裡是總機……您撥的分機，已經沒有人了。', who: '總機的自動語音', why: '總機的自動語音還在運作', when: '2026 年', trig: 'phone', filter: 'phone' },
  { id: 'ph.5', text: '……（呼吸聲）……數到十，再掛電話。', who: '不明(內線;亡者)', why: '「霧港夜話」的結尾語', when: '現在', trig: 'phone', filter: 'phone', hint: 'rule:voice' },
  { id: 'ph.6', text: '這裡是護理站……二〇七今天有人來看嗎？', ghost: 'zheng', who: '鄭玉蘭(內線)', why: '她的心願:封鎖之後金水伯來不了,她怕那一床沒有人看(送走她:在探病登記簿上簽名)', when: '七月十一之後', trig: 'phone', filter: 'phone', hint: 'quest:zheng' },

  // ---------- 收音機自己打開 ----------
  { id: 'rd.1', text: '……AM 一二〇七……還醒著的夜貓子……收到請回答……', who: '霧港夜話的舊錄音(1999)', why: 'AM 1207 的呼號;舊錄音是真的,但過時', when: '1999 年', trig: 'radio', filter: 'radio' },
  { id: 'rd.2', text: '……霧港市災害應變中心……請留在室內……鎖好門窗……', who: '市府緊急廣播(真,但沒用)', why: '市府知道醫院危險,卻把夜間清除外包給夜班', when: '七月初一起', trig: 'radio', filter: 'radio' },
  { id: 'rd.3', text: '……（女聲哼著聖詩的旋律，沒有歌詞）……', who: '安修女錄的聖詩(舊錄音)', why: '她把聖詩錄成院內廣播的備用帶', when: '2026 年七月之前', trig: 'radio', filter: 'radio', mode: 'murmur' },
  { id: 'rd.4', text: '……昨天叩應的醫生朋友說……山上有人被牽走……', who: '霧港夜話 1999/10/20 的舊錄音', why: '何啟明 10/19 的叩應讓小鈴上山做現場直播', when: '1999/10/20', trig: 'radio', filter: 'radio', prog: [4] },

  // ---------- 警告(靜默期裡的伏擊者:耳朵 = 牠的方向) ----------
  { id: 'wn.back', text: '……後面。', who: '不明(亡者)', why: '提示:靜默期裡宿主不是零,有東西從背後來', when: '現在', trig: 'warn', ear: 'behind', hint: 'warn' },
  { id: 'wn.left', text: '左邊……有人。', who: '不明(亡者)', why: '提示:有東西從左邊來', when: '現在', trig: 'warn', ear: 'left', hint: 'warn' },
  { id: 'wn.right', text: '右邊……牠在等。', who: '不明(亡者)', why: '提示:有東西從右邊來', when: '現在', trig: 'warn', ear: 'right', hint: 'warn' },
  { id: 'wn.heard', text: '牠們聽到你了。', who: '不明(亡者)', why: '世界規則「牠們聽得到」', when: '現在', trig: 'warn', hint: 'warn' },

  // ---------- 引導(提示;鬼不說謊,所以是最可靠的引導) ----------
  { id: 'gd.shop', text: '……捲門拉起來了。往這邊。', who: '不明(亡者)', why: '休息時補給站開放;耳朵的方向 = 補給站的方向', when: '現在', trig: 'guide', cue: 'shop', phase: 'rest', hint: 'shop' },
  { id: 'gd.shop2', text: '金水的店……在這邊。', ghost: 'zheng', who: '鄭玉蘭', why: '金水伯二十五年來每個星期日都來看 207;她認得他', when: '現在', trig: 'guide', cue: 'shop', phase: 'rest', hint: 'shop', prog: [3] },
  { id: 'gd.fountain', text: '池子裡丟七次……修女留了話。', ghost: 'lobby', who: '大廳的人', why: '噴水池聖母像:丟滿七枚點數,底座出現安修女的禱告字條', when: '七月初三', trig: 'zone', zone: ['f1_lobby'], prog: [6], hint: 'egg:fountain' },
  { id: 'gd.his', text: '病歷終端……試試看入院那一天。', ghost: 'zheng', who: '鄭玉蘭', why: 'HIS 終端可以輸入號碼;1024 是 207 的入院日期', when: '現在', trig: 'idle', prog: [6], hint: 'egg:his' },
  { id: 'gd.radio', text: '停車場……有一台車的收音機還開著。', who: '不明(亡者)', why: '停車場一台車的收音機調在 AM 1207(車主是阿哲)', when: '現在', trig: 'idle', prog: [4], hint: 'egg:carradio' },
  { id: 'gd.fuse', text: '冷的那邊……保險絲。', who: '不明(亡者)', why: '電梯按鈕旁的鉛筆箭頭「↓ 冷」指向太平間的保險絲(小芳留的)', when: '七月初六', trig: 'idle', prog: [3], hint: 'egg:fuse' },

  // ---------- 探索時 / 配合事件 ----------
  { id: 'id.1', text: '……你聽到了嗎？有人在叫你的名字。', who: '不明(亡者)', why: '18.9 Hz 的呼喚會讓人覺得有人在叫自己(遊戲從不證實)', when: '現在', trig: 'idle' },
  { id: 'id.2', text: '他們說，救援馬上就到。', ghost: 'lobby', who: '大廳的人', why: '集合廣播的內容', when: '七月初三', trig: 'idle' },
  { id: 'id.3', text: '這裡……不再收治活人了。', who: '不明(亡者)', why: '主選單題詞;緊急疏散公告「本院即日起全面停止收治」', when: '七月初三起', trig: 'idle', prog: [5] },
  { id: 'id.4', text: '頭七那天……我有回來。', who: '不明(亡者)', why: '頭七回魂(民俗)', when: '現在', trig: 'idle', prog: [3] },
  { id: 'cu.figure', text: '走廊盡頭……有人在等你。', who: '不明(亡者)', why: '配合走廊盡頭的人影', when: '現在', trig: 'cue', cue: 'figure' },
  { id: 'cu.behind', text: '不要回頭。', who: '不明(亡者)', why: '配合身後的人影', when: '現在', trig: 'cue', cue: 'behind', ear: 'behind' },
  { id: 'cu.steps', text: '你踩到我了。', who: '不明(亡者)', why: '配合濕腳印', when: '現在', trig: 'cue', cue: 'footprints' },
  { id: 'cu.nurse', text: '推車要推回護理站……', ghost: 'zheng', who: '鄭玉蘭', why: '她出現時有推車輪子聲、病歷板的夾子聲(§2.10)', when: '七月十一之後', trig: 'cue', cue: 'nurse' },
  { id: 'cu.child', text: '來玩嘛……', who: '孩子的聲音(留白:孩子們都活著離開了)', why: '配合門口一閃而過的小影子', when: '七月初三之前', trig: 'cue', cue: 'child' },
  { id: 'cu.lift', text: '電梯……又停在這一層了。', who: '不明(亡者)', why: '工務室告示:消防返回樓層設在 2 樓,電壓一不穩電梯就自己回來', when: '現在', trig: 'cue', cue: 'elevator' },
  { id: 'cu.write', text: '寫給你的。', who: '不明(亡者)', why: '配合牆上新出現的字', when: '現在', trig: 'cue', cue: 'writing' },
  { id: 'cu.cold', text: '好冷……你也覺得冷嗎？', who: '回收後沒有醒來的接單員(亡者)', why: '配合寒氣(太平間的冷氣早就停了)', when: '現在', trig: 'cue', cue: 'coldBreath', ear: 'behind' },
  { id: 'cu.lights', text: '燈……一盞一盞，都熄了。', ghost: 'zheng', who: '鄭玉蘭', why: '配合燈一盞盞熄滅;她最怕 207 的燈熄', when: '現在', trig: 'cue', cue: 'lightsDie', ear: 'both' },
  { id: 'cu.silence', text: '……噓。', who: '不明(亡者)', why: '配合突然的寂靜', when: '現在', trig: 'cue', cue: 'silence', ear: 'both' },
  { id: 'cu.window', text: '外面……有人在看。', who: '不明(亡者)', why: '配合窗外的人影', when: '現在', trig: 'cue', cue: 'window' },
  { id: 'cu.hands', text: '讓我進去……', ghost: 'lobby', who: '大廳的人', why: '配合玻璃上的手印:正門焊死之後,外面的人進不來', when: '七月初三', trig: 'cue', cue: 'handprints' },
];

// 牆上字跡(STORY.md §5.9:每一句都有作者;新增的這些要登記進 §5.9 的字跡表)
// kind:static(場景佈置,一開始就在)| appear(事件:趁玩家背對時出現,作者是鬼)
// 欄位:id、text、zone(static 擺放區域)、style(marker 麥克筆 | paint 噴漆 | chalk 粉筆 | crayon 蠟筆 | scratch 刻痕 | smear 暗紅手指塗抹)、
//       ghost、who(誰寫的)、why(為什麼)、when(什麼時候)、hint、size(字高 m)、h(離地高度 m)
export const WRITINGS = [
  { id: 'w.waiting', kind: 'static', text: '叫號機壞了\n不要再排了', zone: 'f1_waiting', style: 'marker', who: '實習護理師林小芳', why: '集合事件後,每天還有人(和宿主)走回候診區排隊;她躲進地下室之前寫的', when: '七月初五', size: 0.2, h: 1.55 },
  { id: 'w.morgue', kind: 'static', text: '抽屜有聲音\n不要開　7/04', zone: 'b1_morgue', style: 'marker', who: '夜班回收班作業員', why: '「地下室有人」就是他們的作業標記;被回收的人在抽屜裡「醒來」', when: '七月初四', size: 0.18, h: 1.5 },
  { id: 'w.phone', kind: 'static', text: '護理站電話不要接\n接了只有呼吸聲', zone: 'f2_corridor', style: 'marker', who: '鄭玉蘭護理長', why: '內線一直響;她不想讓留守的人一直跑去接(留白)', when: '七月初八', size: 0.17, h: 1.45, hint: 'egg:phone' },
  { id: 'w.chapel', kind: 'static', text: '蠟燭不要熄\n修女說的', zone: 'f1_chapel', style: 'crayon', who: '躲在禮拜堂的孩子(後來被安修女帶到廟口,活著)', why: '安修女教的:點一根蠟燭,代表有人在等', when: '七月初三夜', size: 0.16, h: 0.9, hint: 'egg:candle' },
  { id: 'w.tunnel', kind: 'static', text: '鍋爐房 →\n油桶在裡面', zone: 'b1_tunnel', style: 'paint', who: '工務室', why: '停電通知:市電被切,207 的燈和監控室搶同一台發電機;加油要從鍋爐房扛油桶', when: '七月初二', size: 0.24, h: 1.6, hint: 'quest:207light' },
  { id: 'w.psych', kind: 'static', text: '她唱歌的時候\n牠們都很安靜', zone: 'f3_corridor', style: 'scratch', who: '受試者 004', why: '熟悉的人聲讓宿主暫時安靜;001 會哼歌', when: '2025 年春天', size: 0.15, h: 1.3, hint: 'rule:voice' },
  { id: 'w.archive', kind: 'static', text: '207 病歷\n借閱:萬嵐專案　未還', zone: 'b1_archive', style: 'marker', who: '舊病歷庫管理員', why: '2025/02/27 的床位異動;正本其實一直在 207 的床墊底下', when: '2025/02/27', size: 0.16, h: 1.5 },
  { id: 'w.dorm', kind: 'static', text: '燈要開著\n等她醒來自己關', zone: 'f3_dorm', style: 'chalk', who: '安修女', why: '七月初三帶秀鈴離開前寫在宿舍白板上(2003 年的信裡也寫了同一句)', when: '七月初三 00:30', size: 0.16, h: 1.45 },
  { id: 'w.icu', kind: 'static', text: '機器的聲音會叫牠們來\n關掉！', zone: 'f2_icu', style: 'marker', who: '急診護理師陳怡君', why: '她發現聲音會把宿主引過來(「牠們聽得到」也是她寫的);之後下落不明', when: '七月初四', size: 0.16, h: 1.5, hint: 'rule:sound' },
  { id: 'w.playroom', kind: 'static', text: '收音機阿姨\n明天還來嗎', zone: 'f2_playroom', style: 'crayon', who: '小兒科的孩子(活著)', why: '001 醒來後偷偷下樓講故事', when: '2025 年春天', size: 0.14, h: 0.8 },
  { id: 'w.laundry', kind: 'static', text: '床單不夠了\n先用白布', zone: 'b1_laundry', style: 'marker', who: '洗衣房的阿姨', why: '病房的白布都拿去蓋人了', when: '七月初四', size: 0.16, h: 1.5 },
  // 事件:趁玩家背對時出現(作者是鬼;留白:監視器拍不到是誰寫的)
  { id: 'a.gather', kind: 'appear', text: '你也是來集合的嗎', style: 'smear', ghost: 'lobby', who: '大廳的人', why: '集合廣播那晚的人', when: '本局', size: 0.34 },
  { id: 'a.back', kind: 'appear', text: '別回頭', style: 'smear', ghost: 'zheng', who: '鄭玉蘭', why: '提示:背後有東西(鬼不說謊)', when: '本局', size: 0.42, hint: 'warn' },
  { id: 'a.queue', kind: 'appear', text: '我們還在排隊', style: 'smear', ghost: 'lobby', who: '大廳的人', why: '他們還在等專車', when: '本局', size: 0.34 },
  { id: 'a.home', kind: 'appear', text: '回家', style: 'smear', who: '一位沒有被叫到名字的長輩(亡者)', why: '想回家', when: '本局', size: 0.5 },
  { id: 'a.light', kind: 'appear', text: '燈還亮著嗎', style: 'smear', ghost: 'zheng', who: '鄭玉蘭', why: '她最怕 207 的燈熄', when: '本局', size: 0.34, hint: 'quest:207light' },
  { id: 'a.quiet', kind: 'appear', text: '小聲一點\n牠們聽得到', style: 'smear', ghost: 'zheng', who: '鄭玉蘭', why: '世界規則「牠們聽得到」', when: '本局', size: 0.3, hint: 'rule:sound' },
];

// 事件字幕(不是低語:例如數數的人;灰色、標記「？？？」)
export const CAPTIONS = {
  counter: { who: '？？？', count: ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'], tail: '……還沒好。', tailNear: '……快好了。', tailEnd: '……天亮了。' },
};

// 依 id 查
export const LINE_BY_ID = Object.fromEntries(LINES.map((l) => [l.id, l]));
