/* ==========================================================================
   CARTAS VELHAS: TACTICAL SYSTEM v3.0 [SAMHAIN PROTOCOL]
   Autoria: Guilherme Otávio Xavier de Souza
   Motor de Jogo, IA Necromante, Mini-Jogos, P2P & Persistência Firebase
   ========================================================================== */

// --- CONFIGURAÇÃO DE EVENTO SAZONAL ---
// Opções suportadas: 'HALLOWEEN' | 'CHRISTMAS' | 'DEFAULT'
const ACTIVE_EVENT = 'HALLOWEEN';

// --- CONFIGURAÇÃO FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyCSkDG6kWhKcuK0bhzJU7HazHBwHtuQ9zo",
    authDomain: "cartas-velhas-db.firebaseapp.com",
    projectId: "cartas-velhas-db",
    storageBucket: "cartas-velhas-db.firebasestorage.app",
    messagingSenderId: "146756048632",
    appId: "1:146756048632:web:efebe19fc28ef9f87c0d0d",
    measurementId: "G-H70FLB4DB4"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let userStats = { wins: 0, losses: 0, rank: 1000, displayName: "Operador" };
let opponentStats = { rank: '?', wins: '?' };

// Constantes de Rede e Sistema
const APP_ID = "cv-tactics-v3-samhain-";
const MAX_PUB_ROOMS = 25;
const BOT_TURN_DELAY = 1200;

// Definição de Cartas com Sobrescrita Temática Dinâmica
let CARDS = {
    'PLACE': { name: 'Invocação', icon: '🎃', rarity: 'common', weight: 40, desc: 'Posiciona uma peça. Ao atingir 3, a mais antiga dissipa-se.' },
    'BOMB':  { name: 'Fogo Fátuo', icon: '👻', rarity: 'rare',   weight: 15, desc: 'Destrói uma peça inimiga desprotegida da grelha.' },
    'SHIELD':{ name: 'Véu Astral', icon: '🔮', rarity: 'rare',   weight: 15, desc: 'Protege uma peça tua contra Maldições e Trocas por 2 turnos.' },
    'MOVE':  { name: 'Teleporte',  icon: '🦇', rarity: 'rare',   weight: 10, desc: 'Move uma peça TUA para uma casa desocupada.' },
    'PUSH':  { name: 'Rajada',     icon: '💨', rarity: 'rare',   weight: 10, desc: 'Empurra uma peça INIMIGA para uma casa vazia.' },
    'SWAP':  { name: 'Possessão',  icon: '🕸️', rarity: 'legendary', weight: 10, desc: 'Troca de posição uma peça tua com uma inimiga.' }
};

if (ACTIVE_EVENT === 'CHRISTMAS') {
    CARDS['PLACE'] = { name: 'Duende', icon: '🧝', rarity: 'common', weight: 40, desc: 'Coloca um ajudante no tabuleiro.' };
    CARDS['BOMB']  = { name: 'Carvão', icon: '🎁', rarity: 'rare',   weight: 15, desc: 'Presente explosivo! Destrói inimigo.' };
    CARDS['SHIELD']= { name: 'Gelo',   icon: '❄️', rarity: 'rare',   weight: 15, desc: 'Congela a peça protegendo-a.' };
} else if (ACTIVE_EVENT === 'DEFAULT') {
    CARDS['PLACE'] = { name: 'Básica', icon: '♟️', rarity: 'common', weight: 40, desc: 'Coloca uma peça. Ao atingir 3, a mais antiga remove-se.' };
    CARDS['BOMB']  = { name: 'Bomba',  icon: '💣', rarity: 'rare',   weight: 15, desc: 'Destrói peça inimiga sem escudo.' };
    CARDS['SHIELD']= { name: 'Escudo', icon: '🛡️', rarity: 'rare',   weight: 15, desc: 'Protege a tua peça contra destruição.' };
}

// Estado Global do Tabuleiro
const GameState = {
    board: Array(9).fill(null),
    history: { 'X': [], 'O': [] },
    hands: { 'X': [], 'O': [] },
    shields: {},
    scores: { 'X': 0, 'O': 0 },
    names: { 'X': 'P1', 'O': 'P2' },
    turn: 'X',
    winner: null,
    targetWins: 3,
    winningLine: null
};

// Variáveis de Controlo de Rede e Sessão
let peer = null, conn = null, mySide = null, isHost = false, isBotMatch = false;
let timeLeft = 16, myName = "OPERADOR", isQuickMatch = false;
let selectedHandIdx = null, activeCardType = null, stepSourceIdx = null;
let cameraShake = 0, isInGame = false, isMuted = false;

// --- TRAVA DE SEGURANÇA CONTRA DUPLICAÇÃO DE VITÓRIAS/DERROTAS ---
let matchFinalized = false;
let matchSecurityToken = null;
let matchStartTime = 0;
let socialInitialized = false;

