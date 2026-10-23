
#!/usr/bin/env python3

"""
CashEdge NBA Fantasy A/B Experiment
2026-10-22 — SHADOW ONLY
No database writes.
"""

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
        Path("fantasy-engine/optimizer").resolve()
    )
)

from multi_solver import optimize_multiple
from solver import RULES, positions_of


DATE = os.getenv(
    "FANTASY_TARGET_DATE",
    "2026-10-22"
)

ROOT = Path("fantasy-experiments") / DATE

FILE_A = ROOT / "sample-a.json"
FILE_B = ROOT / "sample-b.json"

FILE_EVAL = (
    ROOT / "comparison-after-games.json"
)

INPUT_A = Path(
    "fantasy-slate-data/"
    "nba-draftkings-context-shadow.json"
)

INPUT_B = Path(
    "fantasy-slate-data/"
    "nba-draftkings-advanced-shadow.json"
)

SLOTS = RULES["nba"]["draftkings"]["slots"]
CAP = RULES["nba"]["draftkings"]["salary_cap"]

SLATE_ID = "80365"


# MUESTRA A ORIGINAL
# No cambiar jugadores ni proyecciones.

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
        file.is_file(),
        f"Archivo no encontrado: {file}"
    )

    return json.loads(
        file.read_text(encoding="utf-8")
    )


def save_once(file, data):
    ensure(
        not file.exists(),
        f"NO sobrescribir archivo congelado: {file}"
    )

    file.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    with file.open("x", encoding="utf-8") as handle:
        json.dump(
            data,
            handle,
            indent=2,
            ensure_ascii=False
        )


def check_report(report):
    ensure(
        report.get("mode") == "shadow"
        and report.get("platform") == "draftkings",
        "Reporte no es DraftKings SHADOW"
    )

    ensure(
        report.get("date") == DATE
        and str(report.get("slateId")) == SLATE_ID,
        "Fecha o slate incorrectos"
    )

    ensure(
        report.get("salaryCap") == CAP,
        "Salary cap distinto al oficial"
    )

    return report


def norm(name):
    t = unicodedata.normalize(
        "NFKD",
        str(name).casefold()
    )

    return "".join(
        c for c in t
        if not unicodedata.combining(c)
    ).replace(".", "").replace(" ", "")


def freeze():
    report = check_report(
        read(INPUT_A)
    )

    by_name = {}

    for p in report["players"]:
        by_name.setdefault(
            norm(p["name"]),
            []
        ).append(p)

    lineups = []

    for index, original in enumerate(LOG_A):
        people = []

        for slot, name, salary, expected in original:
            matches = [
                p
                for p in by_name.get(norm(name), [])
                if p["salary"] == salary
            ]

            ensure(
                len(matches) == 1,
                f"Identidad ambigua: {name}"
            )

            p = matches[0]

            people.append({
                "slot": slot,
                "playerId": str(p["playerId"]),
                "name": name,
                "salary": salary,
                "projectedPoints": expected,
                "teamId": str(p["teamId"]),
                "gameId": str(p["gameId"])
            })

        ensure(
            sum(p["salary"] for p in people) <= CAP,
            "A excede presupuesto"
        )

        lineups.append({
            "rank": index + 1,
            "projectedPoints": TOTALS_A[index],
            "salary": sum(
                p["salary"] for p in people
            ),
            "players": people
        })

    save_once(FILE_A, {
        "mode": "shadow",
        "sample": "A",
        "date": DATE,
        "slateId": SLATE_ID,
        "platform": "draftkings",
        "model": "CONTEXT_EXPERIMENTAL_V1",
        "immutable": True,
        "readyForPublication": False,
        "lineups": lineups
    })

    print(
        "MUESTRA A CONGELADA: 5 lineups"
    )


