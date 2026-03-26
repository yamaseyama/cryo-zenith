const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'dummy_key',
});

/**
 * M-3: トークン肥大化対策 — 長いテキストを切り詰めるヘルパー
 * LLMに渡すテキストが長すぎるとトークンコストが蹍上がるため、各フィールドを maxLen 文字以内に制限する
 */
function truncate(text, maxLen = 150) {
    if (!text) return '詳細は公式ページをご確認ください';
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

/**
 * generateExplanation
 * 上位候補の適合理由をLLMで生成する
 * 
 * @param {Object} company - 企業プロフィール
 * @param {Array} programs - 上位の制度リスト
 * @returns {Promise<Object>} - LLM生成結果 { programs: [{ id, why_fit_llm, ... }], summary: ... }
 */
async function generateExplanation(company, programs) {
    // APIキーがない、またはダミーの場合はモックを返す
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_api_key_here') {
        console.log('OpenAI API Key not found. Using mock response.');
        return mockResponse(programs);
    }

    // ユーザー目的 → IT・AI活用の文脈変換マップ
    const purposeToITContext = {
        startup:           '創業期の今こそ、最初からIT・AIを土台に据えた業務設計をすることで、少人数でも大企業並みの生産性を発揮できます。IT導入補助金は、その"最初のITインフラ整備"に最適な制度です。',
        marketing:         '販路開拓・集客において、今やデジタルマーケティングやECの活用は必須です。IT導入補助金を使えば、MAツールやECシステムの導入コストを大幅に抑えながら、デジタル販路を構築できます。',
        hiring:            '採用・定着には、勤怠・評価・給与など人事周りのDXが直結します。IT導入補助金でHRテックを導入すれば、採用コストを下げながら従業員満足度を上げる職場環境を低予算で整備できます。',
        productivity:      '生産性向上の最速手段は「人がやっている繰り返し作業をITで自動化すること」です。IT導入補助金は、その自動化ツール・基幹システム導入への強力な後押しになります。',
        new_product:       '新製品・新サービス開発を加速するには、市場データ分析やプロトタイプ検証にAIを活用することが今や常識です。IT導入補助金でAI・データ分析ツールを整備し、開発サイクルを短縮しましょう。',
        it_implementation: 'DX推進そのものがご目的であれば、IT導入補助金は最も費用対効果の高い入口です。まずこれで基盤を整えてから、ものづくり補助金や持続化補助金で業務の本丸を攻めるのが王道の進め方です。',
    };

    const purposes = Array.isArray(company.purposes) ? company.purposes : [];
    const itContext = purposes.map(p => purposeToITContext[p]).filter(Boolean).join(' また、') 
        || 'どのような目的においても、業務のIT・AI化は今や全業種で必須の土台となっています。IT導入補助金で、まずデジタル基盤を整備することを強くおすすめします。';

    const industryLabel = {
        manufacturing: '製造業', retail: '小売業', service: 'サービス業',
        it: '情報通信業', restaurant: '飲食業', construction: '建設業', other: '貴社業種'
    }[company.industry] || '貴社業種';

    const purposeLabels = {
        startup: '創業・起業', marketing: '販路開拓・広告宣伝', hiring: '人材採用・雇用拡大',
        productivity: '生産性向上・設備投資', new_product: '新製品・新サービス開発', it_implementation: 'IT導入・DX推進'
    };
    const purposeText = purposes.map(p => purposeLabels[p] || p).join('、') || '事業成長';

    const prompt = `
あなたは中小企業の成長を支援する、トップクラスの経営・ITコンサルタントです。
専門用語を避け、経営者の目標に寄り添う、親身で説得力のあるトーンで話します。

以下の企業情報と推奨制度リストをもとに、**必ず下記の4ステップ構成**でJSONを生成してください。

# 企業情報
- 都道府県: ${company.prefecture}
- 業種: ${industryLabel}
- 従業員数: ${company.employees_count}名
- 今やりたいこと: ${purposeText}

# 推奨制度リスト
${programs.map((p, i) => `
${i + 1}. [ID:${p.id}] ${p.name}
   - 補助内容: ${truncate(p.benefit_text, 100)}
   - 適合根拠: ${p.reasons.slice(0, 2).join('、')}
`).join('\n')}

# overall_comment の厳守すべき4ステップ構成（必ず順番通りに書くこと）

【ステップ1: 共感と承認】
${industryLabel}において「${purposeText}」に取り組もうとされているご姿勢は、非常に正しい戦略です。
この1文でまず経営者の着眼点をプロとして肯定する。

【ステップ2: 時間軸ストーリー】
抽出された補助金を2つの時間軸で整理して解説する。
「直近の土台作り（IT導入補助金・小規模事業者持続化補助金が該当すれば）」と
「中長期投資（ものづくり補助金が該当すれば）」に分けて、なぜその順番で取り組むべきかを語る。

【ステップ3: 目的別IT接続】
以下のコンテキストを必ず盛り込む：
${itContext}

【ステップ4: 強力なCTA（最終行に必ず入れる）】
「補助金はあくまで手段であり、重要なのはそれをどう事業成長に組み込むかという戦略です。御社に最適なIT・AI導入プランと補助金活用について、ぜひ一度私たち専門家と"作戦会議"をしてみませんか？」

※ overall_comment は全体で400文字以内にまとめること。

# 出力形式 (JSON)
Markdownのコードブロックは不要です。以下のJSON形式のみを出力してください。
{
    "summary": {
        "overall_comment": "4ステップ構成のコンサルティングコメント（400文字以内）"
    },
    "programs": [
        {
            "program_id": "制度ID（入力と同じID）",
            "why_fit": "なぜ今この企業に必要なのか、経営者目線の1〜2文（100文字以内、です・ます調）"
        }
    ]
}
`;

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: "あなたはトップクラスの経営・ITコンサルタントです。必ず指示された4ステップ構成でJSONを出力してください。" },
                { role: "user", content: prompt }
            ],
            model: "gpt-4o",
            response_format: { type: "json_object" },
        });

        const result = JSON.parse(completion.choices[0].message.content);

        // H-6: レスポンススキーマ検証
        if (!result.programs || !Array.isArray(result.programs) || !result.summary) {
            console.error('[LLM] Invalid response schema, falling back to mock');
            return mockResponse(programs);
        }

        return result;

    } catch (error) {
        console.error('LLM generation error:', error);
        return mockResponse(programs);
    }
}


