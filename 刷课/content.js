// ==UserScript==
// @name         UOOC 极简助手 (终极绝杀融合版)
// @namespace    http://tampermonkey.net/
// @version      40.1
// @description  v40底盘 + 完美弹窗秒解移植：满血后台、弹窗秒杀、独立警报、附件指纹
// @author       Gemini & You
// @match        *://*.uooc.net.cn/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    // 防止被 iframe 多次注入
    if (window.self !== window.top) return; 
    console.log("[UOOC 助手]  已启动 🚀");

    const CONFIG = { playbackRate: 2.0 };
    let engineStarted = false, isJumping = false, noVideoTimer = 0;
    
    // 🌟 核心状态锁
    window.uoocLastSuccessIdx = -1;
    let isCoolingDown = false; // 物理冷静期标志
    let isExamAlarmed = false; // 测验警报标志
    let wakeLock = null;       // 屏幕常亮锁

    // ==========================================
    // 🛡️ 模块一：满血免疫与后台伪装
    // ==========================================
    Object.defineProperty(document, 'hidden', { value: false, writable: false });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: false });
    
    // 🔥 最强底层防御：焦点锁死 (保障全屏打游戏不暂停)
    document.hasFocus = () => true;

    const blockEvent = e => e.stopImmediatePropagation();
    document.addEventListener('visibilitychange', blockEvent, true);
    window.addEventListener('blur', blockEvent, true);
    window.addEventListener('focus', blockEvent, true);  // 拦截获焦信号
    document.addEventListener('blur', blockEvent, true); // 拦截失焦信号
    // 🌟 新增防线：拦截鼠标物理逃逸信号，防止 UOOC 借此暂停视频
    window.addEventListener('mouseleave', blockEvent, true);
    document.addEventListener('mouseleave', blockEvent, true);
    window.addEventListener('mouseout', blockEvent, true);
    document.addEventListener('mouseout', blockEvent, true);

    // 2. 准备音频心跳（防降频）
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0.001; // 人耳听不见的音量
    osc.connect(gain); 
    gain.connect(audioCtx.destination);

    // 语音播报函数
    // 🌟 新增：原生合成“叮”提示音
    function playDing() {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const dingOsc = audioCtx.createOscillator();
        const dingGain = audioCtx.createGain();
        
        dingOsc.type = 'sine'; // 正弦波，音色像清脆的铃声
        dingOsc.frequency.setValueAtTime(900, audioCtx.currentTime); // 900Hz 高频清脆音
        
        // 音量包络：0.02秒瞬间拉满，0.5秒内指数级衰减到无声，模拟敲击金属的余音
        dingGain.gain.setValueAtTime(0, audioCtx.currentTime);
        dingGain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.02);
        dingGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
        
        dingOsc.connect(dingGain);
        dingGain.connect(audioCtx.destination);
        
        dingOsc.start(audioCtx.currentTime);
        dingOsc.stop(audioCtx.currentTime + 0.5);
    }
    function speak(text) {
        if (!engineStarted) return;
        window.speechSynthesis.cancel();
        let u = new SpeechSynthesisUtterance(text);
        u.rate = 2.5;
        window.speechSynthesis.speak(u);
    }

    // ==========================================
    // 🎨 模块二：极客 UI 还原
    // ==========================================
    const css = `
        #uooc-video-panel { position:fixed; top:20px; left:20px; width:180px; background:rgba(20,20,20,0.85); color:#fff; z-index:999999; border-radius:8px; box-shadow:0 4px 15px rgba(0,0,0,0.5); border:1px solid #3498db; backdrop-filter:blur(5px); font-family:sans-serif; display:block; }
        #uooc-drag-bar { padding:8px 12px; background:#2980b9; cursor:move; border-radius:8px 8px 0 0; font-size:12px; font-weight:bold; display:flex; justify-content:space-between; user-select:none; }
        #uooc-min-ball { position:fixed; top:20px; left:20px; width:40px; height:40px; background:#2980b9; border-radius:50%; z-index:999999; display:none; align-items:center; justify-content:center; cursor:move; box-shadow:0 4px 10px rgba(0,0,0,0.5); font-size:16px; user-select:none; border:2px solid #fff; }
        #uooc-start-btn { width:100%; padding:8px 0; background:#e74c3c; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer; margin-bottom:5px; transition:0.3s; }
        #uooc-start-btn:hover { background:#c0392b; }
        #uooc-start-btn.running { background:#27ae60; cursor:default; }
    `;
    const style = document.createElement('style'); style.innerHTML = css; document.head.appendChild(style);
    
    const div = document.createElement('div');
 div.innerHTML = `
        <div id="uooc-video-panel">
            <div id="uooc-drag-bar"><span>🤖 UOOC助手</span><span id="uooc-min-btn" style="cursor:pointer;">➖</span></div>
            <div style="padding:10px;">
                <div style="display: flex; gap: 5px; margin-bottom: 5px;">
                    <button id="uooc-start-btn" style="flex: 1; padding: 8px 0; background: #e74c3c; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; transition: 0.3s;">🚀 点火启动</button>
                    <button id="uooc-refresh-btn" style="width: 35px; background: #f39c12; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;" title="强制刷新网页重启兜底">🔄</button>
                </div>
                <div id="uooc-log" style="height:60px; background:#111; color:#0f0; overflow-y:auto; padding:5px; border-radius:4px; font-family:monospace; font-size:10px; line-height:1.4;">等待点火...</div>
            </div>
        </div>
        <div id="uooc-min-ball" title="展开">🤖</div>
    `;
    document.body.appendChild(div);
    
    const panel = document.getElementById('uooc-video-panel'), ball = document.getElementById('uooc-min-ball'), dragBar = document.getElementById('uooc-drag-bar');
    const startBtn = document.getElementById('uooc-start-btn');
    // 🌟 新增：物理除颤器，点击瞬间强制刷新当前页面
    document.getElementById('uooc-refresh-btn').onclick = () => {
        log("🔄 正在强制刷新页面...");
        setTimeout(() => location.reload(), 200);
    };
    const log = (m) => { 
        const l = document.getElementById('uooc-log'); 
        if (l) { l.innerHTML += `<div>> ${m}</div>`; l.scrollTop = l.scrollHeight; } 
    };

    // 拖拽与缩放逻辑
    let isDragging = false, startX, startY, initLeft, initTop;
    dragBar.onmousedown = ball.onmousedown = (e) => { isDragging = true; startX = e.clientX; startY = e.clientY; let t = panel.style.display !== 'none' ? panel : ball; initLeft = t.offsetLeft; initTop = t.offsetTop; };
    document.onmousemove = (e) => { if (isDragging) { let t = panel.style.display !== 'none' ? panel : ball; t.style.left = (initLeft + e.clientX - startX) + 'px'; t.style.top = (initTop + e.clientY - startY) + 'px'; } };
    document.onmouseup = () => isDragging = false;
    document.getElementById('uooc-min-btn').onclick = () => { panel.style.display = 'none'; ball.style.display = 'flex'; };
    ball.onclick = () => { ball.style.display = 'none'; panel.style.display = 'block'; };

    startBtn.onclick = async function() {
        if (engineStarted) return;
        
        // 启动音频心跳
        osc.start(); 
        if(audioCtx.state === 'suspended') audioCtx.resume();
        
        // 申请系统级屏幕常亮锁
        try { 
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                log("🌞 屏幕常亮锁已激活");
            }
        } catch(e) { log("⚠️ 常亮锁申请失败，请保持浏览器前台"); }

        engineStarted = true; 
        this.className = 'running'; 
        this.innerText = '✅ 满血后台运行中';
        log("🔥 引擎全开！支持全屏打游戏挂机。");
        
        playDing();
    };

    // ==========================================
    // 🧠 模块三：核心功能方法区
    // ==========================================
    function strike(el) {
        if (!el) return;
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        ['mousedown', 'mouseup', 'click'].forEach(t => {
            el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
        });
    }

    // 🔥 移植：纯血原生弹窗秒解逻辑
    function autoQuizAnswer() {
        try {
            let quizLayer = document.querySelector('#quizLayer, .smallTest-view');
            let sourceDiv = document.querySelector('div[uooc-video]');
            if (!quizLayer || !sourceDiv || quizLayer.dataset.working === "true") return;

            let submitBtn = quizLayer.querySelector('button.btn-success') || Array.from(quizLayer.querySelectorAll('button')).find(b => b.innerText.includes('确'));
            if (!submitBtn) return; // 没确定按钮说明是残骸，撤退让主循环去超度
            log("⚡ 确认为真实小测，锁定目标！");
            quizLayer.dataset.working = "true";
            let sourceStr = sourceDiv.getAttribute('source');
            if (!sourceStr) { quizLayer.dataset.working = ""; return; }

            let source = JSON.parse(sourceStr);
            let quizQuestion = quizLayer.querySelector('.ti-q-c');
            if (!quizQuestion) { quizLayer.dataset.working = ""; return; }

            let qText = quizQuestion.innerText.trim();
            let quizData = source.quiz.find(q => {
                let tmp = document.createElement('div'); tmp.innerHTML = q.question;
                let clean = (tmp.textContent || tmp.innerText).trim();
                return clean === qText || qText.includes(clean) || clean.includes(qText);
            });

            if (!quizData) { quizLayer.dataset.working = ""; return; }

            let quizAnswer = quizData.answer; 
            log(`🎯 内存嗅探成功: ${quizAnswer}`);
            
            let options = quizLayer.querySelectorAll('.ti-alist > div, label.ti-a');
            let ansArray = quizAnswer.match(/[A-Z]/g) || [];
            
            for (let ans of ansArray) {
                let idx = ans.charCodeAt(0) - 65; 
                let targetOpt = options[idx];
                if (targetOpt) {
                    let input = targetOpt.querySelector('input[type="radio"], input[type="checkbox"]');
                    if (input) input.click();
                    else targetOpt.click();
                }
            }

            setTimeout(() => {
                submitBtn.click();
                log("✅ 弹窗秒解完成");
                setTimeout(() => { if (quizLayer) quizLayer.dataset.working = ""; }, 1000);
            }, 600);
        } catch (e) { 
            console.error(e); 
            if(document.querySelector('#quizLayer')) document.querySelector('#quizLayer').dataset.working=""; 
        }
    }

    async function navigate(reason = "视频结束") {
        if (isJumping || isCoolingDown) return;
        isJumping = true;
        log(`🎬 [${reason}] 正在定位下一任务...`);

        const dirTab = Array.from(document.querySelectorAll('span, li, div')).find(e => e.innerText.trim() === '目录' && e.offsetHeight > 0);
        if (dirTab && !dirTab.classList.contains('active')) strike(dirTab);
        await new Promise(r => setTimeout(r, 600));

       let radar = Array.from(document.querySelectorAll('.basic, .catalog-item, div[ng-click*="goSource"]'))
            .filter(el => {
                let t = el.innerText.trim();
                if (el.offsetHeight === 0 || !t || ['目录','笔记','提问','返回'].includes(t)) return false;
                let hasTask = el.querySelector('.taskpoint') !== null;
                let isFolder = /(第.*?章|第.*?节)/.test(t);
                return hasTask || isFolder; // 只认任务点或文件夹，非任务点瞬间无视！
            });

        let curIdx = -1;
        for (let i = radar.length - 1; i >= 0; i--) {
            if (radar[i].classList.contains('active') || radar[i].querySelector('.active') || radar[i].querySelector('.oneline.active')) {
                curIdx = i; break;
            }
        }

        if (curIdx > window.uoocLastSuccessIdx) {
            window.uoocLastSuccessIdx = curIdx;
        }
        let baseIdx = curIdx !== -1 ? curIdx : window.uoocLastSuccessIdx;
        let target = radar[baseIdx + 1];

        if (target) {
            let targetText = target.innerText.trim().substring(0, 12).replace(/\n/g, "");
            log(`🎯 目标锁定：${targetText}`);
            strike(target);
            window.uoocLastSuccessIdx = baseIdx + 1;

            if (targetText.includes('第') || target.nextElementSibling?.tagName === 'UL') {
                log("📂 开启章节大门，进入 3.5秒 冷静期...");
                isCoolingDown = true;
                noVideoTimer = 0; 
                setTimeout(() => { 
                    isCoolingDown = false; 
                    log("🚦 冷静期结束，开始入室检查！");
                }, 3500);
            }
        } else {
            log("🎉 进度封顶，本页任务全部刷完！");
            speak("所有课程已刷完");
        }
        
        setTimeout(() => { isJumping = false; }, 3000);
    }

    // ==========================================
    // ⚔️ 模块四：主神经中枢
    // ==========================================
    
    // 🔥 移植：单发绊马索 (变动监视器)
    var learnView = document.querySelector('.lean_view') || document.body;
    var observer = new MutationObserver(function(mutations) {
        if (!engineStarted) return;
        for (let mutation of mutations) {
            for (let node of mutation.addedNodes) {
                if (node && node.nodeType === 1) { 
                    if ((node.id && (node.id.includes('layui-layer') || node.id === 'quizLayer')) || (node.classList && node.classList.contains('smallTest-view'))) {
                        setTimeout(autoQuizAnswer, 300);
                        return; 
                    }
                }
            }
        }
    });
    observer.observe(learnView, { childList: true, subtree: true });

    setInterval(() => {
        if (!engineStarted) return;
        if (isCoolingDown) return;

        // ------------------------------------------
        // 🔥 第零优先级：弹窗物理超度与主循环避让
        // ------------------------------------------
        const popBox = document.querySelector('#quizLayer, .smallTest-view');
        let isPopActive = false;
        if (popBox) {
            let hasSubmitBtn = popBox.querySelector('.btn-success') || Array.from(popBox.querySelectorAll('button')).find(b => b.innerText.includes('确'));
            
            // 🌟 核心侦测：当前页面还有没有视频的底层数据源？
            let sourceDiv = document.querySelector('div[uooc-video]');
            let hasVideoSource = sourceDiv && sourceDiv.getAttribute('source');

            // 🔥 绝杀斩灵：如果没有提交按钮，或者【连视频数据源都没了（跨页幽灵）】 -> 强制物理超度！
            if ((!hasSubmitBtn || !hasVideoSource) && popBox.dataset.solved !== "true") {
                popBox.dataset.solved = "true";
                popBox.style.display = "none";
                log("👻 斩杀跨页幽灵弹窗，释放主循环！");
                let v = document.querySelector('video');
                if (v && v.paused) v.play().catch(()=>{});
            }
            isPopActive = popBox.offsetHeight > 10 && popBox.dataset.solved !== "true" && window.getComputedStyle(popBox).display !== 'none';
        }
        
        // 如果弹窗小测正在进行中，主循环立刻撤退，绝不干扰秒解逻辑！
        if (isPopActive) return; 

        const pageText = document.body.innerText || "";
        const activeNodes = document.querySelectorAll('.oneline.active, .basic.active');
        const activeNode = activeNodes.length > 0 ? activeNodes[activeNodes.length - 1] : null;
        const activeName = activeNode ? activeNode.innerText.trim().split(/\r?\n/)[0] : "";
        
        // 🌟 核心破局点：认准右侧目录有没有绿勾（.complete）
        const isCompleted = activeNode && activeNode.classList.contains('complete');

        // 第一优先级：独立测验紧急刹车 (前提：还没打勾！)
        const isIndependentExam = (/(测验|考试|试卷|测试)/.test(activeName) || document.querySelector('.ti-q-c') || pageText.includes("保存试卷")) && !isCompleted;
        
        if (isIndependentExam) {
            if (!isExamAlarmed) {
                isExamAlarmed = true;
                log("🛑 警告：发现独立大考！引擎已挂起，请手动交卷。");
                speak("发现独立测验，脚本已暂停，请手动处理");
            }
            noVideoTimer = 0; 
            return; 
        } else {
            isExamAlarmed = false; 
        }

        // 🌟 新增：如果当前是大考，且已经打勾了，直接解除封印，自动寻找下一关！
        if (/(测验|考试|试卷|测试)/.test(activeName) && isCompleted && !isJumping) {
            log("✅ 检测到大考已提交（绿勾亮起），自动继续前进...");
            navigate("大考已完结跳过");
            return;
        }

        // ------------------------------------------
        // 第二优先级：视频托管
        // ------------------------------------------
        const video = document.querySelector('video');

        if (video && video.offsetHeight > 10) {
            noVideoTimer = 0;
            if (!video.dataset.hook) {
                video.dataset.hook = "true";
                video.addEventListener('ended', () => navigate("视频播完"));
                log("🚀 视频守护开启，静音 2.0x 播放中...");
                // 🌟 新增底层夺权：彻底废掉浏览器的暂停 API（除了视频真播完，谁也别想让它停）
                const originalPause = video.pause;
                video.pause = function() {
                    if (video.ended) {
                        originalPause.call(video); // 只有播完了才准停
                    } else {
                        console.log("🛡️ 已拦截 UOOC 的恶意暂停指令");
                    }
                };
            }
            if (video.paused && !video.ended) video.play().catch(()=>{});
            
            video.muted = false;
            video.volume = 0.0001; 
            if (video.playbackRate !== CONFIG.playbackRate) video.playbackRate = CONFIG.playbackRate;
            return;
        }

        // ------------------------------------------
        // 第三优先级：附件与空白页安全跳过
        // ------------------------------------------
        if (!isJumping) {
            const isAttachment = window.location.href.includes('/files') || /(附件)/.test(activeName) || document.querySelector('.course-select-resource') || pageText.includes("请选择课程资源");
            
            if (!video && isAttachment && !isIndependentExam) {
                noVideoTimer += 0.8;
                if (noVideoTimer > 3) {
                    log("⏭️ 确认当前为附件/过渡页，执行安全跨越...");
                    navigate("附件跳过");
                    noVideoTimer = 0;
                }
            } else {
                noVideoTimer = 0; 
            }
        }

    }, 800);

})();