def validate_lineup(raw, pool):
    selected = (
        raw
        if isinstance(raw, list)
        else raw.get("players", raw.get("lineup", []))
    )

    ensure(
        len(selected) == len(SLOTS),
        "Alineacion incompleta"
    )

    ids = set()
    slots = set()
    people = []

    for selection in selected:
        player_id = str(
            selection["playerId"]
        )

        slot = selection["slot"]

        ensure(
            player_id in pool
            and player_id not in ids,
            "Jugador no valido o repetido"
        )

        ensure(
            slot in SLOTS
            and slot not in slots,
            "Slot no valido o repetido"
        )

        p = pool[player_id]

        ensure(
            bool(
                set(positions_of(p))
                & set(SLOTS[slot])
            ),
            f"Posicion invalida: {p['name']} -> {slot}"
        )

        ensure(
            p["salary"] > 3500,
            "Salario prohibido"
        )

        ids.add(player_id)
        slots.add(slot)

        people.append({
            "slot": slot,
            "playerId": player_id,
            "name": p["name"],
            "salary": p["salary"],
            "projectedPoints": p["projectedPoints"],
            "teamId": p["teamId"],
            "gameId": p["gameId"],
            "depthRank": p["depthRank"],
            "defenseExamples": p["defenseExamples"]
        })

    ensure(
        slots == set(SLOTS),
        "Faltan slots"
    )

    salary = sum(
        p["salary"] for p in people
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
                for p in people
            ),
            2
        ),
        "firstListed": sum(
            p["depthRank"] == 1
            for p in people
        ),
        "players": people
    }


def build():
    a = read(FILE_A)

    ensure(
        a.get("date") == DATE
        and str(a.get("slateId")) == SLATE_ID,
        "La muestra A es incorrecta"
    )

    report = check_report(
        read(INPUT_B)
    )

    pool = {}

    for p in report.get("players", []):
        salary = p.get("salary")
        pts = p.get("projectedPoints")

        if not (
            p.get("readyForOptimization") is True
            and p.get("capturedBeforeTipoff") is True
        ):
            continue

        if not (
            p.get("gameId")
            and p.get("teamId")
            and p.get("positions")
        ):
            continue

        if not (
            type(salary) is int
            and salary > 3500
            and isinstance(pts, (int, float))
            and pts > 0
        ):
            continue

        if p.get("depthRank") not in (1, 2):
            continue

        pid = str(p["playerId"])

        ensure(
            pid not in pool,
            f"ID duplicado: {pid}"
        )

        pool[pid] = {
            "playerId": pid,
            "name": p["name"],
            "salary": salary,
            "projectedPoints": float(pts),
            "positions": sorted(
                positions_of(p)
            ),
            "gameId": str(p["gameId"]),
            "teamId": str(p["teamId"]),
            "depthRank": p["depthRank"],
            "defenseExamples": (
                (p.get("diagnostics") or {})
                .get("defenseSimilarPlayers", {})
                .get("examples", [])
            )
        }

    print(
        "MUESTRA B candidatos elegibles:",
        len(pool)
    )

    selected_lineups = []
    status = "NOT_RUN"

    if len(pool) >= len(SLOTS):
        for n in range(5, 0, -1):
            result = optimize_multiple({
                "sport": "nba",
                "platform": "draftkings",
                "slate": {
                    "id": SLATE_ID,
                    "sport": "nba",
                    "platform": "draftkings",
                    "format": "classic",
                    "gameIds": sorted({
                        p["gameId"]
                        for p in pool.values()
                    })
                },
                "players": list(pool.values()),
                "lineupCount": n,
                "maxExposurePercent": 100,
                "minDifferentPlayers": 2,
                "timeLimitSeconds": 20
            })

            status = result.get(
                "status",
                "UNKNOWN"
            )

            if (
                result.get("found")
                and len(result.get("lineups") or []) == n
            ):
                signatures = set()

                for raw in result["lineups"]:
                    checked = validate_lineup(
                        raw,
                        pool
                    )

                    sig = tuple(
                        sorted(
                            p["playerId"]
                            for p in checked["players"]
                        )
                    )

                    ensure(
                        sig not in signatures,
                        "Alineacion duplicada"
                    )

                    signatures.add(sig)

                    checked["rank"] = (
                        len(selected_lineups) + 1
                    )

                    selected_lineups.append(checked)

                break

    ensure(
        selected_lineups,
        "No se generaron alineaciones B validas"
    )

    save_once(FILE_B, {
        "mode": "shadow",
        "sample": "B",
        "date": DATE,
        "slateId": SLATE_ID,
        "platform": "draftkings",
        "model": report["model"],
        "immutable": True,
        "readyForPublication": False,
        "eligiblePlayers": len(pool),
        "solverStatus": status,
        "lineups": selected_lineups,
        "limitations": report.get(
            "limitations",
            []
        )
    })

    print(
        "MUESTRA A PRESERVADA:",
        len(a["lineups"]),
        "lineups"
    )

    print(
        "MUESTRA B CONGELADA:",
        len(selected_lineups),
        "lineups"
    )

    for row in selected_lineups:
        print(
            f"B {row['rank']} | "
            f"Salario {row['salary']} | "
            f"Proyeccion {row['projectedPoints']}"
        )

        for p in row["players"]:
            print(
                f"  {p['slot']} {p['name']} "
                f"${p['salary']} "
                f"{p['projectedPoints']} FP"
            )


