
#!/usr/bin/env python3

import json
import os
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

from pathlib import Path

sys.path.insert(
    0,
    str(
        Path(
            "fantasy-engine/optimizer"
        ).resolve()
    )
)

from multi_solver import optimize_multiple
from solver import RULES, positions_of


DATE = os.getenv(
    "FANTASY_TARGET_DATE",
    "2026-10-22"
)

INPUT_A = Path(
    "fantasy-slate-data/nba-draftkings-context-shadow.json"
)

INPUT_B = Path(
    "fantasy-slate-data/nba-draftkings-advanced-shadow.json"
)

OUTPUT = Path(
    "fantasy-experiments"
) / DATE

FILE_A = OUTPUT / "sample-a.json"
FILE_B = OUTPUT / "sample-b.json"

FILE_EVAL = (
    OUTPUT /
    "comparison-after-games.json"
)

SLOTS = RULES[
    "nba"
]["draftkings"]["slots"]

CAP = RULES[
    "nba"
]["draftkings"]["salary_cap"]


# Muestra A: alineaciones originales
# slot, jugador, salario, puntos esperados.

LOG_A = [
    [
        ("PG", "Tyrese Maxey", 8000, 49.53),
        ("SG", "Ajay Mitchell", 4400, 30.82),
        ("SF", "DeMar DeRozan", 4900, 28.91),
        ("PF", "Chet Holmgren", 5800, 38.86),
        ("C", "Isaiah Hartenstein", 4800, 30.54),
        ("G", "Jaylon Tyson", 3600, 24.94),
        ("F", "Jaylen Brown", 7600, 47.24),
        ("UTIL", "Nikola Jokic", 10900, 65.26)
    ],
    [
        ("PG", "VJ Edgecombe", 5700, 32.54),
        ("SG", "Ajay Mitchell", 4400, 30.82),
        ("SF", "Jaylen Brown", 7600, 47.24),
        ("PF", "Chet Holmgren", 5800, 38.86),
        ("C", "Isaiah Hartenstein", 4800, 30.54),
        ("G", "Jaylon Tyson", 3600, 24.94),
        ("F", "LeBron James", 7000, 42.78),
        ("UTIL", "Nikola Jokic", 10900, 65.26)
    ],
    [
        ("PG", "Tyrese Maxey", 8000, 49.53),
        ("SG", "Ajay Mitchell", 4400, 30.82),
        ("SF", "Jaylon Tyson", 3600, 24.94),
        ("PF", "LeBron James", 7000, 42.78),
        ("C", "Isaiah Hartenstein", 4800, 30.54),
        ("G", "Sam Merrill", 3700, 21.54),
        ("F", "Jaylen Brown", 7600, 47.24),
        ("UTIL", "Nikola Jokic", 10900, 65.26)
    ],
    [
        ("PG", "Ajay Mitchell", 4400, 30.82),
        ("SG", "DeMar DeRozan", 4900, 28.91),
        ("SF", "Jaylen Brown", 7600, 47.24),
        ("PF", "LeBron James", 7000, 42.78),
        ("C", "Isaiah Hartenstein", 4800, 30.54),
        ("G", "James Harden", 7100, 43.32),
        ("F", "Chet Holmgren", 5800, 38.86),
        ("UTIL", "Tyrese Maxey", 8000, 49.53)
    ],
    [
        ("PG", "Ajay Mitchell", 4400, 30.82),
        ("SG", "Jaylon Tyson", 3600, 24.94),
        ("SF", "DeMar DeRozan", 4900, 28.91),
        ("PF", "Chet Holmgren", 5800, 38.86),
        ("C", "Nikola Jokic", 10900, 65.26),
        ("G", "VJ Edgecombe", 5700, 32.54),
        ("F", "Jaylen Brown", 7600, 47.24),
        ("UTIL", "James Harden", 7100, 43.32)
    ]
]

TOTALS_A = [
    316.10,
    312.98,
    312.65,
    312.00,
    311.89
]


