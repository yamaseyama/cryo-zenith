const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./data/programs.json', 'utf8'));

// 手動データはそのまま残す
const manualData = data.filter(p => p.id.startsWith('manual-'));
const jgData = data.filter(p => !p.id.startsWith('manual-'));

console.log("Re-mapping tags for J-Grants data...");

// 古いタグから新しい共通タグへのマッピング
const OLD_TO_NEW = {
    'productivity': 'productivity',
    'business_model': 'new_product',
    'new_product': 'new_product',
    'branding': 'marketing',
    'sales_expansion': 'marketing',
    'it_implementation': 'it_implementation',
    'career_up': 'hiring',
    'hiring': 'hiring',
    'startup': 'startup'
};

jgData.forEach(p => {
    if (p.purpose_tags) {
        const newTags = new Set();
        p.purpose_tags.forEach(t => {
            if (OLD_TO_NEW[t]) newTags.add(OLD_TO_NEW[t]);
        });
        p.purpose_tags = newTags.size > 0 ? [...newTags] : ['productivity'];
    }
});

const finalData = [...manualData, ...jgData];
fs.writeFileSync('./data/programs.json', JSON.stringify(finalData, null, 4));

console.log("Done. Ready to sync.");