// Utilitário de Escape HTML
function escapeHtml(text) {
    if (!text) return text;
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- SISTEMA DE ARRANQUE (BOOT) ---
let bootState = { animFinished: false, authFinished: false };

function checkBootState() {
    if (bootState.animFinished && bootState.authFinished) {
        const text = document.getElementById('loading-text');
        if (text) text.innerText = "> SISTEMA PRONTO. BEM-VINDO.";
        const screen = document.getElementById('loading-screen');
        if (screen) {
            screen.style.opacity = '0';
            document.getElementById('screen-menu').classList.remove('hidden');
            setTimeout(() => screen.classList.add('hidden'), 500);
        }
    }
}

window.addEventListener('load', () => {
    const bar = document.getElementById('loading-fill');
    if (bar) bar.style.width = '100%';
    setTimeout(() => {
        bootState.animFinished = true;
        checkBootState();
    }, 450);
});

// --- BASE DE DADOS & PERFIL ---
async function loadUserProfile(user) {
    try {
        const userRef = db.collection('players').doc(user.uid);
        await userRef.set({ lastSeen: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        
        const doc = await userRef.get();
        if (doc.exists) {
            userStats = doc.data();
            if (userStats.rank === undefined) {
                await userRef.update({ rank: 1000, wins: 0, losses: 0 });
                userStats.rank = 1000; userStats.wins = 0; userStats.losses = 0;
            }
            if (userStats.hasSetNick) {
                myName = userStats.displayName;
            } else {
                document.getElementById('modal-nickname').classList.remove('hidden');
            }
        } else {
            userStats = {
                displayName: user.displayName || "Operador",
                photoURL: user.photoURL || "",
                wins: 0, losses: 0, rank: 1000, hasSetNick: false,
                lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            await userRef.set(userStats);
            document.getElementById('modal-nickname').classList.remove('hidden');
        }
        updateUIWithStats();
        loadMatchHistory();
        startHeartbeat();
        setupFriendSystem();
    } catch (e) {
        console.error("Falha ao sincronizar com Firestore:", e);
    }
}

function updateUIWithStats() {
    const nameDiv = document.getElementById('profile-name');
    if (nameDiv) nameDiv.innerText = userStats.displayName || myName;
    const avatar = document.getElementById('profile-img');
    if (avatar && currentUser) avatar.src = currentUser.photoURL || '';
    const detailAvatar = document.getElementById('detail-profile-img');
    if (detailAvatar && currentUser) detailAvatar.src = currentUser.photoURL || '';
    
    const editNick = document.getElementById('edit-nick-input');
    if (editNick) editNick.value = userStats.displayName || myName;
    
    document.getElementById('stat-rank').innerText = userStats.rank || 1000;
    document.getElementById('stat-wins').innerText = userStats.wins || 0;
    document.getElementById('stat-losses').innerText = userStats.losses || 0;
}

// --- AMIGOS & CONVITES ---
let incomingInviteCode = null;

function setupFriendSystem() {
    if (!currentUser || socialInitialized) return;
    socialInitialized = true;
    
    db.collection('friend_requests').where('to', '==', currentUser.uid)
        .onSnapshot(snapshot => {
            const list = document.getElementById('friend-requests-list');
            if (!list) return;
            list.innerHTML = '';
            snapshot.forEach(doc => {
                const req = doc.data();
                list.innerHTML += `
                    <div class="user-profile-container">
                        <span style="color:var(--x-color); font-weight:bold;">${escapeHtml(req.fromName)} enviou um pacto.</span>
                        <div>
                            <button class="cyber-btn mini" onclick="acceptFriend('${doc.id}', '${req.from}', '${escapeHtml(req.fromName)}')">✓</button>
                            <button class="cyber-btn secondary mini" onclick="rejectFriend('${doc.id}')">X</button>
                        </div>
                    </div>`;
            });
        });

    db.collection('players').doc(currentUser.uid).collection('friends')
        .onSnapshot(snapshot => {
            const list = document.getElementById('friends-list-content');
            const lobbyList = document.getElementById('lobby-friends-list');
            if (!list) return;
            list.innerHTML = '';
            if (lobbyList) lobbyList.innerHTML = '';
            
            if (snapshot.empty) {
                list.innerHTML = '<p class="text-muted text-center">Nenhum aliado registado no terminal.</p>';
                return;
            }

            snapshot.forEach(async doc => {
                const f = doc.data();
                const fDoc = await db.collection('players').doc(doc.id).get();
                let isOnline = false;
                if (fDoc.exists && fDoc.data().lastSeen) {
                    const diff = Date.now() - fDoc.data().lastSeen.toMillis();
                    if (diff < 120000) isOnline = true;
                }
                const html = `
                    <div class="user-profile-container" style="justify-content:space-between; margin-bottom:8px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="live-dot" style="color:${isOnline ? 'var(--accent-green)' : '#555'}">●</span>
                            <span style="font-weight:bold;">${escapeHtml(f.name)}</span>
                        </div>
                        ${isOnline ? `<button class="cyber-btn mini" onclick="inviteFriend('${doc.id}')">INVOCAR</button>` : '<span style="color:#555; font-size:0.75rem;">OFFLINE</span>'}
                    </div>`;
                list.innerHTML += html;
                if (isOnline && lobbyList) {
                    document.getElementById('lobby-friends-invite').classList.remove('hidden');
                    lobbyList.innerHTML += html;
                }
            });
        });

    db.collection('players').doc(currentUser.uid).collection('invites')
        .onSnapshot(snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === "added") {
                    const invite = change.doc.data();
                    incomingInviteCode = invite.code;
                    document.getElementById('invite-text').innerText = `${escapeHtml(invite.from)} convoca-te para o duelo!`;
                    document.getElementById('invite-modal').classList.remove('hidden');
                    SoundFX.roundWin();
                    change.doc.ref.delete();
                }
            });
        });
}

function searchPlayer() {
    const input = document.getElementById('search-player-input');
    const query = input.value.trim();
    const area = document.getElementById('search-results-area');
    area.innerHTML = '<div class="loader"></div>';
    if (!query) { area.innerHTML = '<p class="text-muted">Introduz uma alcunha.</p>'; return; }
    
    db.collection('players').where('displayName', '==', query).limit(5).get()
        .then(async snap => {
            area.innerHTML = '';
            if (snap.empty) { area.innerHTML = '<p style="color:var(--accent-red)">Agente não localizado.</p>'; return; }
            for (const doc of snap.docs) {
                if (doc.id === currentUser.uid) continue;
                const p = doc.data();
                const fDoc = await db.collection('players').doc(currentUser.uid).collection('friends').doc(doc.id).get();
                area.innerHTML += `
                    <div class="user-profile-container" style="justify-content:space-between; margin-top:8px;">
                        <span>${escapeHtml(p.displayName)} (ELO: ${p.rank || 1000})</span>
                        ${fDoc.exists ? '<span style="color:var(--accent-green)">PACTUADO ✓</span>' : `<button class="cyber-btn mini" onclick="sendFriendRequest('${doc.id}')">➕</button>`}
                    </div>`;
            }
            if (area.innerHTML === '') area.innerHTML = '<p class="text-muted">És tu próprio.</p>';
        });
}