def ensure(condition, message):
    if not condition:
        raise ValueError(message)


def read(file):
    ensure(
        file.exists(),
        f"Falta archivo: {file}"
    )

    return json.loads(
        file.read_text(
            encoding="utf-8"
        )
    )


def save_once(file, value):
    ensure(
        not file.exists(),
        f"Muestra congelada, NO sobrescribir: {file}"
    )

    file.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    file.write_text(
        json.dumps(
            value,
            ensure_ascii=False,
            indent=2
        ),
        encoding="utf-8"
    )


def norm(name):
    return "".join(
        c
        for c in unicodedata.normalize(
            "NFKD",
            name.casefold()
        )
        if not unicodedata.combining(c)
    ).replace(".", "").replace(" ", "")


def roster_snapshot(raw):
    ensure(
        raw.get("mode") == "shadow"
        and raw.get("platform") == "draftkings",
        "Formato incorrecto"
    )

    ensure(
        raw.get("date") == DATE
        and str(raw.get("slateId")) == "80365",
        "Fecha/slate incorrectos"
    )

    ensure(
        raw.get("salaryCap") == CAP,
        "Presupuesto inesperado"
    )

    return raw


def freeze_a(report):
    by_name = {}

    for p in report["players"]:
        by_name.setdefault(
            norm(p["name"]),
            []
        ).append(p)

    lineups = []

    for index, log in enumerate(LOG_A):
        players = []

        for slot, name, salary, pts in log:
            matches = [
                x
                for x in by_name.get(
                    norm(name),
                    []
                )
                if x["salary"] == salary
            ]

            ensure(
                len(matches) == 1,
                f"ID ambiguo o no encontrado: "
                f"{name} (${salary})"
            )

            p = matches[0]

            players.append({
                "slot": slot,
                "playerId": str(p["playerId"]),
                "name": name,
                "salary": salary,
                "projectedPoints": pts,
                "teamId": str(p["teamId"]),
                "gameId": str(p["gameId"])
            })

        ensure(
            sum(
                x["salary"]
                for x in players
            ) <= CAP,
            "A excede presupuesto"
        )

        lineups.append({
            "rank": index + 1,
            "projectedPoints": TOTALS_A[index],
            "salary": sum(
                x["salary"]
                for x in players
            ),
            "players": players
        })

    return {
        "mode": "shadow",
        "sample": "A",
        "date": DATE,
        "slateId": str(report["slateId"]),
        "platform": "draftkings",
        "model": "CONTEXT_EXPERIMENTAL_V1",
        "origin": "GitHub Actions original log",
        "immutable": True,
        "readyForPublication": False,
        "lineups": lineups
    }


def validate_lineup(lineup, pool):
    selected = (
        lineup["players"]
        if isinstance(lineup, dict)
        else lineup
    )

    ensure(
        len(selected) == len(SLOTS),
        "Faltan posiciones"
    )

    seen_ids = set()
    seen_slots = set()
    checked = []

    for chosen in selected:
        pid = str(
            chosen["playerId"]
        )

        slot = chosen["slot"]

        ensure(
            pid in pool and pid not in seen_ids,
            f"Jugador fuera de pool o repetido: {pid}"
        )

        ensure(
            slot in SLOTS and slot not in seen_slots,
            f"Slot inválido: {slot}"
        )

        p = pool[pid]

        ensure(
            bool(
                set(
                    positions_of(p)
                ) & set(
                    SLOTS[slot]
                )
            ),
            f"Posición inválida: {p['name']} -> {slot}"
        )

        ensure(
            p["salary"] > 3500,
            f"Salario prohibido: {p['name']}"
        )

        seen_ids.add(pid)
        seen_slots.add(slot)

        checked.append({
            "slot": slot,
            "playerId": pid,
            "name": p["name"],
            "salary": p["salary"],
            "projectedPoints": p["projectedPoints"],
            "teamId": str(p["teamId"]),
            "gameId": str(p["gameId"]),
            "depthRank": p["depthRank"],
            "defenseExamples":
                p.get("defenseExamples", [])
        })

    ensure(
        seen_slots == set(SLOTS),
        "Faltan slots"
    )

    salary = sum(
        p["salary"]
        for p in checked
    )

    ensure(
        salary <= CAP,
        "Excede presupuesto"
    )

    return {
        "salary": salary,

        "projectedPoints": round(
            sum(
                p["projectedPoints"]
                for p in checked
            ),
            2
        ),

        "firstListed": sum(
            p["depthRank"] == 1
            for p in checked
        ),

        "players": checked
    }


