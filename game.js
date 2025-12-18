/* --- CONFIGURAÇÃO DE EVENTO --- */
// TROQUE PARA false DEPOIS DO NATAL PARA VOLTAR AO NORMAL
const EVENT_CHRISTMAS = true; 

// --- CONFIG FIREBASE ---
const firebaseConfig = {
apiKey: "AIzaSyCSkDG6kWhKcuK0bhzJU7HazHBwHtuQ9zo",
authDomain: "cartas-velhas-db.firebaseapp.com",
projectId: "cartas-velhas-db",
storageBucket: "cartas-velhas-db.firebasestorage.app",
messagingSenderId: "146756048632",
appId: "1:146756048632:web:efebe19fc28ef9f87c0d0d",
measurementId: "G-H70FLB4DB4"
};

// INICIALIZAR FIREBASE
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
let currentUser = null;
let userStats = { wins: 0, losses: 0, rank: 1000, displayName: "Player" };
let opponentStats = { rank: '?', wins: '?' }; 

// --- CONFIG E DADOS ---
const APP_ID = "cv-tactics-final-v5-"; 
const MAX_PUB_ROOMS = 20;
const BOT_TIMEOUT = 10000; 

// --- CARTAS (BASE) ---
let CARDS = {
    'PLACE': { name: 'Básica', icon: '♟️', rarity: 'common', weight: 40, desc: 'Coloca uma peça. Se tiver 3, a mais velha some.' },
    'BOMB': { name: 'Bomba', icon: '💣', rarity: 'rare', weight: 15, desc: 'Destrói peça inimiga (se s/ escudo).' },
    'SHIELD': { name: 'Escudo', icon: '🛡️', rarity: 'rare', weight: 15, desc: 'Protege uma peça sua.' },
    'MOVE': { name: 'Mover', icon: '🔄', rarity: 'rare', weight: 10, desc: 'Move peça TUA para espaço vazio.' },
    'PUSH': { name: 'Empurrar', icon: '✋', rarity: 'rare', weight: 10, desc: 'Move peça INIMIGA para espaço vazio.' },
    'SWAP': { name: 'Trocar', icon: '🔁', rarity: 'legendary', weight: 10, desc: 'Troca tua peça com uma inimiga.' }
};

// --- SOBRESCRITA DE EVENTO ---
if (EVENT_CHRISTMAS) {
    CARDS['PLACE'] = { name: 'Duende', icon: '🧝', rarity: 'common', weight: 40, desc: 'Coloca um ajudante no tabuleiro.' };
    CARDS['BOMB'] = { name: 'Carvão', icon: '🎁', rarity: 'rare', weight: 15, desc: 'Presente explosivo! Destrói inimigo.' };
    CARDS['SHIELD'] = { name: 'Gelo', icon: '❄️', rarity: 'rare', weight: 15, desc: 'Congela a peça protegendo-a.' };
    
    document.body.classList.add('christmas-theme');
    const snowOverlay = document.getElementById('snow-overlay');
    if(snowOverlay) snowOverlay.classList.remove('hidden');
    
    const lightsBorder = document.getElementById('christmas-lights-border');
    if(lightsBorder) lightsBorder.classList.remove('hidden'); 

    const bootTitle = document.getElementById('boot-title');
    if(bootTitle) bootTitle.innerText = "NATAL SYSTEM v2.1";
}

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

let peer, conn, mySide = null, isHost = false, isBotMatch = false;
let timeLeft = 16, myName = "PLAYER", isQuickMatch = false;
let selectedHandIdx = null, activeCardType = null, stepSourceIdx = null;
let cameraShake = 0;
let isInGame = false;
let gameSaved = false; // --- CORREÇÃO DO BUG (TRAVA) ---
let botTimer = null;
let isMuted = false;

// --- SECURITY VARIABLES ---
let matchSecurityToken = null; 
let matchStartTime = 0; 
let socialInitialized = false; 

// --- UTILS ---
function escapeHtml(text) {
    if (!text) return text;
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- BOOT SYSTEM ---
let bootState = { animFinished: false, authFinished: false };

function checkBootState() {
    if(bootState.animFinished && bootState.authFinished) {
        let text = document.getElementById('loading-text');
        if(text) text.innerText = "> SYSTEM READY.";
        const screen = document.getElementById('loading-screen');
        if(screen) {
            screen.style.opacity = '0';
            document.getElementById('screen-menu').classList.remove('hidden');
            setTimeout(() => screen.classList.add('hidden'), 500);
        }
    }
}

window.addEventListener('load', () => {
    let bar = document.getElementById('loading-fill');
    if(bar) bar.style.width = '100%';
    setTimeout(() => { bootState.animFinished = true; checkBootState(); }, 500);
});

// --- DATABASE LOGIC ---
async function loadUserProfile(user) {
    try {
        const userRef = db.collection('players').doc(user.uid);
        userRef.set({ lastSeen: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        const doc = await userRef.get();
        if (doc.exists) {
            userStats = doc.data();
            if (userStats.rank === undefined) userRef.update({ rank: 1000, wins: 0, losses: 0 }); 
            if(userStats.hasSetNick) {
                myName = userStats.displayName;
            } else {
                document.getElementById('modal-nickname').classList.remove('hidden');
            }
        } else {
            userStats = {
                displayName: user.displayName || "Agente", 
                photoURL: user.photoURL,
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
        console.error("Erro no DB:", e);
    }
}

// --- FRIEND SYSTEM ---
let incomingInviteCode = null;

function setupFriendSystem() {
    if(!currentUser || socialInitialized) return;
    socialInitialized = true; 
    
    db.collection('friend_requests').where('to', '==', currentUser.uid).onSnapshot(snapshot => {
        const list = document.getElementById('friend-requests-list');
        if(!list) return;
        list.innerHTML = '';
        snapshot.forEach(doc => {
            const req = doc.data();
            list.innerHTML += `<div class="friend-card" style="border: 1px solid #ffaa00;"><span class="friend-name" style="color:#ffaa00;">${escapeHtml(req.fromName)} quer ser amigo.</span><div><button class="cyber-btn" style="min-width:auto; padding:5px 10px;" onclick="acceptFriend('${doc.id}', '${req.from}', '${escapeHtml(req.fromName)}')">✓</button><button class="cyber-btn secondary" style="min-width:auto; padding:5px 10px;" onclick="rejectFriend('${doc.id}')">X</button></div></div>`;
        });
    });

    db.collection('players').doc(currentUser.uid).collection('friends').onSnapshot(snapshot => {
        const list = document.getElementById('friends-list-content');
        const lobbyList = document.getElementById('lobby-friends-list');
        if(!list) return;
        list.innerHTML = ''; lobbyList.innerHTML = '';
        
        if(snapshot.empty) { list.innerHTML = '<p style="color:#aaa; text-align:center;">Busque jogadores acima.</p>'; return; }

        snapshot.forEach(async doc => {
            const f = doc.data();
            const fDoc = await db.collection('players').doc(doc.id).get();
            let isOnline = false;
            if(fDoc.exists && fDoc.data().lastSeen) {
                const diff = Date.now() - fDoc.data().lastSeen.toMillis();
                if(diff < 120000) isOnline = true; 
            }
            const html = `<div class="friend-card"><div style="display:flex; align-items:center;"><span class="status-indicator ${isOnline?'online':''}"></span><span class="friend-name">${escapeHtml(f.name)}</span></div>${isOnline ? `<button class="cyber-btn" style="min-width:auto; padding:5px 10px; font-size:0.7rem;" onclick="inviteFriend('${doc.id}')">✉️</button>` : '<span style="color:#666; font-size:0.7rem;">OFF</span>'}</div>`;
            list.innerHTML += html;
            if(isOnline && lobbyList) { document.getElementById('lobby-friends-invite').style.display = 'block'; lobbyList.innerHTML += html; }
        });
    });

    db.collection('players').doc(currentUser.uid).collection('invites').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === "added") {
                const invite = change.doc.data();
                incomingInviteCode = invite.code;
                document.getElementById('invite-text').innerText = `${escapeHtml(invite.from)} te chamou!`;
                document.getElementById('invite-modal').classList.remove('hidden');
                SoundFX.matchWin(); 
                change.doc.ref.delete(); 
            }
        });
    });
}

