const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_BUDGET_STATE = {
  version: 1,
  currency: '€',
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
  receiptsFolderId: null
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
          goals: Array.isArray(raw.goals) ? raw.goals : []
        };
        return this.data;
      }
    } catch (_) {
      // Fichier corrompu ou absent : initialisation propre
    }

    this.data = JSON.parse(JSON.stringify(DEFAULT_BUDGET_STATE));
    this.save();
    return this.data;
  }

  save() {
    if (!this.data) this.load();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    return this.data;
  }

  getState() {
    return this.load();
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

  /**
   * Calcule la part (en €) que doivent supporter A et B sur une dépense
   */
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
      // Déjà payé à deux selon la répartition
      paidByA = shareA;
      paidByB = shareB;
    }

    return {
      amount,
      shareA: Math.round(shareA * 100) / 100,
      shareB: Math.round(shareB * 100) / 100,
      paidByA: Math.round(paidByA * 100) / 100,
      paidByB: Math.round(paidByB * 100) / 100,
      // Solde net pour A (>0 signifie que B doit de l'argent à A sur cette dépense)
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
      createdAt: new Date().toISOString()
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
      amount: patch.amount !== undefined ? Math.round(Math.max(0, Number(patch.amount) || 0) * 100) / 100 : current.amount,
      date: nextDate,
      month: nextDate.slice(0, 7),
      status: nextStatus,
      paidAt: nextStatus === 'paid' ? (current.paidAt || new Date().toISOString().slice(0, 10)) : null
    };

    state.expenses[idx] = updated;
    this.save();
    return updated;
  }

  deleteExpense(id) {
    const state = this.load();
    state.expenses = state.expenses.filter((e) => e.id !== id);
    this.save();
    return true;
  }

  addSettlement(payload = {}) {
    const state = this.load();
    const amount = Math.round(Math.max(0, Number(payload.amount) || 0) * 100) / 100;
    if (!amount) throw new Error('Montant de remboursement invalide.');

    const dateStr = payload.date || new Date().toISOString().slice(0, 10);
    const settlement = {
      id: this._newId('settle'),
      from: payload.from === 'B' ? 'B' : 'A',
      to: payload.from === 'B' ? 'A' : 'B',
      amount,
      date: dateStr,
      month: payload.month || dateStr.slice(0, 7),
      note: String(payload.note || 'Remboursement d\'équilibrage').trim(),
      createdAt: new Date().toISOString()
    };

    state.settlements.unshift(settlement);

    if (payload.markMonthSettled && settlement.month) {
      state.expenses.forEach((exp) => {
        if (exp.month === settlement.month && exp.status === 'paid') {
          exp.settled = true;
        }
      });
    }

    this.save();
    return settlement;
  }

  deleteSettlement(id) {
    const state = this.load();
    state.settlements = state.settlements.filter((s) => s.id !== id);
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
      createdAt: new Date().toISOString()
    };

    state.recurring.push(item);
    state.recurring.sort((a, b) => a.dayOfMonth - b.dayOfMonth);
    this.save();
    return item;
  }

  deleteRecurring(id) {
    const state = this.load();
    state.recurring = state.recurring.filter((r) => r.id !== id);
    this.save();
    return true;
  }

  /**
   * Pointe une échéance récurrente comme payée (ou annule le pointage) pour un mois donné (YYYY-MM)
   */
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
        // Si déjà payée, on la repasse en attente ou on la retire
        state.expenses.splice(existingIdx, 1);
        this.save();
        return { paid: false, expense: null };
      } else {
        existing.status = 'paid';
        existing.paidAt = new Date().toISOString().slice(0, 10);
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
    const goal = {
      id: this._newId('goal'),
      title: String(payload.title || 'Projet à deux').trim(),
      emoji: String(payload.emoji || '✈️').trim(),
      targetAmount,
      savedA: Math.round(Math.max(0, Number(payload.savedA) || 0) * 100) / 100,
      savedB: Math.round(Math.max(0, Number(payload.savedB) || 0) * 100) / 100,
      deadline: payload.deadline || '',
      notes: String(payload.notes || '').trim(),
      createdAt: new Date().toISOString()
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

    this.save();
    return goal;
  }

  deleteGoal(goalId) {
    const state = this.load();
    state.goals = state.goals.filter((g) => g.id !== goalId);
    this.save();
    return true;
  }

  setReceiptsFolderId(folderId) {
    const state = this.load();
    state.receiptsFolderId = folderId;
    this.save();
  }
}

module.exports = { BudgetService };