function sendFriendRequest(targetUid) {
    db.collection('friend_requests').add({
        from: currentUser.uid, fromName: myName, to: targetUid, timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => { showToast("PACTO ENVIADO", "var(--accent-green)"); searchPlayer(); });
}

function acceptFriend(reqId, friendUid, friendName) {
    db.collection('players').doc(currentUser.uid).collection('friends').doc(friendUid).set({ name: friendName });
    db.collection('players').doc(friendUid).collection('friends').doc(currentUser.uid).set({ name: myName });
    db.collection('friend_requests').doc(reqId).delete();
    showToast("PACTO FORMADO", "var(--accent-green)");
}

function rejectFriend(reqId) { db.collection('friend_requests').doc(reqId).delete(); }

function inviteFriend(friendUid) {
    if (!peer || !peer.id) { showToast("CRIA UMA SALA PRIMEIRO", "var(--accent-red)"); return; }
    const code = peer.id.replace(APP_ID, '');
    db.collection('players').doc(friendUid).collection('invites').add({
        code: code, from: myName, timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => { showToast("CONVITE ENVIADO", "var(--x-color)"); });
}

function acceptInvite() {
    document.getElementById('invite-modal').classList.add('hidden');
    if (incomingInviteCode) {
        document.getElementById('input-code').value = incomingInviteCode;
        openLobby('join');
        connectToHost();
    }
}
function closeInvite() { document.getElementById('invite-modal').classList.add('hidden'); }

// Heartbeat de Presença
function startHeartbeat() {
    updateOnlineCount();
    setInterval(() => {
        if (currentUser) {
            db.collection('players').doc(currentUser.uid).update({
                lastSeen: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(() => {});
        }
    }, 60000);
    setInterval(updateOnlineCount, 90000);
}

async function updateOnlineCount() {
    try {
        const threshold = new Date(Date.now() - 4 * 60 * 1000);
        const snap = await db.collection('players').where('lastSeen', '>', threshold).get();
        const count = snap.size || 1;
        const val = document.getElementById('online-count-val');
        const box = document.getElementById('online-counter-display');
        if (val && box) {
            val.innerText = count;
            box.classList.remove('hidden');
        }
    } catch(e) {}
}

function saveInitialNickname() {
    if (!currentUser) return;
    let nick = document.getElementById('permanent-nick-input').value.trim();
    nick = escapeHtml(nick);
    if (nick.length >= 3 && nick.length <= 10) {
        db.collection('players').doc(currentUser.uid).update({ displayName: nick, hasSetNick: true })
            .then(() => {
                userStats.displayName = nick; userStats.hasSetNick = true; myName = nick;
                updateUIWithStats();
                document.getElementById('modal-nickname').classList.add('hidden');
                showToast("ALMA REGISTADA: " + nick, "var(--accent-green)");
            });
    } else {
        showToast("ALCUNHA INVÁLIDA (3-10 CARACT.)", "var(--accent-red)");
    }
}

function saveNewNickname() {
    if (!currentUser) return;
    let nick = document.getElementById('edit-nick-input').value.trim();
    nick = escapeHtml(nick);
    if (nick.length >= 3 && nick.length <= 10) {
        db.collection('players').doc(currentUser.uid).update({ displayName: nick })
            .then(() => {
                userStats.displayName = nick; myName = nick;
                updateUIWithStats();
                showToast("DADOS ATUALIZADOS", "var(--accent-green)");
            });
    } else {
        showToast("ALCUNHA INVÁLIDA", "var(--accent-red)");
    }
}

async function loadLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '<div class="loader"></div>';
    try {
        const snapshot = await db.collection('players').orderBy('rank', 'desc').limit(100).get();
        list.innerHTML = '';
        if (snapshot.empty) { list.innerHTML = '<p class="text-muted text-center">SEM DADOS DE RANKING</p>'; return; }
        let pos = 1;
        snapshot.forEach(doc => {
            const p = doc.data();
            const isMe = (currentUser && doc.id === currentUser.uid);
            list.innerHTML += `
                <div style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid #222; background:${isMe ? 'rgba(255,85,0,0.1)' : 'transparent'};">
                    <span style="font-weight:bold; color:var(--x-color); width:30px;">#${pos++}</span>
                    <span style="flex:1; text-align:left; font-weight:bold;">${escapeHtml(p.displayName || 'Anon')}</span>
                    <span style="color:var(--o-color); font-weight:bold; width:70px; text-align:right;">${p.rank || 1000}</span>
                    <span style="color:#777; width:70px; text-align:right; font-size:0.75rem;">${p.wins || 0}V / ${p.losses || 0}D</span>
                </div>`;
        });
    } catch(e) {
        list.innerHTML = '<p style="color:var(--accent-red); text-align:center;">FALHA AO CARREGAR TABELA</p>';
    }
}

// --- SALVAMENTO E HISTÓRICO ANTI-DUPLICAÇÃO ---
function saveGameResult(isWin, token) {
    if (!token || token !== matchSecurityToken) return;
    if (matchFinalized) return; // TRAVA ESTRITA: Impossibilita duplicação de vitória/derrota
    matchFinalized = true;

    const duration = Date.now() - matchStartTime;
    if (duration < 1200) return; // Proteção contra finalizações instantâneas fraudulentas

    if (isBotMatch) {
        saveLocalHistory(isWin ? "Vitória vs IA Necromante" : "Derrota vs IA Necromante", isWin);
        return;
    }

    if (!currentUser || !userStats) return;

    const userRef = db.collection('players').doc(currentUser.uid);
    if (isWin) {
        userRef.update({
            wins: firebase.firestore.FieldValue.increment(1),
            rank: firebase.firestore.FieldValue.increment(25)
        }).catch(() => {});
        userStats.wins++;
        userStats.rank += 25;
        saveLocalHistory(`Vitória vs ${GameState.names[mySide === 'X' ? 'O' : 'X']}`, true);
    } else {
        userRef.update({
            losses: firebase.firestore.FieldValue.increment(1),
            rank: firebase.firestore.FieldValue.increment(-15)
        }).catch(() => {});
        userStats.losses++;
        userStats.rank = Math.max(100, userStats.rank - 15);
        saveLocalHistory(`Derrota vs ${GameState.names[mySide === 'X' ? 'O' : 'X']}`, false);
    }
    updateUIWithStats();
}

function saveLocalHistory(text, isWin) {
    let hist = JSON.parse(localStorage.getItem('cv_history_v3') || '[]');
    hist.unshift({ text: text, win: isWin, date: new Date().toLocaleTimeString() });
    if (hist.length > 6) hist.pop();
    localStorage.setItem('cv_history_v3', JSON.stringify(hist));
    loadMatchHistory();
}

function loadMatchHistory() {
    const div = document.getElementById('match-history-list');
    const hist = JSON.parse(localStorage.getItem('cv_history_v3') || '[]');
    if (!div) return;
    div.innerHTML = '';
    if (hist.length === 0) {
        div.innerHTML = '<div class="text-muted text-center pt-10">Sem sessões registadas.</div>';
        return;
    }
    hist.forEach(h => {
        div.innerHTML += `
            <div class="history-item">
                <span><span class="${h.win ? 'win-tag' : 'lose-tag'}">${h.win ? 'VITÓRIA' : 'DERROTA'}</span> ${escapeHtml(h.text)}</span>
                <span style="color:#666;">${h.date}</span>
            </div>`;
    });
}

function showPlayerStats(side) {
    if (side === mySide) showToast(`EU: ELO ${userStats.rank || 1000}`, "#fff");
    else showToast(isBotMatch ? "IA NECROMANTE v3.0" : `OPONENTE: ELO ${opponentStats.rank}`, "var(--x-color)");
}

// --- AUTENTICAÇÃO ---
function loginGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then(() => showToast("ACESSO AUTORIZADO", "var(--accent-green)"))
        .catch(() => showToast("FALHA DE ACESSO", "var(--accent-red)"));
}

function logout() {
    auth.signOut().then(() => showToast("DESCONECTADO", "#fff"));
}

auth.onAuthStateChanged(user => {
    const guestArea = document.getElementById('guest-input-area');
    const userArea = document.getElementById('user-profile-area');
    const gameControls = document.getElementById('game-controls');
    
    if (user) {
        currentUser = user;
        guestArea.classList.add('hidden');
        userArea.classList.remove('hidden');
        gameControls.classList.remove('hidden');
        loadUserProfile(user);
    } else {
        currentUser = null;
        guestArea.classList.remove('hidden');
        userArea.classList.add('hidden');
        gameControls.classList.add('hidden');
        document.getElementById('modal-nickname').classList.add('hidden');
    }
    bootState.authFinished = true;
    checkBootState();
});

// --- ÁUDIO SINTETIZADO NATIVO ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function unlockAudio() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
            window.removeEventListener('click', unlockAudio);
            window.removeEventListener('touchstart', unlockAudio);
        });
    }
}
window.addEventListener('click', unlockAudio);
window.addEventListener('touchstart', unlockAudio);

function toggleMute() {
    isMuted = !isMuted;
    const btn = document.getElementById('btn-mute');
    btn.innerHTML = isMuted ? '🔇' : '🔊';
}

const SoundFX = {
    playTone: (freq, type, duration, vol = 0.1) => {
        if (isMuted) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
            gain.gain.setValueAtTime(vol, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + duration);
        } catch(e) {}
    },
    hover:   () => SoundFX.playTone(320, 'sine', 0.08, 0.04),
    click:   () => SoundFX.playTone(740, 'triangle', 0.08, 0.08),
    place:   () => SoundFX.playTone(480, 'sine', 0.25, 0.15),
    explode: () => SoundFX.playTone(90, 'sawtooth', 0.45, 0.3),
    roundWin:() => [440, 587, 659, 880].forEach((f, i) => setTimeout(() => SoundFX.playTone(f, 'square', 0.35, 0.15), i * 90)),
    error:   () => SoundFX.playTone(130, 'sawtooth', 0.2, 0.25)
};

// --- NAVEGAÇÃO ENTRE ECRÃS ---
function resetLobbyUI() {
    document.getElementById('lobby-host-ui').classList.add('hidden');
    document.getElementById('lobby-client-ui').classList.add('hidden');
    document.getElementById('lobby-quick-ui').classList.add('hidden');
}

function openScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(screenId);
    if (target) target.classList.remove('hidden');
    if (screenId === 'screen-cards') renderCardsHelp();
    if (screenId === 'screen-profile' && currentUser) {
        updateUIWithStats();
        loadMatchHistory();
    }
    if (screenId === 'screen-leaderboard') loadLeaderboard();
}