def api(route, params):
    # CORRECCION PRINCIPAL:
    # Elimina saltos de linea y espacios
    # al principio y al final de la clave.

    key = (
        os.getenv("BALLDONTLIE_NBA_API_KEY")
        or ""
    ).strip()

    ensure(
        key,
        "Falta BALLDONTLIE_NBA_API_KEY"
    )

    ensure(
        "\n" not in key
        and "\r" not in key,
        "La API key tiene saltos de linea internos"
    )

    url = (
        "https://api.balldontlie.io"
        + route
        + "?"
        + urllib.parse.urlencode(
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
            ) as response:
                return json.load(response)

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
        f"BALLDONTLIE no respondio: {route}"
    )


def pages(route, params):
    rows = []
    cursor = None
    seen = set()

    for _ in range(100):
        query = dict(params)

        query["per_page"] = 100

        if cursor:
            query["cursor"] = cursor

        response = api(
            route,
            query
        )

        ensure(
            isinstance(
                response.get("data"),
                list
            ),
            "Respuesta API inesperada"
        )

        rows.extend(
            response["data"]
        )

        next_cursor = (
            response
            .get("meta", {})
            .get("next_cursor")
        )

        if not next_cursor:
            return rows

        ensure(
            str(next_cursor) not in seen,
            "Cursor repetido"
        )

        seen.add(
            str(next_cursor)
        )

        cursor = next_cursor

    raise RuntimeError(
        "Paginacion incompleta"
    )


def fantasy_score(row):
    def v(key):
        value = row.get(key)

        return (
            float(value)
            if value not in (None, "")
            else 0.0
        )

    pts, reb, ast, stl, blk = [
        v(k)
        for k in (
            "pts",
            "reb",
            "ast",
            "stl",
            "blk"
        )
    ]

    doubles = sum(
        x >= 10
        for x in (
            pts,
            reb,
            ast,
            stl,
            blk
        )
    )

    return round(
        pts
        + 1.25 * reb
        + 1.5 * ast
        + 2 * stl
        + 2 * blk
        - 0.5 * v("turnover")
        + 0.5 * v("fg3m")
        + (1.5 if doubles >= 2 else 0)
        + (3 if doubles >= 3 else 0),
        2
    )


def finished(game):
    status = str(
        game.get("status_state")
        or game.get("status")
        or ""
    ).lower()

    return (
        status in ("final", "completed")
        or status.startswith("final/")
        or status.startswith("final ")
    )