function searchPlayer() {
    const queryName = document.getElementById('search-player-input').value.trim();
    const resultsArea = document.getElementById('search-results-area');
    resultsArea.innerHTML = '<div class="loader"></div>';
    if(!queryName) { resultsArea.innerHTML = '<p style="color:#aaa;">Digite um nome.</p>'; return; }
    const btn = document.getElementById('btn-search'); if(btn) btn.disabled = true;

    db.collection('players').where('displayName', '==', queryName).limit(5).get()
    .then(async snapshot => {
        resultsArea.innerHTML = '';
        if(snapshot.empty) { resultsArea.innerHTML = '<p style="color:#ff3333;">Ninguém encontrado.</p>'; return; }
        for (const doc of snapshot.docs) {
            const p = doc.data();
            if(doc.id === currentUser.uid) continue; 
            const friendCheck = await db.collection('players').doc(currentUser.uid).collection('friends').doc(doc.id).get();
            const isFriend = friendCheck.exists;
            resultsArea.innerHTML += `<div class="search-result-card"><img src="${p.photoURL}" class="user-avatar"><div class="search-info"><div class="search-name">${escapeHtml(p.displayName)}</div><div class="search-rank">RANK: ${p.rank || 1000}</div></div>${isFriend ? '<span style="color:#00ff88; font-size:0.8rem;">AMIGO ✓</span>' : `<button class="cyber-btn" style="min-width:auto; padding:5px 10px;" onclick="sendFriendRequest('${doc.id}')">➕</button>`}</div>`;
        }
        if(resultsArea.innerHTML === '') resultsArea.innerHTML = '<p style="color:#aaa;">É você.</p>';
    })
    .catch(e => { console.error(e); resultsArea.innerHTML = '<p style="color:#ff3333;">Erro conexão/Permissão.</p>'; })
    .finally(() => { if(btn) btn.disabled = false; });
}