function renderCardsHelp() {
    const container = document.getElementById('cards-list-ui');
    container.innerHTML = '';
    for (const key in CARDS) {
        const c = CARDS[key];
        container.innerHTML += `
            <div style="display:flex; align-items:center; border-bottom:1px dashed #333; padding:8px 0;">
                <div style="font-size:2rem; width:45px; text-align:center;">${c.icon}</div>
                <div style="flex:1; margin-left:10px;">
                    <div style="font-weight:bold; font-size:0.9rem;">${c.name} <span style="font-size:0.65rem; color:var(--x-color);">[${c.rarity.toUpperCase()}]</span></div>
                    <div style="color:#aaa; font-size:0.75rem;">${c.desc}</div>
                </div>
            </div>`;
    }
}

// --- REDE PEERJS (P2P REAL-TIME) ---
function initPeer(id = null) { return new Peer(id, { debug: 0 }); }
function copyCode() {
    navigator.clipboard.writeText(document.getElementById('display-code').innerText);
    showToast("FREQUÊNCIA COPIADA", "var(--x-color)");
}

function openLobby(mode) {
    openScreen('screen-lobby-wait');
    resetLobbyUI();
    if (mode === 'host') setupHostPrivate();
    else if (mode === 'join') document.getElementById('lobby-client-ui').classList.remove('hidden');
}

function setupHostPrivate() {
    isHost = true; mySide = 'X'; isBotMatch = false;
    resetLobbyUI();
    document.getElementById('lobby-host-ui').classList.remove('hidden');
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    document.getElementById('display-code').innerText = code;
    GameState.names['X'] = myName;
    
    if (peer) peer.destroy();
    peer = initPeer(APP_ID + code);
    peer.on('error', () => setupHostPrivate());
    peer.on('connection', handleConnectionRequest);
}

function connectToHost() {
    isBotMatch = false; isHost = false; mySide = 'O';
    const code = document.getElementById('input-code').value.trim().toUpperCase();
    if (code.length < 4) return;
    const btn = document.getElementById('btn-connect');
    const stat = document.getElementById('client-status');
    btn.disabled = true; stat.innerText = "A sintonizar frequência...";
    
    if (peer) peer.destroy();
    peer = initPeer();
    peer.on('open', () => {
        conn = peer.connect(APP_ID + code, { reliable: true });
        configureConnection();
        setTimeout(() => {
            if (!conn.open) {
                btn.disabled = false;
                stat.innerText = "Frequência inacessível.";
            }
        }, 5500);
    });
}

function startQuickMatch() {
    const btn = document.getElementById('btn-quick');
    if (btn) btn.disabled = true;
    isBotMatch = false;
    openScreen('screen-lobby-wait');
    resetLobbyUI();
    document.getElementById('lobby-quick-ui').classList.remove('hidden');
    document.getElementById('quick-log').innerText = "Rastreando arenas...";
    setTimeout(() => findPublicMatch(0), Math.random() * 800 + 400);
}

function findPublicMatch(roomIndex) {
    if (isBotMatch) return;
    if (roomIndex >= MAX_PUB_ROOMS) {
        document.getElementById('quick-log').innerText = "A criar arena pública...";
        setTimeout(() => setupHostPrivate(), 600);
        return;
    }
    const roomID = APP_ID + 'PUB-' + roomIndex;
    document.getElementById('quick-log').innerText = `A verificar canal ${roomIndex + 1}...`;
    if (peer) peer.destroy();
    peer = initPeer(roomID);
    peer.on('open', () => {
        document.getElementById('quick-log').innerText = "Canal aberto. Aguardando oponente...";
        isHost = true; mySide = 'X'; GameState.names['X'] = myName;
        peer.on('connection', c => {
            if (conn && conn.open) {
                c.on('open', () => { c.send({ type: 'ROOM_FULL' }); setTimeout(() => c.close(), 400); });
                return;
            }
            handleConnectionRequest(c);
        });
    });
    peer.on('error', err => {
        if (err.type === 'unavailable-id') connectToPublicRoom(roomID, roomIndex);
        else findPublicMatch(roomIndex + 1);
    });
}

function connectToPublicRoom(roomID, currentIdx) {
    const tempPeer = initPeer();
    tempPeer.on('open', () => {
        conn = tempPeer.connect(roomID, { reliable: true });
        conn.on('open', () => {
            isHost = false; mySide = 'O'; isBotMatch = false;
            conn.send({ type: 'JOIN_HANDSHAKE', name: myName, rank: userStats.rank || 1000 });
            setupClientListener();
        });
        conn.on('data', data => {
            if (data.type === 'ROOM_FULL') {
                conn.close(); tempPeer.destroy(); findPublicMatch(currentIdx + 1);
            } else {
                handleData(data);
            }
        });
        setTimeout(() => {
            if (!conn.open) { tempPeer.destroy(); findPublicMatch(currentIdx + 1); }
        }, 3200);
    });
}

function handleConnectionRequest(c) {
    conn = c;
    conn.on('data', data => {
        if (data.type === 'JOIN_HANDSHAKE') {
            let safeName = data.name || "OPERADOR";
            if (safeName.length > 10) safeName = safeName.substring(0, 10);
            GameState.names['O'] = safeName;
            opponentStats.rank = data.rank || '???';
            if (GameState.hands['X'].length === 0) startGame();
            else broadcastState();
        } else {
            handleData(data);
        }
    });
    conn.on('close', () => {
        showToast("OPONENTE DESCONECTOU", "var(--accent-red)");
        setTimeout(() => location.reload(), 2500);
    });
}

function configureConnection() {
    conn.on('open', () => {
        conn.send({ type: 'JOIN_HANDSHAKE', name: myName, rank: userStats.rank || 1000 });
        setupClientListener();
    });
}

function setupClientListener() {
    conn.on('data', handleData);
    conn.on('close', () => {
        showToast("LIGAÇÃO PERDIDA", "var(--accent-red)");
        setTimeout(() => location.reload(), 2500);
    });
}

function handleData(data) {
    if (data.type === 'STATE_UPDATE') {
        if (data.hostRank) opponentStats.rank = data.hostRank;
        if (data.token) matchSecurityToken = data.token;
        syncState(data.state, data.serverTime);
    } else if (data.type === 'ACTION' && isHost) {
        processAction(data.action, 'O');
    } else if (data.type === 'TOAST') {
        showToast(data.msg, data.color);
    } else if (data.type === 'CHAT') {
        showToast(data.msg, "var(--o-color)");
    } else if (data.type === 'RESTART' && !isHost) {
        GameState.scores = { 'X': 0, 'O': 0 };
        openScreen('ui-layer');
    }
}

// ==========================================================================
// IA NECROMANTE v3.0 (Minimax Tático com Compreensão de Cartas e Regra FIFO)
// ==========================================================================
function startBotMatch() {
    if (peer) peer.destroy();
    isBotMatch = true; isHost = true; mySide = 'X';
    GameState.names['X'] = myName;
    GameState.names['O'] = "NECROMANTE-v3";
    startGame();
}

