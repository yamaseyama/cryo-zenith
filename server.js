require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // フロントエンドファイルを配信

// Database Connection
const client = new Client({
    connectionString: process.env.DATABASE_URL
});

client.connect()
    .then(() => console.log('Connected to PostgreSQL (Supabase) database.'))
    .catch(err => console.error('Database connection error:', err));


// API Routes
const { calculateScore } = require('./scoring');
const { generateExplanation } = require('./llm');

// Helper: データベースから全てのプログラムを取得
app.get('/api/programs', async (req, res) => {
    try {
        const result = await client.query('SELECT * FROM subsidy_programs WHERE is_active = 1');
        const programs = result.rows;

        // JSONタグをパース
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

// 簡易インメモリキャッシュ
const diagnosisCache = new Map();

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

// 診断エンドポイント Implementation
app.post('/api/diagnose', async (req, res) => {
    try {
        const company = req.body;

        // [New] リード情報のログ出力＆DB保存
        console.log('--- New Lead Received ---');
        console.log(`Company: ${company.company_name}`);

        try {
            const insertQuery = `
                INSERT INTO leads (
                    company_name, contact_person, phone, email,
                    prefecture, city, industry, employees_count, sales_amount,
                    purposes, ip_address
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
                )
            `;

            await client.query(insertQuery, [
                company.company_name,
                company.contact_person,
                company.phone,
                company.email,
                company.prefecture,
                company.city,
                company.industry,
                company.employees_count,
                company.sales_amount,
                JSON.stringify(company.purposes || []),
                req.ip
            ]);
            console.log('Lead saved to database successfully.');
        } catch (dbErr) {
            console.error('Failed to save lead to database:', dbErr);
            // 診断処理は続行する
        }

        console.log('-------------------------');

        // 1. キャッシュ確認
        const cacheKey = generateCacheKey(company);
        if (diagnosisCache.has(cacheKey)) {
            console.log('Cache hit for key:', cacheKey);
            return res.json(diagnosisCache.get(cacheKey));
        }

        // 2. 全プログラム取得
        const result = await client.query('SELECT * FROM subsidy_programs WHERE is_active = 1');
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

        // キャッシュ保存
        diagnosisCache.set(cacheKey, responseData);

        res.json(responseData);

    } catch (error) {
        console.error('Diagnosis error:', error);
        res.status(500).json({ error: 'Internal Server Error during diagnosis' });
    }
});

// フィードバックエンドポイント (Placeholder)
app.post('/api/feedback', (req, res) => {
    res.json({ message: "Feedback endpoint under construction" });
});


// Start Server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
