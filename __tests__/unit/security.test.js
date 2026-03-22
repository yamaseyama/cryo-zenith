import { describe, it, expect } from 'vitest';

// ============================================================
// escapeHtml — app.jsから関数をコピーして独立テスト
// ============================================================
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ============================================================
// sanitizeUrl — app.jsから関数をコピーして独立テスト
// ============================================================
function sanitizeUrl(url) {
    if (url == null) return '#';
    const trimmed = String(url).trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return '#';
}

// ============================================================
// maskEmail — server.jsと同一実装をコピーして独立テスト
// server.jsは外部依存（dotenv, pg等）が多いため直接importせず、
// 関数の仕様保証をここで行う
// ============================================================
function maskEmail(email) {
    if (!email || !email.includes('@')) return '***';
    const [local, domain] = email.split('@');
    return `${local.charAt(0)}***@${domain}`;
}

describe('escapeHtml', () => {
    it('XSSペイロード <script>alert(1)</script> をエスケープする', () => {
        const result = escapeHtml('<script>alert(1)</script>');
        expect(result).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('& をエスケープする', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('< をエスケープする', () => {
        expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
    });

    it('> をエスケープする', () => {
        expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    it('" をエスケープする', () => {
        expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    });

    it("' をエスケープする", () => {
        expect(escapeHtml("it's")).toBe('it&#039;s');
    });

    it('null 入力は空文字列を返す', () => {
        expect(escapeHtml(null)).toBe('');
    });

    it('undefined 入力は空文字列を返す', () => {
        expect(escapeHtml(undefined)).toBe('');
    });

    it('通常の文字列はそのまま返す', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });
});

describe('sanitizeUrl', () => {
    it('javascript:alert(1) は # を返す', () => {
        expect(sanitizeUrl('javascript:alert(1)')).toBe('#');
    });

    it('data:text/html,... は # を返す', () => {
        expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
    });

    it('https://example.com はそのまま返す', () => {
        expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
    });

    it('http://example.com はそのまま返す', () => {
        expect(sanitizeUrl('http://example.com')).toBe('http://example.com');
    });

    it('空文字は # を返す', () => {
        expect(sanitizeUrl('')).toBe('#');
    });

    it('null は # を返す', () => {
        expect(sanitizeUrl(null)).toBe('#');
    });

    it('前後の空白を除去してから判定する', () => {
        expect(sanitizeUrl('  https://example.com  ')).toBe('https://example.com');
    });
});

describe('maskEmail', () => {
    it('null 入力は *** を返す', () => {
        expect(maskEmail(null)).toBe('***');
    });

    it('@ なし入力は *** を返す', () => {
        expect(maskEmail('noemail')).toBe('***');
    });

    it('正常入力: hiroki@example.com → h***@example.com', () => {
        expect(maskEmail('hiroki@example.com')).toBe('h***@example.com');
    });

    it('1文字のローカルパート: a@b.com → a***@b.com', () => {
        expect(maskEmail('a@b.com')).toBe('a***@b.com');
    });
});
