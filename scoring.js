/**
 * scoring.js - 補助金マッチングスコアリングロジック
 *
 * 修正ポイント（2026-03-13 根本調査後の改訂）:
 * 1. purpose_tags が文字列 or 配列の両方に対応する安全なパース処理を追加
 * 2. scope が null/undefined の場合の failsafe を追加  
 * 3. 「全国」文字列と 'national' スコープの両方に対応
 * 4. 詳細なデバッグログを追加（判定前に変数を出力）
 * 5. ニッチ案件への重み付けボーナスを強화
 */

const DEBUG = process.env.SCORING_DEBUG === 'true'; // 環境変数でデバッグ切替

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
 * @param {Object} company - 企業情報 (リクエストボディ)
 * @param {Object} program - 制度データ (DB行、または server.js でパース済み)
 * @returns {Object} { score: number, reasons: string[] }
 */
function calculateScore(company, program) {
    let score = 0;
    const reasons = [];

    // --- データの安全なパース（文字列のまま来る場合も対応） ---
    const industryTags = safeParseArray(program.industry_tags);
    const purposeTags = safeParseArray(program.purpose_tags);
    const employeeRangeTags = safeParseArray(program.employee_range_tags);
    const companyPurposes = safeParseArray(company.purposes); // 企業側も念のためパース

    // =============================================
    // STEP 1: 地域の完全一致チェック（足切り Must要件）
    // =============================================
    // 修正: scope が undefined/null/空 の場合は通過させる（データ不備は除外しない）
    const scope = program.scope || 'national';

    if (DEBUG) {
        console.log(`\n[SCORE DEBUG] === ${program.id}: ${program.name} ===`);
        console.log(`  scope: "${scope}" | program.prefecture: "${program.prefecture}" | company.prefecture: "${company.prefecture}"`);
        console.log(`  industryTags: ${JSON.stringify(industryTags)} | company.industry: "${company.industry}"`);
        console.log(`  purposeTags: ${JSON.stringify(purposeTags)} | companyPurposes: ${JSON.stringify(companyPurposes)}`);
        console.log(`  application_status: "${program.application_status}" | freshness_status: "${program.freshness_status}"`);
    }

    if (scope === 'prefecture') {
        if (!program.prefecture || program.prefecture !== company.prefecture) {
            if (DEBUG) console.log(`  [REJECT] 地域不一致: ${program.prefecture} vs ${company.prefecture}`);
            return { score: 0, reasons: [`${program.prefecture || '特定地域'}限定の制度のため、所在地が一致しません`] };
        }
        score += 25;
        reasons.push(`${program.prefecture}の制度です（地域一致）`);
    } else {
        // 'national' または scope 未設定 → 全国対象として通過（ただし加点抑制）
        score += 15; // 全国案件は基礎点を抑える
        reasons.push('全国対象の制度です');
    }

    // =============================================
    // STEP 2: 鮮度チェック（足切り）
    // =============================================
    // 修正: stale / expired は即座に 0 点で除外
    const status = (program.application_status || '').toLowerCase();
    const freshness = (program.freshness_status || '').toLowerCase();

    if (status === 'stale' || status === 'expired' || freshness === 'expired_suspected') {
        if (DEBUG) console.log(`  [REJECT] 鮮度不合格: status=${status}, freshness=${freshness}`);
        return { score: 0, reasons: ['情報が古いため対象外です（過去年度データ）'] };
    }

    // =============================================
    // STEP 3: 目的の必須フィルタリング（足切り Must要件）
    // =============================================
    if (purposeTags.length === 0) {
        // 目的タグがない補助金は汎用として通過させるが低加点
        score += 5;
        reasons.push('目的タグ未設定の制度です');
    } else if (companyPurposes.length === 0) {
        if (DEBUG) console.log(`  [REJECT] 企業の目的入力なし`);
        return { score: 0, reasons: ['目的が入力されていないため診断できません'] };
    } else {
        const matchingPurposes = companyPurposes.filter(p => purposeTags.includes(p));
        if (DEBUG) console.log(`  [DEBUG] matchingPurposes: ${JSON.stringify(matchingPurposes)}`);

        if (matchingPurposes.length === 0) {
            if (DEBUG) console.log(`  [REJECT] 目的不一致`);
            return { score: 0, reasons: ['選択された目的に合致する内容が含まれていません'] };
        }

        // ニッチな目的への重み付け: ニッチ目的は高加点
        const nicheTargets = ['it_implementation', 'productivity', 'new_product', 'startup', 'branding'];
        const nicheCount = matchingPurposes.filter(p => nicheTargets.includes(p)).length;
        const purposeScore = 15 + (nicheCount * 15); // ニッチ目的1つにつき +15
        score += Math.min(purposeScore, 40); // 上限40
        reasons.push(`目的(${matchingPurposes.map(m => translatePurpose(m)).join(', ')})が合致します`);
    }

    // =============================================
    // STEP 4: 業種一致と重み付け（パーソナライズ強化）
    // =============================================
    // 修正: 汎用案件('all')は加点抑制、特定業種一致は大幅ボーナス
    if (industryTags.length === 0 || industryTags.includes('all')) {
        score += 8; // 汎用案件は低加点
        reasons.push('幅広い業種が対象の汎用的な制度です');
    } else if (industryTags.includes(company.industry)) {
        score += 30; // 業種特化案件はハイボーナス
        reasons.push(`業種(${translateIndustry(company.industry)})に特化した支援です！`);
    } else {
        if (DEBUG) console.log(`  [REJECT] 業種不一致: ${JSON.stringify(industryTags)} vs ${company.industry}`);
        return { score: 0, reasons: ['対象業種に該当しません'] };
    }

    // =============================================
    // STEP 5: 企業規模チェック
    // =============================================
    const companyScale = getCompanyScale(company.employees_count);
    if (employeeRangeTags.length === 0 || employeeRangeTags.includes('all')) {
        score += 8;
        reasons.push('幅広い企業規模が対象です');
    } else if (employeeRangeTags.includes(companyScale)) {
        score += 12;
        reasons.push('企業規模の条件に合致しています');
    }
    // 規模が合わない場合は足切りせず0加点（ソフト除外）

    // =============================================
    // STEP 6: 公募ステータスと鮮度補正
    // =============================================
    if (status === 'open') {
        score += 10;
        reasons.push('現在公募中です（即応性あり）');
    } else if (status === 'upcoming') {
        score += 5;
        reasons.push('今後公募予定です（事前準備推奨）');
    } else if (status === 'closed') {
        // 明示的に closed のものは除外
        if (DEBUG) console.log(`  [REJECT] 公募終了: status=${status}`);
        return { score: 0, reasons: ['公募期間が終了しています'] };
    }
    // status が null/unknown の場合は通過させる（データ不備を許容）

    const daysSinceVerified = (new Date() - new Date(program.last_verified_at)) / (1000 * 60 * 60 * 24);
    if (daysSinceVerified <= 90) {
        score += 5;
        reasons.push('直近で確認された最新情報です');
    }

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

// Helper: 業種タグの日本語変換（デバッグ・表示用）
function translateIndustry(tag) {
    const map = {
        manufacturing: '製造業', retail: '小売業', service: 'サービス業',
        it: '情報通信業', restaurant: '飲食業', construction: '建設業',
        agriculture: '農業', other: 'その他'
    };
    return map[tag] || tag;
}

// Helper: 目的タグの日本語変換（表示用）
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
