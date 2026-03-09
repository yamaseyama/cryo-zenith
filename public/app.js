document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const heroSection = document.getElementById('hero');
    const startBtn = document.getElementById('start-btn');
    const diagnosisFormSection = document.getElementById('diagnosis-form');
    const loadingSection = document.getElementById('loading');
    const resultsSection = document.getElementById('results');
    const programsList = document.getElementById('programs-list');
    const summaryText = document.getElementById('summary-text');

    // Form Elements
    const step1 = document.getElementById('step-1');
    const step2 = document.getElementById('step-2');
    const bntToStep2 = document.getElementById('to-step-2');
    const btnBackToStep1 = document.getElementById('back-to-step-1');
    const submitBtn = document.getElementById('submit-btn');
    const restartBtn = document.getElementById('restart-btn');
    const subsidyForm = document.getElementById('subsidy-form');

    const stepMarker1 = document.getElementById('step-marker-1');
    const stepMarker2 = document.getElementById('step-marker-2');

    // Navigation Logic
    startBtn.addEventListener('click', () => {
        heroSection.classList.add('hidden');
        diagnosisFormSection.classList.remove('hidden');
    });

    bntToStep2.addEventListener('click', () => {
        if (validateStep1()) {
            step1.classList.add('hidden');
            step2.classList.remove('hidden');
            stepMarker1.classList.remove('active');
            stepMarker2.classList.add('active');
            window.scrollTo(0, 0);
        }
    });

    btnBackToStep1.addEventListener('click', () => {
        step2.classList.add('hidden');
        step1.classList.remove('hidden');
        stepMarker2.classList.remove('active');
        stepMarker1.classList.add('active');
    });

    restartBtn.addEventListener('click', () => {
        resultsSection.classList.add('hidden');
        diagnosisFormSection.classList.remove('hidden');
        step2.classList.add('hidden');
        step1.classList.remove('hidden');
        stepMarker2.classList.remove('active');
        stepMarker1.classList.add('active');
        subsidyForm.reset();
        window.scrollTo(0, 0);
    });

    // Validation
    function validateStep1() {
        const companyName = document.getElementById('company_name').value;
        const contactPerson = document.getElementById('contact_person').value;
        const phone = document.getElementById('phone').value;
        const email = document.getElementById('email').value;
        const prefecture = document.getElementById('prefecture').value;
        const city = document.getElementById('city').value;
        const industry = document.getElementById('industry').value;
        const employees = document.getElementById('employees_count').value;
        const sales = document.getElementById('sales_amount').value;
        const purposes = document.querySelectorAll('input[name="purposes"]:checked');

        if (!companyName || !contactPerson || !phone || !email || !prefecture || !city || !industry || !employees || !sales) {
            alert('Step 1の必須項目をすべて入力してください');
            return false;
        }

        if (purposes.length === 0) {
            alert('「今やりたいこと」を少なくとも1つ選択してください');
            return false;
        }

        return true;
    }

    // Submission
    subsidyForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Show Loading
        diagnosisFormSection.classList.add('hidden');
        loadingSection.classList.remove('hidden');
        window.scrollTo(0, 0);

        // Gather Data
        const formData = new FormData(subsidyForm);
        const data = {
            // Company Info
            company_name: formData.get('company_name'),
            contact_person: formData.get('contact_person'),
            phone: formData.get('phone'),
            email: formData.get('email'),
            // Attributes
            prefecture: formData.get('prefecture'),
            city: formData.get('city'),
            industry: formData.get('industry'),
            employees_count: parseInt(formData.get('employees_count')),
            sales_amount: formData.get('sales_amount'),

            purposes: [],
            investment: formData.get('investment'),
            insurance: formData.get('insurance')
        };

        document.querySelectorAll('input[name="purposes"]:checked').forEach(cb => {
            data.purposes.push(cb.value);
        });

        console.log('Sending data:', data);

        try {
            // API Call
            const response = await fetch('/api/diagnose', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error('API Error');
            }

            const result = await response.json();
            renderResults(result);

        } catch (error) {
            console.error('Error:', error);
            alert('診断中にエラーが発生しました。もう一度お試しください。');
            loadingSection.classList.add('hidden');
            diagnosisFormSection.classList.remove('hidden');
        }
    });

    function renderResults(data) {
        loadingSection.classList.add('hidden');
        resultsSection.classList.remove('hidden');

        // Summary
        if (data.summary && data.summary.overall_comment) {
            summaryText.textContent = data.summary.overall_comment;
        } else {
            summaryText.textContent = '最適なプランが見つかりました。';
        }

        // Programs
        programsList.innerHTML = '';
        if (data.programs.length === 0) {
            programsList.innerHTML = '<p class="no-result">条件に一致する制度が見つかりませんでした。条件を緩和して再検索してみてください。</p>';
            return;
        }

        data.programs.forEach(prog => {
            const card = document.createElement('div');
            card.className = 'program-card';

            const reason = prog.why_fit_llm || prog.reasons.join('。');

            card.innerHTML = `
                <div class="program-header">
                    <div class="program-title">${prog.name}</div>
                    <div class="match-score">適合度: ${prog.fit_score}点</div>
                </div>
                <div class="program-meta">
                    <span class="tag">${translateScope(prog.scope)}</span>
                    <span class="tag">${translateType(prog.type)}</span>
                    ${prog.application_status === 'open' ? '<span class="tag" style="background:#DCFCE7;color:#166534">公募中</span>' : ''}
                </div>
                <div style="margin-bottom: 1rem;">
                    <p><strong>対象:</strong> ${prog.eligibility_text}</p>
                    <p><strong>メリット:</strong> ${prog.benefit_text}</p>
                    <p><strong>補助額:</strong> ${prog.amount_text}</p>
                </div>
                <div class="program-reason">
                    <div class="reason-title">AI解説・適合理由</div>
                    <p>${reason}</p>
                </div>
                <div style="text-align: right; margin-top: 1rem;">
                    <a href="${prog.official_url}" target="_blank" class="btn secondary-btn" style="font-size:0.9rem; padding: 0.5rem 1rem;">公式サイトを見る</a>
                </div>
            `;
            programsList.appendChild(card);
        });
    }

    function translateScope(scope) {
        return scope === 'national' ? '全国' : '都道府県';
    }

    function translateType(type) {
        return type === 'subsidy' ? '補助金' : '助成金';
    }
});
