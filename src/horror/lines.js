// 靈異文字表(全部遊戲內文字集中在這裡,方便劇情組一次校稿;邏輯檔不寫死字串)。
// 正典:《回神》(plan/wave3/story_A.md → STORY.md)。原則:超自然一律「留白」,不證實也不嘲笑;
// 怪物的來源是病原與人,這些聲音可能是 18.9 Hz 呼喚造成的「有人在叫我」幻聽,也可能不是(遊戲從不回答)。
// 不提真實災難;宗教場所與神職人員只寫成庇護與人情;不使用「疫苗/接種/封院」等詞。
//
// LINES 欄位(耳邊低語、電話、收音機):
//   id      唯一 id(每局不重複使用)
//   text    字幕原文(全形標點;「……」= 停頓/吸氣)
//   who     說話的是誰(劇中設定;玩家不一定知道)
//   why     為什麼這樣說(對應的劇情事實)
//   when    時間軸(這句話「屬於」哪個時間點)
//   trig    觸發:zone(第一次進某區)| lowhp | dark(在暗處站著不動)| streak(連殺之後)| prop(靠近道具,配 prop)|
//           phone(接起電話)| radio(收音機自己開)| warn(殭屍從看不到的方向接近,ear = 牠的方向)| guide(引導)| idle(探索時)|
//           cue(配合某個事件,配 cue)
//   zone    區域 id 或主題(陣列;省略 = 任何地方)
//   prop    道具錨點種類(trig 'prop')
//   cue     事件種類(trig 'cue')
//   prog    [最早回合, 最晚回合](省略 = 不限)
//   phase   'rest' = 只在回合間休息時;'fight' = 只在戰鬥中
//   ear     'left' | 'right' | 'behind' | 'both' | 'auto'(省略 = auto:依情境挑)
//   filter  'phone' | 'radio'(省略 = 無)
//   mode    'syllabic'(一字一音)| 'murmur'(聽不清的喃喃)
//   hint    這句話同時是提示:引導玩家去哪裡/怕什麼(shop、supply、egg:*、quest:*、rule:*、warn)
export const LINES = [
  // ---------- 第一次進入某區 ----------
  { id: 'z.lobby.1', text: '……大家都在這裡集合。你也是來集合的嗎？', who: '集合的人', why: '七月初三院內廣播叫所有人到大廳集合,之後沒有人再離開大廳;地上只剩包包與拖鞋', when: '七月初三之後', trig: 'zone', zone: ['f1_lobby'] },
  { id: 'z.lobby.2', text: '我的拖鞋……有沒有人看到我的拖鞋？', who: '集合的人(一位長輩)', why: '大廳地上滿是拖鞋;長輩是被廣播叫下來的', when: '七月初三', trig: 'zone', zone: ['f1_lobby'], prog: [3] },
  { id: 'z.corr1', text: '廣播又在叫了……不要過去。', who: '一樓走廊的人影', why: '呼應走廊牆上的「不要相信廣播」:集合廣播是誘餌', when: '七月初三之後', trig: 'zone', zone: ['f1_corridor'], hint: 'rule:pa' },
  { id: 'z.waiting', text: '叫號了嗎……我等好久了。', who: '候診區的人影', why: '宿主保留生前習慣,會走回熟悉的地方排隊;叫號機早就停在同一個號碼', when: '七月上旬', trig: 'zone', zone: ['f1_waiting'] },
  { id: 'z.er', text: '先看我……我排第幾號？', who: '急診的人影', why: '急診的檢傷卡散落一地,檢傷分類在集合事件那晚失控', when: '七月初三', trig: 'zone', zone: ['f1_er'] },
  { id: 'z.chapel', text: '……幫我點一根蠟燭，好不好？', who: '禮拜堂的人影', why: '安修女的習慣:有人在等,就點一根蠟燭;結局會記得你點了幾根', when: '現在', trig: 'zone', zone: ['f1_chapel'], hint: 'egg:candle' },
  { id: 'z.207.1', text: '二〇七的燈……還亮著嗎？', who: '207 燈下坐著的人(留白)', why: '監視器畫面裡,207 的床空著的時候,燈下還坐著一個人', when: '2025 年之後', trig: 'zone', zone: ['f2_ward_207'], hint: 'quest:207light' },
  { id: 'z.207.2', text: '床是空的。……可是我一直坐在這裡。', who: '207 燈下坐著的人(留白)', why: '同上;2025/02 的掉包之後 207 對外仍「在院」', when: '2025/02 之後', trig: 'zone', zone: ['f2_ward_207'], prog: [4] },
  { id: 'z.nursery', text: '一、二、三……數到十，就不怕了。', who: '看不見的孩子', why: '新生兒室牆上「數到十就好了」:護理師哄孩子的句子,最早來自小鈴的節目', when: '現在', trig: 'zone', zone: ['f2_nursery'] },
  { id: 'z.nursery.box', text: '音樂盒……要上發條才會唱。', who: '看不見的孩子', why: '新生兒室的音樂盒(盒底刻著「2001 金水 贈」)', when: '現在', trig: 'zone', zone: ['f2_nursery'], prog: [3], hint: 'egg:musicbox' },
  { id: 'z.playroom', text: '收音機阿姨……今天還會來講故事嗎？', who: '看不見的孩子', why: '受試者 001 醒來後偷偷下樓講故事;遊戲室有一張「收音機阿姨講故事」的蠟筆畫', when: '2025 年春天', trig: 'zone', zone: ['f2_playroom', 'f2_peds'] },
  { id: 'z.icu', text: '機器一直叫……可是都沒有人過來。', who: '加護病房的人影', why: '加護病房的機器還在響;聲音會把牠們叫來,所以護理師關掉了它', when: '七月初一之後', trig: 'zone', zone: ['f2_icu'], hint: 'rule:sound' },
  { id: 'z.morgue.1', text: '抽屜好冷。……你的是幾號？', who: '太平間抽屜裡的人(被回收的接單員?)', why: '夜班回收班把「回收」的人放在這排抽屜;交接清冊上有你的編號,寫著「預約中」', when: '七月下旬', trig: 'zone', zone: ['b1_morgue'] },
  { id: 'z.morgue.2', text: '我在裡面敲了好久……都沒有人開。', who: '太平間抽屜裡的人', why: '一排抽屜被從裡面敲(R3 事件)', when: '七月下旬', trig: 'zone', zone: ['b1_morgue'], prog: [3] },
  { id: 'z.archive', text: '病歷被拿走了……二〇七那一本。', who: '舊病歷庫的人影', why: '2025/02/27 的床位異動:207 的病歷被抽走,對外維持「207 在院」', when: '2025/02', trig: 'zone', zone: ['b1_archive'], prog: [2] },
  { id: 'z.tunnel', text: '這條路通去叨位？……阮欲轉去。', who: '走失的長輩', why: '「回神長照再生計畫」的長輩在夜裡「走回家」(台語:這條路通到哪裡?我要回去)', when: '六月起', trig: 'zone', zone: ['b1_tunnel'] },
  { id: 'z.boiler', text: '發電機要油……燈才不會熄。', who: '工務的弟兄(聲音很舊)', why: '安修女請工務把 207 的燈接到發電機上;油桶在鍋爐房', when: '2003 年', trig: 'zone', zone: ['b1_boiler'], hint: 'quest:207light' },
  { id: 'z.3f', text: '三樓……你還是上來了。', who: '三樓的人影', why: '東樓梯牆上寫著「三樓不要上去」', when: '現在', trig: 'zone', zone: ['f3_corridor'] },
  { id: 'z.cell', text: '隔壁的姊姊……每天晚上都在數。', who: '隔離房的病人', why: '隔離房 1 的牆上刻著日子;受試者 001 用刻痕數日子', when: '2025/02~03', trig: 'zone', zone: ['psych_cell'] },
  { id: 'z.cell.song', text: '她一唱歌……大家就安靜了。', who: '隔離房的病人', why: '熟悉的人聲會讓宿主暫時安靜(世界規則「數到十」)', when: '2025 年春天', trig: 'zone', zone: ['psych_cell'], prog: [4], hint: 'rule:voice' },
  { id: 'z.dorm', text: '修女說，燈要一直開著。', who: '修女宿舍的人影', why: '安修女給秀鈴的信:「我會一直開著。等妳醒來,要自己關。」', when: '2003 年起', trig: 'zone', zone: ['f3_dorm'] },
  { id: 'z.director', text: '院長說……這樣是為了我們好。', who: '三樓的病人', why: '何醫師對安修女說過一樣的話,二十六年前也是', when: '2025 年', trig: 'zone', zone: ['f3_director'] },
  { id: 'z.monitor', text: '你看螢幕……燈下那個人，在看你。', who: '監控室的人影', why: '監視器回放:207 的床是空的,燈下坐著一個人', when: '現在', trig: 'zone', zone: ['f3_monitor'], hint: 'egg:cctv' },
  { id: 'z.cemetery', text: '七月了……門開了，我們回來看看。', who: '舊墓園的人影', why: '農曆七月鬼門開(民俗);墓園有一座掛著夜班背心的新墳', when: '七月', trig: 'zone', zone: ['f1_cemetery'] },
  { id: 'z.roof', text: '天空好吵……你也聽到了嗎？', who: '頂樓風聲裡的人', why: '受試者 001 醒來說的第二句話是「天空好吵」(18.9 Hz 的呼喚)', when: '2025/03/07', trig: 'zone', zone: ['f3_roof'] },
  { id: 'z.laundry', text: '床單洗好了……要拿去哪一床？', who: '洗衣房的人影', why: '洗衣房還晾著床單;排班表停在七月初三', when: '七月初三', trig: 'zone', zone: ['b1_laundry'] },

  // ---------- 低血量 ----------
  { id: 'hp.1', text: '快了……你也快回來了。', who: '不明', why: '每一次回收都是一次回神劑量;你也在改變', when: '現在', trig: 'lowhp' },
  { id: 'hp.2', text: '怕的時候，數到十。', who: '不明(語氣很像小鈴)', why: '「霧港夜話」的結尾語', when: '1999 年的節目', trig: 'lowhp', hint: 'rule:voice' },
  { id: 'hp.3', text: '躺下來……這裡很安靜。', who: '不明', why: '倒下的人都躺在大廳', when: '現在', trig: 'lowhp' },
  { id: 'hp.4', text: '回收班……要來接你了。', who: '不明', why: '生命徵象中斷時,夜班回收班會把你撿回去', when: '現在', trig: 'lowhp', prog: [2] },
  { id: 'hp.5', text: '醫療包……你知道裡面是什麼嗎？', who: '不明', why: '「回神居家急救包」:醫療包就是回神(後段反轉的伏筆)', when: '現在', trig: 'lowhp', prog: [5] },
  { id: 'hp.shop', text: '店還開著……去拿藥。', who: '不明', why: '休息時金水商行補給站開放', when: '現在', trig: 'lowhp', phase: 'rest', hint: 'shop' },

  // ---------- 暗處站著不動 ----------
  { id: 'dk.1', text: '你看不到我……我看得到你。', who: '不明', why: '留白', when: '現在', trig: 'dark' },
  { id: 'dk.2', text: '別開燈……牠們會醒。', who: '不明', why: '世界規則「別開燈」:強光讓菌絲躁動(203 號房牆上也這樣寫)', when: '現在', trig: 'dark', hint: 'rule:light' },
  { id: 'dk.3', text: '好暗……你也怕黑嗎？', who: '不明', why: '小鈴在節目裡說過她怕黑;207 的燈是為她開的', when: '現在', trig: 'dark' },
  { id: 'dk.4', text: '我就站在你後面。', who: '不明', why: '留白', when: '現在', trig: 'dark', ear: 'behind' },
  { id: 'dk.5', text: '噓……牠們聽得到。', who: '不明', why: '世界規則「牠們聽得到」:聲音會把感染者叫來', when: '現在', trig: 'dark', hint: 'rule:sound' },

  // ---------- 連殺之後 ----------
  { id: 'st.1', text: '他們以前……也是病人。', who: '不明', why: '感染者穿著生前的衣服:病人服、拖鞋', when: '現在', trig: 'streak' },
  { id: 'st.2', text: '那是三號床的阿伯……他只是想回家。', who: '不明', why: '宿主會走回生前熟悉的地方', when: '現在', trig: 'streak' },
  { id: 'st.3', text: '謝謝你……讓他們休息。', who: '不明', why: '主題「放手」:誰應該被送走', when: '現在', trig: 'streak', prog: [3] },
  { id: 'st.4', text: '一個、兩個、三個……你也在數嗎？', who: '不明', why: '數數的人在數你的回收次數', when: '現在', trig: 'streak', prog: [4] },
  { id: 'st.5', text: '輕一點……他們會痛。', who: '不明', why: '留白', when: '現在', trig: 'streak' },

  // ---------- 靠近道具 ----------
  { id: 'pr.sheet', text: '白布底下……不是我。', who: '207 燈下坐著的人(留白)', why: '無名氏在暗處會發光,護理師用白布把他蓋住', when: '1999 年起', trig: 'prop', prop: 'body_sheet' },
  { id: 'pr.doll', text: '那是我的娃娃……還給我。', who: '看不見的孩子', why: '小兒科的娃娃會轉頭看你', when: '現在', trig: 'prop', prop: 'doll' },
  { id: 'pr.incub', text: '……噓，寶寶在睡。', who: '值夜的護理師(聲音)', why: '新生兒室的保溫箱還開著', when: '七月初三之前', trig: 'prop', prop: 'incubator' },
  { id: 'pr.cell', text: '讓我出去……我不吵了。', who: '隔離房的病人', why: '試驗病房的門是從外面鎖的', when: '2025 年', trig: 'prop', prop: 'cell_door' },
  { id: 'pr.drawer', text: '點名了……下一個是你嗎？', who: '太平間抽屜裡的人', why: '〈點名〉:抽屜一個一個晃動,最後一格的吊牌寫著你的名字', when: '七月下旬', trig: 'prop', prop: 'morgue_drawer' },
  { id: 'pr.mirror', text: '你後面……那是誰？', who: '不明', why: '留白', when: '現在', trig: 'prop', prop: 'mirror', ear: 'behind' },
  { id: 'pr.candles', text: '有人經過……燭火才會熄。', who: '禮拜堂的人影', why: '燭火熄滅的事件', when: '現在', trig: 'prop', prop: 'candles' },
  { id: 'pr.gen', text: '別讓它停……燈會熄。', who: '工務的弟兄(聲音很舊)', why: '207 的燈接在這台發電機上;R6 之後油會用完', when: '2003 年起', trig: 'prop', prop: 'generator', hint: 'quest:207light' },
  { id: 'pr.curtain', text: '這是我的床。', who: '隔簾後的病人', why: '每一床的隔簾都拉著,像還有人住', when: '七月初三之前', trig: 'prop', prop: 'bed_curtain' },
  { id: 'pr.statue', text: '修女說……要等到天亮。', who: '不明', why: '安修女把聖像蓋起來:「這座城市現在就是苦難週」', when: '七月', trig: 'prop', prop: ['statue_mary', 'statue_veiled'] },
  { id: 'pr.coffin', text: '我不在裡面。', who: '不明', why: '靈車後車廂的棺木是空的,貼著夜班回收單「回收第 1 次」', when: '現在', trig: 'prop', prop: 'coffin' },
  { id: 'pr.tv', text: '……救援……即將抵達……請留在室內……', who: '電視的緊急廣播', why: '商店電視的跑馬燈也在播同一則', when: '七月初一起', trig: 'prop', prop: ['tv', 'cctv'], filter: 'radio', mode: 'murmur' },

  // ---------- 接起電話(interact 代理呼叫 game.horror.phone) ----------
  { id: 'ph.1', text: '……二〇七號房家屬，請至護理站。二〇七號房家屬……', who: '舊的院內錄音', why: 'R2 護理站的舊電話會自己響,放的是 207 家屬的呼叫錄音', when: '2025 年之前', trig: 'phone', filter: 'phone' },
  { id: 'ph.2', text: '喂？……是你嗎？你怎麼還不回家？', who: '不明(電話線路早就斷了)', why: '你是來找家人的;這通電話像是反過來在找你', when: '現在', trig: 'phone', filter: 'phone' },
  { id: 'ph.3', text: '……我在你後面那間房間，打給你。', who: '不明', why: '留白', when: '現在', trig: 'phone', filter: 'phone' },
  { id: 'ph.4', text: '這裡是聖心醫院總機……您撥的分機，已經沒有人了。', who: '總機的錄音', why: '總機的自動語音還在運作', when: '2026 年', trig: 'phone', filter: 'phone' },
  { id: 'ph.5', text: '……（呼吸聲）……數到十，再掛電話。', who: '不明', why: '「霧港夜話」的結尾語', when: '現在', trig: 'phone', filter: 'phone', hint: 'rule:voice' },
  { id: 'ph.6', text: '金水伯的店……休息的時候會開。記得去。', who: '不明(聲音很老,台語口音)', why: '補給站是金水商行的夜班特約店,回合間開放', when: '現在', trig: 'phone', filter: 'phone', hint: 'shop' },

  // ---------- 收音機自己打開 ----------
  { id: 'rd.1', text: '……AM 一二〇七……還醒著的夜貓子……收到請回答……', who: '霧港夜話的開場(留白:現在的小鈴在山上開播)', why: 'AM 1207 的呼號', when: '1999 年', trig: 'radio', filter: 'radio' },
  { id: 'rd.2', text: '……各位民眾請注意……救援即將抵達……請至一樓大廳集合……', who: '院內集合廣播', why: '「不要相信廣播」的那段廣播', when: '七月初三', trig: 'radio', filter: 'radio', hint: 'rule:pa' },
  { id: 'rd.3', text: '……燈開著。等妳醒來，要自己關。', who: '安修女的錄音(聲音很像)', why: '安修女 2003 年給秀鈴的信', when: '2003 年', trig: 'radio', filter: 'radio' },
  { id: 'rd.4', text: '……昨天叩應的醫生朋友說……山上有人被牽走……', who: '霧港夜話 1999/10/20', why: '何醫師的叩應讓小鈴上山做現場直播', when: '1999/10/20', trig: 'radio', filter: 'radio', prog: [4] },

  // ---------- 警告(殭屍從看不到的方向接近:耳朵 = 牠的方向) ----------
  { id: 'wn.back', text: '……後面。', who: '不明', why: '提示:有東西從背後來', when: '現在', trig: 'warn', ear: 'behind', hint: 'warn' },
  { id: 'wn.left', text: '左邊……有人。', who: '不明', why: '提示:有東西從左邊來', when: '現在', trig: 'warn', ear: 'left', hint: 'warn' },
  { id: 'wn.right', text: '右邊……牠來了。', who: '不明', why: '提示:有東西從右邊來', when: '現在', trig: 'warn', ear: 'right', hint: 'warn' },
  { id: 'wn.heard', text: '牠們聽到你了。', who: '不明', why: '世界規則「牠們聽得到」', when: '現在', trig: 'warn', hint: 'warn' },

  // ---------- 引導(提示) ----------
  { id: 'gd.shop', text: '……捲門拉起來了。往這邊。', who: '不明', why: '休息時補給站開放;耳朵的方向 = 補給站的方向', when: '現在', trig: 'guide', cue: 'shop', phase: 'rest', hint: 'shop' },
  { id: 'gd.shop2', text: '金水伯的店……在這邊。', who: '不明(聲音很老)', why: '同上', when: '現在', trig: 'guide', cue: 'shop', phase: 'rest', hint: 'shop', prog: [3] },
  { id: 'gd.supply', text: '櫃子裡……還有東西。', who: '不明', why: '夜班預先布置的補給櫃;耳朵的方向 = 最近的補給櫃', when: '現在', trig: 'guide', cue: 'supply', hint: 'supply' },
  { id: 'gd.fountain', text: '池子裡丟七次……修女留了話。', who: '大廳的人影', why: '噴水池聖母像:丟滿七枚點數,底座會出現安修女的禱告字條', when: '現在', trig: 'zone', zone: ['f1_lobby'], prog: [5], hint: 'egg:fountain' },
  { id: 'gd.his', text: '病歷終端……試試看入院那一天。', who: '舊病歷庫的人影', why: 'HIS 終端可以輸入號碼;1024 是 207 的入院日期', when: '現在', trig: 'idle', prog: [6], hint: 'egg:his' },
  { id: 'gd.radio', text: '停車場……有一台車的收音機還開著。', who: '不明', why: '停車場一台車的收音機調在 AM 1207', when: '現在', trig: 'idle', prog: [4], hint: 'egg:carradio' },

  // ---------- 探索時 / 配合事件 ----------
  { id: 'id.1', text: '……你聽到了嗎？有人在叫你的名字。', who: '不明', why: '18.9 Hz 的呼喚會讓人覺得有人在叫自己(遊戲從不證實)', when: '現在', trig: 'idle' },
  { id: 'id.2', text: '他們說，救援馬上就到。', who: '集合的人', why: '集合廣播的內容', when: '七月初三', trig: 'idle' },
  { id: 'id.3', text: '這裡……不再收治活人了。', who: '不明', why: '主選單題詞', when: '現在', trig: 'idle', prog: [5] },
  { id: 'id.4', text: '頭七那天……我有回來。', who: '不明', why: '頭七回魂(民俗);菌絲保留了宿主的路徑記憶', when: '現在', trig: 'idle', prog: [3] },
  { id: 'cu.figure', text: '走廊盡頭……有人在等你。', who: '不明', why: '配合走廊盡頭的人影', when: '現在', trig: 'cue', cue: 'figure' },
  { id: 'cu.behind', text: '不要回頭。', who: '不明', why: '配合身後的人影', when: '現在', trig: 'cue', cue: 'behind', ear: 'behind' },
  { id: 'cu.steps', text: '你踩到我了。', who: '不明', why: '配合濕腳印', when: '現在', trig: 'cue', cue: 'footprints' },
  { id: 'cu.nurse', text: '推車要推回護理站……', who: '值夜的護理師(聲音)', why: '配合推車的護理師', when: '七月初三之前', trig: 'cue', cue: 'nurse' },
  { id: 'cu.child', text: '來玩嘛……', who: '看不見的孩子', why: '配合跑過門口的孩子', when: '現在', trig: 'cue', cue: 'child' },
  { id: 'cu.lift', text: '電梯……到了。要上來嗎？', who: '不明', why: '配合沒有人的電梯;大廳廣播說過「請勿使用電梯」', when: '現在', trig: 'cue', cue: 'elevator' },
  { id: 'cu.write', text: '寫給你的。', who: '不明', why: '配合牆上新出現的字', when: '現在', trig: 'cue', cue: 'writing' },
  { id: 'cu.cold', text: '好冷……你也覺得冷嗎？', who: '不明', why: '配合寒氣(太平間的冷氣早就停了)', when: '現在', trig: 'cue', cue: 'coldBreath', ear: 'behind' },
  { id: 'cu.lights', text: '燈……一盞一盞，都熄了。', who: '不明', why: '配合燈一盞盞熄滅', when: '現在', trig: 'cue', cue: 'lightsDie', ear: 'both' },
  { id: 'cu.silence', text: '……噓。', who: '不明', why: '配合突然的寂靜', when: '現在', trig: 'cue', cue: 'silence', ear: 'both' },
  { id: 'cu.window', text: '外面……有人在看。', who: '不明', why: '配合窗外的人影', when: '現在', trig: 'cue', cue: 'window' },
  { id: 'cu.hands', text: '讓我進去……', who: '窗外的人', why: '配合玻璃上的手印', when: '現在', trig: 'cue', cue: 'handprints' },
];

