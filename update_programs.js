/**
 * 補助金データベース一括更新スクリプト
 * 
 * 使い方:
 *   1. data/programs.json を編集して最新データを反映
 *   2. npm run db:update を実行
 * 
 * 動作:
 *   - JSONファイルを読み込み
 *   - 各プログラムをUPSERT（あれば更新、なければ挿入）
 *   - last_verified_at を現在時刻に自動更新
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function updatePrograms() {
    const dataPath = path.join(__dirname, 'data', 'programs.json');

    // JSONファイル読み込み
    if (!fs.existsSync(dataPath)) {
        console.error('❌ data/programs.json が見つかりません');
        process.exit(1);
    }

    const programs = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`📂 ${programs.length} 件のプログラムを読み込みました`);

    const upsertQuery = `
        INSERT INTO subsidy_programs (
            id, name, type, scope, prefecture, industry_tags,
            purpose_tags, employee_range_tags, eligibility_text,
            benefit_text, amount_text, official_url,
            application_status, freshness_status, last_verified_at,
            source_url, is_active
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
        )
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            type = EXCLUDED.type,
            scope = EXCLUDED.scope,
            prefecture = EXCLUDED.prefecture,
            industry_tags = EXCLUDED.industry_tags,
            purpose_tags = EXCLUDED.purpose_tags,
            employee_range_tags = EXCLUDED.employee_range_tags,
            eligibility_text = EXCLUDED.eligibility_text,
            benefit_text = EXCLUDED.benefit_text,
            amount_text = EXCLUDED.amount_text,
            official_url = EXCLUDED.official_url,
            application_status = EXCLUDED.application_status,
            freshness_status = EXCLUDED.freshness_status,
            last_verified_at = EXCLUDED.last_verified_at,
            is_active = EXCLUDED.is_active
    `;

    let updated = 0;
    let errors = 0;

    // Step 1: programs.json に存在しない jg- 始まりのレコードをDBから物理DELETE
    const jsonJgIds = programs.filter(p => p.id.startsWith('jg-')).map(p => p.id);
    if (jsonJgIds.length > 0) {
        const deleteResult = await pool.query(
            `DELETE FROM subsidy_programs
             WHERE id LIKE 'jg-%'
             AND id != ALL($1::text[])`,
            [jsonJgIds]
        );
        console.log(`🗑️  DBから物理DELETE: ${deleteResult.rowCount} 件 (jg- 始まりで programs.json に存在しないもの)`);
    } else {
        console.log('ℹ️  jg- 始まりのプログラムが programs.json に存在しないため、DB DELETE はスキップしました');
    }

    // Step 2: UPSERT（個別実行 — Supabaseプーラーのlong-running transaction制限を回避）
    for (const p of programs) {
        try {
            await pool.query(upsertQuery, [
                p.id,
                p.name,
                p.type,
                p.scope,
                p.prefecture,
                JSON.stringify(p.industry_tags),
                JSON.stringify(p.purpose_tags),
                JSON.stringify(p.employee_range_tags),
                p.eligibility_text,
                p.benefit_text,
                p.amount_text,
                p.official_url,
                p.application_status || 'open',
                'fresh',                          // 更新したので fresh に
                new Date().toISOString(),         // 現在時刻で更新
                p.official_url,                   // source_url
                p.is_active !== undefined ? p.is_active : 1
            ]);
            if (updated % 100 === 0) console.log(`  ✅ [${updated + 1}/${programs.length}] ${p.id}: ${p.name}`);
            updated++;
        } catch (err) {
            console.error(`  ❌ ${p.id}: ${err.message}`);
            errors++;
        }
    }

    console.log('');
    console.log('========================================');
    console.log(`  更新完了: ${updated} 件成功 / ${errors} 件エラー`);
    console.log(`  更新日時: ${new Date().toLocaleString('ja-JP')}`);
    console.log('========================================');

    await pool.end();
}

updatePrograms().catch(err => {
    console.error('更新エラー:', err);
    process.exit(1);
});
