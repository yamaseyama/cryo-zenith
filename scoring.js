/**
 * scoring.js - 補助金マッチングスコアリングロジック
 *
 * 修正ポイント（2026-03-13 ホワイトリスト＋全角対応 最終版）:
 *
 * 【地域フィルタのホワイトリスト方式への変更】
 * 旧: DB の prefecture フィールドから都道府県を抽出 → 抽出できなかった場合に
 *     誤って「全国」扱いにしてしまいすり抜けが発生していた
 * 新: prefecture フィールドに「全国」OR「ユーザーの都道府県名」が文字列として
 *     含まれているかのみを確認する（contains check）。
 *     どちらも含まれなければ問答無用で return 0。
 *
 * 【年度フィルタの全角数字・漢数字対応】
 * 旧: /令和(\d+)年/ → \d はASCII数字のみ認識、全角数字（４, ６）を見逃していた
 *     → 「令和４年度」「令和６年度（補正）」がすり抜けていた
 * 新: 全角数字・漢数字（元〜十）を包括したリスト + 変換ロジックで検出する
 */

const DEBUG = process.env.SCORING_DEBUG === 'true';

// 現在の令和年（2026年 = 令和8年）
// ★ 必ず毎年更新すること
const CURRENT_REIWA_YEAR = 8;

// 全角数字 → 半角数字 変換マップ
const ZEN_TO_HAN = { '０':0,'１':1,'２':2,'３':3,'４':4,'５':5,'６':6,'７':7,'８':8,'９':9 };

// 令和の漢数字 → 数値 変換マップ（元年〜十年まで対応）
const KANJI_REIWA = {
    '元':1,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,
    '十一':11,'十二':12
};

/**
 * 文字列中の「令和○年」「平成○年」を全て検出し、
 * 現在年度より過去の年度が含まれるか確認する
 */
function containsOldYear(text) {
    if (!text) return false;

    // ① 「令和X年」（X = ASCII数字）を検出
    const reiwaAscii = [...text.matchAll(/令和(\d+)年/g)];
    for (const m of reiwaAscii) {
        const year = parseInt(m[1], 10);
        if (year < CURRENT_REIWA_YEAR) {
            if (DEBUG) console.log(`  [OLD YEAR] 令和${year}年（ASCII）を検出`);
            return true;
        }
    }

    // ② 「令和Ｘ年」（X = 全角数字）を検出
    const reiwaZen = [...text.matchAll(/令和([０-９]+)年/g)];
    for (const m of reiwaZen) {
        const year = [...m[1]].reduce((acc, c) => acc * 10 + (ZEN_TO_HAN[c] ?? 0), 0);
        if (year > 0 && year < CURRENT_REIWA_YEAR) {
            if (DEBUG) console.log(`  [OLD YEAR] 令和${m[1]}年（全角）を検出`);
            return true;
        }
    }

    // ③ 「令和X年」（X = 漢数字：元〜十二）を検出
    const reiwaKanji = [...text.matchAll(/令和(十二|十一|[元一二三四五六七八九十])年/g)];
    for (const m of reiwaKanji) {
        const year = KANJI_REIWA[m[1]];
        if (year !== undefined && year < CURRENT_REIWA_YEAR) {
            if (DEBUG) console.log(`  [OLD YEAR] 令和${m[1]}年（漢数字）を検出`);
            return true;
        }
    }

    // ④ 平成はすべて過去（年数を問わず除外）
    if (/平成[元0-9０-９一二三四五六七八九十百]+年/.test(text)) {
        if (DEBUG) console.log(`  [OLD YEAR] 平成年を検出`);
        return true;
    }

    // ⑤ 公募終了文言
    if (/公募は締め切り|募集終了|受付終了/.test(text)) {
        if (DEBUG) console.log(`  [OLD YEAR] 公募終了文言を検出`);
        return true;
    }

    return false;
}

/**
 * 安全に JSON をパースして配列を返す
 */
function safeParseArray(val) {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
        try {
            const parsed = JSON.parse(val);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }
    return [];
}