function sendFriendRequest(targetUid) {
    if(targetUid === currentUser.uid) return;
    db.collection('friend_requests').add({
        from: currentUser.uid, fromName: myName, to: targetUid, timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => { showToast("ENVIADO", "#00ff88"); searchPlayer(); });
}

function acceptFriend(reqId, friendUid, friendName) {
    db.collection('players').doc(currentUser.uid).collection('friends').doc(friendUid).set({ name: friendName });
    db.collection('players').doc(friendUid).collection('friends').doc(currentUser.uid).set({ name: myName });
    db.collection('friend_requests').doc(reqId).delete();
    showToast("ACEITO", "#00ff88");
}

function rejectFriend(reqId) { db.collection('friend_requests').doc(reqId).delete(); }

function inviteFriend(friendUid) {
    if(!peer || !peer.id) { showToast("CRIE SALA", "#ff3333"); return; }
    const code = peer.id.replace(APP_ID, '');
    db.collection('players').doc(friendUid).collection('invites').add({
        code: code, from: myName, timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => { showToast("CONVITE ENVIADO", "#00e5ff"); });
}

function acceptInvite() {
    document.getElementById('invite-modal').classList.add('hidden');
    if(incomingInviteCode) {
        document.getElementById('input-code').value = incomingInviteCode;
        openLobby('join'); connectToHost();
    }
}
function closeInvite() { document.getElementById('invite-modal').classList.add('hidden'); }

// --- ONLINE & UI ---
function startHeartbeat() {
    updateOnlineCount();
    setInterval(() => { if(currentUser) db.collection('players').doc(currentUser.uid).update({ lastSeen: firebase.firestore.FieldValue.serverTimestamp() }).catch(e=>{}); }, 60000); 
    setInterval(updateOnlineCount, 120000);
}

async function updateOnlineCount() {
    try {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        const snapshot = await db.collection('players').where('lastSeen', '>', fiveMinAgo).get();
        const count = snapshot.size || 1;
        const el = document.getElementById('online-count-val');
        const box = document.getElementById('online-counter-display');
        if(el && box) { el.innerText = count; box.classList.remove('hidden'); }
    } catch(e) {}
}

function saveInitialNickname() {
    if(!currentUser) return;
    let newNick = document.getElementById('permanent-nick-input').value.trim();
    newNick = escapeHtml(newNick); 
    if(newNick.length > 2 && newNick.length <= 10) {
        db.collection('players').doc(currentUser.uid).update({ displayName: newNick, hasSetNick: true })
        .then(() => {
            userStats.displayName = newNick; userStats.hasSetNick = true; myName = newNick;
            updateUIWithStats(); document.getElementById('modal-nickname').classList.add('hidden');
            showToast("BEM-VINDO " + newNick, "#00ff88");
        });
    } else { showToast("NOME INVÁLIDO", "#ff3333"); }
}

function saveNewNickname() {
    if(!currentUser) { showToast("ERRO", "#ff0000"); return; }
    let newNick = document.getElementById('edit-nick-input').value.trim();
    newNick = escapeHtml(newNick);
    if(newNick.length > 0 && newNick.length <= 10) {
        db.collection('players').doc(currentUser.uid).update({ displayName: newNick })
        .then(() => {
            userStats.displayName = newNick; myName = newNick;
            updateUIWithStats(); showToast("SALVO", "#00ff88");
        });
    } else { showToast("NOME INVÁLIDO", "#ff3333"); }
}

async function loadLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '<div class="loader"></div>';
    try {
        const snapshot = await db.collection('players').orderBy('rank', 'desc').limit(100).get();
        list.innerHTML = '';
        if(snapshot.empty) { list.innerHTML = '<p style="color:#aaa;">SEM DADOS</p>'; return; }
        let rank = 1;
        snapshot.forEach(doc => {
            const p = doc.data();
            const hl = (currentUser && doc.id === currentUser.uid) ? "rgba(0, 229, 255, 0.1)" : "transparent";
            list.innerHTML += `<div class="ranking-row" style="background:${hl}"><div class="rank-num">${rank++}</div><div class="rank-name">${escapeHtml(p.displayName || 'Anon')}</div><div class="rank-elo">${p.rank || 1000}</div><div class="rank-wl">${p.wins}/${p.losses}</div></div>`;
        });
    } catch(e) { list.innerHTML = '<p style="color:#ff3333;">ERRO</p>'; }
}

function updateUIWithStats() {
    const statusDiv = document.querySelector('.user-status');
    const nameDiv = document.getElementById('profile-name');
    if(statusDiv) statusDiv.innerHTML = `● Online | Rank: ${userStats.rank || 1000}`;
    if(nameDiv) nameDiv.innerText = userStats.displayName || myName;
    document.getElementById('detail-profile-img').src = currentUser ? currentUser.photoURL : '';
    document.getElementById('edit-nick-input').value = userStats.displayName || myName;
    document.getElementById('stat-rank').innerText = userStats.rank || 1000;
    document.getElementById('stat-wins').innerText = userStats.wins || 0;
    document.getElementById('stat-losses').innerText = userStats.losses || 0;
}

// --- GAME SAVING ---
function saveGameResult(isWin, token) {
    if (!token || token !== matchSecurityToken) return;
    const duration = Date.now() - matchStartTime;
    if (duration < 1000) return;
    if (!GameState.winner) return;

    if (!currentUser) return; 
    if (isBotMatch) { saveLocalHistory(isWin ? "Vitória vs BOT" : "Derrota vs BOT", isWin); return; }

    const userRef = db.collection('players').doc(currentUser.uid);
    if (isWin) {
        userRef.update({ wins: firebase.firestore.FieldValue.increment(1), rank: firebase.firestore.FieldValue.increment(25) });
        userStats.wins++; userStats.rank += 25;
        saveLocalHistory(`Vitória vs ${GameState.names[mySide==='X'?'O':'X']}`, true);
    } else {
        userRef.update({ losses: firebase.firestore.FieldValue.increment(1), rank: firebase.firestore.FieldValue.increment(-15) });
        userStats.losses++; userStats.rank -= 15;
        saveLocalHistory(`Derrota vs ${GameState.names[mySide==='X'?'O':'X']}`, false);
    }
    updateUIWithStats();
    matchSecurityToken = null; 
}

function saveLocalHistory(text, isWin) {
    let hist = JSON.parse(localStorage.getItem('cv_history') || '[]');
    hist.unshift({ text: text, win: isWin, date: new Date().toLocaleTimeString() });
    if(hist.length > 5) hist.pop();
    localStorage.setItem('cv_history', JSON.stringify(hist));
    loadMatchHistory();
}

function loadMatchHistory() {
    const div = document.getElementById('match-history-list');
    const hist = JSON.parse(localStorage.getItem('cv_history') || '[]');
    div.innerHTML = '';
    if(hist.length === 0) div.innerHTML = '<div style="text-align:center; padding-top:20px;">Sem dados.</div>';
    hist.forEach(h => {
        div.innerHTML += `<div class="history-item"><span class="${h.win?'win-tag':'lose-tag'}">${h.win?'WIN':'LOSE'}</span> ${h.text} <span style="float:right; font-size:0.7rem;">${h.date}</span></div>`;
    });
}

function showPlayerStats(side) {
    if(side === mySide) showToast(`EU: RANK ${userStats.rank || 1000}`, "#fff");
    else showToast(isBotMatch ? "BOT T-800" : `OPONENTE: RANK ${opponentStats.rank}`, "#ffff00");
}

// --- AUTH ---
function loginGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then((result) => { showToast("SUCESSO!", "#00ff88"); }).catch((error) => { showToast("ERRO", "#ff0000"); });
}
function logout() { auth.signOut().then(() => { showToast("SAIU", "#ffffff"); }); }

auth.onAuthStateChanged((user) => {
    const guestArea = document.getElementById('guest-input-area');
    const userArea = document.getElementById('user-profile-area');
    const gameControls = document.getElementById('game-controls');
    
    if (user) {
        currentUser = user;
        guestArea.classList.add('hidden'); userArea.classList.remove('hidden'); gameControls.classList.remove('hidden');
        document.getElementById('profile-img').src = user.photoURL;
        loadUserProfile(user);
    } else {
        currentUser = null;
        guestArea.classList.remove('hidden'); userArea.classList.add('hidden'); gameControls.classList.add('hidden');
        document.getElementById('modal-nickname').classList.add('hidden');
    }
    bootState.authFinished = true; checkBootState();
});

// --- UI NAVIGATION ---
function resetLobbyUI() {
    document.getElementById('lobby-host-ui').classList.add('hidden');
    document.getElementById('lobby-client-ui').classList.add('hidden');
    document.getElementById('lobby-quick-ui').classList.add('hidden');
}
function openScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(screenId);
    if(target) target.classList.remove('hidden');
    if(screenId === 'screen-cards') renderCardsHelp();
    if(screenId === 'screen-profile' && currentUser) { 
        document.getElementById('edit-nick-input').value = userStats.displayName || myName;
        updateUIWithStats(); loadMatchHistory(); 
    }
    if(screenId === 'screen-leaderboard') loadLeaderboard();
}
function renderCardsHelp() {
    const container = document.getElementById('cards-list-ui');
    container.innerHTML = '';
    for (const key in CARDS) {
        const c = CARDS[key];
        container.innerHTML += `<div class="card-row"><div class="card-preview">${c.icon}</div><div class="card-info"><div class="card-title">${c.name} <span class="card-rarity rarity-${c.rarity}">${c.rarity}</span></div><div class="card-desc-text">${c.desc}</div></div></div>`;
    }
}

