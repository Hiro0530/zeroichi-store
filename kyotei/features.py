"""特徴量づくり(レース前に分かることだけを使う)。

日付順に1日ずつ進め、「その日の朝の時点で分かっていること」だけから各艇の特徴量を作り、
そのあとでその日の結果を履歴に足す。だから、ある日の特徴量にその日以降の結果は入らない。

使うもの
- 番組表(当日朝に公開): 全国/当地 勝率・2連率、級別、体重、モーター/ボート2連率、今節成績
- 過去の競走成績(前日まで): 選手ごとの「枠別」1着率・2連対率、実際の進入コース別の1着率、
  平均ST、フライング回数、前付け/コースを取られる傾向、最近の調子
- レーサー期別成績(公開済みの期のもの): コース別の1着率・2連対率・平均ST・平均スタート順位、能力指数
- v3(GROUPS): 選手の最近30/90日、選手×場、選手×枠×場(階層的に寄せる)、モーター番号ごとの最近の成績と展示タイム、
  選手がモーターの平均より良い展示・成績を出せているか(整備・調整の力の代わり)、潮位(気象庁の潮位表)、前日の風の向き。
  展示タイムは「前のレースまで」の競走成績ファイルの値だけを使う(当日のそのレースの展示は使わない)。
- 気象: 当日の気象・波は結果ファイルにしか無い(レース後)。予想には「前日の同じ場の風速・波高」だけを使う。
  当日の実測値は「もしレース前に分かったら」という参考の検証(oracle)にだけ使い、予想には使わない。
"""
from __future__ import annotations

import math
from collections import defaultdict, deque
from datetime import date, datetime, timedelta

import numpy as np

from jma import wind_uv

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

# v3 で足した候補(グループごとに時系列検証で採否を決める。採用したものは model.json の feats / vx に入る)
GROUPS = {
    "form": ["f_form30", "f_form90", "f_form90_t3"],                   # 選手の最近30/90日(枠の期待値との差)
    "rv": ["f_rv", "f_rlv"],                                           # 選手×場、選手×枠×場(階層的に寄せる)
    "motor": ["m_res_all", "m_res30", "m_n", "m_new"],                 # モーター番号ごとの最近の成績(選手の力を差し引く)
    "exh": ["e_racer_exh", "e_motor_exh", "e_draw_exh", "e_draw_res"],  # 展示タイム(前のレースまで)の選手・モーター、引き出す力
    "tide": ["t_lvl_l1", "t_d_l1", "t_lvl_out", "t_d_out"],            # 潮位表(気象庁、天文潮位)
    "wxdir": ["w_u_l1", "w_v_l1", "w_u_out", "w_v_out"],               # 前日の同じ場の風(向きつき)
}
ORACLE3 = ["o_u_l1", "o_v_l1", "o_u_out", "o_v_out"]                   # 当日のレース時の風(向きつき)。上限を測るだけ
ALLF = FEATS + [f for g in GROUPS.values() for f in g] + ORACLE3
VX_CAND = {"tide": GROUPS["tide"], "wxdir": GROUPS["wxdir"], "oracle": ORACLE3,
           "venue_coef": ["rel_nat", "h_st_rel", "h_lane_win", "fan_c_win"]}   # 場ごとに係数を持たせる候補


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


class Win:
    """日付の窓(直近N日)での合計を、古いものを外しながら持つ。"""
    __slots__ = ("q", "s", "n", "span")

    def __init__(self, span: int, k: int):
        self.q, self.s, self.n, self.span = deque(), [0.0] * k, 0, span

    def add(self, d: int, vals):
        self.q.append((d, vals))
        self.n += 1
        for i, v in enumerate(vals):
            self.s[i] += v

    def trim(self, d: int):
        while self.q and self.q[0][0] < d - self.span:
            _, vals = self.q.popleft()
            self.n -= 1
            for i, v in enumerate(vals):
                self.s[i] -= v
        return self


def _sig(x: float) -> float:
    return 1 / (1 + math.exp(-x))