/**
 * calculateScore
 * @param {Object} company - 企業情報
 * @param {Object} program - 制度データ（DB 行）
 * @returns {Object} { score: number, reasons: string[] }
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

    // ★ ホワイトリスト方式: prefecture フィールドを文字列としてそのまま使う
    const prefectureField = program.prefecture || '';

    if (DEBUG) {
        console.log(`\n[SCORE DEBUG] === ${program.id}: ${programName.substring(0, 40)} ===`);
        console.log(`  prefecture: "${prefectureField}" | company.prefecture: "${company.prefecture}"`);
        console.log(`  status: "${status}" | freshness: "${freshness}"`);
    }

    // ===========================================================
    // ★ STEP 1: 足切り判定ブロック（全条件をクリアしないと即 return 0）
    // ===========================================================

    // --- 1-A: 鮮度・ステータスチェック ---
    if (status === 'stale' || status === 'expired' || status === 'closed') {
        if (DEBUG) console.log(`  [REJECT] ステータス不合格: ${status}`);
        return { score: 0, reasons: ['公募が終了または情報が古いため対象外です'] };
    }
    if (freshness === 'expired_suspected') {
        if (DEBUG) console.log(`  [REJECT] 鮮度不合格: ${freshness}`);
        return { score: 0, reasons: ['情報の鮮度が確認できないため対象外です'] };
    }

    // --- 1-B: 過去年度テキストチェック（ASCII / 全角 / 漢数字の全てに対応）---
    if (
        containsOldYear(programName) ||
        containsOldYear(benefitText) ||
        containsOldYear(eligibilityText)
    ) {
        if (DEBUG) console.log(`  [REJECT] 過去年度テキスト検知`);
        return { score: 0, reasons: ['過去年度の情報のため対象外です'] };
    }

    // --- 1-C: 地域チェック（ホワイトリスト方式）---
    // 条件A: prefectureField に「全国」が含まれる → 通過
    // 条件B: prefectureField に company.prefecture（例: "沖縄県"）が含まれる → 通過
    // それ以外（空文字・市区町村名のみ・他府県名のみ）→ 即 return 0
    const isNational         = prefectureField.includes('全国');
    const isMatchingPref     = company.prefecture && prefectureField.includes(company.prefecture);

    if (!isNational && !isMatchingPref) {
        if (DEBUG) console.log(`  [REJECT] 地域ホワイトリスト不一致: prefecture="${prefectureField}" / company="${company.prefecture}"`);
        return {
            score: 0,
            reasons: ['対象地域が一致しません（地域限定または対象外）']
        };
    }

    // --- 1-D: 目的チェック ---
    if (purposeTags.length > 0) {
        if (companyPurposes.length === 0) {
            if (DEBUG) console.log(`  [REJECT] 企業側の目的未入力`);
            return { score: 0, reasons: ['目的が入力されていないため診断できません'] };
        }
        const matchingPurposes = companyPurposes.filter(p => purposeTags.includes(p));
        if (matchingPurposes.length === 0) {
            if (DEBUG) console.log(`  [REJECT] 目的不一致`);
            return { score: 0, reasons: ['選択された目的に合致する内容が含まれていません'] };
        }
    }

    // --- 1-E: 業種チェック ---
    if (
        industryTags.length > 0 &&
        !industryTags.includes('all') &&
        !industryTags.includes(company.industry)
    ) {
        if (DEBUG) console.log(`  [REJECT] 業種不一致`);
        return { score: 0, reasons: ['対象業種に該当しません'] };
    }

    // ===========================================================
    // ★ STEP 2: 加点ブロック（足切りを全て通過した案件のみ到達）
    // ===========================================================
    let score = 0;
    const reasons = [];

    // 地域ボーナス
    if (isNational) {
        score += 15;
        reasons.push('全国対象の制度です');
    } else {
        score += 25;
        reasons.push(`${company.prefecture}対象の制度です（地域一致）`);
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
        reasons.push('幅広い業種が対象の汎用的な制度です');
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
        const daysSinceVerified = (new Date() - new Date(program.last_verified_at)) / (1000 * 60 * 60 * 24);
        if (daysSinceVerified <= 90) {
            score += 5;
            reasons.push('直近で確認された最新情報です');
        }
    }

    // ===========================================================
    // ★ STEP 3: 上限100点の制御（絶対に100を超えない）
    // ===========================================================
    score = Math.min(score, 100);

    if (DEBUG) console.log(`  [SCORE] 最終スコア: ${score}`);
    return { score, reasons };
}

// Helper: 従業員数 → 規模タグ
function getCompanyScale(count) {
    const n = parseInt(count, 10);
    if (!n || n <= 5) return 'micro';
    if (n <= 20) return 'small';
    if (n <= 100) return 'medium';
    return 'large';
}

// Helper: 業種タグ → 日本語
function translateIndustry(tag) {
    const map = {
        manufacturing: '製造業', retail: '小売業', service: 'サービス業',
        it: '情報通信業', restaurant: '飲食業', construction: '建設業',
        agriculture: '農業', other: 'その他'
    };
    return map[tag] || tag;
}

// Helper: 目的タグ → 日本語
function translatePurpose(tag) {
    const map = {
        'productivity': '生産性向上', 'new_product': '新製品・新サービス開発',
        'business_model': 'ビジネスモデル変革', 'it_implementation': 'IT導入・DX',
        'efficiency': '業務効率化', 'remote_work': 'テレワーク',
        'hiring': '人材採用', 'career_up': 'キャリアアップ',
        'marketing': '販路開拓', 'sales_expansion': '売上拡大',
        'branding': 'ブランディング', 'startup': '創業・起業',
        'office_rent': 'オフィス賃料'
    };
    return map[tag] || tag;
}

module.exports = { calculateScore };