// --- AUDIO FIX ---
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
    btn.classList.toggle('active');
}

function sendChat(emoji) {
    if(!isInGame) return;
    showToast(emoji, "#fff"); 
    if(conn && conn.open && !isBotMatch) conn.send({ type: 'CHAT', msg: emoji });
}

const SoundFX = {
    playTone: (freq, type, duration, vol=0.1) => {
        if(isMuted) return;
        if(audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + duration);
    },
    hover: () => SoundFX.playTone(400, 'sine', 0.1, 0.05),
    click: () => SoundFX.playTone(800, 'triangle', 0.1, 0.1),
    place: () => SoundFX.playTone(600, 'sine', 0.3, 0.2),
    explode: () => { SoundFX.playTone(100, 'sawtooth', 0.4, 0.3); },
    roundWin: () => { [440, 554, 659].forEach((f, i) => setTimeout(() => SoundFX.playTone(f, 'square', 0.4, 0.2), i*100)); },
    matchWin: () => { [440, 554, 659, 880, 1100].forEach((f, i) => setTimeout(() => SoundFX.playTone(f, 'square', 0.6, 0.3), i*150)); },
    error: () => { SoundFX.playTone(150, 'sawtooth', 0.2, 0.2); }
};

// --- NETWORKING ---
function initPeer(id = null) { return new Peer(id, { debug: 1 }); }
function copyCode() { navigator.clipboard.writeText(document.getElementById('display-code').innerText); showToast("COPIADO", "#fff"); }

function openLobby(mode) {
    const btnCreate = document.getElementById('btn-create-room');
    const btnJoin = document.getElementById('btn-join-room');
    if(btnCreate) btnCreate.disabled = true;
    if(btnJoin) btnJoin.disabled = true;

    openScreen('screen-lobby-wait'); resetLobbyUI();
    if (mode === 'host') setupHostPrivate(); 
    else if (mode === 'join') document.getElementById('lobby-client-ui').classList.remove('hidden');

    setTimeout(() => {
            if(btnCreate) btnCreate.disabled = false;
            if(btnJoin) btnJoin.disabled = false;
    }, 1000);
}

function setupHostPrivate() {
    isHost = true; mySide = 'X'; isBotMatch = false;
    resetLobbyUI(); document.getElementById('lobby-host-ui').classList.remove('hidden');
    const code = Math.random().toString(36).substr(2, 6).toUpperCase();
    document.getElementById('display-code').innerText = code;
    GameState.names['X'] = myName;
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
    btn.disabled = true; btn.innerText = "..."; stat.innerText = "A conectar...";
    if(peer) peer.destroy();
    peer = initPeer();
    peer.on('open', () => {
        conn = peer.connect(APP_ID + code, { reliable: true });
        configureConnection();
        setTimeout(() => { if(!conn.open) { btn.disabled = false; btn.innerText = "CONECTAR"; stat.innerText = "Sala não encontrada."; } }, 5000);
    });
}

// --- MATCHMAKING ---
function startQuickMatch() {
    const btn = document.getElementById('btn-quick'); if(btn) btn.disabled = true;
    isBotMatch = false; openScreen('screen-lobby-wait'); resetLobbyUI();
    document.getElementById('lobby-quick-ui').classList.remove('hidden');
    document.getElementById('quick-log').innerText = "Iniciando...";
    setTimeout(() => findPublicMatch(0), Math.random() * 1000 + 500);
}

function findPublicMatch(roomIndex) {
    if(isBotMatch) return;
    if(roomIndex >= MAX_PUB_ROOMS) {
        document.getElementById('quick-log').innerText = "Criando sala pública...";
        setTimeout(() => setupHostPrivate(), 1000);
        return;
    }
    const roomID = APP_ID + 'PUB-' + roomIndex;
    document.getElementById('quick-log').innerText = `Verificando Sala ${roomIndex + 1}...`;
    if(peer) peer.destroy();
    peer = initPeer(roomID);
    peer.on('open', () => {
        document.getElementById('quick-log').innerText = "Sala criada! Aguardando...";
        isHost = true; mySide = 'X'; GameState.names['X'] = myName;
        peer.on('connection', (c) => {
            if(conn && conn.open) { c.on('open', () => { c.send({type:'ROOM_FULL'}); setTimeout(()=>c.close(),500); }); return; }
            handleConnectionRequest(c);
        });
    });
    peer.on('error', (err) => {
        if(err.type === 'unavailable-id') connectToPublicRoom(roomID, roomIndex);
        else findPublicMatch(roomIndex + 1);
    });
}

function connectToPublicRoom(roomID, currentIdx) {
    const tempPeer = initPeer();
    tempPeer.on('open', () => {
        conn = tempPeer.connect(roomID, { reliable: true });
        conn.on('open', () => {
            isHost = false; mySide = 'O'; isBotMatch = false;
            conn.send({ type: 'JOIN_HANDSHAKE', name: myName, rank: userStats.rank||1000 });
            setupClientListener();
        });
        conn.on('data', (data) => {
            if(data.type === 'ROOM_FULL') { conn.close(); tempPeer.destroy(); findPublicMatch(currentIdx + 1); } 
            else handleData(data);
        });
        setTimeout(() => { if(!conn.open) { tempPeer.destroy(); findPublicMatch(currentIdx + 1); } }, 3000);
    });
}

// --- BOT ---
function startBotMatch() {
    if(peer) peer.destroy();
    isBotMatch = true; isHost = true; mySide = 'X';
    GameState.names['X'] = myName; GameState.names['O'] = "BOT-KRAMPUS";
    startGame();
}

function botTurn() {
    if(GameState.winner || GameState.turn !== 'O') return;
    setTimeout(() => {
        const hand = GameState.hands['O'];
        const availableMoves = [];
        for(let i=0; i<9; i++) if(GameState.board[i] === null) availableMoves.push(i);
        
        let action = null;
        const placeCardIdx = hand.indexOf('PLACE');

        if(placeCardIdx !== -1 && availableMoves.length > 0) {
            let bestMove = -1;
            for(let move of availableMoves) {
                GameState.board[move] = 'O'; if(checkLineWin('O')) bestMove = move; GameState.board[move] = null;
                if(bestMove !== -1) break;
            }
            if(bestMove === -1) {
                for(let move of availableMoves) {
                    GameState.board[move] = 'X'; if(checkLineWin('X')) bestMove = move; GameState.board[move] = null;
                    if(bestMove !== -1) break;
                }
            }
            if(bestMove === -1) bestMove = availableMoves[Math.floor(Math.random()*availableMoves.length)];
            action = { type: 'PLACE', target: bestMove, cardIdx: placeCardIdx };
        } else {
            action = { type: 'TIMEOUT' };
        }
        processAction(action, 'O');
    }, 1500);
}

