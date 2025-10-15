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

// --- 全域 DOM 元素 ---
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
    if (viewId === 'compare-view') runComparison();
};

// --- INVENTORY (盤點介面 - VIEW 1) ---
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

    if (!file.type.startsWith('image/')) return alert('請上傳圖片檔案！');
    if (file.size > 5 * 1024 * 1024) return alert('圖片檔案大小不能超過 5MB！');

    imagePreview.src = URL.createObjectURL(file);
    imagePreview.style.display = 'block';
    assetIdInput.placeholder = '圖片上傳中...';
    scanBtn.disabled = true;

    // 修正後的檔名與路徑
    const fileName = `${Date.now()}-${file.name}`;
    const filePath = `users/${user.uid}/${fileName}`;
    const storageRef = storage.ref(filePath);

    try {
        await storageRef.put(file);
        assetIdInput.placeholder = '圖片上傳成功，辨識中...';
        
        const resultDocRef = db.collection("ocr_results").doc(fileName);
        const unsubscribe = resultDocRef.onSnapshot((doc) => {
            if (doc.exists) {
                const data = doc.data();
                const detectedAssetId = data.assetId;
                if (detectedAssetId === "COULD_NOT_DETECT") {
                    assetIdInput.value = '';
                    assetIdInput.placeholder = '辨識失敗，請手動輸入';
                    alert('後端 OCR 辨識失敗，請確認標籤是否清晰可見。');
                } else {
                    assetIdInput.value = detectedAssetId;
                    assetIdInput.placeholder = '掃描結果會顯示於此';
                }
                scanBtn.disabled = false;
                ocrFileInput.value = '';
                unsubscribe();
            }
        });

        setTimeout(() => {
            unsubscribe();
            if (scanBtn.disabled) {
                 scanBtn.disabled = false;
                 assetIdInput.placeholder = '辨識超時，請重試';
            }
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
    
    const user = auth.currentUser;
    if (!user) return alert('請先登入！');

    db.collection('inventory_log').add({
        ...data,
        remarks: "",
        userId: user.uid,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        alert(`財產 [${data.assetId}] 已成功登錄！`);
        localStorage.setItem('lastLocation', data.location);
        localStorage.setItem('lastAssetName', data.assetName);
        assetIdInput.value = '';
        imagePreview.style.display = 'none';
    }).catch(err => console.error("Log failed:", err));
});

// --- RESULTS (盤點結果 - VIEW 2) & EDIT MODAL ---
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
    const user = auth.currentUser;
    if (!user) return;
    db.collection('inventory_log').where('userId', '==', user.uid)
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

// --- UPLOAD (上傳資料 - VIEW 3) ---
const csvFileInput = document.getElementById('csv-file');
const uploadCsvBtn = document.getElementById('upload-csv-btn');
const uploadStatus = document.getElementById('upload-status');

uploadCsvBtn.addEventListener('click', () => {
    const file = csvFileInput.files[0];
    const user = auth.currentUser;
    if (!file) return alert('請選擇一個 CSV 檔案！');
    if (!user) return alert('請先登入！');

    Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: (results) => {
            uploadStatus.textContent = '開始上傳資料...';
            const batch = db.batch();
            let count = 0;
            results.data.forEach(row => {
                const assetId = row['財產編號']?.trim();
                const assetName = row['財產名稱']?.trim();
                const location = row['存放地點']?.trim();
                if (assetId && assetName && location) {
                    const docRef = db.collection('master_assets').doc(assetId);
                    batch.set(docRef, { assetId, assetName, location, status: '未盤點', lastInventoried: null, ownerId: user.uid });
                    count++;
                }
            });
            if (count > 0) {
                batch.commit().then(() => {
                    uploadStatus.textContent = `成功匯入 ${count} 筆財產資料！`;
                    alert(`成功匯入 ${count} 筆財產資料！`);
                }).catch(err => uploadStatus.textContent = `上傳失敗: ${err.message}`);
            } else {
                uploadStatus.textContent = 'CSV 檔案中未找到符合「財產編號」、「財產名稱」、「存放地點」的有效資料。';
            }
        },
        error: (err) => uploadStatus.textContent = `檔案解析失敗: ${err.message}`
    });
});

// --- COMPARE (比對資料 - VIEW 4) ---
async function runComparison() {
    const user = auth.currentUser;
    if (!user) return;

    const tableBody = document.getElementById('compare-table-body');
    tableBody.innerHTML = '<tr><td colspan="5">資料載入中...</td></tr>';

    try {
        const masterAssetsSnapshot = await db.collection('master_assets').where('ownerId', '==', user.uid).get();
        const inventoryLogSnapshot = await db.collection('inventory_log').where('userId', '==', user.uid).get();

        const inventoriedItems = new Map();
        inventoryLogSnapshot.forEach(doc => {
            const data = doc.data();
            if (!inventoriedItems.has(data.assetId) || inventoriedItems.get(data.assetId) < data.timestamp.toDate()) {
                 inventoriedItems.set(data.assetId, data.timestamp.toDate());
            }
        });
        
        tableBody.innerHTML = '';
        if (masterAssetsSnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="5">請先上傳財產總表。</td></tr>';
            return;
        }

        masterAssetsSnapshot.forEach(doc => {
            const asset = doc.data();
            const isInventoried = inventoriedItems.has(asset.assetId);
            const inventoryDate = isInventoried ? inventoriedItems.get(asset.assetId) : null;
            
            const row = tableBody.insertRow();
            row.innerHTML = `
                <td><span class="status-${isInventoried ? 'completed' : 'pending'}">${isInventoried ? '盤點完成' : '未盤點'}</span></td>
                <td>${asset.assetId}</td>
                <td>${asset.assetName}</td>
                <td>${asset.location}</td>
                <td>${inventoryDate ? inventoryDate.toLocaleDateString() : 'N/A'}</td>
            `;
        });
    } catch (err) {
        console.error("比對資料時發生錯誤:", err);
        tableBody.innerHTML = '<tr><td colspan="5">載入資料失敗，請稍後再試。</td></tr>';
    }
}

// --- DOWNLOAD (下載資料 - VIEW 5) ---
document.getElementById('download-btn').addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) return;
    
    alert('正在準備下載資料...');

    const masterAssetsSnapshot = await db.collection('master_assets').where('ownerId', '==', user.uid).get();
    const inventoryLogSnapshot = await db.collection('inventory_log').where('userId', '==', user.uid).get();

    const inventoriedIds = new Set(inventoryLogSnapshot.docs.map(doc => doc.data().assetId));
    let dataToDownload = [];
    const filterValue = document.getElementById('status-filter').value;

    masterAssetsSnapshot.forEach(doc => {
        const asset = doc.data();
        const isCompleted = inventoriedIds.has(asset.assetId);
        const shouldInclude = (filterValue === 'all') || (filterValue === 'completed' && isCompleted) || (filterValue === 'pending' && !isCompleted);
        if (shouldInclude) {
            dataToDownload.push({ '存放地點': asset.location, '財產名稱': asset.assetName, '財產編號': asset.assetId });
        }
    });

    if (dataToDownload.length === 0) return alert('沒有符合條件的資料可供下載。');

    const csv = Papa.unparse(dataToDownload);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }); // \uFEFF for Excel compatibility
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `盤點資料_${filterValue}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});