function botTurn() {
    if (GameState.winner || GameState.turn !== 'O') return;
    
    setTimeout(() => {
        const hand = GameState.hands['O'];
        const emptyCells = [];
        for (let i = 0; i < 9; i++) if (GameState.board[i] === null) emptyCells.push(i);

        let chosenAction = null;

        // 1. Tática Ofensiva: Verificar Vitória Imediata com PLACE
        const placeIdx = hand.indexOf('PLACE');
        if (placeIdx !== -1) {
            for (const cell of emptyCells) {
                // Simulação com regra FIFO (se já tiver 3 peças, a mais antiga remove-se)
                const boardCopy = [...GameState.board];
                const histCopy = [...GameState.history['O']];
                if (histCopy.length >= 3) boardCopy[histCopy[0]] = null;
                boardCopy[cell] = 'O';
                if (checkSimulatedLineWin(boardCopy, 'O')) {
                    chosenAction = { type: 'PLACE', target: cell, cardIdx: placeIdx };
                    break;
                }
            }
        }

        // 2. Tática Defensiva: Bloquear Vitória Iminente do Jogador com PLACE
        if (!chosenAction && placeIdx !== -1) {
            for (const cell of emptyCells) {
                const boardCopy = [...GameState.board];
                const histCopy = [...GameState.history['X']];
                if (histCopy.length >= 3) boardCopy[histCopy[0]] = null;
                boardCopy[cell] = 'X';
                if (checkSimulatedLineWin(boardCopy, 'X')) {
                    chosenAction = { type: 'PLACE', target: cell, cardIdx: placeIdx };
                    break;
                }
            }
        }

        // 3. Tática Destrutiva: Uso inteligente de BOMBA
        const bombIdx = hand.indexOf('BOMB');
        if (!chosenAction && bombIdx !== -1) {
            // Destruir peças do jogador que estejam em linhas perigosas (com 2 peças alinhadas)
            const winningCombinations = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
            for (const combo of winningCombinations) {
                const pX = combo.filter(idx => GameState.board[idx] === 'X');
                const pNull = combo.filter(idx => GameState.board[idx] === null);
                if (pX.length === 2 && pNull.length === 1) {
                    const targetToBomb = pX.find(idx => !isProtected(idx));
                    if (targetToBomb !== undefined) {
                        chosenAction = { type: 'BOMB', target: targetToBomb, cardIdx: bombIdx };
                        break;
                    }
                }
            }
        }

        // 4. Tática de Blindagem: Uso de ESCUDO em peças centrais ou vitais
        const shieldIdx = hand.indexOf('SHIELD');
        if (!chosenAction && shieldIdx !== -1) {
            const myUnshieldedPieces = GameState.history['O'].filter(idx => !isProtected(idx));
            if (myUnshieldedPieces.length > 0) {
                // Prioriza proteger o centro (4) ou vértices
                const bestShieldTarget = myUnshieldedPieces.includes(4) ? 4 : myUnshieldedPieces[0];
                chosenAction = { type: 'SHIELD', target: bestShieldTarget, cardIdx: shieldIdx };
            }
        }

        // 5. Posicionamento Estratégico (Centro > Cantos > Bordas)
        if (!chosenAction && placeIdx !== -1 && emptyCells.length > 0) {
            const priorities = [4, 0, 2, 6, 8, 1, 3, 5, 7];
            const preferredMove = priorities.find(p => emptyCells.includes(p));
            chosenAction = { type: 'PLACE', target: preferredMove !== undefined ? preferredMove : emptyCells[0], cardIdx: placeIdx };
        }

        // 6. Falha/Timeout se não houver jogadas realizáveis
        if (!chosenAction) {
            chosenAction = { type: 'TIMEOUT' };
        }

        processAction(chosenAction, 'O');
    }, BOT_TURN_DELAY);
}

function checkSimulatedLineWin(boardState, player) {
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    return lines.some(combo => combo.every(idx => boardState[idx] === player));
}

// ==========================================================================
// LOOP DE JOGO E VALIDAÇÃO DE MANOBRAS
// ==========================================================================
function startGame() {
    GameState.scores = { 'X': 0, 'O': 0 };
    resetMatch();
}

function resetMatch() {
    resetBoard();
    GameState.winner = null;
    matchFinalized = false; // Repõe trava anti-duplicação
    GameState.hands = { 'X': generateHand(), 'O': generateHand() };
    GameState.turn = 'X';
    matchStartTime = Date.now();
    matchSecurityToken = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    
    broadcastState();
    if (isHost && !isBotMatch) sendData({ type: 'RESTART' });
}

function resetBoard() {
    GameState.board.fill(null);
    GameState.history = { 'X': [], 'O': [] };
    GameState.shields = {};
    GameState.winningLine = null;
    timeLeft = 16;
}

function generateHand() {
    const h = ['PLACE'];
    for (let i = 0; i < 2; i++) h.push(getRandomCard());
    return h;
}

function getRandomCard() {
    const r = Math.random() * 100;
    let sum = 0;
    for (const [k, d] of Object.entries(CARDS)) {
        sum += d.weight;
        if (r <= sum) return k;
    }
    return 'PLACE';
}

function processAction(action, player) {
    if (GameState.turn !== player || GameState.winningLine) return;
    const { type, target, source, cardIdx } = action;

    if (type !== 'TIMEOUT') {
        const cardInHand = GameState.hands[player][cardIdx];
        if (cardInHand !== type) return;
    }

    let success = false;

    if (type === 'PLACE' && GameState.board[target] === null) {
        if (GameState.history[player].length >= 3) {
            const oldestIdx = GameState.history[player].shift();
            GameState.board[oldestIdx] = null;
        }
        GameState.board[target] = player;
        GameState.history[player].push(target);
        success = true;
        SoundFX.place();
    }
    else if (type === 'BOMB' && GameState.board[target] !== null && !isProtected(target)) {
        const victim = GameState.board[target];
        GameState.board[target] = null;
        GameState.history[victim] = GameState.history[victim].filter(i => i !== target);
        success = true;
        SoundFX.explode();
        cameraShake = 0.6;
        spawnExplosion(target);
    }
    else if (type === 'MOVE' && GameState.board[target] === null) {
        if (GameState.board[source] === player) {
            GameState.board[source] = null;
            GameState.board[target] = player;
            GameState.history[player] = GameState.history[player].filter(i => i !== source);
            GameState.history[player].push(target);
            success = true;
            SoundFX.place();
        }
    }
    else if (type === 'PUSH' && GameState.board[target] === null) {
        const enemy = (player === 'X') ? 'O' : 'X';
        if (GameState.board[source] === enemy && !isProtected(source)) {
            GameState.board[source] = null;
            GameState.board[target] = enemy;
            GameState.history[enemy] = GameState.history[enemy].filter(i => i !== source);
            GameState.history[enemy].push(target);
            success = true;
            SoundFX.click();
        }
    }
    else if (type === 'SHIELD' && GameState.board[target] === player) {
        GameState.shields[target] = 2;
        success = true;
        SoundFX.place();
    }
    else if (type === 'SWAP' && !isProtected(target) && !isProtected(source)) {
        const enemy = (player === 'X') ? 'O' : 'X';
        if (GameState.board[source] === player && GameState.board[target] === enemy) {
            GameState.board[source] = enemy;
            GameState.board[target] = player;
            GameState.history[player] = GameState.history[player].map(i => i === source ? target : i);
            GameState.history[enemy]  = GameState.history[enemy].map(i => i === target ? source : i);
            success = true;
            SoundFX.click();
        }
    }
    else if (type === 'TIMEOUT') {
        GameState.hands[player].shift();
        GameState.hands[player].push('PLACE');
        success = true;
    }

    if (success) {
        if (type !== 'TIMEOUT') {
            GameState.hands[player].splice(cardIdx, 1);
            GameState.hands[player].push(GameState.hands[player].includes('PLACE') ? getRandomCard() : 'PLACE');
        }

        const winLineX = checkLineWin('X');
        const winLineO = checkLineWin('O');

        if (winLineX && winLineO) {
            showToast("EMPATE ASTRAL!", "var(--accent-gold)");
            SoundFX.error();
            setTimeout(() => {
                resetBoard();
                broadcastState();
                if (isBotMatch && GameState.turn === 'O') botTurn();
            }, 2200);
        } else if (winLineX || winLineO) {
            const winLine = winLineX || winLineO;
            GameState.winningLine = winLine;
            const winner = GameState.board[winLine[0]];
            GameState.scores[winner]++;
            SoundFX.roundWin();
            cameraShake = 0.8;

            if (GameState.scores[winner] >= GameState.targetWins) {
                setTimeout(() => {
                    GameState.winner = winner;
                    broadcastState();
                }, 1800);
            } else {
                setTimeout(() => {
                    resetBoard();
                    GameState.turn = (winner === 'X') ? 'O' : 'X';
                    broadcastState();
                    if (isBotMatch && GameState.turn === 'O') botTurn();
                }, 2200);
            }
        } else {
            GameState.turn = (GameState.turn === 'X') ? 'O' : 'X';
            for (let k in GameState.shields) {
                if (GameState.shields[k] > 0) GameState.shields[k]--;
            }
            timeLeft = 16;
        }

        broadcastState();
        if (isBotMatch && !winLineX && !winLineO && GameState.turn === 'O') botTurn();
    }
}