// --- HANDLERS ---
function handleConnectionRequest(c) {
    conn = c;
    conn.on('data', (data) => {
        if(data.type === 'JOIN_HANDSHAKE') { 
            let safeName = data.name || "PLAYER"; if(safeName.length > 10) safeName = safeName.substr(0,10);
            GameState.names['O'] = safeName; opponentStats.rank = data.rank || '???';
            if(GameState.hands['X'].length === 0) startGame(); else broadcastState();
        }
        else handleData(data);
    });
    conn.on('close', () => { showToast("OPONENTE SAIU", "#ff0000"); setTimeout(()=>location.reload(), 3000); });
}
function configureConnection() { conn.on('open', () => { conn.send({ type: 'JOIN_HANDSHAKE', name: myName, rank: userStats.rank||1000 }); setupClientListener(); }); }
function setupClientListener() { conn.on('data', handleData); conn.on('close', () => { showToast("DESCONECTADO", "#ff0000"); setTimeout(()=>location.reload(), 3000); }); }
function handleData(data) {
    if (data.type === 'STATE_UPDATE') { 
        if(data.hostRank) opponentStats.rank = data.hostRank; 
        if(data.token) matchSecurityToken = data.token;
        syncState(data.state, data.serverTime); 
    }
    else if (data.type === 'ACTION' && isHost) processAction(data.action, 'O');
    else if (data.type === 'TOAST') showToast(data.msg, data.color);
    else if (data.type === 'CHAT') showToast(data.msg, "#00e5ff");
    else if (data.type === 'RESTART' && !isHost) { GameState.scores = { 'X': 0, 'O': 0 }; openScreen('ui-layer'); }
    else if (data.type === 'JOIN_HANDSHAKE') { let safeName = data.name || "PLAYER"; if(safeName.length > 10) safeName = safeName.substr(0,10); if(!isHost) GameState.names['X'] = safeName; opponentStats.rank = data.rank || '???'; }
}

// --- GAMEPLAY ---
function startGame() { GameState.scores = { 'X': 0, 'O': 0 }; resetMatch(); }

function resetMatch() { 
    resetBoard(); 
    GameState.winner = null; 
    // CORREÇÃO DO BUG DE DUPLICAÇÃO
    gameSaved = false; 
    
    GameState.hands = { 'X': generateHand(), 'O': generateHand() }; 
    GameState.turn = 'X'; 
    matchStartTime = Date.now();
    matchSecurityToken = Math.random().toString(36).substr(2) + Math.random().toString(36).substr(2);
    broadcastState(); 
    if(isHost && !isBotMatch) sendData({ type: 'RESTART' }); 
}

function resetBoard() { GameState.board.fill(null); GameState.history = { 'X': [], 'O': [] }; GameState.shields = {}; GameState.winningLine = null; timeLeft = 16; }
function generateHand() { const h = ['PLACE']; for(let i=0; i<2; i++) h.push(getRandomCard()); return h; }
function getRandomCard() { const r = Math.random() * 100; let s = 0; for (const [k, d] of Object.entries(CARDS)) { s += d.weight; if (r <= s) return k; } return 'PLACE'; }

function processAction(action, player) {
    if (GameState.turn !== player || GameState.winningLine) return; 
    const { type, target, source, cardIdx } = action;
    if (type !== 'TIMEOUT') {
            const cardInHand = GameState.hands[player][cardIdx];
            if (cardInHand !== type) { console.warn("CHEAT DETECTED"); return; }
    }

    let success = false; 
    if (type === 'PLACE' && GameState.board[target] === null) {
        if (GameState.history[player].length >= 3) GameState.board[GameState.history[player].shift()] = null;
        GameState.board[target] = player; GameState.history[player].push(target); success = true; SoundFX.place();
    } 
    else if (type === 'BOMB' && GameState.board[target] !== null && !isProtected(target)) {
        const v = GameState.board[target]; GameState.board[target] = null; GameState.history[v] = GameState.history[v].filter(i => i !== target);
        success = true; SoundFX.explode(); cameraShake = 0.5; spawnExplosion(target);
    }
    else if (type === 'MOVE' && GameState.board[target] === null) {
        if(GameState.board[source] === player) {
            GameState.board[source] = null; GameState.board[target] = player;
            GameState.history[player] = GameState.history[player].filter(i => i !== source); GameState.history[player].push(target); success = true; SoundFX.place();
        }
    }
    else if (type === 'PUSH' && GameState.board[target] === null) {
            const enemy = player === 'X' ? 'O' : 'X';
            if(GameState.board[source] === enemy && !isProtected(source)) {
            GameState.board[source] = null; GameState.board[target] = enemy;
            GameState.history[enemy] = GameState.history[enemy].filter(i => i !== source); GameState.history[enemy].push(target);
            success = true; SoundFX.click();
            }
    }
    else if (type === 'SHIELD' && GameState.board[target] === player) { GameState.shields[target] = 2; success = true; SoundFX.place(); }
    else if (type === 'SWAP' && !isProtected(target) && !isProtected(source)) {
        const enemy = player === 'X' ? 'O' : 'X';
        if(GameState.board[source] === player && GameState.board[target] === enemy) {
            GameState.board[source] = enemy; GameState.board[target] = player;
            GameState.history[player] = GameState.history[player].map(i => i === source ? target : i);
            GameState.history[enemy] = GameState.history[enemy].map(i => i === target ? source : i); success = true; SoundFX.click();
        }
    }
    else if (type === 'TIMEOUT') { GameState.hands[player].shift(); GameState.hands[player].push('PLACE'); success = true; }

    if (success) {
        if(type !== 'TIMEOUT') { GameState.hands[player].splice(cardIdx, 1); GameState.hands[player].push(GameState.hands[player].includes('PLACE') ? getRandomCard() : 'PLACE'); }
        
        const winLineX = checkLineWin('X');
        const winLineO = checkLineWin('O');
        
        if(winLineX && winLineO) {
            showToast("EMPATE!", "#ffffff"); SoundFX.error();
            setTimeout(() => { resetBoard(); broadcastState(); if(isBotMatch && GameState.turn === 'O') botTurn(); }, 2500);
        } else if (winLineX || winLineO) {
            const winLine = winLineX || winLineO;
            GameState.winningLine = winLine; 
            const winner = GameState.board[winLine[0]]; 
            GameState.scores[winner]++; 
            SoundFX.roundWin(); cameraShake = 0.8;
            
            if (GameState.scores[winner] >= GameState.targetWins) { setTimeout(() => { GameState.winner = winner; broadcastState(); }, 2000); } 
            else { setTimeout(() => { resetBoard(); GameState.turn = (winner === 'X' ? 'O' : 'X'); broadcastState(); if(isBotMatch && GameState.turn === 'O') botTurn(); }, 2500); }
        } else {
            GameState.turn = GameState.turn === 'X' ? 'O' : 'X'; for (let k in GameState.shields) if (GameState.shields[k] > 0) GameState.shields[k]--; timeLeft = 15;
        }
        broadcastState();
        if(isBotMatch && !winLineX && !winLineO && GameState.turn === 'O') botTurn();
    }
}