class History:
    """前日までの競走成績から、選手ごと・モーターごとの数字を積み上げる。"""

    def __init__(self):
        self.r = defaultdict(lambda: {
            "ln": [0] * 6, "lw": [0] * 6, "l2": [0] * 6, "l3": [0] * 6,
            "cn": [0] * 6, "cw": [0] * 6, "st_s": 0.0, "st_n": 0, "F": [],
            "inner": 0, "outer": 0, "cobs": 0, "ew_w": None, "ew_3": None})
        self.g_ln = [0] * 6
        self.g_lw = [0] * 6
        self.g_l2 = [0] * 6
        self.g_l3 = [0] * 6
        self.g_cn = [0] * 6
        self.g_cw = [0] * 6
        self.wx = {}  # venue -> (date, wind, wave, u, v)
        # v3
        self.vl = defaultdict(lambda: [0, 0])                 # (場, 枠) -> [出走, 1着]
        self.r30 = defaultdict(lambda: Win(30, 2))            # 選手: 枠の期待との差(1着, 3連対)
        self.r90 = defaultdict(lambda: Win(90, 5))            # 同 + モーターとの差(2連対, 展示)・展示の有無
        self.rv = defaultdict(lambda: [0, 0.0])               # (選手, 場) -> [出走, 1着の期待との差の合計]
        self.rlv = defaultdict(lambda: [0, 0])                # (選手, 場, 枠) -> [出走, 1着]
        self.mot = {}                                         # 場 -> {モーター番号: {"all": [n, s], "w30": Win, "x90": Win}}
        self.mreset = {}                                      # 場 -> モーターが入れ替わった日
        self.rexh = {}                                        # 選手 -> 展示タイムの差(場内平均との差)の指数平滑
        self.nat2 = [0.0, 0]

    def lane_prior(self, i):
        n = self.g_ln[i]
        return (self.g_lw[i] / n, self.g_l2[i] / n) if n > 500 else (LANE_PRIOR[i], T2_PRIOR[i])

    def lane_t3(self, i):
        n = self.g_ln[i]
        return self.g_l3[i] / n if n > 500 else min(0.95, T2_PRIOR[i] * 1.45)

    def course_prior(self, i):
        n = self.g_cn[i]
        return self.g_cw[i] / n if n > 500 else LANE_PRIOR[i]

    def vl_prior(self, v, i):
        n, w = self.vl[(v, i)]
        pl = self.lane_prior(i)[0]
        return (w + 300 * pl) / (n + 300)

    def p2_exp(self, i, nat2):
        avg = self.nat2[0] / self.nat2[1] if self.nat2[1] > 1000 else 30.0
        return min(max(self.lane_prior(i)[1] * (nat2 / max(avg, 1)), 0.02), 0.97)

    def motor(self, v, mno):
        return self.mot.setdefault(v, {}).setdefault(mno, {"all": [0, 0.0], "w30": Win(30, 1), "x90": Win(90, 2)})

    def motor_est(self, v, mno, d: int):
        m = self.motor(v, mno)
        n, s = m["all"]
        w30 = m["w30"].trim(d)
        x90 = m["x90"].trim(d)
        return {"res_all": s / (n + 15), "res30": w30.s[0] / (w30.n + 8), "n": n,
                "exh": x90.s[0] / (x90.s[1] + 5)}

    def begin_day(self, d: date, races: list[dict]):
        """その日の番組表(朝に公開)だけを見て、モーターの入れ替え(2連率が一斉に0)を見つける。"""
        by_v = defaultdict(list)
        for r in races:
            for b in r["boats"]:
                by_v[r["venue"]].append(b.get("motor_2", 1.0))
        for v, xs in by_v.items():
            if len(xs) >= 12 and sum(1 for x in xs if x == 0) / len(xs) > 0.6:
                last = self.mreset.get(v)
                if last is None or (d - last).days > 90:
                    self.mreset[v] = d
                    self.mot[v] = {}

    def update_day(self, d: date, races: list[dict], results: dict):
        wx_v = defaultdict(list)
        dn = d.toordinal()
        for r in races:
            res = results.get(r["key"])
            if not res:
                continue
            order = res["order"]
            v = r["venue"]
            fin_by_lane = {b["lane"]: b for b in res.get("boats", [])}
            ex = [kb.get("exh") for kb in fin_by_lane.values() if kb.get("exh")]
            ex_m = sum(ex) / len(ex) if len(ex) >= 4 else None
            for b in r["boats"]:
                L = b["lane"] - 1
                s = self.r[b["racer"]]
                place = order.index(b["lane"]) + 1 if b["lane"] in order else 9
                win, t2, t3 = place == 1, place <= 2, place <= 3
                # v3: 期待との差(更新の前の数字で)
                pw = self.vl_prior(v, L)
                rw = win - pw
                r3 = t3 - self.lane_t3(L)
                r2 = t2 - self.p2_exp(L, b.get("nat_2", 30.0))
                mno = b.get("motor_no")
                me = self.motor_est(v, mno, dn) if mno is not None else None
                kb = fin_by_lane.get(b["lane"])
                exr = (kb["exh"] - ex_m) if (kb and kb.get("exh") and ex_m) else None
                d_res = r2 - (me["res_all"] if me else 0.0)
                d_exh = (exr - me["exh"]) if (exr is not None and me) else 0.0
                self.r30[b["racer"]].add(dn, (rw, r3))
                self.r90[b["racer"]].add(dn, (rw, r3, d_res, d_exh, float(exr is not None)))
                rv = self.rv[(b["racer"], v)]
                rv[0] += 1; rv[1] += rw
                rlv = self.rlv[(b["racer"], v, L)]
                rlv[0] += 1; rlv[1] += win
                self.vl[(v, L)][0] += 1; self.vl[(v, L)][1] += win
                if mno is not None:
                    m = self.motor(v, mno)
                    m["all"][0] += 1; m["all"][1] += r2
                    m["w30"].add(dn, (r2,))
                    if exr is not None:
                        m["x90"].add(dn, (exr, 1.0))
                if exr is not None:
                    self.rexh[b["racer"]] = exr if b["racer"] not in self.rexh else 0.8 * self.rexh[b["racer"]] + 0.2 * exr
                self.nat2[0] += b.get("nat_2", 30.0); self.nat2[1] += 1
                # v2
                s["ln"][L] += 1; s["lw"][L] += win; s["l2"][L] += t2; s["l3"][L] += t3
                self.g_ln[L] += 1; self.g_lw[L] += win; self.g_l2[L] += t2; self.g_l3[L] += t3
                a = 0.06
                s["ew_w"] = win if s["ew_w"] is None else (1 - a) * s["ew_w"] + a * win
                s["ew_3"] = t3 if s["ew_3"] is None else (1 - a) * s["ew_3"] + a * t3
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
                w = res["wx"]
                u, vv = wind_uv(w.get("wind", 0), w.get("wind_dir", ""))
                wx_v[v].append((w.get("wind", 0), w.get("wave", 0), u, vv))
        for v, xs in wx_v.items():
            self.wx[v] = (d, *[float(np.mean([x[i] for x in xs])) for i in range(4)])


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