function checkLineWin(player) {
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (let c of lines) {
        if (GameState.board[c[0]] === player && GameState.board[c[1]] === player && GameState.board[c[2]] === player) {
            return c;
        }
    }
    return null;
}

function isProtected(idx) { return GameState.shields[idx] > 0; }

function broadcastState() {
    if (!isBotMatch && conn && conn.open) {
        conn.send({
            type: 'STATE_UPDATE',
            state: GameState,
            serverTime: timeLeft,
            hostRank: userStats.rank || 1000,
            token: matchSecurityToken
        });
    }
    syncState(GameState, timeLeft);
}

function syncState(newState, serverTime) {
    Object.assign(GameState, newState);
    if (!isInGame && !GameState.winner) matchStartTime = Date.now();
    if (serverTime !== undefined && Math.abs(timeLeft - serverTime) > 0.6) timeLeft = serverTime;
    
    document.getElementById('name-x').innerText = GameState.names.X;
    document.getElementById('name-o').innerText = GameState.names.O;
    
    updateVisuals();
    if (GameState.winner) {
        showGameOver();
        return;
    }
    isInGame = true;
    openScreen('ui-layer');
}

function showGameOver() {
    isInGame = false;
    openScreen('screen-gameover');
    const wName = GameState.names[GameState.winner];
    const winTitle = document.getElementById('winner-text');
    winTitle.innerText = wName + " VENCEU!";
    winTitle.style.color = (GameState.winner === 'X') ? "var(--x-color)" : "var(--o-color)";
    
    // Processamento Único de Resultado (Sem Risco de Duplicação)
    if (!matchFinalized && currentUser) {
        const won = (GameState.winner === mySide);
        saveGameResult(won, matchSecurityToken);
        if (won) showToast("RANK SUBIU!", "var(--accent-green)");
    }

    const area = document.getElementById('rematch-area');
    area.innerHTML = '';
    if (isHost) {
        const btn = document.createElement('button');
        btn.className = 'cyber-btn';
        btn.innerHTML = '<span>NOVA BATALHA</span>';
        btn.onclick = () => startGame();
        area.appendChild(btn);
    } else {
        area.innerHTML = '<p class="text-muted">Aguardando o anfitrião...</p>';
    }
}

function sendData(data) { if (conn && conn.open) conn.send(data); }
function sendAction(a) {
    if (isHost) processAction(a, 'X');
    else if (conn && conn.open) conn.send({ type: 'ACTION', action: a });
    resetSelection();
}
function resetSelection() {
    selectedHandIdx = null; activeCardType = null; stepSourceIdx = null;
    updateHandUI();
    document.getElementById('hint-pill').classList.remove('active');
}

// ==========================================================================
// RENDERIZADOR THREE.JS (Otimizado com Pooling e Atmosfera Samhain)
// ==========================================================================
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x080210, 0.035);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('canvas-container').appendChild(renderer.domElement);

const pieceGroup = new THREE.Group(); scene.add(pieceGroup);
const particlesGroup = new THREE.Group(); scene.add(particlesGroup);
const batsGroup = new THREE.Group(); scene.add(batsGroup);

// Pooling de Partículas
const PARTICLE_POOL_SIZE = 250;
const particlePool = [];
const particleGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
const particleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
    const mesh = new THREE.Mesh(particleGeo, particleMat.clone());
    mesh.visible = false;
    particlesGroup.add(mesh);
    particlePool.push({ mesh: mesh, active: false, life: 0, vel: new THREE.Vector3(), gravity: 0 });
}

function getFreeParticle() { return particlePool.find(p => !p.active); }

function spawnExplosion(idx) {
    const x = (idx % 3 - 1) * 3.1;
    const z = (Math.floor(idx / 3) - 1) * 3.1;
    for (let i = 0; i < 30; i++) {
        const p = getFreeParticle();
        if (p) {
            p.active = true;
            p.life = 1.0;
            p.mesh.position.set(x, 1, z);
            p.mesh.material.color.setHex(0xff5500);
            p.mesh.visible = true;
            p.vel.set((Math.random() - 0.5) * 0.7, Math.random() * 0.7, (Math.random() - 0.5) * 0.7);
            p.gravity = -0.015;
        }
    }
}

// Morcegos Espectrais Flutuantes (Samhain)
const bats = [];
if (ACTIVE_EVENT === 'HALLOWEEN') {
    const batGeo = new THREE.ConeGeometry(0.15, 0.4, 3);
    const batMat = new THREE.MeshBasicMaterial({ color: 0x9d00ff });
    for (let i = 0; i < 15; i++) {
        const b = new THREE.Mesh(batGeo, batMat);
        b.rotation.x = Math.PI / 2;
        b.position.set((Math.random() - 0.5) * 20, Math.random() * 6 + 2, (Math.random() - 0.5) * 20);
        batsGroup.add(b);
        bats.push({ mesh: b, speed: 0.04 + Math.random() * 0.05, angle: Math.random() * Math.PI * 2 });
    }
}

// Tabuleiro 3D
const gridHelper = new THREE.GridHelper(80, 80, 0x4a186d, 0x140524);
gridHelper.position.y = -2;
scene.add(gridHelper);

const tileGeo = new THREE.BoxGeometry(2.8, 0.25, 2.8);
const tileMat = new THREE.MeshStandardMaterial({ color: 0x12061c, roughness: 0.2, metalness: 0.8 });
const tiles = [];

for (let i = 0; i < 9; i++) {
    const t = new THREE.Mesh(tileGeo, tileMat.clone());
    t.position.set((i % 3 - 1) * 3.1, 0, (Math.floor(i / 3) - 1) * 3.1);
    t.userData = { id: i };
    const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(tileGeo),
        new THREE.LineBasicMaterial({ color: 0x5a2082, transparent: true, opacity: 0.5 })
    );
    t.add(edges);
    scene.add(t);
    tiles.push(t);
}

// Iluminação Espectral
const dl = new THREE.DirectionalLight(0xffaa55, 0.4);
dl.position.set(5, 12, 5);
scene.add(dl);

const pl1 = new THREE.PointLight(0xff5500, 1.4, 25);
pl1.position.set(6, 6, 6);
scene.add(pl1);

const pl2 = new THREE.PointLight(0x9d00ff, 1.4, 25);
pl2.position.set(-6, 6, -6);
scene.add(pl2);

