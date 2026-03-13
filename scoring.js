/**
 * scoring.js - 補助金マッチングスコアリングロジック
 *
 * 修正ポイント（2026-03-13 地域・年度フィルタ完全堅牢化版）:
 * 1. 地域判定: DB に「新潟県 / 福井県」「北海道/北海道地方」のように複数県・スラッシュ区切りが
 *    存在するため、prefecture 文字列をパースして都道府県リストを抽出し、
 *    ユーザーの都道府県が含まれているかで判定する
 * 2. 年度フィルタ: 「令和〇年度」の〇を数値として比較し、
 *    現在年度(令和8年)よりも小さければ全て除外する汎用ロジックに変更
 * 3. 足切り判定は関数冒頭のブロックに集約し、加点ブロックには絶対に到達させない
 * 4. 最終スコアは Math.min(score, 100) で上限100点に制御
 */

const DEBUG = process.env.SCORING_DEBUG === 'true';

// ===== 定数 =====
// 現在の和暦年（令和8年 = 2026年 - 2018年 = 8年）
// ※ 当年度よりも数字が小さい令和n年・平成n年は全て除外
const CURRENT_REIWA_YEAR = 8;

// 都道府県一覧（DB の prefecture 文字列からここに含まれる文字列を抽出する）
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

/**
 * DB の prefecture フィールド文字列から、含まれる都道府県リストを抽出する
 * 例: "新潟県 / 福井県 / 富山県/石川県" → ["新潟県","福井県","富山県","石川県"]
 * 例: "北海道/北海道地方" → ["北海道"]
 * 例: "全国" → [] (全国扱い)
 * 例: "東京都" → ["東京都"]
 */
function extractPrefectures(prefectureField) {
    if (!prefectureField) return [];
    return ALL_PREFECTURES.filter(pref => prefectureField.includes(pref));
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
 * テキストに過去の年度（令和・平成）が含まれているか確認する
 * 現在年度（令和8年）より前の数字が含まれれば true を返す
 */
function containsOldYear(text) {
    if (!text) return false;

    // 令和n年 を検出
    const reiwaMatches = text.matchAll(/令和(\d+)年/g);
    for (const m of reiwaMatches) {
        const year = parseInt(m[1], 10);
        if (year < CURRENT_REIWA_YEAR) {
            if (DEBUG) console.log(`  [OLD YEAR] 令和${year}年 を検出`);
            return true;
        }
    }

    // 平成n年 はすべて過去
    if (/平成\d+年/.test(text)) {
        if (DEBUG) console.log(`  [OLD YEAR] 平成年 を検出`);
        return true;
    }

    // 「公募は締め切り」「募集終了」なども除外
    if (/公募は締め切り|募集終了|受付終了/.test(text)) {
        if (DEBUG) console.log(`  [OLD YEAR] 公募終了文言 を検出`);
        return true;
    }

    return false;
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
    const prefectureField = program.prefecture || '';

    if (DEBUG) {
        console.log(`\n[SCORE DEBUG] === ${program.id}: ${programName.substring(0, 40)} ===`);
        console.log(`  prefecture field: "${prefectureField}" | company.prefecture: "${company.prefecture}"`);
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

    // --- 1-B: 過去年度テキストチェック（名称・本文すべてをスキャン）---
    if (
        containsOldYear(programName) ||
        containsOldYear(benefitText) ||
        containsOldYear(eligibilityText)
    ) {
        if (DEBUG) console.log(`  [REJECT] 過去年度テキスト検知`);
        return { score: 0, reasons: ['過去年度の情報のため対象外です'] };
    }

    // --- 1-C: 地域チェック（堅牢化版） ---
    // prefecture フィールドから都道府県を全て抽出
    const targetPrefectures = extractPrefectures(prefectureField);
    const isNational = prefectureField.includes('全国') || targetPrefectures.length === 0;

    if (!isNational) {
        // 地域限定案件: 抽出した都道府県リストに company.prefecture が含まれているか確認
        if (!targetPrefectures.includes(company.prefecture)) {
            if (DEBUG) console.log(`  [REJECT] 地域不一致: 対象[${targetPrefectures.join(',')}] vs ユーザー[${company.prefecture}]`);
            return {
                score: 0,
                reasons: [`${targetPrefectures.join('・') || '特定地域'}限定の制度のため、所在地が一致しません`]
            };
        }
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
        reasons.push(`${targetPrefectures.join('・')}の制度です（地域一致）`);
    }

    // 目的マッチボーナス
    if (purposeTags.length === 0) {
        score += 5;
        reasons.push('幅広い目的に対応した汎用制度です');
    } else {
        const matchingPurposes = companyPurposes.filter(p => purposeTags.includes(p));
        const nicheTargets = ['it_implementation', 'productivity', 'new_product', 'startup', 'branding'];
        const nicheCount = matchingPurposes.filter(p => nicheTargets.includes(p)).length;
        const purposeScore = 15 + (nicheCount * 10);
        score += Math.min(purposeScore, 35);
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

// Helper: 従業員数から規模タグへ変換
function getCompanyScale(count) {
    const n = parseInt(count, 10);
    if (!n || n <= 5) return 'micro';
    if (n <= 20) return 'small';
    if (n <= 100) return 'medium';
    return 'large';
}

// Helper: 業種タグの日本語変換
function translateIndustry(tag) {
    const map = {
        manufacturing: '製造業', retail: '小売業', service: 'サービス業',
        it: '情報通信業', restaurant: '飲食業', construction: '建設業',
        agriculture: '農業', other: 'その他'
    };
    return map[tag] || tag;
}

// Helper: 目的タグの日本語変換
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