def race_features(r: dict, d: date, h: History, fan: dict, res: dict | None = None, tides=None) -> tuple[np.ndarray, np.ndarray]:
    """1レース分: (6, len(ALLF)) と 参考用 (6, len(ORACLE))。ALLF の先頭は v2 の FEATS と同じ。"""
    rows, orc = [], []
    venue = r["venue"]
    dn = d.toordinal()
    wxp = h.wx.get(venue)
    ok = wxp and (d - wxp[0]).days <= 3
    wind_p, wave_p, up, vp = (wxp[1], wxp[2], wxp[3], wxp[4]) if ok else (3.0, 3.0, 0.0, 0.0)
    wx = (res or {}).get("wx") or {}
    uo, vo = wind_uv(wx.get("wind", 0), wx.get("wind_dir", ""))
    exh = {b["lane"]: b.get("exh") for b in (res or {}).get("boats", [])}
    tide = None
    if tides is not None:
        try:
            tide = tides.at(venue, datetime.fromisoformat(r["close"]) + timedelta(minutes=2))
        except (ValueError, KeyError):
            tide = None
    t_l, t_d = tide if tide else (0.0, 0.0)
    rst = h.mreset.get(venue)
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
            p_rl = (s["lw"][L] + k * pw) / (n + k)
        else:
            x.update({"h_lane_win": 0.0, "h_lane_t2": 0.0, "h_lane_n": 0.0, "h_win_ewma": 0.17,
                      "h_t3_ewma": 0.5, "h_course_win": 0.0, "h_st": 0.17, "h_F180": 0.0,
                      "h_inner": 0.05, "h_outer": 0.05})
            p_rl = pw
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
        # ---- v3: 最近の調子(枠の期待との差)
        w30 = h.r30[b["racer"]].trim(dn) if b["racer"] in h.r30 else None
        w90 = h.r90[b["racer"]].trim(dn) if b["racer"] in h.r90 else None
        x["f_form30"] = w30.s[0] / (w30.n + 6) if w30 else 0.0
        x["f_form90"] = w90.s[0] / (w90.n + 12) if w90 else 0.0
        x["f_form90_t3"] = w90.s[1] / (w90.n + 12) if w90 else 0.0
        # 選手×場、選手×枠×場(場×枠の率 → 選手×枠 → 選手×枠×場 の順に寄せる)
        rv = h.rv.get((b["racer"], venue))
        x["f_rv"] = rv[1] / (rv[0] + 10) if rv else 0.0
        p_vl = h.vl_prior(venue, L)
        prior = _logit(p_vl) + _logit(p_rl) - _logit(pw)
        rlv = h.rlv.get((b["racer"], venue, L))
        if rlv:
            post = (rlv[1] + 6 * _sig(prior)) / (rlv[0] + 6)
            x["f_rlv"] = _logit(post) - prior
        else:
            x["f_rlv"] = 0.0
        # モーター番号ごとの最近の成績(選手の力を差し引いた2連対)・展示タイム、入れ替え直後か
        mno = b.get("motor_no")
        me = h.motor_est(venue, mno, dn) if mno is not None else {"res_all": 0.0, "res30": 0.0, "n": 0, "exh": 0.0}
        x["m_res_all"] = me["res_all"]
        x["m_res30"] = me["res30"]
        x["m_n"] = math.log1p(me["n"])
        x["m_new"] = math.exp(-(d - rst).days / 30) if rst else 0.0
        # 展示タイム(前のレースまで): 選手の最近の展示、モーターの展示、モーターの平均より良い展示・成績を出せているか(整備・調整の力の代わり)
        x["e_racer_exh"] = h.rexh.get(b["racer"], 0.0)
        x["e_motor_exh"] = me["exh"]
        x["e_draw_exh"] = w90.s[3] / (w90.s[4] + 5) if w90 else 0.0
        x["e_draw_res"] = w90.s[2] / (w90.n + 12) if w90 else 0.0
        # 潮位(気象庁の潮位表。レースの前から分かる計算値)と、前日の風(向きつき)
        x["t_lvl_l1"] = t_l * (L == 0); x["t_d_l1"] = t_d * (L == 0)
        x["t_lvl_out"] = t_l * (L >= 3); x["t_d_out"] = t_d * (L >= 3)
        x["w_u_l1"] = up * (L == 0); x["w_v_l1"] = vp * (L == 0)
        x["w_u_out"] = up * (L >= 3); x["w_v_out"] = vp * (L >= 3)
        x["o_u_l1"] = uo * (L == 0); x["o_v_l1"] = vo * (L == 0)
        x["o_u_out"] = uo * (L >= 3); x["o_v_out"] = vo * (L >= 3)
        rows.append(x)
        orc.append([wx.get("wind", 0) * (L == 0), wx.get("wave", 0) * (L == 0), wx.get("wind", 0) * (L >= 3),
                    exh.get(b["lane"]) or 0.0])
    for key, rel in (("nat_win", "rel_nat"), ("loc_win", "rel_loc"), ("motor_2", "rel_motor"), ("h_st", "h_st_rel")):
        m = sum(x[key] for x in rows) / 6
        for x in rows:
            x[rel] = x[key] - m
    X = np.array([[float(x[k]) for k in ALLF] for x in rows])
    O = np.array(orc, dtype=float)
    ex = O[:, 3]
    O[:, 3] = np.where(ex > 0, ex - (ex[ex > 0].mean() if (ex > 0).any() else 0), 0.0)
    return X, O


