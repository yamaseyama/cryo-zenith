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

module.exports = { generateExplanation };
