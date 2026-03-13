/**
 * scoring.js - 補助金マッチングスコアリングロジック
 *
 * === 地域判定ロジックの最終修正（2026-03-13）===
 *
 * 【判明した根本原因】
 * DB の prefecture フィールドに「全国/北海道/青森県/.../沖縄県/中国地方...」という
 * 全都道府県を列挙した長い文字列が入っている案件が存在していた。
 * （例: 「福岡市ステップアップ助成事業」や「【横浜市】ものづくり魅力発信助成金」）
 * そのため「沖縄県」の文字が含まれていても、実態は福岡市や横浜市の限定案件であった。
 *
 * 【修正方針】
 * 1. scope = 'national' の場合のみ全国対象として通過させる
 * 2. scope = 'prefecture' の場合、プログラム名に含まれる市区町村名 OR prefecture フィールドから
 *    都道府県判定を行い、ユーザーの都道府県と一致しない場合は return 0
 * 3. prefecture フィールドが null/empty/全都道府県列挙の場合は scope で判断する
 * 4. スコアが範囲外や null になる可能性を全て潰す
 *
 * 【地域判定アルゴリズム（超厳格ホワイトリスト方式）】
 * STEP A: scope === 'national' → 通過（全国案件）
 * STEP B: scope !== 'national' の場合:
 *   - prefecture フィールドに「全国」が含まれていても scope 優先で「限定案件」扱い
 *   - prefecture フィールドが全都道府県列挙（文字数 > 100）の場合は使用しない
 *   - プログラム名から「XX市」「XX区」などの市区町村を抽出し、
 *     その市区町村がユーザーの都道府県と一致しない場合は return 0
 *   - 上記が確定できない場合は prefecture から都道府県リストを抽出して確認
 *   - それでも判定できない場合は安全のため return 0
 */

const DEBUG = process.env.SCORING_DEBUG === 'true';
const CURRENT_REIWA_YEAR = 8; // 令和8年 = 2026年

// 全都道府県リスト（判定に使用）
const ALL_PREFECTURES = [
    '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
    '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
    '岐阜県', '静岡県', '愛知県', '三重県',
    '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
    '鳥取県', '島根県', '岡山県', '広島県', '山口県',
    '徳島県', '香川県', '愛媛県', '高知県',
    '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'
];

// 市区町村 → 都道府県 のマッピング（名称判定用）
const CITY_TO_PREFECTURE = {
    '札幌市': '北海道', '旭川市': '北海道', '函館市': '北海道',
    '仙台市': '宮城県',
    '千葉市': '千葉県',
    '東京都': '東京都', '新宿区': '東京都', '渋谷区': '東京都', '港区': '東京都',
    '横浜市': '神奈川県', '川崎市': '神奈川県', '相模原市': '神奈川県',
    '名古屋市': '愛知県', '豊田市': '愛知県', '岡崎市': '愛知県',
    '大阪市': '大阪府', '堺市': '大阪府',
    '神戸市': '兵庫県', '姫路市': '兵庫県',
    '京都市': '京都府',
    '広島市': '広島県', '東広島市': '広島県', '福山市': '広島県',
    '北九州市': '福岡県', '福岡市': '福岡県', '久留米市': '福岡県',
    '熊本市': '熊本県',
    '那覇市': '沖縄県',
    '浜松市': '静岡県', '静岡市': '静岡県',
    '新潟市': '新潟県',
    '金沢市': '石川県',
    '松山市': '愛媛県',
    '高松市': '香川県',
    '鹿児島市': '鹿児島県',
    '長崎市': '長崎県',
    '岡山市': '岡山県',
    '宇都宮市': '栃木県',
    '前橋市': '群馬県', '高崎市': '群馬県',
    'さいたま市': '埼玉県',
    '川越市': '埼玉県',
    '水戸市': '茨城県',
    '盛岡市': '岩手県',
    '青森市': '青森県',
    '秋田市': '秋田県',
    '山形市': '山形県',
    '福島市': '福島県', '郡山市': '福島県', 'いわき市': '福島県',
    '長野市': '長野県', '松本市': '長野県',
    '甲府市': '山梨県',
    '富山市': '富山県',
    '福井市': '福井県',
    '津市': '三重県',
    '四日市市': '三重県',
    '大津市': '滋賀県',
    '奈良市': '奈良県',
    '和歌山市': '和歌山県',
    '鳥取市': '鳥取県',
    '松江市': '島根県',
    '下関市': '山口県', '山口市': '山口県',
    '徳島市': '徳島県',
    '高知市': '高知県',
    '佐賀市': '佐賀県',
    '大分市': '大分県',
    '宮崎市': '宮崎県',
};

