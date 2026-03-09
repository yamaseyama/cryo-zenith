/**
 * Scoring Logic
 * 
 * fit_score = 
 * (地域一致 × 25) 
 * + (業種一致 × 20) 
 * + (目的一致 × 20) 
 * + (規模一致 × 15) 
 * + (embedding類似度 × 10) -> MVPでは一旦キーワード/タグから簡易計算 or 0
 * + (鮮度補正 × 5) 
 * + (フィードバック補正 × 5)
 * 
 * 合計 100点
 */

/**
 * calculateScore
 * @param {Object} companyStr - 企業情報 (リクエストボディ)
 * @param {Object} program - 制度データ (DB行)
 * @returns {Object} { score: number, reasons: string[] }
 */
function calculateScore(company, program) {
    let score = 0;
    const reasons = [];

    // 1. 地域一致 (25点)
    let regionScore = 0;
    if (program.scope === 'national') {
        regionScore = 25;
        reasons.push('全国対象の制度です');
    } else if (program.scope === 'prefecture' && program.prefecture === company.prefecture) {
        regionScore = 25;
        reasons.push(`${program.prefecture}の制度です`);
    }
    score += regionScore;

    // 2. 業種一致 (20点)
    let industryScore = 0;
    // program.industry_tags はパース済み配列と想定
    // 'all' が含まれているか、company.industry が含まれているか
    if (program.industry_tags.includes('all') || program.industry_tags.includes(company.industry)) {
        industryScore = 20;
        reasons.push('業種が対象範囲内です');
    }
    score += industryScore;

    // 3. 目的一致 (20点)
    let purposeScore = 0;
    // company.purposes は配列
    if (program.purpose_tags && company.purposes && Array.isArray(company.purposes)) {
        const matches = company.purposes.filter(p => program.purpose_tags.includes(p));
        if (matches.length > 0) {
            // 1つでも一致すればOKとするか、割合で出すか。仕様では「目的一致」なので20点満点を与える運用にする
            purposeScore = 20;
            reasons.push(`目的(${matches.map(m => translatePurpose(m)).join(', ')})が合致します`);
        }
    }
    score += purposeScore;

    // 4. 規模一致 (15点)
    let scaleScore = 0;
    // 従業員数から規模タグを推定
    const companyScale = getCompanyScale(company.employees_count);
    if (program.employee_range_tags.includes('all') || program.employee_range_tags.includes(companyScale)) {
        scaleScore = 15;
        reasons.push('企業規模の条件を満たしています');
    }
    score += scaleScore;

    // 5. Embedding類似度 (10点) - MVPでは後回し/プレースホルダー
    // ここでは簡易的に、テキストキーワードの一致で代用実装しておく
    // 企業が入力した「今やりたいこと」などのテキストがあればそれを使うが、今回は選択式メインなので0点スタート
    // ※今回は実装しないが、拡張ポイントとして残す
    score += 0;

    // 6. 鮮度補正 (5点)
    const daysSinceCheck = (new Date() - new Date(program.last_verified_at)) / (1000 * 60 * 60 * 24);
    if (program.freshness_status === 'expired_suspected') {
        score -= 5;
    } else if (daysSinceCheck <= 90) {
        score += 5;
        reasons.push('情報が最新です');
    } else if (daysSinceCheck <= 180) {
        score += 3;
    } else {
        score += 1;
    }

    // 7. フィードバック補正 (5点) - MVPでは実装簡略化のため一旦省略、またはDBから平均レート取得
    // ここでは 0 とする
    score += 0;

    // 8. Application Status補正 (減点/加点)
    if (program.application_status === 'open') {
        score += 5;
        reasons.push('現在公募中です');
    } else if (program.application_status === 'upcoming') {
        score += 2;
        reasons.push('今後公募開始予定です');
    } else if (program.application_status === 'closed') {
        score -= 10;
        reasons.push('現在公募期間外の可能性があります');
    }

    return { score, reasons };
}

// Helper: 従業員数から規模タグへ変換
function getCompanyScale(count) {
    if (!count) return 'micro'; // デフォルト
    // 簡易定義
    if (count <= 5) return 'micro'; // 小規模
    if (count <= 20) return 'small'; // 中小
    if (count <= 100) return 'medium'; // 中堅
    return 'large'; // 大企業
}

// Helper: 目的タグの日本語変換 (表示用)
function translatePurpose(tag) {
    const map = {
        'productivity': '生産性向上',
        'new_product': '新製品開発',
        'business_model': 'ビジネスモデル変革',
        'it_implementation': 'IT導入',
        'efficiency': '業務効率化',
        'remote_work': 'テレワーク',
        'hiring': '人材採用',
        'career_up': 'キャリアアップ',
        'marketing': '販路開拓',
        'sales_expansion': '売上拡大',
        'branding': 'ブランディング',
        'startup': '創業',
        'office_rent': 'オフィス賃料'
    };
    return map[tag] || tag;
}

module.exports = { calculateScore };