def evaluate():
    a = read(FILE_A)
    b = read(FILE_B)

    ensure(
        a["date"] == b["date"] == DATE
        and str(a["slateId"]) == str(b["slateId"])
        and str(a["slateId"]) == SLATE_ID,
        "Muestras de fechas distintas"
    )

    ensure(
        a.get("lineups")
        and b.get("lineups"),
        "Faltan alineaciones"
    )

    ensure(
        not FILE_EVAL.exists(),
        f"Comparacion ya congelada: {FILE_EVAL}"
    )

    games = pages(
        "/v1/games",
        {
            "dates[]": [DATE]
        }
    )

    final_ids = {
        str(g["id"])
        for g in games
        if finished(g)
    }

    needed = {
        str(p["gameId"])
        for report in (a, b)
        for lineup in report["lineups"]
        for p in lineup["players"]
    }

    ensure(
        needed <= final_ids,
        "Partidos sin resultado final: "
        + ", ".join(
            sorted(needed - final_ids)
        )
    )

    rows = pages(
        "/v1/stats",
        {
            "dates[]": [DATE]
        }
    )

    actual = {}

    for row in rows:
        pid = str(
            (row.get("player") or {}).get("id")
        )

        gid = str(
            (row.get("game") or {}).get("id")
        )

        if (
            pid not in ("", "None")
            and gid in final_ids
        ):
            key = (pid, gid)

            ensure(
                key not in actual,
                f"Estadistica duplicada: {key}"
            )

            actual[key] = fantasy_score(row)

    ensure(
        actual,
        "BALLDONTLIE no devolvio estadisticas de la fecha"
    )

    # No inventar DNP ni asignar 0 FP
    # cuando la API no identifica al jugador.

    missing = sorted({
        (
            str(p["playerId"]),
            str(p["gameId"]),
            p["name"]
        )
        for r in (a, b)
        for lineup in r["lineups"]
        for p in lineup["players"]
        if (
            str(p["playerId"]),
            str(p["gameId"])
        ) not in actual
    })

    if missing:
        print(
            "ATENCION: jugadores sin boxscore identificado:"
        )

        for pid, gid, name in missing:
            print(
                " ",
                name,
                "ID",
                pid,
                "GAME",
                gid
            )

        raise ValueError(
            "Evaluacion detenida: faltan boxscores; "
            "no asignar cero automaticamente"
        )

    def calculate(sample):
        lineup_results = []
        unique = {}

        for lineup in sample["lineups"]:
            players = []

            for p in lineup["players"]:
                key = (
                    str(p["playerId"]),
                    str(p["gameId"])
                )

                earned = actual[key]

                forecast = float(
                    p["projectedPoints"]
                )

                players.append({
                    "name": p["name"],
                    "playerId": p["playerId"],
                    "projectedFP": forecast,
                    "actualFP": earned,
                    "error": round(
                        forecast - earned,
                        2
                    )
                })

                unique[key] = (
                    forecast,
                    earned
                )

            total = round(
                sum(
                    x["actualFP"]
                    for x in players
                ),
                2
            )

            lineup_results.append({
                "rank": lineup["rank"],
                "projectedFP": lineup["projectedPoints"],
                "actualFP": total,
                "projectionError": round(
                    lineup["projectedPoints"] - total,
                    2
                ),
                "players": players
            })

        errors = list(
            unique.values()
        )

        return {
            "sample": sample["sample"],
            "lineups": lineup_results,
            "meanActualFP": round(
                sum(
                    x["actualFP"]
                    for x in lineup_results
                ) / len(lineup_results),
                2
            ),
            "bestActualFP": max(
                x["actualFP"]
                for x in lineup_results
            ),
            "uniquePlayerMAE": round(
                sum(
                    abs(p - a)
                    for p, a in errors
                ) / len(errors),
                2
            )
        }

    comparisons = [
        calculate(a),
        calculate(b)
    ]

    output = {
        "date": DATE,
        "slateId": SLATE_ID,
        "mode": "shadow",
        "source": "BALLDONTLIE final boxscores",
        "comparison": comparisons,
        "winnerByAverageLineupFP": max(
            comparisons,
            key=lambda x: x["meanActualFP"]
        )["sample"],
        "winnerByPlayerMAE": min(
            comparisons,
            key=lambda x: x["uniquePlayerMAE"]
        )["sample"]
    }

    save_once(
        FILE_EVAL,
        output
    )

    print(
        "COMPARACION FINAL:"
    )

    for x in comparisons:
        print(
            f"MUESTRA {x['sample']}: "
            f"promedio real {x['meanActualFP']} FP, "
            f"mejor alineacion {x['bestActualFP']} FP, "
            f"error jugador {x['uniquePlayerMAE']} FP"
        )

        for l in x["lineups"]:
            print(
                f"  #{l['rank']}: "
                f"esperado {l['projectedFP']} FP, "
                f"real {l['actualFP']} FP"
            )

    print(
        "Ganador alineaciones:",
        output["winnerByAverageLineupFP"]
    )

    print(
        "Ganador precision:",
        output["winnerByPlayerMAE"]
    )

    print(
        "Guardado:",
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
        freeze()

    elif mode == "build":
        build()

    elif mode == "evaluate":
        evaluate()

    else:
        raise ValueError(
            "Usa freeze, build o evaluate"
        )


if __name__ == "__main__":
    main()