def build(days: list[tuple[date, list, dict]], fan_store: FanStore, target: tuple[date, list] | None = None, tides=None):
    """days: 日付順の (日付, 番組, 結果)。→ 学習用の配列(列は ALLF)と、target 日の特徴量。

    各日の特徴量は、その日より前の結果だけで作る(作った後でその日の結果を足す)。"""
    h = History()
    X, O, V, Y, Y2, Y3, D, K, PAY, PAYT, PAYD = [], [], [], [], [], [], [], [], [], [], []
    for d, races, results in days:
        fan = fan_store.asof(d)
        h.begin_day(d, races)
        for r in races:
            res = results.get(r["key"])
            if not res:
                continue
            x, o = race_features(r, d, h, fan, res, tides)
            X.append(x.astype(np.float32)); O.append(o)
            V.append(int(r["venue"]) - 1)
            Y.append(res["order"][0] - 1); Y2.append(res["order"][1] - 1); Y3.append(res["order"][2] - 1)
            D.append(d.toordinal()); K.append(r["key"])
            PAY.append(res["tansho"].get(str(res["order"][0]), 0))
            o3 = res["order"]
            PAYT.append(res["trifecta"].get(f"{o3[0]}-{o3[1]}-{o3[2]}", 0))
            PAYD.append(res.get("pay") or None)
        h.update_day(d, races, results)
    data = {"X": np.array(X, dtype=np.float32).reshape(-1, 6, len(ALLF)), "O": np.array(O), "V": np.array(V), "y": np.array(Y),
            "y2": np.array(Y2), "y3": np.array(Y3), "D": np.array(D), "K": K, "pay": np.array(PAY, dtype=float),
            "pay_tri": np.array(PAYT, dtype=float), "payd": PAYD}
    tgt = None
    if target is not None:
        d, races = target
        fan = fan_store.asof(d)
        h.begin_day(d, races)
        tgt = {"races": races,
               "X": np.array([race_features(r, d, h, fan, None, tides)[0] for r in races]) if races else np.zeros((0, 6, len(ALLF))),
               "V": np.array([int(r["venue"]) - 1 for r in races]), "fan": fan_store.asof_name(d)}
    return data, tgt