scene.add(new THREE.AmbientLight(0x3d1259, 0.6));

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function updateVisuals() {
    camera.userData.targetRot = (mySide === 'X') ? 0 : Math.PI;
    pieceGroup.clear();

    GameState.board.forEach((c, i) => {
        if (c) {
            const x = (i % 3 - 1) * 3.1;
            const z = (Math.floor(i / 3) - 1) * 3.1;
            const isWinner = GameState.winningLine && GameState.winningLine.includes(i);
            const isOldest = (GameState.history[c].length === 3 && GameState.history[c][0] === i);

            let mesh;
            const hexColor = (c === 'X') ? 0xff5500 : 0x9d00ff;

            if (c === 'X') {
                // Cruz Espectral
                const g = new THREE.Group();
                const mat = new THREE.MeshStandardMaterial({
                    color: hexColor,
                    emissive: isOldest ? 0xff0000 : hexColor,
                    emissiveIntensity: isWinner ? 5.0 : (isOldest ? 3.0 : 1.6)
                });
                const b1 = new THREE.Mesh(new THREE.BoxGeometry(2, 0.35, 0.35), mat);
                b1.rotation.y = Math.PI / 4;
                const b2 = new THREE.Mesh(new THREE.BoxGeometry(2, 0.35, 0.35), mat);
                b2.rotation.y = -Math.PI / 4;
                g.add(b1); g.add(b2);
                mesh = g;
            } else {
                // Orbe/Torus Espectral
                const mat = new THREE.MeshStandardMaterial({
                    color: hexColor,
                    emissive: isOldest ? 0xff0000 : hexColor,
                    emissiveIntensity: isWinner ? 5.0 : (isOldest ? 3.0 : 1.6)
                });
                mesh = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.22, 16, 32), mat);
                mesh.rotation.x = Math.PI / 2;
            }

            mesh.position.set(x, 1, z);
            if (isWinner) mesh.userData.spinSpeed = 0.25;
            mesh.userData.isGlitching = isOldest && !isWinner;

            if (GameState.shields[i] > 0) {
                const shieldMesh = new THREE.Mesh(
                    new THREE.IcosahedronGeometry(1.25),
                    new THREE.MeshBasicMaterial({ color: 0x00ffaa, wireframe: true, transparent: true, opacity: 0.6 })
                );
                shieldMesh.userData.anim = 'shield';
                mesh.add(shieldMesh);
            }
            pieceGroup.add(mesh);
        }
    });

    document.getElementById('p1-score').querySelector('.score-val').innerText = GameState.scores.X;
    document.getElementById('p2-score').querySelector('.score-val').innerText = GameState.scores.O;

    const isTurnX = (GameState.turn === 'X');
    document.getElementById('p1-score').className = `player-score ${isTurnX ? 'active-turn' : ''}`;
    document.getElementById('p2-score').className = `player-score ${!isTurnX ? 'active-turn' : ''}`;

    updateHandUI();
}

let menuCamAngle = 0;
function animate() {
    requestAnimationFrame(animate);

    // Pulsação das luzes
    const timeNow = Date.now() * 0.003;
    pl1.intensity = 1.3 + Math.sin(timeNow) * 0.4;
    pl2.intensity = 1.3 + Math.cos(timeNow) * 0.4;

    if (isInGame) {
        if (cameraShake > 0) {
            cameraShake -= 0.05;
            if (cameraShake < 0) cameraShake = 0;
            camera.position.x += (Math.random() - 0.5) * cameraShake;
            camera.position.y += (Math.random() - 0.5) * cameraShake;
        }
        let targetRot = camera.userData.targetRot || 0;
        const curAngle = THREE.MathUtils.lerp(Math.atan2(camera.position.x, camera.position.z), targetRot, 0.05);
        if (cameraShake < 0.1) {
            camera.position.x = Math.sin(curAngle) * 14;
            camera.position.z = Math.cos(curAngle) * 14;
            camera.position.y = THREE.MathUtils.lerp(camera.position.y, 14.5, 0.08);
            camera.lookAt(0, 0, 0);
        }
    } else {
        menuCamAngle += 0.004;
        camera.position.x = Math.sin(menuCamAngle) * 17;
        camera.position.z = Math.cos(menuCamAngle) * 17;
        camera.position.y = 12;
        camera.lookAt(0, 0, 0);
    }

    gridHelper.position.z = (Date.now() * 0.001) % 2;

    pieceGroup.children.forEach(p => {
        p.rotation.y += p.userData.spinSpeed || 0.01;
        if (p.userData.isGlitching) {
            const sc = 0.9 + Math.sin(Date.now() * 0.015) * 0.12;
            p.scale.setScalar(sc);
        }
        p.children.forEach(c => {
            if (c.userData.anim === 'shield') c.rotation.z -= 0.04;
        });
    });

    // Atualização do Pool de Partículas
    particlePool.forEach(p => {
        if (p.active) {
            p.life -= 0.025;
            p.mesh.position.add(p.vel);
            if (p.gravity) p.vel.y += p.gravity;
            if (p.life <= 0) {
                p.active = false;
                p.mesh.visible = false;
            }
        }
    });

    // Animação de Morcegos
    bats.forEach(b => {
        b.angle += b.speed * 0.1;
        b.mesh.position.x += Math.cos(b.angle) * 0.05;
        b.mesh.position.z += Math.sin(b.angle) * 0.05;
    });

    renderer.render(scene, camera);
}
animate();

// Timer de Turno
setInterval(() => {
    if (!GameState.winner && document.getElementById('screen-lobby-wait').classList.contains('hidden') && isInGame) {
        if (timeLeft > 0) timeLeft -= 0.1;
        if (isHost && timeLeft <= 0) processAction({ type: 'TIMEOUT' }, GameState.turn);
        const pct = Math.max(0, (timeLeft / 16) * 100);
        const bar = document.getElementById('timer-bar');
        if (bar) bar.style.width = pct + '%';
    }
}, 100);

function handleCardClick(idx, type) {
    if (GameState.turn !== mySide) return;
    if (selectedHandIdx === idx) { resetSelection(); return; }
    selectedHandIdx = idx; activeCardType = type; stepSourceIdx = null;
    SoundFX.click();
    updateHandUI();

    const hints = {
        'PLACE': 'Seleciona uma casa vazia',
        'BOMB':  'Seleciona uma peça inimiga',
        'SHIELD':'Seleciona a tua peça',
        'MOVE':  '1. Seleciona a tua peça',
        'PUSH':  '1. Seleciona a peça inimiga',
        'SWAP':  '1. A tua peça / Inimigo'
    };
    const pill = document.getElementById('hint-pill');
    pill.innerText = hints[type] || '';
    pill.classList.add('active');
}

