import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { calculateScore } = require('../../scoring.js');

// ============================================================
// テスト用ヘルパー: プログラムのデフォルト値
// ============================================================
function makeProgram(overrides = {}) {
    return {
        id: 'test-program-1',
        name: 'テスト補助金',
        type: 'subsidy',
        scope: 'national',
        prefecture: null,
        industry_tags: JSON.stringify([]),
        purpose_tags: JSON.stringify([]),
        employee_range_tags: JSON.stringify([]),
        eligibility_text: '中小企業が対象',
        benefit_text: '最大100万円',
        amount_text: '100万円',
        official_url: 'https://example.com',
        application_status: 'open',
        freshness_status: 'fresh',
        last_verified_at: new Date().toISOString(),
        ...overrides,
    };
}

// テスト用会社データのデフォルト値
function makeCompany(overrides = {}) {
    return {
        company_name: 'テスト株式会社',
        prefecture: '東京都',
        industry: 'it',
        employees_count: 10,
        purposes: ['it_implementation'],
        sales_amount: '1000_5000',
        ...overrides,
    };
}

describe('calculateScore', () => {
    it('全国案件（scope: national）は地域スコアがつく', () => {
        const company = makeCompany();
        const program = makeProgram({ scope: 'national' });
        const { score, reasons } = calculateScore(company, program);
        expect(score).toBeGreaterThan(0);
        expect(reasons.some(r => r.includes('全国対象'))).toBe(true);
    });

    it('都道府県限定案件（scope: prefecture, prefecture: 東京都）でユーザーが東京都 → マッチ', () => {
        const company = makeCompany({ prefecture: '東京都' });
        const program = makeProgram({
            scope: 'prefecture',
            prefecture: '東京都',
        });
        const { score } = calculateScore(company, program);
        expect(score).toBeGreaterThan(0);
    });

    it('都道府県限定案件でユーザーが別県 → 0点', () => {
        const company = makeCompany({ prefecture: '大阪府' });
        const program = makeProgram({
            scope: 'prefecture',
            prefecture: '東京都',
        });
        const { score } = calculateScore(company, program);
        expect(score).toBe(0);
    });

    it('業種マッチ: 業種タグが一致するとスコアが加算される', () => {
        const company = makeCompany({ industry: 'manufacturing' });
        const programNoMatch = makeProgram({
            industry_tags: JSON.stringify(['it']),
        });
        const programMatch = makeProgram({
            industry_tags: JSON.stringify(['manufacturing']),
        });
        const { score: scoreNoMatch } = calculateScore(company, programNoMatch);
        const { score: scoreMatch } = calculateScore(company, programMatch);
        // 業種不一致は0点、一致はスコアあり
        expect(scoreNoMatch).toBe(0);
        expect(scoreMatch).toBeGreaterThan(0);
    });

    it('目的マッチ: 目的タグが一致するとスコアが加算される', () => {
        const company = makeCompany({ purposes: ['hiring'] });
        const program = makeProgram({
            purpose_tags: JSON.stringify(['hiring']),
        });
        const { score, reasons } = calculateScore(company, program);
        expect(score).toBeGreaterThan(0);
        expect(reasons.some(r => r.includes('目的'))).toBe(true);
    });

    it('従業員規模マッチ: 規模タグが一致するとボーナスがつく', () => {
        const company = makeCompany({ employees_count: 10 }); // small
        const program = makeProgram({
            employee_range_tags: JSON.stringify(['small']),
        });
        const { score, reasons } = calculateScore(company, program);
        expect(score).toBeGreaterThan(0);
        expect(reasons.some(r => r.includes('企業規模'))).toBe(true);
    });

    it('過去年度案件（令和5年）はスコア0', () => {
        const company = makeCompany();
        const program = makeProgram({
            name: 'テスト補助金（令和5年度）',
        });
        const { score } = calculateScore(company, program);
        expect(score).toBe(0);
    });

    it('全条件マッチで最大スコアに近い値が返る', () => {
        const company = makeCompany({
            prefecture: '東京都',
            industry: 'it',
            purposes: ['it_implementation', 'productivity'],
            employees_count: 10,
        });
        const program = makeProgram({
            scope: 'prefecture',
            prefecture: '東京都',
            industry_tags: JSON.stringify(['it']),
            purpose_tags: JSON.stringify(['it_implementation', 'productivity']),
            employee_range_tags: JSON.stringify(['small']),
            application_status: 'open',
        });
        const { score } = calculateScore(company, program);
        // 全条件マッチなので高スコアになるはず（上限100点）
        expect(score).toBeGreaterThanOrEqual(50);
        expect(score).toBeLessThanOrEqual(100);
    });

    it('条件0マッチの最小スコア（地域・業種・目的すべて不一致）は0', () => {
        const company = makeCompany({
            prefecture: '沖縄県',
            industry: 'retail',
            purposes: ['marketing'],
        });
        const program = makeProgram({
            scope: 'prefecture',
            prefecture: '北海道',
            industry_tags: JSON.stringify(['manufacturing']),
            purpose_tags: JSON.stringify(['hiring']),
        });
        const { score } = calculateScore(company, program);
        expect(score).toBe(0);
    });

    it('手動追加データ（purpose_tags が JSON 文字列）のスコアが計算できる', () => {
        const company = makeCompany({ purposes: ['startup'] });
        const program = makeProgram({
            // scoring.js の safeParseArray は JSON 文字列をパースする
            purpose_tags: '["startup", "hiring"]',
        });
        const { score } = calculateScore(company, program);
        expect(score).toBeGreaterThan(0);
    });

    it('applicationStatus が stale のプログラムはスコア0', () => {
        const company = makeCompany();
        const program = makeProgram({ application_status: 'stale' });
        const { score } = calculateScore(company, program);
        expect(score).toBe(0);
    });

    it('applicationStatus が expired のプログラムはスコア0', () => {
        const company = makeCompany();
        const program = makeProgram({ application_status: 'expired' });
        const { score } = calculateScore(company, program);
        expect(score).toBe(0);
    });
});
