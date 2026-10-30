"""1号艇が頭のときの2着・3着の確率と、予想の確率だけで決まる買い目(exp_place.py の検証と、毎朝の予想・答え合わせで同じ決め方を使う)。"""
from __future__ import annotations

import numpy as np

import exp_bets as EB

PERMS = EB.PERMS
LT, LE, LQ, LR = EB.LBL["trifecta"], EB.LBL["exacta"], EB.LBL["quinella"], EB.LBL["trio"]
H1 = np.where(PERMS[:, 0] == 0)[0]          # 1号艇が頭の20通り


def head1(T):
    """T (n,120) → 1号艇が勝ったときの (2着,3着) の条件付き確率 Q (n,6,6) と 2着 q (n,6)"""
    n = len(T)
    Q = np.zeros((n, 6, 6))
    for k in H1:
        _, b, c = PERMS[k]
        Q[:, b, c] = T[:, k]
    Q /= np.maximum(Q.sum((1, 2), keepdims=True), 1e-12)
    return Q, Q.sum(2)


def race_combos(names, P1, T):
    """1レースの買い目(予想の確率だけで決まる)。→ {名前: 組番のラベルの一覧}"""
    Q, q = head1(T[None])
    Q, q = Q[0], q[0]
    o2 = [int(j) for j in np.argsort(-q) if j != 0]
    a, b, c = o2[0], o2[1], o2[2]
    lab3 = lambda x, y, z: f"{x+1}-{y+1}-{z+1}"  # noqa: E731
    Qf = Q.reshape(36)
    oq = [(int(k) // 6, int(k) % 6) for k in np.argsort(-Qf) if Qf[k] > 0]
    U = np.triu(Q + Q.T, 1)
    bu = np.unravel_index(int(np.argmax(U)), U.shape)
    Tr = T @ EB.M_TRIO
    Ex = T @ EB.M_EX
    qn = Ex @ M_QN
    head = PERMS[:, 0]
    exh = EXH
    oT = np.argsort(-T)
    out = {}
    for name in names:
        if name == "tan_1":
            v = ["1"]
        elif name == "ex_1a":
            v = [f"1-{a+1}"]
        elif name == "ex_1ab":
            v = [f"1-{a+1}", f"1-{b+1}"]
        elif name == "qn_1a":
            v = [f"1-{a+1}"]
        elif name == "qn_1ab":
            v = [f"1-{a+1}", f"1-{b+1}"]
        elif name == "tri_1":
            v = [lab3(0, *oq[0])]
        elif name == "tri_swap":
            v = [lab3(0, bu[0], bu[1]), lab3(0, bu[1], bu[0])]
        elif name == "tri_1a_bc":
            v = [lab3(0, a, b), lab3(0, a, c)]
        elif name == "tri_top10":
            v = [LT[j] for j in oT[:10]]
        elif name.startswith("tri_top"):
            v = [lab3(0, *oq[i]) for i in range(int(name[7:]))]
        elif name == "tri_form4":
            v = [lab3(0, a, b), lab3(0, a, c), lab3(0, b, a), lab3(0, b, c)]
        elif name == "tri_box3":
            v = [lab3(0, x, y) for x in (a, b, c) for y in (a, b, c) if x != y]
        elif name.startswith("trio_") and name[5:].isdigit():
            v = [LR[j] for j in np.argsort(-np.where(HAS1, Tr, -1))[:int(name[5:])]]
        elif name == "prod_tan":
            v = [str(int(np.argmax(P1)) + 1)]
        elif name in ("prod_ex1", "prod_ex3"):
            v = [LE[j] for j in np.argsort(-Ex)[:(1 if name == "prod_ex1" else 3)]]
        elif name == "prod_qn1":
            v = [LQ[int(np.argmax(qn))]]
        elif name == "prod_tri3":
            v = [LT[j] for j in oT[:3]]
        elif name == "prod_trio3":
            v = [LR[j] for j in np.argsort(-Tr)[:3]]
        elif name == "tan_non1":
            v = [str(2 + int(np.argmax(P1[1:])))]
        elif name == "tan_non1_2":
            v = [str(2 + int(j)) for j in np.argsort(-P1[1:])[:2]]
        elif name == "ex_non1_3":
            v = [LE[j] for j in np.argsort(-np.where(exh != 0, Ex, -1))[:3]]
        elif name == "ex_top5":
            v = [LE[j] for j in np.argsort(-Ex)[:5]]
        elif name == "qn_top3":
            v = [LQ[j] for j in np.argsort(-qn)[:3]]
        elif name.startswith("tri_non1_"):
            v = [LT[j] for j in np.argsort(-np.where(head != 0, T, -1))[:int(name.split("_")[-1])]]
        elif name == "tri_34_6":
            v = [LT[j] for j in np.argsort(-np.where((head == 2) | (head == 3), T, -1))[:6]]
        elif name == "trio_no1_3":
            v = [LR[j] for j in np.argsort(-np.where(~HAS1, Tr, -1))[:3]]
        elif name == "trio_top5":
            v = [LR[j] for j in np.argsort(-Tr)[:5]]
        else:
            raise KeyError(name)
        out[name] = v
    return out


HAS1 = np.array([0 in t for t in EB.TRIPS])
EXH = np.array([x for x, _ in EB.EXL])
M_QN = np.zeros((30, 15))
for _j, (_x, _y) in enumerate(EB.EXL):
    M_QN[_j, EB.PAIRS.index(tuple(sorted((_x, _y))))] = 1