def build_b(report):
    pool = {}

    for p in report.get(
        "players",
        []
    ):
        if (
            p.get("readyForOptimization")
            is not True
            or not p.get("capturedBeforeTipoff")
        ):
            continue

        if not (
            p.get("gameId")
            and p.get("teamId")
            and p.get("positions")
        ):
            continue

        salary = p.get("salary")
        pts = p.get("projectedPoints")

        if (
            not isinstance(salary, int)
            or salary <= 3500
            or not isinstance(
                pts,
                (int, float)
            )
            or pts <= 0
        ):
            continue

        if p.get(
            "depthRank"
        ) not in (1, 2):
            continue

        pid = str(p["playerId"])

        ensure(
            pid not in pool,
            f"ID repetido: {pid}"
        )

        pool[pid] = {
            "playerId": pid,
            "name": p["name"],
            "salary": salary,
            "projectedPoints": pts,

            "positions": sorted(
                positions_of(p)
            ),

            "gameId": str(
                p["gameId"]
            ),

            "teamId": str(
                p["teamId"]
            ),

            "depthRank":
                p["depthRank"],

            "defenseExamples":
                p.get(
                    "diagnostics",
                    {}
                ).get(
                    "defenseSimilarPlayers",
                    {}
                ).get(
                    "examples",
                    []
                )
        }

    print(
        "MUESTRA B candidatos elegibles:",
        len(pool)
    )

    solutions = []
    solver_status = "NOT_RUN"

    if len(pool) >= len(SLOTS):
        for count in range(5, 0, -1):
            result = optimize_multiple({
                "sport": "nba",

                "platform": "draftkings",

                "slate": {
                    "id": str(
                        report["slateId"]
                    ),
                    "sport": "nba",
                    "platform": "draftkings",
                    "format": "classic",

                    "gameIds": sorted({
                        p["gameId"]
                        for p in pool.values()
                    })
                },

                "players": list(
                    pool.values()
                ),

                "lineupCount": count,
                "maxExposurePercent": 100,
                "minDifferentPlayers": 2,
                "timeLimitSeconds": 20
            })

            solver_status = result.get(
                "status",
                "UNKNOWN"
            )

            if (
                result.get("found")
                and len(
                    result.get("lineups") or []
                ) == count
            ):
                signatures = set()

                for raw in result["lineups"]:
                    checked = validate_lineup(
                        raw,
                        pool
                    )

                    signature = tuple(
                        sorted(
                            p["playerId"]
                            for p in checked["players"]
                        )
                    )

                    ensure(
                        signature not in signatures,
                        "Alineación duplicada"
                    )

                    signatures.add(signature)

                    checked["rank"] = (
                        len(solutions) + 1
                    )

                    solutions.append(checked)

                break

    return {
        "mode": "shadow",
        "sample": "B",
        "date": DATE,
        "slateId": str(report["slateId"]),
        "platform": "draftkings",
        "model": report["model"],
        "immutable": True,
        "readyForPublication": False,
        "eligiblePlayers": len(pool),
        "solverStatus": solver_status,
        "lineups": solutions,
        "limitations": report.get(
            "limitations",
            []
        )
    }