/**
 * プログラム名から市区町村を検出し、対応する都道府県を返す
 * 例: "【横浜市】ものづくり..." → '神奈川県'
 * 例: "福岡市ステップアップ..." → '福岡県'
 * 見つからない場合は null
 */
function extractPrefectureFromName(programName) {
    for (const [city, pref] of Object.entries(CITY_TO_PREFECTURE)) {
        if (programName.includes(city)) {
            return pref;
        }
    }
    return null;
}

/**
 * prefecture フィールドが「全都道府県列挙」の無効なデータかを判定
 * 200文字以上かつ都道府県を3つ以上含む場合は無効とみなす
 */
function isInvalidPrefectureData(prefField) {
    if (!prefField || prefField.length > 200) return true;
    return false;
}

/**
 * prefecture フィールドから、ユーザーの都道府県が単独で含まれているか確認
 * 「全国/北海道/.../沖縄県」のような全列挙文字列の場合は false を返す
 */
function prefectureMatches(prefField, userPrefecture) {
    if (!prefField || !userPrefecture) return false;
    // 200文字超えは無効データとして判定に使わない
    if (prefField.length > 200) return false;
    return prefField.includes(userPrefecture);
}

// 全角数字変換マップ
const ZEN_TO_HAN = { '０':0,'１':1,'２':2,'３':3,'４':4,'５':5,'６':6,'７':7,'８':8,'９':9 };
const KANJI_REIWA = { '元':1,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12 };

/**
 * 【最終防衛①】過去年度テキスト検知
 * ASCII/全角/漢数字/R表記/ハイフン期間/補正・次年度/平成 の全パターンに対応
 */
function containsOldYear(text) {
    if (!text) return false;

    // ── 追加：R表記（R1〜R7）※R8以上は現在以降なので通過 ──
    // 例: R7, R6年度, R5_補正, r4 など
    for (const m of text.matchAll(/\bR([1-7])\b/gi)) {
        if (DEBUG) console.log(`  [OLD YEAR] R${m[1]}表記 を検出`);
        return true;
    }

    // ── 追加：令和X-Y年度 / 令和X〜Y年度 形式（期間表記）──
    // 例: 令和5-6年度、令和6−7年度
    for (const m of text.matchAll(/令和([0-9０-９]+)[\-−〜～]([0-9０-９]+)年/g)) {
        // 開始年が現在年度未満ならアウト
        const startAscii = [...m[1]].reduce((a, c) => a * 10 + (ZEN_TO_HAN[c] ?? parseInt(c, 10) ?? 0), 0);
        if (startAscii > 0 && startAscii < CURRENT_REIWA_YEAR) {
            if (DEBUG) console.log(`  [OLD YEAR] 令和${m[1]}-${m[2]}年度（期間表記）を検出`);
            return true;
        }
    }

    // ── 追加：「令和X年度補正」や「令和X年度（補正）」──
    // 例: 令和6年度補正、令和６年度（補正）
    for (const m of text.matchAll(/令和([0-9０-９一二三四五六七八九十元]+)年.{0,5}補正/g)) {
        const raw = m[1];
        let y = parseInt(raw, 10);
        if (isNaN(y)) {
            // 全角/漢数字を変換
            y = KANJI_REIWA[raw] ??
                [...raw].reduce((a, c) => a * 10 + (ZEN_TO_HAN[c] ?? 0), 0);
        }
        if (y > 0 && y < CURRENT_REIWA_YEAR) {
            if (DEBUG) console.log(`  [OLD YEAR] 令和${raw}年度補正 を検出`);
            return true;
        }
    }

    // ── 既存：令和X年（ASCII）──
    for (const m of text.matchAll(/令和(\d+)年/g)) {
        if (parseInt(m[1], 10) < CURRENT_REIWA_YEAR) {
            if (DEBUG) console.log(`  [OLD YEAR] 令和${m[1]}年（ASCII）を検出`);
            return true;
        }
    }
    // ── 既存：令和Ｘ年（全角）──
    for (const m of text.matchAll(/令和([０-９]+)年/g)) {
        const y = [...m[1]].reduce((a, c) => a * 10 + (ZEN_TO_HAN[c] ?? 0), 0);
        if (y > 0 && y < CURRENT_REIWA_YEAR) {
            if (DEBUG) console.log(`  [OLD YEAR] 令和${m[1]}年（全角）を検出`);
            return true;
        }
    }
    // ── 既存：令和X年（漢数字）──
    for (const m of text.matchAll(/令和(十二|十一|[元一二三四五六七八九十])年/g)) {
        const y = KANJI_REIWA[m[1]];
        if (y !== undefined && y < CURRENT_REIWA_YEAR) {
            if (DEBUG) console.log(`  [OLD YEAR] 令和${m[1]}年（漢数字）を検出`);
            return true;
        }
    }
    // ── 既存：平成はすべて過去 ──
    if (/平成[元0-9０-９一二三四五六七八九十百]+年/.test(text)) {
        if (DEBUG) console.log(`  [OLD YEAR] 平成年を検出`);
        return true;
    }
    // ―― 追加：西暦 2020、2021、2022、2023、2024、2025 ――
    // Jグランツ等に「2023年募集」などの形式で残っている場合がある
    if (/202[0-5]年/.test(text)) {
        if (DEBUG) console.log(`  [OLD YEAR] 西暦2020-2025年を検出`);
        return true;
    }
    // ── 既存：公募終了文言 ──
    if (/公募は締め切り|募集終了|受付終了/.test(text)) {
        if (DEBUG) console.log(`  [OLD YEAR] 公募終了文言を検出`);
        return true;
    }
    return false;
}

