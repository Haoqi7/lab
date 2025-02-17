// app.js
import { supabase, labMiddleware } from './supabase.js'

class MedicineManager {
    constructor() {
        const urlParams = new URLSearchParams(window.location.search)
        this.labName = urlParams.get('lab')

        if (!this.labName || !/^[a-zA-Z0-9-]{3,20}$/.test(this.labName)) {
            window.location.href = 'login.html'
            return
        }

        this.originalData = []
        this.filteredData = []
        this.currentPage = 1
        this.pageSize = 6
        this.isShowingAll = false
        this.selectedMedicine = null
        this.currentAction = null

        this.domElements = {
            searchInput: document.getElementById('searchInput'),
            medicineList: document.getElementById('medicineList'),
            totalMedicines: document.getElementById('totalMedicines'),
            totalLocations: document.getElementById('totalLocations'),
            totalOperations: document.getElementById('totalOperations'),
            currentPage: document.getElementById('currentPage'),
            totalPages: document.getElementById('totalPages'),
            pagination: document.getElementById('pagination'),
            tableContainer: document.getElementById('tableContainer')
        }

        labMiddleware(this.labName)
        document.getElementById('currentLab').textContent = this.labName
        this.initEventListeners()
        this.loadMedicines()
    }

    async loadMedicines() {
        try {
            const { data, error } = await supabase
                .from('medicines')
                .select('*')
                .eq('lab_name', this.labName)
                .order('created_at', { ascending: false })

            if (error) throw error

            this.originalData = data.map(item => ({
                ...item,
                locations: item.locations || [],
                history: item.history || []
            }))

            this.filteredData = []
            this.renderTable()
            this.updateStats()
            this.toggleTableVisibility()
        } catch (error) {
            this.showToast(`数据加载失败: ${error.message}`, 'error')
        }
    }

    async saveMedicine(medicine, isUpdate = false) {
        try {
            const { data, error } = isUpdate ?
                await supabase.from('medicines').update(medicine).eq('id', medicine.id) :
                await supabase.from('medicines').insert(medicine)

            if (error) throw error
            return data
        } catch (error) {
            this.showToast(`保存失败: ${error.message}`, 'error')
            return null
        }
    }

    async addMedicine() {
        const newMed = {
            name: document.getElementById('addName').value.trim(),
            alias: document.getElementById('addAlias').value.trim(),
            quantity: parseInt(document.getElementById('addQuantity').value) || 0,
            locations: document.getElementById('addLocations').value
                .split(',')
                .map(l => l.trim())
                .filter(Boolean),
            lab_name: this.labName,
            history: []
        }

        if (newMed.quantity < 0) {
            this.showToast('库存数量不能为负数', 'warning')
            return
        }

        if (!newMed.name || newMed.locations.length === 0) {
            this.showToast('请填写所有必填字段', 'warning')
            return
        }

        const exists = this.originalData.some(m =>
            m.name.toLowerCase() === newMed.name.toLowerCase() ||
            (newMed.alias && m.alias?.toLowerCase() === newMed.alias.toLowerCase())
        )

        if (exists) {
            this.showToast('药品名称或别名已存在', 'warning')
            return
        }

        const result = await this.saveMedicine(newMed)
        if (result) {
            this.originalData.unshift(result[0])
            this.showToast('药品添加成功', 'success')
            this.hideModal('addModal')
            this.clearAddForm()
            this.renderTable()
        }
    }

    async updateMedicine() {
        const updated = {
            id: this.selectedMedicine.id,
            name: document.getElementById('editName').value.trim(),
            alias: document.getElementById('editAlias').value.trim(),
            quantity: parseInt(document.getElementById('editQuantity').value) || 0,
            locations: document.getElementById('editLocations').value
                .split(',')
                .map(l => l.trim())
                .filter(Boolean)
        }

        const exists = this.originalData.some(m =>
            m.id !== updated.id && (
                m.name.toLowerCase() === updated.name.toLowerCase() ||
                (updated.alias && m.alias?.toLowerCase() === updated.alias.toLowerCase())
            )
        )

        if (exists) {
            this.showToast('药品名称或别名已存在', 'warning')
            return
        }

        const result = await this.saveMedicine(updated, true)
        if (result) {
            Object.assign(this.selectedMedicine, updated)
            this.showToast('修改已保存', 'success')
            this.hideModal('editModal')
            this.renderTable()
        }
    }

    async deleteMedicine(id) {
        try {
            const { error } = await supabase
                .from('medicines')
                .delete()
                .eq('id', id)

            if (!error) {
                this.originalData = this.originalData.filter(m => m.id !== id)
                this.filteredData = this.filteredData.filter(m => m.id !== id)
                this.renderTable()
                this.showToast('药品已删除', 'success')
            }
        } catch (error) {
            this.showToast(`删除失败: ${error.message}`, 'error')
        }
    }

    async handleConsume(type) {
        let amount = 1
        if (type === 'consume') {
            amount = parseInt(document.getElementById('consumeAmount').value) || 1
            if (amount > this.selectedMedicine.quantity) {
                this.showToast('库存数量不足', 'error')
                return
            }
        }

        try {
            const updatedQty = this.selectedMedicine.quantity - (type === 'consume' ? amount : 0)
            const newHistory = [...this.selectedMedicine.history, {
                type,
                amount,
                date: new Date().toISOString()
            }]

            const { error } = await supabase
                .from('medicines')
                .update({
                    quantity: updatedQty,
                    history: newHistory
                })
                .eq('id', this.selectedMedicine.id)

            if (!error) {
                this.selectedMedicine.quantity = updatedQty
                this.selectedMedicine.history = newHistory
                this.renderTable()
                this.showToast(type === 'take' ?
                    `已记录取用${amount}个` :
                    `已消耗${amount}个，剩余${updatedQty}`, 'success')
            }
        } catch (error) {
            this.showToast(`操作失败: ${error.message}`, 'error')
        }
    }

