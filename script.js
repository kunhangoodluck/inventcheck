// =================================================================
// === 在此貼上您的 FIREBASE 設定 ===
// 前往 Firebase 專案設定 -> 一般 -> 您的應用程式 -> SDK 設定與設定 -> CDN
// =================================================================
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDlZXhBjR4gfxaUw52HV8NgXTGk2us2zV8",
  authDomain: "pcchecksystem.firebaseapp.com",
  projectId: "pcchecksystem",
  storageBucket: "pcchecksystem.firebasestorage.app",
  messagingSenderId: "127347727037",
  appId: "1:127347727037:web:4882affe352084c06f75d4",
  measurementId: "G-K7F7HM4PXR"
};
// =================================================================

// 初始化 Firebase 服務
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// 全域 DOM 元素
const userDisplay = document.getElementById('user-display');
const mainContainer = document.getElementById('app-container');
const mainNav = document.getElementById('main-nav');
const views = document.querySelectorAll('.view');
const navButtons = document.querySelectorAll('nav button');

// --- AUTH (使用者認證) ---
auth.onAuthStateChanged(user => {
    mainContainer.classList.toggle('hidden', !user);
    mainNav.classList.toggle('hidden', !user);
    document.getElementById('login-btn').classList.toggle('hidden', !!user);
    document.getElementById('logout-btn').classList.toggle('hidden', !user);

    if (user) {
        userDisplay.textContent = user.displayName || user.email;
        showView('inventory-view');
        loadLastUsedInputs();
        loadInventoryResults();
    } else {
        userDisplay.textContent = '';
    }
});
document.getElementById('login-btn').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(error => console.error("Login failed:", error));
});
document.getElementById('logout-btn').addEventListener('click', () => auth.signOut());

// --- NAVIGATION (介面切換) ---
window.showView = function(viewId) {
    views.forEach(view => view.classList.toggle('hidden', view.id !== viewId));
    navButtons.forEach(btn => btn.classList.toggle('active', btn.getAttribute('onclick').includes(viewId)));
    if (viewId === 'compare-view') runComparison(); // Special case for compare view
};

// --- INVENTORY (盤點介面) ---
const locationInput = document.getElementById('location');
const assetNameInput = document.getElementById('asset-name');
const assetIdInput = document.getElementById('asset-id');
const scanBtn = document.getElementById('scan-btn');
const ocrFileInput = document.getElementById('ocr-file-input');
const imagePreview = document.getElementById('image-preview');

function loadLastUsedInputs() {
    locationInput.value = localStorage.getItem('lastLocation') || '';
    assetNameInput.value = localStorage.getItem('lastAssetName') || '';
}

scanBtn.addEventListener('click', () => ocrFileInput.click());

ocrFileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    const user = auth.currentUser;
    if (!file || !user) return;

    imagePreview.src = URL.createObjectURL(file);
    imagePreview.style.display = 'block';
    assetIdInput.placeholder = '圖片上傳中...';
    scanBtn.disabled = true;

    const fileName = `${Date.now()}-${user.uid}.jpg`;
    const filePath = `uploads/${fileName}`;
    const storageRef = storage.ref(filePath);

    try {
        await storageRef.put(file);
        assetIdInput.placeholder = '辨識中...';
        
        const resultDocRef = db.collection("ocr_results").doc(fileName);
        const unsubscribe = resultDocRef.onSnapshot({ includeMetadataChanges: true }, (doc) => {
            if (doc.exists) {
                const { assetId, error } = doc.data();
                assetIdInput.value = error ? '' : (assetId || '');
                assetIdInput.placeholder = error || '辨識失敗';
                if (error) alert(error);
                
                scanBtn.disabled = false;
                ocrFileInput.value = '';
                unsubscribe();
            }
        });

        setTimeout(() => { // Timeout
            unsubscribe();
            if (!scanBtn.disabled) return;
            scanBtn.disabled = false;
            assetIdInput.placeholder = '辨識超時，請重試';
        }, 20000);

    } catch (err) {
        console.error("Upload failed:", err);
        alert(`上傳失敗: ${err.message}`);
        scanBtn.disabled = false;
    }
});

document.getElementById('log-asset-btn').addEventListener('click', () => {
    const data = {
        location: locationInput.value.trim(),
        assetName: assetNameInput.value.trim(),
        assetId: assetIdInput.value.trim(),
    };
    if (Object.values(data).some(v => !v)) return alert('所有欄位皆為必填！');

    db.collection('inventory_log').add({
        ...data,
        remarks: "",
        userId: auth.currentUser.uid,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        alert(`財產 [${data.assetId}] 已成功登錄！`);
        localStorage.setItem('lastLocation', data.location);
        localStorage.setItem('lastAssetName', data.assetName);
        assetIdInput.value = '';
        imagePreview.style.display = 'none';
    }).catch(err => console.error("Log failed:", err));
});

// --- RESULTS (盤點結果) & EDIT MODAL ---
const resultsList = document.getElementById('results-list');
const editModal = document.getElementById('edit-modal');
const editInputs = {
    docId: document.getElementById('edit-doc-id'),
    assetId: document.getElementById('edit-asset-id'),
    assetName: document.getElementById('edit-asset-name'),
    location: document.getElementById('edit-location'),
    remarks: document.getElementById('edit-remarks'),
};

function loadInventoryResults() {
    db.collection('inventory_log').where('userId', '==', auth.currentUser.uid)
      .orderBy('timestamp', 'desc').onSnapshot(snapshot => {
        resultsList.innerHTML = snapshot.empty ? '<p>尚無盤點紀錄。</p>' : '';
        snapshot.forEach(doc => {
            const data = doc.data();
            const dataString = JSON.stringify(data).replace(/"/g, '&quot;');
            resultsList.innerHTML += `
                <div class="result-item">
                    <div class="info">
                        <p><strong>編號:</strong> ${data.assetId}</p>
                        <p><strong>名稱:</strong> ${data.assetName}</p>
                        <p><strong>地點:</strong> ${data.location}</p>
                        <p><strong>備註:</strong> ${data.remarks || '<i>無</i>'}</p>
                    </div>
                    <div class="actions">
                        <button onclick='openEditModal("${doc.id}", ${dataString})'>編輯</button>
                        <button onclick='deleteLog("${doc.id}")'>刪除</button>
                    </div>
                </div>`;
        });
    });
}
window.deleteLog = (docId) => {
    if (confirm('確定要刪除這筆紀錄嗎？')) {
        db.collection('inventory_log').doc(docId).delete();
    }
};
window.openEditModal = (docId, data) => {
    editInputs.docId.value = docId;
    editInputs.assetId.value = data.assetId;
    editInputs.assetName.value = data.assetName;
    editInputs.location.value = data.location;
    editInputs.remarks.value = data.remarks || '';
    editModal.classList.remove('hidden');
};
document.getElementById('cancel-edit-btn').addEventListener('click', () => editModal.classList.add('hidden'));
document.getElementById('save-edit-btn').addEventListener('click', () => {
    const docId = editInputs.docId.value;
    const updatedData = {
        assetName: editInputs.assetName.value.trim(),
        location: editInputs.location.value.trim(),
        remarks: editInputs.remarks.value.trim(),
    };
    db.collection('inventory_log').doc(docId).update(updatedData)
      .then(() => editModal.classList.add('hidden'))
      .catch(err => console.error("Update failed:", err));
});

// 其他功能 (上傳, 比對, 下載)
// 此處省略以保持簡潔，但您可以將先前版本的功能代碼貼回此處
