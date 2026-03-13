require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function syncPrograms() {
    const jsonPath = path.join(__dirname, 'data', 'programs.json');
    if (!fs.existsSync(jsonPath)) {
        console.error('❌ data/programs.json が見つかりません。');
        return;
    }

    const programs = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    console.log(`🚀 ${programs.length}件のデータを Supabase に同期します...`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. 既存データを物理削除（または論理削除でも良いが、今回は完全刷新のご指示なので物理削除）
        console.log('🧹 既存の全データを削除中...');
        await client.query('DELETE FROM subsidy_programs');

        // 2. 新規投入
        console.log('📥 データをインポート中...');
        const insertQuery = `
            INSERT INTO subsidy_programs (
                id, name, type, scope, prefecture,
                industry_tags, purpose_tags, employee_range_tags,
                eligibility_text, benefit_text, amount_text,
                official_url, application_status, is_active, last_verified_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        `;

        for (const p of programs) {
            await client.query(insertQuery, [
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
                p.application_status,
                p.is_active || 1,
                p.last_verified_at || new Date().toISOString()
            ]);
        }

        await client.query('COMMIT');
        console.log('✅ 同期が正常に完了しました。');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ 同期エラー:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

syncPrograms();
