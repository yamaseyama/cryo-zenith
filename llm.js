const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'dummy_key', // APIキーがない場合もエラーで落ちないように
});

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

    try {
        const prompt = `
あなたは補助金・助成金のプロフェッショナルコンサルタントです。
以下の企業情報と、システムが選定した推奨制度リストに基づき、各制度が「なぜこの企業におすすめなのか」を自然な日本語で解説してください。
また、全体の総評も作成してください。

# 企業情報
- 都道府県: ${company.prefecture}
- 業種: ${company.industry}
- 従業員数: ${company.employees_count}
- 目的: ${company.purposes.join(', ')}

# 推奨制度リスト (上位のみ)
${programs.map((p, index) => `
${index + 1}. ${p.name}
   - 対象: ${p.eligibility_text}
   - メリット: ${p.benefit_text}
   - スコア判定理由: ${p.reasons.join(', ')}
`).join('\n')}

# 出力形式 (JSON)
必ず以下のJSON形式のみを出力してください。Markdownのコードブロックは不要です。
{
    "summary": {
        "overall_comment": "全体的な総評コメント（150文字以内）"
    },
    "programs": [
        {
            "program_id": "制度ID (入力と同じID)",
            "why_fit": "なぜこの企業におすすめなのかの解説（100文字以内、「です・ます」調）"
        }
    ]
}
`;

        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: "You are a helpful assistant that outputs JSON." }, { role: "user", content: prompt }],
            model: "gpt-4o", // または gpt-3.5-turbo
            response_format: { type: "json_object" },
        });

        const result = JSON.parse(completion.choices[0].message.content);
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
- 対象者について: ${program.eligibility_text}
- 補助内容（メリット）: ${program.benefit_text}
- 補助上限額: ${program.amount_text}
- 公式URL: ${program.official_url}
- AIによる判定理由: ${program.why_fit_llm || program.reasons?.join('。') || 'なし'}

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