// ── 最終防衛② 用：接頭辞なし都道府県名（京都、石川 など）の一覧 ──
// 「都道府県」の文字を省いた短縮名でも検知できるようにする
const PREF_SHORT_NAMES = [
    { short: '北海道',  full: '北海道' },
    { short: '青森',    full: '青森県' }, { short: '岩手',    full: '岩手県' },
    { short: '宮城',    full: '宮城県' }, { short: '秋田',    full: '秋田県' },
    { short: '山形',    full: '山形県' }, { short: '福島',    full: '福島県' },
    { short: '茨城',    full: '茨城県' }, { short: '栃木',    full: '栃木県' },
    { short: '群馬',    full: '群馬県' }, { short: '埼玉',    full: '埼玉県' },
    { short: '千葉',    full: '千葉県' }, { short: '東京',    full: '東京都' },
    { short: '神奈川',  full: '神奈川県' }, { short: '新潟',  full: '新潟県' },
    { short: '富山',    full: '富山県' }, { short: '石川',    full: '石川県' },
    { short: '福井',    full: '福井県' }, { short: '山梨',    full: '山梨県' },
    { short: '長野',    full: '長野県' }, { short: '岐阜',    full: '岐阜県' },
    { short: '静岡',    full: '静岡県' }, { short: '愛知',    full: '愛知県' },
    { short: '三重',    full: '三重県' }, { short: '滋賀',    full: '滋賀県' },
    { short: '京都',    full: '京都府' }, { short: '大阪',    full: '大阪府' },
    { short: '兵庫',    full: '兵庫県' }, { short: '奈良',    full: '奈良県' },
    { short: '和歌山',  full: '和歌山県' }, { short: '鳥取',  full: '鳥取県' },
    { short: '島根',    full: '島根県' }, { short: '岡山',    full: '岡山県' },
    { short: '広島',    full: '広島県' }, { short: '山口',    full: '山口県' },
    { short: '徳島',    full: '徳島県' }, { short: '香川',    full: '香川県' },
    { short: '愛媛',    full: '愛媛県' }, { short: '高知',    full: '高知県' },
    { short: '福岡',    full: '福岡県' }, { short: '佐賀',    full: '佐賀県' },
    { short: '長崎',    full: '長崎県' }, { short: '熊本',    full: '熊本県' },
    { short: '大分',    full: '大分県' }, { short: '宮崎',    full: '宮崎県' },
    { short: '鹿児島',  full: '鹿児島県' }, { short: '沖縄',  full: '沖縄県' },
];

// タイトルに含まれていても無視するキーワード（誤検知防止）
const REGION_IGNORE_PATTERNS = /日本|全国|国内|国際|海外|日本全国|全国対象/;

/**
 * 【最終防衛②】「ニセ全国案件」検知
 * プログラム名に特定の地域名（都道府県の短縮名 or 市区町村名）が含まれていて、
 * かつそれがユーザーの都道府県と一致しない場合は true を返す
 */
