
// テストデータのバリエーション定義
const prefectures = ["東京都", "大阪府", "北海道", "福岡県", "愛知県", "沖縄県", "宮城県", "広島県", "京都府", "神奈川県"];
const industries = ["manufacturing", "retail", "service", "it", "restaurant", "construction", "other"];
const employees = ["2", "5", "15", "30", "50", "150", "300"];
const sales = ["under_1000", "1000_5000", "5000_1oku", "1oku_5oku", "over_5oku"];
const purposesList = ["hiring", "it_implementation", "productivity", "new_product", "marketing", "startup"];
const insurances = ["yes", "no"];
const investments = ["under_100", "100_500", "500_1000", "over_1000"];

// ランダム選択ヘルパー
const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const getRandomSubset = (arr, maxItems = 3) => {
    const shuffled = [...arr].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.floor(Math.random() * maxItems) + 1);
};

// 仮想企業名の生成
const companyTypes = ["株式会社", "合同会社", "有限会社"];
const companyNames = ["テック", "ソリューションズ", "サービス", "企画", "イノベーション", "システム", "デザイン", "サポート", "カンパニー"];

async function runTest() {
    console.log("=== 診断精度テストデータの生成と送信を開始します (50件) ===");

    for (let i = 1; i <= 50; i++) {
        // テスト用仮想データの組み立て
        const type = getRandom(companyTypes);
        const name = getRandom(companyNames);
        const randId = Math.floor(Math.random() * 10000).toString().padStart(4, '0');

        const testData = {
            company_name: `${type}自動テスト${name}_${randId}`,
            contact_person: `テスト担当者 ${i}号`,
            phone: `090-0000-${i.toString().padStart(4, '0')}`,
            email: `test${i}@example.com`,
            prefecture: getRandom(prefectures),
            city: "テスト市",
            industry: getRandom(industries),
            employees_count: getRandom(employees),
            sales_amount: getRandom(sales),
            purposes: getRandomSubset(purposesList),
            insurance: getRandom(insurances),
            investment: getRandom(investments)
        };

        console.log(`[${i}/50] 送信中: ${testData.company_name} (業種:${testData.industry}, 規模:${testData.employees_count}人, 目的:${testData.purposes.join(',')})`);

        try {
            // 本番環境のAPIエンドポイントへ送信
            const response = await fetch('https://cryo-zenith.vercel.app/api/diagnose', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testData)
            });

            if (!response.ok) {
                console.error(`  -> エラー: HTTP ${response.status}`);
            } else {
                console.log(`  -> 成功: スプレッドシートへ連動完了`);
            }
        } catch (err) {
            console.error(`  -> ネットワークエラー:`, err.message);
        }

        // サーバー負荷とAPIレートリミットを考慮して1.5秒待機
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    console.log("=== 全リクエスト完了 ===");
    console.log("スプレッドシートの「診断リード」シートをご確認ください！");
}

runTest();
