// =================================================================
// === 在此貼上您的 FIREBASE 設定 (inventory-victory 專案) ===
// =================================================================
const firebaseConfig = {
  apiKey: "AIzaSyCvki-pmq7oPg2nTHSvKuyj6uW5H4kDKRY",
  authDomain: "inventory-victory.firebaseapp.com",
  projectId: "inventory-victory",
  storageBucket: "inventory-victory.firebasestorage.app",
  messagingSenderId: "694559093161",
  appId: "1:694559093161:web:358cea5c18660a205d54b8"
};
// =================================================================

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const App = {
    data() {
        return {
            user: null, currentView: 'inventory', inventoryLog: [],
            newEntry: { location: '', assetName: '', assetId: '', assetIdPart1: '', assetIdPart2: '', assetIdPart3: '', remarks: '' },
            showEditModal: false, editEntry: {},
            csvData: [], uploadStatus: '', isComparing: false, comparisonResults: [], downloadFilter: 'log',
            // --- 【新增】智慧清單資料 ---
            masterAssets: [], // 儲存財產總表
            listInventoryFilter: '', // 綁定篩選框
            selectedItems: [], // 儲存勾選的項目 ID
            selectAll: false, // 全選狀態
            isMarking: false // 是否正在批次標記中
        }
    },
    // 【新增】計算屬性，用於實時篩選清單
    computed: {
        filteredMasterAssets() {
            if (!this.listInventoryFilter) {
                return this.masterAssets;
            }
            const filterText = this.listInventoryFilter.toLowerCase();
            return this.masterAssets.filter(item =>
                item.assetId.toLowerCase().includes(filterText) ||
                item.assetName.toLowerCase().includes(filterText) ||
                item.location.toLowerCase().includes(filterText)
            );
        },
        inventoriedIdSet() {
            // 建立一個已盤點 ID 的集合，方便快速查找
            return new Set(this.inventoryLog.map(log => log.assetId));
        },
        // 計算當前可見且未盤點的項目ID
        visibleUninventoriedIds() {
            return this.filteredMasterAssets
                .filter(item => !this.inventoriedIdSet.has(item.assetId))
                .map(item => item.assetId);
        }
    },
    methods: {
        // --- 登入/登出/格式化 ---
        login() { /* ... */ },
        logout() { /* ... */ },
        formatDate(timestamp) { /* ... */ },

        // --- 分段輸入相關 ---
        combineAssetId() { /* ... */ },
        splitAssetId(combinedId) { /* ... */ },
        focusNext(refName) { this.$refs[refName]?.focus(); },
        clearAssetId() { this.newEntry.assetId = ''; },

        // --- 核心 CRUD ---
        async addEntry() { /* ... (包含重複檢查) ... */ },
        fetchInventoryLog() { /* ... (包含錯誤處理) ... */ },
        openEditModal(entry) { /* ... */ },
        closeEditModal() { /* ... */ },
        updateEntry() { /* ... */ },
        deleteEntry(docId) { /* ... */ },

        // --- CSV 處理 ---
        handleCsvFileSelection(event) { /* ... */ },
        importCsvData() { /* ... */ },
        async deleteMasterAssets() { /* ... */ },

        // --- 比對與下載 ---
        async runComparison() { /* ... */ },
        downloadCsv() { /* ... */ },

        // --- 【新增】智慧清單盤點方法 ---
        async fetchMasterAssets() {
            if (!this.user) return;
            try {
                const snapshot = await db.collection('master_assets').where('ownerId', '==', this.user.uid).get();
                // 同時獲取最新的盤點日誌，以更新狀態
                await this.fetchInventoryLog(); // 確保 inventoriedIdSet 是最新的
                this.masterAssets = snapshot.docs.map(doc => doc.data());
            } catch (error) {
                console.error("讀取財產總表失敗:", error);
                alert("讀取財產總表失敗，請檢查 Firestore 規則或網路連線。");
            }
        },
        toggleSelectItem(itemId, isInventoried) {
            if (isInventoried) return; // 如果已盤點，不允許勾選
            const index = this.selectedItems.indexOf(itemId);
            if (index > -1) {
                this.selectedItems.splice(index, 1); // 如果已選中，則取消選中
            } else {
                this.selectedItems.push(itemId); // 如果未選中，則加入選中列表
            }
            // 更新全選框狀態
            this.updateSelectAllState();
        },
        toggleSelectAll() {
            this.selectedItems = []; // 先清空
            if (this.selectAll) {
                // 如果全選框被勾選，則將所有可見且未盤點的項目加入 selectedItems
                 this.selectedItems = [...this.visibleUninventoriedIds];
            }
        },
        updateSelectAllState() {
             // 檢查是否所有可見且未盤點的項目都已被選中
            this.selectAll = this.visibleUninventoriedIds.length > 0 &&
                             this.visibleUninventoriedIds.every(id => this.selectedItems.includes(id));
        },
        async markSelectedAsInventoried() {
            if (this.selectedItems.length === 0) {
                return alert("請先勾選要標記為已盤點的項目。");
            }
            if (!this.user) return alert("請先登入");

            if (!confirm(`確定要將 ${this.selectedItems.length} 個選中項目標記為已盤點嗎？`)) {
                return;
            }

            this.isMarking = true;
            const batch = db.batch();
            let count = 0;
            const timestamp = firebase.firestore.FieldValue.serverTimestamp();

            for (const itemId of this.selectedItems) {
                // 再次確認該項目是否真的未盤點 (防止極端情況下的狀態不一致)
                if (!this.inventoriedIdSet.has(itemId)) {
                    // 從 masterAssets 找到對應的完整資料
                    const assetData = this.masterAssets.find(asset => asset.assetId === itemId);
                    if (assetData) {
                        const logRef = db.collection('inventory_log').doc(); // 自動生成 ID
                        batch.set(logRef, {
                            assetId: assetData.assetId,
                            assetName: assetData.assetName,
                            location: assetData.location,
                            userId: this.user.uid,
                            remarks: '透過清單盤點標記', // 自動加入備註
                            timestamp: timestamp
                        });
                        count++;
                    }
                }
            }

            if (count === 0) {
                 this.isMarking = false;
                 return alert("沒有需要標記的新項目（可能已被盤點）。");
            }

            try {
                await batch.commit();
                alert(`成功標記 ${count} 個項目為已盤點。`);
                this.selectedItems = []; // 清空選中項
                this.selectAll = false; // 取消全選
                // 重新獲取盤點日誌以更新狀態 (fetchInventoryLog 會自動觸發列表更新)
                // this.fetchInventoryLog(); // fetchMasterAssets 內部已調用
            } catch (error) {
                console.error("批次標記失敗:", error);
                alert("批次標記失敗，請稍後再試。");
            } finally {
                this.isMarking = false;
            }
        }

    },
    mounted() {
        auth.onAuthStateChanged(user => {
            this.user = user;
            if (user) {
                // 登入後先獲取盤點日誌，然後根據當前視圖決定是否獲取總表
                this.fetchInventoryLog();
                 if (this.currentView === 'listInventory') {
                    this.fetchMasterAssets();
                 }
                this.newEntry.location = localStorage.getItem('lastLocation') || '';
                this.newEntry.assetName = localStorage.getItem('lastAssetName') || '';
            } else {
                Object.assign(this.$data, this.$options.data());
            }
        });
    },
    watch: {
        currentView(newView) {
            // 切換視圖時的操作
            if (newView === 'compare') this.runComparison();
            if (newView === 'listInventory') this.fetchMasterAssets();
            // 切換到清單盤點時，重置篩選和選中狀態
            if (newView === 'listInventory') {
                this.listInventoryFilter = '';
                this.selectedItems = [];
                this.selectAll = false;
            }
        },
        // 當篩選文字或原始資料變化時，更新全選框狀態
        filteredMasterAssets() { this.updateSelectAllState(); },
        inventoryLog() { this.updateSelectAllState(); }, // 當盤點日誌變化時 (例如批次標記後)，也要更新全選狀態
         // 分段輸入監聽器
        'newEntry.assetIdPart1'() { this.combineAssetId(); },
        'newEntry.assetIdPart2'() { this.combineAssetId(); },
        'newEntry.assetIdPart3'() { this.combineAssetId(); },
        'newEntry.assetId'(newValue) {
             const combinedFromParts = `${String(this.newEntry.assetIdPart1 || '').trim()}-${String(this.newEntry.assetIdPart2 || '').trim()}-${String(this.newEntry.assetIdPart3 || '').trim()}`;
             if (newValue !== combinedFromParts) { this.splitAssetId(newValue); }
        }
    },
    // HTML 模板 (已加入智慧清單介面)
    template: `
        <header><h1>學校財產盤點系統</h1><div id="auth-container"><template v-if="user"><span id="user-display">{{ user.displayName || user.email }}</span><button @click="logout">登出</button></template><button v-else @click="login">使用 Google 登入</button></div></header>
        <template v-if="user">
            <nav>
                <button @click="currentView = 'inventory'" :class="{ active: currentView === 'inventory' }">盤點輸入</button>
                <button @click="currentView = 'results'" :class="{ active: currentView === 'results' }">盤點結果</button>
                <button @click="currentView = 'upload'" :class="{ active: currentView === 'upload' }">上傳資料</button>
                <button @click="currentView = 'listInventory'" :class="{ active: currentView === 'listInventory' }">清單盤點</button>
                <button @click="currentView = 'compare'" :class="{ active: currentView === 'compare' }">比對下載</button>
            </nav>
            <main>
                <section v-if="currentView === 'inventory'" class="view"></section>
                <section v-if="currentView === 'results'" class="view"></section>
                <section v-if="currentView === 'upload'" class="view"></section>

                <section v-if="currentView === 'listInventory'" class="view">
                    <h2>5. 清單盤點</h2>
                    <div class="list-controls">
                        <input type="text" v-model="listInventoryFilter" placeholder="篩選財產編號、名稱或地點..." class="filter-input">
                        <div class="batch-actions">
                            <button @click="toggleSelectAll" class="secondary-btn small-btn">
                                <input type="checkbox" v-model="selectAll" @change="toggleSelectAll" style="margin-right: 5px;"> 全選可盤點項
                            </button>
                            <button @click="markSelectedAsInventoried" class="primary-btn small-btn" :disabled="selectedItems.length === 0 || isMarking">
                                <span v-if="isMarking">標記中...</span>
                                <span v-else>標記 {{ selectedItems.length }} 項為已盤點</span>
                            </button>
                        </div>
                    </div>

                    <div v-if="filteredMasterAssets.length === 0 && !listInventoryFilter"><p>請先上傳財產總表。</p></div>
                    <div v-else-if="filteredMasterAssets.length === 0 && listInventoryFilter"><p>找不到符合篩選條件的項目。</p></div>
                    <div v-else class="results-list">
                         <div v-for="item in filteredMasterAssets" :key="item.assetId"
                              :class="['list-inventory-item', { 'inventoried': inventoriedIdSet.has(item.assetId) }]">
                             <input type="checkbox"
                                    :checked="selectedItems.includes(item.assetId)"
                                    @change="toggleSelectItem(item.assetId, inventoriedIdSet.has(item.assetId))"
                                    :disabled="inventoriedIdSet.has(item.assetId)">
                             <div class="info">
                                 <p><strong>編號:</strong> {{ item.assetId }}</p>
                                 <p><strong>名稱:</strong> {{ item.assetName }}</p>
                                 <p><strong>地點:</strong> {{ item.location }}</p>
                             </div>
                             <div class="actions">
                                 <span v-if="inventoriedIdSet.has(item.assetId)" class="status-completed">已盤點</span>
                                 <button v-else @click="markSelectedAsInventoried([item.assetId])" class="small-btn" :disabled="isMarking">單獨標記</button>
                            </div>
                         </div>
                    </div>
                </section>

                <section v-if="currentView === 'compare'" class="view"></section>
            </main>
        </template>
        <div v-if="showEditModal" class="modal-overlay"></div>
    `
};