// 牆上字跡(場景佈置 static:一開始就在;事件 appear:趁玩家沒在看的時候出現)
// 欄位:id、text、zone(static 擺放區域)、style(marker 麥克筆 | paint 噴漆 | chalk 粉筆 | crayon 蠟筆 | scratch 刻痕 | smear 暗紅手指塗抹)、
//       who(誰寫的)、why(為什麼)、when(什麼時候)、hint、size(字高 m)、h(離地高度 m)
export const WRITINGS = [
  { id: 'w.waiting', kind: 'static', text: '叫號機壞了\n不要再排了', zone: 'f1_waiting', style: 'marker', who: '夜班護理師', why: '集合事件後,還有人(和感染者)每天走回來排隊', when: '七月初五', size: 0.2, h: 1.55 },
  { id: 'w.morgue', kind: 'static', text: '抽屜有聲音\n不要開　7/04', zone: 'b1_morgue', style: 'marker', who: '夜班回收班作業員', why: '被回收的人在抽屜裡「醒來」', when: '七月初四', size: 0.18, h: 1.5 },
  { id: 'w.phone', kind: 'static', text: '護理站電話不要接\n接了也沒有人', zone: 'f2_corridor', style: 'marker', who: '留守的護理師 陳', why: '207 家屬的舊呼叫錄音每晚自己響;接起來只剩呼吸聲', when: '七月初六', size: 0.17, h: 1.45, hint: 'egg:phone' },
  { id: 'w.chapel', kind: 'static', text: '蠟燭不要熄\n修女說的', zone: 'f1_chapel', style: 'crayon', who: '躲在禮拜堂的孩子', why: '安修女教的:點一根蠟燭,代表有人在等', when: '七月初三之後', size: 0.16, h: 0.9, hint: 'egg:candle' },
  { id: 'w.tunnel', kind: 'static', text: '鍋爐房 →\n油桶在裡面', zone: 'b1_tunnel', style: 'paint', who: '工務的弟兄', why: '207 的燈接在後巷的發電機上,加油要從鍋爐房扛油桶', when: '2003 年起', size: 0.24, h: 1.6, hint: 'quest:207light' },
  { id: 'w.psych', kind: 'static', text: '她唱歌的時候\n牠們都很安靜', zone: 'f3_corridor', style: 'scratch', who: '三樓的病人(受試者 004)', why: '熟悉的人聲讓宿主暫時安靜;001 會哼歌', when: '2025 年春天', size: 0.15, h: 1.3, hint: 'rule:voice' },
  { id: 'w.archive', kind: 'static', text: '207 病歷\n被借走未還', zone: 'b1_archive', style: 'marker', who: '病歷室管理員', why: '2025/02/27 的掉包,借閱人欄寫著「萬嵐專案」', when: '2025/02', size: 0.17, h: 1.5 },
  { id: 'w.dorm', kind: 'static', text: '燈要開著\n等她醒來自己關', zone: 'f3_dorm', style: 'chalk', who: '安修女', why: '她給秀鈴的信裡也寫了同一句', when: '2003 年', size: 0.16, h: 1.45 },
  { id: 'w.icu', kind: 'static', text: '機器的聲音會叫牠們來\n關掉！', zone: 'f2_icu', style: 'marker', who: '加護病房護理師', why: '世界規則「牠們聽得到」', when: '七月初二', size: 0.16, h: 1.5, hint: 'rule:sound' },
  { id: 'w.playroom', kind: 'static', text: '收音機阿姨\n明天還來嗎', zone: 'f2_playroom', style: 'crayon', who: '小兒科的孩子', why: '001 醒來後偷偷下樓講故事', when: '2025 年春天', size: 0.14, h: 0.8 },
  { id: 'w.laundry', kind: 'static', text: '床單不夠了\n先用白布', zone: 'b1_laundry', style: 'marker', who: '洗衣房阿姨', why: '病房的白布都拿去蓋人了', when: '七月初四', size: 0.16, h: 1.5 },
  // 事件:沒有人看到是誰寫的(留白)
  { id: 'a.gather', kind: 'appear', text: '你也是來集合的嗎', style: 'smear', who: '不明', why: '出現時沒有人在場', when: '本局', size: 0.22 },
  { id: 'a.back', kind: 'appear', text: '別回頭', style: 'smear', who: '不明', why: '出現時沒有人在場', when: '本局', size: 0.3 },
  { id: 'a.queue', kind: 'appear', text: '我們還在排隊', style: 'smear', who: '不明', why: '出現時沒有人在場', when: '本局', size: 0.22 },
  { id: 'a.home', kind: 'appear', text: '回家', style: 'smear', who: '不明', why: '出現時沒有人在場', when: '本局', size: 0.4 },
  { id: 'a.light', kind: 'appear', text: '燈還亮著嗎', style: 'smear', who: '不明', why: '出現時沒有人在場', when: '本局', size: 0.22, hint: 'quest:207light' },
  { id: 'a.count', kind: 'appear', text: '一　二　三　四　五\n六　七　八　九', style: 'scratch', who: '不明', why: '少了「十」:天還沒亮', when: '本局', size: 0.18 },
  { id: 'a.quiet', kind: 'appear', text: '小聲一點\n牠們聽得到', style: 'smear', who: '不明', why: '出現時沒有人在場', when: '本局', size: 0.2, hint: 'rule:sound' },
];

// 事件字幕(不是低語:例如數數的人;灰色、標記「？？？」)
export const CAPTIONS = {
  counter: { who: '？？？', count: ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'], tail: '……還沒好。', tailNear: '……快好了。', tailEnd: '……天亮了。' },
};

// 依 id 查
export const LINE_BY_ID = Object.fromEntries(LINES.map((l) => [l.id, l]));