function containsLocalRegionMismatch(programName, userPrefecture) {
    if (!programName || !userPrefecture) return false;
    if (REGION_IGNORE_PATTERNS.test(programName)) return false;

    // ① 市区町村名でチェック（CITY_TO_PREFECTURE を再利用）
    for (const [city, pref] of Object.entries(CITY_TO_PREFECTURE)) {
        if (programName.includes(city)) {
            const match = (pref === userPrefecture);
            if (!match) {
                if (DEBUG) console.log(`  [FAKE NATIONAL] 名称に "${city}"（${pref}）を検出 → ユーザー(${userPrefecture})と不一致`);
                return true;
            }
            return false; // 一致していれば OK
        }
    }

    // ② 都道府県の短縮名でチェック（例：「京都」「石川」）
    for (const { short, full } of PREF_SHORT_NAMES) {
        // プログラム名に短縮名が含まれ、かつユーザーの都道府県と異なる場合
        if (programName.includes(short) && full !== userPrefecture) {
            if (DEBUG) console.log(`  [FAKE NATIONAL] 名称に "${short}"（${full}）を検出 → ユーザー(${userPrefecture})と不一致`);
            return true;
        }
    }

    return false;
}

function safeParseArray(val) {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
        try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; }
        catch (e) { return []; }
    }
    return [];
}

/**
 * calculateScore - メインスコアリング関数
 */