// --- 將 HTML 模板注入 Vue 實例 ---
App.template = `
    <header><h1>學校財產盤點系統</h1><div id="auth-container"><template v-if="user"><span id="user-display">{{ user.displayName || user.email }}</span><button @click="logout">登出</button></template><button v-else @click="login">使用 Google 登入</button></div></header>
    <template v-if="user"><nav><button @click="currentView = 'inventory'" :class="{ active: currentView === 'inventory' }">盤點輸入</button><button @click="currentView = 'results'" :class="{ active: currentView === 'results' }">盤點結果</button><button @click="currentView = 'upload'" :class="{ active: currentView === 'upload' }">上傳資料</button><button @click="currentView = 'listInventory'" :class="{ active: currentView === 'listInventory' }">清單盤點</button><button @click="currentView = 'compare'" :class="{ active: currentView === 'compare' }">比對下載</button></nav>
    <main>
        <section v-if="currentView === 'inventory'" class="view"><h2>1. 盤點輸入</h2><div class="form-group"><label>存放地點</label><input type="text" v-model="newEntry.location" placeholder="例如：電腦教室 (一)"></div><div class="form-group"><label>財產名稱</label><input type="text" v-model="newEntry.assetName" placeholder="例如：電腦主機"></div><fieldset class="form-group segmented-input"><legend>分段輸入 (財產編號)</legend><div class="input-row"><input type="text" v-model="newEntry.assetIdPart1" placeholder="XXXXXXXX" maxlength="8" ref="part1Input" @keydown="event => { if (event.key === '-') { event.preventDefault(); focusNext('part2Input'); } }"><span>-</span><input type="text" v-model="newEntry.assetIdPart2" placeholder="XX" maxlength="2" ref="part2Input" @keydown="event => { if (event.key === '-') { event.preventDefault(); focusNext('part3Input'); } }"><span>-</span><input type="text" v-model="newEntry.assetIdPart3" placeholder="XXXXXXXXX" maxlength="9" ref="part3Input"></div></fieldset><div class="clear-btn-container"><button @click="clearAssetId" class="secondary-btn small-btn">清空編號</button></div><div class="form-group"><label>完整財產編號 (自動合併)</label><input type="text" :value="newEntry.assetId" placeholder="分段輸入結果將顯示於此" readonly style="background-color: #e9ecef; color: #495057;"></div><button @click="addEntry" class="primary-btn">登錄財產</button><div class="form-group remarks-section"><label for="remarks">備註 (選填)</label><textarea id="remarks" v-model="newEntry.remarks" rows="2" placeholder="例如：螢幕有刮痕、待維修"></textarea></div></section>
        <section v-if="currentView === 'results'" class="view"><h2>2. 盤點結果</h2><div v-if="inventoryLog.length === 0"><p>尚無盤點紀錄。</p></div><div v-else class="results-list"><div v-for="entry in inventoryLog" :key="entry.id" class="result-item"><div class="info"><p><strong>編號:</strong> {{ entry.assetId }}</p><p><strong>名稱:</strong> {{ entry.assetName }}</p><p><strong>地點:</strong> {{ entry.location }}</p><p><strong>備註:</strong> {{ entry.remarks || '無' }}</p><p><small>{{ formatDate(entry.timestamp) }}</small></p></div><div class="actions"><button @click="openEditModal(entry)">編輯</button><button @click="deleteEntry(entry.id)">刪除</button></div></div></div></section>
        <section v-if="currentView === 'upload'" class="view"><h2>3. 上傳財產總表 (CSV)</h2><div class="form-group"><label for="csv-file">選擇新的 CSV 檔案</label><input type="file" @change="handleCsvFileSelection" ref="csvInput" accept=".csv" id="csv-file"><p class="description">請上傳含「財產編號」、「財產名稱」、「存放地點」欄位的檔案。</p></div><button @click="importCsvData" class="primary-btn" :disabled="csvData.length === 0">匯入 {{ csvData.length > 0 ? csvData.length + ' 筆' : '' }} 資料</button><div class="upload-status">{{ uploadStatus }}</div><hr class="divider"><div class="danger-zone"><p class="description">此操作將刪除所有已上傳的財產總表資料。此操作無法復原。</p><button @click="deleteMasterAssets" class="danger-btn">刪除全部總表資料</button></div></section>
        <section v-if="currentView === 'listInventory'" class="view"><h2>5. 清單盤點</h2><div class="list-controls"><input type="text" v-model="listInventoryFilter" placeholder="篩選財產編號、名稱或地點..." class="filter-input"><div class="batch-actions"><button @click="toggleSelectAll" class="secondary-btn small-btn"><input type="checkbox" v-model="selectAll" @change="toggleSelectAll" style="margin-right: 5px;"> 全選可盤點項 ({{visibleUninventoriedIds.length}})</button><button @click="markSelectedAsInventoried" class="primary-btn small-btn" :disabled="selectedItems.length === 0 || isMarking"><span v-if="isMarking">標記中...</span><span v-else>標記 {{ selectedItems.length }} 項為已盤點</span></button></div></div><div v-if="filteredMasterAssets.length === 0 && !listInventoryFilter"><p>請先上傳財產總表。</p></div><div v-else-if="filteredMasterAssets.length === 0 && listInventoryFilter"><p>找不到符合篩選條件的項目。</p></div><div v-else class="results-list"><div v-for="item in filteredMasterAssets" :key="item.assetId" :class="['list-inventory-item', { 'inventoried': inventoriedIdSet.has(item.assetId) }]"><input type="checkbox" :checked="selectedItems.includes(item.assetId)" @change="toggleSelectItem(item.assetId, inventoriedIdSet.has(item.assetId))" :disabled="inventoriedIdSet.has(item.assetId)"><div class="info"><p><strong>編號:</strong> {{ item.assetId }}</p><p><strong>名稱:</strong> {{ item.assetName }}</p><p><strong>地點:</strong> {{ item.location }}</p></div><div class="actions"><span v-if="inventoriedIdSet.has(item.assetId)" class="status-completed">已盤點</span><button v-else @click="markSelectedAsInventoried([item.assetId])" class="small-btn primary-btn" :disabled="isMarking">單獨標記</button></div></div></div></section>
        <section v-if="currentView === 'compare'" class="view"><h2>4. 資料比對與下載</h2><div class="download-controls"><div class="form-group"><label for="download-filter">選擇要下載的資料</label><select v-model="downloadFilter" id="download-filter"><option value="log">盤點結果 (掃描紀錄)</option><option value="completed">僅盤點完成 (比對後)</option><option value="pending">僅未盤點 (比對後)</option><option value="all">全部財產 (比對後)</option></select></div><button @click="downloadCsv" class="primary-btn">下載篩選結果 (CSV)</button></div><div class="comparison-table-container"><div v-if="isComparing" class="loading-overlay">正在比對資料...</div><table v-else><thead><tr><th>狀態</th><th>財產編號</th><th>財產名稱</th><th>存放地點</th></tr></thead><tbody><tr v-if="comparisonResults.length === 0"><td colspan="4">尚無資料可比對，請先上傳財產總表。</td></tr><tr v-for="item in comparisonResults" :key="item.assetId"><td><span :class="'status-' + item.status">{{ item.status === 'completed' ? '盤點完成' : '未盤點' }}</span></td><td>{{ item.assetId }}</td><td>{{ item.assetName }}</td><td>{{ item.location }}</td></tr></tbody></table></div></section>
    </main></template>
    <div v-if="showEditModal" class="modal-overlay"><div class="modal-content"><h2>編輯盤點紀錄</h2><div class="form-group"><label>財產編號</label><input type="text" :value="editEntry.assetId" readonly></div><div class="form-group"><label>財產名稱</label><input type="text" v-model="editEntry.assetName"></div><div class="form-group"><label>存放地點</label><input type="text" v-model="editEntry.location"></div><div class="form-group"><label>備註</label><textarea v-model="editEntry.remarks" rows="3"></textarea></div><div class="modal-actions"><button @click="updateEntry" class="primary-btn">儲存變更</button><button @click="closeEditModal">取消</button></div></div></div>
`;

Vue.createApp(App).mount('#app');