function checkLineWin(player) {
    const w = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (let c of w) { if (GameState.board[c[0]] === player && GameState.board[c[1]] === player && GameState.board[c[2]] === player) return c; } return null;
}

function isProtected(idx) { return GameState.shields[idx] > 0; }

function broadcastState() { 
    if (!isBotMatch && conn && conn.open) {
        conn.send({ 
            type: 'STATE_UPDATE', 
            state: GameState, 
            serverTime: timeLeft, 
            hostRank: userStats.rank||1000,
            token: matchSecurityToken
        }); 
    }
    syncState(GameState, timeLeft); 
}

function syncState(newState, serverTime) {
    Object.assign(GameState, newState); 
    
    if(!isInGame && !GameState.winner) matchStartTime = Date.now();

    if (serverTime !== undefined) { if(Math.abs(timeLeft - serverTime) > 0.5) timeLeft = serverTime; }
    document.getElementById('name-x').innerText = GameState.names.X; document.getElementById('name-o').innerText = GameState.names.O;
    if(isQuickMatch) document.getElementById('room-code').innerText = "RÁPIDA"; if(isBotMatch) document.getElementById('room-code').innerText = "OFFLINE";
    updateVisuals();
    if (GameState.winner) { showGameOver(); return; }
    isInGame = true; openScreen('ui-layer');
}

function showGameOver() {
    isInGame = false; openScreen('screen-gameover');
    const wName = GameState.names[GameState.winner];
    document.getElementById('winner-text').innerText = wName + " VENCEU!";
    // Cores dinâmicas para o vencedor
    const winColor = GameState.winner === 'X' ? (EVENT_CHRISTMAS ? '#ff0022' : '#ff0055') : (EVENT_CHRISTMAS ? '#ffd700' : '#00e5ff');
    document.getElementById('winner-text').style.color = winColor;
    
    if(!gameSaved) SoundFX.matchWin();
    
    // --- CORREÇÃO DO BUG DE DUPLICAÇÃO ---
    if (!gameSaved && currentUser) {
        if (GameState.winner === mySide) { 
            saveGameResult(true, matchSecurityToken); 
            showToast("RANK SUBIU!", "#00ff88"); 
        } else if (GameState.winner !== mySide) { 
            saveGameResult(false, matchSecurityToken); 
        }
        gameSaved = true; // TRAVA
    }
    
    const area = document.getElementById('rematch-area'); area.innerHTML = '';
    if(isHost) { const btn = document.createElement('button'); btn.className = 'cyber-btn'; btn.innerHTML = '<span>REVANCHE</span>'; btn.onclick = () => { startGame(); }; area.appendChild(btn); } 
    else area.innerHTML = '<p style="color:#aaa;">Aguardando Host...</p>';
}

function sendData(data) { if (conn && conn.open) conn.send(data); }
function sendAction(a) { if(isHost) processAction(a, 'X'); else { conn.send({ type: 'ACTION', action: a }); } resetSelection(); }
function resetSelection() { selectedHandIdx=null; activeCardType=null; stepSourceIdx=null; updateHandUI(); document.getElementById('hint-pill').classList.remove('active'); }

/* =========================================
   THREE.JS VISUALS & OPTIMIZATION (POOLING)
   ========================================= */
const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x050510, 0.02);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('canvas-container').appendChild(renderer.domElement);

const pieceGroup = new THREE.Group(); scene.add(pieceGroup);
const particlesGroup = new THREE.Group(); scene.add(particlesGroup);
const snowGroup = new THREE.Group(); scene.add(snowGroup);

// --- OBJECT POOLING SYSTEM ---
const PARTICLE_LIMIT = 300;
const particlePool = [];
const particleGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const particleMat = new THREE.MeshBasicMaterial({color: 0xffffff});

// Init Pool
for(let i=0; i<PARTICLE_LIMIT; i++) {
    const mesh = new THREE.Mesh(particleGeo, particleMat.clone());
    mesh.visible = false;
    particlesGroup.add(mesh);
    particlePool.push({ mesh: mesh, active: false, life: 0, vel: new THREE.Vector3() });
}

let particles = []; 

function spawnExplosion(idx) {
    const x = (idx%3-1)*3.1; const z = (Math.floor(idx/3)-1)*3.1;
    for(let i=0; i<25; i++) {
        const p = getFreeParticle();
        if(p) {
            p.active = true;
            p.life = 1.0;
            p.mesh.position.set(x, 1, z);
            p.mesh.rotation.x = Math.random();
            p.mesh.material.color.setHex(0xffaa00);
            p.mesh.visible = true;
            p.vel.set((Math.random()-0.5)*0.6, Math.random()*0.6, (Math.random()-0.5)*0.6);
            p.gravity = 0;
        }
    }
}
function spawnWinParticles(idxList) {
    idxList.forEach(idx => {
        const x = (idx%3-1)*3.1; const z = (Math.floor(idx/3)-1)*3.1;
        let color;
        if (EVENT_CHRISTMAS) {
             color = GameState.board[idx] === 'X' ? 0xff0022 : 0xffd700;
        } else {
             color = GameState.board[idx] === 'X' ? 0xff0055 : 0x00e5ff;
        }

        for(let i=0; i<15; i++) {
            const p = getFreeParticle();
            if(p) {
                p.active = true; p.life = 2.0;
                p.mesh.position.set(x + (Math.random()-0.5), 2, z + (Math.random()-0.5));
                p.mesh.material.color.setHex(color);
                p.mesh.visible = true;
                p.vel.set(0, Math.random()*0.2, 0);
                p.gravity = -0.05;
            }
        }
    });
}
function getFreeParticle() { return particlePool.find(p => !p.active); }