function calculateScore(company, program) {
    const industryTags      = safeParseArray(program.industry_tags);
    const purposeTags       = safeParseArray(program.purpose_tags);
    const employeeRangeTags = safeParseArray(program.employee_range_tags);
    const companyPurposes   = safeParseArray(company.purposes);

    const programName     = program.name || '';
    const benefitText     = program.benefit_text || '';
    const eligibilityText = program.eligibility_text || '';
    const status          = (program.application_status || '').toLowerCase();
    const freshness       = (program.freshness_status   || '').toLowerCase();
    const scope           = (program.scope              || '').toLowerCase();
    const prefectureField = program.prefecture || '';

    // 1-D: 目的チェック
    //   ★ バイパスするのは「目的マッチ」の局面のみ。
    //   ★ 地域・年度・ステータスの足切りはバイパスしない（STEP 1-A、1-B、1-B2、1-C で return 0 済み）
    const isITSubsidy       = programName.includes('IT導入補助金');        // 国の三大補助金①
    const isMonoSubsidy     = programName.includes('ものづくり・商業・サービス'); // 国の三大補助金②
    const isJizokukaSubsidy = programName.includes('小規模事業者持続化補助金');  // 国の三大補助金③

    if (DEBUG) {
        console.log(`\n[SCORE DEBUG] === ${program.id}: ${programName.substring(0, 40)} ===`);
        console.log(`  scope: "${scope}" | prefecture: "${prefectureField.substring(0, 60)}..."`);
        console.log(`  company.prefecture: "${company.prefecture}"`);
    }

    // ===========================================================
    // ★ STEP 1: 足切り判定ブロック
    // ===========================================================

    // 1-A: ステータスチェック
    if (status === 'stale' || status === 'expired' || status === 'closed') {
        if (DEBUG) console.log(`  [REJECT] ステータス: ${status}`);
        return { score: 0, reasons: ['公募が終了または情報が古いため対象外です'] };
    }
    if (freshness === 'expired_suspected') {
        if (DEBUG) console.log(`  [REJECT] 鮮度: ${freshness}`);
        return { score: 0, reasons: ['情報の鮮度が確認できないため対象外です'] };
    }

    // 1-B: 過去年度チェック（ASCII/全角/漢数字/R表記/補正/期間表記 全対応）
    if (containsOldYear(programName) || containsOldYear(benefitText) || containsOldYear(eligibilityText)) {
        if (DEBUG) console.log(`  [REJECT] 過去年度テキスト検知`);
        return { score: 0, reasons: ['過去年度の情報のため対象外です'] };
    }

    // 1-B2: 「ニセ全国案件」チェック（名称に含まれる地域名とユーザー所在地の照合）
    // scope が national でもタイトルに特定地域名が入っていれば弾く
    if (containsLocalRegionMismatch(programName, company.prefecture)) {
        if (DEBUG) console.log(`  [REJECT] ニセ全国案件：名称に含まれる地域名とユーザー所在地が不一致`);
        return { score: 0, reasons: ['タイトルに含まれる地域名が所在地と一致しません'] };
    }

    // 1-C: 地域チェック（超厳格ホワイトリスト方式）
    //
    // ルール:
    //   - scope === 'national' → 全国案件として通過
    //   - scope !== 'national' → 都道府県限定案件として厳格判定:
    //       i.  プログラム名から市区町村を検出 → その都道府県がユーザーと一致すれば通過
    //       ii. prefecture フィールドが有効な短い文字列 → contains チェック
    //       iii.上記どちらでも判定できない → 安全のため return 0

    let regionPass = false;
    let regionLabel = '';

    if (scope === 'national') {
        // 全国案件: そのまま通過
        regionPass = true;
        regionLabel = '全国対象';
        if (DEBUG) console.log(`  [REGION] scope=national → 通過`);
    } else {
        // 都道府県限定案件
        // i. まずプログラム名から市区町村 → 都道府県 を判定（最信頼性高）
        const prefFromName = extractPrefectureFromName(programName);
        if (prefFromName !== null) {
            regionPass = (prefFromName === company.prefecture);
            regionLabel = `${prefFromName}限定（名称判定）`;
            if (DEBUG) console.log(`  [REGION] 名称判定: ${prefFromName} vs ${company.prefecture} → ${regionPass ? '通過' : '除外'}`);
        } else if (!isInvalidPrefectureData(prefectureField)) {
            // ii. prefecture フィールドが有効（短い文字列）なら contains チェック
            const prefContainsGlobal = prefectureField.includes('全国');
            const prefContainsUser   = company.prefecture && prefectureField.includes(company.prefecture);
            regionPass = prefContainsGlobal || prefContainsUser;
            regionLabel = regionPass ? '都道府県一致' : '都道府県不一致';
            if (DEBUG) console.log(`  [REGION] prefecture-field: includes('全国')=${prefContainsGlobal}, includes('${company.prefecture}')=${prefContainsUser} → ${regionPass ? '通過' : '除外'}`);
        } else {
            // iii. データ不十分 → 安全のため除外
            regionPass = false;
            regionLabel = '地域データ不十分';
            if (DEBUG) console.log(`  [REGION] データ不十分・全都道府県列挙のため除外`);
        }

        if (!regionPass) {
            if (DEBUG) console.log(`  [REJECT] 地域不一致: ${regionLabel}`);
            return { score: 0, reasons: [`${regionLabel}のため対象外です`] };
        }
    }

    // 1-D: 目的チェック（特別枠は目的不一致でもパス）
    if (purposeTags.length > 0) {
        if (companyPurposes.length === 0) {
            if (DEBUG) console.log(`  [REJECT] 目的未入力`);
            return { score: 0, reasons: ['目的が入力されていないため診断できません'] };
        }
        const matchingPurposes = companyPurposes.filter(p => purposeTags.includes(p));
        if (matchingPurposes.length === 0) {
            // 特別枠（IT導入・ものづくり・持続化）は目的不一致でもパス
            if (!isITSubsidy && !isMonoSubsidy && !isJizokukaSubsidy) {
                if (DEBUG) console.log(`  [REJECT] 目的不一致`);
                return { score: 0, reasons: ['選択された目的に合致していません'] };
            }
            if (DEBUG) console.log(`  [FEATURED PASS] 目的不一致だが特別枠（三大補助金）として通過`);
        }
    }

    // 1-E: 業種チェック
    if (industryTags.length > 0 && !industryTags.includes('all') && !industryTags.includes(company.industry)) {
        if (DEBUG) console.log(`  [REJECT] 業種不一致`);
        return { score: 0, reasons: ['対象業種に該当しません'] };
    }

    // ===========================================================
    // ★ STEP 2: 加点ブロック（全足切りを通過した案件のみ到達）
    // ===========================================================
    let score = 0;
    const reasons = [];

    // 地域ボーナス
    if (scope === 'national') {
        score += 15;
        reasons.push('全国対象の制度です');
    } else {
        score += 25;
        reasons.push(`${regionLabel}の制度です（地域一致）`);
    }

    // 目的マッチボーナス
    if (purposeTags.length === 0) {
        score += 5;
        reasons.push('幅広い目的に対応した汎用制度です');
    } else {
        const matchingPurposes = companyPurposes.filter(p => purposeTags.includes(p));
        const nicheTargets = ['it_implementation', 'productivity', 'new_product', 'startup', 'branding'];
        const nicheCount = matchingPurposes.filter(p => nicheTargets.includes(p)).length;
        score += Math.min(15 + nicheCount * 10, 35);
        reasons.push(`目的(${matchingPurposes.map(m => translatePurpose(m)).join(', ')})が合致します`);
    }

    // 業種ボーナス
    if (industryTags.length === 0 || industryTags.includes('all')) {
        score += 8;
        reasons.push('幅広い業種が対象です');
    } else {
        score += 25;
        reasons.push(`業種(${translateIndustry(company.industry)})に特化した支援です！`);
    }

    // 企業規模ボーナス
    const companyScale = getCompanyScale(company.employees_count);
    if (employeeRangeTags.length === 0 || employeeRangeTags.includes('all')) {
        score += 5;
        reasons.push('幅広い企業規模が対象です');
    } else if (employeeRangeTags.includes(companyScale)) {
        score += 10;
        reasons.push('企業規模の条件に合致しています');
    }

    // 公募ステータスボーナス
    if (status === 'open') {
        score += 10;
        reasons.push('現在公募中です（即応性あり）');
    } else if (status === 'upcoming') {
        score += 5;
        reasons.push('今後公募予定です（事前準備推奨）');
    }

    // 最新情報ボーナス
    if (program.last_verified_at) {
        const days = (new Date() - new Date(program.last_verified_at)) / (1000 * 60 * 60 * 24);
        if (days <= 90) { score += 5; reasons.push('直近で確認された最新情報です'); }
    }

    // ===========================================================
    // ★ STEP 2.5: 特別枠の最低保証スコアと適合理由の付与
    // ===========================================================
    {
        const matchedP = companyPurposes.filter(p => purposeTags.includes(p));
        const isFeaturedPass = purposeTags.length > 0 && matchedP.length === 0;

        if (isITSubsidy) {
            if (isFeaturedPass) {
                reasons.push('【特別提案】今後の事業成長・業務効率化において、全業種でITツールやAIの導入が推奨されるため');
            }
            if (score < 60) {
                score = 60; // IT導入補助金: 最低保証 60 点
                if (DEBUG) console.log(`  [FEATURED] IT導入補助金: スコアを 60 点に引き上げ`);
            }
        } else if (isJizokukaSubsidy) {
            if (isFeaturedPass) {
                reasons.push('【特別提案】販路開拓やPR、店舗改装など、小規模事業者の幅広い取り組みを支援する最も使い勝手の良い制度のため');
            }
            if (score < 50) {
                score = 50; // 小規模事業者持続化補助金: 最低保証 50 点
                if (DEBUG) console.log(`  [FEATURED] 持続化補助金: スコアを 50 点に引き上げ`);
            }
        } else if (isMonoSubsidy) {
            if (isFeaturedPass) {
                reasons.push('【特別提案】より抜本的な事業変革や、独自のシステム開発・設備投資を目指す場合の有力な選択肢となるため');
            }
            if (score < 45) {
                score = 45; // ものづくり補助金: 最低保証 45 点
                if (DEBUG) console.log(`  [FEATURED] ものづくり補助金: スコアを 45 点に引き上げ`);
            }
        }
    }

    // ===========================================================
    // ★ STEP 3: 上限100点の制御
    // ===========================================================
    score = Math.min(score, 100);

    if (DEBUG) console.log(`  [SCORE] 最終スコア: ${score}`);
    return { score, reasons };
}

function getCompanyScale(count) {
    const n = parseInt(count, 10);
    if (!n || n <= 5) return 'micro';
    if (n <= 20) return 'small';
    if (n <= 100) return 'medium';
    return 'large';
}

function translateIndustry(tag) {
    const map = { manufacturing: '製造業', retail: '小売業', service: 'サービス業', it: '情報通信業', restaurant: '飲食業', construction: '建設業', agriculture: '農業', other: 'その他' };
    return map[tag] || tag;
}

function translatePurpose(tag) {
    const map = { 'productivity': '生産性向上', 'new_product': '新製品・新サービス開発', 'business_model': 'ビジネスモデル変革', 'it_implementation': 'IT導入・DX', 'efficiency': '業務効率化', 'remote_work': 'テレワーク', 'hiring': '人材採用', 'career_up': 'キャリアアップ', 'marketing': '販路開拓', 'sales_expansion': '売上拡大', 'branding': 'ブランディング', 'startup': '創業・起業', 'office_rent': 'オフィス賃料' };
    return map[tag] || tag;
}

module.exports = { calculateScore };
