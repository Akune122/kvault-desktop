const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_BUDGET_STATE = {
  version: 2,
  currency: '€',
  updatedAt: null,
  cloudSyncEnabled: false,
  lastCloudSyncAt: null,
  cloudFolderId: null,
  cloudFileId: null,
  profiles: {
    A: {
      id: 'A',
      name: 'Loïc',
      emoji: '🧑🏻',
      color: '#0098ff',
      monthlyIncome: 0,
      defaultSharePercent: 50
    },
    B: {
      id: 'B',
      name: 'Ma Copine',
      emoji: '👩🏻',
      color: '#ec4899',
      monthlyIncome: 0,
      defaultSharePercent: 50
    }
  },
  expenses: [],
  recurring: [],
  settlements: [],
  goals: [],
  shoppingList: [],
  deletedIds: [],
  receiptsFolderId: null
};

const CATEGORY_LABELS = {
  groceries: 'Courses & Supermarché',
  rent: 'Loyer & Charges',
  bills: 'Énergie, Internet & Abos',
  restaurant: 'Sorties, Resto & Loisirs',
  home: 'Maison & Équipement',
  vacation: 'Vacances & Week-ends',
  other: 'Autre dépense'
};

class BudgetService {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'couple-budget.json');
    this.data = null;
  }

  _newId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  }

  load() {
    if (this.data) return this.data;

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.data = {
          ...DEFAULT_BUDGET_STATE,
          ...raw,
          profiles: {
            A: { ...DEFAULT_BUDGET_STATE.profiles.A, ...(raw.profiles?.A || {}) },
            B: { ...DEFAULT_BUDGET_STATE.profiles.B, ...(raw.profiles?.B || {}) }
          },
          expenses: Array.isArray(raw.expenses) ? raw.expenses : [],
          recurring: Array.isArray(raw.recurring) ? raw.recurring : [],
          settlements: Array.isArray(raw.settlements) ? raw.settlements : [],
          goals: Array.isArray(raw.goals) ? raw.goals : [],
          shoppingList: Array.isArray(raw.shoppingList) ? raw.shoppingList : [],
          deletedIds: Array.isArray(raw.deletedIds) ? raw.deletedIds.slice(-500) : []
        };
        return this.data;
      }
    } catch (_) {
      // Fichier corrompu ou absent : initialisation propre
    }

    this.data = JSON.parse(JSON.stringify(DEFAULT_BUDGET_STATE));
    this.save(false);
    return this.data;
  }

  save(bumpTimestamp = true) {
    if (!this.data) this.load();
    if (bumpTimestamp) {
      this.data.updatedAt = new Date().toISOString();
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    return this.data;
  }

  _markDeleted(id) {
    const state = this.load();
    if (!state.deletedIds.includes(id)) {
      state.deletedIds.push(id);
      if (state.deletedIds.length > 500) {
        state.deletedIds = state.deletedIds.slice(-500);
      }
    }
  }

  getState() {
    return this.load();
  }

  setCloudSyncEnabled(enabled) {
    const state = this.load();
    state.cloudSyncEnabled = Boolean(enabled);
    return this.save();
  }

  updateProfiles(payload = {}) {
    const state = this.load();
    const incomeA = Math.max(0, Number(payload.incomeA ?? state.profiles.A.monthlyIncome) || 0);
    const incomeB = Math.max(0, Number(payload.incomeB ?? state.profiles.B.monthlyIncome) || 0);

    let shareA = Number(payload.defaultSharePercentA);
    if (!Number.isFinite(shareA) || shareA < 0 || shareA > 100) {
      if (payload.autoProrata && incomeA + incomeB > 0) {
        shareA = Math.round((incomeA / (incomeA + incomeB)) * 100);
      } else {
        shareA = state.profiles.A.defaultSharePercent ?? 50;
      }
    }
    const shareB = 100 - shareA;

    state.profiles.A = {
      ...state.profiles.A,
      name: String(payload.nameA || state.profiles.A.name || 'Profil 1').trim(),
      emoji: String(payload.emojiA || state.profiles.A.emoji || '🧑🏻').trim(),
      color: String(payload.colorA || state.profiles.A.color || '#0098ff').trim(),
      monthlyIncome: incomeA,
      defaultSharePercent: shareA
    };

    state.profiles.B = {
      ...state.profiles.B,
      name: String(payload.nameB || state.profiles.B.name || 'Profil 2').trim(),
      emoji: String(payload.emojiB || state.profiles.B.emoji || '👩🏻').trim(),
      color: String(payload.colorB || state.profiles.B.color || '#ec4899').trim(),
      monthlyIncome: incomeB,
      defaultSharePercent: shareB
    };

    if (payload.currency) {
      state.currency = String(payload.currency).trim() || '€';
    }

    return this.save();
  }

  computeExpenseShares(expense) {
    const state = this.load();
    const amount = Math.max(0, Number(expense.amount) || 0);
    const mode = expense.splitMode || 'equal';

    let shareA = amount / 2;
    let shareB = amount / 2;

    if (mode === 'equal') {
      shareA = amount * 0.5;
      shareB = amount - shareA;
    } else if (mode === 'default') {
      const pctA = Number(state.profiles.A.defaultSharePercent ?? 50) / 100;
      shareA = amount * pctA;
      shareB = amount - shareA;
    } else if (mode === 'percent') {
      const pctA = Math.min(100, Math.max(0, Number(expense.splitPercentA ?? 50))) / 100;
      shareA = amount * pctA;
      shareB = amount - shareA;
    } else if (mode === 'exact') {
      shareA = Math.min(amount, Math.max(0, Number(expense.exactShareA ?? amount / 2)));
      shareB = Math.max(0, amount - shareA);
    } else if (mode === 'full_A') {
      shareA = amount;
      shareB = 0;
    } else if (mode === 'full_B') {
      shareA = 0;
      shareB = amount;
    }

    let paidByA = 0;
    let paidByB = 0;
    if (expense.paidBy === 'A') {
      paidByA = amount;
    } else if (expense.paidBy === 'B') {
      paidByB = amount;
    } else {
      paidByA = shareA;
      paidByB = shareB;
    }

    return {
      amount,
      shareA: Math.round(shareA * 100) / 100,
      shareB: Math.round(shareB * 100) / 100,
      paidByA: Math.round(paidByA * 100) / 100,
      paidByB: Math.round(paidByB * 100) / 100,
      netForA: Math.round((paidByA - shareA) * 100) / 100
    };
  }

  addExpense(payload = {}) {
    const state = this.load();
    const amount = Math.round(Math.max(0, Number(payload.amount) || 0) * 100) / 100;
    if (!amount) {
      throw new Error('Veuillez saisir un montant valide supérieur à 0.');
    }

    const dateStr = payload.date || new Date().toISOString().slice(0, 10);
    const monthStr = dateStr.slice(0, 7);
    const nowIso = new Date().toISOString();

    const item = {
      id: this._newId('exp'),
      title: String(payload.title || 'Dépense commune').trim(),
      amount,
      date: dateStr,
      month: monthStr,
      category: payload.category || 'groceries',
      paidBy: ['A', 'B', 'both'].includes(payload.paidBy) ? payload.paidBy : 'A',
      splitMode: payload.splitMode || 'equal',
      splitPercentA: Number(payload.splitPercentA ?? state.profiles.A.defaultSharePercent ?? 50),
      exactShareA: Number(payload.exactShareA ?? amount / 2),
      status: payload.status === 'pending' ? 'pending' : 'paid',
      paidAt: payload.status === 'pending' ? null : (payload.paidAt || dateStr),
      settled: Boolean(payload.settled),
      notes: String(payload.notes || '').trim(),
      receipt: payload.receipt || null,
      recurringId: payload.recurringId || null,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    state.expenses.unshift(item);
    this.save();
    return item;
  }

  updateExpense(id, patch = {}) {
    const state = this.load();
    const idx = state.expenses.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error('Dépense introuvable.');

    const current = state.expenses[idx];
    const nextDate = patch.date || current.date;
    const nextStatus = patch.status || current.status;

    const updated = {
      ...current,
      ...patch,
      title: patch.title !== undefined ? String(patch.title || current.title).trim() : current.title,
      amount:
        patch.amount !== undefined ? Math.round(Math.max(0, Number(patch.amount) || 0) * 100) / 100 : current.amount,
      date: nextDate,
      month: nextDate.slice(0, 7),
      status: nextStatus,
      paidAt: nextStatus === 'paid' ? (current.paidAt || new Date().toISOString().slice(0, 10)) : null,
      updatedAt: new Date().toISOString()
    };

    state.expenses[idx] = updated;
    this.save();
    return updated;
  }

  deleteExpense(id) {
    const state = this.load();
    state.expenses = state.expenses.filter((e) => e.id !== id);
    this._markDeleted(id);
    this.save();
    return true;
  }

  addSettlement(payload = {}) {
    const state = this.load();
    const amount = Math.round(Math.max(0, Number(payload.amount) || 0) * 100) / 100;
    if (!amount) throw new Error('Montant de remboursement invalide.');

    const dateStr = payload.date || new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const settlement = {
      id: this._newId('settle'),
      from: payload.from === 'B' ? 'B' : 'A',
      to: payload.from === 'B' ? 'A' : 'B',
      amount,
      date: dateStr,
      month: payload.month || dateStr.slice(0, 7),
      note: String(payload.note || 'Remboursement d\'équilibrage').trim(),
      createdAt: nowIso,
      updatedAt: nowIso
    };

    state.settlements.unshift(settlement);

    if (payload.markMonthSettled && settlement.month) {
      state.expenses.forEach((exp) => {
        if (exp.month === settlement.month && exp.status === 'paid') {
          exp.settled = true;
          exp.updatedAt = nowIso;
        }
      });
    }

    this.save();
    return settlement;
  }

  deleteSettlement(id) {
    const state = this.load();
    state.settlements = state.settlements.filter((s) => s.id !== id);
    this._markDeleted(id);
    this.save();
    return true;
  }

  // ==========================================================================
  // PAIEMENTS RÉCURRENTS & CALENDRIER MENSUEL
  // ==========================================================================
  addRecurring(payload = {}) {
    const state = this.load();
    const amount = Math.round(Math.max(0, Number(payload.amount) || 0) * 100) / 100;
    if (!amount) throw new Error('Veuillez saisir un montant valide.');

    const day = Math.min(31, Math.max(1, Number(payload.dayOfMonth) || 1));
    const nowIso = new Date().toISOString();
    const item = {
      id: this._newId('rec'),
      title: String(payload.title || 'Charge fixe').trim(),
      amount,
      category: payload.category || 'rent',
      dayOfMonth: day,
      paidBy: ['A', 'B', 'both'].includes(payload.paidBy) ? payload.paidBy : 'A',
      splitMode: payload.splitMode || 'equal',
      splitPercentA: Number(payload.splitPercentA ?? state.profiles.A.defaultSharePercent ?? 50),
      exactShareA: Number(payload.exactShareA ?? amount / 2),
      notes: String(payload.notes || '').trim(),
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    state.recurring.push(item);
    state.recurring.sort((a, b) => a.dayOfMonth - b.dayOfMonth);
    this.save();
    return item;
  }

  updateRecurring(id, patch = {}) {
    const state = this.load();
    const idx = state.recurring.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('Échéance récurrente introuvable.');

    const cur = state.recurring[idx];
    const updated = {
      ...cur,
      ...patch,
      title: patch.title !== undefined ? String(patch.title || cur.title).trim() : cur.title,
      amount: patch.amount !== undefined ? Math.round(Math.max(0, Number(patch.amount) || 0) * 100) / 100 : cur.amount,
      dayOfMonth: patch.dayOfMonth !== undefined ? Math.min(31, Math.max(1, Number(patch.dayOfMonth) || 1)) : cur.dayOfMonth,
      updatedAt: new Date().toISOString()
    };

    state.recurring[idx] = updated;
    state.recurring.sort((a, b) => a.dayOfMonth - b.dayOfMonth);
    this.save();
    return updated;
  }

  deleteRecurring(id) {
    const state = this.load();
    state.recurring = state.recurring.filter((r) => r.id !== id);
    this._markDeleted(id);
    this.save();
    return true;
  }

  toggleRecurringPaidForMonth(recurringId, monthStr) {
    const state = this.load();
    const rec = state.recurring.find((r) => r.id === recurringId);
    if (!rec) throw new Error('Échéance récurrente introuvable.');

    const existingIdx = state.expenses.findIndex(
      (e) => e.recurringId === recurringId && e.month === monthStr
    );

    if (existingIdx !== -1) {
      const existing = state.expenses[existingIdx];
      if (existing.status === 'paid') {
        this._markDeleted(existing.id);
        state.expenses.splice(existingIdx, 1);
        this.save();
        return { paid: false, expense: null };
      } else {
        existing.status = 'paid';
        existing.paidAt = new Date().toISOString().slice(0, 10);
        existing.updatedAt = new Date().toISOString();
        this.save();
        return { paid: true, expense: existing };
      }
    }

    const paddedDay = String(Math.min(28, rec.dayOfMonth)).padStart(2, '0');
    const exp = this.addExpense({
      title: rec.title,
      amount: rec.amount,
      date: `${monthStr}-${paddedDay}`,
      category: rec.category,
      paidBy: rec.paidBy,
      splitMode: rec.splitMode,
      splitPercentA: rec.splitPercentA,
      exactShareA: rec.exactShareA,
      status: 'paid',
      paidAt: new Date().toISOString().slice(0, 10),
      notes: rec.notes ? `${rec.notes} (Échéance mensuelle)` : 'Échéance récurrente mensuelle',
      recurringId: rec.id
    });

    return { paid: true, expense: exp };
  }

  // ==========================================================================
  // CAGNOTTES & PROJETS COMMUNS À DEUX
  // ==========================================================================
  addGoal(payload = {}) {
    const state = this.load();
    const targetAmount = Math.round(Math.max(1, Number(payload.targetAmount) || 0) * 100) / 100;
    const nowIso = new Date().toISOString();
    const goal = {
      id: this._newId('goal'),
      title: String(payload.title || 'Projet à deux').trim(),
      emoji: String(payload.emoji || '✈️').trim(),
      targetAmount,
      savedA: Math.round(Math.max(0, Number(payload.savedA) || 0) * 100) / 100,
      savedB: Math.round(Math.max(0, Number(payload.savedB) || 0) * 100) / 100,
      deadline: payload.deadline || '',
      notes: String(payload.notes || '').trim(),
      createdAt: nowIso,
      updatedAt: nowIso
    };

    state.goals.push(goal);
    this.save();
    return goal;
  }

  contributeGoal(goalId, profileId, deltaAmount) {
    const state = this.load();
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal) throw new Error('Cagnotte introuvable.');

    const delta = Number(deltaAmount) || 0;
    if (profileId === 'B') {
      goal.savedB = Math.round(Math.max(0, (goal.savedB || 0) + delta) * 100) / 100;
    } else {
      goal.savedA = Math.round(Math.max(0, (goal.savedA || 0) + delta) * 100) / 100;
    }
    goal.updatedAt = new Date().toISOString();

    this.save();
    return goal;
  }

  deleteGoal(goalId) {
    const state = this.load();
    state.goals = state.goals.filter((g) => g.id !== goalId);
    this._markDeleted(goalId);
    this.save();
    return true;
  }

  // ==========================================================================
  // LISTE DE COURSES & ACHATS À PRÉVOIR (v0.6.0 — Pack 1)
  // ==========================================================================
  addShoppingItem(payload = {}) {
    const state = this.load();
    const name = String(payload.name || '').trim();
    if (!name) throw new Error('Veuillez saisir le nom de l\'article.');

    const nowIso = new Date().toISOString();
    const item = {
      id: this._newId('shop'),
      name,
      quantity: String(payload.quantity || '').trim(),
      estimatedPrice: Math.round(Math.max(0, Number(payload.estimatedPrice) || 0) * 100) / 100,
      category: payload.category || 'groceries',
      addedBy: payload.addedBy === 'B' ? 'B' : 'A',
      checked: false,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    state.shoppingList.unshift(item);
    this.save();
    return item;
  }

  toggleShoppingItem(id) {
    const state = this.load();
    const item = state.shoppingList.find((it) => it.id === id);
    if (!item) throw new Error('Article introuvable.');
    item.checked = !item.checked;
    item.updatedAt = new Date().toISOString();
    this.save();
    return item;
  }

  deleteShoppingItem(id) {
    const state = this.load();
    state.shoppingList = state.shoppingList.filter((it) => it.id !== id);
    this._markDeleted(id);
    this.save();
    return true;
  }

  clearCheckedShoppingItems() {
    const state = this.load();
    const checkedIds = state.shoppingList.filter((it) => it.checked).map((it) => it.id);
    checkedIds.forEach((id) => this._markDeleted(id));
    state.shoppingList = state.shoppingList.filter((it) => !it.checked);
    this.save();
    return checkedIds.length;
  }

  setReceiptsFolderId(folderId) {
    const state = this.load();
    state.receiptsFolderId = folderId;
    this.save(false);
  }

  // ==========================================================================
  // SYNCHRONISATION CLOUD PARTAGÉE SUR KDRIVE (v0.6.0 — Pack 1)
  // ==========================================================================
  _mergeCollection(localArr = [], remoteArr = [], deletedSet = new Set()) {
    const map = new Map();
    for (const item of remoteArr) {
      if (item && item.id && !deletedSet.has(item.id)) {
        map.set(item.id, item);
      }
    }
    for (const item of localArr) {
      if (!item || !item.id || deletedSet.has(item.id)) continue;
      const existing = map.get(item.id);
      if (!existing) {
        map.set(item.id, item);
      } else {
        const tLocal = new Date(item.updatedAt || item.createdAt || 0).getTime();
        const tRemote = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
        if (tLocal >= tRemote) {
          map.set(item.id, item);
        }
      }
    }
    return Array.from(map.values());
  }

  mergeWithRemoteState(remoteRaw) {
    if (!remoteRaw || typeof remoteRaw !== 'object') return this.load();
    const local = this.load();

    const deletedSet = new Set([
      ...(Array.isArray(local.deletedIds) ? local.deletedIds : []),
      ...(Array.isArray(remoteRaw.deletedIds) ? remoteRaw.deletedIds : [])
    ]);

    const tLocal = new Date(local.updatedAt || 0).getTime();
    const tRemote = new Date(remoteRaw.updatedAt || 0).getTime();
    const preferRemoteProfiles = tRemote > tLocal && remoteRaw.profiles;

    if (preferRemoteProfiles) {
      local.profiles = {
        A: { ...local.profiles.A, ...(remoteRaw.profiles.A || {}) },
        B: { ...local.profiles.B, ...(remoteRaw.profiles.B || {}) }
      };
    }

    local.expenses = this._mergeCollection(local.expenses, remoteRaw.expenses, deletedSet).sort(
      (a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0)
    );
    local.recurring = this._mergeCollection(local.recurring, remoteRaw.recurring, deletedSet).sort(
      (a, b) => (a.dayOfMonth || 1) - (b.dayOfMonth || 1)
    );
    local.settlements = this._mergeCollection(local.settlements, remoteRaw.settlements, deletedSet).sort(
      (a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0)
    );
    local.goals = this._mergeCollection(local.goals, remoteRaw.goals, deletedSet);
    local.shoppingList = this._mergeCollection(local.shoppingList, remoteRaw.shoppingList, deletedSet);
    local.deletedIds = Array.from(deletedSet).slice(-500);

    return this.save();
  }

  async syncWithKDrive(kdriveClient, rootFolderId = 1, pushOnly = false) {
    const state = this.load();
    let folderId = state.cloudFolderId;

    // 1. Trouve ou crée le dossier "/Budget Couple" sur kDrive
    const rootItems = await kdriveClient.listFiles(rootFolderId);
    const foundFolder = rootItems.find(
      (it) => it.type === 'dir' && it.name.toLowerCase() === 'budget couple'
    );

    if (foundFolder) {
      folderId = foundFolder.id;
    } else {
      const created = await kdriveClient.createFolder(rootFolderId, 'Budget Couple');
      folderId = created?.id || rootFolderId;
    }
    state.cloudFolderId = folderId;

    // 2. Cherche si "couple-budget.json" existe déjà dans "/Budget Couple"
    const folderItems = await kdriveClient.listFiles(folderId);
    const remoteFile = folderItems.find(
      (it) => it.type === 'file' && it.name.toLowerCase() === 'couple-budget.json'
    );

    if (remoteFile && !pushOnly) {
      try {
        const textRes = await kdriveClient.readTextFile(remoteFile.id);
        if (textRes && textRes.text) {
          const remoteJson = JSON.parse(textRes.text);
          this.mergeWithRemoteState(remoteJson);
        }
      } catch (_) {
        // Fichier distant vide ou non lisible : on pousse l'état local
      }
    }

    state.lastCloudSyncAt = new Date().toISOString();
    this.save(false);

    const payloadBuffer = Buffer.from(JSON.stringify(this.data, null, 2), 'utf8');
    const uploaded = await kdriveClient.uploadBuffer(
      folderId,
      'couple-budget.json',
      payloadBuffer,
      remoteFile?.id || null
    );

    if (uploaded?.id) {
      state.cloudFileId = uploaded.id;
      this.save(false);
    }

    return this.data;
  }

  // ==========================================================================
  // EXPORT CSV (EXCEL) & RAPPORT IMPRIMABLE HTML/PDF (v0.6.0 — Pack 1)
  // ==========================================================================
  generateCsvString(filterMonth = null) {
    const state = this.load();
    const pA = state.profiles.A;
    const pB = state.profiles.B;
    const rows = [
      [
        'Date',
        'Mois',
        'Libellé',
        'Catégorie',
        'Montant Total (€)',
        'Payé par',
        'Mode de séparation',
        `Part ${pA.name} (€)`,
        `Part ${pB.name} (€)`,
        'Statut',
        'Notes'
      ]
    ];

    const list = filterMonth
      ? state.expenses.filter((e) => e.month === filterMonth)
      : state.expenses;

    for (const exp of list) {
      const shares = this.computeExpenseShares(exp);
      const payer =
        exp.paidBy === 'A' ? pA.name : exp.paidBy === 'B' ? pB.name : 'Payé à deux';
      const catLabel = CATEGORY_LABELS[exp.category] || 'Autre';
      const statusLabel = exp.status === 'pending' ? 'À payer' : 'Payé';

      rows.push([
        exp.date || '',
        exp.month || '',
        exp.title || '',
        catLabel,
        String(shares.amount).replace('.', ','),
        payer,
        exp.splitMode || 'equal',
        String(shares.shareA).replace('.', ','),
        String(shares.shareB).replace('.', ','),
        statusLabel,
        (exp.notes || '').replace(/[\r\n;]+/g, ' ')
      ]);
    }

    const csvBody = rows
      .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');

    // BOM UTF-8 pour ouverture directe avec accents dans Microsoft Excel
    return '\uFEFF' + csvBody;
  }

  generateHtmlReport(monthStr) {
    const state = this.load();
    const pA = state.profiles.A;
    const pB = state.profiles.B;
    const exps = state.expenses.filter((e) => !monthStr || e.month === monthStr);

    let totalPaid = 0;
    let paidByA = 0;
    let paidByB = 0;
    let shareA = 0;
    let shareB = 0;

    const rowsHtml = exps
      .map((exp) => {
        const calc = this.computeExpenseShares(exp);
        if (exp.status === 'paid') {
          totalPaid += calc.amount;
          paidByA += calc.paidByA;
          paidByB += calc.paidByB;
          shareA += calc.shareA;
          shareB += calc.shareB;
        }
        const payer = exp.paidBy === 'A' ? pA.name : exp.paidBy === 'B' ? pB.name : 'À deux';
        return `
          <tr>
            <td>${exp.date}</td>
            <td><strong>${exp.title}</strong>${exp.notes ? `<br><small style="color:#64748b">${exp.notes}</small>` : ''}</td>
            <td>${CATEGORY_LABELS[exp.category] || 'Autre'}</td>
            <td>${payer}</td>
            <td>${exp.status === 'paid' ? '✅ Payé' : '⏳ À payer'}</td>
            <td style="text-align:right">${calc.shareA.toFixed(2)} €</td>
            <td style="text-align:right">${calc.shareB.toFixed(2)} €</td>
            <td style="text-align:right"><strong>${calc.amount.toFixed(2)} €</strong></td>
          </tr>`;
      })
      .join('');

    const netA = Math.round((paidByA - shareA) * 100) / 100;
    const balanceSummary =
      Math.abs(netA) < 0.05
        ? 'Comptes équilibrés sur cette période.'
        : netA > 0
        ? `${pB.name} doit ${Math.abs(netA).toFixed(2)} € à ${pA.name} sur cette période.`
        : `${pA.name} doit ${Math.abs(netA).toFixed(2)} € à ${pB.name} sur cette période.`;

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>Bilan Budget Couple — ${monthStr || 'Global'}</title>
  <style>
    body { font-family: 'Segoe UI', system-ui, sans-serif; color: #0f172a; margin: 32px; }
    h1 { margin: 0 0 6px; color: #0284c7; }
    .sub { color: #475569; margin-bottom: 22px; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
    .card { border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; background: #f8fafc; }
    .card h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; color: #64748b; }
    .card .val { font-size: 20px; font-weight: 700; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 10px 8px; text-align: left; }
    th { background: #f1f5f9; font-weight: 700; }
    .print-btn { margin-bottom: 20px; padding: 8px 16px; background: #0284c7; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; }
    @media print { .print-btn { display: none; } body { margin: 12px; } }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button>
  <h1>💑 Bilan Budget & Dépenses Couple (${pA.name} & ${pB.name})</h1>
  <div class="sub">Période : <strong>${monthStr || 'Toutes les périodes'}</strong> • Généré par KVault Desktop</div>
  <div class="cards">
    <div class="card"><h4>Total payé</h4><div class="val">${totalPaid.toFixed(2)} €</div></div>
    <div class="card"><h4>Payé par ${pA.name}</h4><div class="val">${paidByA.toFixed(2)} €</div><small>Part théorique : ${shareA.toFixed(2)} €</small></div>
    <div class="card"><h4>Payé par ${pB.name}</h4><div class="val">${paidByB.toFixed(2)} €</div><small>Part théorique : ${shareB.toFixed(2)} €</small></div>
    <div class="card"><h4>Équilibre de la période</h4><div class="val" style="font-size:15px">${balanceSummary}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Libellé</th>
        <th>Catégorie</th>
        <th>Payé par</th>
        <th>Statut</th>
        <th style="text-align:right">Part ${pA.name}</th>
        <th style="text-align:right">Part ${pB.name}</th>
        <th style="text-align:right">Montant</th>
      </tr>
    </thead>
    <tbody>${rowsHtml || '<tr><td colspan="8">Aucune dépense sur cette période.</td></tr>'}</tbody>
  </table>
</body>
</html>`;
  }
}

module.exports = { BudgetService };
