/**
 * scoring.js - 補助金マッチングスコアリングロジック
 *
 * 修正ポイント（2026-03-13 重大バグ修正版）:
 * 1. 足切り判定（地域・目的・鮮度）を関数の冒頭に集約 → 条件一致で即 return 0
 * 2. 上限 100点 を最後に Math.min(score, 100) で制御
 * 3. 地域判定: 「全国」文字列チェック + 都道府県の完全一致のみ通過
 * 4. 鮮度判定: name / benefit_text に旧年度文字列があれば即除外
 */

const DEBUG = process.env.SCORING_DEBUG === 'true';

/**
 * 安全に JSON をパースして配列を返す
 * DB から文字列で来る場合も、すでに配列の場合も両方対応
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
 * @param {Object} company - 企業情報（リクエストボディ）
 * @param {Object} program - 制度データ（DB 行 or server.js でパース済み）
 * @returns {Object} { score: number, reasons: string[] }
 */
function calculateScore(company, program) {
    // データの安全なパース
    const industryTags    = safeParseArray(program.industry_tags);
    const purposeTags     = safeParseArray(program.purpose_tags);
    const employeeRangeTags = safeParseArray(program.employee_range_tags);
    const companyPurposes = safeParseArray(company.purposes);

    const programName    = program.name || '';
    const benefitText    = program.benefit_text || '';
    const eligibilityText = program.eligibility_text || '';
    const status         = (program.application_status || '').toLowerCase();
    const freshness      = (program.freshness_status || '').toLowerCase();

    if (DEBUG) {
        console.log(`\n[SCORE DEBUG] === ${program.id}: ${programName} ===`);
        console.log(`  scope: "${program.scope}" | program.prefecture: "${program.prefecture}" | company.prefecture: "${company.prefecture}"`);
        console.log(`  industryTags: ${JSON.stringify(industryTags)} | company.industry: "${company.industry}"`);
        console.log(`  purposeTags: ${JSON.stringify(purposeTags)} | companyPurposes: ${JSON.stringify(companyPurposes)}`);
        console.log(`  application_status: "${status}" | freshness_status: "${freshness}"`);
    }

    // ===========================================================
    // ★ STEP 1: 足切り判定ブロック（ここを全部クリアしないと即0点）
    // ===========================================================

    // --- 1-A: 鮮度チェック（過去年度・公募終了）---
    // application_status が stale / expired / closed の場合
    if (status === 'stale' || status === 'expired' || status === 'closed') {
        if (DEBUG) console.log(`  [REJECT] ステータス不合格: ${status}`);
        return { score: 0, reasons: ['公募が終了または情報が古いため対象外です'] };
    }
    // freshness_status が expired_suspected の場合
    if (freshness === 'expired_suspected') {
        if (DEBUG) console.log(`  [REJECT] 鮮度不合格: ${freshness}`);
        return { score: 0, reasons: ['情報の鮮度が確認できないため対象外です'] };
    }
    // タイトル・本文に旧年度文字列が含まれる場合
    const pastYearRegex = /令和[4-6]年|R[4-6]年|202[2-4]年度|公募は締め切り/;
    if (
        pastYearRegex.test(programName) ||
        pastYearRegex.test(benefitText) ||
        pastYearRegex.test(eligibilityText)
    ) {
        if (DEBUG) console.log(`  [REJECT] 旧年度テキスト検知`);
        return { score: 0, reasons: ['過去年度の情報のため対象外です（令和4〜6年度）'] };
    }

    // --- 1-B: 地域チェック ---
    // program.prefecture に「全国」が含まれる場合は通過
    // そうでない場合は company.prefecture と完全一致のみ通過
    const programPrefecture = program.prefecture || '';
    if (!programPrefecture.includes('全国') && programPrefecture !== company.prefecture) {
        if (DEBUG) console.log(`  [REJECT] 地域不一致: "${programPrefecture}" vs "${company.prefecture}"`);
        return { score: 0, reasons: [`${programPrefecture || '特定地域'}限定の制度のため、所在地が一致しません`] };
    }

    // --- 1-C: 目的チェック ---
    // DB の purpose_tags が空の場合は汎用として通過、そうでなければ 1 つ以上の一致が必要
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

    // --- 1-D: 業種チェック ---
    // industry_tags が ['all'] や空でなければ、company.industry が含まれる必要がある
    if (
        industryTags.length > 0 &&
        !industryTags.includes('all') &&
        !industryTags.includes(company.industry)
    ) {
        if (DEBUG) console.log(`  [REJECT] 業種不一致: ${JSON.stringify(industryTags)} vs ${company.industry}`);
        return { score: 0, reasons: ['対象業種に該当しません'] };
    }

    // ===========================================================
    // ★ STEP 2: 加点ブロック（足切りをすべて通過した案件のみ到達）
    // ===========================================================
    let score = 0;
    const reasons = [];

    // 地域ボーナス
    if (programPrefecture.includes('全国')) {
        score += 15; // 全国案件は基礎点を抑える
        reasons.push('全国対象の制度です');
    } else {
        score += 25; // 都道府県一致案件は高評価
        reasons.push(`${programPrefecture}の制度です（地域一致）`);
    }

    // 目的マッチボーナス
    if (purposeTags.length === 0) {
        score += 5;
        reasons.push('幅広い目的に対応した汎用制度です');
    } else {
        const matchingPurposes = companyPurposes.filter(p => purposeTags.includes(p));
        const nicheTargets = ['it_implementation', 'productivity', 'new_product', 'startup', 'branding'];
        const nicheCount = matchingPurposes.filter(p => nicheTargets.includes(p)).length;
        const purposeScore = 15 + (nicheCount * 10); // ニッチ目的1つにつき+10
        score += Math.min(purposeScore, 35); // 目的加点の上限は35
        reasons.push(`目的(${matchingPurposes.map(m => translatePurpose(m)).join(', ')})が合致します`);
    }

    // 業種ボーナス
    if (industryTags.length === 0 || industryTags.includes('all')) {
        score += 8; // 汎用案件は低加点
        reasons.push('幅広い業種が対象の汎用的な制度です');
    } else {
        score += 25; // 業種特化案件は高ボーナス（上限抑制のため30→25に調整）
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
        'productivity': '生産性向上',
        'new_product': '新製品・新サービス開発',
        'business_model': 'ビジネスモデル変革',
        'it_implementation': 'IT導入・DX',
        'efficiency': '業務効率化',
        'remote_work': 'テレワーク',
        'hiring': '人材採用',
        'career_up': 'キャリアアップ',
        'marketing': '販路開拓',
        'sales_expansion': '売上拡大',
        'branding': 'ブランディング',
        'startup': '創業・起業',
        'office_rent': 'オフィス賃料'
    };
    return map[tag] || tag;
}

module.exports = { calculateScore };
