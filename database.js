require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

const initDB = async () => {
    // 🔴 M-5: 本番環境での誤実行を防ぐガード（NODE_ENV=production では即終了）
    if (process.env.NODE_ENV === 'production') {
        console.error('❌ [FATAL] db:reset は本番環境では実行できません。');
        console.error('   開発環境 (NODE_ENV=development) でのみ実行可能です。');
        console.error('   本番 DB を初期化する場合は Supabase のダッシュボードから直接操作してください。');
        process.exit(1);
    }

    try {
        await client.connect();
        console.log('データベース接続完了 (PostgreSQL)');

        // テーブル作成
        await client.query(`
            CREATE TABLE IF NOT EXISTS subsidy_programs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                scope TEXT NOT NULL,
                prefecture TEXT,
                industry_tags TEXT,
                purpose_tags TEXT,
                employee_range_tags TEXT,
                eligibility_text TEXT,
                benefit_text TEXT,
                amount_text TEXT,
                official_url TEXT,
                application_status TEXT,
                last_verified_at TEXT,
                freshness_status TEXT,
                source_url TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS feedback (
                id SERIAL PRIMARY KEY,
                diagnosis_id TEXT,
                program_id TEXT,
                user_rating INTEGER,
                usefulness TEXT,
                comments TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS leads (
                id SERIAL PRIMARY KEY,
                company_name TEXT,
                contact_person TEXT,
                phone TEXT,
                email TEXT,
                prefecture TEXT,
                city TEXT,
                industry TEXT,
                employees_count INTEGER,
                sales_amount TEXT,
                purposes TEXT,
                ip_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 商談予約テーブル
        await client.query(`
            CREATE TABLE IF NOT EXISTS consultations (
                id SERIAL PRIMARY KEY,
                company_name TEXT,
                contact_person TEXT,
                phone TEXT,
                email TEXT,
                preferred_date1 TEXT,
                preferred_date2 TEXT,
                preferred_date3 TEXT,
                consultation_note TEXT,
                matched_programs TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('テーブル作成完了');

        // 既存データの削除（開発リセット用）
        await client.query(`DELETE FROM subsidy_programs`);

        // シードデータ投入
        const programs = [
            {
                id: 'sub-001',
                name: 'ものづくり補助金',
                type: 'subsidy',
                scope: 'national',
                prefecture: '全国',
                industry_tags: JSON.stringify(['manufacturing', 'retail', 'service', 'IT']),
                purpose_tags: JSON.stringify(['productivity', 'new_product', 'business_model']),
                employee_range_tags: JSON.stringify(['micro', 'small', 'medium']),
                eligibility_text: '革新的なサービス開発・試作開発・生産プロセスの改善を行う中小企業・小規模事業者',
                benefit_text: '設備投資資金の補助',
                amount_text: '通常枠：100万円～1,250万円（補助率 1/2 or 2/3）',
                official_url: 'https://portal.monodukuri-hojo.jp/',
                application_status: 'open',
                freshness_status: 'fresh',
                last_verified_at: new Date().toISOString()
            },
            {
                id: 'sub-002',
                name: 'IT導入補助金2026',
                type: 'subsidy',
                scope: 'national',
                prefecture: '全国',
                industry_tags: JSON.stringify(['all']),
                purpose_tags: JSON.stringify(['it_implementation', 'efficiency', 'remote_work']),
                employee_range_tags: JSON.stringify(['micro', 'small', 'medium']),
                eligibility_text: '自社の課題やニーズに合ったITツールを導入する中小企業・小規模事業者',
                benefit_text: 'ソフトウェア購入費、クラウド利用料、導入関連費',
                amount_text: '最大450万円（補助率 1/2など枠による）',
                official_url: 'https://it-shien.smrj.go.jp/',
                application_status: 'open',
                freshness_status: 'fresh',
                last_verified_at: new Date().toISOString()
            },
            {
                id: 'gra-001',
                name: 'キャリアアップ助成金（正社員化コース）',
                type: 'grant',
                scope: 'national',
                prefecture: '全国',
                industry_tags: JSON.stringify(['all']),
                purpose_tags: JSON.stringify(['hiring', 'career_up']),
                employee_range_tags: JSON.stringify(['all']),
                eligibility_text: '有期雇用労働者等を正規雇用労働者等に転換または直接雇用した場合',
                benefit_text: '1人あたり最大80万円',
                amount_text: '1人あたり57万円〜80万円（生産性要件による）',
                official_url: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/koyou/kyufukin/all_hanamichi01.html',
                application_status: 'open',
                freshness_status: 'fresh',
                last_verified_at: new Date().toISOString()
            },
            {
                id: 'sub-003',
                name: '小規模事業者持続化補助金',
                type: 'subsidy',
                scope: 'national',
                prefecture: '全国',
                industry_tags: JSON.stringify(['manufacturing', 'retail', 'service', 'restaurant']),
                purpose_tags: JSON.stringify(['marketing', 'sales_expansion', 'branding']),
                employee_range_tags: JSON.stringify(['micro']),
                eligibility_text: '小規模事業者が経営計画を作成して取り組む販路開拓の取組',
                benefit_text: 'チラシ作成、ウェブサイト改修、店舗改装など',
                amount_text: '最大200万円（通常枠50万円）',
                official_url: 'https://r3.jizokukahojokin.info/',
                application_status: 'upcoming',
                freshness_status: 'fresh',
                last_verified_at: new Date().toISOString()
            },
            {
                id: 'sub-tokyo-001',
                name: '東京都 創業助成事業',
                type: 'subsidy',
                scope: 'prefecture',
                prefecture: '東京都',
                industry_tags: JSON.stringify(['all']),
                purpose_tags: JSON.stringify(['startup', 'hiring', 'office_rent']),
                employee_range_tags: JSON.stringify(['micro', 'small']),
                eligibility_text: '都内で創業予定または創業から5年未満の中小企業者等',
                benefit_text: '賃借料、広告費、従業員人件費など',
                amount_text: '上限300万円（補助率 2/3）',
                official_url: 'https://startup-station.jp/m2/services/josei/',
                application_status: 'open',
                freshness_status: 'fresh',
                last_verified_at: new Date().toISOString()
            },
            {
                id: 'sub-osaka-001',
                name: '大阪府 DX推進補助金',
                type: 'subsidy',
                scope: 'prefecture',
                prefecture: '大阪府',
                industry_tags: JSON.stringify(['manufacturing']),
                purpose_tags: JSON.stringify(['it_implementation', 'productivity']),
                employee_range_tags: JSON.stringify(['small', 'medium']),
                eligibility_text: '大阪府内に拠点を置く製造業で、DXを推進する事業者',
                benefit_text: 'システム導入費、研修費',
                amount_text: '上限200万円',
                official_url: 'https://www.pref.osaka.lg.jp/',
                application_status: 'open',
                freshness_status: 'warning',
                last_verified_at: '2025-10-01T00:00:00.000Z'
            }
        ];

        const insertQuery = `
            INSERT INTO subsidy_programs (
                id, name, type, scope, prefecture, industry_tags,
                purpose_tags, employee_range_tags, eligibility_text,
                benefit_text, amount_text, official_url,
                application_status, freshness_status, last_verified_at, source_url
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
            )
        `;

        for (const program of programs) {
            await client.query(insertQuery, [
                program.id, program.name, program.type, program.scope, program.prefecture,
                program.industry_tags, program.purpose_tags, program.employee_range_tags,
                program.eligibility_text, program.benefit_text, program.amount_text,
                program.official_url, program.application_status, program.freshness_status,
                program.last_verified_at, program.official_url
            ]);
        }

        console.log(`${programs.length}件のデータを投入しました。`);
        console.log('データベース初期化完了 (PostgreSQL)');

    } catch (err) {
        console.error('データベース初期化エラー:', err);
    } finally {
        await client.end();
    }
};

initDB();
