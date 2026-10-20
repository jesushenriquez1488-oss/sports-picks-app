
"""
CASHEDGE FANTASY EDGE
RECOMMENDATION CONTROLLER

#1: alineacion optima certificada.
#2-#10: alternativas optimizadas sin alterar #1.

NBA / NFL — DraftKings / FanDuel.
Modo SHADOW. Sin API ni escrituras.
"""

import json
import sys
import math
from decimal import Decimal
from collections import Counter

from ortools.sat.python import cp_model

from solver import (
    optimize,
    RULES,
    SCORE_SCALE,
    score_units,
    positions_of,
)


def ident(value):
    return "" if value is None else str(value).strip()


def recommend(payload):
    if not isinstance(payload, dict):
        raise ValueError("Entrada JSON invalida")

    sport = str(payload.get("sport", "")).lower()
    platform = str(payload.get("platform", "")).lower()

    if sport not in RULES or platform not in RULES[sport]:
        raise ValueError("Deporte o plataforma invalida")

    rules = RULES[sport][platform]
    slots = rules["slots"]
    salary_cap = rules["salary_cap"]
    roster_size = len(slots)

    count = payload.get("lineupCount", 3)
    changes = payload.get("minDifferentPlayers", 2)

    if (
        type(count) is not int or
        not 1 <= count <= 10 or
        type(changes) is not int or
        not 1 <= changes <= roster_size
    ):
        raise ValueError("Cantidad o diversidad invalida")

    exposure = Decimal(
        str(payload.get("maxExposurePercent", 100))
    )

    if not exposure.is_finite() or not 0 < exposure <= 100:
        raise ValueError("Exposicion invalida")

    max_appearances = int(exposure * count / 100)

    if max_appearances < 1:
        raise ValueError("Exposicion demasiado baja")

    seconds = float(payload.get("timeLimitSeconds", 20))

    if not math.isfinite(seconds) or not 0.1 <= seconds <= 120:
        raise ValueError("Tiempo invalido")

    slate = payload.get("slate")

    if (
        not isinstance(slate, dict) or
        not slate.get("id") or
        slate.get("sport") != sport or
        slate.get("platform") != platform or
        slate.get("format") != "classic"
    ):
        raise ValueError("Slate Classic invalido")

    game_ids = slate.get("gameIds")

    if not isinstance(game_ids, list) or not game_ids:
        raise ValueError("Partidos del slate faltantes")

    allowed_games = set(map(ident, game_ids))

    if "" in allowed_games:
        raise ValueError("Game ID invalido")

    locked = payload.get("locked", [])
    excluded = payload.get("excluded", [])

    if not isinstance(locked, list) or not isinstance(excluded, list):
        raise ValueError("Bloqueos invalidos")

    locked_ids = set(map(ident, locked))
    excluded_ids = set(map(ident, excluded))

    if (
        "" in locked_ids or
        "" in excluded_ids or
        locked_ids & excluded_ids
    ):
        raise ValueError("Bloqueos incompatibles")

    # Lock global: el jugador va en todas las alineaciones.
    if count > 1 and locked_ids and max_appearances < count:
        raise ValueError(
            "Locks globales requieren exposicion 100%"
        )

    # Solo datos validos para el optimizador.
    raw_players = payload.get("players")

    if not isinstance(raw_players, list):
        raise ValueError("Jugadores invalidos")

    if len(raw_players) > 1000:
        raise ValueError("Demasiados jugadores")

    pool = {}

    for raw in raw_players:
        if not isinstance(raw, dict):
            continue

        pid = ident(raw.get("playerId", raw.get("id")))

        if not pid or pid in excluded_ids:
            continue

        if (
            raw.get("disabled") is True or
            raw.get("status") == "out_injury" or
            raw.get("injuryStatus") == "out"
        ):
            continue

        salary = raw.get("salary")

        if (
            type(salary) is not int or
            not 0 < salary <= salary_cap
        ):
            continue

        try:
            points = score_units(raw.get("projectedPoints"))
        except (ValueError, TypeError, ArithmeticError):
            continue

        game_id = ident(raw.get("gameId"))
        positions = sorted(positions_of(raw))

        if game_id not in allowed_games or not positions:
            continue

        candidate = {
            "playerId": pid,
            "name": raw.get("name"),
            "teamId": ident(raw.get("teamId")),
            "gameId": game_id,
            "salary": salary,
            "scoreUnits": points,
            "positions": positions,
        }

        if pid in pool and pool[pid] != candidate:
            raise ValueError("Datos contradictorios: " + pid)

        pool[pid] = candidate

    if not locked_ids.issubset(pool):
        raise ValueError("Jugador bloqueado no disponible")

    clean_players = [
        {
            "playerId": p["playerId"],
            "name": p["name"],
            "teamId": p["teamId"],
            "gameId": p["gameId"],
            "salary": p["salary"],
            "positions": p["positions"],
            "projectedPoints": p["scoreUnits"] / SCORE_SCALE,
        }
        for p in pool.values()
    ]

    # =========================================
    # ETAPA 1: RECOMENDACION PRINCIPAL EXACTA
    # =========================================

    main = optimize({
        "sport": sport,
        "platform": platform,
        "slate": slate,
        "players": clean_players,
        "locked": list(locked_ids),
        "excluded": [],
        "timeLimitSeconds": seconds,
    })

    result = {
        "mode": "shadow",
        "solver": "cashEdge-hybrid-cpsat",
        "sport": sport,
        "platform": platform,
        "requestedLineups": count,
        "contestVerified": False,
        "readyForPublication": False,
        "recommended": None,
        "alternatives": [],
        "mainOptimalityGuaranteed": False,
        "alternativePortfolioOptimalityGuaranteed": False,
    }

    # Sin OPTIMAL no se publica una recomendacion #1.
    if (
        main.get("status") != "OPTIMAL" or
        main.get("found") is not True
    ):
        return {
            **result,
            "status": "MAIN_NOT_CERTIFIED",
            "mainSolverStatus": main.get("status"),
            "reason": "primary_optimality_not_proven",
        }

    main_ids = {
        p["playerId"] for p in main["lineup"]
    }

    if len(main_ids) != roster_size:
        raise RuntimeError("Alineacion principal invalida")

    result["recommended"] = {
        "number": 1,
        "label": "CashEdge Recommended",
        "status": "OPTIMAL",
        "optimalityGuaranteed": True,
        "projectedPoints": main["projectedPoints"],
        "salary": main["salary"],
        "remainingSalary": main["remainingSalary"],
        "players": main["lineup"],
    }

    result["mainOptimalityGuaranteed"] = True

    if count == 1:
        return {
            **result,
            "status": "COMPLETE",
            "generatedLineups": 1,
            "playerExposure": [
                {
                    "playerId": pid,
                    "appearances": 1,
                    "percentage": 100.0,
                }
                for pid in sorted(main_ids)
            ],
        }

    # =========================================
    # ETAPA 2: ALTERNATIVAS CON #1 CONGELADA
    # =========================================

    alternative_count = count - 1

    model = cp_model.CpModel()
    x = {}
    y = {}

    for k in range(alternative_count):
        for pid, player in pool.items():
            options = []

            for slot_id, eligible in slots.items():
                if set(player["positions"]) & set(eligible):
                    var = model.NewBoolVar(
                        f"x_{k}_{len(x)}"
                    )

                    x[k, pid, slot_id] = var
                    options.append(var)

            if options:
                chosen = model.NewBoolVar(
                    f"y_{k}_{len(y)}"
                )
                y[k, pid] = chosen
                model.Add(sum(options) == chosen)

    for k in range(alternative_count):
        for slot_id in slots:
            options = [
                var
                for (lk, pid, sid), var in x.items()
                if lk == k and sid == slot_id
            ]

            model.Add(sum(options) == 1)

        model.Add(
            sum(
                pool[pid]["salary"] * var
                for (lk, pid), var in y.items()
                if lk == k
            ) <= salary_cap
        )

        # Las alternativas deben diferir de #1.
        model.Add(
            sum(
                y[k, pid]
                for pid in main_ids
                if (k, pid) in y
            ) <= roster_size - changes
        )

        for pid in locked_ids:
            model.Add(y[k, pid] == 1)

    # #1 tambien cuenta para el limite de exposicion.
    for pid in pool:
        occurrences = [
            y[k, pid]
            for k in range(alternative_count)
            if (k, pid) in y
        ]

        model.Add(
            sum(occurrences) + int(pid in main_ids)
            <= max_appearances
        )

    # Diferencias entre las propias alternativas.
    for a in range(alternative_count):
        for b in range(a + 1, alternative_count):
            shared = []

            for pid in pool:
                if (a, pid) not in y or (b, pid) not in y:
                    continue

                both = model.NewBoolVar(
                    f"shared_{a}_{b}_{len(shared)}"
                )

                model.Add(both <= y[a, pid])
                model.Add(both <= y[b, pid])
                model.Add(
                    both >= y[a, pid] + y[b, pid] - 1
                )

                shared.append(both)

            model.Add(
                sum(shared) <= roster_size - changes
            )

    # Maximizar las alternativas sin cambiar #1.
    model.Maximize(
        sum(
            pool[pid]["scoreUnits"] * var
            for (k, pid), var in y.items()
        )
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = seconds
    solver.parameters.num_search_workers = 4

    code = solver.Solve(model)
    alternative_status = solver.StatusName(code)

    result["alternativeSolverStatus"] = alternative_status

    if code not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            **result,
            "status": "MAIN_ONLY",
            "generatedLineups": 1,
            "reason": "alternatives_not_available",
            "playerExposure": [
                {
                    "playerId": pid,
                    "appearances": 1,
                    "percentage": round(100 / count, 2),
                }
                for pid in sorted(main_ids)
            ],
        }

    alternatives = []

    for k in range(alternative_count):
        players = []

        for (lk, pid, slot_id), var in x.items():
            if lk != k or solver.Value(var) != 1:
                continue

            item = pool[pid]

            players.append({
                "slot": slot_id,
                "playerId": pid,
                "name": item["name"],
                "teamId": item["teamId"],
                "gameId": item["gameId"],
                "salary": item["salary"],
                "positions": item["positions"],
                "projectedPoints":
                    item["scoreUnits"] / SCORE_SCALE,
            })

        players.sort(
            key=lambda p: list(slots).index(p["slot"])
        )

        ids = {p["playerId"] for p in players}
        salary = sum(p["salary"] for p in players)

        if (
            len(players) != roster_size or
            len(ids) != roster_size or
            salary > salary_cap or
            len(ids - main_ids) < changes or
            not locked_ids.issubset(ids)
        ):
            raise RuntimeError("Alternativa invalida")

        points = sum(
            pool[pid]["scoreUnits"] for pid in ids
        ) / SCORE_SCALE

        alternatives.append({
            "number": k + 2,
            "label": "Alternative Lineup",
            "projectedPoints": points,
            "salary": salary,
            "remainingSalary": salary_cap - salary,
            "players": players,
        })

    alternatives.sort(
        key=lambda row: -row["projectedPoints"]
    )

    for index, row in enumerate(alternatives):
        row["number"] = index + 2

    all_lineups = [
        result["recommended"],
        *alternatives,
    ]

    appearances = Counter()

    for lineup in all_lineups:
        for player in lineup["players"]:
            appearances[player["playerId"]] += 1

    if any(
        times > max_appearances
        for times in appearances.values()
    ):
        raise RuntimeError("Exposicion excedida")

    for i in range(len(all_lineups)):
        a = {
            p["playerId"]
            for p in all_lineups[i]["players"]
        }

        for j in range(i + 1, len(all_lineups)):
            b = {
                p["playerId"]
                for p in all_lineups[j]["players"]
            }

            if len(a - b) < changes:
                raise RuntimeError("Diversidad incumplida")

    result["alternatives"] = alternatives
    result["status"] = "COMPLETE"
    result["generatedLineups"] = len(all_lineups)

    result["alternativePortfolioOptimalityGuaranteed"] = (
        code == cp_model.OPTIMAL
    )

    result["maxAppearances"] = max_appearances
    result["totalProjectedPoints"] = sum(
        row["projectedPoints"] for row in all_lineups
    )

    result["playerExposure"] = [
        {
            "playerId": pid,
            "appearances": times,
            "percentage": round(times * 100 / count, 2),
        }
        for pid, times in sorted(appearances.items())
    ]

    return result


if __name__ == "__main__":
    try:
        payload = json.load(sys.stdin)
        print(json.dumps(recommend(payload)))

    except Exception as error:
        print(json.dumps({
            "status": "ERROR",
            "error": str(error),
            "readyForPublication": False,
        }))
        sys.exit(1)