// --- SISTEMA DE NEVE ---
const snowflakes = [];
if(EVENT_CHRISTMAS) {
    const snowGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    const snowMat = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.8});
    for(let i=0; i<100; i++) {
        const m = new THREE.Mesh(snowGeo, snowMat);
        m.position.set((Math.random()-0.5)*20, Math.random()*10, (Math.random()-0.5)*20);
        snowGroup.add(m);
        snowflakes.push({mesh: m, speed: 0.02 + Math.random()*0.05});
    }
}

const gridHelper = new THREE.GridHelper(100, 100, 0x222222, 0x111111); gridHelper.position.y = -2; scene.add(gridHelper);
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

const tileGeo = new THREE.BoxGeometry(2.8, 0.2, 2.8);
const tileMat = new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.1, metalness: 0.8 });
const tiles = [];
for(let i=0; i<9; i++) {
    const t = new THREE.Mesh(tileGeo, tileMat.clone()); t.position.set((i%3-1)*3.1, 0, (Math.floor(i/3)-1)*3.1); t.userData = { id: i };
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(tileGeo), new THREE.LineBasicMaterial({color:0x333344, transparent:true, opacity:0.3}));
    t.add(edges); scene.add(t); tiles.push(t);
}
const dl = new THREE.DirectionalLight(0xffffff, 0.5); dl.position.set(5, 10, 5); scene.add(dl);

// LUZES TEMÁTICAS
const pl1 = new THREE.PointLight(EVENT_CHRISTMAS ? 0xff0022 : 0xff0055, 1, 30); pl1.position.set(5, 5, 5); scene.add(pl1);
const pl2 = new THREE.PointLight(EVENT_CHRISTMAS ? 0xffd700 : 0x00e5ff, 1, 30); pl2.position.set(-5, 5, -5); scene.add(pl2);
scene.add(new THREE.AmbientLight(0xffffff, 0.3));

function updateVisuals() {
    camera.userData.targetRot = (mySide==='X') ? 0 : Math.PI; 
    pieceGroup.clear();
    if(GameState.winningLine) spawnWinParticles(GameState.winningLine);
    GameState.board.forEach((c, i) => {
        if(c) {
            const x = (i%3-1)*3.1; const z = (Math.floor(i/3)-1)*3.1;
            const isWinner = GameState.winningLine && GameState.winningLine.includes(i);
            let m;
            const isOldest = GameState.history[c].length === 3 && GameState.history[c][0] === i;
            
            if(c==='X') {
                const g = new THREE.Group();
                const color = EVENT_CHRISTMAS ? 0xff0022 : 0xff0055; 
                const mat = new THREE.MeshStandardMaterial({ color: color, emissive: isOldest ? 0xff0000 : color, emissiveIntensity: isWinner ? 5.0 : (isOldest ? 3.0 : 1.5) });
                const b1=new THREE.Mesh(new THREE.BoxGeometry(2,0.4,0.4), mat); b1.rotation.y=Math.PI/4;
                const b2=new THREE.Mesh(new THREE.BoxGeometry(2,0.4,0.4), mat); b2.rotation.y=-Math.PI/4; g.add(b1); g.add(b2); m=g;
            } else {
                const color = EVENT_CHRISTMAS ? 0xffd700 : 0x00e5ff; 
                const mat = new THREE.MeshStandardMaterial({ color: color, emissive: isOldest ? 0xff0000 : color, emissiveIntensity: isWinner ? 5.0 : (isOldest ? 3.0 : 1.5) });
                m=new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.2, 16, 32), mat); m.rotation.x=Math.PI/2;
            }
            m.position.set(x, 1, z);
            if(isWinner) m.userData.spinSpeed = 0.2;
            if(!isWinner && isOldest) { m.userData.isGlitching = true; } else { m.userData.isGlitching = false; m.visible=true; m.scale.setScalar(1); }
            if(GameState.shields[i]>0) {
                const sColor = EVENT_CHRISTMAS ? 0xaaddff : 0x0088ff;
                const s = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2), new THREE.MeshBasicMaterial({color:sColor, wireframe:true, transparent:true, opacity:0.5}));
                s.userData.anim='shield'; m.add(s);
            }
            pieceGroup.add(m);
        }
    });
    document.getElementById('p1-score').querySelector('.score-val').innerText = GameState.scores.X;
    document.getElementById('p2-score').querySelector('.score-val').innerText = GameState.scores.O;
    const isTurnX = GameState.turn === 'X';
    document.getElementById('p1-score').className = `player-score ${isTurnX?'active-turn':''}`;
    document.getElementById('p2-score').className = `player-score ${!isTurnX?'active-turn':''}`;
    
    if(EVENT_CHRISTMAS) {
         document.documentElement.style.setProperty('--x-color', '#ff0022');
         document.documentElement.style.setProperty('--o-color', '#ffd700');
    }

    updateHandUI();
}

const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2(); let menuTime = 0;

function animate() {
    requestAnimationFrame(animate);

    // EFEITO DE LUZES PULSANTES (PISCA PISCA 3D)
    if(EVENT_CHRISTMAS) {
        const t = Date.now() * 0.005;
        pl1.intensity = 1.5 + Math.sin(t) * 0.5; // Vermelho pulsa
        pl2.intensity = 1.5 + Math.cos(t) * 0.5; // Dourado pulsa
    }

    if(isInGame) {
        if(cameraShake > 0) { cameraShake -= 0.05; if(cameraShake < 0) cameraShake = 0; camera.position.x += (Math.random()-0.5) * cameraShake; camera.position.y += (Math.random()-0.5) * cameraShake; camera.position.z += (Math.random()-0.5) * cameraShake; }
        let targetRot = camera.userData.targetRot || 0;
        const angle = THREE.MathUtils.lerp(Math.atan2(camera.position.x, camera.position.z), targetRot, 0.05);
        if(cameraShake < 0.1) { camera.position.x = Math.sin(angle) * 14; camera.position.z = Math.cos(angle) * 14; camera.position.y = THREE.MathUtils.lerp(camera.position.y, 15, 0.1); camera.lookAt(0,0,0); }
    } else { menuTime += 0.005; camera.position.x = Math.sin(menuTime) * 18; camera.position.z = Math.cos(menuTime) * 18; camera.position.y = 12; camera.lookAt(0,0,0); }
    gridHelper.position.z = (Date.now() * 0.002) % 2;
    
    pieceGroup.children.forEach(p => { 
        p.rotation.y += p.userData.spinSpeed || 0.01; 
        if(p.userData.isGlitching) { const scale = 0.9 + Math.sin(Date.now() * 0.01) * 0.1; p.scale.setScalar(scale); } 
        p.children.forEach(c => { if(c.userData.anim === 'shield') c.rotation.z -= 0.05; }); 
    });
    
    // PARTICLE UPDATE
    particlePool.forEach(p => {
        if(p.active) {
            p.life -= 0.02;
            p.mesh.position.add(p.vel);
            if(p.gravity) p.vel.y += p.gravity;
            if(p.life <= 0) {
                p.active = false;
                p.mesh.visible = false;
            }
        }
    });

    // SNOW UPDATE
    if(EVENT_CHRISTMAS) {
        snowflakes.forEach(s => {
            s.mesh.position.y -= s.speed;
            if(s.mesh.position.y < -5) s.mesh.position.y = 10;
        });
    }

    renderer.render(scene, camera);
}
animate();

