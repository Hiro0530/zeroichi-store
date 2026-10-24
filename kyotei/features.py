"""特徴量づくり(レース前に分かることだけを使う)。

日付順に1日ずつ進め、「その日の朝の時点で分かっていること」だけから各艇の特徴量を作り、
そのあとでその日の結果を履歴に足す。だから、ある日の特徴量にその日以降の結果は入らない。

使うもの
- 番組表(当日朝に公開): 全国/当地 勝率・2連率、級別、体重、モーター/ボート2連率、今節成績
- 過去の競走成績(前日まで): 選手ごとの「枠別」1着率・2連対率、実際の進入コース別の1着率、
  平均ST、フライング回数、前付け/コースを取られる傾向、最近の調子
- レーサー期別成績(公開済みの期のもの): コース別の1着率・2連対率・平均ST・平均スタート順位、能力指数
- 気象: 当日の気象・波は結果ファイルにしか無い(レース後)。予想には「前日の同じ場の風速・波高」だけを使う。
  当日の実測値は「もしレース前に分かったら」という参考の検証(oracle)にだけ使い、予想には使わない。
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta

import numpy as np

CLASSES = ["A1", "A2", "B1"]
LANE_PRIOR = [0.55, 0.14, 0.12, 0.11, 0.06, 0.02]   # 初期値(実データで上書き)
T2_PRIOR = [0.72, 0.38, 0.36, 0.30, 0.17, 0.07]

FEATS = [
    "nat_win", "nat_2", "loc_win", "motor_2", "boat_2", "A1", "A2", "B1", "weight",
    "rel_nat", "rel_loc", "rel_motor",
    "ks_avg", "ks_F", "ks_bad",
    "h_lane_win", "h_lane_t2", "h_lane_n", "h_win_ewma", "h_t3_ewma",
    "h_course_win", "h_st", "h_st_rel", "h_F180", "h_inner", "h_outer",
    "fan_c_win", "fan_c_q2", "fan_c_st", "fan_c_sr", "fan_ability", "fan_has",
    "wxp_wind_l1", "wxp_wave_l1", "wxp_wind_out",
]
ORACLE = ["wx_wind_l1", "wx_wave_l1", "wx_wind_out", "exh_rel"]   # 参考検証のみ(予想には使わない)
LANE_X = ["nat_win", "h_st", "motor_2"]   # 枠ごとに効き方を変える特徴量


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


class History:
    """前日までの競走成績から、選手ごとの数字を積み上げる。"""

    def __init__(self):
        self.r = defaultdict(lambda: {
            "ln": [0] * 6, "lw": [0] * 6, "l2": [0] * 6, "l3": [0] * 6,
            "cn": [0] * 6, "cw": [0] * 6, "st_s": 0.0, "st_n": 0, "F": [],
            "inner": 0, "outer": 0, "cobs": 0, "ew_w": None, "ew_3": None})
        self.g_ln = [0] * 6
        self.g_lw = [0] * 6
        self.g_l2 = [0] * 6
        self.g_cn = [0] * 6
        self.g_cw = [0] * 6
        self.wx = {}  # venue -> (date, wind, wave)

    def lane_prior(self, i):
        n = self.g_ln[i]
        return (self.g_lw[i] / n, self.g_l2[i] / n) if n > 500 else (LANE_PRIOR[i], T2_PRIOR[i])

    def course_prior(self, i):
        n = self.g_cn[i]
        return self.g_cw[i] / n if n > 500 else LANE_PRIOR[i]

    def update_day(self, d: date, races: list[dict], results: dict):
        wx_v = defaultdict(list)
        for r in races:
            res = results.get(r["key"])
            if not res:
                continue
            order = res["order"]
            fin_by_lane = {b["lane"]: b for b in res.get("boats", [])}
            for b in r["boats"]:
                L = b["lane"] - 1
                s = self.r[b["racer"]]
                place = order.index(b["lane"]) + 1 if b["lane"] in order else 9
                win, t2, t3 = place == 1, place <= 2, place <= 3
                s["ln"][L] += 1; s["lw"][L] += win; s["l2"][L] += t2; s["l3"][L] += t3
                self.g_ln[L] += 1; self.g_lw[L] += win; self.g_l2[L] += t2
                a = 0.06
                s["ew_w"] = win if s["ew_w"] is None else (1 - a) * s["ew_w"] + a * win
                s["ew_3"] = t3 if s["ew_3"] is None else (1 - a) * s["ew_3"] + a * t3
                kb = fin_by_lane.get(b["lane"])
                if kb:
                    c = kb.get("course")
                    if c:
                        s["cn"][c - 1] += 1; s["cw"][c - 1] += win
                        self.g_cn[c - 1] += 1; self.g_cw[c - 1] += win
                        s["cobs"] += 1
                        s["inner"] += c < b["lane"]
                        s["outer"] += c > b["lane"]
                    st = kb.get("st")
                    if st is not None and not kb.get("F") and 0 <= st < 1:
                        s["st_s"] += st; s["st_n"] += 1
                    if kb.get("F"):
                        s["F"].append(d)
            if res.get("wx"):
                wx_v[r["venue"]].append((res["wx"].get("wind", 0), res["wx"].get("wave", 0)))
        for v, xs in wx_v.items():
            self.wx[v] = (d, float(np.mean([a for a, _ in xs])), float(np.mean([b for _, b in xs])))


class FanStore:
    """レーサー期別成績。各期のファイルは、公開後(余裕を見て期末の翌々月1日以降)だけ使う。"""

    def __init__(self, files: dict[str, dict]):
        # files: {"2604": {登番: rec}}
        self.items = []
        for yymm, data in files.items():
            y, m = 2000 + int(yymm[:2]), int(yymm[2:])
            m2 = m + 2
            avail = date(y + (m2 - 1) // 12, (m2 - 1) % 12 + 1, 1)
            self.items.append((avail, yymm, data))
        self.items.sort()

    def asof(self, d: date) -> dict:
        cur = {}
        for avail, _, data in self.items:
            if avail <= d:
                cur = data
        return cur

    def asof_name(self, d: date):
        cur = None
        for avail, yymm, _ in self.items:
            if avail <= d:
                cur = yymm
        return cur


def race_features(r: dict, d: date, h: History, fan: dict, res: dict | None = None) -> tuple[np.ndarray, np.ndarray]:
    """1レース分: (6, len(FEATS)) と 参考用 (6, len(ORACLE))"""
    rows, orc = [], []
    venue = r["venue"]
    wxp = h.wx.get(venue)
    wind_p, wave_p = (wxp[1], wxp[2]) if wxp and (d - wxp[0]).days <= 3 else (3.0, 3.0)
    wx = (res or {}).get("wx") or {}
    exh = {b["lane"]: b.get("exh") for b in (res or {}).get("boats", [])}
    for b in r["boats"]:
        L = b["lane"] - 1
        s = h.r.get(b["racer"])
        pw, p2 = h.lane_prior(L)
        loc = b["loc_win"] if b["loc_win"] > 0 else b["nat_win"]
        ks = b.get("ks") or {"n": 0, "pts": 0, "f": 0, "bad": 0}
        x = {"nat_win": b["nat_win"], "nat_2": b["nat_2"] / 10, "loc_win": loc,
             "motor_2": b["motor_2"] / 10, "boat_2": b["boat_2"] / 10,
             "A1": b["cls"] == "A1", "A2": b["cls"] == "A2", "B1": b["cls"] == "B1",
             "weight": (b["weight"] - 52) / 3,
             "ks_avg": (ks["pts"] + 3.5 * 2) / (ks["n"] + 2) if ks["n"] else 3.5,
             "ks_F": float(ks["f"] > 0), "ks_bad": float(ks["bad"] > 0)}
        if s:
            k = 8.0
            n = s["ln"][L]
            x["h_lane_win"] = _logit((s["lw"][L] + k * pw) / (n + k)) - _logit(pw)
            x["h_lane_t2"] = _logit((s["l2"][L] + k * p2) / (n + k)) - _logit(p2)
            x["h_lane_n"] = math.log1p(n)
            x["h_win_ewma"] = s["ew_w"] if s["ew_w"] is not None else 0.17
            x["h_t3_ewma"] = s["ew_3"] if s["ew_3"] is not None else 0.5
            pc = h.course_prior(L)
            cn = s["cn"][L]
            x["h_course_win"] = _logit((s["cw"][L] + k * pc) / (cn + k)) - _logit(pc) if s["cobs"] else 0.0
            x["h_st"] = (s["st_s"] + 0.17 * 5) / (s["st_n"] + 5)
            x["h_F180"] = float(sum(1 for fd in s["F"] if (d - fd).days <= 180))
            x["h_inner"] = (s["inner"] + 0.5) / (s["cobs"] + 10)
            x["h_outer"] = (s["outer"] + 0.5) / (s["cobs"] + 10)
        else:
            x.update({"h_lane_win": 0.0, "h_lane_t2": 0.0, "h_lane_n": 0.0, "h_win_ewma": 0.17,
                      "h_t3_ewma": 0.5, "h_course_win": 0.0, "h_st": 0.17, "h_F180": 0.0,
                      "h_inner": 0.05, "h_outer": 0.05})
        f = fan.get(b["racer"])
        fc = f["c"][L] if f else None
        if fc and fc["n"] > 0:
            pc = h.course_prior(L)
            x["fan_c_win"] = _logit((fc["w"] + 6 * pc) / (fc["n"] + 6)) - _logit(pc)
            x["fan_c_q2"] = ((fc["q2"] or 0) * fc["n"] + 6 * 100 * T2_PRIOR[L]) / (fc["n"] + 6) / 10
            x["fan_c_st"] = fc["st"] if fc["st"] else 0.17
            x["fan_c_sr"] = fc["sr"] if fc["sr"] else 3.5
            x["fan_has"] = 1.0
        else:
            x.update({"fan_c_win": 0.0, "fan_c_q2": 10 * T2_PRIOR[L], "fan_c_st": 0.17, "fan_c_sr": 3.5, "fan_has": 0.0})
        x["fan_ability"] = (f.get("ability") or 50.0) if f else 50.0
        x["wxp_wind_l1"] = wind_p * (L == 0)
        x["wxp_wave_l1"] = wave_p * (L == 0)
        x["wxp_wind_out"] = wind_p * (L >= 3)
        rows.append(x)
        orc.append([wx.get("wind", 0) * (L == 0), wx.get("wave", 0) * (L == 0), wx.get("wind", 0) * (L >= 3),
                    exh.get(b["lane"]) or 0.0])
    for key, rel in (("nat_win", "rel_nat"), ("loc_win", "rel_loc"), ("motor_2", "rel_motor"), ("h_st", "h_st_rel")):
        m = sum(x[key] for x in rows) / 6
        for x in rows:
            x[rel] = x[key] - m
    X = np.array([[float(x[k]) for k in FEATS] for x in rows])
    O = np.array(orc, dtype=float)
    ex = O[:, 3]
    O[:, 3] = np.where(ex > 0, ex - (ex[ex > 0].mean() if (ex > 0).any() else 0), 0.0)
    return X, O


def build(days: list[tuple[date, list, dict]], fan_store: FanStore, target: tuple[date, list] | None = None):
    """days: 日付順の (日付, 番組, 結果)。→ 学習用の配列と、target 日の特徴量。

    各日の特徴量は、その日より前の結果だけで作る(作った後でその日の結果を足す)。"""
    h = History()
    X, O, V, Y, Y2, Y3, D, K, PAY = [], [], [], [], [], [], [], [], []
    for d, races, results in days:
        fan = fan_store.asof(d)
        for r in races:
            res = results.get(r["key"])
            if not res:
                continue
            x, o = race_features(r, d, h, fan, res)
            X.append(x); O.append(o)
            V.append(int(r["venue"]) - 1)
            Y.append(res["order"][0] - 1); Y2.append(res["order"][1] - 1); Y3.append(res["order"][2] - 1)
            D.append(d.toordinal()); K.append(r["key"])
            PAY.append(res["tansho"].get(str(res["order"][0]), 0))
        h.update_day(d, races, results)
    data = {"X": np.array(X), "O": np.array(O), "V": np.array(V), "y": np.array(Y), "y2": np.array(Y2),
            "y3": np.array(Y3), "D": np.array(D), "K": K, "pay": np.array(PAY, dtype=float)}
    tgt = None
    if target is not None:
        d, races = target
        fan = fan_store.asof(d)
        tgt = {"races": races, "X": np.array([race_features(r, d, h, fan)[0] for r in races]) if races else np.zeros((0, 6, len(FEATS))),
               "V": np.array([int(r["venue"]) - 1 for r in races]), "fan": fan_store.asof_name(d)}
    return data, tgt
