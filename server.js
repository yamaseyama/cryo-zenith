require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // Client → Pool に変更（接続プール化）
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3000;

// ========================================
// Middleware（スペック強化対応）
// ========================================

// 「セキュリティ修正 H-2」: CORS を安全なホワイトリスト方式に変更
const ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    process.env.PRODUCTION_URL
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // curl や healthcheck など origin なしのリクエストは許可（Vercel内部連携等）
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error(`CORS: ${origin} is not allowed`), false);
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '1mb' })); // リクエストサイズ制限
app.use(express.static('public'));

// レートリミット: IP単位で15分あたり100リクエスト
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分
    max: 100,                  // 最大100リクエスト/IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'リクエスト数が上限を超えました。しばらく経ってから再度お試しください。' }
});
app.use('/api/', apiLimiter);

// ========================================
// Database Connection Pool（接続プール化）
// ========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,               // 最大接続数
    idleTimeoutMillis: 30000,  // アイドル接続のタイムアウト（30秒）
    connectionTimeoutMillis: 5000, // 接続タイムアウト（5秒）
});

pool.on('connect', () => {
    console.log('New client connected to PostgreSQL pool.');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
});

console.log('PostgreSQL connection pool initialized (max: 20 connections).');

// ========================================
// TTL付きキャッシュ（メモリ管理改善）
// ========================================
const CACHE_TTL_MS = 5 * 60 * 1000;   // 5分（修正: 30分では古い結果が返り続ける問題を解消）
const CACHE_MAX_SIZE = 500;            // 最大500件

class TTLCache {
    constructor(ttl, maxSize) {
        this.ttl = ttl;
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }
        return entry.data;
    }

    set(key, data) {
        // サイズ上限チェック（古いエントリから削除）
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    has(key) {
        return this.get(key) !== null;
    }

    get size() {
        return this.cache.size;
    }
}

const diagnosisCache = new TTLCache(CACHE_TTL_MS, CACHE_MAX_SIZE);

// ========================================
// API Routes
// ========================================
const { calculateScore } = require('./scoring');
const { generateExplanation, generateChatResponse } = require('./llm');

// Helper: キャッシュキー生成
function generateCacheKey(body) {
    const { prefecture, industry, employees_count, purposes } = body;
    const normalized = {
        prefecture,
        industry,
        employees_count,
        purposes: (purposes || []).sort()
    };
    return JSON.stringify(normalized);
}