setInterval(() => { if(!GameState.winner && document.getElementById('screen-lobby-wait').classList.contains('hidden')) { if(timeLeft > 0) timeLeft -= 0.1; if(isHost && timeLeft <= 0) processAction({ type: 'TIMEOUT' }, GameState.turn); const pct = Math.max(0, (timeLeft/15)*100); document.getElementById('timer-bar').style.width = pct + '%'; } }, 100);

function handleCardClick(idx, type) {
    if(GameState.turn !== mySide) return; if(selectedHandIdx === idx) { resetSelection(); return; }
    selectedHandIdx=idx; activeCardType=type; stepSourceIdx=null; SoundFX.click(); updateHandUI();
    
    const hint = { 
        'PLACE': EVENT_CHRISTMAS ? 'Colocar Duende' : 'Espaço vazio', 
        'BOMB': EVENT_CHRISTMAS ? 'Entregar Presente' : 'Inimigo', 
        'SHIELD': 'Sua peça', 
        'MOVE': '1. Sua peça', 
        'PUSH': '1. Peça Inimiga', 
        'SWAP': '1. Inimigo' 
    };
    document.getElementById('hint-pill').innerText = hint[type] || ''; document.getElementById('hint-pill').classList.add('active');
}

function updateHandUI() {
    const c = document.getElementById('hand-container'); c.innerHTML='';
    if(!GameState.hands[mySide]) return;
    GameState.hands[mySide].forEach((k,i)=>{
        const d=CARDS[k]; const el=document.createElement('div'); el.className=`card ${d.rarity}`;
        if(i===selectedHandIdx) el.classList.add('selected');
        el.innerHTML=`<div class="card-icon">${d.icon}</div><div class="card-name">${d.name}</div>`;
        el.onclick=()=>handleCardClick(i,k); c.appendChild(el);
    });
}

function onInput(x, y) {
    mouse.x=(x/window.innerWidth)*2-1; mouse.y=-(y/window.innerHeight)*2+1;
    raycaster.setFromCamera(mouse, camera);
    const ints=raycaster.intersectObjects(tiles);
    
    if(ints.length && activeCardType && GameState.turn===mySide && !GameState.winningLine) {
        const idx=ints[0].object.userData.id;
        const my=GameState.board[idx]===mySide, en=GameState.board[idx]&&!my, emp=!GameState.board[idx];

        if(activeCardType==='PLACE' && emp) sendAction({type:'PLACE', target:idx, cardIdx:selectedHandIdx});
        else if(activeCardType==='BOMB' && en) sendAction({type:'BOMB', target:idx, cardIdx:selectedHandIdx});
        else if(activeCardType==='SHIELD' && my) sendAction({type:'SHIELD', target:idx, cardIdx:selectedHandIdx});
        
        else if(activeCardType==='MOVE' || activeCardType==='PUSH' || activeCardType==='SWAP') {
            if(stepSourceIdx === null) {
                let isValidFirstClick = false;
                if (activeCardType === 'MOVE') { if (my || emp) isValidFirstClick = true; }
                else if (activeCardType === 'PUSH') { if (en || emp) isValidFirstClick = true; } 
                else if (activeCardType === 'SWAP') { if (my || en) isValidFirstClick = true; }

                if (isValidFirstClick) {
                    stepSourceIdx = idx;
                    document.getElementById('hint-pill').innerText = "2. Selecione o destino";
                    SoundFX.hover();
                } else {
                    showToast("ALVO INVÁLIDO", "#ff3333");
                    SoundFX.error(); 
                }
            } else {
                let s = stepSourceIdx; let t = idx;
                
                if(activeCardType==='MOVE') {
                    if(GameState.board[t]===mySide && GameState.board[s]===null) { let tmp=s;s=t;t=tmp; }
                    if(GameState.board[s]===mySide && GameState.board[t]===null) sendAction({type:'MOVE', source:s, target:t, cardIdx:selectedHandIdx});
                    else { stepSourceIdx = idx; SoundFX.error(); } 
                }
                else if(activeCardType==='PUSH') {
                        const enemy = mySide==='X'?'O':'X';
                        if(GameState.board[t]===enemy && GameState.board[s]===null) { let tmp=s;s=t;t=tmp; }
                        if(GameState.board[s]===enemy && GameState.board[t]===null) sendAction({type:'PUSH', source:s, target:t, cardIdx:selectedHandIdx});
                        else { stepSourceIdx = idx; SoundFX.error(); }
                }
                else if(activeCardType==='SWAP') {
                        if(GameState.board[s]!==mySide) { let tmp=s;s=t;t=tmp; }
                        const enemy = mySide==='X'?'O':'X';
                        if(GameState.board[s]===mySide && GameState.board[t]===enemy) sendAction({type:'SWAP', source:s, target:t, cardIdx:selectedHandIdx});
                        else { stepSourceIdx = idx; SoundFX.error(); }
                }
            }
        }
    }
}

window.addEventListener('mousedown', e => { if(e.button===0) onInput(e.clientX, e.clientY); else resetSelection(); });
window.addEventListener('touchstart', e => { if(e.touches.length > 0 && e.target.tagName === 'CANVAS') { e.preventDefault(); onInput(e.touches[0].clientX, e.touches[0].clientY); } }, {passive: false});
function showToast(m,c) { const t=document.getElementById('toast-msg'); if(t) { t.innerText=m; t.style.textShadow=`0 0 50px ${c}`; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2000); } }
function quitGame() { if(conn) conn.close(); location.reload(); }