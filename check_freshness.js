/**
 * check_freshness.js - 補助金データ鮮度チェック & 過去年度データ物理削除
 *
 * 修正ポイント:
 * 1. 「現在年度（令和8/2026）以降」以外の年度表記を含むデータを全て削除
 * 2. 過去年度データを stale に更新するのではなく DB から物理DELETE
 * 3. DELETE した件数と対象プログラム名をログ出力
 * 4. eligibility_text も年度チェック対象に追加（name だけでは漏れがある）
 * 5. acceptance=0（募集予定）由来のゴミデータ対策
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
    // 方針: 年度表記を含むデータのうち「現在年度（令和8/2026）以降」でないものを削除
    // - 令和8, 2026 → 現在年度 → 残す
    // - 令和9以降, 2027以降 → 未来年度 → 残す
    // - 令和7以前, 2025以前 → 過去年度 → 削除
    // - 平成 → 全て削除
    // - 年度表記なし → 残す
    const CURRENT_REIWA = 8;   // 令和8年 = 2026年
    const CURRENT_AD = 2026;

    // 全角数字→半角変換
    function normalizeFullWidth(text) {
        return text.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    }

    // 過去年度を検知する正規表現（半角変換後のテキストに適用）
    const pastYearPatterns = [
        /令和[1-7]年/,        // 令和1〜7年
        /令和[一二三四五六七]年/, // 漢数字
        /R[1-7]年/,           // R表記
        /平成\d+年/,          // 平成全て
        /20[0-1]\d年/,        // 2000〜2019年
        /202[0-5]年/,         // 2020〜2025年
    ];

    function containsPastYear(text) {
        if (!text) return false;
        const normalized = normalizeFullWidth(text);
        return pastYearPatterns.some(regex => regex.test(normalized));
    }

    const deleteTargetIds = [];

    for (const row of result.rows) {
        const fields = [row.name || '', row.benefit_text || '', row.eligibility_text || ''];
        const hasPastYear = fields.some(f => containsPastYear(f));

        if (hasPastYear) {
            console.log(`  🗑️  削除対象: [${row.id}] ${row.name}`);
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
