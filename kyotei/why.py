"""予想の根拠(◎がなぜ◎なのか)を、モデルの計算そのものから取り出す。

条件付きロジットは「枠の効果 + 場×枠の効果 + 特徴量×係数」の足し算なので、
◎の艇の各項から、同じレースの6艇の平均を引けば「何が◎を押し上げたか」がそのまま分かる。
似た特徴量はまとめて、言葉にできる単位(下の GROUPS)で合計する。

予想ファイルには英字の短い名前と効き目(対数オッズの差、小数2桁)だけを書く。言葉はページ側(seo_pages.py)。
"""
from __future__ import annotations

import numpy as np

from features import FEATS, LANE_X

# 特徴量 → まとまり(ページでは seo_pages.WHY_TEXT で言葉にする)
GROUPS = {
    "lane": [],   # 枠の効果+場×枠の効果(特徴量ではないので別に計算)
    "power": ["nat_win", "nat_2", "rel_nat", "A1", "A2", "B1", "fan_ability", "fan_has"],
    "local": ["loc_win", "rel_loc", "f_rv", "f_rlv"],
    "lanefit": ["h_lane_win", "h_lane_t2", "h_lane_n", "fan_c_win", "fan_c_q2"],
    "start": ["h_st", "h_st_rel", "fan_c_st", "fan_c_sr", "s_st90", "s_st_sd"],
    "flying": ["h_F180", "s_Fper", "ks_F"],
    "form": ["h_win_ewma", "h_t3_ewma", "f_form30", "f_form90", "f_form90_t3"],
    "series": ["ks_avg", "ks_bad"],
    "motor": ["motor_2", "rel_motor", "m_res_all", "m_res30", "m_n", "m_new", "m_shr", "e_motor_exh"],
    "boat": ["boat_2"],
    "exh": ["e_racer_exh", "e_draw_exh", "e_draw_res"],
    "course": ["h_course_win", "h_inner", "h_outer"],
    "weight": ["weight"],
    "weather": ["wxp_wind_l1", "wxp_wave_l1", "wxp_wind_out", "w_u_l1", "w_v_l1", "w_u_out", "w_v_out"],
    "tide": ["t_lvl_l1", "t_d_l1", "t_lvl_out", "t_d_out"],
    "venue": ["v_vl90"],
}
F2G = {f: g for g, fs in GROUPS.items() for f in fs}


def contributions(model: dict, X_all, V, allf) -> tuple[np.ndarray, list[str]]:
    """(レース, 6艇, まとまり) の効き目。predict_model と同じく components の平均。"""
    names = list(GROUPS)
    X_all = np.asarray(X_all, dtype=np.float64)
    V = np.asarray(V)
    n = X_all.shape[0]
    C = np.zeros((n, 6, len(names)))
    comps = model.get("components") or [model]
    for m in comps:
        feats = list(m.get("feats") or FEATS)
        X = X_all[:, :, [allf.index(f) for f in feats]]
        Z = (X - np.array(m["mu"])) / np.array(m["sd"])
        w = np.array(m["w"])
        F = len(feats)
        c = Z * w[150:150 + F]                     # (n,6,F)
        idx = [feats.index(f) for f in LANE_X if f in feats]
        for j, fi in enumerate(idx):               # 枠ごとに効き方を変える項
            c[:, :, fi] += Z[:, :, fi] * w[150 + F + j * 6: 150 + F + j * 6 + 6][None, :]
        p = F + 6 * len(idx)
        vx = m.get("vx") or []
        if vx:                                     # 場ごとの係数
            wv = w[150 + p:].reshape(24, len(vx))[V]
            for j, f in enumerate(vx):
                fi = feats.index(f)
                c[:, :, fi] += Z[:, :, fi] * wv[:, j][:, None]
        lane = w[:6][None, :] + w[6:150].reshape(24, 6)[V]
        C[:, :, 0] += lane
        for fi, f in enumerate(feats):
            g = F2G.get(f)
            if g:
                C[:, :, names.index(g)] += c[:, :, fi]
    C /= len(comps)
    return C - C.mean(axis=1, keepdims=True), names


def pick_reasons(model: dict, X_all, V, allf, picks) -> list[dict]:
    """各レースの◎(picks: 0始まりの枠)について、押し上げた上位3つと、足を引っぱった1つ。"""
    C, names = contributions(model, X_all, V, allf)
    out = []
    for i, k in enumerate(picks):
        v = C[i, k]
        order = np.argsort(-v)
        plus = [[names[j], round(float(v[j]), 2)] for j in order[:3] if v[j] >= 0.05]
        neg = [[names[j], round(float(v[j]), 2)] for j in order[::-1][:1] if v[j] <= -0.05]
        out.append({"plus": plus, "minus": neg})
    return out