def api(route, params):
    key = os.getenv(
        "BALLDONTLIE_NBA_API_KEY"
    )

    ensure(
        key,
        "Falta BALLDONTLIE_NBA_API_KEY"
    )

    url = (
        "https://api.balldontlie.io" +
        route +
        "?" +
        urllib.parse.urlencode(
            params,
            doseq=True
        )
    )

    for attempt in range(5):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": key
                }
            )

            with urllib.request.urlopen(
                req,
                timeout=40
            ) as resp:
                return json.load(resp)

        except urllib.error.HTTPError as exc:
            if exc.code not in (
                429,
                500,
                502,
                503,
                504
            ):
                raise

            time.sleep(
                2 * (attempt + 1)
            )

    raise RuntimeError(
        f"BDL no respondió: {route}"
    )


def pages(route, params):
    rows = []
    seen = set()
    cursor = None

    for _ in range(100):
        query = {
            **params,
            "per_page": 100
        }

        if cursor:
            query["cursor"] = cursor

        result = api(
            route,
            query
        )

        ensure(
            isinstance(
                result.get("data"),
                list
            ),
            "API response inesperado"
        )

        rows.extend(
            result["data"]
        )

        nxt = result.get(
            "meta",
            {}
        ).get(
            "next_cursor"
        )

        if not nxt:
            return rows

        ensure(
            str(nxt) not in seen,
            "Cursor de API repetido"
        )

        seen.add(str(nxt))
        cursor = nxt

    raise RuntimeError(
        "Paginación incompleta"
    )


def fantasy_score(row):
    def val(key):
        raw = row.get(key)

        return (
            float(raw)
            if raw not in (None, "")
            else 0
        )

    stats = [
        val("pts"),
        val("reb"),
        val("ast"),
        val("stl"),
        val("blk")
    ]

    doubles = sum(
        v >= 10
        for v in stats
    )

    return round(
        stats[0] +
        1.25 * stats[1] +
        1.5 * stats[2] +
        2 * stats[3] +
        2 * stats[4] -
        0.5 * val("turnover") +
        0.5 * val("fg3m") +
        (1.5 if doubles >= 2 else 0) +
        (3 if doubles >= 3 else 0),
        2
    )


