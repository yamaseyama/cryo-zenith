/**
 * check_freshness.js - 補助金データ鮮度チェック & 過去年度データ物理削除
 *
 * 修正ポイント:
 * 1. 令和4〜7年度、2022〜2025年度をすべてカバーする正規表現
 * 2. 過去年度データを stale に更新するのではなく DB から物理DELETE
 * 3. DELETE した件数と対象プログラム名をログ出力
 * 4. eligibility_text も年度チェック対象に追加（name だけでは漏れがある）
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function checkFreshness() {
    console.log('');
    console.log('🔍 補助金データ 鮮度・年度チェック（令和8年/2026年 基準）');
    console.log('========================================');
    console.log(`  チェック日時: ${new Date().toLocaleString('ja-JP')}`);
    console.log('========================================');
    console.log('');

    // jg- プレフィックスのレコードのみ対象（手動追加データを除外）
    const result = await pool.query(
        `SELECT id, name, benefit_text, eligibility_text, last_verified_at, application_status
         FROM subsidy_programs
         WHERE is_active = 1
         AND id LIKE 'jg-%'`
    );

    console.log(`  対象レコード数: ${result.rows.length} 件`);
    console.log('');
    let deleteCount = 0;
    let errorCount = 0;
    const deletedNames = [];

    // =============================================
    // チェック1: 過去年度の文字列検知 → 削除対象IDを収集
    // =============================================
    // 対象: 令和4, 5, 6, 7年度 = 2022, 2023, 2024, 2025年度
    const pastYearRegex = /令和[4-7]年度|令和[四五六七]年度|R[4-7]年度|202[2-5]年度|平成[0-9]+年度/;
    const deleteTargetIds = [];

    for (const row of result.rows) {
        const nameMatch = pastYearRegex.test(row.name || '');
        const benefitMatch = pastYearRegex.test(row.benefit_text || '');
        const eligibilityMatch = pastYearRegex.test(row.eligibility_text || '');

        if (nameMatch || benefitMatch || eligibilityMatch) {
            const reason = `過去年度データ検知 (name:${nameMatch}, benefit:${benefitMatch}, eligibility:${eligibilityMatch})`;
            console.log(`  🗑️  削除対象: [${row.id}] ${row.name}`);
            console.log(`     理由: ${reason}`);
            deleteTargetIds.push(row.id);
            deletedNames.push(row.name);
        }
    }

    // =============================================
    // チェック2: トランザクション内で一括物理DELETE
    // =============================================
    if (deleteTargetIds.length > 0) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const deleteResult = await client.query(
                `DELETE FROM subsidy_programs WHERE id = ANY($1::text[])`,
                [deleteTargetIds]
            );
            await client.query('COMMIT');
            deleteCount = deleteResult.rowCount;
            console.log(`\n  ✅ DB DELETE 成功 (rowCount: ${deleteCount})`);
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`  ❌ DB DELETE 失敗:`, err.message);
            errorCount = deleteTargetIds.length;
            deletedNames.length = 0;
        } finally {
            client.release();
        }
    }

    console.log('');
    console.log('========================================');
    console.log(`  チェック完了:  ${result.rows.length} 件中`);
    console.log(`  DELETE 件数:   ${deleteCount} 件`);
    if (deletedNames.length > 0) {
        console.log('  削除対象プログラム:');
        deletedNames.forEach(name => console.log(`    - ${name}`));
    }
    console.log(`  エラー:         ${errorCount} 件`);
    console.log('========================================');
    console.log('');
    console.log('💡 ヒント: 過去年度データは物理削除されました。');

    await pool.end();
}

checkFreshness().catch(err => {
    console.error('チェックエラー:', err);
    process.exit(1);
});