function mockResponse(programs) {
    return {
        summary: {
            overall_comment: "（デモモード）貴社の状況にマッチした制度が見つかりました。特に人材育成とIT化に関する支援が充実しています。"
        },
        programs: programs.map(p => ({
            program_id: p.id,
            why_fit: "（デモ解説）この制度は貴社の業種および目的に合致しており、高い受給可能性が見込まれます。"
        }))
    };
}

/**
 * generateChatResponse
 * ユーザーからの特定の補助金に関する質問に答える
 * 
 * @param {Object} program - 質問対象の補助金情報
 * @param {string} question - ユーザーからの質問
 * @returns {Promise<string>} - LLMの回答テキスト
 */
async function generateChatResponse(program, question) {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_api_key_here') {
        console.log('OpenAI API Key not found. Using mock chat response.');
        return "（デモモードによる自動応答）いただいたご質問につきましては、公式サイトや公募要領を直接ご確認いただくか、事務局への問い合わせをおすすめいたします。\n\n対象補助金: " + program.name;
    }

    try {
        const prompt = `
あなたは中小企業の経営を支援する、プロの補助金アドバイザーです。
ユーザーから特定の補助金について以下の質問がありました。提示された補助金の情報を元に、簡潔で分かりやすく回答してください。

# 対象の補助金情報
- 名称: ${program.name}
- 種類: ${program.type === 'grant' ? '助成金' : '補助金'}
- 対象者について: ${truncate(program.eligibility_text, 200)}
- 補助内容（メリット）: ${truncate(program.benefit_text, 200)}
- 補助上限額: ${program.amount_text}
- 公式URL: ${program.official_url}

# ユーザーからの質問:
${question}

[回答のルール]
- 丁寧な「です・ます」調で回答すること。
- 150〜300文字程度で簡潔にまとめること。
- 提供された補助金情報から確実なことが言えない場合は、「公募要領をご確認ください」と案内すること。
`;

        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: "You are a helpful and professional consultant." }, { role: "user", content: prompt }],
            model: "gpt-4o-mini", // チャットはレスポンスの速いモデルを使用
        });

        return completion.choices[0].message.content;

    } catch (error) {
        console.error('LLM chat error:', error);
        return "申し訳ありません。現在AIシステムが混み合っており、回答を生成できませんでした。少し時間をおいて再度お試しください。";
    }
}

module.exports = { generateExplanation, generateChatResponse };