function updateHandUI() {
    const c = document.getElementById('hand-container');
    if (!c || !GameState.hands[mySide]) return;
    c.innerHTML = '';
    GameState.hands[mySide].forEach((k, i) => {
        const d = CARDS[k];
        const el = document.createElement('div');
        el.className = `card ${d.rarity} ${i === selectedHandIdx ? 'selected' : ''}`;
        el.innerHTML = `<div class="card-icon">${d.icon}</div><div class="card-name">${d.name}</div>`;
        el.onclick = () => handleCardClick(i, k);
        c.appendChild(el);
    });
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onInput(clientX, clientY) {
    mouse.x = (clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const ints = raycaster.intersectObjects(tiles);

    if (ints.length && activeCardType && GameState.turn === mySide && !GameState.winningLine) {
        const idx = ints[0].object.userData.id;
        const isMy = (GameState.board[idx] === mySide);
        const isEnemy = (GameState.board[idx] !== null && !isMy);
        const isEmpty = (GameState.board[idx] === null);

        if (activeCardType === 'PLACE' && isEmpty) {
            sendAction({ type: 'PLACE', target: idx, cardIdx: selectedHandIdx });
        } else if (activeCardType === 'BOMB' && isEnemy) {
            sendAction({ type: 'BOMB', target: idx, cardIdx: selectedHandIdx });
        } else if (activeCardType === 'SHIELD' && isMy) {
            sendAction({ type: 'SHIELD', target: idx, cardIdx: selectedHandIdx });
        } else if (['MOVE', 'PUSH', 'SWAP'].includes(activeCardType)) {
            if (stepSourceIdx === null) {
                let valid = false;
                if (activeCardType === 'MOVE' && isMy) valid = true;
                if (activeCardType === 'PUSH' && isEnemy) valid = true;
                if (activeCardType === 'SWAP' && (isMy || isEnemy)) valid = true;

                if (valid) {
                    stepSourceIdx = idx;
                    document.getElementById('hint-pill').innerText = "2. Seleciona o destino";
                    SoundFX.hover();
                } else {
                    showToast("ALVO INVÁLIDO", "var(--accent-red)");
                    SoundFX.error();
                }
            } else {
                let s = stepSourceIdx;
                let t = idx;
                if (activeCardType === 'MOVE') {
                    if (GameState.board[s] === mySide && GameState.board[t] === null) {
                        sendAction({ type: 'MOVE', source: s, target: t, cardIdx: selectedHandIdx });
                    } else { stepSourceIdx = idx; SoundFX.error(); }
                } else if (activeCardType === 'PUSH') {
                    const enemy = (mySide === 'X') ? 'O' : 'X';
                    if (GameState.board[s] === enemy && GameState.board[t] === null) {
                        sendAction({ type: 'PUSH', source: s, target: t, cardIdx: selectedHandIdx });
                    } else { stepSourceIdx = idx; SoundFX.error(); }
                } else if (activeCardType === 'SWAP') {
                    if (GameState.board[s] !== mySide) { const tmp = s; s = t; t = tmp; }
                    const enemy = (mySide === 'X') ? 'O' : 'X';
                    if (GameState.board[s] === mySide && GameState.board[t] === enemy) {
                        sendAction({ type: 'SWAP', source: s, target: t, cardIdx: selectedHandIdx });
                    } else { stepSourceIdx = idx; SoundFX.error(); }
                }
            }
        }
    }
}

window.addEventListener('mousedown', e => { if (e.button === 0) onInput(e.clientX, e.clientY); else resetSelection(); });
window.addEventListener('touchstart', e => {
    if (e.touches.length > 0 && e.target.tagName === 'CANVAS') {
        onInput(e.touches[0].clientX, e.touches[0].clientY);
    }
}, { passive: true });

function showToast(msg, color) {
    const t = document.getElementById('toast-msg');
    if (!t) return;
    t.innerText = msg;
    t.style.borderColor = color;
    t.style.boxShadow = `0 0 25px ${color}`;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
}

function sendChat(emoji) {
    if (!isInGame) return;
    showToast(emoji, "var(--o-color)");
    if (conn && conn.open && !isBotMatch) conn.send({ type: 'CHAT', msg: emoji });
}

function quitGame() {
    if (conn) conn.close();
    location.reload();
}

// ==========================================================================
// CRIPTA DE MINI-JOGOS: IMPLEMENTAÇÃO DO MOTOR
// ==========================================================================
let mgInterval = null;
let mgTimeLeft = 30;
let mgScore = 0;
let mgType = null;

function startMiniGame(type) {
    mgType = type;
    document.querySelector('.minigames-selection').classList.add('hidden');
    document.getElementById('minigame-active-stage').classList.remove('hidden');

    if (type === 'ghost-hunt') {
        document.getElementById('mg-title').innerText = "CAÇA AOS ESPECTROS";
        mgTimeLeft = 30;
        mgScore = 0;
        document.getElementById('mg-score').innerText = "Pontos: 0";
        setupGhostHuntStage();
    } else if (type === 'puzzle-tactics') {
        document.getElementById('mg-title').innerText = "DESAFIO TÁTICO #01";
        document.getElementById('mg-timer').innerText = "Objetivo: Mate em 1";
        document.getElementById('mg-score').innerText = "Dificuldade: Normal";
        setupPuzzleTacticsStage();
    }
}

function setupGhostHuntStage() {
    const frame = document.getElementById('mg-board-container');
    frame.innerHTML = '';
    for (let i = 0; i < 9; i++) {
        const tile = document.createElement('div');
        tile.className = 'mg-tile';
        tile.id = `mg-tile-${i}`;
        tile.onclick = () => hitGhost(i);
        frame.appendChild(tile);
    }

    clearInterval(mgInterval);
    mgInterval = setInterval(() => {
        mgTimeLeft--;
        document.getElementById('mg-timer').innerText = `Tempo: ${mgTimeLeft}s`;
        if (mgTimeLeft <= 0) {
            endGhostHunt();
            return;
        }
        renderGhostRandomly();
    }, 850);
}

let activeGhostTile = -1;
function renderGhostRandomly() {
    for (let i = 0; i < 9; i++) {
        const t = document.getElementById(`mg-tile-${i}`);
        if (t) t.innerText = '';
    }
    const rnd = Math.floor(Math.random() * 9);
    activeGhostTile = rnd;
    const target = document.getElementById(`mg-tile-${rnd}`);
    if (target) target.innerText = (Math.random() > 0.4) ? '👻' : '🎃';
}

function hitGhost(idx) {
    if (idx === activeGhostTile && mgTimeLeft > 0) {
        mgScore += 10;
        SoundFX.click();
        document.getElementById('mg-score').innerText = `Pontos: ${mgScore}`;
        const target = document.getElementById(`mg-tile-${idx}`);
        if (target) target.innerText = '💥';
        activeGhostTile = -1;
    }
}

function endGhostHunt() {
    clearInterval(mgInterval);
    showToast(`FIM DO EXORCISMO! PONTUAÇÃO: ${mgScore}`, "var(--accent-green)");
    setTimeout(() => exitMiniGame(), 2500);
}

function setupPuzzleTacticsStage() {
    const frame = document.getElementById('mg-board-container');
    frame.innerHTML = '';
    // Cenário: 'X' tem [0, 1] e precisa de [2] para vencer através da carta PLACE
    const puzzleBoard = ['X', 'X', null, 'O', 'O', null, null, null, null];
    puzzleBoard.forEach((p, idx) => {
        const tile = document.createElement('div');
        tile.className = 'mg-tile';
        tile.innerText = p || '';
        if (p === 'X') tile.style.color = "var(--x-color)";
        if (p === 'O') tile.style.color = "var(--o-color)";
        tile.onclick = () => {
            if (idx === 2) {
                tile.innerText = 'X';
                tile.style.color = "var(--x-color)";
                SoundFX.roundWin();
                showToast("DESAFIO SUPERADO! +10 ELO", "var(--accent-green)");
                setTimeout(() => exitMiniGame(), 2000);
            } else {
                SoundFX.error();
                showToast("MOVIMENTO INCORRETO", "var(--accent-red)");
            }
        };
        frame.appendChild(tile);
    });
}

function exitMiniGame() {
    clearInterval(mgInterval);
    document.querySelector('.minigames-selection').classList.remove('hidden');
    document.getElementById('minigame-active-stage').classList.add('hidden');
    openScreen('screen-menu');
}