// 全プログラム取得
app.get('/api/programs', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM subsidy_programs WHERE is_active = 1');
        const programs = result.rows;

        const processed = programs.map(p => ({
            ...p,
            industry_tags: JSON.parse(p.industry_tags || '[]'),
            purpose_tags: JSON.parse(p.purpose_tags || '[]'),
            employee_range_tags: JSON.parse(p.employee_range_tags || '[]')
        }));
        res.json({ programs: processed });
    } catch (error) {
        console.error('Error fetching programs:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 診断エンドポイント
app.post('/api/diagnose', async (req, res) => {
    try {
        const company = req.body;

        // リード情報のログ出力＆DB保存
        console.log('--- New Lead Received ---');
        console.log(`Company: ${company.company_name}`);

        // M-4: リード保存リトライ（最大2回 / 失敗時は CRITICAL ログで可視化）
        let leadSaveSuccess = false;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                await pool.query(
                    `INSERT INTO leads (
                        company_name, contact_person, phone, email,
                        prefecture, city, industry, employees_count, sales_amount,
                        purposes, ip_address
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [
                        company.company_name, company.contact_person, company.phone, company.email,
                        company.prefecture, company.city, company.industry, company.employees_count,
                        company.sales_amount, JSON.stringify(company.purposes || []), req.ip
                    ]
                );
                console.log(`[LEAD] Saved successfully (attempt ${attempt}).`);
                leadSaveSuccess = true;
                break;
            } catch (dbErr) {
                console.error(`[LEAD][CRITICAL] Save failed (attempt ${attempt}/2):`, dbErr.message);
                if (attempt < 2) await new Promise(r => setTimeout(r, 500));
            }
        }
        if (!leadSaveSuccess) {
            // どのリードが失われたかを特定できるよう最低限の情報をログに残す
            console.error(`[LEAD][CRITICAL] Lead LOST: company=${company.company_name} | email=${company.email}`);
            res.setHeader('X-Lead-Save-Status', 'failed');
        }

        console.log('-------------------------');

        // 1. キャッシュ確認
        const cacheKey = generateCacheKey(company);
        const cached = diagnosisCache.get(cacheKey);

        // --- Webhook送信用の共通関数 ---
        const postToGoogleSheets = async (targetCompany, displayPrograms) => {
            console.log('[GAS DEBUG] postToGoogleSheets called.');
            console.log('[GAS DEBUG] GOOGLE_SHEETS_WEBHOOK_URL exists:', !!process.env.GOOGLE_SHEETS_WEBHOOK_URL);
            if (!process.env.GOOGLE_SHEETS_WEBHOOK_URL) {
                console.log('[GAS DEBUG] No GOOGLE_SHEETS_WEBHOOK_URL set, skipping.');
                return;
            }
            try {
                const industryMap = {
                    manufacturing: '製造業', retail: '小売業', service: 'サービス業',
                    it: '情報通信業', restaurant: '飲食業', construction: '建設業', other: 'その他'
                };
                const salesMap = {
                    under_1000: '1,000万円未満', '1000_5000': '1,000万円〜5,000万円',
                    '5000_1oku': '5,000万円〜1億円', '1oku_5oku': '1億円〜5億円', over_5oku: '5億円以上'
                };
                const purposeMap = {
                    hiring: '人材採用・雇用拡大', it_implementation: 'ITツール導入・DX', productivity: '生産性向上・設備投資',
                    new_product: '新製品・新サービス開発', marketing: '販路開拓・広告宣伝', startup: '創業・起業'
                };
                const investmentMap = {
                    under_100: '100万円未満', '100_500': '100〜500万円',
                    '500_1000': '500〜1000万円', over_1000: '1000万円以上'
                };

                const sheetData = {
                    company_name: targetCompany.company_name,
                    contact_person: targetCompany.contact_person,
                    phone: targetCompany.phone,
                    email: targetCompany.email,
                    prefecture: targetCompany.prefecture,
                    city: targetCompany.city,
                    industry: industryMap[targetCompany.industry] || targetCompany.industry,
                    employees_count: targetCompany.employees_count,
                    sales_amount: salesMap[targetCompany.sales_amount] || targetCompany.sales_amount,
                    purposes: (targetCompany.purposes || []).map(p => purposeMap[p] || p).join('、'),
                    insurance: targetCompany.insurance === 'yes' ? 'はい' : 'いいえ',
                    investment: investmentMap[targetCompany.investment] || targetCompany.investment || '未設定',
                    diagnosis_1: displayPrograms[0] ? displayPrograms[0].name : '',
                    compatibility_1: displayPrograms[0] ? displayPrograms[0].fit_score : '',
                    diagnosis_2: displayPrograms[1] ? displayPrograms[1].name : '',
                    compatibility_2: displayPrograms[1] ? displayPrograms[1].fit_score : '',
                    diagnosis_3: displayPrograms[2] ? displayPrograms[2].name : '',
                    compatibility_3: displayPrograms[2] ? displayPrograms[2].fit_score : '',
                    diagnosis_4: displayPrograms[3] ? displayPrograms[3].name : '',
                    compatibility_4: displayPrograms[3] ? displayPrograms[3].fit_score : '',
                    diagnosis_5: displayPrograms[4] ? displayPrograms[4].name : '',
                    compatibility_5: displayPrograms[4] ? displayPrograms[4].fit_score : ''
                };

                console.log('[GAS DEBUG] Sending sheetData:', JSON.stringify(sheetData, null, 2));

                const response = await fetch(process.env.GOOGLE_SHEETS_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(sheetData),
                    redirect: 'follow'
                });

                if (response.ok) {
                    console.log('Successfully posted data to Google Sheets Webhook. Status:', response.status);
                } else {
                    console.error('Failed to post to Google Sheets Webhook. Status:', response.status);
                    const errText = await response.text();
                    console.error('Error response:', errText);
                }
            } catch (err) {
                console.error('Network or Parse error when posting to Google Sheets Webhook:', err);
            }
        };

        if (cached) {
            console.log('[GAS DEBUG] Cache hit! About to call postToGoogleSheets...');
            // キャッシュヒット時もスプレッドシートへの記録（リード追加）は実行する
            await postToGoogleSheets(company, cached.programs);
            console.log('[GAS DEBUG] Cache hit path - postToGoogleSheets completed.');
            return res.json(cached);
        }

        // 懸念点A: prefecture が空/未定義の場合は全件マッチを防ぐためエラーで弾く
        const userPrefecture = company.prefecture;
        if (!userPrefecture || userPrefecture.trim() === '') {
            return res.status(400).json({ error: '所在地（都道府県）は必須です' });
        }

        const result = await pool.query(
            `SELECT
                id, name, type, scope, prefecture,
                industry_tags, purpose_tags, employee_range_tags,
                eligibility_text, benefit_text, amount_text,
                official_url, application_status, freshness_status, last_verified_at
            FROM subsidy_programs
            WHERE is_active = 1
              AND application_status NOT IN ('stale', 'expired', 'closed')
              AND (
                  scope = 'national'
                  OR (scope = 'prefecture' AND prefecture ILIKE $1)
              )`,
            [`%${userPrefecture}%`]
        );
        console.log(`[DIAGNOSE] Pre-filtered programs: ${result.rows.length} 件 (prefecture: ${userPrefecture})`);
        const programs = result.rows.map(p => ({
            ...p,
            industry_tags: JSON.parse(p.industry_tags || '[]'),
            purpose_tags: JSON.parse(p.purpose_tags || '[]'),
            employee_range_tags: JSON.parse(p.employee_range_tags || '[]')
        }));

        // 3. スコアリング計算
        const scoredPrograms = programs.map(p => {
            const { score, reasons } = calculateScore(company, p);
            return { ...p, fit_score: score, reasons };
        });

        // 4. ソート & 上位抽出
        const rankedPrograms = scoredPrograms
            .sort((a, b) => b.fit_score - a.fit_score)
            .slice(0, 10);

        // 5. LLM解説生成
        const topProgramsForLLM = rankedPrograms.slice(0, 5);
        const llmResult = await generateExplanation(company, topProgramsForLLM);

        // 6. 結果のマージ
        const finalPrograms = rankedPrograms.map(p => {
            const llmInfo = llmResult.programs.find(lp => lp.program_id === p.id);
            return {
                ...p,
                why_fit_llm: llmInfo ? llmInfo.why_fit : p.reasons.join('。'),
            };
        });

        // 7. レスポンス生成
        const responseData = {
            summary: llmResult.summary,
            programs: finalPrograms
        };

        // キャッシュ保存（TTL付き）
        diagnosisCache.set(cacheKey, responseData);

        // キャッシュミス（新規生成）時もスプレッドシートへの記録を実行する
        await postToGoogleSheets(company, finalPrograms);

        res.json(responseData);

    } catch (error) {
        console.error('Diagnosis error:', error);
        res.status(500).json({ error: 'Internal Server Error during diagnosis' });
    }
});


// AIチャット（個別相談）エンドポイント
app.post('/api/chat', async (req, res) => {
    try {
        const { program_id, question } = req.body;

        if (!program_id || !question) {
            return res.status(400).json({ error: 'プログラムIDと質問文が必要です' });
        }

        // DBから該当のプログラム情報を取得
        const result = await pool.query('SELECT * FROM subsidy_programs WHERE id = $1', [program_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: '指定された補助金が見つかりません' });
        }

        const program = result.rows[0];

        // LLMに応答を生成させる
        const answer = await generateChatResponse(program, question);

        res.json({ answer });

    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'チャット生成中にエラーが発生しました' });
    }
});

// 商談予約エンドポイント
app.post('/api/consultation', async (req, res) => {
    try {
        const {
            company_name, contact_person, phone, email,
            preferred_date1, preferred_date2, preferred_date3,
            consultation_note, matched_programs
        } = req.body;

        if (!company_name || !contact_person || !email || !preferred_date1) {
            return res.status(400).json({ error: '必須項目を入力してください' });
        }

        const insertQuery = `
            INSERT INTO consultations (
                company_name, contact_person, phone, email,
                preferred_date1, preferred_date2, preferred_date3,
                consultation_note, matched_programs, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
        `;

        const result = await pool.query(insertQuery, [
            company_name, contact_person, phone, email,
            preferred_date1, preferred_date2 || null, preferred_date3 || null,
            consultation_note || '',
            JSON.stringify(matched_programs || []),
            'pending'
        ]);

        console.log(`--- 商談予約受付 ID: ${result.rows[0].id} ---`);
        console.log(`Company: ${company_name}, Contact: ${contact_person}`);

        res.json({
            success: true,
            consultation_id: result.rows[0].id,
            message: '商談予約を受け付けました'
        });

    } catch (error) {
        console.error('Consultation booking error:', error);
        res.status(500).json({ error: '商談予約の受付中にエラーが発生しました' });
    }
});

// フィードバックエンドポイント (Placeholder)
app.post('/api/feedback', (req, res) => {
    res.json({ message: "Feedback endpoint under construction" });
});

// ヘルスチェックエンドポイント（監視用）
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            status: 'ok',
            cache_size: diagnosisCache.size,
            uptime: Math.floor(process.uptime()),
            memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Database connection failed' });
    }
});

// 「セキュリティ修正 H-1」: 管理 API に Bearer トークン認証を追加
app.post('/api/admin/clear-cache', (req, res) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const expectedToken = process.env.ADMIN_SECRET_KEY;

    if (!expectedToken) {
        // ADMIN_SECRET_KEY が未設定の場合はエンドポイント自体を封鎖
        return res.status(503).json({ error: 'Admin endpoint is not configured' });
    }
    if (!token || token !== expectedToken) {
        return res.status(401).json({ error: '認証に失敗しました' });
    }

    const sizeBefore = diagnosisCache.size;
    diagnosisCache.cache.clear();
    console.log(`[ADMIN] Cache cleared. Before: ${sizeBefore} entries.`);
    res.json({ success: true, cleared_count: sizeBefore });
});

// Start Server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Rate limit: 100 req/15min per IP`);
    console.log(`Cache TTL: ${CACHE_TTL_MS / 1000 / 60}min, Max: ${CACHE_MAX_SIZE} entries`);
});
