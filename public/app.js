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
    const step3 = document.getElementById('step-3');
    const bntToStep2 = document.getElementById('to-step-2');
    const btnBackToStep1 = document.getElementById('back-to-step-1');
    const btnToStep3 = document.getElementById('to-step-3');
    const btnBackToStep2 = document.getElementById('back-to-step-2');
    const submitBtn = document.getElementById('submit-btn');
    const restartBtn = document.getElementById('restart-btn');
    const subsidyForm = document.getElementById('subsidy-form');

    const stepMarker1 = document.getElementById('step-marker-1');
    const stepMarker2 = document.getElementById('step-marker-2');
    const stepMarker3 = document.getElementById('step-marker-3');

    // Chat Modal Elements
    const chatModal = document.getElementById('chat-modal');
    const closeChatModalBtn = document.getElementById('close-chat-modal');
    const chatModalTitle = document.getElementById('chat-modal-title');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const chatLoading = document.getElementById('chat-loading');

    let currentChatProgramId = null;

    // ステッパー切り替え（アクティブなステップを更新）
    function setActiveStep(activeNum) {
        [stepMarker1, stepMarker2, stepMarker3].forEach((marker, i) => {
            if (i + 1 === activeNum) {
                marker.classList.add('active');
            } else {
                marker.classList.remove('active');
            }
        });
    }

    // Navigation Logic
    startBtn.addEventListener('click', () => {
        heroSection.classList.add('hidden');
        diagnosisFormSection.classList.remove('hidden');
    });

    // Step 1 → Step 2
    bntToStep2.addEventListener('click', () => {
        if (validateStep1()) {
            step1.classList.add('hidden');
            step2.classList.remove('hidden');
            setActiveStep(2);
            window.scrollTo(0, 0);
        }
    });

    // Step 2 → Step 1（戻る）
    btnBackToStep1.addEventListener('click', () => {
        step2.classList.add('hidden');
        step1.classList.remove('hidden');
        setActiveStep(1);
    });

    // Step 2 → Step 3
    btnToStep3.addEventListener('click', () => {
        step2.classList.add('hidden');
        step3.classList.remove('hidden');
        setActiveStep(3);
        window.scrollTo(0, 0);
    });

    // Step 3 → Step 2（戻る）
    btnBackToStep2.addEventListener('click', () => {
        step3.classList.add('hidden');
        step2.classList.remove('hidden');
        setActiveStep(2);
    });

    // 再診断ボタン
    restartBtn.addEventListener('click', () => {
        resultsSection.classList.add('hidden');
        diagnosisFormSection.classList.remove('hidden');
        step2.classList.add('hidden');
        step3.classList.add('hidden');
        step1.classList.remove('hidden');
        setActiveStep(1);
        subsidyForm.reset();
        window.scrollTo(0, 0);
    });

    // Validation: Step 1（事業情報のみ）
    function validateStep1() {
        const prefecture = document.getElementById('prefecture').value;
        const city = document.getElementById('city').value;
        const industry = document.getElementById('industry').value;
        const employees = document.getElementById('employees_count').value;
        const sales = document.getElementById('sales_amount').value;
        const purposes = document.querySelectorAll('input[name="purposes"]:checked');

        if (!prefecture || !city || !industry || !employees || !sales) {
            alert('事業情報の必須項目をすべて入力してください');
            return false;
        }

        if (purposes.length === 0) {
            alert('「今やりたいこと」を少なくとも1つ選択してください');
            return false;
        }

        return true;
    }

    // Validation: Step 3（会社情報）
    function validateStep3() {
        const companyName = document.getElementById('company_name').value;
        const contactPerson = document.getElementById('contact_person').value;
        const phone = document.getElementById('phone').value;
        const email = document.getElementById('email').value;

        const privacyAgree = document.getElementById('privacy-policy-agree').checked;

        if (!companyName || !contactPerson || !phone || !email) {
            alert('会社情報をすべて入力してください');
            return false;
        }

        if (!privacyAgree) {
            alert('プライバシーポリシーへの同意が必要です');
            return false;
        }

        // メールアドレスの簡易バリデーション
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(email)) {
            alert('正しいメールアドレスを入力してください');
            return false;
        }

        return true;
    }

    // Submission
    subsidyForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Step 3のバリデーション
        if (!validateStep3()) return;

        // Show Loading
        diagnosisFormSection.classList.add('hidden');
        loadingSection.classList.remove('hidden');
        window.scrollTo(0, 0);

        // Gather Data（全ステップから一括取得）
        const formData = new FormData(subsidyForm);
        const data = {
            // Company Info (Step 3)
            company_name: formData.get('company_name'),
            contact_person: formData.get('contact_person'),
            phone: formData.get('phone'),
            email: formData.get('email'),
            // Attributes (Step 1)
            prefecture: formData.get('prefecture'),
            city: formData.get('city'),
            industry: formData.get('industry'),
            employees_count: parseInt(formData.get('employees_count')),
            sales_amount: formData.get('sales_amount'),

            purposes: [],
            // Step 2
            investment: formData.get('investment'),
            insurance: formData.get('insurance')
        };

        document.querySelectorAll('input[name="purposes"]:checked').forEach(cb => {
            data.purposes.push(cb.value);
        });

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
                    ${prog.application_status === 'upcoming' ? '<span class="tag" style="background:#FEF3C7;color:#92400E">募集予定</span>' : ''}
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
                <div style="text-align: right; margin-top: 1rem; display: flex; justify-content: flex-end; gap: 0.5rem;">
                    <a href="${prog.official_url}" target="_blank" class="btn secondary-btn" style="font-size:0.9rem; padding: 0.5rem 1rem;">公式サイトを見る</a>
                </div>
            `;
            programsList.appendChild(card);
        });
    }

    // ==========================================
    // チャットモーダルのロジック
    // ==========================================

    function openChatModal(programId, programName) {
        currentChatProgramId = programId;
        chatModalTitle.textContent = programName;

        // メッセージ履歴をクリアして最初の挨拶を設定
        chatMessages.innerHTML = `
            <div class="message ai-message">
                <p>こんにちは！この補助金について何か気になることはありますか？<br>（例: 「従業員5名でも使えますか？」「パソコンの購入は対象になりますか？」など）</p>
            </div>
        `;

        chatInput.value = '';
        chatModal.classList.remove('hidden');
        chatInput.focus();
    }

    function closeChatModal() {
        chatModal.classList.add('hidden');
        currentChatProgramId = null;
    }

    closeChatModalBtn.addEventListener('click', closeChatModal);

    // モーダル外クリックで閉じる
    window.addEventListener('click', (e) => {
        if (e.target === chatModal) {
            closeChatModal();
        }
    });

    async function handleSendChat() {
        const question = chatInput.value.trim();
        if (!question || !currentChatProgramId) return;

        // ユーザーのメッセージを追加
        appendMessage('user', question);
        chatInput.value = '';
        chatLoading.classList.remove('hidden');
        chatMessages.scrollTop = chatMessages.scrollHeight; // スクロールを下へ

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    program_id: currentChatProgramId,
                    question: question
                })
            });

            const data = await response.json();

            chatLoading.classList.add('hidden');

            if (response.ok) {
                appendMessage('ai', data.answer);
            } else {
                appendMessage('ai', 'エラーが発生しました: ' + (data.error || '不明なエラー'));
            }
        } catch (error) {
            console.error('Chat API Error:', error);
            chatLoading.classList.add('hidden');
            appendMessage('ai', '通信エラーが発生しました。時間を置いて再度お試しください。');
        }
    }

    sendChatBtn.addEventListener('click', handleSendChat);

    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleSendChat();
        }
    });

    function appendMessage(sender, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}-message`;
        // 改行をbrタグに変換
        const formattedText = text.replace(/\n/g, '<br>');
        msgDiv.innerHTML = `<p>${formattedText}</p>`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight; // スクロールを下へ
    }

    function translateScope(scope) {
        return scope === 'national' ? '全国' : '都道府県';
    }

    function translateType(type) {
        return type === 'subsidy' ? '補助金' : '助成金';
    }
});