def evaluate():
    a = read(FILE_A)
    b = read(FILE_B)

    ensure(
        a["date"] == b["date"] == DATE
        and a["slateId"] == b["slateId"],
        "Muestras de fechas distintas"
    )

    ensure(
        a["lineups"] and b["lineups"],
        "Faltan alineaciones"
    )

    games = pages(
        "/v1/games",
        {
            "dates[]": [DATE]
        }
    )

    needed = {
        str(p["gameId"])
        for report in (a, b)
        for lineup in report["lineups"]
        for p in lineup["players"]
    }

    final = {
        str(g["id"])
        for g in games
        if (
            str(
                g.get("status_state", "")
            ).lower() == "final"
            or str(
                g.get("status", "")
            ).lower() == "final"
        )
    }

    ensure(
        needed <= final,
        "Los partidos aún no han terminado: " +
        ", ".join(
            sorted(needed - final)
        )
    )

    stats = pages(
        "/v1/stats",
        {
            "dates[]": [DATE]
        }
    )

    actual = {
        (
            str(
                row.get(
                    "player",
                    {}
                ).get("id")
            ),
            str(
                row.get(
                    "game",
                    {}
                ).get("id")
            )
        ): fantasy_score(row)
        for row in stats
    }

    def calc(report):
        lineups = []
        player_errors = {}

        for item in report["lineups"]:
            lines = []

            for p in item["players"]:
                key = (
                    str(p["playerId"]),
                    str(p["gameId"])
                )

                # Juego final sin estadisticas
                # registradas: DNP = 0 FP.
                earned = actual.get(
                    key,
                    0.0
                )

                pred = float(
                    p["projectedPoints"]
                )

                lines.append({
                    "name": p["name"],
                    "playerId": p["playerId"],
                    "projectedFP": pred,
                    "actualFP": earned,
                    "error": round(
                        pred - earned,
                        2
                    )
                })

                player_errors[key] = (
                    pred,
                    earned
                )

            actual_total = round(
                sum(
                    p["actualFP"]
                    for p in lines
                ),
                2
            )

            lineups.append({
                "rank": item["rank"],
                "projectedFP":
                    item["projectedPoints"],
                "actualFP":
                    actual_total,

                "projectionError": round(
                    item["projectedPoints"] -
                    actual_total,
                    2
                ),

                "players": lines
            })

        err = list(
            player_errors.values()
        )

        return {
            "sample": report["sample"],

            "lineups": lineups,

            "meanActualFP": round(
                sum(
                    x["actualFP"]
                    for x in lineups
                ) / len(lineups),
                2
            ),

            "bestActualFP": max(
                x["actualFP"]
                for x in lineups
            ),

            "uniquePlayerMAE": round(
                sum(
                    abs(p - a)
                    for p, a in err
                ) / len(err),
                2
            )
        }

    outcomes = [
        calc(a),
        calc(b)
    ]

    report = {
        "date": DATE,
        "slateId": a["slateId"],
        "mode": "shadow",

        "source":
            "BALLDONTLIE final boxscores",

        "comparison": outcomes,

        "winnerByAverageLineupFP":
            max(
                outcomes,
                key=lambda o:
                    o["meanActualFP"]
            )["sample"],

        "winnerByPlayerMAE":
            min(
                outcomes,
                key=lambda o:
                    o["uniquePlayerMAE"]
            )["sample"]
    }

    save_once(
        FILE_EVAL,
        report
    )

    summary = {
        x["sample"]: {
            "promedio_real":
                x["meanActualFP"],

            "mejor_alineacion_real":
                x["bestActualFP"],

            "error_medio_por_jugador":
                x["uniquePlayerMAE"]
        }
        for x in outcomes
    }

    print(
        "COMPARACION FINAL:",
        json.dumps(
            summary,
            ensure_ascii=False,
            indent=2
        )
    )

    print(
        "Guardado en:",
        FILE_EVAL
    )


def main():
    ensure(
        DATE == "2026-10-22",
        "Experimento limitado al 22 de octubre"
    )

    mode = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "build"
    )

    if mode == "freeze":
        ensure(
            not FILE_A.exists(),
            "La muestra A ya está congelada"
        )

        a = freeze_a(
            roster_snapshot(
                read(INPUT_A)
            )
        )

        save_once(
            FILE_A,
            a
        )

        print(
            "MUESTRA A CONGELADA:",
            len(a["lineups"]),
            "lineups",
            FILE_A
        )

    elif mode == "build":
        a = read(FILE_A)

        ensure(
            a["date"] == DATE
            and a["slateId"] == "80365",
            "Muestra A incorrecta"
        )

        ensure(
            not FILE_B.exists(),
            "La muestra B ya está congelada"
        )

        b = build_b(
            roster_snapshot(
                read(INPUT_B)
            )
        )

        ensure(
            len(b["lineups"]) >= 1,
            "B no tiene alineaciones válidas"
        )

        save_once(
            FILE_B,
            b
        )

        print(
            "MUESTRA A PRESERVADA:",
            len(a["lineups"]),
            "lineups"
        )

        print(
            "MUESTRA B CONGELADA:",
            len(b["lineups"]),
            "lineups"
        )

        for l in b["lineups"]:
            print(
                "B",
                l["rank"],
                "| Salario",
                l["salary"],
                "| Proyección",
                l["projectedPoints"]
            )

            for p in l["players"]:
                print(
                    " ",
                    p["slot"],
                    p["name"],
                    "$" + str(p["salary"]),
                    str(p["projectedPoints"]) +
                    " FP"
                )

        print(
            "Snapshots:",
            OUTPUT
        )

    elif mode == "evaluate":
        evaluate()

    else:
        raise ValueError(
            "Usa freeze, build o evaluate"
        )


if __name__ == "__main__":
    main()