    renderTable() {
        const start = (this.currentPage - 1) * this.pageSize
        const end = start + this.pageSize
        const displayData = this.filteredData.slice(start, end)

        this.domElements.medicineList.innerHTML = displayData.map(med => `
            <tr>
                <td data-label="药品名称">
                    <div class="med-name">${med.name}</div>
                    ${med.alias ? `<div class="med-alias">${med.alias}</div>` : ''}
                </td>
                <td data-label="库存数量" class="${med.quantity === 0 ? 'low-stock' : ''}">
                    ${med.quantity}${med.quantity === 0 ? ' (需补货)' : ''}
                </td>
                <td data-label="存放位置">${med.locations.join(', ')}</td>
                <td data-label="操作">
                    <button class="btn-action" onclick="medicineManager.showActionModal('${med.id}')">取用</button>
                    ${this.isShowingAll ? `
                        <button class="btn-edit" onclick="medicineManager.showEditModal('${med.id}')">编辑</button>
                        <button class="btn-delete" onclick="medicineManager.deleteMedicine('${med.id}')">删除</button>
                    ` : ''}
                </td>
            </tr>
        `).join('') || `<tr><td colspan="4" class="no-results">未找到相关药品</td></tr>`

        this.updatePagination()
    }

    updatePagination() {
        const totalPages = Math.ceil(this.filteredData.length / this.pageSize) || 1
        this.domElements.currentPage.textContent = this.currentPage
        this.domElements.totalPages.textContent = totalPages
        this.domElements.pagination.classList.toggle('hidden', totalPages <= 1)
    }

    toggleTableVisibility() {
        const hasData = this.filteredData.length > 0
        this.domElements.tableContainer.classList.toggle('hidden', !hasData)
    }

    updateStats() {
        this.domElements.totalMedicines.textContent = this.originalData.length
        const allLocations = [...new Set(this.originalData.flatMap(m => m.locations))]
        this.domElements.totalLocations.textContent = allLocations.length
        this.domElements.totalOperations.textContent = this.originalData
            .reduce((sum, m) => sum + m.history.length, 0)
    }

    handleSearch() {
        const keyword = this.domElements.searchInput.value.trim().toLowerCase()
        if (!keyword) {
            this.showToast('请输入搜索关键词', 'warning')
            return
        }

        this.filteredData = this.originalData.filter(med => {
            const searchText = `${med.name}${med.alias || ''}`.toLowerCase()
            return searchText.includes(keyword)
        })

        this.currentPage = 1
        this.renderTable()
        if (this.filteredData.length === 0) {
            this.showToast('未找到相关药品', 'warning')
        }
    }

    toggleAll() {
        this.isShowingAll = !this.isShowingAll
        this.filteredData = this.isShowingAll ? [...this.originalData] : []
        this.currentPage = 1
        this.renderTable()
        this.showToast(this.isShowingAll ? '已显示全部药品' : '已隐藏药品列表', 'success')
    }

    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--
            this.renderTable()
        }
    }

    nextPage() {
        const totalPages = Math.ceil(this.filteredData.length / this.pageSize)
        if (this.currentPage < totalPages) {
            this.currentPage++
            this.renderTable()
        }
    }

    showActionModal(id) {
        this.selectedMedicine = this.originalData.find(m => m.id === id)
        this.showModal('actionModal')
        document.getElementById('amountControl').style.display = 'none'
    }

    showEditModal(id) {
        this.selectedMedicine = this.originalData.find(m => m.id === id)
        document.getElementById('editName').value = this.selectedMedicine.name
        document.getElementById('editAlias').value = this.selectedMedicine.alias || ''
        document.getElementById('editLocations').value = this.selectedMedicine.locations.join(', ')
        document.getElementById('editQuantity').value = this.selectedMedicine.quantity
        this.showModal('editModal')
    }

    showModal(id) {
        document.getElementById(id).style.display = 'flex'
    }

    hideModal(id) {
        document.getElementById(id).style.display = 'none'
        this.selectedMedicine = null
    }

    clearAddForm() {
        ['addName', 'addAlias', 'addLocations', 'addQuantity'].forEach(id => {
            document.getElementById(id).value = ''
        })
    }

    confirmDelete() {
        const confirmName = document.getElementById('deleteConfirmInput').value.trim()
        if (confirmName.toLowerCase() === this.selectedMedicine.name.toLowerCase()) {
            this.deleteMedicine(this.selectedMedicine.id)
            this.hideModal('deleteModal')
        } else {
            this.showToast('删除操作已取消', 'warning')
        }
    }

    showToast(message, type = 'success') {
        const toast = document.createElement('div')
        toast.className = `toast toast-${type}`
        toast.innerHTML = `
            ${type === 'success' ? '✅' : type === 'warning' ? '⚠️' : '❌'}
            <span>${message}</span>
        `
        document.body.appendChild(toast)
        setTimeout(() => toast.remove(), 3000)
    }

    initEventListeners() {
        this.domElements.searchInput.addEventListener('keypress', e => {
            if (e.key === 'Enter') this.handleSearch()
        })

        window.addEventListener('resize', () => this.renderTable())
    }
}

// 初始化应用
window.medicineManager = new MedicineManager()
