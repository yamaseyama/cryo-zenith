/**
 * JグランツAPI連携 - 補助金データ自動取得スクリプト (並列取得・中間保存・募集予定対応版)
 * 
 * 使い方: node fetch_jgrants.js
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://api.jgrants-portal.go.jp/exp/v1/public';

// 業界マッピング
const INDUSTRY_MAP = {
    '製造業': 'manufacturing', '小売業': 'retail', '卸売業': 'retail', '情報通信業': 'IT',
    'サービス業': 'service', 'サービス業（他に分類されないもの）': 'service',
    '宿泊業': 'restaurant', '飲食サービス業': 'restaurant', '宿泊業、飲食サービス業': 'restaurant',
    '建設業': 'construction', '農業': 'agriculture', '医療': 'medical', '不動産業': 'real_estate',
    '運輸業': 'logistics', '教育': 'education', '金融業': 'finance', 'その他': 'other'
};

// 目的マッピング（フロント側の定義に完全一致させる）
const PURPOSE_MAP = {
    '設備投資がしたい': 'productivity', '新たな事業を始めたい': 'new_product',
    '新たな製品やサービスを作りたい': 'new_product', '研究開発を行いたい': 'new_product',
    'ブランディング・PR活動をしたい': 'marketing', '海外へ展開したい': 'marketing',
    '販路を拡大したい': 'marketing', 'IT化・DXを図りたい': 'it_implementation',
    '人材育成を行いたい': 'hiring', '雇用・職場環境を改善したい': 'hiring',
    '創業・起業をしたい': 'startup'
};

function mapEmployeeRange(text) {
    if (!text || text === '従業員数の制約なし') return ['all'];
    const tags = [];
    const num = parseInt(text);
    if (isNaN(num)) return ['all'];
    if (num <= 5) tags.push('micro');
    if (num <= 20) tags.push('micro', 'small');
    if (num <= 300) tags.push('micro', 'small', 'medium');
    if (num > 300) tags.push('all');
    return [...new Set(tags)];
}

function mapIndustryTags(industryText) {
    if (!industryText) return ['all'];
    const tags = new Set();
    const parts = industryText.split(' / ').map(s => s.trim());
    if (parts.length >= 10) return ['all'];
    for (const part of parts) {
        const mapped = INDUSTRY_MAP[part];
        if (mapped) tags.add(mapped);
    }
    return tags.size > 0 ? [...tags] : ['all'];
}

function mapPurposeTags(purposeText) {
    if (!purposeText) return ['productivity'];
    const tags = new Set();
    const parts = purposeText.split(' / ').map(s => s.trim());
    for (const part of parts) {
        const mapped = PURPOSE_MAP[part];
        if (mapped) tags.add(mapped);
    }
    return tags.size > 0 ? [...tags] : ['productivity'];
}

function normalizePrefecture(area) {
    if (!area || area === '全国') return '全国';
    return area;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJGrants() {
    console.log('\n🔄 JグランツAPIから補助金データを取得中 (並列取得・中間保存有効)...');
    console.log('========================================');

    const keywords = ['補助金', '助成金', '支援', '公募', '中小企業', '創業', 'IT導入', '事業再構築'];
    const allSubsidies = new Map();

    // acceptance=1（公募中）と acceptance=0（募集予定）の両方を取得
    const acceptanceParams = [
        { value: 1, status: 'open', label: '公募中' },
        { value: 0, status: 'upcoming', label: '募集予定' }
    ];

    for (const keyword of keywords) {
        for (const acceptance of acceptanceParams) {
            console.log(`📡 キーワード「${keyword}」で検索中... (${acceptance.label})`);
            const url = `${BASE_URL}/subsidies?keyword=${encodeURIComponent(keyword)}&sort=created_date&order=DESC&acceptance=${acceptance.value}&limit=100`;
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    console.warn(`  ⚠️ 検索エラー: HTTP ${response.status} (keyword: ${keyword}, acceptance: ${acceptance.label})`);
                    continue;
                }
                const data = await response.json();
                // acceptance ステータスをアイテムに付与して保存（open を明示的に優先）
                (data.result || []).forEach(item => {
                    const existing = allSubsidies.get(item.id);
                    if (!existing || existing._acceptanceStatus !== 'open') {
                        allSubsidies.set(item.id, { ...item, _acceptanceStatus: acceptance.status });
                    }
                });
            } catch (err) {
                console.error(`  ❌ 検索エラー: ${err.message}`);
            }
            await sleep(300);
        }
    }

    const subsidyArray = Array.from(allSubsidies.entries());
    const totalToFetch = subsidyArray.length;
    console.log(`\n📊 取得対象: ${totalToFetch}件`);

    const fetchedPrograms = [];
    const fetchedIds = new Set();
    let processed = 0;
    let fetchErrorCount = 0;
    const CONCURRENCY = 5;

    for (let i = 0; i < subsidyArray.length; i += CONCURRENCY) {
        const batch = subsidyArray.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async ([id, summaryItem]) => {
            try {
                const response = await fetch(`${BASE_URL}/subsidies/id/${id}`);
                if (!response.ok) return;
                const data = await response.json();
                const detail = Array.isArray(data.result) ? data.result[0] : data.result;
                if (!detail) return;

                const internalId = `jg-${detail.name || id}`;
                // 検索時に付与した acceptance ステータスを使用（open or upcoming）
                const status = summaryItem._acceptanceStatus || 'open';

                fetchedPrograms.push({
                    id: internalId,
                    name: detail.title,
                    type: detail.title.includes('助成') ? 'grant' : 'subsidy',
                    scope: detail.target_area_search === '全国' ? 'national' : 'prefecture',
                    prefecture: normalizePrefecture(detail.target_area_search),
                    industry_tags: mapIndustryTags(detail.industry),
                    purpose_tags: mapPurposeTags(detail.use_purpose),
                    employee_range_tags: mapEmployeeRange(detail.target_number_of_employees),
                    eligibility_text: detail.subsidy_catch_phrase || detail.title,
                    benefit_text: detail.subsidy_rate || '詳細は公式ページをご確認ください',
                    amount_text: detail.subsidy_max_limit ? `上限${(detail.subsidy_max_limit / 10000).toLocaleString()}万円` : '詳細は公式ページをご確認ください',
                    official_url: detail.front_subsidy_detail_page_url || `https://www.jgrants-portal.go.jp/subsidy/${id}`,
                    application_status: status,
                    is_active: 1,
                    last_verified_at: new Date().toISOString(),
                    notes: `JグランツID: ${detail.name}`
                });
                fetchedIds.add(internalId);
            } catch (err) {
                console.warn(`  ⚠️ 詳細取得失敗 (id: ${id}): ${err.message}`);
                fetchErrorCount++;
            }
        }));

        processed += batch.length;
        if (processed % 50 < CONCURRENCY) console.log(`  ✅ [${processed}/${totalToFetch}] 取得中...`);
        
        if (fetchedPrograms.length > 0 && Math.floor(fetchedPrograms.length / 100) > Math.floor((fetchedPrograms.length - CONCURRENCY) / 100)) {
            saveProgress(fetchedPrograms, fetchedIds, false);
        }
        await sleep(500);
    }

    saveProgress(fetchedPrograms, fetchedIds, true);
    console.log('\n========================================');
    console.log(`  取得サマリー`);
    console.log(`  取得対象:   ${totalToFetch} 件`);
    console.log(`  取得成功:   ${fetchedPrograms.length} 件`);
    console.log(`  取得失敗:   ${fetchErrorCount} 件`);
    console.log('========================================');
    console.log('\n✅ すべての処理が完了しました。');
}

function saveProgress(fetchedPrograms, fetchedIds, isFinal) {
    const outputPath = path.join(__dirname, 'data', 'programs.json');
    let finalPrograms = [];
    if (fs.existsSync(outputPath)) {
        const existingData = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
        const manual = existingData.filter(p => !p.id.startsWith('jg-'));
        const oldJgrants = existingData.filter(p => p.id.startsWith('jg-') && !fetchedIds.has(p.id));

        if (isFinal) {
            // APIから消えた（募集終了した）Jグランツデータは除外する（手動追加データは残す）
            console.log(`  🗑️  APIから消えた補助金を除外: ${oldJgrants.length} 件`);
            finalPrograms = [...manual, ...fetchedPrograms];
        } else {
            finalPrograms = [...manual, ...fetchedPrograms, ...oldJgrants];
        }
    } else {
        finalPrograms = fetchedPrograms;
    }
    fs.writeFileSync(outputPath, JSON.stringify(finalPrograms, null, 4), 'utf-8');
    if (isFinal) console.log(`✨ 全${finalPrograms.length}件保存完了。`);
    else console.log(`💾 中間保存完了 (${fetchedPrograms.length}件)`);
}

fetchJGrants().catch(err => {
    console.error('致命的エラー:', err);
    process.exit(1);
});
