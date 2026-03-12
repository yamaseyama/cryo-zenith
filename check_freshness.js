/**
 * check_freshness.js - 補助金データ鮮度チェック & 自動ステータス更新
 *
 * 修正ポイント（2026-03-13 根本調査後の改訂）:
 * 1. 令和6年度など現在年度の判定が漏れていた正規表現を修正
 *    → 令和4〜7年度、2022〜2025年度をすべてカバー
 * 2. DB UPDATE を await で確実に待機（非同期漏れを防止）
 * 3. UPDATE 結果（rowCount）をログ出力して成否を確認
 * 4. application_status が既に stale/expired のものはスキップしてパフォーマンス改善
 * 5. eligibility_text も年度チェック対象に追加（name だけでは漏れがある）
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

    // 修正: eligibility_text も取得対象に追加
    const result = await pool.query(
        `SELECT id, name, benefit_text, eligibility_text, last_verified_at, application_status
         FROM subsidy_programs
         WHERE is_active = 1
         AND application_status NOT IN ('stale', 'expired')` // 既に除外済みはスキップ
    );

    console.log(`  対象レコード数: ${result.rows.length} 件（既にstale/expiredのものは除外済み）`);
    console.log('');

    const now = new Date();
    let staleCount = 0;
    let expiredCount = 0;
    let errorCount = 0;

    for (const row of result.rows) {
        let needsUpdate = false;
        let newStatus = row.application_status;
        let reason = '';

        // =============================================
        // チェック1: 過去年度の文字列検知
        // =============================================
        // 修正: 令和6年度(2024年度) が漏れていた。R6 や 令和6 もカバー
        // 対象: 令和4, 5, 6, 7年度 = 2022, 2023, 2024, 2025年度
        const pastYearRegex = /令和[4-7]年度|令和[四五六七]年度|R[4-7]年度|202[2-5]年度|平成[0-9]+年度/;
        const nameMatch = pastYearRegex.test(row.name || '');
        const benefitMatch = pastYearRegex.test(row.benefit_text || '');
        const eligibilityMatch = pastYearRegex.test(row.eligibility_text || '');

        if (nameMatch || benefitMatch || eligibilityMatch) {
            newStatus = 'stale';
            needsUpdate = true;
            reason = `過去年度データ検知 (name:${nameMatch}, benefit:${benefitMatch}, eligibility:${eligibilityMatch})`;
        }

        // =============================================
        // チェック2: 更新処理
        // =============================================
        if (needsUpdate && row.application_status !== newStatus) {
            console.log(`  🔄 更新対象: [${row.id}] ${row.name}`);
            console.log(`     理由: ${reason}`);
            console.log(`     変更: ${row.application_status} -> ${newStatus}`);

            try {
                // 修正: await を確実に付けてDB更新の完了を待つ
                const updateResult = await pool.query(
                    `UPDATE subsidy_programs
                     SET application_status = $1,
                         last_verified_at   = $2
                     WHERE id = $3`,
                    [newStatus, now.toISOString(), row.id]
                );
                // rowCount で更新件数を確認
                console.log(`     ✅ DB UPDATE 成功 (rowCount: ${updateResult.rowCount})`);

                if (newStatus === 'stale') staleCount++;
                else if (newStatus === 'expired') expiredCount++;
            } catch (err) {
                console.error(`     ❌ DB UPDATE 失敗 (id: ${row.id}):`, err.message);
                errorCount++;
            }
        }
    }

    console.log('');
    console.log('========================================');
    console.log(`  チェック完了:  ${result.rows.length} 件中`);
    console.log(`  stale に更新:  ${staleCount} 件`);
    console.log(`  expired に更新: ${expiredCount} 件`);
    console.log(`  エラー:         ${errorCount} 件`);
    console.log('========================================');
    console.log('');
    console.log('💡 ヒント: scoring.js 側でも stale/expired を除外しています。');
    console.log('   今後の確認: node check_freshness.js を定期実行してください。');

    await pool.end();
}

checkFreshness().catch(err => {
    console.error('チェックエラー:', err);
    process.exit(1);
});
